import asyncio
import logging
import time
import math
from typing import Dict, Any, Callable, Awaitable, List

import ccxt.pro as ccxtpro
from ccxt.base.errors import NetworkError

from app.services.true_cvd_service import true_cvd_service

logger = logging.getLogger(__name__)

class GodModeService:
    """
    Advanced mathematical service for God Mode Liquidation Map.
    Handles multi-exchange streams, heuristic AI modeling, and orderbook aggregation.
    """
    def __init__(self):
        self._running = False
        self._callbacks: List[Callable[[Dict[str, Any]], Awaitable[None]]] = []
        self._lock = asyncio.Lock()
        
        self.exchanges: Dict[str, ccxtpro.Exchange] = {}
        
        # Centralized State Object that will be broadcasted every second
        self.state = {
            "symbol": "BTC/USDT",
            "vulnerability": [],
            "pain_threshold": {"level": 0, "status": "NORMAL", "value": 0},
            "smart_money": 50,
            "dumb_money": 50,
            "cvd_spoof": "NEUTRAL",
            "whale_feed": [],
            "magnet_zones": [],
            "smoothed_zones": [],
            "spoofed_zones": [],
            "cascade_probs": [],
            "trailing_liquidity": {"long_level": 0, "short_level": 0, "long_intensity": 0, "short_intensity": 0},
            "ai_trajectory": {"target_price": 0, "strength": 0, "direction": "NEUTRAL"},
            "current_price": 0,
            "true_cvd": 0,
            "iceberg_events": [],
            "arbitrage": []
        }
        self._last_prices = {}
        self._max_volumes = {}    
        # Internal states for calculations
        self._smoothed_zones_dict = {}
        self._trailing_long = 0.0
        self._trailing_short = 0.0
        self._liq_history_1m = []
        self._smart_vol = 0.0
        self._dumb_vol = 0.0
        self._active_tasks = []
        self._last_prices = {"binance": 0.0, "bybit": 0.0, "okx": 0.0, "bitget": 0.0}

    def register_callback(self, callback: Callable[[Dict[str, Any]], Awaitable[None]]):
        if callback not in self._callbacks:
            self._callbacks.append(callback)

    def remove_callback(self, callback: Callable[[Dict[str, Any]], Awaitable[None]]):
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    async def _handle_true_cvd_event(self, payload: Dict[str, Any]):
        """Receives updates from the modular True CVD service"""
        self.state["true_cvd"] = payload.get("true_cvd", 0)
        
        iceberg_event = payload.get("iceberg_event")
        if iceberg_event:
            # Keep only the last 10 iceberg events in state
            self.state["iceberg_events"].insert(0, iceberg_event)
            if len(self.state["iceberg_events"]) > 10:
                self.state["iceberg_events"].pop()
                
            # If a massive iceberg is detected, override cvd_spoof proxy state to give absolute certainty
            if "BEARISH" in iceberg_event["type"]:
                self.state["cvd_spoof"] = "DETECTED: HIGH RISK"
            elif "BULLISH" in iceberg_event["type"]:
                self.state["cvd_spoof"] = "DETECTED: HIGH RISK"

    async def _broadcast_loop(self):
        """Continuously broadcasts the aggregated state to all connected websockets at roughly 10Hz"""
        while self._running:
            if self._callbacks:
                for cb in self._callbacks:
                    try:
                        await cb(self.state)
                    except Exception as e:
                        logger.error(f"God Mode Callback err: {e}")
            await asyncio.sleep(0.5)

    async def _init_exchange(self, ex_id: str) -> ccxtpro.Exchange:
        if ex_id not in self.exchanges:
            options = {}
            if ex_id in ['binance', 'okx', 'bitget']:
                options['defaultType'] = 'swap'
            elif ex_id == 'bybit':
                options['defaultType'] = 'linear'
                
            ex_class = getattr(ccxtpro, ex_id)
            self.exchanges[ex_id] = ex_class({
                'enableRateLimit': True,
                'newUpdates': True,
                'options': options
            })
        return self.exchanges[ex_id]

    async def _watch_liquidations(self, ex_id: str, symbol: str):
        exchange = await self._init_exchange(ex_id)
        logger.info(f"GodMode: Started {ex_id} liquidation stream for {symbol}")
        
        while self._running:
            try:
                liquidations = await exchange.watch_liquidations(symbol)
                if not isinstance(liquidations, list):
                    liquidations = [liquidations]

                for liq in liquidations:
                    await self._process_liquidation(ex_id, symbol, liq)

            except NetworkError as e:
                logger.warning(f"GodMode network err {ex_id}: {e}")
                await asyncio.sleep(5)
            except Exception as e:
                # Some exchanges don't support it, handle gracefully
                logger.debug(f"GodMode watch_liq err {ex_id}: {e}")
                await asyncio.sleep(5)
                
    async def _watch_ticker_for_arb(self, ex_id: str, symbol: str):
        exchange = await self._init_exchange(ex_id)
        while self._running:
            try:
                ticker = await exchange.watch_ticker(symbol)
                price = getattr(ticker, 'last', ticker.get('last'))
                if price:
                    self._last_prices[ex_id] = float(price)
                    if ex_id == 'binance':
                        self.state['current_price'] = float(price)
            except Exception as e:
                await asyncio.sleep(5)

    async def _process_liquidation(self, ex_id: str, symbol: str, liq: dict):
        price = float(liq.get('price', 0))
        amount = float(liq.get('amount') or liq.get('contracts', 0))
        usd_value = float(liq.get('quoteValue') or (price * amount))
        side = liq.get('side', '').lower()
        liq_type = "Long Rekt" if side == "sell" else "Short Rekt"
        
        if usd_value <= 0:
            return

        self.state['current_price'] = price
        now = time.time()
        
        # 1. Update rolling history
        is_smart = usd_value > 50000
        self._liq_history_1m.append({"time": now, "value": usd_value, "is_smart": is_smart})

        # 3. Whale Kill Feed
        if is_smart and usd_value > 100000:
            whale_event = {
                "type": liq_type,
                "value": round(usd_value),
                "price": price,
                "timestamp": now * 1000, # ms for lightweight-charts
                "time": "Just now",
                "exchange": ex_id
            }
            self.state["whale_feed"].insert(0, whale_event)
            if len(self.state["whale_feed"]) > 20: # keep latest 20
                self.state["whale_feed"].pop()

    async def _scan_global_vulnerabilities(self):
        """Scans the entire market for highly volatile/vulnerable coins"""
        exchange = await self._init_exchange('binance')
        
        # Start a background task to continuously update the websocket ticker stream
        async def _keep_tickers_updated():
            while self._running:
                try:
                    await exchange.watch_tickers()
                except Exception as e:
                    await asyncio.sleep(5)
        
        ticker_task = asyncio.create_task(_keep_tickers_updated())
        self._active_tasks.append(ticker_task)

        while self._running:
            try:
                # Use the continuously updated websocket cache instead of REST calls
                tickers = exchange.tickers
                
                if not tickers:
                    await asyncio.sleep(5)
                    continue
                
                candidates = []
                for sym, data in tickers.items():
                    if ('USDT' in sym) and data.get('percentage') is not None:
                        base_coin = sym.split('/')[0].replace(':USDT', '')
                        pct_change = abs(data['percentage'])
                        quote_vol = float(data.get('quoteVolume', 0))
                        
                        if quote_vol > 50_000_000 and base_coin not in ['USDC', 'FDUSD', 'TUSD', 'USDT']:
                            raw_pct = float(data['percentage'])
                            candidates.append({
                                "coin": base_coin,
                                "risk": min(99, round(pct_change * 4.5)),
                                "est_liq": round((quote_vol * (pct_change / 100)) / 10_000_000, 1),
                                "side": "SHORTS" if raw_pct > 0 else "LONGS"
                            })
                
                candidates.sort(key=lambda x: x['risk'], reverse=True)
                
                if candidates:
                    self.state["vulnerability"] = candidates[:7]
                    
            except Exception as e:
                logger.error(f"Global vulnerability scan error: {e}")
                
            await asyncio.sleep(60)

    async def _watch_orderbook_loop(self, ex_id: str, symbol: str):
        """Scans real-time orderbook to find high-leverage clusters (Predictive Heatmap)"""
        exchange = await self._init_exchange(ex_id)
        logger.info(f"GodMode: Started {ex_id} orderbook stream for {symbol} heatmap")
        
        while self._running:
            try:
                # Get L2 Depth
                orderbook = await exchange.watch_order_book(symbol)
                cp = self.state['current_price']
                
                if cp > 0 and orderbook:
                    bids = orderbook.get('bids', [])
                    asks = orderbook.get('asks', [])
                    
                    if bids and asks:
                        # Focus on liquidity within 5% of current price (100x and 50x liquidations)
                        bids_within_range = [b for b in bids if b[0] >= cp * 0.95]
                        asks_within_range = [a for a in asks if a[0] <= cp * 1.05]
                        
                        if not bids_within_range or not asks_within_range:
                            await asyncio.sleep(1)
                            continue
                            
                        # Find top 5 liquidity spikes (volume) on both sides
                        top_bids = sorted(bids_within_range, key=lambda x: x[1], reverse=True)[:5]
                        top_asks = sorted(asks_within_range, key=lambda x: x[1], reverse=True)[:5]
                        
                        max_bid_vol = max(top_bids, key=lambda x: x[1])[1] if top_bids else 1
                        max_ask_vol = max(top_asks, key=lambda x: x[1])[1] if top_asks else 1
                        
                        magnet_zones = []
                        cascade_probs = []
                        
                        # Process Asks (Short Liquidations / Resistance)
                        for ask in top_asks:
                            price, vol = float(ask[0]), float(ask[1])
                            intensity = min(100, int((vol / max_ask_vol) * 100))
                            if intensity > 30: # Only add significant clusters
                                magnet_zones.append({"price": price, "intensity": intensity, "volume": vol})
                                dist = abs(price - cp) / cp
                                prob = min(99, int((1 - (dist * 20)) * intensity))
                                cascade_probs.append({"price": price, "prob": max(10, prob), "volume": vol})
                                
                        # Process Bids (Long Liquidations / Support)
                        for bid in top_bids:
                            price, vol = float(bid[0]), float(bid[1])
                            intensity = min(100, int((vol / max_bid_vol) * 100))
                            if intensity > 30:
                                magnet_zones.append({"price": price, "intensity": intensity, "volume": vol})
                                dist = abs(price - cp) / cp
                                prob = min(99, int((1 - (dist * 20)) * intensity))
                                cascade_probs.append({"price": price, "prob": max(10, prob), "volume": vol})
                                
                        # --- Time-Weighted Liquidity Smoothing (TWLS) ---
                        ALPHA = 0.15 # EMA Smoothing factor
                        current_volumes = {}
                        for ask in top_asks:
                            p, v = float(ask[0]), float(ask[1])
                            if v > max_ask_vol * 0.1: current_volumes[p] = v
                        for bid in top_bids:
                            p, v = float(bid[0]), float(bid[1])
                            if v > max_bid_vol * 0.1: current_volumes[p] = v
                            
                        for p, v in current_volumes.items():
                            if p in self._smoothed_zones_dict:
                                self._smoothed_zones_dict[p] = (v * ALPHA) + (self._smoothed_zones_dict[p] * (1 - ALPHA))
                            else:
                                self._smoothed_zones_dict[p] = v
                                
                        keys_to_remove = []
                        for p in self._smoothed_zones_dict:
                            if p not in current_volumes:
                                self._smoothed_zones_dict[p] *= (1 - ALPHA)
                                if self._smoothed_zones_dict[p] < 5000:
                                    keys_to_remove.append(p)
                        for k in keys_to_remove: del self._smoothed_zones_dict[k]
                        
                        smoothed_zones = []
                        for p, v in self._smoothed_zones_dict.items():
                            ref_max = max_ask_vol if p > cp else max_bid_vol
                            intensity = min(100, int((v / (ref_max + 1)) * 100))
                            if intensity > 20:
                                smoothed_zones.append({"price": p, "intensity": intensity, "volume": v})
                               
                                
                        # Calculate Magnetic Liquidity Pull Vector (AI Trajectory)
                        ask_weight = sum(z["volume"] for z in magnet_zones if z["price"] > cp)
                        bid_weight = sum(z["volume"] for z in magnet_zones if z["price"] < cp)
                        
                        trajectory = {"target_price": cp, "strength": 0, "direction": "NEUTRAL"}
                        if ask_weight > bid_weight * 1.1:
                            trajectory["direction"] = "UP"
                            trajectory["strength"] = min(100, int((ask_weight / (bid_weight + 1)) * 30))
                            target = max((z for z in magnet_zones if z["price"] > cp), key=lambda x: x["volume"], default=None)
                            if target: trajectory["target_price"] = target["price"]
                        elif bid_weight > ask_weight * 1.1:
                            trajectory["direction"] = "DOWN"
                            trajectory["strength"] = min(100, int((bid_weight / (ask_weight + 1)) * 30))
                            target = max((z for z in magnet_zones if z["price"] < cp), key=lambda x: x["volume"], default=None)
                            if target: trajectory["target_price"] = target["price"]
                            
                        # --- Dynamic Trailing Liquidity Cloud (DTLC) ---
                        # Trail up for longs (support below price)
                        target_long_trail = cp * 0.985 # approx 1.5% trail
                        if self._trailing_long == 0.0 or target_long_trail > self._trailing_long:
                            # Smoothly catch up
                            self._trailing_long += (target_long_trail - self._trailing_long) * 0.1
                        if cp < self._trailing_long: # Price broke support
                            self._trailing_long = target_long_trail
                            
                        # Trail down for shorts (resistance above price)
                        target_short_trail = cp * 1.015
                        if self._trailing_short == 0.0 or target_short_trail < self._trailing_short:
                            self._trailing_short += (target_short_trail - self._trailing_short) * 0.1
                        if cp > self._trailing_short: # Price broke resistance
                            self._trailing_short = target_short_trail
                            
                        self.state["trailing_liquidity"] = {
                            "long_level": round(self._trailing_long, 4),
                            "short_level": round(self._trailing_short, 4),
                            "long_intensity": min(100, max(20, int((bid_weight / 500000) * 100))),
                            "short_intensity": min(100, max(20, int((ask_weight / 500000) * 100)))
                        }
                            
                        # --- Spoofing / Order Pulling Detection ---
                        now_ts = time.time()
                        
                        raw_volumes = {}
                        for b in bids_within_range: raw_volumes[float(b[0])] = float(b[1])
                        for a in asks_within_range: raw_volumes[float(a[0])] = float(a[1])
                        
                        for p, v in raw_volumes.items():
                            usd_vol = v * cp
                            if usd_vol > 100000: # Track only orders > $100k
                                if p in self._max_volumes:
                                    self._max_volumes[p] = max(self._max_volumes[p], usd_vol)
                                else:
                                    self._max_volumes[p] = usd_vol

                        for p in list(self._max_volumes.keys()):
                            # Only evaluate if still within the 5% window
                            if cp * 0.95 <= p <= cp * 1.05:
                                current_usd_vol = raw_volumes.get(p, 0) * cp
                                max_usd_vol = self._max_volumes[p]
                                
                                # If volume dropped by >80% without price getting near it
                                if current_usd_vol < max_usd_vol * 0.2:
                                    dist = abs(p - cp) / cp
                                    if dist > 0.002: # 0.2% away, wasn't executed
                                        self.state["spoofed_zones"].append({
                                            "price": p,
                                            "volume": max_usd_vol,
                                            "timestamp": now_ts,
                                            "type": "SPOOF"
                                        })
                                    del self._max_volumes[p]
                            else:
                                # Price moved out of the 5% window, stop tracking
                                del self._max_volumes[p]

                        # Clean up old spoofed zones (keep for 120s max)
                        self.state["spoofed_zones"] = [z for z in self.state["spoofed_zones"] if now_ts - z["timestamp"] < 120]
                            
                        self.state["magnet_zones"] = magnet_zones
                        self.state["smoothed_zones"] = smoothed_zones
                        self.state["cascade_probs"] = cascade_probs
                        self.state["ai_trajectory"] = trajectory
                        
            except NetworkError:
                await asyncio.sleep(5)
            except Exception as e:
                logger.debug(f"GodMode orderbook err: {e}")
                await asyncio.sleep(5)

    async def _calculate_heuristics_loop(self, symbol: str):
        """Background loop that recalculates math models using active streams"""
        exchange = await self._init_exchange('binance')
        
        # Ensure array exists before first scan completes
        if "vulnerability" not in self.state or not self.state["vulnerability"]:
            self.state["vulnerability"] = []
        
        while self._running:
            try:
                now = time.time()
                
                # --- A. Clean old pain threshold data (keep 5 minutes for gauge, 60s for smart money) ---
                self._liq_history_1m = [x for x in self._liq_history_1m if now - x["time"] < 300]
                
                # We calculate pain using the 5-minute rolling window
                pain_value = sum(x["value"] for x in self._liq_history_1m)
                
                # Map pain value to 0-100 gauge
                # $1M liquidations over 5 minutes is 100% Extreme
                gauge_level = min(100, (pain_value / 1_000_000) * 100)
                status = "NORMAL"
                if gauge_level > 80: status = "EXTREME"
                elif gauge_level > 50: status = "HIGH"
                
                self.state["pain_threshold"] = {
                    "level": round(gauge_level),
                    "status": status,
                    "value": round(pain_value)
                }

                # --- Smart vs Dumb Money (Rolling 60s for faster reaction) ---
                recent_60s = [x for x in self._liq_history_1m if now - x["time"] < 60]
                smart_sum = sum(x["value"] for x in recent_60s if x["is_smart"])
                dumb_sum = sum(x["value"] for x in recent_60s if not x["is_smart"])
                total_sum = smart_sum + dumb_sum
                
                if total_sum > 0:
                    self.state["smart_money"] = round((smart_sum / total_sum) * 100)
                    self.state["dumb_money"] = 100 - self.state["smart_money"]
                else:
                    self.state["smart_money"] = 50
                    self.state["dumb_money"] = 50

                # --- B. Cross-Exchange Arbitrage (Multi-Exchange) ---
                valid_prices = {ex: p for ex, p in self._last_prices.items() if p > 0}
                
                if len(valid_prices) >= 2:
                    min_ex = min(valid_prices, key=valid_prices.get)
                    max_ex = max(valid_prices, key=valid_prices.get)
                    min_price = valid_prices[min_ex]
                    max_price = valid_prices[max_ex]
                    
                    diff_usd = max_price - min_price
                    diff_pct = (diff_usd / min_price) * 100
                    
                    if diff_pct > 0.05: # Significant diff
                        target_str = f"{max_ex.capitalize()} -> {min_ex.capitalize()}"
                        
                        # Add a synthetic arb record
                        arb_event = {
                            "pair": symbol.split('/')[0],
                            "diff": round(diff_pct, 2),
                            "vol": str(round(pain_value/1000000, 1)) + "M",
                            "target": target_str
                        }
                        self.state["arbitrage"] = [arb_event]
                    else:
                        self.state["arbitrage"] = []

                # --- C. CVD Spoofing (Advanced Math heuristic) ---
                # If Pain is EXTREME (>80) but price moving opposite, trigger alert
                # This requires an actual CVD stream, but we use a mathematical proxy here
                if gauge_level > 85 and len(self.state["whale_feed"]) > 0:
                    self.state["cvd_spoof"] = "DETECTED: HIGH RISK"
                else:
                    self.state["cvd_spoof"] = "NEGATIVE"

                # --- D. Heuristic AI Cascade Models / Magnet Zones ---
                # This is now populated by the real _watch_orderbook_loop task based on real L2 depth!
                # We do not mock it anymore.

            except Exception as e:
                logger.error(f"God Mode heuristic err: {e}")
                
            await asyncio.sleep(1) # Re-calculate mathematical states every second


    async def start(self, symbol: str):
        """Initialize the streams for a specific symbol"""
        if self._running:
            if self.state.get("symbol") == symbol:
                return
            logger.info(f"GodMode: Switching symbol from {self.state.get('symbol')} to {symbol}")
            await self.stop()
            
        self._running = True
        self.state["symbol"] = symbol
        
        logger.info(f"GodMode Pipeline initializing for {symbol}")
        
        # Start core loops
        self._active_tasks.append(asyncio.create_task(self._broadcast_loop()))
        self._active_tasks.append(asyncio.create_task(self._calculate_heuristics_loop(symbol)))
        self._active_tasks.append(asyncio.create_task(self._scan_global_vulnerabilities()))
        
        # Start multi-exchange hooks
        self._active_tasks.append(asyncio.create_task(self._watch_liquidations('binance', symbol)))
        self._active_tasks.append(asyncio.create_task(self._watch_liquidations('bybit', symbol)))
        self._active_tasks.append(asyncio.create_task(self._watch_liquidations('okx', symbol)))
        self._active_tasks.append(asyncio.create_task(self._watch_liquidations('bitget', symbol)))
        
        self._active_tasks.append(asyncio.create_task(self._watch_ticker_for_arb('binance', symbol)))
        self._active_tasks.append(asyncio.create_task(self._watch_ticker_for_arb('bybit', symbol)))
        self._active_tasks.append(asyncio.create_task(self._watch_ticker_for_arb('okx', symbol)))
        self._active_tasks.append(asyncio.create_task(self._watch_ticker_for_arb('bitget', symbol)))
        
        # Start real orderbook heatmap engine
        self._active_tasks.append(asyncio.create_task(self._watch_orderbook_loop('binance', symbol)))
        
        # Integrate Modular True CVD Service
        true_cvd_service.register_callback(self._handle_true_cvd_event)
        self._active_tasks.append(asyncio.create_task(true_cvd_service.start(symbol)))

    async def stop(self):
        """Cleanup resources"""
        self._running = False
        for task in self._active_tasks:
            task.cancel()
            
        for name, ex in self.exchanges.items():
            await ex.close()
            
        await true_cvd_service.stop()
        try:
            true_cvd_service.remove_callback(self._handle_true_cvd_event)
        except Exception:
            pass
            
        self._active_tasks.clear()
        self.exchanges.clear()
        
        # Reset memory
        self._liq_history_1m = []
        self._smart_vol = 0
        self._dumb_vol = 0
        self.state["whale_feed"] = []
        self.state["iceberg_events"] = []
        logger.info("GodMode Pipeline stopped.")

# Global Singleton
god_mode_service = GodModeService()
