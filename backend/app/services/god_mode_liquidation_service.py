import asyncio
import logging
import math
import time
from collections import deque
from typing import Dict, Any, Callable, Awaitable, List, Optional, Tuple

import ccxt.pro as ccxtpro
from ccxt.base.errors import NetworkError

from app.services.true_cvd_service import TrueCVDService
from app.services.gex_options_service import GEXOptionsService
from app.services.bookmap_heatmap_service import bookmap_heatmap_service
from app.services.bookmap_history_store import BookmapHistoryStore
from app.services.deep_l2_aggregator_service import DeepL2Aggregator
from app.services.derivatives_service import derivatives_service
from app.services.smart_money_trajectory_service import SmartMoneyTrajectoryService
from app.services.liquidation_pool_engine import LiquidationPoolEngine, normalize_pool_horizon

logger = logging.getLogger(__name__)

SUPPORTED_GOD_MODE_EXCHANGES = {"binance", "bybit", "okx", "bitget"}


def _normalize_exchange(exchange: Optional[str]) -> str:
    ex = (exchange or "binance").lower().strip()
    if ex in SUPPORTED_GOD_MODE_EXCHANGES:
        return ex
    # Fallback to binance for exchanges without ccxtpro L2/liq support here
    return "binance"


class GodModeRunner:
    """
    Isolated per-(symbol, exchange) God Mode analytics runner.
    Supports multi-chart parallel symbols, live funding/OI, coin-adaptive thresholds,
    estimated leveraged liquidation pools (10x-100x), and bounded ring-buffer history.
    """

    def __init__(self, symbol: str, primary_exchange: str = "binance"):
        self.symbol = symbol.upper()
        self.primary_exchange = _normalize_exchange(primary_exchange)
        self._running = False
        self._callbacks: List[Callable[[Dict[str, Any]], Awaitable[None]]] = []
        self._lock = asyncio.Lock()
        self._idle_stop_task: Optional[asyncio.Task] = None
        self.last_active_at = time.time()

        self.exchanges: Dict[str, ccxtpro.Exchange] = {}
        self.true_cvd_service = TrueCVDService()
        self.gex_options_service = GEXOptionsService()
        self.smart_trajectory_service = SmartMoneyTrajectoryService()
        self.pool_engine = LiquidationPoolEngine(self.symbol)
        self.deep_l2_aggregator = DeepL2Aggregator(self.symbol)
        self.pool_horizon = "24h"
        self._active_horizons: set = {"24h"}

        self.state = self._initial_state(self.symbol, self.primary_exchange)
        self._last_prices = {"binance": 0.0, "bybit": 0.0, "okx": 0.0, "bitget": 0.0}
        self._max_volumes: Dict[float, float] = {}
        self._smoothed_zones_dict: Dict[float, float] = {}
        self._trailing_long = 0.0
        self._trailing_short = 0.0
        self._liq_history_1m: List[Dict[str, Any]] = []
        self._funding_rate = 0.0
        self._open_interest_usd = 0.0
        self._quote_volume_24h = 0.0
        self._active_tasks: List[asyncio.Task] = []

        # Coin-adaptive thresholds (defaults tuned for BTC, updated dynamically from 24h volume)
        self._thresholds = self._compute_adaptive_thresholds(0.0)
        self.state["adaptive_thresholds"] = dict(self._thresholds)

        # Persistent 2-hour Bookmap history (Redis ZSET + DB fallback) & bounded ring buffers
        self.bookmap_store = BookmapHistoryStore(self.symbol, self.primary_exchange)
        self._bubble_history: deque = deque(maxlen=50)
        self._iceberg_history: deque = deque(maxlen=25)
        self._spoof_history: deque = deque(maxlen=30)

    @staticmethod
    def _initial_state(symbol: str = "BTC/USDT", primary_exchange: str = "binance") -> Dict[str, Any]:
        return {
            "symbol": symbol,
            "exchange": primary_exchange,
            "vulnerability": [],
            "pain_threshold": {"level": 0, "status": "NORMAL", "value": 0},
            "smart_money": 50,
            "dumb_money": 50,
            "cvd_spoof": "NEUTRAL",
            "whale_feed": [],
            "magnet_zones": [],
            "smoothed_zones": [],
            "liquidation_pools": [],
            "liquidation_pool_summary": LiquidationPoolEngine._empty_summary("24h"),
            "pool_horizon": "24h",
            "deep_l2_walls": [],
            "deep_l2_summary": DeepL2Aggregator.empty_summary(),
            "spoofed_zones": [],
            "cascade_probs": [],
            "orderbook_depth": [],
            "trailing_liquidity": {
                "long_level": 0,
                "short_level": 0,
                "long_intensity": 0,
                "short_intensity": 0,
            },
            "ai_trajectory": {"target_price": 0, "strength": 0, "direction": "NEUTRAL"},
            "smart_trajectory": {"target_price": 0, "strength": 0, "direction": "NEUTRAL"},
            "current_price": 0,
            "true_cvd": 0,
            "iceberg_events": [],
            "arbitrage": [],
            "gex_data": None,
            "funding_rate": 0.0,
            "open_interest_usd": 0.0,
            "quote_volume_24h": 0.0,
            "adaptive_thresholds": {},
        }

    @staticmethod
    def _compute_adaptive_thresholds(quote_volume_24h: float) -> Dict[str, float]:
        """
        Scales whale/iceberg/spoof/pain thresholds relative to 24h USD quote volume.
        Baseline 1.0x corresponds to ~$10B 24h volume (BTC/ETH class).
        """
        if quote_volume_24h <= 0:
            scale = 1.0
        else:
            scale = max(0.05, min(1.5, math.sqrt(quote_volume_24h / 10_000_000_000.0)))

        return {
            "scale": round(scale, 3),
            "whale_usd": float(max(10_000, round(100_000 * scale))),
            "smart_usd": float(max(5_000, round(50_000 * scale))),
            "absorption_usd": float(max(15_000, round(100_000 * scale))),
            "spoof_usd": float(max(15_000, round(100_000 * scale))),
            "pain_max_usd": float(max(100_000, round(1_000_000 * scale))),
            "twls_prune_usd": float(max(500, round(5_000 * scale))),
        }

    def get_initial_snapshot(self, horizon: Optional[str] = None) -> Dict[str, Any]:
        """Returns current state plus persistent 2-hour Bookmap & bounded ring-buffer history."""
        snapshot = self.get_state_for_horizon(horizon)
        now = time.time()
        snapshot["history"] = {
            "bookmap": self.bookmap_store.get_hydrated_history(window_minutes=120, max_points=420),
            "bookmap_coverage_min": self.bookmap_store.get_coverage_minutes(),
            "bubbles": [b for b in self._bubble_history if (now * 1000 - b.get("timestamp", 0)) < 900_000],
            "icebergs": [ev for ev in self._iceberg_history if (now * 1000 - ev.get("timestamp", 0)) < 900_000],
            "spoofs": [sp for sp in self._spoof_history if (now - sp.get("timestamp", 0)) < 900],
        }
        return snapshot

    def get_state_for_horizon(self, horizon: Optional[str] = None) -> Dict[str, Any]:
        """Returns a state copy with pools/summary strictly matched to the requested lookback horizon."""
        h = normalize_pool_horizon(horizon or self.pool_horizon)
        snapshot = dict(self.state)
        snapshot["pool_horizon"] = h
        if self.pool_engine.has_cached(h):
            pools, summary = self.pool_engine.get_cached(h)
            snapshot["liquidation_pools"] = pools
            snapshot["liquidation_pool_summary"] = summary
        else:
            # Never leak another horizon's pools under a mismatched horizon label while fetching
            snapshot["liquidation_pools"] = []
            snapshot["liquidation_pool_summary"] = LiquidationPoolEngine._empty_summary(h)
        return snapshot

    async def ensure_pool_horizon(self, horizon: str = "24h", force: bool = False) -> Dict[str, Any]:
        """Ensures pools for the given horizon (24h/3d/7d) are computed and cached without restarting WS streams."""
        h = normalize_pool_horizon(horizon)
        self.pool_horizon = h
        self._active_horizons.add(h)
        # Hydrate live OI/volume before first pool calculation on cold start so USD estimates are accurate immediately
        if self._open_interest_usd <= 0 or self._quote_volume_24h <= 0:
            try:
                stats = await derivatives_service.get_market_stats(self.symbol)
                if stats.get("open_interest_usd", 0) > 0:
                    self._open_interest_usd = float(stats["open_interest_usd"])
                    self.state["open_interest_usd"] = self._open_interest_usd
                if stats.get("quote_volume_24h", 0) > 0:
                    self._quote_volume_24h = float(stats["quote_volume_24h"])
                    self.state["quote_volume_24h"] = self._quote_volume_24h
                if self.state.get("current_price", 0) <= 0 and stats.get("mark_price", 0) > 0:
                    self.state["current_price"] = float(stats["mark_price"])
            except Exception:
                pass
        await self._update_liquidation_pools(horizon=h, force=force)
        return self.get_state_for_horizon(h)

    def register_callback(self, callback: Callable[[Dict[str, Any]], Awaitable[None]]):
        self.last_active_at = time.time()
        if self._idle_stop_task and not self._idle_stop_task.done():
            self._idle_stop_task.cancel()
            self._idle_stop_task = None
        if callback not in self._callbacks:
            self._callbacks.append(callback)

    def remove_callback(self, callback: Callable[[Dict[str, Any]], Awaitable[None]]):
        if callback in self._callbacks:
            self._callbacks.remove(callback)
        if not self._callbacks and self._running:
            try:
                loop = asyncio.get_running_loop()
                if self._idle_stop_task and not self._idle_stop_task.done():
                    self._idle_stop_task.cancel()
                self._idle_stop_task = loop.create_task(self._schedule_idle_stop())
            except RuntimeError:
                pass

    async def _schedule_idle_stop(self):
        try:
            await asyncio.sleep(5)
            if not self._callbacks and self._running:
                logger.info(f"GodMode[{self.symbol}/{self.primary_exchange}]: No active subscribers; stopping.")
                await self.stop()
        except asyncio.CancelledError:
            pass

    async def _handle_true_cvd_event(self, payload: Dict[str, Any]):
        self.state["true_cvd"] = payload.get("true_cvd", 0)
        iceberg_event = payload.get("iceberg_event")
        if iceberg_event:
            ev_type = iceberg_event.get("type")
            ev_price = float(iceberg_event.get("price") or 0.0)
            ev_ts = int(iceberg_event.get("timestamp") or 0)
            ev_vol = float(iceberg_event.get("absorbed_volume") or 0.0)

            # Deduplicate 1s rolling-window repeats at the same price zone (<= 0.15%, within 12s)
            merged_existing = None
            for existing in self.state["iceberg_events"]:
                ex_price = float(existing.get("price") or 0.0)
                ex_ts = int(existing.get("timestamp") or 0)
                if (
                    existing.get("type") == ev_type
                    and ev_price > 0
                    and ex_price > 0
                    and abs(ev_price - ex_price) / ex_price <= 0.0015
                    and abs(ev_ts - ex_ts) <= 12_000
                ):
                    merged_existing = existing
                    break

            if merged_existing is not None:
                merged_existing["price"] = ev_price
                merged_existing["absorbed_volume"] = round(max(float(merged_existing.get("absorbed_volume") or 0.0), ev_vol))
                merged_existing["timestamp"] = ev_ts
                merged_existing["msg"] = iceberg_event.get("msg", merged_existing.get("msg"))
            else:
                self.state["iceberg_events"].insert(0, iceberg_event)
                if len(self.state["iceberg_events"]) > 10:
                    self.state["iceberg_events"].pop()
                self._iceberg_history.appendleft(iceberg_event)

            if "BEARISH" in str(ev_type) or "BULLISH" in str(ev_type):
                self.state["cvd_spoof"] = "DETECTED: HIGH RISK"

    async def _handle_gex_event(self, payload: Dict[str, Any]):
        gex_data = payload.get("gex_data")
        if gex_data:
            self.state["gex_data"] = gex_data

    async def _broadcast_loop(self):
        while self._running:
            if self._callbacks:
                dead_callbacks = []
                for cb in list(self._callbacks):
                    try:
                        await cb(self.state)
                    except Exception as e:
                        dead_callbacks.append(cb)
                        logger.debug(f"God Mode callback disconnected: {e}")
                for cb in dead_callbacks:
                    self.remove_callback(cb)
            await asyncio.sleep(0.5)

    async def _init_exchange(self, ex_id: str) -> ccxtpro.Exchange:
        if ex_id not in self.exchanges:
            options = {}
            if ex_id in ["binance", "okx", "bitget"]:
                options["defaultType"] = "swap"
            elif ex_id == "bybit":
                options["defaultType"] = "linear"
            ex_class = getattr(ccxtpro, ex_id)
            self.exchanges[ex_id] = ex_class({
                "enableRateLimit": True,
                "newUpdates": True,
                "options": options,
            })
        return self.exchanges[ex_id]

    async def _resolve_exchange_symbol(self, exchange: ccxtpro.Exchange, symbol: str) -> str:
        try:
            if not getattr(exchange, "markets", None):
                await exchange.load_markets()
            markets = exchange.markets or {}
            if symbol in markets:
                return symbol
            base_pair = symbol.split(":")[0]
            base_coin = base_pair.split("/")[0] if "/" in base_pair else ""
            candidates = [f"{base_pair}:USDT", f"{base_pair}:USDC"]
            # Prefer USDT linear swap before spot fallback (e.g., OKX has BTC/USDT:USDT swap, not BTC/USDC:USDC)
            if base_coin:
                candidates.append(f"{base_coin}/USDT:USDT")
            candidates.extend([base_pair, f"{base_pair}:USD"])
            for cand in candidates:
                if cand in markets:
                    return cand
        except Exception as e:
            logger.debug(f"GodMode symbol resolution fallback for {symbol}: {e}")
        return symbol

    async def _fetch_derivatives_and_pools_loop(self):
        """
        Fetches live Funding Rate, Open Interest, 24h Volume (for coin-adaptive thresholds),
        and computes Estimated Leveraged Liquidation Pools (10x/25x/50x/100x) from 15m swing/volume clusters.
        """
        while self._running:
            try:
                stats = await derivatives_service.get_market_stats(self.symbol)
                self._funding_rate = float(stats.get("funding_rate", 0.0) or 0.0)
                self._open_interest_usd = float(stats.get("open_interest_usd", 0.0) or 0.0)
                self._quote_volume_24h = float(stats.get("quote_volume_24h", 0.0) or 0.0)

                self.state["funding_rate"] = self._funding_rate
                self.state["open_interest_usd"] = self._open_interest_usd
                self.state["quote_volume_24h"] = self._quote_volume_24h

                if self.state["current_price"] <= 0 and stats.get("mark_price", 0) > 0:
                    self.state["current_price"] = float(stats["mark_price"])

                new_thresholds = self._compute_adaptive_thresholds(self._quote_volume_24h)
                self._thresholds = new_thresholds
                self.state["adaptive_thresholds"] = dict(new_thresholds)
                self.true_cvd_service.absorption_threshold_usd = new_thresholds["absorption_usd"]

                await self._update_liquidation_pools(force=True)
            except Exception as e:
                logger.debug(f"GodMode derivatives/pools err ({self.symbol}): {e}")
            await asyncio.sleep(30)

    async def _update_liquidation_pools(self, horizon: Optional[str] = None, force: bool = False):
        """
        Delegates to the modular LiquidationPoolEngine (OI-Delta weighted + strict swept-pool
        invalidation + multi-horizon 24h/3d/7d caching).
        """
        target_horizons = [normalize_pool_horizon(horizon)] if horizon else list(self._active_horizons or {self.pool_horizon})
        cp = float(self.state.get("current_price") or 0.0)
        for h in target_horizons:
            pools, summary = await self.pool_engine.compute_pools(
                horizon=h,
                current_price=cp,
                open_interest_usd=self._open_interest_usd,
                quote_volume_24h=self._quote_volume_24h,
                force=force,
            )
            if h == self.pool_horizon:
                self.state["liquidation_pools"] = pools
                self.state["liquidation_pool_summary"] = summary
                self.state["pool_horizon"] = h

    async def _deep_l2_poll_loop(self):
        """
        Periodically aggregates deep ±10% L2 orderbooks across Binance, Bybit, OKX, and Bitget
        to surface global multi-exchange Confluence Whale Walls and enrich Bookmap outer depth.
        """
        while self._running:
            try:
                cp = float(self.state.get("current_price") or 0.0)
                walls, summary = await self.deep_l2_aggregator.refresh(current_price=cp)
                self.state["deep_l2_walls"] = walls
                self.state["deep_l2_summary"] = summary
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"GodMode deep L2 poll err ({self.symbol}): {e}")
            await asyncio.sleep(8)

    async def _watch_liquidations(self, ex_id: str):
        exchange = await self._init_exchange(ex_id)
        ex_symbol = await self._resolve_exchange_symbol(exchange, self.symbol)
        logger.info(f"GodMode: Started {ex_id} liquidation stream for {ex_symbol}")

        while self._running:
            try:
                liquidations = await exchange.watch_liquidations(ex_symbol)
                if not isinstance(liquidations, list):
                    liquidations = [liquidations]
                for liq in liquidations:
                    await self._process_liquidation(ex_id, liq)
            except NetworkError as e:
                logger.warning(f"GodMode network err {ex_id}: {e}")
                await asyncio.sleep(5)
            except Exception as e:
                logger.debug(f"GodMode watch_liq err {ex_id}: {e}")
                await asyncio.sleep(5)

    async def _watch_ticker_for_arb(self, ex_id: str):
        exchange = await self._init_exchange(ex_id)
        ex_symbol = await self._resolve_exchange_symbol(exchange, self.symbol)
        while self._running:
            try:
                ticker = await exchange.watch_ticker(ex_symbol)
                price = getattr(ticker, "last", ticker.get("last"))
                if price:
                    p_float = float(price)
                    self._last_prices[ex_id] = p_float
                    if ex_id == self.primary_exchange or self.state["current_price"] <= 0:
                        self.state["current_price"] = p_float
                        if self.pool_engine.prune_swept_by_live_price(p_float):
                            pools, summary = self.pool_engine.get_cached(self.pool_horizon)
                            self.state["liquidation_pools"] = pools
                            self.state["liquidation_pool_summary"] = summary
            except Exception:
                await asyncio.sleep(5)

    async def _process_liquidation(self, ex_id: str, liq: dict):
        price = float(liq.get("price", 0))
        amount = float(liq.get("amount") or liq.get("contracts", 0))
        usd_value = float(liq.get("quoteValue") or (price * amount))
        side = liq.get("side", "").lower()
        liq_type = "Long Rekt" if side == "sell" else "Short Rekt"

        if usd_value <= 0 or price <= 0:
            return

        self.state["current_price"] = price
        now = time.time()

        # Real-time multi-exchange liquidation pool depletion
        pool_side = "LONG_LIQ" if side == "sell" else "SHORT_LIQ"
        self.pool_engine.record_live_liquidation(price, usd_value, pool_side)
        self.pool_engine.prune_swept_by_live_price(price)
        pools, summary = self.pool_engine.get_cached(self.pool_horizon)
        if pools or self.state.get("liquidation_pools"):
            self.state["liquidation_pools"] = pools
            self.state["liquidation_pool_summary"] = summary

        is_smart = usd_value > self._thresholds["smart_usd"]
        self._liq_history_1m.append({"time": now, "value": usd_value, "is_smart": is_smart})

        if is_smart and usd_value > self._thresholds["whale_usd"]:
            whale_event = {
                "type": liq_type,
                "value": round(usd_value),
                "price": price,
                "timestamp": now * 1000,
                "time": "Just now",
                "exchange": ex_id,
            }
            self.state["whale_feed"].insert(0, whale_event)
            if len(self.state["whale_feed"]) > 20:
                self.state["whale_feed"].pop()
            self._bubble_history.appendleft(whale_event)

    async def _scan_global_vulnerabilities(self):
        exchange = await self._init_exchange("binance")

        async def _keep_tickers_updated():
            while self._running:
                try:
                    await exchange.watch_tickers()
                except Exception:
                    await asyncio.sleep(5)

        ticker_task = asyncio.create_task(_keep_tickers_updated())
        self._active_tasks.append(ticker_task)

        while self._running:
            try:
                tickers = exchange.tickers
                if not tickers:
                    await asyncio.sleep(5)
                    continue

                candidates = []
                for sym, data in tickers.items():
                    if ("USDT" in sym) and data.get("percentage") is not None:
                        base_coin = sym.split("/")[0].replace(":USDT", "")
                        pct_change = abs(data["percentage"])
                        quote_vol = float(data.get("quoteVolume", 0))
                        if quote_vol > 50_000_000 and base_coin not in ["USDC", "FDUSD", "TUSD", "USDT"]:
                            raw_pct = float(data["percentage"])
                            candidates.append({
                                "coin": base_coin,
                                "risk": min(99, round(pct_change * 4.5)),
                                "est_liq": round((quote_vol * (pct_change / 100)) / 10_000_000, 1),
                                "side": "SHORTS" if raw_pct > 0 else "LONGS",
                            })

                candidates.sort(key=lambda x: x["risk"], reverse=True)
                if candidates:
                    self.state["vulnerability"] = candidates[:7]
            except Exception as e:
                logger.error(f"Global vulnerability scan error: {e}")
            await asyncio.sleep(60)

    async def _watch_orderbook_loop(self):
        exchange = await self._init_exchange(self.primary_exchange)
        ex_symbol = await self._resolve_exchange_symbol(exchange, self.symbol)
        logger.info(f"GodMode: Started {self.primary_exchange} orderbook stream for {ex_symbol}")
        last_ob_calc_mono = 0.0

        while self._running:
            try:
                orderbook = await exchange.watch_order_book(ex_symbol)
                now_mono = time.monotonic()
                if (now_mono - last_ob_calc_mono) < 0.25:
                    continue
                last_ob_calc_mono = now_mono
                bids = orderbook.get("bids", []) if orderbook else []
                asks = orderbook.get("asks", []) if orderbook else []
                cp = self.state["current_price"]
                if cp <= 0 and bids and asks:
                    cp = (float(bids[0][0]) + float(asks[0][0])) / 2.0
                    self.state["current_price"] = cp

                if cp > 0 and bids and asks:
                    bids_within_range = [b for b in bids if b[0] >= cp * 0.95]
                    asks_within_range = [a for a in asks if a[0] <= cp * 1.05]

                    if not bids_within_range or not asks_within_range:
                        await asyncio.sleep(1)
                        continue

                    top_bids = sorted(bids_within_range, key=lambda x: float(x[0]) * float(x[1]), reverse=True)[:5]
                    top_asks = sorted(asks_within_range, key=lambda x: float(x[0]) * float(x[1]), reverse=True)[:5]

                    max_bid_vol = max((float(b[0]) * float(b[1]) for b in top_bids), default=1.0) or 1.0
                    max_ask_vol = max((float(a[0]) * float(a[1]) for a in top_asks), default=1.0) or 1.0

                    magnet_zones = []
                    cascade_probs = []

                    for ask in top_asks:
                        price, qty = float(ask[0]), float(ask[1])
                        vol_usd = price * qty
                        intensity = min(100, int((vol_usd / max_ask_vol) * 100))
                        if intensity > 30:
                            magnet_zones.append({"price": price, "intensity": intensity, "volume": vol_usd})
                            dist = abs(price - cp) / cp
                            prob = min(99, int((1 - (dist * 20)) * intensity))
                            cascade_probs.append({"price": price, "prob": max(10, prob), "volume": vol_usd})

                    for bid in top_bids:
                        price, qty = float(bid[0]), float(bid[1])
                        vol_usd = price * qty
                        intensity = min(100, int((vol_usd / max_bid_vol) * 100))
                        if intensity > 30:
                            magnet_zones.append({"price": price, "intensity": intensity, "volume": vol_usd})
                            dist = abs(price - cp) / cp
                            prob = min(99, int((1 - (dist * 20)) * intensity))
                            cascade_probs.append({"price": price, "prob": max(10, prob), "volume": vol_usd})

                    # --- Time-Weighted Liquidity Smoothing (TWLS) in USD ---
                    ALPHA = 0.15
                    current_volumes: Dict[float, float] = {}
                    for ask in top_asks:
                        p, q = float(ask[0]), float(ask[1])
                        v_usd = p * q
                        if v_usd > max_ask_vol * 0.1:
                            current_volumes[p] = v_usd
                    for bid in top_bids:
                        p, q = float(bid[0]), float(bid[1])
                        v_usd = p * q
                        if v_usd > max_bid_vol * 0.1:
                            current_volumes[p] = v_usd

                    for p, v_usd in current_volumes.items():
                        if p in self._smoothed_zones_dict:
                            self._smoothed_zones_dict[p] = (v_usd * ALPHA) + (self._smoothed_zones_dict[p] * (1 - ALPHA))
                        else:
                            self._smoothed_zones_dict[p] = v_usd

                    prune_usd = self._thresholds["twls_prune_usd"]
                    keys_to_remove = []
                    for p in self._smoothed_zones_dict:
                        if p not in current_volumes:
                            self._smoothed_zones_dict[p] *= (1 - ALPHA)
                            if self._smoothed_zones_dict[p] < prune_usd:
                                keys_to_remove.append(p)
                    for k in keys_to_remove:
                        del self._smoothed_zones_dict[k]

                    smoothed_zones = []
                    for p, v_usd in self._smoothed_zones_dict.items():
                        ref_max = max_ask_vol if p > cp else max_bid_vol
                        intensity = min(100, int((v_usd / (ref_max + 1)) * 100))
                        if intensity > 20:
                            smoothed_zones.append({"price": p, "intensity": intensity, "volume": v_usd})

                    ask_weight = sum(z["volume"] for z in magnet_zones if z["price"] > cp)
                    bid_weight = sum(z["volume"] for z in magnet_zones if z["price"] < cp)

                    trajectory = {"target_price": cp, "strength": 0, "direction": "NEUTRAL"}
                    if ask_weight > bid_weight * 1.1:
                        trajectory["direction"] = "UP"
                        trajectory["strength"] = min(100, int((ask_weight / (bid_weight + 1)) * 30))
                        target = max((z for z in magnet_zones if z["price"] > cp), key=lambda x: x["volume"], default=None)
                        if target:
                            trajectory["target_price"] = target["price"]
                    elif bid_weight > ask_weight * 1.1:
                        trajectory["direction"] = "DOWN"
                        trajectory["strength"] = min(100, int((bid_weight / (ask_weight + 1)) * 30))
                        target = max((z for z in magnet_zones if z["price"] < cp), key=lambda x: x["volume"], default=None)
                        if target:
                            trajectory["target_price"] = target["price"]

                    enriched_bids, enriched_asks = self.deep_l2_aggregator.combine_with_live_inner_book(
                        bids, asks, cp
                    )
                    has_deep_outer = enriched_bids is not bids or enriched_asks is not asks
                    smart_bids = (
                        [b for b in enriched_bids if float(b[0]) >= cp * 0.90]
                        if has_deep_outer
                        else bids_within_range
                    )
                    smart_asks = (
                        [a for a in enriched_asks if float(a[0]) <= cp * 1.10]
                        if has_deep_outer
                        else asks_within_range
                    )
                    smart_trajectory = self.smart_trajectory_service.calculate_smart_trajectory(
                        smart_bids, smart_asks, cp, self._funding_rate
                    )

                    # --- Dynamic Trailing Liquidity Cloud (DTLC) ---
                    target_long_trail = cp * 0.985
                    if self._trailing_long == 0.0 or target_long_trail > self._trailing_long:
                        self._trailing_long += (target_long_trail - self._trailing_long) * 0.1
                    if cp < self._trailing_long:
                        self._trailing_long = target_long_trail

                    target_short_trail = cp * 1.015
                    if self._trailing_short == 0.0 or target_short_trail < self._trailing_short:
                        self._trailing_short += (target_short_trail - self._trailing_short) * 0.1
                    if cp > self._trailing_short:
                        self._trailing_short = target_short_trail

                    trail_ref_usd = max(50_000.0, self._thresholds["pain_max_usd"] * 0.5)
                    self.state["trailing_liquidity"] = {
                        "long_level": round(self._trailing_long, 6),
                        "short_level": round(self._trailing_short, 6),
                        "long_intensity": min(100, max(20, int((bid_weight / trail_ref_usd) * 100))),
                        "short_intensity": min(100, max(20, int((ask_weight / trail_ref_usd) * 100))),
                    }

                    # --- Spoofing / Order Pulling Detection (Coin-Adaptive) ---
                    now_ts = time.time()
                    spoof_min_usd = self._thresholds["spoof_usd"]
                    raw_volumes: Dict[float, float] = {}
                    for b in bids_within_range:
                        raw_volumes[float(b[0])] = float(b[1])
                    for a in asks_within_range:
                        raw_volumes[float(a[0])] = float(a[1])

                    for p, v in raw_volumes.items():
                        usd_vol = v * cp
                        if usd_vol > spoof_min_usd:
                            if p in self._max_volumes:
                                self._max_volumes[p] = max(self._max_volumes[p], usd_vol)
                            else:
                                self._max_volumes[p] = usd_vol

                    for p in list(self._max_volumes.keys()):
                        if cp * 0.95 <= p <= cp * 1.05:
                            current_usd_vol = raw_volumes.get(p, 0) * cp
                            max_usd_vol = self._max_volumes[p]
                            if current_usd_vol < max_usd_vol * 0.2:
                                dist = abs(p - cp) / cp
                                if dist > 0.002:
                                    existing = next(
                                        (z for z in self.state["spoofed_zones"] if abs(z["price"] - p) < cp * 0.0005),
                                        None,
                                    )
                                    if existing:
                                        existing["volume"] = max(existing["volume"], max_usd_vol)
                                        existing["timestamp"] = now_ts
                                    else:
                                        spoof_ev = {
                                            "price": p,
                                            "volume": max_usd_vol,
                                            "timestamp": now_ts,
                                            "type": "SPOOF",
                                        }
                                        self.state["spoofed_zones"].append(spoof_ev)
                                        self._spoof_history.append(spoof_ev)
                                del self._max_volumes[p]
                        else:
                            del self._max_volumes[p]

                    self.state["spoofed_zones"] = [
                        z for z in self.state["spoofed_zones"] if now_ts - z["timestamp"] < 120
                    ]

                    if has_deep_outer:
                        bm_bids, bm_asks = self.deep_l2_aggregator.combine_with_live_inner_book(
                            bids, asks, cp, normalize_for_single_exchange=True
                        )
                        # bucket_count=50 over ±10% -> 0.2% bucket width, matching DeepL2Aggregator.BIN_PCT (zero striping)
                        orderbook_depth = bookmap_heatmap_service.process_orderbook(
                            bm_bids, bm_asks, cp, bucket_count=50, spread_percentage=0.10
                        )
                    else:
                        orderbook_depth = bookmap_heatmap_service.process_orderbook(bids, asks, cp)
                    if orderbook_depth:
                        self.bookmap_store.record_snapshot(orderbook_depth, now_ts)

                    self.state["magnet_zones"] = magnet_zones
                    self.state["smoothed_zones"] = smoothed_zones
                    self.state["cascade_probs"] = cascade_probs
                    self.state["ai_trajectory"] = trajectory
                    self.state["smart_trajectory"] = smart_trajectory
                    self.state["orderbook_depth"] = orderbook_depth
            except NetworkError:
                await asyncio.sleep(5)
            except Exception as e:
                logger.debug(f"GodMode orderbook err ({self.symbol}): {e}")
                await asyncio.sleep(5)

    async def _calculate_heuristics_loop(self):
        while self._running:
            try:
                now = time.time()
                self._liq_history_1m = [x for x in self._liq_history_1m if now - x["time"] < 300]
                pain_value = sum(x["value"] for x in self._liq_history_1m)
                pain_max_usd = max(100_000.0, self._thresholds["pain_max_usd"])
                gauge_level = min(100, (pain_value / pain_max_usd) * 100)
                status = "NORMAL"
                if gauge_level > 80:
                    status = "EXTREME"
                elif gauge_level > 50:
                    status = "HIGH"

                self.state["pain_threshold"] = {
                    "level": round(gauge_level),
                    "status": status,
                    "value": round(pain_value),
                }

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

                valid_prices = {ex: p for ex, p in self._last_prices.items() if p > 0}
                if len(valid_prices) >= 2:
                    min_ex = min(valid_prices, key=valid_prices.get)
                    max_ex = max(valid_prices, key=valid_prices.get)
                    min_price = valid_prices[min_ex]
                    max_price = valid_prices[max_ex]
                    diff_pct = ((max_price - min_price) / min_price) * 100 if min_price > 0 else 0.0
                    if diff_pct > 0.05:
                        self.state["arbitrage"] = [{
                            "pair": self.symbol.split("/")[0],
                            "diff": round(diff_pct, 2),
                            "vol": str(round(pain_value / 1_000_000, 1)) + "M",
                            "target": f"{max_ex.capitalize()} -> {min_ex.capitalize()}",
                        }]
                    else:
                        self.state["arbitrage"] = []

                if gauge_level > 85 and len(self.state["whale_feed"]) > 0:
                    self.state["cvd_spoof"] = "DETECTED: HIGH RISK"
                else:
                    self.state["cvd_spoof"] = "NEGATIVE"
            except Exception as e:
                logger.error(f"God Mode heuristic err ({self.symbol}): {e}")
            await asyncio.sleep(1)

    async def start(self):
        async with self._lock:
            if self._idle_stop_task and not self._idle_stop_task.done():
                self._idle_stop_task.cancel()
                self._idle_stop_task = None
            if self._running:
                return

            self._running = True
            self.last_active_at = time.time()
            logger.info(f"GodModeRunner initializing for {self.symbol} ({self.primary_exchange})")

            # Pre-hydrate up to 2h persisted Bookmap history in background so startup stays instant
            self._active_tasks.append(asyncio.create_task(self.bookmap_store.hydrate_from_persistence()))

            self._active_tasks.append(asyncio.create_task(self._broadcast_loop()))
            self._active_tasks.append(asyncio.create_task(self._calculate_heuristics_loop()))
            self._active_tasks.append(asyncio.create_task(self._scan_global_vulnerabilities()))
            self._active_tasks.append(asyncio.create_task(self._fetch_derivatives_and_pools_loop()))
            self._active_tasks.append(asyncio.create_task(self._deep_l2_poll_loop()))

            for ex_id in ("binance", "bybit", "okx", "bitget"):
                self._active_tasks.append(asyncio.create_task(self._watch_liquidations(ex_id)))
                self._active_tasks.append(asyncio.create_task(self._watch_ticker_for_arb(ex_id)))

            self._active_tasks.append(asyncio.create_task(self._watch_orderbook_loop()))

            self.true_cvd_service.register_callback(self._handle_true_cvd_event)
            self._active_tasks.append(
                asyncio.create_task(
                    self.true_cvd_service.start(
                        self.symbol,
                        exchange_id=self.primary_exchange,
                        absorption_threshold_usd=self._thresholds["absorption_usd"],
                    )
                )
            )

            self.gex_options_service.register_callback(self._handle_gex_event)
            self._active_tasks.append(asyncio.create_task(self.gex_options_service.start(self.symbol)))

    async def stop(self):
        async with self._lock:
            self._running = False
            tasks = list(self._active_tasks)
            self._active_tasks.clear()
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

            for name, ex in list(self.exchanges.items()):
                try:
                    await ex.close()
                except Exception as e:
                    logger.debug(f"GodMode exchange close err ({name}): {e}")
            self.exchanges.clear()

            try:
                await self.true_cvd_service.stop()
            except Exception:
                pass
            self.true_cvd_service.remove_callback(self._handle_true_cvd_event)

            try:
                await self.gex_options_service.stop()
            except Exception:
                pass
            self.gex_options_service.remove_callback(self._handle_gex_event)

            try:
                await self.bookmap_store.flush_latest()
            except Exception:
                pass

            self.smart_trajectory_service.reset()
            self.pool_engine.reset()
            self.deep_l2_aggregator.reset()
            self._active_horizons = {self.pool_horizon}
            self._liq_history_1m = []
            self._smoothed_zones_dict = {}
            self._max_volumes = {}
            self._trailing_long = 0.0
            self._trailing_short = 0.0
            self._last_prices = {"binance": 0.0, "bybit": 0.0, "okx": 0.0, "bitget": 0.0}
            self._funding_rate = 0.0
            self.state = self._initial_state(self.symbol, self.primary_exchange)


