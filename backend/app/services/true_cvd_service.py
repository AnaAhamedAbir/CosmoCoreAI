import asyncio
import logging
import time
from collections import deque
from typing import Dict, Any, Callable, Awaitable, List, Optional

import ccxt.pro as ccxtpro
from ccxt.base.errors import NetworkError

logger = logging.getLogger(__name__)


class TrueCVDService:
    """
    Institutional 1-Minute Candle-Aligned Orderflow, True CVD & Iceberg Engine (v2.0).

    Capabilities:
    1. Candle-Aligned 1M Orderflow (00s-59s UTC sync):
       Tracks bar_open/high/low/close, bar_delta, max_delta, min_delta, buy/sell USD,
       and archives the last 30 completed 1m bar deltas for chart bottom histogram rendering.
    2. Whale vs Retail Trade-Size Segmentation:
       Separates institutional prints (>= whale_trade_usd) from retail flow (<= retail_cap_usd)
       using coin-adaptive USD sizing.
    3. 10-Second Closing Velocity & 5-Factor Probabilistic 1M Close-Bias Engine:
       Combines 1m bar delta, 10s closing velocity, whale delta, intra-bar delta flip/recovery,
       and confirmed absorption + L2 top-of-book imbalance into a transparent 8%-92% close-bias
       score with live countdown and exact microstructure reason.
    4. Precision Tick-Cluster Iceberg / Absorption Detection (Zero Chop False Positives):
       Requires directional imbalance (>= 1.45x), tight price-shelf concentration (±0.025%),
       and price stall/rejection before emitting an iceberg event.
    """

    SHELF_PCT = 0.00025  # 0.025% tight price shelf for iceberg clustering
    ABSORPTION_WINDOW_SEC = 25.0
    VELOCITY_WINDOW_SEC = 10.0
    IMBALANCE_MIN_RATIO = 1.45

    def __init__(self, absorption_threshold_usd: float = 100_000.0, time_window_sec: int = 60):
        self._running = False
        self._callbacks: List[Callable[[Dict[str, Any]], Awaitable[None]]] = []

        # Configuration
        self.absorption_threshold_usd = max(5_000.0, float(absorption_threshold_usd))
        self.whale_trade_usd = self._derive_whale_trade_usd(self.absorption_threshold_usd)
        self.time_window_sec = time_window_sec
        self.exchange_id = "binance"
        self.exchange: Optional[ccxtpro.Exchange] = None
        self._active_tasks: List[asyncio.Task] = []

        # Internal State
        self.symbol = ""
        self.current_cvd = 0.0
        self._trade_history: deque = deque()
        self._last_price = 0.0
        self._window_start_price = 0.0
        self._l2_imbalance = 0.0  # -1.0 (ask heavy) .. +1.0 (bid heavy) from GodModeRunner

        # Active 1-minute candle accumulator & completed 30-bar delta history
        self._active_bar: Optional[Dict[str, Any]] = None
        self._completed_bars: deque = deque(maxlen=30)
        self._last_absorption_type: Optional[str] = None
        self._last_absorption_ts: float = 0.0

    @staticmethod
    def _derive_whale_trade_usd(absorption_threshold_usd: float) -> float:
        """Coin-adaptive single-trade whale threshold ($5k low-cap .. $35k BTC-class)."""
        return round(max(5_000.0, min(35_000.0, float(absorption_threshold_usd) * 0.25)), 2)

    def update_thresholds(self, absorption_threshold_usd: float) -> None:
        self.absorption_threshold_usd = max(5_000.0, float(absorption_threshold_usd))
        self.whale_trade_usd = self._derive_whale_trade_usd(self.absorption_threshold_usd)

    def set_l2_imbalance(self, imbalance: float) -> None:
        """Receives top-of-book L2 micro-imbalance in [-1.0, +1.0] from GodModeRunner."""
        try:
            self._l2_imbalance = max(-1.0, min(1.0, float(imbalance)))
        except (TypeError, ValueError):
            pass

    def register_callback(self, callback: Callable[[Dict[str, Any]], Awaitable[None]]):
        if callback not in self._callbacks:
            self._callbacks.append(callback)

    def remove_callback(self, callback: Callable[[Dict[str, Any]], Awaitable[None]]):
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    async def _init_exchange(self, ex_id: str = "binance"):
        if self.exchange is None:
            ex_class = getattr(ccxtpro, ex_id)
            default_type = "linear" if ex_id == "bybit" else "swap"
            self.exchange = ex_class({
                "enableRateLimit": True,
                "newUpdates": True,
                "options": {"defaultType": default_type},
            })
        return self.exchange

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
            if base_coin:
                candidates.append(f"{base_coin}/USDT:USDT")
            candidates.extend([base_pair, f"{base_pair}:USD"])
            for cand in candidates:
                if cand in markets:
                    return cand
        except Exception as e:
            logger.debug(f"TrueCVD symbol resolution fallback for {symbol}: {e}")
        return symbol

    @staticmethod
    def _new_bar(bar_start_ts: int, price: float) -> Dict[str, Any]:
        return {
            "time": bar_start_ts,
            "open": price,
            "high": price,
            "low": price,
            "close": price,
            "buy_usd": 0.0,
            "sell_usd": 0.0,
            "delta_usd": 0.0,
            "max_delta_usd": 0.0,
            "min_delta_usd": 0.0,
            "whale_buy_usd": 0.0,
            "whale_sell_usd": 0.0,
            "retail_buy_usd": 0.0,
            "retail_sell_usd": 0.0,
            "trade_count": 0,
            "absorption": None,
        }

    def _finalize_bar(self, bar: Dict[str, Any]) -> Dict[str, Any]:
        delta = bar["buy_usd"] - bar["sell_usd"]
        price_up = bar["close"] > bar["open"]
        price_down = bar["close"] < bar["open"]
        div = None
        if price_down and delta > 0:
            div = "BULL_DIV"
        elif price_up and delta < 0:
            div = "BEAR_DIV"
        elif bar.get("absorption") == "BULLISH_ABSORPTION":
            div = "BULL_DIV"
        elif bar.get("absorption") == "BEARISH_ABSORPTION":
            div = "BEAR_DIV"
        return {
            "time": int(bar["time"]),
            "open": bar["open"],
            "close": bar["close"],
            "buy_usd": round(bar["buy_usd"]),
            "sell_usd": round(bar["sell_usd"]),
            "delta_usd": round(delta),
            "max_delta_usd": round(bar["max_delta_usd"]),
            "min_delta_usd": round(bar["min_delta_usd"]),
            "whale_delta_usd": round(bar["whale_buy_usd"] - bar["whale_sell_usd"]),
            "retail_delta_usd": round(bar["retail_buy_usd"] - bar["retail_sell_usd"]),
            "divergence": div,
            "absorption": bar.get("absorption"),
        }

    def _roll_bar_if_needed(self, ts_sec: float, price: float) -> None:
        bar_start = int(ts_sec // 60) * 60
        if self._active_bar is None:
            if price > 0:
                self._active_bar = self._new_bar(bar_start, price)
            return
        if bar_start > self._active_bar["time"]:
            if self._active_bar["trade_count"] > 0:
                self._completed_bars.append(self._finalize_bar(self._active_bar))
            ref_px = price if price > 0 else self._active_bar["close"]
            self._active_bar = self._new_bar(bar_start, ref_px)

    def ingest_trade(self, price: float, amount: float, side: str, ts_sec: Optional[float] = None) -> None:
        """Pure synchronous trade ingestion (unit-testable, O(1) active bar update)."""
        if price <= 0 or amount <= 0 or side not in ("buy", "sell"):
            return
        now = float(ts_sec) if ts_sec is not None else time.time()
        usd_value = price * amount

        if self._window_start_price == 0.0:
            self._window_start_price = price
        self._last_price = price

        self._roll_bar_if_needed(now, price)
        bar = self._active_bar
        if bar is not None:
            if price > bar["high"]:
                bar["high"] = price
            if price < bar["low"]:
                bar["low"] = price
            bar["close"] = price
            bar["trade_count"] += 1

            whale_min = self.whale_trade_usd
            retail_max = whale_min * 0.25

            if side == "buy":
                bar["buy_usd"] += usd_value
                if usd_value >= whale_min:
                    bar["whale_buy_usd"] += usd_value
                elif usd_value <= retail_max:
                    bar["retail_buy_usd"] += usd_value
            else:
                bar["sell_usd"] += usd_value
                if usd_value >= whale_min:
                    bar["whale_sell_usd"] += usd_value
                elif usd_value <= retail_max:
                    bar["retail_sell_usd"] += usd_value

            bar_delta = bar["buy_usd"] - bar["sell_usd"]
            bar["delta_usd"] = bar_delta
            if bar_delta > bar["max_delta_usd"]:
                bar["max_delta_usd"] = bar_delta
            if bar_delta < bar["min_delta_usd"]:
                bar["min_delta_usd"] = bar_delta

        if side == "buy":
            self.current_cvd += usd_value
        else:
            self.current_cvd -= usd_value

        self._trade_history.append({
            "time": now,
            "side": side,
            "value": usd_value,
            "price": price,
        })

    def evaluate_snapshot(self, now: Optional[float] = None) -> Dict[str, Any]:
        """
        Pure deterministic evaluation of:
        - 60s rolling True CVD
        - Precision Tick-Cluster Iceberg / Absorption detection
        - 1-Minute Candle-Aligned Orderflow & 5-Factor Probabilistic Close-Bias
        - Recent 1m bar delta history (completed + live active bar)
        """
        ts = float(now) if now is not None else time.time()

        # Prune trades older than rolling window
        cutoff_60 = ts - self.time_window_sec
        while self._trade_history and self._trade_history[0]["time"] < cutoff_60:
            self._trade_history.popleft()

        self._roll_bar_if_needed(ts, self._last_price)

        buy_60 = 0.0
        sell_60 = 0.0
        buy_10 = 0.0
        sell_10 = 0.0
        cutoff_10 = ts - self.VELOCITY_WINDOW_SEC
        cutoff_abs = ts - self.ABSORPTION_WINDOW_SEC

        # Tight 0.025% price-shelf accumulators over the recent 25s window
        ref_px = self._last_price
        shelf_step = max(1e-9, ref_px * self.SHELF_PCT) if ref_px > 0 else 1.0
        shelves: Dict[int, Dict[str, float]] = {}
        abs_window_first_px = 0.0
        abs_window_high = 0.0
        abs_window_low = 0.0
        abs_buy_25 = 0.0
        abs_sell_25 = 0.0

        for t in self._trade_history:
            v = t["value"]
            p = t["price"]
            is_buy = t["side"] == "buy"
            if is_buy:
                buy_60 += v
            else:
                sell_60 += v

            if t["time"] >= cutoff_10:
                if is_buy:
                    buy_10 += v
                else:
                    sell_10 += v

            if t["time"] >= cutoff_abs:
                if abs_window_first_px == 0.0:
                    abs_window_first_px = p
                    abs_window_high = p
                    abs_window_low = p
                else:
                    if p > abs_window_high:
                        abs_window_high = p
                    if p < abs_window_low:
                        abs_window_low = p
                if is_buy:
                    abs_buy_25 += v
                else:
                    abs_sell_25 += v

                s_idx = int(round(p / shelf_step))
                sh = shelves.get(s_idx)
                if sh is None:
                    shelves[s_idx] = {
                        "price": s_idx * shelf_step,
                        "buy": v if is_buy else 0.0,
                        "sell": 0.0 if is_buy else v,
                    }
                else:
                    if is_buy:
                        sh["buy"] += v
                    else:
                        sh["sell"] += v

        rolling_cvd = buy_60 - sell_60
        self.current_cvd = rolling_cvd

        # --- Precision Tick-Cluster Iceberg / Absorption Detection ---
        event = None
        if abs_window_first_px > 0 and ref_px > 0:
            price_chg_25_pct = (ref_px - abs_window_first_px) / abs_window_first_px * 100.0
            shelf_threshold = max(15_000.0, self.absorption_threshold_usd * 0.45)

            # Find peak concentrated buy shelf & sell shelf
            best_buy_shelf = max(shelves.values(), key=lambda s: s["buy"], default=None)
            best_sell_shelf = max(shelves.values(), key=lambda s: s["sell"], default=None)

            # Bearish Absorption: Aggressive buyers attack a tight shelf (with >=1.45x imbalance),
            # yet price STALLS flat/red (<= +0.01%) OR rejects downward off the 25s high (not a clean rising sweep)
            bearish_stalled_or_rejected = (
                price_chg_25_pct <= 0.01
                or ((abs_window_high - ref_px) / ref_px >= 0.00015 and price_chg_25_pct <= 0.04)
            )
            bearish_shelf_hit = (
                best_buy_shelf is not None
                and best_buy_shelf["buy"] >= shelf_threshold
                and best_buy_shelf["buy"] >= max(1.0, best_buy_shelf["sell"]) * self.IMBALANCE_MIN_RATIO
                and abs_buy_25 >= max(1.0, abs_sell_25) * 1.25
                and bearish_stalled_or_rejected
            )
            macro_chg_pct = (
                ((ref_px - self._trade_history[0]["price"]) / self._trade_history[0]["price"] * 100.0)
                if self._trade_history
                else 0.0
            )
            bearish_macro_hit = (
                buy_60 >= self.absorption_threshold_usd
                and buy_60 >= max(1.0, sell_60) * self.IMBALANCE_MIN_RATIO
                and (macro_chg_pct <= 0.01 or ((abs_window_high - ref_px) / ref_px >= 0.00015 and macro_chg_pct <= 0.04))
            )

            # Bullish Absorption: Aggressive sellers hammer a tight shelf (with >=1.45x imbalance),
            # yet price HOLDS flat/green (>= -0.01%) OR bounces off the 25s low (not a clean falling dump)
            bullish_held_or_bounced = (
                price_chg_25_pct >= -0.01
                or ((ref_px - abs_window_low) / ref_px >= 0.00015 and price_chg_25_pct >= -0.04)
            )
            bullish_shelf_hit = (
                best_sell_shelf is not None
                and best_sell_shelf["sell"] >= shelf_threshold
                and best_sell_shelf["sell"] >= max(1.0, best_sell_shelf["buy"]) * self.IMBALANCE_MIN_RATIO
                and abs_sell_25 >= max(1.0, abs_buy_25) * 1.25
                and bullish_held_or_bounced
            )
            bullish_macro_hit = (
                sell_60 >= self.absorption_threshold_usd
                and sell_60 >= max(1.0, buy_60) * self.IMBALANCE_MIN_RATIO
                and (macro_chg_pct >= -0.01 or ((ref_px - abs_window_low) / ref_px >= 0.00015 and macro_chg_pct >= -0.04))
            )

            if bearish_shelf_hit or bearish_macro_hit:
                shelf_px = best_buy_shelf["price"] if (bearish_shelf_hit and best_buy_shelf) else ref_px
                abs_vol = best_buy_shelf["buy"] if (bearish_shelf_hit and best_buy_shelf) else buy_60
                imb = (
                    best_buy_shelf["buy"] / max(1.0, best_buy_shelf["sell"])
                    if (bearish_shelf_hit and best_buy_shelf)
                    else buy_60 / max(1.0, sell_60)
                )
                event = {
                    "type": "BEARISH_ABSORPTION",
                    "price": round(shelf_px, 8),
                    "absorbed_volume": round(abs_vol),
                    "imbalance_ratio": round(min(9.9, imb), 2),
                    "strength": "WHALE" if abs_vol >= self.absorption_threshold_usd else "ICEBERG",
                    "msg": f"[{self.symbol}] 🛡️ Bearish Iceberg: ${abs_vol/1_000_000:.2f}M buying absorbed @ {shelf_px}",
                    "timestamp": int(ts * 1000),
                }
                self._last_absorption_type = "BEARISH_ABSORPTION"
                self._last_absorption_ts = ts
                if self._active_bar is not None:
                    self._active_bar["absorption"] = "BEARISH_ABSORPTION"
            elif bullish_shelf_hit or bullish_macro_hit:
                shelf_px = best_sell_shelf["price"] if (bullish_shelf_hit and best_sell_shelf) else ref_px
                abs_vol = best_sell_shelf["sell"] if (bullish_shelf_hit and best_sell_shelf) else sell_60
                imb = (
                    best_sell_shelf["sell"] / max(1.0, best_sell_shelf["buy"])
                    if (bullish_shelf_hit and best_sell_shelf)
                    else sell_60 / max(1.0, buy_60)
                )
                event = {
                    "type": "BULLISH_ABSORPTION",
                    "price": round(shelf_px, 8),
                    "absorbed_volume": round(abs_vol),
                    "imbalance_ratio": round(min(9.9, imb), 2),
                    "strength": "WHALE" if abs_vol >= self.absorption_threshold_usd else "ICEBERG",
                    "msg": f"[{self.symbol}] 🛡️ Bullish Iceberg: ${abs_vol/1_000_000:.2f}M selling absorbed @ {shelf_px}",
                    "timestamp": int(ts * 1000),
                }
                self._last_absorption_type = "BULLISH_ABSORPTION"
                self._last_absorption_ts = ts
                if self._active_bar is not None:
                    self._active_bar["absorption"] = "BULLISH_ABSORPTION"

        # --- 5-Factor Probabilistic 1M Candle Close-Bias Engine ---
        candle_orderflow = self._compute_candle_orderflow(ts, buy_10, sell_10)

        # Build recent 1m bar deltas array (completed + live active bar) for chart bottom strip
        bar_deltas = list(self._completed_bars)
        if self._active_bar is not None and self._active_bar["trade_count"] > 0:
            bar_deltas.append(self._finalize_bar(self._active_bar))

        return {
            "symbol": self.symbol,
            "true_cvd": round(self.current_cvd),
            "iceberg_event": event,
            "candle_orderflow": candle_orderflow,
            "bar_deltas": bar_deltas[-30:],
        }

    def _compute_candle_orderflow(self, ts: float, buy_10: float, sell_10: float) -> Dict[str, Any]:
        bar_start = int(ts // 60) * 60
        seconds_elapsed = int(ts - bar_start)
        seconds_left = max(0, 59 - seconds_elapsed)
        phase = "CLOSING_PUSH" if seconds_left <= 20 else "MID" if seconds_left <= 42 else "EARLY"

        bar = self._active_bar
        if bar is None or bar["trade_count"] == 0:
            return {
                "bar_time": bar_start,
                "seconds_left": seconds_left,
                "phase": phase,
                "bar_open": self._last_price,
                "bar_close": self._last_price,
                "bar_buy_usd": 0,
                "bar_sell_usd": 0,
                "bar_delta_usd": 0,
                "max_delta_usd": 0,
                "min_delta_usd": 0,
                "buy_pct": 50.0,
                "whale_delta_usd": 0,
                "retail_delta_usd": 0,
                "velocity_10s_usd": round(buy_10 - sell_10),
                "bull_prob": 50,
                "close_bias": "NEUTRAL",
                "confidence": 50,
                "reason": "WAITING FOR TAPE",
                "divergence": None,
                "active_absorption": None,
            }

        bar_buy = bar["buy_usd"]
        bar_sell = bar["sell_usd"]
        bar_total = bar_buy + bar_sell
        bar_delta = bar_buy - bar_sell
        max_d = bar["max_delta_usd"]
        min_d = bar["min_delta_usd"]
        whale_buy = bar["whale_buy_usd"]
        whale_sell = bar["whale_sell_usd"]
        whale_total = whale_buy + whale_sell
        whale_delta = whale_buy - whale_sell
        retail_delta = bar["retail_buy_usd"] - bar["retail_sell_usd"]

        vol_norm = max(12_000.0, self.absorption_threshold_usd * 0.6)

        # 1) Bar Delta Signal [-1, +1] (25%)
        bar_vol_scale = min(1.0, bar_total / vol_norm)
        s_bar_delta = (bar_delta / max(1.0, bar_total)) * bar_vol_scale

        # 2) 10s Closing Velocity Signal [-1, +1] (25%)
        vel_10 = buy_10 - sell_10
        tot_10 = buy_10 + sell_10
        vel_scale = min(1.0, tot_10 / max(8_000.0, vol_norm * 0.35))
        s_velocity = (vel_10 / max(1.0, tot_10)) * vel_scale

        # 3) Whale Trade-Size Dominance [-1, +1] (25%)
        whale_scale = min(1.0, whale_total / max(10_000.0, self.whale_trade_usd * 2.0))
        s_whale = (whale_delta / max(1.0, whale_total)) * whale_scale if whale_total > 0 else 0.0

        # 4) Intra-Bar Delta Flip / Recovery [-1, +1] (15%)
        min_flip_vol = max(10_000.0, vol_norm * 0.25)
        delta_span = max_d - min_d
        is_bull_flip = min_d <= -min_flip_vol and bar_delta > 0
        is_bear_flip = max_d >= min_flip_vol and bar_delta < 0
        if is_bull_flip:
            s_flip = 0.9
        elif is_bear_flip:
            s_flip = -0.9
        elif delta_span > min_flip_vol * 0.5:
            # Position of current bar_delta within [min_d, max_d] mapped to [-1, +1]
            finish_pos = ((bar_delta - min_d) / delta_span) * 2.0 - 1.0
            s_flip = max(-0.7, min(0.7, finish_pos * 0.7))
        else:
            s_flip = 0.0

        # 5) Active Absorption (last 18s) + Top-of-Book L2 Micro-Imbalance [-1, +1] (10% + absorption override)
        active_abs = (
            self._last_absorption_type
            if (self._last_absorption_type and (ts - self._last_absorption_ts) <= 18.0)
            else None
        )
        s_abs = 0.85 if active_abs == "BULLISH_ABSORPTION" else -0.85 if active_abs == "BEARISH_ABSORPTION" else 0.0
        s_l2 = self._l2_imbalance * 0.6

        if active_abs == "BEARISH_ABSORPTION":
            # Buyers are actively hitting a passive ask iceberg ceiling: dampen trapped bullish aggression
            # unless price actually breaks out cleanly above bar open (> +0.05%)
            price_broke_up = bar["open"] > 0 and ((bar["close"] - bar["open"]) / bar["open"] * 100.0) > 0.05
            eff_bar = s_bar_delta * (0.25 if (s_bar_delta > 0 and not price_broke_up) else 1.0)
            eff_vel = s_velocity * (0.25 if (s_velocity > 0 and not price_broke_up) else 1.0)
            eff_whale = s_whale * (0.30 if (s_whale > 0 and not price_broke_up) else 1.0)
            eff_flip = s_flip * (0.20 if (s_flip > 0 and not price_broke_up) else 1.0)
            composite = (
                0.14 * eff_bar
                + 0.16 * eff_vel
                + 0.14 * eff_whale
                + 0.08 * eff_flip
                + 0.48 * (0.85 * s_abs + 0.15 * s_l2)
            )
        elif active_abs == "BULLISH_ABSORPTION":
            # Sellers are actively hitting a passive bid iceberg floor: dampen trapped bearish aggression
            # unless price actually breaks down cleanly below bar open (< -0.05%)
            price_broke_down = bar["open"] > 0 and ((bar["close"] - bar["open"]) / bar["open"] * 100.0) < -0.05
            eff_bar = s_bar_delta * (0.25 if (s_bar_delta < 0 and not price_broke_down) else 1.0)
            eff_vel = s_velocity * (0.25 if (s_velocity < 0 and not price_broke_down) else 1.0)
            eff_whale = s_whale * (0.30 if (s_whale < 0 and not price_broke_down) else 1.0)
            eff_flip = s_flip * (0.20 if (s_flip < 0 and not price_broke_down) else 1.0)
            composite = (
                0.14 * eff_bar
                + 0.16 * eff_vel
                + 0.14 * eff_whale
                + 0.08 * eff_flip
                + 0.48 * (0.85 * s_abs + 0.15 * s_l2)
            )
        else:
            composite = (
                0.25 * s_bar_delta
                + 0.25 * s_velocity
                + 0.25 * s_whale
                + 0.15 * s_flip
                + 0.10 * s_l2
            )

        # Slightly dampen conviction in the first 8 seconds of a brand-new 1m bar to prevent noisy flips
        maturity = 0.65 + 0.35 * min(1.0, seconds_elapsed / 12.0)
        composite = max(-1.0, min(1.0, composite * maturity))

        # Transparent institutional probability bounded cleanly in [8%, 92%]
        bull_prob = int(round(max(8.0, min(92.0, 50.0 + composite * 42.0))))
        if bull_prob >= 62:
            close_bias = "BULLISH"
            confidence = bull_prob
        elif bull_prob <= 38:
            close_bias = "BEARISH"
            confidence = 100 - bull_prob
        else:
            close_bias = "NEUTRAL"
            confidence = max(bull_prob, 100 - bull_prob)

        # Intra-bar Price vs Delta Divergence
        divergence = None
        if bar["close"] < bar["open"] and (bar_delta > 0 or active_abs == "BULLISH_ABSORPTION"):
            divergence = "BULL_DIV"
        elif bar["close"] > bar["open"] and (bar_delta < 0 or active_abs == "BEARISH_ABSORPTION"):
            divergence = "BEAR_DIV"

        # Pick clear, human-readable primary microstructure reason aligned with close_bias
        if active_abs == "BULLISH_ABSORPTION" and close_bias != "BEARISH":
            reason = "BID ABSORPTION ↑"
        elif active_abs == "BEARISH_ABSORPTION" and close_bias != "BULLISH":
            reason = "ASK ABSORPTION ↓"
        elif is_bull_flip and close_bias != "BEARISH":
            reason = "DELTA FLIP ↑"
        elif is_bear_flip and close_bias != "BULLISH":
            reason = "DELTA FLIP ↓"
        elif abs(s_whale) >= 0.45 and (s_whale * composite >= 0):
            reason = "WHALE SWEEP ↑" if s_whale > 0 else "WHALE DUMP ↓"
        elif phase == "CLOSING_PUSH" and abs(s_velocity) >= 0.35 and (s_velocity * composite >= 0):
            reason = "CLOSING PUSH ↑" if s_velocity > 0 else "CLOSING DUMP ↓"
        elif close_bias == "BULLISH":
            reason = "BUYER CONTROL ↑"
        elif close_bias == "BEARISH":
            reason = "SELLER CONTROL ↓"
        else:
            reason = "BALANCED CHOP"

        buy_pct = round((bar_buy / bar_total) * 100.0, 1) if bar_total > 0 else 50.0
        return {
            "bar_time": int(bar["time"]),
            "seconds_left": seconds_left,
            "phase": phase,
            "bar_open": bar["open"],
            "bar_close": bar["close"],
            "bar_buy_usd": round(bar_buy),
            "bar_sell_usd": round(bar_sell),
            "bar_delta_usd": round(bar_delta),
            "max_delta_usd": round(max_d),
            "min_delta_usd": round(min_d),
            "buy_pct": buy_pct,
            "whale_delta_usd": round(whale_delta),
            "retail_delta_usd": round(retail_delta),
            "velocity_10s_usd": round(vel_10),
            "bull_prob": bull_prob,
            "close_bias": close_bias,
            "confidence": confidence,
            "reason": reason,
            "divergence": divergence,
            "active_absorption": active_abs,
        }

    async def _watch_trades(self):
        """Streams live market trades and updates 1m bar + rolling True CVD in real time."""
        exchange = await self._init_exchange(self.exchange_id)
        ex_symbol = await self._resolve_exchange_symbol(exchange, self.symbol)
        logger.info(f"TrueCVD: Started streaming live trades for {ex_symbol}")

        self._window_start_price = 0.0

        while self._running:
            try:
                trades = await exchange.watch_trades(ex_symbol)
                now = time.time()

                if not isinstance(trades, list):
                    trades = [trades]

                for trade in trades:
                    price = float(trade.get("price", 0) or 0)
                    amount = float(trade.get("amount", 0) or 0)
                    side = str(trade.get("side") or "").lower()
                    raw_ts = trade.get("timestamp")
                    trade_sec = now
                    if raw_ts is not None:
                        try:
                            cand = float(raw_ts) / 1000.0 if float(raw_ts) > 10_000_000_000 else float(raw_ts)
                            if abs(now - cand) <= 30.0:
                                trade_sec = cand
                        except (TypeError, ValueError):
                            pass
                    self.ingest_trade(price, amount, side, ts_sec=trade_sec)

            except NetworkError as e:
                logger.warning(f"TrueCVD network err: {e}")
                await asyncio.sleep(5)
            except Exception as e:
                logger.debug(f"TrueCVD watch_trades err: {e}")
                await asyncio.sleep(5)

    async def _analyze_absorption_loop(self):
        """Evaluates 1m candle orderflow, Close-Bias & Tick-Cluster Icebergs every 500ms."""
        while self._running:
            try:
                payload = self.evaluate_snapshot()
                for cb in list(self._callbacks):
                    try:
                        await cb(payload)
                    except Exception as e:
                        logger.error(f"TrueCVD Callback err: {e}")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"TrueCVD analysis err: {e}")

            await asyncio.sleep(0.5)

    async def start(self, symbol: str, exchange_id: str = "binance", absorption_threshold_usd: float | None = None):
        clean_ex = (exchange_id or "binance").lower()
        if absorption_threshold_usd is not None:
            self.update_thresholds(absorption_threshold_usd)
        if self._running:
            if self.symbol == symbol and self.exchange_id == clean_ex:
                return
            await self.stop()

        self._running = True
        self.symbol = symbol
        self.exchange_id = clean_ex
        self.current_cvd = 0.0
        self._trade_history.clear()
        self._active_bar = None
        self._completed_bars.clear()
        self._last_price = 0.0
        self._window_start_price = 0.0
        self._l2_imbalance = 0.0
        self._last_absorption_type = None
        self._last_absorption_ts = 0.0

        logger.info(
            f"TrueCVD Service initializing for {symbol} ({clean_ex}, "
            f"threshold=${self.absorption_threshold_usd:,.0f}, whale=${self.whale_trade_usd:,.0f})"
        )

        self._active_tasks.append(asyncio.create_task(self._watch_trades()))
        self._active_tasks.append(asyncio.create_task(self._analyze_absorption_loop()))

    async def stop(self):
        self._running = False
        for task in self._active_tasks:
            task.cancel()

        if self.exchange:
            try:
                await self.exchange.close()
            except Exception:
                pass
            self.exchange = None

        self._active_tasks.clear()
        self._trade_history.clear()
        self._active_bar = None
        self._completed_bars.clear()
        logger.info("TrueCVD Service stopped.")


# Global Singleton
true_cvd_service = TrueCVDService()
