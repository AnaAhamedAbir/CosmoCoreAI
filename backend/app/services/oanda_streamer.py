import os
import json
import asyncio
import logging
from datetime import datetime
import aiohttp
from typing import Set, Dict, Any

from app.services.websocket_manager import manager
from app.core.redis import redis_manager

logger = logging.getLogger(__name__)

class OandaStreamer:
    def __init__(self):
        self.active_symbols: Set[str] = set()
        self._task = None
        self._session = None
        self._running = False
        self._last_prices: Dict[str, float] = {}

    def add_symbol(self, symbol: str):
        """Add a symbol (e.g. EUR/USD) to the streaming list"""
        if symbol not in self.active_symbols:
            logger.info(f"OandaStreamer: Adding symbol {symbol}")
            self.active_symbols.add(symbol)
            # Restart stream to include new symbol
            self._restart_stream()

    def remove_symbol(self, symbol: str):
        """Remove a symbol from the streaming list"""
        if symbol in self.active_symbols:
            logger.info(f"OandaStreamer: Removing symbol {symbol}")
            self.active_symbols.remove(symbol)
            self._restart_stream()

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
                                bad_sym = bad_sym_oanda
                                if bad_sym in self.active_symbols:
                                    logger.warning(f"Removing invalid instrument {bad_sym} from active_symbols.")
                                    self.active_symbols.remove(bad_sym)
                                elif bad_sym_oanda in self.active_symbols:
                                    logger.warning(f"Removing invalid instrument {bad_sym_oanda} from active_symbols.")
                                    self.active_symbols.remove(bad_sym_oanda)
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

            # --- 3. Update Redis Cache ---
            redis = redis_manager.get_redis()
            if redis:
                # Update latest orderbook so /book and /heatmap endpoints get something instantly
                cache_ob = {
                    "bids": [{"price": bid_price, "size": float(bids[0].get("liquidity", 1000000))}],
                    "asks": [{"price": ask_price, "size": float(asks[0].get("liquidity", 1000000))}]
                }
                await redis.set(f"latest_orderbook:oanda:{symbol.upper()}", json.dumps(cache_ob))

        except Exception as e:
            logger.error(f"Error processing OANDA price: {e}")

oanda_streamer = OandaStreamer()
