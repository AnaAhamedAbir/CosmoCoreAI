import os
import json
import asyncio
import logging
from datetime import datetime
import aiohttp
from typing import Set, Dict, Any

from app.services.websocket_manager import manager
from app.core.redis import redis_manager
from app.services.subminute_candle_recorder import subminute_candle_recorder

logger = logging.getLogger(__name__)

class OandaStreamer:
    def __init__(self):
        self.active_symbols: Set[str] = set()
        self._bg_symbols: Set[str] = set()
        self._task = None
        self._session = None
        self._running = False
        self._last_prices: Dict[str, float] = {}
        self._subscriber_counts: Dict[str, int] = {}

    @staticmethod
    def _to_oanda_instrument(symbol: str) -> str:
        """Convert UI symbol (EUR/USD or EUR_USD) to canonical OANDA instrument (EUR_USD)."""
        return str(symbol or "").strip().upper().replace("/", "_")

    @staticmethod
    def _to_ui_symbol(instrument: str) -> str:
        """Convert OANDA instrument (EUR_USD) to UI symbol (EUR/USD)."""
        return str(instrument or "").strip().upper().replace("_", "/")

    def _reconcile_active_symbols(self) -> None:
        desired = self._bg_symbols | set(self._subscriber_counts.keys())
        if desired != self.active_symbols:
            self.active_symbols = desired
            self._restart_stream()

    def sync_background_symbols(self, symbols: Set[str]) -> None:
        """Idempotently sync symbols driven by main.py's /ws/market-data background loop without disturbing WS depth streams."""
        normalized = {self._to_oanda_instrument(s) for s in symbols if self._to_oanda_instrument(s)}
        if normalized != self._bg_symbols:
            self._bg_symbols = normalized
            self._reconcile_active_symbols()

    def add_symbol(self, symbol: str):
        """Acquire a refcounted symbol subscription (e.g. from /api/v1/market-depth/ws/oanda/{symbol})."""
        oanda_sym = self._to_oanda_instrument(symbol)
        if not oanda_sym:
            return
        self._subscriber_counts[oanda_sym] = self._subscriber_counts.get(oanda_sym, 0) + 1
        if oanda_sym not in self.active_symbols:
            logger.info(f"OandaStreamer: Adding symbol {oanda_sym} (from {symbol})")
            self._reconcile_active_symbols()

    def remove_symbol(self, symbol: str, force: bool = False):
        """Release a refcounted symbol subscription and stop streaming only when both WS & background loops release it."""
        oanda_sym = self._to_oanda_instrument(symbol)
        if not oanda_sym:
            return
        if force:
            self._subscriber_counts.pop(oanda_sym, None)
            self._bg_symbols.discard(oanda_sym)
        else:
            remaining = max(0, self._subscriber_counts.get(oanda_sym, 0) - 1)
            if remaining > 0:
                self._subscriber_counts[oanda_sym] = remaining
                return
            self._subscriber_counts.pop(oanda_sym, None)
        if oanda_sym in self.active_symbols and oanda_sym not in self._bg_symbols:
            logger.info(f"OandaStreamer: Removing symbol {oanda_sym}")
        self._reconcile_active_symbols()

    def _restart_stream(self):
        """Restart the connection when symbol list changes"""
        if self._running:
            if self._task:
                self._task.cancel()
            self._task = asyncio.create_task(self._stream_data())

    async def start(self):
        """Start the background service"""
        self._running = True
        self._task = asyncio.create_task(self._stream_data())
        logger.info("🟢 Oanda Streamer Started")

    async def stop(self):
        """Stop the background service"""
        self._running = False
        if self._task:
            self._task.cancel()
        if self._session:
            await self._session.close()
            self._session = None
        logger.info("🔴 Oanda Streamer Stopped")

    async def _stream_data(self):
        if not self.active_symbols:
            # Wait until there's a symbol to stream
            await asyncio.sleep(5)
            if self._running:
                self._task = asyncio.create_task(self._stream_data())
            return

        account_id = os.getenv("OANDA_ACCOUNT_ID")
        api_key = os.getenv("OANDA_API_KEY")

        if not account_id or not api_key:
            logger.warning("OandaStreamer: Missing API Keys. Cannot stream.")
            await asyncio.sleep(60)
            if self._running:
                self._task = asyncio.create_task(self._stream_data())
            return

        # Format symbols for OANDA: they already come in as EUR_USD
        oanda_instruments = [sym for sym in self.active_symbols]
        instruments_str = ",".join(oanda_instruments)

        url = f"https://stream-fxpractice.oanda.com/v3/accounts/{account_id}/pricing/stream?instruments={instruments_str}"
        headers = {"Authorization": f"Bearer {api_key}"}

        if not self._session:
            self._session = aiohttp.ClientSession()

        try:
            logger.info(f"OandaStreamer: Connecting to stream for {instruments_str}...")
            async with self._session.get(url, headers=headers) as response:
                if response.status != 200:
                    text = await response.text()
                    logger.error(f"OandaStreamer Connection Error: {response.status} {text}")
                    
                    if response.status == 400 and "Invalid Instrument" in text:
                        try:
                            error_data = json.loads(text)
                            error_msg = error_data.get("errorMessage", "")
                            if error_msg.startswith("Invalid Instrument "):
                                bad_sym_oanda = error_msg.replace("Invalid Instrument ", "").strip()
                                if bad_sym_oanda:
                                    logger.warning(f"Removing invalid instrument {bad_sym_oanda} from active_symbols.")
                                    self._subscriber_counts.pop(bad_sym_oanda, None)
                                    self._bg_symbols.discard(bad_sym_oanda)
                                    self.active_symbols.discard(bad_sym_oanda)
                        except Exception as e:
                            logger.error(f"Failed to parse Oanda error: {e}")

                    await asyncio.sleep(10)
                    if self._running:
                        self._task = asyncio.create_task(self._stream_data())
                    return

                logger.info("🔗 OandaStreamer Connected!")
                
                async for line in response.content:
                    if not line:
                        continue
                        
                    try:
                        data = json.loads(line)
                        if data.get("type") == "PRICE":
                            await self._process_price(data)
                    except json.JSONDecodeError:
                        pass
                    except Exception as e:
                        logger.error(f"OandaStreamer Processing Error: {e}")

        except asyncio.CancelledError:
            logger.info("OandaStreamer Connection Cancelled (Restarting/Stopping).")
        except Exception as e:
            logger.error(f"OandaStreamer Exception: {e}")
            await asyncio.sleep(5)
            if self._running:
                self._task = asyncio.create_task(self._stream_data())

    async def _process_price(self, data: Dict[str, Any]):
        try:
            oanda_sym = data.get("instrument")
            # Keep as EUR_USD to match WS subscription channel
            symbol = oanda_sym
            
            if symbol not in self.active_symbols:
                return

            bids = data.get("bids", [])
            asks = data.get("asks", [])
            
            if not bids or not asks:
                return
                
            bid_price = float(bids[0]["price"])
            ask_price = float(asks[0]["price"])
            mid_price = (bid_price + ask_price) / 2.0
            
            # For formatting trades, we determine if it's buy/sell based on previous price
            last_price = self._last_prices.get(symbol, mid_price)
            side = "buy" if mid_price >= last_price else "sell"
            self._last_prices[symbol] = mid_price

            time_str = data.get("time") # 2023-01-01T12:00:00.000Z
            dt = datetime.fromisoformat(time_str.replace('Z', '+00:00'))
            
            # --- 1. Broadcast Trade Event ---
            # OANDA doesn't give trade sizes in stream, so we mock a size of 1
            trade_event = [{
                "id": f"{int(dt.timestamp() * 1000)}",
                "time": dt.strftime('%H:%M:%S'),
                "price": round(mid_price, 5),
                "amount": 1.0,
                "type": side
            }]
            await manager.broadcast_market_data(symbol, "trade", trade_event)

            # --- 2. Broadcast Ticker Event ---
            ticker_data = {
                "symbol": symbol,
                "price": round(mid_price, 5),
                "change": 0.0, # We don't have 24h change easily from stream
                "changePercent": 0.0,
                "high": round(ask_price, 5),
                "low": round(bid_price, 5),
                "volume": 0.0,
                "timestamp": datetime.utcnow().isoformat()
            }
            await manager.broadcast_market_data(symbol, "ticker", ticker_data)

            # --- 3. Update Redis Cache & Stream ---
            redis = redis_manager.get_redis()
            if redis:
                # Update latest orderbook so /book and /heatmap endpoints get something instantly
                cache_ob = {
                    "bids": [{"price": bid_price, "size": float(bids[0].get("liquidity", 1000000))}],
                    "asks": [{"price": ask_price, "size": float(asks[0].get("liquidity", 1000000))}]
                }
                await redis.set(f"latest_orderbook:oanda:{symbol.upper()}", json.dumps(cache_ob))

                # Publish to market depth stream for live candle rendering
                channel = f"market_depth_stream:oanda:{symbol}"
                ts_ms = int(dt.timestamp() * 1000)
                ob_payload = {
                    "type": "orderbook",
                    "bids": [{"price": bid_price, "size": float(bids[0].get("liquidity", 1000000)), "total": float(bids[0].get("liquidity", 1000000))}],
                    "asks": [{"price": ask_price, "size": float(asks[0].get("liquidity", 1000000)), "total": float(asks[0].get("liquidity", 1000000))}],
                    "walls": [],
                    "currentPrice": round(mid_price, 5),
                    "midPrice": round(mid_price, 5),
                    "ts": ts_ms / 1000.0
                }

                trade_payload = {
                    "type": "trade",
                    "currentPrice": round(mid_price, 5),
                    "highPrice": round(ask_price, 5),
                    "lowPrice": round(bid_price, 5),
                    "recentVolume": 1.0,
                    "timestamp": ts_ms,
                    "side": side
                }
                await redis.publish(channel, json.dumps(ob_payload))
                await redis.publish(channel, json.dumps(trade_payload))

            try:
                await subminute_candle_recorder.record_trades(
                    exchange_id="oanda",
                    symbol=self._to_ui_symbol(symbol),
                    trades=[{
                        "timestamp": int(dt.timestamp() * 1000),
                        "price": round(mid_price, 5),
                        "amount": 1.0,
                    }],
                )
            except Exception as rec_err:
                logger.debug(f"OANDA SubminuteRecorder err: {rec_err}")

        except Exception as e:
            logger.error(f"Error processing OANDA price: {e}")

oanda_streamer = OandaStreamer()
