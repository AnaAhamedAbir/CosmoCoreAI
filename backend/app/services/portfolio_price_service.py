import asyncio
import logging
import ccxt.pro as ccxt
from typing import Dict, List, Set
from app.services.websocket_manager import manager
from app.services.ccxt_service import ccxt_service
from datetime import datetime

logger = logging.getLogger(__name__)

class PortfolioPriceService:
    def __init__(self):
        self.active_symbols: Dict[str, Set[str]] = {} # { exchange_id: {symbols} }
        self.exchange_clients: Dict[str, any] = {}
        self.running_task = None

    async def get_client(self, exchange_id: str):
        ex_key = exchange_id.lower()
        if ex_key not in self.exchange_clients:
            exchange_class = getattr(ccxt, ex_key, None)
            if exchange_class is None:
                return None
            client = exchange_class({
                'enableRateLimit': True,
                'options': {'adjustForTimeDifference': True}
            })
            # Copy pre-warmed markets from ccxt_service if available (0ms)
            prewarmed = ccxt_service._market_cache.get(f"{ex_key}_spot")
            if prewarmed and hasattr(client, 'set_markets'):
                try:
                    client.set_markets(prewarmed)
                except Exception:
                    await asyncio.wait_for(client.load_markets(), timeout=10.0)
            else:
                await asyncio.wait_for(client.load_markets(), timeout=10.0)
            self.exchange_clients[ex_key] = client
        return self.exchange_clients[ex_key]

    def update_active_symbols(self, symbols_by_exchange: Dict[str, List[str]]):
        for ex, symbols in symbols_by_exchange.items():
            if ex not in self.active_symbols:
                self.active_symbols[ex] = set()
            self.active_symbols[ex].update(symbols)

    async def start(self):
        if self.running_task and not self.running_task.done():
            return
        self.running_task = asyncio.create_task(self._price_loop())
        logger.info("🚀 Portfolio Price Service Started")

    async def stop(self):
        if self.running_task:
            self.running_task.cancel()
            self.running_task = None
        for client in self.exchange_clients.values():
            await client.close()
        self.exchange_clients.clear()

    async def _price_loop(self):
        while True:
            try:
                # 1. Determine which symbols are actually being watched
                # For now, we fetch for ALL symbols that ANY active portfolio client needs
                # But only if there are active connections to the "portfolio_prices" channel
                if "portfolio_prices" not in manager.active_connections:
                    await asyncio.sleep(5)
                    continue

                for exchange_id, symbols in list(self.active_symbols.items()):
                    if not symbols:
                        continue
                    
                    try:
                        client = await self.get_client(exchange_id)
                        if not client or not getattr(client, 'has', {}).get('watchTickers'):
                            continue
                        # Fetch multiple tickers at once to minimize API calls
                        symbol_list = list(symbols)
                        
                        # Filtering symbols that exist in market
                        valid_symbols = [s for s in symbol_list if s in (client.markets or {})]
                        
                        if not valid_symbols:
                            continue

                        # Use WebSocket instead of REST API to avoid IP Bans
                        tickers = await asyncio.wait_for(client.watch_tickers(valid_symbols), timeout=15.0)
                        
                        updates = {}
                        for sym, t in tickers.items():
                            updates[sym] = {
                                "price": t.get('last'),
                                "change": t.get('percentage'),
                                "timestamp": datetime.utcnow().isoformat()
                            }
                        
                        if updates:
                            await manager.broadcast({
                                "type": "portfolio_price_update",
                                "exchange": exchange_id,
                                "prices": updates
                            }, "portfolio_prices")
                            
                    except asyncio.TimeoutError:
                        continue
                    except Exception as e:
                        logger.error(f"Error fetching prices for {exchange_id}: {e}")
                
                # Small delay to yield loop context, watch_tickers blocks until new data anyway
                await asyncio.sleep(1)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Portfolio Price Loop Error: {e}")
                await asyncio.sleep(10)

portfolio_price_service = PortfolioPriceService()
