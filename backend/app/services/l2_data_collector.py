"""
Dynamic L2 Data Collector
=========================
- Automatically loads symbols from all is_auto_retrain=1 models in DB
- Supports both Binance Spot and Binance Futures (USDT-M) WebSocket streams
- Gracefully handles reconnection on disconnect
"""

import asyncio
import json
import websockets
import time
import logging
from app.db.session import SessionLocal
from app.models.orderbook_snapshot import OrderBookSnapshot

logger = logging.getLogger(__name__)


class L2DataCollector:
    # Binance WebSocket base URLs
    _SPOT_URL    = "wss://stream.binance.com:9443/stream"
    _FUTURES_URL = "wss://fstream.binance.com/stream"

    def __init__(self):
        self.spot_symbols: list[str]    = []   # e.g. ["btcusdt"]
        self.futures_symbols: list[str] = []   # e.g. ["dogeusdt"]
        self.running = False
        self._tasks: list[asyncio.Task] = []
        self._pending_rows: list[dict] = []
        self._max_pending_rows: int = 500

    # ── Symbol Helpers ─────────────────────────────────────────────────────

    @staticmethod
    def parse_symbol(raw: str) -> tuple[str, bool]:
        """
        Convert any ccxt-style symbol to (binance_stream_symbol, is_futures).
        Examples:
          "DOGE/USDT:USDT" → ("dogeusdt", True)
          "BTC/USDT:USDT"  → ("btcusdt",  True)
          "BTC/USDT"       → ("btcusdt",  False)
          "DOGEUSDT"       → ("dogeusdt", False)
        """
        is_futures = ":" in raw
        clean = raw.upper().split(":")[0].replace("/", "").lower()
        return clean, is_futures

    @staticmethod
    def _build_url(base: str, symbols: list[str]) -> str:
        """Build a Binance combined-stream URL for the given symbols using @aggTrade to avoid raw @trade frame floods."""
        streams = "/".join(f"{s}@depth20@100ms/{s}@aggTrade" for s in symbols)
        return f"{base}?streams={streams}"

    # ── DB Symbol Loader ───────────────────────────────────────────────────

    def load_symbols_from_db(self) -> tuple[list[str], list[str]]:
        """
        Query DB for ALL models in ML Registry and extract their symbols.
        Returns (spot_symbols, futures_symbols) as lowercase Binance stream names.
        """
        from app.models.ml_model import CustomMLModel, ModelVersion
        from app.models.model_training import ModelTrainingJob
        import os
        import json
        
        db = SessionLocal()
        spot, futures = [], []
        try:
            # ✅ ALL models — auto-retrain on OR off
            models = db.query(CustomMLModel).all()

            for m in models:
                raw = None
                
                # 1. Try from Training Job
                job = db.query(ModelTrainingJob).filter(
                    ModelTrainingJob.output_model_id == m.id
                ).order_by(ModelTrainingJob.created_at.desc()).first()
                
                if job and job.symbol:
                    raw = job.symbol
                
                # 2. Try from metadata.json
                if not raw and m.active_version_id:
                    v = db.query(ModelVersion).filter(ModelVersion.id == m.active_version_id).first()
                    if v and v.metadata_path and os.path.exists(v.metadata_path):
                        try:
                            with open(v.metadata_path, "r") as f:
                                meta = json.load(f)
                            raw = meta.get("symbol") or meta.get("target_asset") or meta.get("pair")
                        except Exception:
                            pass
                
                # 3. Fallback to name parsing
                if not raw:
                    raw = m.name.split(" ")[0] if " " in m.name else m.name

                stream_sym, is_fut = self.parse_symbol(str(raw))
                if not stream_sym:
                    continue
                target = futures if is_fut else spot
                if stream_sym not in target:
                    target.append(stream_sym)
                    logger.debug(
                        f"[L2Collector] {'Futures' if is_fut else 'Spot'} symbol "
                        f"from model '{m.name}': {stream_sym} (raw: {raw})"
                    )

            if not spot and not futures:
                logger.debug("[L2Collector] No models in ML Registry. Collector will stay idle.")

            return spot, futures
        except Exception as e:
            logger.error(f"[L2Collector] DB symbol load failed: {e}")
            return [], []
        finally:
            db.close()

    # ── Micro-Feature Calculator ───────────────────────────────────────────

    @staticmethod
    def calculate_micro_features(bids, asks) -> tuple[float, float, float]:
        if not bids or not asks:
            return 0.0, 0.0, 0.0
        try:
            best_bid = float(bids[0][0])
            best_ask = float(asks[0][0])
            spread   = best_ask - best_bid

            bid_vol = sum(float(b[1]) for b in bids[:10])
            ask_vol = sum(float(a[1]) for a in asks[:10])
            total   = bid_vol + ask_vol

            obi        = (bid_vol - ask_vol) / total if total > 0 else 0.0
            microprice = (best_bid * ask_vol + best_ask * bid_vol) / total if total > 0 \
                         else (best_bid + best_ask) / 2

            return obi, spread, microprice
        except Exception:
            return 0.0, 0.0, 0.0

    # ── DB Save (Batched & Offloaded off Event Loop) ───────────────────────

    @staticmethod
    def _flush_batch_sync(rows: list[dict]) -> None:
        if not rows:
            return
        db = SessionLocal()
        try:
            snaps = [OrderBookSnapshot(**r) for r in rows]
            db.bulk_save_objects(snaps)
            db.commit()
        except Exception as e:
            logger.error(f"[L2Collector] Batch DB save error ({len(rows)} rows): {e}")
            db.rollback()
        finally:
            db.close()

    async def _db_flush_loop(self) -> None:
        """Flush buffered L2 snapshots once per second in a worker thread (never blocks event loop)."""
        while self.running:
            try:
                await asyncio.sleep(1.0)
                if not self._pending_rows:
                    continue
                batch = self._pending_rows
                self._pending_rows = []
                await asyncio.to_thread(self._flush_batch_sync, batch)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[L2Collector] Flush loop error: {e}")

    def _enqueue_snapshot(self, symbol: str, bids, asks,
                          obi: float, spread: float, microprice: float,
                          trade_count: int, buy_volume: float, sell_volume: float, trade_price: float,
                          exchange: str) -> None:
        if len(self._pending_rows) >= self._max_pending_rows:
            # Drop oldest rows if DB lags so memory never grows unbounded
            self._pending_rows = self._pending_rows[-(self._max_pending_rows // 2):]
        self._pending_rows.append({
            "exchange": exchange,
            "symbol": symbol.upper(),
            "bids": bids[:20],
            "asks": asks[:20],
            "obi": obi,
            "spread": spread,
            "microprice": microprice,
            "trade_count": trade_count,
            "buy_volume": buy_volume,
            "sell_volume": sell_volume,
            "trade_price": trade_price,
        })

    async def _save_to_db(self, symbol: str, bids, asks,
                          obi: float, spread: float, microprice: float,
                          trade_count: int, buy_volume: float, sell_volume: float, trade_price: float,
                          exchange: str):
        """Backward-compatible async helper; offloads sync SQLAlchemy commit to a worker thread."""
        row = {
            "exchange": exchange,
            "symbol": symbol.upper(),
            "bids": bids[:20],
            "asks": asks[:20],
            "obi": obi,
            "spread": spread,
            "microprice": microprice,
            "trade_count": trade_count,
            "buy_volume": buy_volume,
            "sell_volume": sell_volume,
            "trade_price": trade_price,
        }
        await asyncio.to_thread(self._flush_batch_sync, [row])

    # ── Stream Runner ──────────────────────────────────────────────────────

    async def _run_stream(self, base_url: str, symbols: list[str], label: str):
        """Connect to a Binance combined WebSocket stream and persist snapshots."""
        url = self._build_url(base_url, symbols)
        last_save: dict[str, float] = {}
        trade_buffers: dict[str, dict] = {}

        def get_trade_buffer(sym: str) -> dict:
            if sym not in trade_buffers:
                trade_buffers[sym] = {"count": 0, "buy_vol": 0.0, "sell_vol": 0.0, "last_price": None}
            return trade_buffers[sym]

        while self.running:
            try:
                logger.debug(f"[L2Collector] [{label}] Connecting → {symbols}")
                async with websockets.connect(url, ping_interval=20, ping_timeout=30) as ws:
                    logger.debug(f"[L2Collector] [{label}] ✅ Connected.")

                    while self.running:
                        raw = await ws.recv()
                        data = json.loads(raw)

                        if "stream" not in data or "data" not in data:
                            continue

                        stream_name = data["stream"]
                        sym = stream_name.split("@")[0].upper()
                        payload = data["data"]

                        if "@trade" in stream_name or "@aggTrade" in stream_name:
                            # Aggregate trade
                            buf = get_trade_buffer(sym)
                            price = float(payload.get('p', 0))
                            qty = float(payload.get('q', 0))
                            is_buyer_maker = payload.get('m', False)

                            buf["count"] += 1
                            buf["last_price"] = price
                            if is_buyer_maker:
                                buf["sell_vol"] += qty
                            else:
                                buf["buy_vol"] += qty
                            continue

                        if "@depth" in stream_name:
                            bids = payload.get("bids", [])
                            asks = payload.get("asks", [])

                            try:
                                from app.metrics import L2_TICK_COUNT
                                L2_TICK_COUNT.labels(symbol=sym).inc()
                            except Exception:
                                pass

                            now = time.time()
                            # Rate-limit: 1 DB save per symbol per second
                            if sym not in last_save or (now - last_save[sym]) >= 1.0:
                                obi, spread, mp = self.calculate_micro_features(bids, asks)
                                
                                buf = get_trade_buffer(sym)
                                trade_count = buf["count"]
                                buy_vol = buf["buy_vol"]
                                sell_vol = buf["sell_vol"]
                                trade_price = buf["last_price"]

                                # Reset buffer for next second
                                buf["count"] = 0
                                buf["buy_vol"] = 0.0
                                buf["sell_vol"] = 0.0
                                # keep last_price as is in case there are no trades in next second
                                
                                self._enqueue_snapshot(
                                    sym, bids, asks, obi, spread, mp,
                                    trade_count, buy_vol, sell_vol, trade_price,
                                    label
                                )
                                last_save[sym] = now

            except asyncio.CancelledError:
                logger.info(f"[L2Collector] [{label}] Stream cancelled.")
                break
            except Exception as e:
                logger.warning(f"[L2Collector] [{label}] ⚠️ Stream error: {e}")
                if self.running:
                    await asyncio.sleep(5)   # Reconnect delay

    # ── Public API ─────────────────────────────────────────────────────────

    def start(self, spot_symbols: list[str] = None, futures_symbols: list[str] = None):
        """Start collector tasks for the given symbol lists."""
        self.running         = True
        self.spot_symbols    = spot_symbols if spot_symbols is not None else ["btcusdt"]
        self.futures_symbols = futures_symbols if futures_symbols is not None else []

        if not self.spot_symbols and not self.futures_symbols:
            logger.debug("[L2Collector] No symbols provided. Collector will stay idle.")
            self.running = False
            return

        if self.spot_symbols:
            t = asyncio.create_task(
                self._run_stream(self._SPOT_URL, self.spot_symbols, "Binance Spot")
            )
            self._tasks.append(t)

        if self.futures_symbols:
            t = asyncio.create_task(
                self._run_stream(self._FUTURES_URL, self.futures_symbols, "Binance Futures")
            )
            self._tasks.append(t)

        self._tasks.append(asyncio.create_task(self._db_flush_loop()))

        logger.debug(
            f"[L2Collector] Started — Spot: {self.spot_symbols} | "
            f"Futures: {self.futures_symbols}"
        )

    def stop(self):
        """Cancel all running stream tasks."""
        self.running = False
        for t in self._tasks:
            t.cancel()
        self._tasks.clear()
        logger.info("[L2Collector] Stopped.")

    def symbols_changed(self, new_spot: list[str], new_futures: list[str]) -> bool:
        """Return True if the symbol lists have changed."""
        return set(new_spot) != set(self.spot_symbols) or \
               set(new_futures) != set(self.futures_symbols)


# Global singleton
l2_collector = L2DataCollector()
