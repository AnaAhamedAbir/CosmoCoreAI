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
            ):
                symbols_to_record.add(s)

        if not symbols_to_record:
            return

        db = SessionLocal()
        try:
            for symbol in symbols_to_record:
                # 1. Fetch current orderbook snapshot. 
                # We use the existing heatmap service which is optimized and cached.
                # exchange is always 'binance' by default in the system based on other workers
                try:
                    # Fetch raw orderbook instead of bucketed heatmap to preserve microstructural integrity
                    data = await market_depth_service.fetch_raw_order_book(
                        symbol=symbol,
                        exchange_id='binance',
                        limit=100
                    )
                    
                    if not data or not data.get("bids") or not data.get("asks"):
                        continue
                        
                    bids = data["bids"]
                    asks = data["asks"]
                    
                    # Normalize formats (some ccxt versions return lists, some dicts for fetch_raw_order_book)
                    # market_depth_service returns dicts {"price": ..., "size": ...}
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
                    
                    # 2. Save to database
                    snapshot = OrderBookSnapshot(
                        exchange='binance',
                        symbol=symbol,
                        timestamp=datetime.utcnow(),
                        bids=bids,
                        asks=asks,
                        obi=obi,
                        spread=spread,
                        microprice=microprice
                    )
                    db.add(snapshot)
                
                except Exception as e:
                    logger.error(f"Failed to record orderbook snapshot for {symbol}: {e}")
            
            # Commit all chunks at once
            db.commit()
            
        finally:
            db.close()

    async def get_historical_snapshots(
        self, 
        symbol: str, 
        exchange: str, 
        start_time: datetime, 
        end_time: datetime,
        interval: str = "1m"
    ) -> List[Dict[str, Any]]:
        """
        Fetches historical snapshots.
        If interval is high, we might want to sample. For now, we return all records 
        within the range since we record exactly every interval_seconds.
        """
        db = SessionLocal()
        try:
            query = select(OrderBookSnapshot).where(
                and_(
                    OrderBookSnapshot.symbol == symbol,
                    OrderBookSnapshot.exchange == exchange,
                    OrderBookSnapshot.timestamp >= start_time,
                    OrderBookSnapshot.timestamp <= end_time
                )
            ).order_by(OrderBookSnapshot.timestamp.asc())
            
            result = db.execute(query).scalars().all()
            
            formatted_data = []
            for record in result:
                formatted_data.append({
                    "timestamp": record.timestamp.isoformat(),
                    "bids": record.bids,
                    "asks": record.asks
                })
                
            return formatted_data
        finally:
            db.close()


orderbook_snapshot_service = OrderbookSnapshotService()
