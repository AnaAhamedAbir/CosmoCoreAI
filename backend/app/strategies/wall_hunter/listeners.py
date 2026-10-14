import asyncio
import json
import time
from typing import Optional
from app.strategies.helpers.trading_session_filter import TradingSessionTracker
from app.services.market_depth_service import market_depth_service


class WallHunterListenersMixin:
    """Centralized background loops and listener tasks for WallHunter engines."""

    async def _native_price_loop(self):
        """Cross-Exchange: Fetches native price continuously for accurate risk management while proxy watches orderbook."""
        self.logger.info(f"🔄 Native Price Tracker Started for {self.symbol} on {self.exchange_id}")
        while self.running:
            try:
                if getattr(self, 'public_exchange', None):
                    try:
                        ticker = await self.public_exchange.watch_ticker(self.symbol)
                        self.current_native_price = ticker['last'] if ticker.get('last') else (ticker.get('ask') + ticker.get('bid')) / 2
                    except Exception:
                        try:
                            ticker = await self.public_exchange.fetch_ticker(self.symbol)
                            self.current_native_price = ticker['last'] if ticker.get('last') else (ticker.get('ask') + ticker.get('bid')) / 2
                        except Exception:
                            native_book = await self.public_exchange.fetch_order_book(self.symbol, limit=5)
                            if native_book.get('bids') and native_book.get('asks'):
                                self.current_native_price = (native_book['bids'][0][0] + native_book['asks'][0][0]) / 2
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.warning(f"Native price fetch error: {e}")
            await asyncio.sleep(0.5)

    async def _heartbeat_loop(self):
        """Periodic status logger and indicator state aggregator."""
        while self.running:
            try:
                extras = []

                if getattr(self, 'enable_god_mode_entry_trigger', False):
                    extras.append(f"🤖 God Mode ML (L:{getattr(self, 'god_mode_long_threshold', 80)}/S:{getattr(self, 'god_mode_short_threshold', -80)})")

                any_ut = getattr(self, 'enable_ut_trend_filter', False) or getattr(self, 'enable_ut_entry_trigger', False) or getattr(self, 'enable_ut_trailing_sl', False)
                if any_ut:
                    ut_mode = "Standalone" if (not getattr(self, 'enable_wall_trigger', False) and not getattr(self, 'enable_liq_trigger', False)) else "Confluence"
                    extras.append(f"🤖 UT: {ut_mode}")

                any_st = getattr(self, 'enable_supertrend_trend_filter', False) or getattr(self, 'enable_supertrend_entry_trigger', False) or getattr(self, 'enable_supertrend_trailing_sl', False)
                if any_st:
                    st_mode = "Standalone" if (not getattr(self, 'enable_wall_trigger', False) and not getattr(self, 'enable_liq_trigger', False)) else "Confluence"
                    st_trend = "Unknown"
                    if getattr(self, "supertrend_tracker", None):
                        tdir = self.supertrend_tracker.latest_trend_dir
                        st_trend = "BUY" if tdir == 1 else "SELL" if tdir == -1 else "Unknown"
                    extras.append(f"🌊 ST ({st_trend}): {st_mode}")

                de_status = ""
                if getattr(self, "dual_engine_tracker", None) and self.dual_engine_tracker.is_enabled:
                    de_mode = self.config.get("dual_engine_mode", "Classic").upper()
                    sig = self.dual_engine_tracker.current_state.get('signal', 'NEUTRAL')

                    direction = getattr(self, 'direction', getattr(self, 'strategy_mode', 'auto')).upper()
                    if direction == 'AUTO':
                        wait_str = "" if sig in ['BUY', 'SELL'] else " (Waiting for BUY/SELL)"
                    else:
                        target_sig = 'BUY' if direction == 'LONG' else 'SELL'
                        wait_str = "" if sig == target_sig else f" (Waiting for {target_sig})"

                    if de_mode in ['HYBRID', 'LEGACY']:
                        score = self.dual_engine_tracker.current_state.get('insight_score', 0)
                        de_status = f" | 🧠 Dual Engine [{de_mode}]: {sig}{wait_str} (Score: {score})"
                    else:
                        de_status = f" | 🧠 Dual Engine [CLASSIC]: {sig}{wait_str}"

                # Wick SR live status
                wick_sr_status = ""
                if getattr(self, 'enable_wick_sr', False) and getattr(self, 'wick_sr_tracker', None):
                    levels = self.wick_sr_tracker.levels
                    active = sum(1 for l in levels if l.get('status') == 'ACTIVE')
                    modes_str = "/".join([m.title() for m in getattr(self, 'wick_sr_modes', ['bounce'])])
                    cp = getattr(self.wick_sr_tracker, 'last_close', 0.0)
                    near_levels = sum(1 for l in levels if l.get('status') == 'ACTIVE' and cp > 0 and abs(l['price'] - cp) / cp <= 0.015)

                    if len(levels) > 0 and near_levels == 0:
                        direction = getattr(self, 'direction', getattr(self, 'strategy_mode', 'long'))
                        if direction == 'long':
                            status_str = "👀 Finding support (waiting for signal)..."
                        elif direction == 'short':
                            status_str = "👀 Finding resistance (waiting for signal)..."
                        else:
                            status_str = "👀 Finding zones (waiting for signal)..."
                        wick_sr_status = f" | 🔥 WickSR [{modes_str}] Lvls:{len(levels)} (No near levels) | {status_str}"
                    elif near_levels > 0:
                        active_modes = getattr(self, 'wick_sr_modes', [])
                        if len(active_modes) == 1:
                            if active_modes[0] == 'bounce': action_str = "Bounce rejection"
                            elif active_modes[0] == 'breakout': action_str = "Breakout momentum"
                            elif active_modes[0] == 'sweep': action_str = "Liquidity Sweep (Trap)"
                            elif active_modes[0] == 'retest': action_str = "SR Retest"
                            else: action_str = modes_str
                        else:
                            action_str = f"{modes_str} signals"

                        wick_sr_status = (
                            f" | 🔥 WickSR [{modes_str}] "
                            f"🎯 Near {near_levels} Zones! Watching for {action_str}..."
                        )
                    else:
                        wick_sr_status = " | 🔥 WickSR [Initializing...]"

                extra_str = f" | {' | '.join(extras)}" if extras else ""

                # Session status for heartbeat
                valid_sessions = [s for s in getattr(self, 'trading_sessions', []) if s and s != "None"]
                if valid_sessions:
                    session_active = TradingSessionTracker.is_session_active(self.trading_sessions)
                    display_name = ", ".join(valid_sessions)
                    session_tag = f" | Session: {display_name} [ACTIVE]" if session_active else f" | Session: {display_name} [WAITING]"
                else:
                    session_tag = ""

                pos_status = ""
                if self.active_pos:
                    if self.active_pos.get('entry_order_id'):
                        pos_status = " | ⏳ Waiting for pending entry order to fill"
                    else:
                        pos_status = " | 🛡️ Managing Open Position"

                mode_label = "Futures" if getattr(self, 'trading_mode', 'spot') == 'futures' or hasattr(self, 'leverage') else "Spot"
                self.logger.info(
                    f"💓 [{mode_label}Hunter {self.bot_id}] monitoring {self.symbol} ({mode_label} Mode)"
                    f"{extra_str}{de_status}{wick_sr_status}{session_tag}{pos_status}..."
                )
                await asyncio.sleep(10)
            except Exception as e:
                self.logger.error(f"Heartbeat loop error: {e}")
                await asyncio.sleep(10)

    async def _vpvr_updater_loop(self):
        """VPVR High Volume Nodes update loop (every 5 minutes)."""
        while self.running:
            if not getattr(self, 'vpvr_enabled', False):
                await asyncio.sleep(60)
                continue
            try:
                ohlcv = await self.public_exchange.fetch_ohlcv(self.symbol, timeframe='5m', limit=100)
                if ohlcv:
                    low_prices = [c[3] for c in ohlcv]
                    high_prices = [c[2] for c in ohlcv]
                    vols = [c[5] for c in ohlcv]

                    min_p, max_p = min(low_prices), max(high_prices)
                    if max_p == min_p:
                        await asyncio.sleep(300)
                        continue

                    bins = 50
                    step = (max_p - min_p) / bins
                    profile = [0.0] * bins

                    for c in ohlcv:
                        c_low, c_high, c_vol = c[3], c[2], c[5]
                        c_mid = (c_low + c_high) / 2
                        idx = int((c_mid - min_p) / step)
                        if idx >= bins: idx = bins - 1
                        profile[idx] += c_vol

                    top_indices = sorted(range(bins), key=lambda i: profile[i], reverse=True)[:3]
                    self.top_hvns = [min_p + (i * step) + (step / 2) for i in top_indices]
                    self.logger.info(f"📊 [WallHunter {self.bot_id}] VPVR Updated. Top 3 HVNs: {[f'{h:.6f}' for h in self.top_hvns]}")
            except Exception as e:
                self.logger.error(f"VPVR Update Error: {e}")
            await asyncio.sleep(300)

    async def _trades_listener(self):
        """Background task to watch trades and feed the AbsorptionTracker and IcebergTracker."""
        self.logger.info(f"📣 [WallHunter {self.bot_id}] Starting Trades Listener for CVD Absorption...")
        while self.running:
            try:
                trades = await self.public_exchange.watch_trades(self.symbol)
                if not trades:
                    continue

                for trade in trades:
                    p = float(trade['price'])
                    a = float(trade['amount'])
                    s = trade['side']  # 'buy' (hits ask) or 'sell' (hits bid)

                    if getattr(self, 'enable_absorption', False) and hasattr(self, 'absorption_tracker'):
                        self.absorption_tracker.add_trade(p, a, s)
                    if getattr(self, 'enable_iceberg_trigger', False) and hasattr(self, 'iceberg_tracker'):
                        self.iceberg_tracker.add_trade(p, a, s)
            except Exception as e:
                if self.running:
                    self.logger.warning(f"Trade Listener Error: {e}")
                await asyncio.sleep(1)

    async def _atr_updater_loop(self):
        """Background task to calculate ATR every 1 minute."""
        while self.running:
            if not getattr(self, 'atr_sl_enabled', False) and not getattr(self, 'enable_dynamic_atr_scalp', False):
                await asyncio.sleep(60)
                continue

            try:
                limit = getattr(self, 'atr_period', 14) + 1
                ohlcv = await self.public_exchange.fetch_ohlcv(self.symbol, timeframe='1m', limit=limit)

                if ohlcv and len(ohlcv) >= 2:
                    tr_list = []
                    for i in range(1, len(ohlcv)):
                        high = ohlcv[i][2]
                        low = ohlcv[i][3]
                        prev_close = ohlcv[i-1][4]

                        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
                        tr_list.append(tr)

                    if len(tr_list) >= self.atr_period:
                        recent_trs = tr_list[-self.atr_period:]
                        self.current_atr = sum(recent_trs) / self.atr_period
                        self.logger.info(f"📈 [WallHunter {self.bot_id}] ATR Updated: {self.current_atr:.6f} (Period: {self.atr_period})")
            except Exception as e:
                self.logger.error(f"ATR Update Error: {e}")

            await asyncio.sleep(60)

    async def _liquidation_listener(self):
        """Monitors real-time liquidations from Redis Pub/Sub."""
        self.logger.info(f"🎧 [WallHunter {self.bot_id}] Starting Liquidation Stream Listener...")
        from app.utils import get_redis_client
        r = get_redis_client()
        pubsub = r.pubsub()
        current_ch = None

        while self.running:
            try:
                if not getattr(self, 'enable_liq_trigger', False):
                    if current_ch:
                        pubsub.unsubscribe(current_ch)
                        current_ch = None
                    await asyncio.sleep(2)
                    continue

                target_ch = "stream:liquidations:BTC/USDT" if getattr(self, 'follow_btc_liq', False) else f"stream:liquidations:{self.symbol}"
                if current_ch != target_ch:
                    if current_ch:
                        pubsub.unsubscribe(current_ch)
                    pubsub.subscribe(target_ch)
                    current_ch = target_ch
                    self.logger.info(f"🎧 [WallHunter {self.bot_id}] Monitoring Liquidations: {current_ch}")

                msg = pubsub.get_message(ignore_subscribe_messages=True)
                if msg and msg['type'] == 'message':
                    data = json.loads(msg['data'].decode('utf-8'))
                    liq_amount = float(data.get('amount', 0))
                    liq_side = data.get('side', '').lower()
                    now = time.time()

                    # 1. Cascade Logic
                    if getattr(self, 'enable_liq_cascade', False):
                        self.liq_history.append((now, liq_amount))
                        while self.liq_history and now - self.liq_history[0][0] > getattr(self, 'liq_cascade_window', 60):
                            self.liq_history.popleft()
                        active_amount = sum(a for t, a in self.liq_history)
                    else:
                        active_amount = liq_amount

                    # 2. Dynamic Threshold Logic
                    base_threshold = self.btc_liq_threshold if getattr(self, 'follow_btc_liq', False) else self.liq_threshold
                    active_threshold = base_threshold

                    if getattr(self, 'enable_dynamic_liq', False) and getattr(self, 'current_atr', 0) > 0 and not getattr(self, 'follow_btc_liq', False):
                        try:
                            ob_limit = market_depth_service._normalize_order_book_limit(self.exchange_id, 5)
                            ob = await self.public_exchange.fetch_order_book(self.symbol, limit=ob_limit)
                            current_mid = (ob['bids'][0][0] + ob['asks'][0][0]) / 2 if ob['bids'] and ob['asks'] else 0
                            if current_mid > 0:
                                atr_pct = self.current_atr / current_mid
                                active_threshold = base_threshold * (1 + (atr_pct * 10 * getattr(self, 'dynamic_liq_multiplier', 1.0)))
                        except Exception as e:
                            self.logger.warning(f"Could not calculate active liq threshold, fallback to base: {e}")

                    # 3. Trigger Decision
                    if active_amount >= active_threshold:
                        if not self.active_pos:
                            side = "buy" if liq_side == "sell" else "sell"
                            if getattr(self, 'enable_liq_cascade', False):
                                self.liq_history.clear()

                            reason = f"Liquidation Trigger ({liq_side.upper()} ${active_amount:,.0f} [Thresh: ${active_threshold:,.0f}])"
                            self.logger.info(f"🔥 [LIQ TRIGGER] {reason} on {target_ch}")
                            await self._handle_liquidation_trigger(side, reason=reason)
            except Exception as e:
                self.logger.error(f"Liq Listener Error: {e}")
                await asyncio.sleep(2)
            await asyncio.sleep(0.1)

    async def _handle_liquidation_trigger(self, side: str, reason: str = ""):
        if self.active_pos:
            return
        try:
            ob = await self.public_exchange.fetch_order_book(self.symbol, limit=20)
            if not ob['bids'] or not ob['asks']:
                return

            best_bid = ob['bids'][0][0]
            best_ask = ob['asks'][0][0]
            mid = (best_bid + best_ask) / 2

            # 2. Imbalance Filter (Confluence)
            if getattr(self, 'enable_ob_imbalance', False):
                bid_vol = sum(v for p, v in ob['bids'])
                ask_vol = sum(v for p, v in ob['asks'])
                if side == "buy":
                    ratio = bid_vol / ask_vol if ask_vol > 0 else 999
                else:
                    ratio = ask_vol / bid_vol if bid_vol > 0 else 999

                if ratio < getattr(self, 'ob_imbalance_ratio', 1.5):
                    self.logger.info(f"⏭️ [LIQ] Rejected: OB Imbalance Ratio {ratio:.2f} < {self.ob_imbalance_ratio}")
                    return
                self.logger.info(f"✅ [LIQ] OB Imbalance Confirmed: {ratio:.2f}x")

            # BTC Correlation Anti-Fakeout Check
            if getattr(self, 'enable_btc_correlation', False) and getattr(self, 'btc_correlation_tracker', None):
                if not self.btc_correlation_tracker.is_aligned(side):
                    metrics = self.btc_correlation_tracker.get_metrics_string()
                    self.logger.info(f"🚫 [LIQ][BTC Divergence] Liq entry rejected! {metrics}")
                    return

            # Adaptive Trend Filter Check
            if getattr(self, 'enable_trend_filter', False) and getattr(self, 'trend_finder', None):
                try:
                    klines = await market_depth_service.fetch_ohlcv(self.symbol, self.exchange_id, '1m', 1200)
                    if klines:
                        close_prices = [float(k['close']) for k in klines]
                        volumes = [float(k.get('volume', 0)) for k in klines]
                        trend_analysis = self.trend_finder.analyze_trend(close_prices)
                        is_acceptable, tf_reason = self.trend_finder.is_trend_acceptable(trend_analysis, side)

                        if is_acceptable and getattr(self, 'enable_trend_volume', False):
                            lookback = getattr(self, 'trend_filter_lookback', 20)
                            recent_vols = volumes[-lookback:] if len(volumes) >= lookback else volumes
                            if recent_vols:
                                avg_vol = sum(recent_vols) / len(recent_vols)
                                current_vol = volumes[-1]
                                if current_vol < avg_vol * getattr(self, 'trend_volume_multiplier', 1.5):
                                    is_acceptable = False
                                    tf_reason = f"Rejected: Volume too low ({current_vol:.2f} < {avg_vol * self.trend_volume_multiplier:.2f})"
                                else:
                                    tf_reason += f" | Vol OK ({current_vol:.2f})"

                        if not is_acceptable:
                            self.logger.info(f"🚫 [LIQ][Trend Filter] Liq entry rejected! {tf_reason}")
                            return
                        else:
                            self.logger.info(f"📈 [LIQ][Trend Filter] {tf_reason}")
                except Exception as e:
                    self.logger.warning(f"⚠️ [LIQ][Trend Filter] OHLCV fetch failed: {e}. Allowing trade (pass-through).")

            # 3. Wall Confirmation Filter
            if getattr(self, 'enable_wall_trigger', False):
                strong_wall = False
                target_levels = ob['bids'] if side == "buy" else ob['asks']
                min_wall = getattr(self, 'micro_scalp_min_wall', 10000)
                for level in target_levels:
                    price, v = level[0], level[1]
                    if v >= min_wall:
                        strong_wall = True
                        self.logger.info(f"🔥 [LIQ] Wall Confluence: Found {v:,.0f} wall at {price}")
                        break

                if not strong_wall:
                    self.logger.info(f"⏭️ [LIQ] Rejected: No supporting wall >= {min_wall}")
                    return

            await self.execute_snipe(mid, side, mid, best_bid, best_ask, reason=reason)
        except Exception as e:
            self.logger.error(f"Liq Handler Error: {e}")
