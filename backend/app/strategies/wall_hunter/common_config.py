import asyncio
from typing import List, Dict, Any

def apply_common_config_updates(self, new_config: dict, updates: List[str]):
    # --- NEW: God Mode ML Trigger Live Update ---
    if "enable_god_mode_entry_trigger" in new_config and new_config["enable_god_mode_entry_trigger"] != self.enable_god_mode_entry_trigger:
        self.enable_god_mode_entry_trigger = new_config["enable_god_mode_entry_trigger"]
        updates.append(f"God Mode Trigger: {'ON' if self.enable_god_mode_entry_trigger else 'OFF'}")
    if "god_mode_long_threshold" in new_config and new_config["god_mode_long_threshold"] != self.god_mode_long_threshold:
        self.god_mode_long_threshold = new_config["god_mode_long_threshold"]
        updates.append(f"God Mode Long Thresh: {self.god_mode_long_threshold}")
    if "god_mode_short_threshold" in new_config and new_config["god_mode_short_threshold"] != self.god_mode_short_threshold:
        self.god_mode_short_threshold = new_config["god_mode_short_threshold"]
        updates.append(f"God Mode Short Thresh: {self.god_mode_short_threshold}")
        
    # --- Trading Session Live Update ---
    if "trading_sessions" in new_config and new_config["trading_sessions"] != self.trading_sessions:
        old_sessions = self.trading_sessions
        self.trading_sessions = new_config["trading_sessions"]
        self.logger.info(f"🕒 [Session] Trading sessions updated: {old_sessions} → {self.trading_sessions}")
        # Stop old monitor and restart with new sessions
        if getattr(self, 'session_tracker', None):
            asyncio.create_task(self.session_tracker.stop_monitor())
        from app.strategies.helpers.trading_session_filter import TradingSessionTracker as _TST
        self.session_tracker = _TST(
            bot_instance=self,
            session_names=self.trading_sessions,
            on_session_end=self._on_trading_session_end
        )
        asyncio.create_task(self.session_tracker.start_monitor())
    
    if "vol_threshold" in new_config and new_config["vol_threshold"] != self.vol_threshold:
        updates.append(f"Volume Threshold: {self.vol_threshold} -> {new_config['vol_threshold']}")
        self.vol_threshold = new_config.get("vol_threshold")
        
    if "target_spread" in new_config and new_config["target_spread"] != self.target_spread:
        updates.append(f"Target Spread: {self.target_spread} -> {new_config['target_spread']}")
        self.target_spread = new_config.get("target_spread")
        
    if "trailing_stop" in new_config and new_config["trailing_stop"] != self.tsl_pct:
        updates.append(f"Trailing SL: {self.tsl_pct}% -> {new_config['trailing_stop']}%")
        self.tsl_pct = new_config.get("trailing_stop")
        
    if "tsl_activation_pct" in new_config and new_config["tsl_activation_pct"] != getattr(self, "tsl_activation_pct", 0.0):
        updates.append(f"TSL Activation: {getattr(self, 'tsl_activation_pct', 0.0)}% -> {new_config['tsl_activation_pct']}%")
        self.tsl_activation_pct = new_config.get("tsl_activation_pct")
        
    if "entry_order_timeout" in new_config and new_config["entry_order_timeout"] != getattr(self, "entry_order_timeout", 30.0):
        updates.append(f"Entry Order Timeout: {getattr(self, 'entry_order_timeout', 30.0)}s -> {new_config['entry_order_timeout']}s")
        self.entry_order_timeout = new_config.get("entry_order_timeout")
        
    if "smart_chase_deviation_pct" in new_config and new_config["smart_chase_deviation_pct"] != getattr(self, "smart_chase_deviation_pct", 1.0):
        if new_config.get("sl_order_type") == "smart_chase":
            updates.append(f"Smart Chase Dev: {getattr(self, 'smart_chase_deviation_pct', 1.0)}% -> {new_config['smart_chase_deviation_pct']}%")
        self.smart_chase_deviation_pct = new_config.get("smart_chase_deviation_pct")
        
    if "smart_chase_delay_ms" in new_config and new_config["smart_chase_delay_ms"] != getattr(self, "smart_chase_delay_ms", 1500):
        self.smart_chase_delay_ms = new_config.get("smart_chase_delay_ms")
        
    if "smart_chase_max_attempts" in new_config and new_config["smart_chase_max_attempts"] != getattr(self, "smart_chase_max_attempts", 15):
        self.smart_chase_max_attempts = new_config.get("smart_chase_max_attempts")
        
    if "risk_pct" in new_config and new_config["risk_pct"] != self.initial_risk_pct:
        updates.append(f"Risk Pct: {self.initial_risk_pct}% -> {new_config['risk_pct']}%")
        self.initial_risk_pct = new_config.get("risk_pct")
        
    if "amount_per_trade" in new_config and self.engine and hasattr(self.engine, 'config'):
        old_amount = self.engine.config.get("amount_per_trade")
        if new_config["amount_per_trade"] != old_amount:
            updates.append(f"Trade Amount: {old_amount} -> {new_config['amount_per_trade']}")
            self.engine.config["amount_per_trade"] = new_config["amount_per_trade"]
            
    if "min_wall_lifetime" in new_config and new_config["min_wall_lifetime"] != self.min_wall_lifetime:
        updates.append(f"Spoof Detect (s): {self.min_wall_lifetime} -> {new_config['min_wall_lifetime']}")
        self.min_wall_lifetime = new_config.get("min_wall_lifetime")
        
    if "partial_tp_pct" in new_config and new_config["partial_tp_pct"] != self.partial_tp_pct:
        updates.append(f"Partial TP: {self.partial_tp_pct}% -> {new_config['partial_tp_pct']}%")
        self.partial_tp_pct = new_config.get("partial_tp_pct")
        
    if "sl_breakeven_trigger_pct" in new_config and new_config["sl_breakeven_trigger_pct"] != getattr(self, "sl_breakeven_trigger_pct", 0.0):
        old_trigger = getattr(self, "sl_breakeven_trigger_pct", 0.0)
        updates.append(f"Breakeven Trigger: {old_trigger}% -> {new_config['sl_breakeven_trigger_pct']}%")
        self.sl_breakeven_trigger_pct = new_config.get("sl_breakeven_trigger_pct")
        
    if "sl_breakeven_target_pct" in new_config and new_config["sl_breakeven_target_pct"] != getattr(self, "sl_breakeven_target_pct", 0.0):
        old_target = getattr(self, "sl_breakeven_target_pct", 0.0)
        updates.append(f"Breakeven Target: {old_target}% -> {new_config['sl_breakeven_target_pct']}%")
        self.sl_breakeven_target_pct = new_config.get("sl_breakeven_target_pct")
        
    if "ut_bot_candle_close" in new_config and new_config["ut_bot_candle_close"] != getattr(self, "ut_bot_candle_close", False):
        self.ut_bot_candle_close = new_config.get("ut_bot_candle_close")
        updates.append(f"UT Candle Close: {self.ut_bot_candle_close}")
        
    if "ut_bot_validation_secs" in new_config and new_config["ut_bot_validation_secs"] != getattr(self, "ut_bot_validation_secs", 0):
        self.ut_bot_validation_secs = new_config.get("ut_bot_validation_secs")
        updates.append(f"UT Validation Secs: {self.ut_bot_validation_secs}")
        
    if "ut_bot_retest_snipe" in new_config and new_config["ut_bot_retest_snipe"] != getattr(self, "ut_bot_retest_snipe", False):
        self.ut_bot_retest_snipe = new_config.get("ut_bot_retest_snipe")
        updates.append(f"UT Retest Snipe: {self.ut_bot_retest_snipe}")
        
    if "vpvr_enabled" in new_config and new_config["vpvr_enabled"] != self.vpvr_enabled:
        status = "Enabled" if new_config["vpvr_enabled"] else "Disabled"
        updates.append(f"VPVR Confirmation: {status}")
        self.vpvr_enabled = new_config.get("vpvr_enabled")
        # Manage task lifecycle on toggle
        if self.vpvr_enabled:
            if getattr(self, '_vpvr_task', None) and not self._vpvr_task.done():
                self._vpvr_task.cancel()
            self._vpvr_task = asyncio.create_task(self._vpvr_updater_loop())
            self.logger.info(f"📊 [VPVR] Live-enabled: VPVR updater task started.")
        else:
            if getattr(self, '_vpvr_task', None) and not self._vpvr_task.done():
                self._vpvr_task.cancel()
            self.top_hvns = []
            self.logger.info(f"📊 [VPVR] Live-disabled: VPVR task stopped, HVNs cleared.")

    if "vpvr_tolerance" in new_config and new_config["vpvr_tolerance"] != self.vpvr_tolerance:
        updates.append(f"VPVR Tolerance: {self.vpvr_tolerance}% -> {new_config['vpvr_tolerance']}%")
        self.vpvr_tolerance = new_config.get("vpvr_tolerance")

    if "atr_sl_enabled" in new_config and new_config["atr_sl_enabled"] != self.atr_sl_enabled:
        status = "Enabled" if new_config["atr_sl_enabled"] else "Disabled"
        updates.append(f"ATR Dynamic SL: {status}")
        self.atr_sl_enabled = new_config.get("atr_sl_enabled")
        # Manage task lifecycle on toggle
        any_atr_needed = self.atr_sl_enabled or getattr(self, 'enable_dynamic_atr_scalp', False)
        if any_atr_needed:
            if getattr(self, '_atr_task', None) and not self._atr_task.done():
                self._atr_task.cancel()
            self._atr_task = asyncio.create_task(self._atr_updater_loop())
            self.logger.info(f"📈 [ATR] Live-enabled: ATR updater task started.")
        else:
            if getattr(self, '_atr_task', None) and not self._atr_task.done():
                self._atr_task.cancel()
            self.current_atr = 0.0
            self.logger.info(f"📈 [ATR] Live-disabled: ATR task stopped, current_atr reset.")

    if "atr_period" in new_config and new_config["atr_period"] != self.atr_period:
        updates.append(f"ATR Period: {self.atr_period} -> {new_config['atr_period']}")
        self.atr_period = new_config.get("atr_period")
        
    if "atr_multiplier" in new_config and new_config["atr_multiplier"] != self.atr_multiplier:
        updates.append(f"ATR Multiplier: {self.atr_multiplier} -> {new_config['atr_multiplier']}")
        self.atr_multiplier = new_config.get("atr_multiplier")
        
    if "enable_wall_trigger" in new_config and new_config["enable_wall_trigger"] != self.enable_wall_trigger:
        status = "ON" if new_config["enable_wall_trigger"] else "OFF"
        updates.append(f"Wall Trigger: {status}")
        self.enable_wall_trigger = new_config.get("enable_wall_trigger")
        
    if "max_wall_distance_pct" in new_config and new_config["max_wall_distance_pct"] != self.max_wall_distance_pct:
        updates.append(f"Max Wall Distance %: {self.max_wall_distance_pct} -> {new_config['max_wall_distance_pct']}")
        self.max_wall_distance_pct = new_config.get("max_wall_distance_pct")
        
    if "enable_liq_trigger" in new_config and new_config["enable_liq_trigger"] != self.enable_liq_trigger:
        status = "ON" if new_config["enable_liq_trigger"] else "OFF"
        updates.append(f"Liquidation Trigger: {status}")
        self.enable_liq_trigger = new_config.get("enable_liq_trigger")
        
    if "liq_threshold" in new_config and new_config["liq_threshold"] != self.liq_threshold:
        updates.append(f"{self.symbol} Liq Threshold: {self.liq_threshold} -> {new_config['liq_threshold']}")
        self.liq_threshold = new_config.get("liq_threshold")
        
    if "liq_target_side" in new_config and new_config["liq_target_side"] != getattr(self, 'liq_target_side', 'auto'):
        updates.append(f"Liq Target Side: {getattr(self, 'liq_target_side', 'auto')} -> {new_config['liq_target_side']}")
        self.liq_target_side = new_config.get("liq_target_side").lower()
        
    if "enable_oib_filter" in new_config and new_config["enable_oib_filter"] != getattr(self, "enable_oib_filter", False):
        status = "ON" if new_config["enable_oib_filter"] else "OFF"
        updates.append(f"OIB Filter: {status}")
        self.enable_oib_filter = new_config.get("enable_oib_filter")
        
    if "min_oib_threshold" in new_config and new_config["min_oib_threshold"] != getattr(self, "min_oib_threshold", 0.4):
        if new_config.get("enable_oib_filter", getattr(self, "enable_oib_filter", False)):
            updates.append(f"Min OIB Threshold: {getattr(self, 'min_oib_threshold', 0.4)} -> {new_config['min_oib_threshold']}")
        self.min_oib_threshold = new_config.get("min_oib_threshold")
        
    if "enable_dynamic_atr_scalp" in new_config and new_config["enable_dynamic_atr_scalp"] != getattr(self, "enable_dynamic_atr_scalp", False):
        status = "ON" if new_config["enable_dynamic_atr_scalp"] else "OFF"
        updates.append(f"Dynamic ATR Scalp: {status}")
        self.enable_dynamic_atr_scalp = new_config.get("enable_dynamic_atr_scalp")
        
    if "micro_scalp_atr_multiplier" in new_config and new_config["micro_scalp_atr_multiplier"] != getattr(self, "micro_scalp_atr_multiplier", 0.5):
        if new_config.get("enable_dynamic_atr_scalp", getattr(self, "enable_dynamic_atr_scalp", False)):
            updates.append(f"Scalp ATR Multiplier: {getattr(self, 'micro_scalp_atr_multiplier', 0.5)} -> {new_config['micro_scalp_atr_multiplier']}")
        self.micro_scalp_atr_multiplier = new_config.get("micro_scalp_atr_multiplier")

    if "enable_liq_cascade" in new_config and new_config["enable_liq_cascade"] != getattr(self, "enable_liq_cascade", False):
        status = "ON" if new_config["enable_liq_cascade"] else "OFF"
        updates.append(f"Liq Cascade: {status}")
        self.enable_liq_cascade = new_config.get("enable_liq_cascade")
        
    if "liq_cascade_window" in new_config and new_config["liq_cascade_window"] != getattr(self, "liq_cascade_window", 5):
        if new_config.get("enable_liq_cascade", getattr(self, "enable_liq_cascade", False)):
            updates.append(f"Liq Cascade Window: {getattr(self, 'liq_cascade_window', 5)}s -> {new_config['liq_cascade_window']}s")
        self.liq_cascade_window = new_config.get("liq_cascade_window")
        
    if "enable_dynamic_liq" in new_config and new_config["enable_dynamic_liq"] != getattr(self, "enable_dynamic_liq", False):
        status = "ON" if new_config["enable_dynamic_liq"] else "OFF"
        updates.append(f"Dynamic Liq: {status}")
        self.enable_dynamic_liq = new_config.get("enable_dynamic_liq")
        
    if "dynamic_liq_multiplier" in new_config and new_config["dynamic_liq_multiplier"] != getattr(self, "dynamic_liq_multiplier", 1.0):
        if new_config.get("enable_dynamic_liq", getattr(self, "enable_dynamic_liq", False)):
            updates.append(f"Dynamic Liq Multiplier: {getattr(self, 'dynamic_liq_multiplier', 1.0)}x -> {new_config['dynamic_liq_multiplier']}x")
        self.dynamic_liq_multiplier = new_config.get("dynamic_liq_multiplier")
        
    if "enable_ob_imbalance" in new_config and new_config["enable_ob_imbalance"] != getattr(self, "enable_ob_imbalance", False):
        status = "ON" if new_config["enable_ob_imbalance"] else "OFF"
        updates.append(f"OB Imbalance Filter: {status}")
        self.enable_ob_imbalance = new_config.get("enable_ob_imbalance")
        
    if "ob_imbalance_ratio" in new_config and new_config["ob_imbalance_ratio"] != getattr(self, "ob_imbalance_ratio", 1.5):
        if new_config.get("enable_ob_imbalance", getattr(self, "enable_ob_imbalance", False)):
            updates.append(f"OB Imbalance Ratio: {getattr(self, 'ob_imbalance_ratio', 1.5)} -> {new_config['ob_imbalance_ratio']}")
        self.ob_imbalance_ratio = new_config.get("ob_imbalance_ratio")

    if "enable_proxy_wall" in new_config and new_config["enable_proxy_wall"] != getattr(self, "enable_proxy_wall", False):
        status = "ON" if new_config["enable_proxy_wall"] else "OFF"
        updates.append(f"Proxy Orderbook: {status}")
        self.enable_proxy_wall = new_config.get("enable_proxy_wall")
        
    if "proxy_exchange" in new_config and new_config["proxy_exchange"] != getattr(self, "proxy_exchange", "binance"):
        if new_config.get("enable_proxy_wall", getattr(self, "enable_proxy_wall", False)):
            updates.append(f"Proxy Exchange: {getattr(self, 'proxy_exchange', 'binance')} -> {new_config['proxy_exchange']}")
        self.proxy_exchange = new_config.get("proxy_exchange")
        
    if "proxy_symbol" in new_config and new_config["proxy_symbol"] != getattr(self, "proxy_symbol", ""):
        if new_config.get("enable_proxy_wall", getattr(self, "enable_proxy_wall", False)):
            updates.append(f"Proxy Symbol: {getattr(self, 'proxy_symbol', '')} -> {new_config['proxy_symbol']}")
        self.proxy_symbol = new_config.get("proxy_symbol")
        
    if "enable_micro_scalp" in new_config and new_config["enable_micro_scalp"] != self.enable_micro_scalp:
        status = "ON" if new_config["enable_micro_scalp"] else "OFF"
        updates.append(f"Micro-Scalp: {status}")
        self.enable_micro_scalp = new_config.get("enable_micro_scalp")
        
    if "micro_scalp_profit_ticks" in new_config and new_config["micro_scalp_profit_ticks"] != self.micro_scalp_profit_ticks:
        if new_config.get("enable_micro_scalp", getattr(self, "enable_micro_scalp", False)):
            updates.append(f"Micro-Scalp Ticks: {self.micro_scalp_profit_ticks} -> {new_config['micro_scalp_profit_ticks']}")
        self.micro_scalp_profit_ticks = new_config.get("micro_scalp_profit_ticks")
        
    if "micro_scalp_min_wall" in new_config and new_config["micro_scalp_min_wall"] != self.micro_scalp_min_wall:
        if new_config.get("enable_micro_scalp", getattr(self, "enable_micro_scalp", False)):
            updates.append(f"Micro-Scalp Min Wall: {self.micro_scalp_min_wall} -> {new_config['micro_scalp_min_wall']}")
        self.micro_scalp_min_wall = new_config.get("micro_scalp_min_wall")
        
    if "follow_btc_liq" in new_config and new_config["follow_btc_liq"] != self.follow_btc_liq:
        status = "ON" if new_config["follow_btc_liq"] else "OFF"
        updates.append(f"Follow BTC Liq: {status}")
        self.follow_btc_liq = new_config.get("follow_btc_liq")
        
    if "btc_liq_threshold" in new_config and new_config["btc_liq_threshold"] != self.btc_liq_threshold:
        if new_config.get("follow_btc_liq", getattr(self, "follow_btc_liq", False)):
            updates.append(f"BTC Liq Threshold: {self.btc_liq_threshold} -> {new_config['btc_liq_threshold']}")
        self.btc_liq_threshold = new_config.get("btc_liq_threshold")

    if "enable_absorption" in new_config and new_config["enable_absorption"] != self.enable_absorption:
        status = "ON" if new_config["enable_absorption"] else "OFF"
        updates.append(f"CVD Absorption: {status}")
        self.enable_absorption = new_config.get("enable_absorption")

    if "absorption_threshold" in new_config and new_config["absorption_threshold"] != self.absorption_threshold:
        if new_config.get("enable_absorption", getattr(self, "enable_absorption", False)):
            updates.append(f"Absorption Threshold: ${self.absorption_threshold} -> ${new_config['absorption_threshold']}")
        self.absorption_threshold = new_config.get("absorption_threshold")
        self.absorption_tracker.update_params(threshold=self.absorption_threshold)

    if "absorption_window" in new_config and new_config["absorption_window"] != self.absorption_window:
        if new_config.get("enable_absorption", getattr(self, "enable_absorption", False)):
            updates.append(f"Absorption Window: {self.absorption_window}s -> {new_config['absorption_window']}s")
        self.absorption_window = new_config.get("absorption_window")
        self.absorption_tracker.update_params(window_seconds=self.absorption_window)

    if "enable_iceberg_trigger" in new_config and new_config["enable_iceberg_trigger"] != self.enable_iceberg_trigger:
        status = "ON" if new_config["enable_iceberg_trigger"] else "OFF"
        updates.append(f"Iceberg Trigger: {status}")
        self.enable_iceberg_trigger = new_config.get("enable_iceberg_trigger")

    if "iceberg_time_window_secs" in new_config and new_config["iceberg_time_window_secs"] != self.iceberg_time_window_secs:
        if new_config.get("enable_iceberg_trigger", getattr(self, "enable_iceberg_trigger", False)):
            updates.append(f"Iceberg Window: {self.iceberg_time_window_secs}s -> {new_config['iceberg_time_window_secs']}s")
        self.iceberg_time_window_secs = new_config.get("iceberg_time_window_secs")
        self.iceberg_tracker.update_params(window_seconds=self.iceberg_time_window_secs)

    if "iceberg_min_absorbed_vol" in new_config and new_config["iceberg_min_absorbed_vol"] != self.iceberg_min_absorbed_vol:
        if new_config.get("enable_iceberg_trigger", getattr(self, "enable_iceberg_trigger", False)):
            updates.append(f"Iceberg Min Vol: {self.iceberg_min_absorbed_vol} -> {new_config['iceberg_min_absorbed_vol']}")
        self.iceberg_min_absorbed_vol = new_config.get("iceberg_min_absorbed_vol")
        self.iceberg_tracker.update_params(min_absorbed_vol=self.iceberg_min_absorbed_vol)
        
        
    if "enable_btc_correlation" in new_config and new_config["enable_btc_correlation"] != self.enable_btc_correlation:
        status = "ON" if new_config["enable_btc_correlation"] else "OFF"
        updates.append(f"BTC Correlation Filter: {status}")
        self.enable_btc_correlation = new_config.get("enable_btc_correlation")
        if self.enable_btc_correlation and self.btc_correlation_tracker:
            asyncio.create_task(self.btc_correlation_tracker.start())
        elif not self.enable_btc_correlation and self.btc_correlation_tracker:
            asyncio.create_task(self.btc_correlation_tracker.stop())

    if "btc_correlation_threshold" in new_config and new_config["btc_correlation_threshold"] != self.btc_correlation_threshold:
        if new_config.get("enable_btc_correlation", getattr(self, "enable_btc_correlation", False)):
            updates.append(f"BTC Corr Threshold: {self.btc_correlation_threshold} -> {new_config['btc_correlation_threshold']}")
        self.btc_correlation_threshold = new_config.get("btc_correlation_threshold")
        if self.btc_correlation_tracker:
            self.btc_correlation_tracker.update_params(threshold=self.btc_correlation_threshold)

    if "btc_time_window" in new_config and new_config["btc_time_window"] != self.btc_time_window:
        if new_config.get("enable_btc_correlation", getattr(self, "enable_btc_correlation", False)):
            updates.append(f"BTC Time Window: {self.btc_time_window}m -> {new_config['btc_time_window']}m")
        self.btc_time_window = new_config.get("btc_time_window")
        if self.btc_correlation_tracker:
            self.btc_correlation_tracker.update_params(window_minutes=self.btc_time_window)

    if "btc_min_move_pct" in new_config and new_config["btc_min_move_pct"] != self.btc_min_move_pct:
        if new_config.get("enable_btc_correlation", getattr(self, "enable_btc_correlation", False)):
            updates.append(f"BTC Min Move %: {self.btc_min_move_pct}% -> {new_config['btc_min_move_pct']}%")
        self.btc_min_move_pct = new_config.get("btc_min_move_pct")
        if self.btc_correlation_tracker:
            self.btc_correlation_tracker.update_params(min_move_pct=self.btc_min_move_pct)
            
    if "enable_trend_filter" in new_config and new_config["enable_trend_filter"] != self.enable_trend_filter:
        status = "ON" if new_config["enable_trend_filter"] else "OFF"
        updates.append(f"Adaptive Trend Filter: {status}")
        self.enable_trend_filter = new_config.get("enable_trend_filter")
        if self.enable_trend_filter and not self.trend_finder:
            self.trend_finder = AdaptiveTrendFinder(
                lookback=self.trend_filter_lookback, 
                threshold=self.trend_filter_threshold,
                dev_threshold=getattr(self, 'trend_filter_dev', 2.0),
                enable_volume_filter=getattr(self, 'enable_trend_volume', False),
                volume_multiplier=getattr(self, 'trend_volume_multiplier', 1.5)
            )
        elif not self.enable_trend_filter:
            self.trend_finder = None
            
    if "trend_filter_lookback" in new_config and new_config["trend_filter_lookback"] != self.trend_filter_lookback:
        if new_config.get("enable_trend_filter", getattr(self, "enable_trend_filter", False)):
            updates.append(f"Trend Lookback: {self.trend_filter_lookback} -> {new_config['trend_filter_lookback']}")
        self.trend_filter_lookback = new_config.get("trend_filter_lookback")
        if self.trend_finder:
            self.trend_finder.update_params(lookback=self.trend_filter_lookback)
            
    if "trend_filter_threshold" in new_config and new_config["trend_filter_threshold"] != self.trend_filter_threshold:
        if new_config.get("enable_trend_filter", getattr(self, "enable_trend_filter", False)):
            updates.append(f"Trend Threshold: {self.trend_filter_threshold} -> {new_config['trend_filter_threshold']}")
        self.trend_filter_threshold = new_config.get("trend_filter_threshold")
        if self.trend_finder:
            self.trend_finder.update_params(threshold=self.trend_filter_threshold)
            
    if "trend_filter_dev" in new_config and new_config.get("trend_filter_dev") != getattr(self, "trend_filter_dev", 2.0):
        if new_config.get("enable_trend_filter", getattr(self, "enable_trend_filter", False)):
            updates.append(f"Trend Deviation: {getattr(self, 'trend_filter_dev', 2.0)} -> {new_config['trend_filter_dev']}")
        self.trend_filter_dev = new_config["trend_filter_dev"]
        if self.trend_finder:
            self.trend_finder.update_params(dev_threshold=self.trend_filter_dev)
            
    if "enable_trend_volume" in new_config and new_config.get("enable_trend_volume") != getattr(self, "enable_trend_volume", False):
        updates.append(f"Trend Volume Filter: {'ON' if new_config['enable_trend_volume'] else 'OFF'}")
        self.enable_trend_volume = new_config["enable_trend_volume"]
        if self.trend_finder:
            self.trend_finder.update_params(enable_volume_filter=self.enable_trend_volume)
            
    if "trend_volume_multiplier" in new_config and new_config.get("trend_volume_multiplier") != getattr(self, "trend_volume_multiplier", 1.5):
        if new_config.get("enable_trend_volume", getattr(self, "enable_trend_volume", False)):
            updates.append(f"Trend Volume Multiplier: {getattr(self, 'trend_volume_multiplier', 1.5)} -> {new_config['trend_volume_multiplier']}")
        self.trend_volume_multiplier = new_config["trend_volume_multiplier"]
        if self.trend_finder:
            self.trend_finder.update_params(volume_multiplier=self.trend_volume_multiplier)
        
    if "buy_order_type" in new_config and new_config["buy_order_type"] != self.buy_order_type:
        updates.append(f"Buy Order Type: {self.buy_order_type} -> {new_config['buy_order_type']}")
        self.buy_order_type = new_config.get("buy_order_type")
        
    if "sl_order_type" in new_config and new_config["sl_order_type"] != getattr(self, "sl_order_type", "market"):
        updates.append(f"SL Order Type: {getattr(self, 'sl_order_type', 'market')} -> {new_config['sl_order_type']}")
        self.sl_order_type = new_config.get("sl_order_type")
        
    if "limit_buffer" in new_config and new_config["limit_buffer"] != self.limit_buffer:
        updates.append(f"Limit Buffer: {self.limit_buffer}% -> {new_config['limit_buffer']}%")
        self.limit_buffer = new_config.get("limit_buffer")
        if self.engine:
            self.engine.config["limit_buffer"] = self.limit_buffer
            
    # --- UT Bot Alerts Live Updates ---
    if "enable_ut_trend_filter" in new_config and new_config["enable_ut_trend_filter"] != self.enable_ut_trend_filter:
        status = "ON" if new_config["enable_ut_trend_filter"] else "OFF"
        updates.append(f"UT Bot Trend Filter: {status}")
        self.enable_ut_trend_filter = new_config.get("enable_ut_trend_filter")
        
    if "enable_ut_entry_trigger" in new_config and new_config["enable_ut_entry_trigger"] != self.enable_ut_entry_trigger:
        status = "ON" if new_config["enable_ut_entry_trigger"] else "OFF"
        updates.append(f"UT Bot Entry Trigger: {status}")
        self.enable_ut_entry_trigger = new_config.get("enable_ut_entry_trigger")
        
    if "enable_ut_trailing_sl" in new_config and new_config["enable_ut_trailing_sl"] != self.enable_ut_trailing_sl:
        status = "ON" if new_config["enable_ut_trailing_sl"] else "OFF"
        updates.append(f"UT Bot Trailing SL: {status}")
        self.enable_ut_trailing_sl = new_config.get("enable_ut_trailing_sl")
        
    ut_params = {}
    if "ut_bot_sensitivity" in new_config and new_config["ut_bot_sensitivity"] != self.ut_bot_sensitivity:
        updates.append(f"UT Key Value: {self.ut_bot_sensitivity} -> {new_config['ut_bot_sensitivity']}")
        self.ut_bot_sensitivity = new_config.get("ut_bot_sensitivity")
        ut_params['sensitivity'] = self.ut_bot_sensitivity
        
    if "ut_bot_atr_period" in new_config and new_config["ut_bot_atr_period"] != self.ut_bot_atr_period:
        updates.append(f"UT ATR Period: {self.ut_bot_atr_period} -> {new_config['ut_bot_atr_period']}")
        self.ut_bot_atr_period = new_config.get("ut_bot_atr_period")
        ut_params['atr_period'] = self.ut_bot_atr_period
        
    if "ut_bot_timeframe" in new_config and new_config["ut_bot_timeframe"] != self.ut_bot_timeframe:
        updates.append(f"UT Timeframe: {self.ut_bot_timeframe} -> {new_config['ut_bot_timeframe']}")
        self.ut_bot_timeframe = new_config.get("ut_bot_timeframe")
        ut_params['timeframe'] = self.ut_bot_timeframe
        
    if "ut_bot_use_heikin_ashi" in new_config and new_config["ut_bot_use_heikin_ashi"] != self.ut_bot_use_heikin_ashi:
        status = "ON" if new_config["ut_bot_use_heikin_ashi"] else "OFF"
        updates.append(f"UT Heikin Ashi: {status}")
        self.ut_bot_use_heikin_ashi = new_config.get("ut_bot_use_heikin_ashi")
        ut_params['use_heikin_ashi'] = self.ut_bot_use_heikin_ashi
        
    any_ut_enabled = self.enable_ut_trend_filter or self.enable_ut_entry_trigger or self.enable_ut_trailing_sl
    if any_ut_enabled:
        if not getattr(self, 'ut_bot_tracker', None):
            self.ut_bot_tracker = UTBotTracker(
                exchange_id=self.exchange_id, symbol=self.symbol,
                sensitivity=self.ut_bot_sensitivity, atr_period=self.ut_bot_atr_period,
                use_heikin_ashi=self.ut_bot_use_heikin_ashi, timeframe=self.ut_bot_timeframe)
            if hasattr(self, '_utbot_task'):
                self._utbot_task = asyncio.create_task(self.ut_bot_tracker.start())
        elif ut_params:
            self.ut_bot_tracker.update_params(**ut_params)
    else:
        if getattr(self, 'ut_bot_tracker', None):
            asyncio.create_task(self.ut_bot_tracker.stop())
            self.ut_bot_tracker = None

    # --- ML L2 Filter Live Sync ---
    if "enable_ml_filter" in new_config:
        self.enable_ml_filter = new_config["enable_ml_filter"]
        updates.append(f"ML L2 Filter: {'ON' if self.enable_ml_filter else 'OFF'}")
        
    if "ml_execution_mode" in new_config:
        self.ml_execution_mode = new_config["ml_execution_mode"]
        updates.append(f"ML Mode: {self.ml_execution_mode.upper()}")
    
    if "ai_model_id" in new_config:
        self.ai_model_id = new_config["ai_model_id"]
        updates.append(f"AI Model ID: {self.ai_model_id}")

    if "enable_ml_filter" in new_config or "ai_model_id" in new_config:
        if getattr(self, "enable_ml_filter", False) and getattr(self, "ai_model_id", ""):
            try:
                from app.strategies.helpers.ml_l2_predictor import MLL2Predictor
                self.ml_predictor = MLL2Predictor(self.ai_model_id)
                if not getattr(self, '_ml_standalone_task', None) or self._ml_standalone_task.done():
                    self._ml_standalone_task = asyncio.create_task(self.ml_standalone_listener.start())
            except Exception as e:
                self.logger.error(f"Failed to initialize ML Predictor on live update: {e}")
        else:
            if getattr(self, '_ml_standalone_task', None) and not self._ml_standalone_task.done():
                self._ml_standalone_task.cancel()
            self._ml_standalone_task = None

    # --- Supertrend Alerts Live Updates ---
    if "enable_supertrend_trend_filter" in new_config and new_config["enable_supertrend_trend_filter"] != self.enable_supertrend_trend_filter:
        self.enable_supertrend_trend_filter = new_config["enable_supertrend_trend_filter"]
        updates.append(f"ST Trend Filter: {'ON' if self.enable_supertrend_trend_filter else 'OFF'}")
    if "enable_supertrend_entry_trigger" in new_config and new_config["enable_supertrend_entry_trigger"] != self.enable_supertrend_entry_trigger:
        self.enable_supertrend_entry_trigger = new_config["enable_supertrend_entry_trigger"]
        updates.append(f"ST Entry Trigger: {'ON' if self.enable_supertrend_entry_trigger else 'OFF'}")
    if "enable_supertrend_trailing_sl" in new_config and new_config["enable_supertrend_trailing_sl"] != self.enable_supertrend_trailing_sl:
        self.enable_supertrend_trailing_sl = new_config["enable_supertrend_trailing_sl"]
        updates.append(f"ST Trailing SL: {'ON' if self.enable_supertrend_trailing_sl else 'OFF'}")
    if "enable_supertrend_exit" in new_config and new_config["enable_supertrend_exit"] != self.enable_supertrend_exit:
        self.enable_supertrend_exit = new_config["enable_supertrend_exit"]
        updates.append(f"ST Exit Signal: {'ON' if self.enable_supertrend_exit else 'OFF'}")
    if "enable_supertrend_trend_unlock_mode" in new_config:
        self.supertrend_trend_unlock_mode = new_config["enable_supertrend_trend_unlock_mode"]
    if "supertrend_exit_timeout" in new_config:
        self.supertrend_exit_timeout = new_config["supertrend_exit_timeout"]
    if "supertrend_candle_close" in new_config:
        self.supertrend_candle_close = new_config["supertrend_candle_close"]

    st_params = {}
    if "supertrend_period" in new_config and new_config["supertrend_period"] != self.supertrend_period:
        updates.append(f"ST ATR Period: {self.supertrend_period} -> {new_config['supertrend_period']}")
        self.supertrend_period = new_config["supertrend_period"]
        st_params['atr_period'] = self.supertrend_period
    if "supertrend_multiplier" in new_config and new_config["supertrend_multiplier"] != self.supertrend_multiplier:
        updates.append(f"ST Multiplier: {self.supertrend_multiplier} -> {new_config['supertrend_multiplier']}")
        self.supertrend_multiplier = new_config["supertrend_multiplier"]
        st_params['multiplier'] = self.supertrend_multiplier
    if "supertrend_timeframe" in new_config and new_config["supertrend_timeframe"] != self.supertrend_timeframe:
        updates.append(f"ST Timeframe: {self.supertrend_timeframe} -> {new_config['supertrend_timeframe']}")
        self.supertrend_timeframe = new_config["supertrend_timeframe"]
        st_params['timeframe'] = self.supertrend_timeframe

    any_st_enabled = self.enable_supertrend_trend_filter or self.enable_supertrend_entry_trigger or self.enable_supertrend_trailing_sl or self.enable_supertrend_exit
    if any_st_enabled:
        if not getattr(self, 'supertrend_tracker', None):
            self.supertrend_tracker = SupertrendTracker(
                exchange_id=self.exchange_id, symbol=self.symbol,
                atr_period=self.supertrend_period, multiplier=self.supertrend_multiplier,
                timeframe=self.supertrend_timeframe)
            if hasattr(self, '_supertrend_task'):
                self._supertrend_task = asyncio.create_task(self.supertrend_tracker.start())
        elif st_params:
            self.supertrend_tracker.update_params(**st_params)
    else:
        if getattr(self, 'supertrend_tracker', None):
            asyncio.create_task(self.supertrend_tracker.stop())
            self.supertrend_tracker = None

    if "enable_dual_engine" in new_config and new_config["enable_dual_engine"] != getattr(self.dual_engine_tracker, "is_enabled", False):
        status = "ON" if new_config["enable_dual_engine"] else "OFF"
        updates.append(f"Dual Engine Tracker: {status}")
        
    if getattr(self, 'dual_engine_tracker', None) is not None:
        self.dual_engine_tracker.update_params(
            is_enabled=new_config.get("enable_dual_engine", self.dual_engine_tracker.is_enabled),
            use_ema_filter=new_config.get("dual_engine_ema_filter", getattr(self.dual_engine_tracker, 'use_ema_filter', False)),
            use_rsi_filter=new_config.get("dual_engine_rsi_filter", getattr(self.dual_engine_tracker, 'use_rsi_filter', False)),
            use_candle_filter=new_config.get("dual_engine_candle_filter", getattr(self.dual_engine_tracker, 'use_candle_filter', False)),
            use_macd_filter=new_config.get("dual_engine_macd_filter", getattr(self.dual_engine_tracker, 'use_macd_filter', False)),
            use_squeeze_filter=new_config.get("dual_engine_squeeze_filter", getattr(self.dual_engine_tracker, 'use_squeeze_filter', False)),
            ema_length=new_config.get("dual_engine_ema_length", getattr(self.dual_engine_tracker, 'ema_length', 100)),
            rsi_length=new_config.get("dual_engine_rsi_length", getattr(self.dual_engine_tracker, 'rsi_length', 14)),
            rsi_ob=new_config.get("dual_engine_rsi_ob", getattr(self.dual_engine_tracker, 'rsi_ob', 70)),
            rsi_os=new_config.get("dual_engine_rsi_os", getattr(self.dual_engine_tracker, 'rsi_os', 30)),
            macd_fast=new_config.get("dual_engine_macd_fast", getattr(self.dual_engine_tracker, 'macd_fast', 12)),
            macd_slow=new_config.get("dual_engine_macd_slow", getattr(self.dual_engine_tracker, 'macd_slow', 26)),
            macd_signal=new_config.get("dual_engine_macd_signal", getattr(self.dual_engine_tracker, 'macd_signal', 9)),
            squeeze_length=new_config.get("dual_engine_squeeze_length", getattr(self.dual_engine_tracker, 'squeeze_length', 20)),
            squeeze_bb_mult=new_config.get("dual_engine_squeeze_bb_mult", getattr(self.dual_engine_tracker, 'squeeze_bb_mult', 2.0)),
            squeeze_kc_mult=new_config.get("dual_engine_squeeze_kc_mult", getattr(self.dual_engine_tracker, 'squeeze_kc_mult', 1.5)),
            timeframe=new_config.get("dual_engine_timeframe", getattr(self.dual_engine_tracker, 'timeframe', '1m')),
            use_triple_ema_filter=new_config.get("dual_engine_triple_ema_filter", getattr(self.dual_engine_tracker, 'use_triple_ema_filter', False)),
            use_adx_filter=new_config.get("dual_engine_adx_filter", getattr(self.dual_engine_tracker, 'use_adx_filter', False)),
            use_vol_filter=new_config.get("dual_engine_vol_filter", getattr(self.dual_engine_tracker, 'use_vol_filter', False)),
            adx_length=new_config.get("dual_engine_adx_length", getattr(self.dual_engine_tracker, 'adx_length', 14)),
            adx_threshold=new_config.get("dual_engine_adx_threshold", getattr(self.dual_engine_tracker, 'adx_threshold', 25)),
            vol_length=new_config.get("dual_engine_vol_length", getattr(self.dual_engine_tracker, 'vol_length', 20)),
            vol_multiplier=new_config.get("dual_engine_vol_multiplier", getattr(self.dual_engine_tracker, 'vol_multiplier', 1.5)),
        )

    # --- Smart Wick SR Live Updates ---
    if "enable_wick_sr" in new_config and new_config["enable_wick_sr"] != self.enable_wick_sr:
        status = "ON" if new_config["enable_wick_sr"] else "OFF"
        updates.append(f"Wick SR Trigger: {status}")
        self.enable_wick_sr = new_config.get("enable_wick_sr")
        if self.enable_wick_sr:
            if not getattr(self, "wick_sr_tracker", None):
                self.wick_sr_tracker = WickSRTracker(
                    timeframe=self.wick_sr_timeframe,
                    sweep_threshold_candles=self.wick_sr_sweep_threshold,
                    min_touches=self.wick_sr_min_touches,
                    atr_period=self.wick_sr_atr_period,
                    atr_multiplier=self.wick_sr_atr_multiplier
                )
            if hasattr(self, '_wick_sr_task') and not self._wick_sr_task:
                self.wick_sr_listener.tracker = self.wick_sr_tracker
                self._wick_sr_task = asyncio.create_task(self.wick_sr_listener.start())
        else:
            if hasattr(self, 'wick_sr_listener') and self.wick_sr_listener.running:
                asyncio.create_task(self.wick_sr_listener.stop())

    if "wick_sr_timeframe" in new_config and new_config["wick_sr_timeframe"] != self.wick_sr_timeframe:
        updates.append(f"Wick SR Timeframe: {self.wick_sr_timeframe} -> {new_config['wick_sr_timeframe']}")
        self.wick_sr_timeframe = new_config.get("wick_sr_timeframe")
        if getattr(self, "wick_sr_tracker", None):
            self.wick_sr_tracker.timeframe = self.wick_sr_timeframe

    if "wick_sr_modes" in new_config and new_config["wick_sr_modes"] != self.wick_sr_modes:
        updates.append(f"Wick SR Modes Updated: {new_config['wick_sr_modes']}")
        self.wick_sr_modes = new_config.get("wick_sr_modes")

    if "wick_sr_sweep_threshold" in new_config and new_config["wick_sr_sweep_threshold"] != self.wick_sr_sweep_threshold:
        self.wick_sr_sweep_threshold = new_config.get("wick_sr_sweep_threshold")
        if getattr(self, "wick_sr_tracker", None):
            self.wick_sr_tracker.sweep_threshold_candles = self.wick_sr_sweep_threshold

    if "wick_sr_min_touches" in new_config and new_config["wick_sr_min_touches"] != getattr(self, "wick_sr_min_touches", 10):
        self.wick_sr_min_touches = new_config.get("wick_sr_min_touches")
        if getattr(self, "wick_sr_tracker", None):
            self.wick_sr_tracker.min_touches = self.wick_sr_min_touches

    if "wick_sr_lookback" in new_config and new_config["wick_sr_lookback"] != getattr(self, "wick_sr_lookback", 300):
        self.wick_sr_lookback = new_config.get("wick_sr_lookback")

    if "wick_sr_atr_period" in new_config and new_config["wick_sr_atr_period"] != getattr(self, "wick_sr_atr_period", 14):
        self.wick_sr_atr_period = new_config.get("wick_sr_atr_period")
        if getattr(self, "wick_sr_tracker", None):
            self.wick_sr_tracker.atr_period = self.wick_sr_atr_period

    if "wick_sr_atr_multiplier" in new_config and new_config["wick_sr_atr_multiplier"] != getattr(self, "wick_sr_atr_multiplier", 0.5):
        self.wick_sr_atr_multiplier = new_config.get("wick_sr_atr_multiplier")
        if getattr(self, "wick_sr_tracker", None):
            self.wick_sr_tracker.atr_multiplier = self.wick_sr_atr_multiplier

    if "enable_wick_sr_oib" in new_config and new_config["enable_wick_sr_oib"] != getattr(self, "enable_wick_sr_oib", False):
        self.enable_wick_sr_oib = new_config.get("enable_wick_sr_oib", False)
        updates.append(f"Wick SR OIB Confluence: {'ON' if self.enable_wick_sr_oib else 'OFF'}")
        
    if "enable_dynamic_wick_tp" in new_config and new_config["enable_dynamic_wick_tp"] != getattr(self, "enable_dynamic_wick_tp", False):
        self.enable_dynamic_wick_tp = new_config.get("enable_dynamic_wick_tp", False)
        updates.append(f"Dynamic Wick TP: {'ON' if self.enable_dynamic_wick_tp else 'OFF'}")
        
    if "dynamic_tp_frontrun_pct" in new_config and new_config["dynamic_tp_frontrun_pct"] != getattr(self, "dynamic_tp_frontrun_pct", 0.0):
        self.dynamic_tp_frontrun_pct = new_config.get("dynamic_tp_frontrun_pct", 0.0)
        updates.append(f"Dynamic TP Front-Run: {self.dynamic_tp_frontrun_pct}%")

    if "enable_auto_fibo_tp" in new_config and new_config["enable_auto_fibo_tp"] != getattr(self, "enable_auto_fibo_tp", False):
        self.enable_auto_fibo_tp = new_config.get("enable_auto_fibo_tp", False)
        updates.append(f"Auto-Fibo Max TP: {'ON' if self.enable_auto_fibo_tp else 'OFF'}")
        
    if "auto_fibo_target_level" in new_config and new_config["auto_fibo_target_level"] != getattr(self, "auto_fibo_target_level", 1.618):
        self.auto_fibo_target_level = new_config.get("auto_fibo_target_level", 1.618)
        updates.append(f"Auto-Fibo Target Level: {self.auto_fibo_target_level}")

    if "auto_fibo_timeframe" in new_config and new_config["auto_fibo_timeframe"] != getattr(self, "auto_fibo_timeframe", "5m"):
        self.auto_fibo_timeframe = new_config.get("auto_fibo_timeframe", "5m")
        updates.append(f"Auto-Fibo Timeframe: {self.auto_fibo_timeframe}")
        
    if "auto_fibo_lookback" in new_config and new_config["auto_fibo_lookback"] != getattr(self, "auto_fibo_lookback", 30):
        self.auto_fibo_lookback = new_config.get("auto_fibo_lookback", 30)
        updates.append(f"Auto-Fibo Lookback: {self.auto_fibo_lookback}")
        
    # --- VWAP SD Config Updates ---
    if "enable_vwap_sd_snipe" in new_config and new_config["enable_vwap_sd_snipe"] != getattr(self, "enable_vwap_sd_snipe", False):
        self.enable_vwap_sd_snipe = new_config.get("enable_vwap_sd_snipe", False)
        updates.append(f"VWAP SD Snipe: {'ON' if self.enable_vwap_sd_snipe else 'OFF'}")
        
        if self.enable_vwap_sd_snipe:
            if not getattr(self, "vwap_sd_tracker", None):
                self.vwap_sd_tracker = VWAPSDTracker(
                    anchor=getattr(self, "vwap_sd_anchor", "Daily"),
                    mult3=getattr(self, "vwap_sd_multiplier", 3.0)
                )
            if not getattr(self, "vwap_sd_listener", None):
                self.vwap_sd_listener = VWAPSDStandaloneListener(self)
            if hasattr(self, '_vwap_sd_task') and not self._vwap_sd_task:
                self._vwap_sd_task = asyncio.create_task(self.vwap_sd_listener.start())
        else:
            if hasattr(self, 'vwap_sd_listener') and self.vwap_sd_listener.running:
                self.vwap_sd_listener.running = False

    if "vwap_sd_anchor" in new_config and new_config["vwap_sd_anchor"] != getattr(self, "vwap_sd_anchor", "Daily"):
        self.vwap_sd_anchor = new_config.get("vwap_sd_anchor", "Daily")
        updates.append(f"VWAP SD Anchor: {self.vwap_sd_anchor}")
        if getattr(self, "vwap_sd_tracker", None):
            self.vwap_sd_tracker.anchor = self.vwap_sd_anchor

    if "vwap_sd_multiplier" in new_config and new_config["vwap_sd_multiplier"] != getattr(self, "vwap_sd_multiplier", 3.0):
        self.vwap_sd_multiplier = new_config.get("vwap_sd_multiplier", 3.0)
        updates.append(f"VWAP SD Multiplier: {self.vwap_sd_multiplier}")
        if getattr(self, "vwap_sd_tracker", None):
            self.vwap_sd_tracker.mult3 = self.vwap_sd_multiplier

    if "vwap_sd_min_wall" in new_config and new_config["vwap_sd_min_wall"] != getattr(self, "vwap_sd_min_wall", 500000.0):
        self.vwap_sd_min_wall = new_config.get("vwap_sd_min_wall", 500000.0)
        updates.append(f"VWAP SD Min Wall: {self.vwap_sd_min_wall}")

    # Update internal config dictionary
    self.config.update(new_config)
    
    if "enable_zero_tolerance" in new_config or "zero_tolerance_ticks" in new_config:
        new_enable = new_config.get("enable_zero_tolerance", getattr(self.zero_tolerance_tracker, "enable_zero_tolerance", False))
        new_ticks = new_config.get("zero_tolerance_ticks", getattr(self.zero_tolerance_tracker, "zero_tolerance_ticks", 0))
        if new_enable != getattr(self.zero_tolerance_tracker, "enable_zero_tolerance", False) or new_ticks != getattr(self.zero_tolerance_tracker, "zero_tolerance_ticks", 0):
            updates.append(f"Zero Tolerance: {'ON' if new_enable else 'OFF'} ({new_ticks} Ticks)")
            self.zero_tolerance_tracker.update_params(new_enable, new_ticks)
    

    # --- Live Auto-Stop Config Update ---
    if hasattr(self, 'auto_stop_manager') and self.auto_stop_manager:
        if "enable_breakeven_stop" in new_config and new_config["enable_breakeven_stop"] != self.auto_stop_manager.enable_breakeven_stop:
            old_val = "ON" if self.auto_stop_manager.enable_breakeven_stop else "OFF"
            new_val = "ON" if new_config["enable_breakeven_stop"] else "OFF"
            self.auto_stop_manager.enable_breakeven_stop = new_config["enable_breakeven_stop"]
            updates.append(f"Break-even Protection: {old_val} -> {new_val}")
            
        if "global_tp_target" in new_config and new_config["global_tp_target"] != self.auto_stop_manager.global_tp_target:
            updates.append(f"Global TP Target: ${self.auto_stop_manager.global_tp_target} -> ${new_config['global_tp_target']}")
            self.auto_stop_manager.global_tp_target = float(new_config["global_tp_target"])