class GodModeService:
    """
    Pool-backed God Mode Service managing isolated per-(symbol, exchange) GodModeRunners
    while preserving full backward compatibility for existing callers.
    """

    MAX_CONCURRENT_RUNNERS = 4

    def __init__(self):
        self._runners: Dict[Tuple[str, str], GodModeRunner] = {}
        self._callback_runner_map: Dict[int, GodModeRunner] = {}
        self._default_state: Dict[str, Any] = GodModeRunner._initial_state("BTC/USDT", "binance")
        self._active_key: Optional[Tuple[str, str]] = None
        self._pool_lock = asyncio.Lock()

    def _make_key(self, symbol: str = "BTC/USDT", exchange: Optional[str] = None) -> Tuple[str, str]:
        return ((symbol or "BTC/USDT").upper(), _normalize_exchange(exchange))

    def get_or_create_runner(self, symbol: str = "BTC/USDT", exchange: Optional[str] = None) -> GodModeRunner:
        key = self._make_key(symbol, exchange)
        if key not in self._runners:
            self._runners[key] = GodModeRunner(key[0], key[1])
        self._active_key = key
        return self._runners[key]

    @property
    def state(self) -> Dict[str, Any]:
        if self._active_key and self._active_key in self._runners:
            return self._runners[self._active_key].state
        if self._runners:
            latest = max(self._runners.values(), key=lambda r: r.last_active_at)
            return latest.state
        return self._default_state

    @state.setter
    def state(self, value: Dict[str, Any]):
        if self._active_key and self._active_key in self._runners:
            self._runners[self._active_key].state = value
        else:
            self._default_state = value

    def register_callback(
        self,
        callback: Callable[[Dict[str, Any]], Awaitable[None]],
        symbol: str = "BTC/USDT",
        exchange: Optional[str] = None,
    ):
        runner = self.get_or_create_runner(symbol, exchange)
        runner.register_callback(callback)
        self._callback_runner_map[id(callback)] = runner

    def remove_callback(self, callback: Callable[[Dict[str, Any]], Awaitable[None]]):
        runner = self._callback_runner_map.pop(id(callback), None)
        if runner is not None:
            runner.remove_callback(callback)
        else:
            for r in list(self._runners.values()):
                r.remove_callback(callback)

    def get_initial_snapshot(
        self,
        symbol: str = "BTC/USDT",
        exchange: Optional[str] = None,
        horizon: Optional[str] = None,
    ) -> Dict[str, Any]:
        runner = self.get_or_create_runner(symbol, exchange)
        return runner.get_initial_snapshot(horizon=horizon)

    def get_state_for_horizon(
        self,
        symbol: str = "BTC/USDT",
        exchange: Optional[str] = None,
        horizon: Optional[str] = None,
    ) -> Dict[str, Any]:
        runner = self.get_or_create_runner(symbol, exchange)
        return runner.get_state_for_horizon(horizon=horizon)

    async def ensure_horizon(
        self,
        symbol: str = "BTC/USDT",
        exchange: Optional[str] = None,
        horizon: str = "24h",
        force: bool = False,
    ) -> Dict[str, Any]:
        runner = self.get_or_create_runner(symbol, exchange)
        return await runner.ensure_pool_horizon(horizon=horizon, force=force)

    async def ensure_bookmap_hydrated(
        self,
        symbol: str = "BTC/USDT",
        exchange: Optional[str] = None,
    ) -> int:
        runner = self.get_or_create_runner(symbol, exchange)
        return await runner.bookmap_store.hydrate_from_persistence()

    async def get_bookmap_history(
        self,
        symbol: str = "BTC/USDT",
        exchange: Optional[str] = None,
        minutes: int = 120,
    ) -> Dict[str, Any]:
        """
        Returns up to 2h of Bookmap history without creating/evicting idle runners or mutating _active_key.
        Uses the live runner's store if active, otherwise reads directly from a temporary BookmapHistoryStore.
        """
        key = self._make_key(symbol, exchange)
        safe_min = max(5, min(120, int(minutes or 120)))
        runner = self._runners.get(key)
        if runner is not None:
            store = runner.bookmap_store
        else:
            store = BookmapHistoryStore(key[0], key[1])
        await store.hydrate_from_persistence()
        snapshots = store.get_hydrated_history(window_minutes=safe_min, max_points=600)
        return {
            "symbol": key[0],
            "exchange": key[1],
            "minutes": safe_min,
            "coverage_min": store.get_coverage_minutes(),
            "count": len(snapshots),
            "snapshots": snapshots,
        }

    async def start(self, symbol: str, exchange: Optional[str] = None):
        async with self._pool_lock:
            key = self._make_key(symbol, exchange)
            if key not in self._runners and len(self._runners) >= self.MAX_CONCURRENT_RUNNERS:
                # Prefer evicting an idle runner with 0 subscribers first
                idle_keys = [k for k, r in self._runners.items() if not r._callbacks]
                victim_key = (
                    min(idle_keys, key=lambda k: self._runners[k].last_active_at)
                    if idle_keys
                    else min(self._runners.keys(), key=lambda k: self._runners[k].last_active_at)
                )
                victim = self._runners.pop(victim_key)
                await victim.stop()

            runner = self.get_or_create_runner(key[0], key[1])
        await runner.start()

    async def stop(self, symbol: Optional[str] = None, exchange: Optional[str] = None):
        if symbol is not None:
            key = self._make_key(symbol, exchange)
            runner = self._runners.pop(key, None)
            if runner:
                await runner.stop()
            return

        for runner in list(self._runners.values()):
            await runner.stop()
        self._runners.clear()
        self._callback_runner_map.clear()
        self._active_key = None
        self._default_state = GodModeRunner._initial_state("BTC/USDT", "binance")


# Global Singleton Pool Manager
god_mode_service = GodModeService()
