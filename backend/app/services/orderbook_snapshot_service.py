import asyncio
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from sqlalchemy import select, and_
from app.db.session import SessionLocal
from app.models.orderbook_snapshot import OrderBookSnapshot
from app.services.market_depth_service import market_depth_service
from app.services.websocket_manager import manager  # To know which symbols are active

logger = logging.getLogger(__name__)

class OrderbookSnapshotService:
    def __init__(self):
        self.running = False
        self.interval_seconds = 60 # Take snapshot every 60 seconds

    async def start_recording_loop(self):
        self.running = True
        logger.info("🚀 Starting Historcial Orderbook Snapshot recording loop...")
        while self.running:
            try:
                await self.record_snapshots()
            except asyncio.CancelledError:
                logger.info("Orderbook Snapshot loop cancelled.")
                break
            except Exception as e:
                logger.error(f"Error in Orderbook Snapshot loop: {e}")
            
            await asyncio.sleep(self.interval_seconds)

    async def stop_recording_loop(self):
        self.running = False

    async def record_snapshots(self):
        # We only take snapshots for symbols that have active websocket connections
        # OR you can hardcore top 5/10. For now, tracking active ones is most efficient.
        active_symbols = list(manager.active_connections.keys())
        
        # Filter out general/logs/backtest channels and internal pub-sub channels
        NON_MARKET_CHANNELS = {
            "general", "backtest", "block_trades", "dashboard",
            "options_live", "correlation_feed", "system_alerts", "container_logs",
            "training_visualizer"
        }
        symbols_to_record = set()
        for s in active_symbols:
            if (
                s not in NON_MARKET_CHANNELS
                and not s.startswith("logs_")
                and not s.startswith("status_")
                and not s.startswith("godmode_")
                and not s.startswith("user_notif_")
            ):
                symbols_to_record.add(s)

        if not symbols_to_record:
            return

        # 1. Fetch orderbooks asynchronously first (NEVER hold a DB connection open across network awaits)
        rows_to_insert: List[Dict[str, Any]] = []
        for symbol in symbols_to_record:
            try:
                data = await market_depth_service.fetch_raw_order_book(
                    symbol=symbol,
                    exchange_id='binance',
                    limit=100
                )

                if not data or not data.get("bids") or not data.get("asks"):
                    continue

                bids = data["bids"]
                asks = data["asks"]

                try:
                    best_bid = float(bids[0].get("price", bids[0][0] if isinstance(bids[0], (list, tuple)) else 0))
                    best_ask = float(asks[0].get("price", asks[0][0] if isinstance(asks[0], (list, tuple)) else 0))

                    bid_vol = sum([float(b.get("size", b[1] if isinstance(b, (list, tuple)) else 0)) for b in bids])
                    ask_vol = sum([float(a.get("size", a[1] if isinstance(a, (list, tuple)) else 0)) for a in asks])
                except (IndexError, AttributeError, ValueError, TypeError):
                    continue

                total_vol = bid_vol + ask_vol
                obi = bid_vol / total_vol if total_vol > 0 else 0.5
                spread = (best_ask - best_bid) / best_bid if best_bid > 0 else 0.0
                microprice = ((bid_vol * best_ask) + (ask_vol * best_bid)) / total_vol if total_vol > 0 else (best_bid + best_ask) / 2

                rows_to_insert.append({
                    "exchange": "binance",
                    "symbol": symbol,
                    "timestamp": datetime.utcnow(),
                    "bids": bids,
                    "asks": asks,
                    "obi": obi,
                    "spread": spread,
                    "microprice": microprice,
                })
            except Exception as e:
                logger.error(f"Failed to record orderbook snapshot for {symbol}: {e}")

        if not rows_to_insert:
            return

        # 2. Persist all snapshots in a single off-loop DB commit
        def _commit_sync(rows: List[Dict[str, Any]]) -> None:
            db = SessionLocal()
            try:
                db.bulk_save_objects([OrderBookSnapshot(**r) for r in rows])
                db.commit()
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()

        await asyncio.to_thread(_commit_sync, rows_to_insert)

    async def get_historical_snapshots(
        self, 
        symbol: str, 
        exchange: str, 
        start_time: datetime, 
        end_time: datetime,
        interval: str = "1m"
    ) -> List[Dict[str, Any]]:
        """
        Fetches historical snapshots off the event loop and downsamples by `interval` when requested.
        """
        norm_symbol = str(symbol or "").strip().upper()
        base_ex, _ = market_depth_service.normalize_exchange_id(exchange, norm_symbol)
        bucket_sec = max(1, market_depth_service._timeframe_to_seconds(interval))

        def _query_sync() -> List[Dict[str, Any]]:
            db = SessionLocal()
            try:
                query = select(OrderBookSnapshot).where(
                    and_(
                        OrderBookSnapshot.symbol == norm_symbol,
                        OrderBookSnapshot.exchange == base_ex,
                        OrderBookSnapshot.timestamp >= start_time,
                        OrderBookSnapshot.timestamp <= end_time
                    )
                ).order_by(OrderBookSnapshot.timestamp.asc())

                result = db.execute(query).scalars().all()
                if bucket_sec <= 60:
                    return [
                        {
                            "timestamp": record.timestamp.isoformat(),
                            "bids": record.bids,
                            "asks": record.asks
                        }
                        for record in result
                    ]

                # Keep the latest snapshot per interval bucket
                bucketed: Dict[int, Dict[str, Any]] = {}
                for record in result:
                    ts_sec = int(record.timestamp.timestamp())
                    b_key = (ts_sec // bucket_sec) * bucket_sec
                    bucketed[b_key] = {
                        "timestamp": record.timestamp.isoformat(),
                        "bids": record.bids,
                        "asks": record.asks
                    }
                return [bucketed[k] for k in sorted(bucketed.keys())]
            finally:
                db.close()

        return await asyncio.to_thread(_query_sync)


orderbook_snapshot_service = OrderbookSnapshotService()
