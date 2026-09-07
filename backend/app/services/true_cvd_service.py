import asyncio
import logging
import time
from typing import Dict, Any, Callable, Awaitable, List

import ccxt.pro as ccxtpro
from ccxt.base.errors import NetworkError

logger = logging.getLogger(__name__)

class TrueCVDService:
    """
    Modular, institutional-grade service for calculating True CVD 
    (Cumulative Volume Delta) and detecting hidden Iceberg/Absorption orders.
    """
    def __init__(self, absorption_threshold_usd: float = 100_000.0, time_window_sec: int = 60):
        self._running = False
        self._callbacks: List[Callable[[Dict[str, Any]], Awaitable[None]]] = []
        
        # Configuration
        self.absorption_threshold_usd = absorption_threshold_usd
        self.time_window_sec = time_window_sec
        self.exchange: ccxtpro.Exchange = None
        self._active_tasks = []
        
        # Internal State
        self.symbol = ""
        self.current_cvd = 0.0
        self._trade_history = []
        
        # For Iceberg Detection
        self._last_price = 0.0
        self._window_start_price = 0.0

    def register_callback(self, callback: Callable[[Dict[str, Any]], Awaitable[None]]):
        if callback not in self._callbacks:
            self._callbacks.append(callback)

    def remove_callback(self, callback: Callable[[Dict[str, Any]], Awaitable[None]]):
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    async def _init_exchange(self, ex_id: str = 'binance'):
        if self.exchange is None:
            ex_class = getattr(ccxtpro, ex_id)
            self.exchange = ex_class({
                'enableRateLimit': True,
                'newUpdates': True,
                'options': {'defaultType': 'swap'}
            })
        return self.exchange

    async def _watch_trades(self):
        """Streams live market trades and calculates True CVD delta"""
        exchange = await self._init_exchange('binance')
        logger.info(f"TrueCVD: Started streaming live trades for {self.symbol}")
        
        self._window_start_price = 0.0
        
        while self._running:
            try:
                trades = await exchange.watch_trades(self.symbol)
                now = time.time()
                
                if not isinstance(trades, list):
                    trades = [trades]
                    
                for trade in trades:
                    price = float(trade.get('price', 0))
                    amount = float(trade.get('amount', 0))
                    side = trade.get('side', '') # 'buy' or 'sell'
                    
                    if price <= 0 or amount <= 0 or not side:
                        continue
                        
                    usd_value = price * amount
                    
                    if self._window_start_price == 0.0:
                        self._window_start_price = price
                        
                    self._last_price = price
                    
                    # Update CVD
                    if side == 'buy':
                        self.current_cvd += usd_value
                    elif side == 'sell':
                        self.current_cvd -= usd_value
                        
                    self._trade_history.append({"time": now, "side": side, "value": usd_value, "price": price})
                    
            except NetworkError as e:
                logger.warning(f"TrueCVD network err: {e}")
                await asyncio.sleep(5)
            except Exception as e:
                logger.debug(f"TrueCVD watch_trades err: {e}")
                await asyncio.sleep(5)

    async def _analyze_absorption_loop(self):
        """Analyzes the aggregated trades to detect Iceberg walls"""
        while self._running:
            try:
                now = time.time()
                
                # Clean old trades outside the window
                self._trade_history = [t for t in self._trade_history if now - t["time"] <= self.time_window_sec]
                
                # Recalculate window volumes to be accurate
                buy_vol = sum(t["value"] for t in self._trade_history if t["side"] == 'buy')
                sell_vol = sum(t["value"] for t in self._trade_history if t["side"] == 'sell')
                
                # Determine start price of the current active window
                if self._trade_history:
                    start_price = self._trade_history[0]["price"]
                else:
                    start_price = self._last_price
                    
                if start_price > 0 and self._last_price > 0:
                    price_change_pct = (self._last_price - start_price) / start_price * 100
                    
                    event = None
                    
                    # Bearish Absorption: Massive buying, but price doesn't go up (<= 0.05%)
                    if buy_vol >= self.absorption_threshold_usd and price_change_pct <= 0.05:
                        event = {
                            "type": "BEARISH_ABSORPTION",
                            "price": self._last_price,
                            "absorbed_volume": round(buy_vol),
                            "msg": f"[{self.symbol}] 🛡️ Bearish Iceberg: ${buy_vol/1000000:.1f}M buying absorbed at {self._last_price}!",
                            "timestamp": int(now * 1000)
                        }
                    
                    # Bullish Absorption: Massive selling, but price doesn't go down (>= -0.05%)
                    elif sell_vol >= self.absorption_threshold_usd and price_change_pct >= -0.05:
                        event = {
                            "type": "BULLISH_ABSORPTION",
                            "price": self._last_price,
                            "absorbed_volume": round(sell_vol),
                            "msg": f"[{self.symbol}] 🛡️ Bullish Iceberg: ${sell_vol/1000000:.1f}M selling absorbed at {self._last_price}!",
                            "timestamp": int(now * 1000)
                        }
                        
                    # Dispatch to callbacks
                    payload = {
                        "symbol": self.symbol,
                        "true_cvd": round(self.current_cvd),
                        "iceberg_event": event
                    }
                    
                    for cb in self._callbacks:
                        try:
                            await cb(payload)
                        except Exception as e:
                            logger.error(f"TrueCVD Callback err: {e}")
                            
            except Exception as e:
                logger.error(f"TrueCVD analysis err: {e}")
                
            # Analyze every second
            await asyncio.sleep(1)

    async def start(self, symbol: str):
        if self._running:
            if self.symbol == symbol:
                return
            await self.stop()
            
        self._running = True
        self.symbol = symbol
        self.current_cvd = 0.0
        self._trade_history = []
        
        logger.info(f"TrueCVD Service initializing for {symbol}")
        
        self._active_tasks.append(asyncio.create_task(self._watch_trades()))
        self._active_tasks.append(asyncio.create_task(self._analyze_absorption_loop()))

    async def stop(self):
        self._running = False
        for task in self._active_tasks:
            task.cancel()
        
        if self.exchange:
            await self.exchange.close()
            self.exchange = None
            
        self._active_tasks.clear()
        self._trade_history = []
        logger.info("TrueCVD Service stopped.")

# Global Singleton
true_cvd_service = TrueCVDService()
