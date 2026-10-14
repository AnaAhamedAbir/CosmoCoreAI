import asyncio
import logging
import time
from typing import Dict, Any, Optional
import ccxt.pro as ccxt
import json
from app.utils import get_redis_client
from app.strategies.order_block_bot import OrderBlockExecutionEngine
from app.services.notification import NotificationService
from app.strategies.helpers.auto_stop_manager import AutoStopManager
from app.db.session import SessionLocal
from app.strategies.helpers.absorption_tracker import AbsorptionTracker
from app.strategies.helpers.iceberg_tracker import IcebergTracker
from app.services.market_depth_service import market_depth_service
from app.strategies.helpers.trend_finder import AdaptiveTrendFinder
from app.strategies.helpers.ut_bot_tracker import UTBotTracker
from app.strategies.helpers.ut_standalone_listener import UTStandaloneListener
from app.strategies.helpers.ml_standalone_listener import MLStandaloneListener
from app.strategies.helpers.supertrend_tracker import SupertrendTracker
from app.strategies.helpers.supertrend_standalone_listener import SupertrendStandaloneListener
from app.strategies.helpers.dual_engine_standalone_listener import DualEngineStandaloneListener
from app.strategies.helpers.dual_engine_analyzer import DualEngineTracker
from app.strategies.helpers.trading_session_filter import TradingSessionTracker
from app.strategies.helpers.wick_sr_tracker import WickSRTracker
from app.strategies.helpers.wick_sr_standalone_listener import WickSRStandaloneListener
from app.strategies.helpers.fibo_tp_calculator import calculate_fibo_extension_tp
from app.strategies.helpers.vwap_sd_tracker import VWAPSDTracker
from app.strategies.helpers.vwap_sd_standalone_listener import VWAPSDStandaloneListener
from app.strategies.helpers.advanced_risk_manager import AdvancedRiskManager
from app.services.ta_snapshot_service import ta_snapshot_service
from app.strategies.helpers.god_mode_signal_evaluator import GodModeSignalEvaluator
from app.strategies.smart_chase_executor import execute_smart_chase
from app.strategies.helpers.zero_tolerance_tracker import ZeroToleranceTracker
from app.strategies.helpers.spot_bidirectional_executor import SpotBiDirectionalExecutor


from app.strategies.wall_hunter.logger import WallHunterLogger, decrypt_key
from app.strategies.wall_hunter.base import BaseWallHunterBot
from app.strategies.wall_hunter.common_config import apply_common_config_updates

class WallHunterBot(BaseWallHunterBot):
    state_key_prefix = "wallhunter"

    def __init__(self, bot_id: int, config: Dict[str, Any], db_session=None, owner_id: int = None):
        self.bot_id = bot_id
        self.owner_id = owner_id
        self.config = config
        self.symbol = config.get("symbol", "DOGE/USDT")
        self.exchange_id = config.get("exchange", "binance").lower()
        self.is_paper_trading = config.get("is_paper_trading", True)
        self.logger = WallHunterLogger(self.bot_id)
        
        self.is_ready = False
        self._init_task = None
        
        from app.db.session import SessionLocal
        from app.models.bot import Bot
        db = db_session if db_session else SessionLocal()
        try:
            if db:
                bot_record = db.query(Bot).filter(Bot.id == self.bot_id).first()
                if bot_record:
                    self.bot_name = bot_record.name or bot_record.config.get("bot_name", f"Bot {self.bot_id}")
                else:
                    self.bot_name = f"Bot {self.bot_id}"
            else:
                self.bot_name = f"Bot {self.bot_id}"
        finally:
            if not db_session and db:
                db.close()

        # Strategy Params
        self.vol_threshold = config.get("vol_threshold", 500000)
        self.target_spread = config.get("target_spread", 0.0002)
        self.initial_risk_pct = config.get("risk_pct", 0.5)
        self.tsl_pct = config.get("trailing_stop", 0.2)
        self.sell_order_type = config.get("sell_order_type", "market")
        self.sl_order_type = config.get("sl_order_type", "smart_chase")
        self.smart_chase_deviation_pct = config.get("smart_chase_deviation_pct", 1.0)
        self.smart_chase_delay_ms = config.get("smart_chase_delay_ms", 1500)
        self.smart_chase_max_attempts = config.get("smart_chase_max_attempts", 15)
        self.trading_mode = config.get("trading_mode", "spot").lower()
        self.strategy_mode = config.get("strategy_mode", "long").lower()
        self.use_native_binance_otoco = config.get("use_native_binance_otoco", False)
        
        # --- NEW FEATURES: Partial TP & Break-Even SL ---
        self.partial_tp_pct = config.get("partial_tp_pct", 50.0) # TP1 এ কত পার্সেন্ট সেল করবে
        self.partial_tp_trigger_pct = config.get("partial_tp_trigger_pct", 0.0)
        self.sl_breakeven_trigger_pct = config.get("sl_breakeven_trigger_pct", 0.0)
        self.sl_breakeven_target_pct = config.get("sl_breakeven_target_pct", 0.0)
        
        # --- NEW FEATURES: VPVR Confirmation ---
        self.vpvr_enabled = config.get("vpvr_enabled", False)
        self.vpvr_tolerance = config.get("vpvr_tolerance", 0.2)
        self.top_hvns = []
        
        # --- NEW FEATURES: Dynamic ATR Stop-Loss ---
        self.atr_sl_enabled = config.get("atr_sl_enabled", False)
        self.atr_period = config.get("atr_period", 14)
        self.atr_multiplier = config.get("atr_multiplier", 2.0)
        self.current_atr = 0.0

        # --- NEW FEATURES: Liquidation & Scalp ---
        self.enable_wall_trigger = config.get("enable_wall_trigger", True)
        self.max_wall_distance_pct = config.get("max_wall_distance_pct", 1.0)
        self.enable_liq_trigger = config.get("enable_liq_trigger", False)
        self.liq_threshold = config.get("liq_threshold", 50000.0)
        self.liq_target_side = config.get("liq_target_side", "auto").lower()
        self.enable_micro_scalp = config.get("enable_micro_scalp", False)
        self.micro_scalp_profit_ticks = config.get("micro_scalp_profit_ticks", 2)
        self.micro_scalp_min_wall = config.get("micro_scalp_min_wall", 100000.0)
        self.enable_dynamic_atr_scalp = config.get("enable_dynamic_atr_scalp", False)
        self.micro_scalp_atr_multiplier = config.get("micro_scalp_atr_multiplier", 0.5)
        self.enable_oib_filter = config.get("enable_oib_filter", False)
        self.min_oib_threshold = config.get("min_oib_threshold", 0.4)
        
        # --- SMART LIQUIDATION FEATURES ---
        from collections import deque
        self.enable_liq_cascade = config.get("enable_liq_cascade", False)
        self.liq_cascade_window = config.get("liq_cascade_window", 5) # in seconds
        self.liq_history = deque() # Stores tuples: (timestamp, amount)
        
        self.enable_dynamic_liq = config.get("enable_dynamic_liq", False)
        self.dynamic_liq_multiplier = config.get("dynamic_liq_multiplier", 1.0)
        
        self.enable_ob_imbalance = config.get("enable_ob_imbalance", False)
        self.ob_imbalance_ratio = config.get("ob_imbalance_ratio", 1.5)

        # --- BRAND NEW: BTC Liquidation Follower ---
        self.follow_btc_liq = config.get("follow_btc_liq", False)
        self.btc_liq_threshold = config.get("btc_liq_threshold", 500000.0)

        # --- NEW FEATURES: Spoofing Detection ---
        self.min_wall_lifetime = config.get("min_wall_lifetime", 3.0) # ওয়ালকে অন্তত কত সেকেন্ড টিকে থাকতে হবে
        self.tracked_walls = {} # ওয়ালগুলোকে ট্র্যাক করার জন্য ডিকশনারি

        # --- NEW FEATURES: CVD Absorption Confirmation ---
        self.enable_absorption = config.get("enable_absorption", False)
        self.absorption_threshold = config.get("absorption_threshold", 50000.0)
        self.absorption_window = config.get("absorption_window", 10.0)
        self.absorption_tracker = AbsorptionTracker(
            window_seconds=self.absorption_window, 
            threshold=self.absorption_threshold
        )
        
        # --- NEW FEATURES: Iceberg & Hidden Wall Trigger ---
        self.enable_iceberg_trigger = config.get("enable_iceberg_trigger", False)
        self.iceberg_time_window_secs = config.get("iceberg_time_window_secs", 10)
        self.iceberg_min_absorbed_vol = config.get("iceberg_min_absorbed_vol", 100000.0)
        self.iceberg_tracker = IcebergTracker(
            window_seconds=self.iceberg_time_window_secs,
            min_absorbed_vol=self.iceberg_min_absorbed_vol
        )
        
        # --- BRAND NEW: BTC Correlation Filter ---
        self.enable_btc_correlation = config.get("enable_btc_correlation", False)
        self.btc_correlation_threshold = config.get("btc_correlation_threshold", 0.7)
        self.btc_time_window = config.get("btc_time_window", 15)
        self.btc_min_move_pct = config.get("btc_min_move_pct", 0.1)
        self.btc_correlation_tracker = None
        
        # --- NEW: Adaptive Trend Filter ---
        self.enable_trend_filter = config.get("enable_trend_filter", False)
        self.trend_filter_lookback = config.get("trend_filter_lookback", 200)
        self.trend_filter_threshold = config.get("trend_filter_threshold", "Strong")
        self.trend_filter_dev = config.get("trend_filter_dev", 2.0)
        self.enable_trend_volume = config.get("enable_trend_volume", False)
        self.trend_volume_multiplier = config.get("trend_volume_multiplier", 1.5)
        
        self.trend_finder = AdaptiveTrendFinder(
            lookback=self.trend_filter_lookback, 
            threshold=self.trend_filter_threshold,
            dev_threshold=self.trend_filter_dev,
            enable_volume_filter=self.enable_trend_volume,
            volume_multiplier=self.trend_volume_multiplier
        ) if self.enable_trend_filter else None
        
        # --- NEW: Custom Buy Order Type & Buffer ---
        self.buy_order_type = config.get("buy_order_type", "market")
        self.limit_buffer = config.get("limit_buffer", 1.0)
        self.tsl_activation_pct = config.get("tsl_activation_pct", 0.0)
        self.entry_order_timeout = config.get("entry_order_timeout", 30.0)
        
        # --- NEW: Proxy Orderbook Routing (Lead-Lag) ---
        self.enable_proxy_wall = config.get("enable_proxy_wall", False)
        self.proxy_exchange = config.get("proxy_exchange", self.exchange_id)
        self.proxy_symbol = config.get("proxy_symbol", "")
        if self.enable_proxy_wall and self.proxy_symbol:
            ext_suffix = f" on {self.proxy_exchange.upper()}" if self.proxy_exchange != self.exchange_id else ""
            self.logger.info(f"Proxy Orderbook Routing Enabled! Tracking {self.proxy_symbol}{ext_suffix} for Trade Entry on {self.symbol}.")
        
        # --- NEW: Modular UT Bot Alerts ---
        self.enable_ut_trend_filter = config.get("enable_ut_trend_filter", False)
        self.enable_ut_entry_trigger = config.get("enable_ut_entry_trigger", False)
        self.enable_ut_trailing_sl = config.get("enable_ut_trailing_sl", False)
        self.ut_bot_sensitivity = config.get("ut_bot_sensitivity", 1.0)
        self.ut_bot_atr_period = config.get("ut_bot_atr_period", 10)
        self.ut_bot_use_heikin_ashi = config.get("ut_bot_use_heikin_ashi", False)
        self.ut_bot_timeframe = config.get("ut_bot_timeframe", "5m")
        self.ut_bot_candle_close = config.get("ut_bot_candle_close", False)
        self.ut_bot_validation_secs = config.get("ut_bot_validation_secs", 0)
        self.ut_bot_retest_snipe = config.get("ut_bot_retest_snipe", False)
        self.ut_trend_unlock_mode = config.get("enable_ut_trend_unlock_mode", False)
        
        any_ut_enabled = self.enable_ut_trend_filter or self.enable_ut_entry_trigger or self.enable_ut_trailing_sl
        self.ut_bot_tracker = UTBotTracker(
            exchange_id=self.exchange_id,
            symbol=self.symbol,
            sensitivity=self.ut_bot_sensitivity,
            atr_period=self.ut_bot_atr_period,
            use_heikin_ashi=self.ut_bot_use_heikin_ashi,
            timeframe=self.ut_bot_timeframe
        ) if any_ut_enabled else None
        self.ut_standalone_listener = UTStandaloneListener(self)

    # --- NEW: God Mode ML Trigger ---
        self.enable_god_mode_entry_trigger = config.get("enable_god_mode_entry_trigger", False)
        self.god_mode_long_threshold = config.get("god_mode_long_threshold", 80)
        self.god_mode_short_threshold = config.get("god_mode_short_threshold", -80)

        # --- NEW: Modular Supertrend Alerts ---
        self.enable_supertrend_trend_filter = config.get("enable_supertrend_trend_filter", False)
        self.enable_supertrend_entry_trigger = config.get("enable_supertrend_entry_trigger", False)
        self.supertrend_trend_unlock_mode = config.get("enable_supertrend_trend_unlock_mode", False)
        self.enable_supertrend_trailing_sl = config.get("enable_supertrend_trailing_sl", False)
        self.enable_supertrend_exit = config.get("enable_supertrend_exit", False)
        self.supertrend_exit_timeout = config.get("supertrend_exit_timeout", 5)
        self.supertrend_period = config.get("supertrend_period", 10)
        self.supertrend_multiplier = config.get("supertrend_multiplier", 3.0)
        self.supertrend_timeframe = config.get("supertrend_timeframe", "5m")
        self.supertrend_candle_close = config.get("supertrend_candle_close", False)
        
        any_supertrend_enabled = self.enable_supertrend_trend_filter or self.enable_supertrend_entry_trigger or self.enable_supertrend_trailing_sl or self.enable_supertrend_exit
        self.supertrend_tracker = SupertrendTracker(
            exchange_id=self.exchange_id,
            symbol=self.symbol,
            atr_period=self.supertrend_period,
            multiplier=self.supertrend_multiplier,
            timeframe=self.supertrend_timeframe
        ) if any_supertrend_enabled else None
        
        self.supertrend_standalone_listener = SupertrendStandaloneListener(self)

        self.dual_engine_tracker = DualEngineTracker(self.exchange_id, self.symbol, config)
        self.dual_engine_standalone = DualEngineStandaloneListener(self)
        
        # --- NEW: Trading Session Tracker ---
        self.trading_sessions = config.get("trading_sessions", [config.get("trading_session", "None")])
        self.session_tracker = TradingSessionTracker(
            bot_instance=self,
            session_names=self.trading_sessions,
            on_session_end=self._on_trading_session_end
        )
        
        # --- NEW: Smart Wick S/R ---
        self.enable_wick_sr = config.get("enable_wick_sr", False)
        self.wick_sr_modes = config.get("wick_sr_modes", ["bounce"])
        self.wick_sr_timeframe = config.get("wick_sr_timeframe", "1m")
        self.wick_sr_sweep_threshold = config.get("wick_sr_sweep_threshold", 3)
        self.wick_sr_min_touches = config.get("wick_sr_min_touches", 10)
        self.wick_sr_lookback = config.get("wick_sr_lookback", 300)
        self.wick_sr_atr_period = config.get("wick_sr_atr_period", 14)
        self.wick_sr_atr_multiplier = config.get("wick_sr_atr_multiplier", 0.5)
        self.enable_wick_sr_oib = config.get("enable_wick_sr_oib", False)
        self.enable_dynamic_wick_tp = config.get("enable_dynamic_wick_tp", False)
        self.dynamic_tp_frontrun_pct = config.get("dynamic_tp_frontrun_pct", 0.0)
        
        # --- Auto Fibo Take Profit ---
        self.enable_auto_fibo_tp = config.get("enable_auto_fibo_tp", False)
        self.auto_fibo_target_level = config.get("auto_fibo_target_level", 1.618)
        self.auto_fibo_timeframe = config.get("auto_fibo_timeframe", "5m")
        self.auto_fibo_lookback = config.get("auto_fibo_lookback", 30)
        
        self.wick_sr_tracker = WickSRTracker(
            timeframe=self.wick_sr_timeframe,
            sweep_threshold_candles=self.wick_sr_sweep_threshold,
            min_touches=self.wick_sr_min_touches,
            atr_period=self.wick_sr_atr_period,
            atr_multiplier=self.wick_sr_atr_multiplier
        ) if self.enable_wick_sr else None
        
        self.wick_sr_listener = WickSRStandaloneListener(self)
        
        # --- NEW: VWAP SD Confluence Snipe ---
        self.enable_vwap_sd_snipe = config.get("enable_vwap_sd_snipe", False)
        self.vwap_sd_anchor = config.get("vwap_sd_anchor", "Daily")
        self.vwap_sd_multiplier = config.get("vwap_sd_multiplier", 3.0)
        self.vwap_sd_min_wall = config.get("vwap_sd_min_wall", 500000.0)
        
        self.vwap_sd_tracker = VWAPSDTracker(
            anchor=self.vwap_sd_anchor,
            mult3=self.vwap_sd_multiplier
        ) if self.enable_vwap_sd_snipe else None
        self.vwap_sd_listener = VWAPSDStandaloneListener(self) if self.enable_vwap_sd_snipe else None
        # ----------------------------------------
        
        # --- ML L2 Filter ---
        self.enable_ml_filter = config.get("enable_ml_filter", False)
        self.ml_execution_mode = config.get("ml_execution_mode", "basic")
        self.ai_model_id = config.get("ai_model_id", "")
        self.ml_predictor = None
        if self.enable_ml_filter and self.ai_model_id:
            try:
                from app.strategies.helpers.ml_l2_predictor import MLL2Predictor
                self.ml_predictor = MLL2Predictor(self.ai_model_id)
                self.logger.info(f"🤖 [WallHunter {self.bot_id}] ML L2 Filter initialized with model: {self.ai_model_id}")
            except Exception as e:
                self.logger.error(f"[WallHunter {self.bot_id}] Failed to initialize ML Predictor: {e}")

        self.ml_standalone_listener = MLStandaloneListener(self)

        self.engine = OrderBlockExecutionEngine(config, logger=self.logger, bot_id=self.bot_id)
        self.active_pos = None
        self.unlocked_supertrend_dir = None
        self.unlocked_ut_dir = None
        self.highest_price = 0.0
        self.running = False
        self._heartbeat_task = None
        self.redis = get_redis_client()
        self.total_executed_orders = 0
        self._total_realized_pnl = 0.0
        self.total_wins = 0
        self.total_losses = 0
        self.total_longs = 0
        self.total_shorts = 0
        self.auto_stop_manager = AutoStopManager(config)
        self.advanced_risk_manager = AdvancedRiskManager(config)
        self.zero_tolerance_tracker = ZeroToleranceTracker(
            config.get("enable_zero_tolerance", False),
            config.get("zero_tolerance_ticks", 0)
        )
        self.total_gross_pnl = 0.0
        self.total_fees_paid = 0.0
        self.maker_fee = 0.001
        self.taker_fee = 0.001
        self.spot_bidirectional_executor = SpotBiDirectionalExecutor(self)


    def update_config(self, new_config: dict):
        """Update strategy parameters dynamically without stopping the bot."""
        self.logger.info(f"?? [WallHunter {self.bot_id}] Live config update requested: {new_config}")
        updates = []

        if hasattr(self, 'advanced_risk_manager') and self.advanced_risk_manager:
            self.advanced_risk_manager.update_config(new_config)
            updates.append("Advanced Risk Manager config updated")

        if "trading_mode" in new_config and new_config["trading_mode"].lower() != getattr(self, "trading_mode", "spot"):
            updates.append(f"Trading Mode: {getattr(self, 'trading_mode', 'spot').upper()} -> {new_config['trading_mode'].upper()}")
            self.trading_mode = new_config["trading_mode"].lower()

        if "strategy_mode" in new_config and new_config["strategy_mode"].lower() != getattr(self, "strategy_mode", "long"):
            updates.append(f"Strategy Mode: {getattr(self, 'strategy_mode', 'long').upper()} -> {new_config['strategy_mode'].upper()}")
            self.strategy_mode = new_config["strategy_mode"].lower()

        if "use_native_binance_otoco" in new_config and new_config["use_native_binance_otoco"] != getattr(self, "use_native_binance_otoco", False):
            self.use_native_binance_otoco = bool(new_config["use_native_binance_otoco"])
            updates.append(f"Native OTOCO: {'ON' if self.use_native_binance_otoco else 'OFF'}")

        apply_common_config_updates(self, new_config, updates)

        if updates:
            msg = f"⚡ [WallHunter {self.bot_id}] Live Configuration Updated:\n" + "\n".join([f"- {u}" for u in updates])
            self.logger.info(msg)
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self._send_telegram(f"⚙️ *Live Config Update*\n{self.symbol} Bot #{self.bot_id}\n\n" + "\n".join([f"• {u}" for u in updates])))
            except RuntimeError:
                pass
        else:
            self.logger.info(f"⚡ [WallHunter {self.bot_id}] Config update received, but no changes detected.")

    def _is_active_short(self, explicit_side=None):
        """
        Determines if the bot should act on 'short' direction rules (SL above entry, TP below entry, etc).
        For explicit entry calculations, provide explicit_side ('sell' or 'buy').
        Otherwise, it evaluates the currently active position's side or the general strategy_mode.
        """
        if explicit_side:
            return explicit_side == 'sell'
            
        pos_side = self.active_pos.get('side') if self.active_pos else None
        if pos_side:
            return pos_side == 'sell'
            
        return getattr(self, 'strategy_mode', 'long') == 'short'

    async def _initialize_async(self, api_key_record=None):
        self.running = True
        # Dynamic Exchange Initialization
        exchange_class = getattr(ccxt, self.exchange_id)
        exchange_params = {
            'enableRateLimit': True,
            'options': {
                'adjustForTimeDifference': True,
                'recvWindow': 60000 if self.exchange_id == 'mexc' else 30000,
                'new_updates': True if self.exchange_id == 'mexc' else False
            }
        }
        
        # Public instance for fetching market data without triggering auth checks (MEXC /api/v3/capital/config/getall)
        self.public_exchange = exchange_class({'enableRateLimit': True})
        
        # Proxy Exchange Initialization (Cross-Exchange Routing)
        if self.enable_proxy_wall and hasattr(self, 'proxy_exchange') and self.proxy_exchange != self.exchange_id:
            try:
                proxy_class = getattr(ccxt, self.proxy_exchange)
                self.proxy_public_exchange = proxy_class({'enableRateLimit': True})
                self.logger.info(f"🔄 Dual-Exchange Initialized: Native ({self.exchange_id}) | Proxy ({self.proxy_exchange})")
            except Exception as e:
                self.logger.error(f"Failed to load proxy exchange {self.proxy_exchange}: {e}. Falling back to native.")
                self.proxy_public_exchange = self.public_exchange
        else:
            self.proxy_public_exchange = self.public_exchange
        
        # Live Mode-e API select kora
        if not self.is_paper_trading and api_key_record:
            exchange_params.update({
                'apiKey': decrypt_key(api_key_record.api_key),
                'secret': decrypt_key(api_key_record.secret_key)
            })
            
            # Optional Passphrase for KuCoin/OKX/MEXC
            if hasattr(api_key_record, 'passphrase') and api_key_record.passphrase:
                try:
                    exchange_params['password'] = decrypt_key(api_key_record.passphrase)
                except Exception:
                     # Fallback if not encrypted or error
                    exchange_params['password'] = api_key_record.passphrase
            
        self.exchange = exchange_class(exchange_params)
        
        # --- Fetch Trading Fees ---
        if not self.is_paper_trading and self.exchange:
            try:
                if self.exchange.has.get('fetchTradingFee'):
                    fee_data = await self.exchange.fetch_trading_fee(self.symbol)
                    if fee_data:
                        self.maker_fee = fee_data.get('maker', self.maker_fee)
                        self.taker_fee = fee_data.get('taker', self.taker_fee)
                        self.logger.info(f"📊 Real Trading Fees Fetched: Maker={self.maker_fee:.4f}, Taker={self.taker_fee:.4f}")
            except Exception as e:
                self.logger.warning(f"Could not fetch trading fee, using defaults: {e}")
        
        # Initialize execution engine with the correct exchange instance
        self.engine = OrderBlockExecutionEngine(self.config, exchange=self.exchange, logger=self.logger, bot_id=self.bot_id)
        
        try:
            from app.services.ccxt_service import ccxt_service
            cached_markets = await ccxt_service.get_full_markets(self.exchange_id, 'spot')
            if cached_markets:
                self.public_exchange.markets = cached_markets
                self.public_exchange.symbols = list(cached_markets.keys())
            else:
                await self.public_exchange.load_markets()
                
            # If public load succeeds, we can share the markets with the private exchange
            # to avoid MEXC hitting the failing /api/v3/capital/config/getall endpoint
            if self.exchange:
                self.exchange.markets = self.public_exchange.markets
                self.exchange.symbols = self.public_exchange.symbols
                self.exchange.currencies = self.public_exchange.currencies
                # Still call load_markets on the private one but it should be fast/skipped if already populated
                # and we wrap it in a tray catch just in case.
                try:
                    await self.exchange.load_markets()
                except Exception as inner_e:
                    self.logger.warning(f"Private exchange load_markets skipped/failed (expected on MEXC): {inner_e}")
                    
            self.logger.info(f"✅ [WallHunter {self.bot_id}] Markets loaded successfully for {self.symbol}")
            
            # Load markets for proxy exchange if it exists and is different
            if getattr(self, 'proxy_public_exchange', None) and self.proxy_public_exchange != self.public_exchange:
                try:
                    proxy_markets = await ccxt_service.get_full_markets(self.proxy_exchange, 'spot')
                    if proxy_markets:
                        self.proxy_public_exchange.markets = proxy_markets
                        self.proxy_public_exchange.symbols = list(proxy_markets.keys())
                    else:
                        await self.proxy_public_exchange.load_markets()
                    self.logger.info(f"✅ [WallHunter {self.bot_id}] Connected to Proxy Exchange: {self.proxy_exchange.upper()}")
                except Exception as e:
                    self.logger.warning(f"Could not load markets for proxy exchange {self.proxy_exchange}: {e}")
        except Exception as e:
            self.logger.warning(f"Could not load markets during startup: {e}")

        # --- Smart State Recovery & Safe Startup Cleanup ---
        if not self.is_paper_trading and self.exchange:
            state_key = f"wallhunter:state:{self.bot_id}"
            recovered_pos = None
            try:
                saved_state_str = self.redis.get(state_key)
                if saved_state_str:
                    saved_state = json.loads(saved_state_str.decode('utf-8')) if isinstance(saved_state_str, bytes) else json.loads(saved_state_str)
                    limit_order_id = saved_state.get('limit_order_id')
                    
                    if limit_order_id:
                        # Verify order is still alive
                        self.logger.info(f"🔍 [STATE RECOVERY] Found saved limit order {limit_order_id}. Verifying...")
                        try:
                            # Use symbol from saved state or current bot config
                            order_symbol = saved_state.get('symbol', self.symbol)
                            status = await self.exchange.fetch_order(limit_order_id, order_symbol)
                            
                            if status and status.get('status') in ['open', 'new']:
                                recovered_pos = saved_state
                                self.active_pos = recovered_pos
                                self.logger.info(f"🌟 [STATE RECOVERY] Successfully recovered active position and attached to Order {limit_order_id}!")
                                asyncio.create_task(self._send_telegram(f"🌟 *Spot Sequence Recovered*\nBot successfully reattached to live position on restart!\nEntry: {recovered_pos.get('entry')}"))
                            else:
                                self.logger.info(f"ℹ️ Saved limit order {limit_order_id} is no longer open (Status: {status.get('status') if status else 'None'}). Keeping state as fallback.")
                                # We don't clear state here, let manage_risk handle it
                        except Exception as e:
                            self.logger.warning(f"⚠️ Could not verify limit order {limit_order_id}: {e}")
                    
                    if not recovered_pos and saved_state.get('entry_order_id'):
                        # Recovery for "Pending Target" state (Entry executed but TP/SL not yet placed)
                        entry_id = saved_state.get('entry_order_id')
                        self.logger.info(f"🔍 [STATE RECOVERY] Found pending entry order {entry_id}. Checking status...")
                        try:
                            status = await self.exchange.fetch_order(entry_id, self.symbol)
                            if status and status.get('status') in ['closed', 'filled']:
                                filled = status.get('filled', 0.0)
                                if filled > 0:
                                    recovered_pos = saved_state
                                    recovered_pos['amount'] = filled
                                    recovered_pos['entry'] = status.get('average') or status.get('price') or saved_state.get('entry')
                                    self.active_pos = recovered_pos
                                    self.logger.info(f"🌟 [STATE RECOVERY] Recovered position from filled entry order {entry_id}!")
                                    self._save_state()
                                else:
                                    self.logger.info(f"ℹ️ Pending entry order {entry_id} was unfilled. Keeping state for safety.")
                            elif status and status.get('status') in ['open', 'new']:
                                self.logger.info(f"⏳ Pending entry order {entry_id} is still {status.get('status')}. Attaching bot.")
                                recovered_pos = saved_state
                                self.active_pos = recovered_pos
                            else:
                                self.logger.info(f"ℹ️ Entry order {entry_id} has status {status.get('status') if status else 'UNKNOWN'}. Keeping state.")
                        except Exception as fetch_err:
                            self.logger.warning(f" Could not verify pending entry order {entry_id}: {fetch_err}")
                    
                    if not recovered_pos:
                        self.logger.info("ℹ️ Saved state exists but no active orders confirmed. Starting in monitoring mode.")
            except Exception as e:
                self.logger.warning(f"⚠️ Failed to attempt state recovery: {e}")
                
            if not recovered_pos:
                try:
                    self.logger.info(f"🧹 Checking for dangling open orders for {self.symbol} (Bot {self.bot_id})...")
                    open_orders = await self.exchange.fetch_open_orders(self.symbol)
                    
                    prefix = f"WH_{self.bot_id}_"
                    # Filter for orders that belong to THIS bot using the clientOrderId prefix
                    to_cancel = [o for o in open_orders if str(o.get('clientOrderId', '')).startswith(prefix) or str(o.get('info', {}).get('clientOrderId', '')).startswith(prefix)]
                    
                    if to_cancel:
                        self.logger.info(f"🧹 Found {len(to_cancel)} dangling orders for Bot {self.bot_id}. Analyzing...")
                        expected_entry_side = "sell" if getattr(self, 'strategy_mode', 'long') == "short" else "buy"
                        
                        orders_to_clear = []
                        adopted = False
                        
                        for order in to_cancel:
                            order_side = order.get('side', '').lower()
                            
                            if not recovered_pos and not adopted:
                                fallback_price = order.get('average') or order.get('price') or self.highest_price
                                
                                if order_side == expected_entry_side:
                                    self.logger.info(f"🌟 Adopting dangling {order_side.upper()} order {order['id']} as pending ENTRY!")
                                    self.active_pos = {
                                        "entry": fallback_price,
                                        "amount": order.get('amount') or self.config.get("amount_per_trade", 0.0),
                                        "sl": fallback_price * 1.5 if order_side == "sell" else fallback_price * 0.5,
                                        "tp": fallback_price * 0.5 if order_side == "sell" else fallback_price * 1.5,
                                        "tp1": fallback_price * 0.5 if order_side == "sell" else fallback_price * 1.5,
                                        "tp1_hit": False,
                                        "breakeven_hit": False,
                                        "tsl_activated": False,
                                        "entry_order_id": order['id'],
                                        "limit_order_id": None,
                                        "micro_scalp": getattr(self, 'enable_micro_scalp', False),
                                        "side": "long" if order_side == "buy" else "short"
                                    }
                                else:
                                    self.logger.info(f"🌟 Adopting dangling {order_side.upper()} order {order['id']} as pending EXIT (Take Profit)!")
                                    # Since it's an exit order, the entry price must have been different historically
                                    assumed_entry = fallback_price * 1.05 if order_side == "buy" else fallback_price * 0.95
                                    self.active_pos = {
                                        "entry": assumed_entry,
                                        "amount": order.get('amount') or self.config.get("amount_per_trade", 0.0),
                                        "sl": assumed_entry * 1.5 if getattr(self, 'strategy_mode', 'long') == "short" else assumed_entry * 0.5, # Safe fallback SL
                                        "tp": fallback_price,
                                        "tp1": fallback_price,
                                        "tp1_hit": False,
                                        "breakeven_hit": False,
                                        "tsl_activated": False,
                                        "entry_order_id": None,
                                        "limit_order_id": order['id'],
                                        "micro_scalp": getattr(self, 'enable_micro_scalp', False),
                                        "side": "short" if order_side == "buy" else "long"
                                    }
                                
                                recovered_pos = self.active_pos
                                adopted = True
                                self._save_state()
                            else:
                                orders_to_clear.append(order)
                        
                        if orders_to_clear:
                            self.logger.info(f"🧹 Clearing {len(orders_to_clear)} invalid/duplicate dangling orders...")
                            for order in orders_to_clear:
                                try:
                                    await self.exchange.cancel_order(order['id'], self.symbol)
                                except Exception as cancel_err:
                                    self.logger.warning(f"Failed to cancel order {order['id']}: {cancel_err}")
                            self.logger.info(f"✅ Dangling orders for Bot {self.bot_id} cleared.")
                    else:
                        self.logger.info(f"✨ No dangling orders found for Bot {self.bot_id}. Isolation check complete.")
                except Exception as cleanup_err:
                    self.logger.warning(f"⚠️ Could not perform safe order cleanup: {cleanup_err}")

        # Initialize BTC Tracker
        from app.strategies.helpers.btc_correlation_tracker import BtcCorrelationTracker
        self.btc_correlation_tracker = BtcCorrelationTracker(
            self.public_exchange, 
            self.symbol, 
            threshold=self.btc_correlation_threshold,
            window_minutes=self.btc_time_window,
            min_move_pct=self.btc_min_move_pct
        )

        if self.enable_proxy_wall and self.proxy_symbol:
            self._native_price_task = asyncio.create_task(self._native_price_loop())
        else:
            self._native_price_task = None

        self._main_task = asyncio.create_task(self._run_loop())
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        if getattr(self, 'vpvr_enabled', False):
            self._vpvr_task = asyncio.create_task(self._vpvr_updater_loop())
        else:
            self._vpvr_task = None
            
        if getattr(self, 'atr_sl_enabled', False) or getattr(self, 'enable_dynamic_atr_scalp', False):
            self._atr_task = asyncio.create_task(self._atr_updater_loop())
        else:
            self._atr_task = None
            
        if getattr(self, 'enable_liq_trigger', False):
            self._liq_task = asyncio.create_task(self._liquidation_listener())
        else:
            self._liq_task = None
            
        if self.config.get('enable_absorption', False) or getattr(self, 'enable_iceberg_trigger', False):
            self._trades_task = asyncio.create_task(self._trades_listener())
        else:
            self._trades_task = None
        
        if self.enable_btc_correlation:
            self._btc_task = asyncio.create_task(self.btc_correlation_tracker.start())
        else:
            self._btc_task = None
            
        if self.ut_bot_tracker:
            self._utbot_task = asyncio.create_task(self.ut_bot_tracker.start())
            self._ut_standalone_task = asyncio.create_task(self.ut_standalone_listener.start())
        else:
            self._utbot_task = None
            self._ut_standalone_task = None

        if self.enable_ml_filter:
            self._ml_standalone_task = asyncio.create_task(self.ml_standalone_listener.start())
            if hasattr(self, 'ml_predictor') and self.ml_predictor:
                await self.ml_predictor.start_background_engine(self.symbol)
        else:
            self._ml_standalone_task = None

        if getattr(self, 'supertrend_tracker', None):
            self._supertrend_task = asyncio.create_task(self.supertrend_tracker.start())
            self._supertrend_standalone_task = asyncio.create_task(self.supertrend_standalone_listener.start())
        else:
            self._supertrend_task = None
            self._supertrend_standalone_task = None

        if self.config.get("enable_dual_engine", False):
            self._dual_engine_task = asyncio.create_task(self.dual_engine_tracker.start())
            self._dual_engine_standalone_task = asyncio.create_task(self.dual_engine_standalone.start())
        else:
            self._dual_engine_task = None
            self._dual_engine_standalone_task = None

        if self.enable_wick_sr:
            self._wick_sr_task = asyncio.create_task(self.wick_sr_listener.start())
        else:
            self._wick_sr_task = None
            
        if self.enable_vwap_sd_snipe:
            self._vwap_sd_task = asyncio.create_task(self.vwap_sd_listener.start())
        else:
            self._vwap_sd_task = None
            
        await self.session_tracker.start_monitor()
        
        mode = "Live Trading" if not self.is_paper_trading else "Paper Trading"
        
        trigger_logs = []
        if getattr(self, 'enable_wall_trigger', True):
            trigger_logs.append(f"Vol Threshold: {self.vol_threshold}")
        if getattr(self, 'enable_liq_trigger', False):
            trigger_logs.append(f"Liq Threshold: {self.liq_threshold}")
        trigger_str = "\n".join(trigger_logs)
        
        trigger_logs_console = []
        if getattr(self, 'enable_wall_trigger', True):
            trigger_logs_console.append(f"- Vol Threshold: {self.vol_threshold}")
        if getattr(self, 'enable_liq_trigger', False):
            trigger_logs_console.append(f"- Liq Threshold: {self.liq_threshold}")
            
        any_ut = self.enable_ut_trend_filter or self.enable_ut_entry_trigger or self.enable_ut_trailing_sl
        if any_ut:
            ut_mode = "Standalone" if (not self.enable_wall_trigger and not self.enable_liq_trigger) else "Confluence"
            trigger_logs_console.append(f"- UT Bot: ACTIVE ({ut_mode})")
            if self.enable_ut_entry_trigger: trigger_logs_console.append(f"  └─ Entry Trigger: ON")
            if self.enable_ut_trend_filter: trigger_logs_console.append(f"  └─ Trend Filter: ON")
            if self.enable_ut_trailing_sl: trigger_logs_console.append(f"  └─ Trailing SL: ON")

        any_st = getattr(self, 'enable_supertrend_trend_filter', False) or getattr(self, 'enable_supertrend_entry_trigger', False) or getattr(self, 'enable_supertrend_trailing_sl', False) or getattr(self, 'enable_supertrend_exit', False)
        if any_st:
            st_mode = "Standalone" if (not getattr(self, 'enable_wall_trigger', False) and not getattr(self, 'enable_liq_trigger', False)) else "Confluence"
            trigger_logs_console.append(f"- Supertrend: ACTIVE ({st_mode})")
            if getattr(self, 'enable_supertrend_entry_trigger', False): trigger_logs_console.append(f"  \u2514\u2500 Entry Trigger: ON")
            if getattr(self, 'enable_supertrend_trend_filter', False): trigger_logs_console.append(f"  \u2514\u2500 Trend Filter: ON")
            if getattr(self, 'enable_supertrend_trailing_sl', False): trigger_logs_console.append(f"  \u2514\u2500 Trailing SL: ON")
            if getattr(self, 'enable_supertrend_exit', False): trigger_logs_console.append(f"  \u2514\u2500 Reversal Dual-Exit: ON ({getattr(self, 'supertrend_exit_timeout', 5)}s)")

        # Wick SR is shown in the BOT ACTIVATED numbered list (bot_manager.py), not here.
        # Keep console log for terminal visibility only.
        if getattr(self, 'enable_wick_sr', False):
            active_modes = getattr(self, 'wick_sr_modes', ['bounce'])
            mode_labels = {'bounce': 'Bounce', 'breakout': 'Breakout', 'sweep': 'Liq Sweep', 'retest': 'Retest'}
            modes_display = ", ".join([mode_labels.get(m, m.title()) for m in active_modes])
            oib_str = "ON" if getattr(self, 'enable_wick_sr_oib', False) else "OFF"
            trigger_logs_console.append(f"- Smart Wick S/R: ACTIVE")
            trigger_logs_console.append(f"  Modes: {modes_display} | TF: {getattr(self, 'wick_sr_timeframe', '1m')} | LB: {getattr(self, 'wick_sr_lookback', 300)} | Touches: {getattr(self, 'wick_sr_min_touches', 10)} | ATRx: {getattr(self, 'wick_sr_atr_multiplier', 0.5)} | OIB: {oib_str}")

        trigger_console_str = "\n".join(trigger_logs_console)

        valid_sessions = [s for s in getattr(self, 'trading_sessions', []) if s and s != "None"]
        session_str = f"\U0001f552 Trading Sessions: {', '.join(valid_sessions)}\n" if valid_sessions else ""
        
        # --- Auto-Stop Info ---
        risk_summary_str = ""
        if hasattr(self, 'advanced_risk_manager') and self.advanced_risk_manager:
            if self.advanced_risk_manager.enable_breakeven:
                sym = "%" if self.advanced_risk_manager.be_type == "pct" else "$"
                risk_summary_str += f"🛡️ Break-even Protection: ON (Trigger: {self.advanced_risk_manager.be_activation_val}{sym}, Stop: {self.advanced_risk_manager.be_fee_buffer_val}{sym})\n"
            if self.advanced_risk_manager.enable_global_tp:
                risk_summary_str += f"🎯 Global TP ({self.advanced_risk_manager.global_tp_type.capitalize()}): ${self.advanced_risk_manager.global_tp_target:.2f} [{self.advanced_risk_manager.global_tp_action}]\n"
            if risk_summary_str:
                self.logger.info(f"🛡️ Advanced Risk Management Active:\n{risk_summary_str}")
        
        mode = "Live Trading" if not self.is_paper_trading else "Paper Trading"
        startup_msg = (
            f"🟢 WallHunter Bot [ID: {self.bot_id}] Started!\n"
            f"Pair: {self.symbol}\n"
            f"Mode: {mode}\n"
            f"Buy Order: {self.buy_order_type.upper()}\n"
            f"Limit Buffer: {self.limit_buffer}%\n"
            f"Strategy: {'SHORT' if getattr(self, 'strategy_mode', 'long') == 'short' else 'LONG'}\n"
        )
        
        self.logger.info(f"🚀 [WallHunter {self.bot_id}] Booting up with config:\n"
                    f"- Symbol: {self.symbol}\n"
                    f"- Buy Type: {self.buy_order_type}\n"
                    f"- Limit Buffer: {self.limit_buffer}%\n"
                    f"{trigger_console_str}")

        await self._send_telegram(startup_msg)


    async def _run_loop(self):
        while self.running:
            try:
                # Real-time L2 Data Fetching via WebSocket (Proxy Routing Enabled)
                # BUG FIX: When proxy wall is enabled, use proxy_public_exchange (not public_exchange)
                # and normalize the limit against the proxy exchange, not the native exchange.
                if self.enable_proxy_wall and self.proxy_symbol:
                    watch_sym = self.proxy_symbol
                    watch_exchange = getattr(self, 'proxy_public_exchange', self.public_exchange)
                    proxy_ex_id = getattr(self, 'proxy_exchange', self.exchange_id)
                    limit = market_depth_service._normalize_order_book_limit(proxy_ex_id, 20)
                else:
                    watch_sym = self.symbol
                    watch_exchange = self.public_exchange
                    limit = market_depth_service._normalize_order_book_limit(self.exchange_id, 20)
                try:
                    orderbook = await watch_exchange.watch_order_book(watch_sym, limit=limit)
                except Exception as e:
                    self.logger.warning(f"WebSocket orderbook error on {watch_sym}: {e}, falling back to REST")
                    await asyncio.sleep(1.5) # Rate limit protection for REST fallback
                    orderbook = await watch_exchange.fetch_order_book(watch_sym, limit=limit)
                    
                if not orderbook['bids'] or not orderbook['asks']:
                    await asyncio.sleep(1)
                    continue

                best_bid = orderbook['bids'][0][0]
                best_ask = orderbook['asks'][0][0]
                mid_price = (best_bid + best_ask) / 2
                current_time = time.time()

                # Continuously feed the AI Predictor with Live L2 Snapshots for Advanced Features Memory
                if getattr(self, 'enable_ml_filter', False) and getattr(self, 'ml_predictor', None):
                    if hasattr(self.ml_predictor, 'update_l2_memory'):
                        self.ml_predictor.update_l2_memory(orderbook)

                if getattr(self, 'enable_iceberg_trigger', False):
                    # BUG FIX: Only update iceberg tracker with NATIVE orderbook.
                    # When proxy wall is active, 'orderbook' is proxy symbol data (e.g. BTC/USDT).
                    # Iceberg tracks native symbol trades, so we must use native book.
                    if self.enable_proxy_wall and self.proxy_symbol:
                        try:
                            native_limit = market_depth_service._normalize_order_book_limit(self.exchange_id, 20)
                            native_ob = await self.public_exchange.fetch_order_book(self.symbol, limit=native_limit)
                            if native_ob['bids'] and native_ob['asks']:
                                self.iceberg_tracker.update_orderbook(native_ob['bids'], native_ob['asks'])
                        except Exception:
                            pass  # Silently skip if native book fetch fails — trades still accumulate
                    else:
                        self.iceberg_tracker.update_orderbook(orderbook['bids'], orderbook['asks'])


                if not self.active_pos:

                    # --- Realized PNL Auto-Stop Check (Runs only when flat) ---
                    if hasattr(self, 'auto_stop_manager') and self.auto_stop_manager and not self.auto_stop_manager.is_stopped:
                        is_triggered = await self.auto_stop_manager.check_conditions(self.total_realized_pnl, self)
                        if is_triggered:
                            # Bot was stopped by auto_stop_manager
                            continue

                    if not TradingSessionTracker.is_session_active(self.trading_sessions):
                        await asyncio.sleep(1)
                        continue
                        
                    if getattr(self, 'supertrend_trend_unlock_mode', False) and getattr(self, 'supertrend_tracker', None):
                        closed_only = getattr(self, 'supertrend_candle_close', False)
                        if self.supertrend_tracker.is_entry_signal("buy", closed_only):
                            if self.unlocked_supertrend_dir != "buy":
                                self.unlocked_supertrend_dir = "buy"
                                self.logger.info("🔓 [Supertrend] Trend Unlocked for BUY (Long) trades!")
                        elif self.supertrend_tracker.is_entry_signal("sell", closed_only):
                            if self.unlocked_supertrend_dir != "sell":
                                self.unlocked_supertrend_dir = "sell"
                                self.logger.info("🔓 [Supertrend] Trend Unlocked for SELL (Short) trades!")
                                
                    if getattr(self, 'ut_trend_unlock_mode', False) and getattr(self, 'ut_bot_tracker', None):
                        closed_only = getattr(self, 'ut_bot_candle_close', False)
                        if self.ut_bot_tracker.is_entry_signal("buy", closed_only):
                            if self.unlocked_ut_dir != "buy":
                                self.unlocked_ut_dir = "buy"
                                self.logger.info("🔓 [UT Bot] Trend Unlocked for BUY (Long) trades!")
                        elif self.ut_bot_tracker.is_entry_signal("sell", closed_only):
                            if self.unlocked_ut_dir != "sell":
                                self.unlocked_ut_dir = "sell"
                                self.logger.info("🔓 [UT Bot] Trend Unlocked for SELL (Short) trades!")
                                
                    if getattr(self, 'enable_wick_sr', False) and getattr(self, 'wick_sr_tracker', None):
                        wick_signals = self.wick_sr_tracker.get_signals(mid_price)
                        for w_sig in wick_signals:
                            # Check if the triggered mode is enabled
                            if w_sig['mode'] in self.wick_sr_modes:
                                raw_side = w_sig['side']
                                target_side = 'buy' if raw_side == 'long' else 'sell'
                                
                                # Strict Entry Direction Guard: 
                                # A Short bot must only open positions with SELL. A Long bot must only open positions with BUY.
                                if not self.active_pos:
                                    expected_entry_side = 'sell' if self._is_active_short() else 'buy'
                                    if target_side != expected_entry_side:
                                        self.logger.info(f"🚫 Wick SR Snipe ({w_sig['mode'].upper()}) rejected! Strategy Mode ({getattr(self, 'strategy_mode', 'long').upper()}) only allows {expected_entry_side.upper()} entries.")
                                        continue
                                
                                # Evaluate Wick SR OIB Confluence
                                is_confluence_valid = True
                                oib_ratio = 0.5
                                oib_log_str = "(OIB Filter: OFF)"
                                if getattr(self, 'enable_wick_sr_oib', False):
                                    oib_ratio = self.calculate_oib(orderbook, depth=10)
                                    oib_log_str = f"({oib_ratio*100:.1f}% OIB)"
                                    min_oib = getattr(self, 'min_oib_threshold', 0.4)
                                    if target_side == 'buy' and oib_ratio < min_oib:
                                        self.logger.info(f"🚫 Wick SR Snipe ({w_sig['mode'].upper()}) rejected! Weak Bid OIB ({oib_ratio*100:.1f}%).")
                                        is_confluence_valid = False
                                    elif target_side == 'sell' and (1 - oib_ratio) < min_oib:
                                        self.logger.info(f"🚫 Wick SR Snipe ({w_sig['mode'].upper()}) rejected! Weak Ask OIB ({(1-oib_ratio)*100:.1f}%).")
                                        is_confluence_valid = False
                                        
                                if is_confluence_valid:
                                    self.logger.info(f"🔥 WICK S/R TRIGGER! Executing {w_sig['mode'].upper()} {target_side.upper()} Snipe at {w_sig['price']} {oib_log_str}!")
                                    if self.enable_proxy_wall:
                                        try:
                                            native_book = await self.public_exchange.fetch_order_book(self.symbol, limit=5)
                                            native_mid = (native_book['bids'][0][0] + native_book['asks'][0][0]) / 2
                                            await self.execute_snipe(w_sig['price'], target_side, native_mid, native_book['bids'][0][0], native_book['asks'][0][0])
                                        except Exception as e:
                                            await self.execute_snipe(w_sig['price'], target_side, mid_price, best_bid, best_ask)
                                    else:
                                        await self.execute_snipe(w_sig['price'], target_side, mid_price, best_bid, best_ask)
                                    break # Only execute one signal per tick
                                
                    # If a wick signal just executed and opened a position, move to the next tick safely
                    if self.active_pos:
                        continue

                    if not self.enable_wall_trigger:
                        self._publish_status(mid_price)
                        continue

                    # === ICEBERG DETECTION PRIORITY ===
                    # If iceberg_detected, execute IMMEDIATELY ignoring wall lifetime and regular volume requirements.
                    if self.enable_iceberg_trigger:
                        target_side = "buy" if getattr(self, 'strategy_mode', 'long') == 'long' else "sell"
                        
                        ice_res = self.iceberg_tracker.check_for_iceberg(target_side, mid_price)
                        if ice_res and ice_res.get('iceberg_detected'):
                            price = ice_res['price']
                            self.logger.info(f"💎 ICEBERG TRIGGER! Massive absorption detected defending {price}. Executing high-priority Snipe!")
                            
                            # Publish WebSocket Event directly to Heatmap Channel
                            try:
                                event_payload = {
                                    "type": "ICEBERG_DETECTED",
                                    "symbol": self.symbol,
                                    "side": target_side,
                                    "price": price,
                                    "absorbed_vol": ice_res.get("absorbed_vol", 0),
                                    "limit_vol_remaining": ice_res.get("limit_vol_remaining", 0)
                                }
                                self.redis.publish("heatmap_events", json.dumps(event_payload))
                            except Exception as e:
                                self.logger.error(f"Failed to publish Heatmap event: {e}")

                            if self.enable_proxy_wall:
                                try:
                                    native_book = await self.public_exchange.fetch_order_book(self.symbol, limit=5)
                                    native_best_bid = native_book['bids'][0][0]
                                    native_best_ask = native_book['asks'][0][0]
                                    native_mid = (native_best_bid + native_best_ask) / 2
                                    await self.execute_snipe(price, target_side, native_mid, native_best_bid, native_best_ask)
                                except Exception as e:
                                    self.logger.warning(f"Error fetching native execution book for proxy snipe: {e}. Falling back to proxy price.")
                                    await self.execute_snipe(price, target_side, mid_price, best_bid, best_ask)
                            else:
                                await self.execute_snipe(price, target_side, mid_price, best_bid, best_ask)
                                
                            self.tracked_walls.clear()
                            continue # Skip the rest of the loop for this tick
                    # === END ICEBERG SEC ===

                    # === NEW: GOD MODE ML TRIGGER SEC ===
                    if getattr(self, 'enable_god_mode_entry_trigger', False):
                        god_mode_res = GodModeSignalEvaluator.evaluate(
                            bids=orderbook.get('bids', []),
                            asks=orderbook.get('asks', []),
                            current_price=mid_price,
                            threshold_long=getattr(self, 'god_mode_long_threshold', 80),
                            threshold_short=getattr(self, 'god_mode_short_threshold', -80)
                        )
                        if god_mode_res.get('passed'):
                            g_signal = god_mode_res['signal']
                            g_score = god_mode_res['score']
                            target_side = "buy" if g_signal == "LONG" else "sell"
                            
                            # Check strategy direction constraints
                            allowed = True
                            if getattr(self, 'strategy_mode', 'long') == 'long' and target_side != 'buy':
                                allowed = False
                            if getattr(self, 'strategy_mode', 'long') == 'short' and target_side != 'sell':
                                allowed = False
                                
                            if allowed:
                                # Confluence Check: L2 Machine Learning Filter
                                if getattr(self, 'enable_ml_filter', False) and getattr(self, 'ml_predictor', None):
                                    ml_mode = getattr(self, 'ml_execution_mode', 'basic')
                                    is_ai_valid = False
                                    if ml_mode == 'advanced':
                                        advanced_setup = await self.ml_predictor.predict_advanced(orderbook, mid_price, target_side, self)
                                        if advanced_setup and advanced_setup.get("is_valid", False):
                                            is_ai_valid = True
                                    else:
                                        is_ai_valid = await self.ml_predictor.predict(orderbook, mid_price, target_side)
                                        
                                    if not is_ai_valid:
                                        self.logger.info(f"🚫 [God Mode ML] Snipe at {mid_price} rejected by L2 ML Predictor Confluence!")
                                        allowed = False

                                # Confluence Check: Dual Engine
                                if allowed and getattr(self, "dual_engine_tracker", None) and self.dual_engine_tracker.is_enabled:
                                    if not self.dual_engine_tracker.is_aligned(target_side):
                                        self.logger.info(f"🚫 [God Mode ML] Snipe at {mid_price} rejected by Dual Engine Confluence!")
                                        allowed = False

                            if allowed:
                                self.logger.info(f"🤖 [God Mode ML] TRIGGER FIRED! Score: {g_score} | Executing {target_side.upper()} Snipe!")
                                
                                # Publish WebSocket Event
                                try:
                                    event_payload = {
                                        "type": "GOD_MODE_TRIGGER",
                                        "symbol": self.symbol,
                                        "side": target_side,
                                        "score": g_score,
                                        "price": mid_price
                                    }
                                    if self.redis:
                                        self.redis.publish("heatmap_events", json.dumps(event_payload))
                                except Exception as e:
                                    self.logger.error(f"Failed to publish God Mode event: {e}")

                                if self.enable_proxy_wall:
                                    try:
                                        native_book = await self.public_exchange.fetch_order_book(self.symbol, limit=5)
                                        native_best_bid = native_book['bids'][0][0]
                                        native_best_ask = native_book['asks'][0][0]
                                        native_mid = (native_best_bid + native_best_ask) / 2
                                        await self.execute_snipe(mid_price, target_side, native_mid, native_best_bid, native_best_ask)
                                    except Exception as e:
                                        self.logger.warning(f"Error fetching native execution book for proxy snipe: {e}. Falling back to proxy price.")
                                        await self.execute_snipe(mid_price, target_side, mid_price, best_bid, best_ask)
                                else:
                                    await self.execute_snipe(mid_price, target_side, mid_price, best_bid, best_ask)
                                    
                                self.tracked_walls.clear()
                                continue # Skip the rest of the loop for this tick
                    # === END GOD MODE SEC ===

                    # 1. বর্তমান অর্ডার বুকের ওয়ালগুলো ফিল্টার করা
                    current_walls = {}
                    if getattr(self, 'strategy_mode', 'long') != 'short' or self.trading_mode == 'futures':
                        for level in orderbook['bids']:
                            price, vol = level[0], level[1]
                            if vol >= self.vol_threshold:
                                # Validate distance from current mid_price
                                distance_pct = abs(price - mid_price) / mid_price * 100.0
                                if distance_pct <= self.max_wall_distance_pct:
                                    current_walls[price] = {'vol': vol, 'type': 'buy'}

                    # Scan SELL walls for Futures mode OR Spot Short/Auto mode
                    if self.trading_mode == 'futures' or getattr(self, 'strategy_mode', 'long') in ['short', 'auto']:
                        for level in orderbook['asks']:
                            price, vol = level[0], level[1]
                            if vol >= self.vol_threshold:
                                # Validate distance from current mid_price
                                distance_pct = abs(price - mid_price) / mid_price * 100.0
                                if distance_pct <= self.max_wall_distance_pct:
                                    current_walls[price] = {'vol': vol, 'type': 'sell'}

                    # Apply Bi-directional Auto Logic to filter priority
                    if getattr(self, 'strategy_mode', 'long') == 'auto':
                        current_walls = await self.spot_bidirectional_executor.evaluate_walls(current_walls, orderbook, mid_price)

                    # 2. ওয়াল অ্যানালাইসিস এবং স্পুফিং ডিটেকশন
                    for price, wall_info in current_walls.items():
                        vol = wall_info['vol']
                        side = wall_info['type']
                        
                        if self.min_wall_lifetime <= 0:
                            # 0-সেকেন্ড হলে সাথে সাথেই কিনে ফেলবে
                            if self.vpvr_enabled and self.top_hvns:
                                is_hvn_aligned = any(abs(price - hvn) / hvn <= (self.vpvr_tolerance / 100.0) for hvn in self.top_hvns)
                                if not is_hvn_aligned:
                                    self.logger.info(f"🚫 Instant Snipe at {price} rejected: Not near any HVN.")
                                    continue
                            
                            # CVD Absorption Check
                            if self.enable_absorption:
                                if not self.absorption_tracker.is_absorption_detected(side):
                                    continue
                                self.logger.info(f"🔥 [ABSORPTION] Confirmed at {price} for {side.upper()} wall. Delta: {self.absorption_tracker.get_current_delta():.2f}")

                            # BTC Correlation Anti-Fakeout Check
                            if self.enable_btc_correlation and self.btc_correlation_tracker:
                                if not self.btc_correlation_tracker.is_aligned(side):
                                    metrics = self.btc_correlation_tracker.get_metrics_string()
                                    self.logger.info(f"🚫 [BTC Divergence] Snipe at {price} rejected! {metrics}")
                                    continue
                                else:
                                    self.logger.info(f"✅ [BTC Correlation] Aligned for {side.upper()}! {self.btc_correlation_tracker.get_metrics_string()}")

                            # Adaptive Trend Filter Check
                            if self.enable_trend_filter and self.trend_finder:
                                target_trade_dir = "buy" if getattr(self, 'strategy_mode', 'long') == 'long' else "sell" 
                                try:
                                    klines = await market_depth_service.fetch_ohlcv(self.symbol, self.exchange_id, '1m', 1200)
                                    if klines:
                                        close_prices = [float(k['close']) for k in klines]
                                        volumes = [float(k.get('volume', 0)) for k in klines]
                                        trend_analysis = self.trend_finder.analyze_trend(close_prices)
                                        is_acceptable, tb_reason = self.trend_finder.is_trend_acceptable(trend_analysis, target_trade_dir)
                                        
                                        if is_acceptable and getattr(self, 'enable_trend_volume', False):
                                            lookback = self.trend_filter_lookback
                                            recent_vols = volumes[-lookback:] if len(volumes) >= lookback else volumes
                                            if recent_vols:
                                                avg_vol = sum(recent_vols) / len(recent_vols)
                                                current_vol = volumes[-1]
                                                if current_vol < avg_vol * getattr(self, 'trend_volume_multiplier', 1.5):
                                                    is_acceptable = False
                                                    tb_reason = f"Rejected: Volume too low ({current_vol:.2f} < {avg_vol * self.trend_volume_multiplier:.2f})"
                                                else:
                                                    tb_reason += f" | Vol OK ({current_vol:.2f})"

                                        if not is_acceptable:
                                            self.logger.info(f"🚫 [Trend Filter] Instant Snipe at {price} rejected! {tb_reason}")
                                            continue
                                        else:
                                            self.logger.info(f"📈 [Trend Filter] {tb_reason}")
                                except Exception as e:
                                    self.logger.error(f"Failed to execute trend filter check: {e}")
                                    continue

                            # --- Modular UT Bot Alerts Filter (Instant Snipe) ---
                            if self.enable_ut_entry_trigger and self.ut_bot_tracker:
                                if getattr(self, 'ut_trend_unlock_mode', False):
                                    if self.unlocked_ut_dir != side:
                                        self.logger.info(f"🚫 [UT Unlock Filter] Instant Snipe at {price} rejected! Waiting for initial {side.upper()} crossover.")
                                        continue
                                    else:
                                        self.logger.info(f"🔓 [UT Unlock] Path is clear for {side.upper()}!")
                                else:
                                    if not self.ut_bot_tracker.is_entry_signal(side):
                                        self.logger.info(f"🚫 [UT Entry Filter] Instant Snipe at {price} rejected! No exact crossover entry signal.")
                                        continue
                                    else:
                                        self.logger.info(f"📈 [UT Entry Filter] Exact {side.upper()} crossover signal detected!")

                            if self.enable_ut_trend_filter and self.ut_bot_tracker:
                                if not self.ut_bot_tracker.is_trend_aligned(side):
                                    self.logger.info(f"🚫 [UT Trend Filter] Instant Snipe at {price} rejected! Trend direction misaligned.")
                                    continue
                                else:
                                    self.logger.info(f"📈 [UT Trend Filter] Trend is aligned for {side.upper()}.")

                            # --- Modular Supertrend Alerts Filter (Instant Snipe) ---
                            if self.enable_supertrend_entry_trigger and self.supertrend_tracker:
                                if getattr(self, 'supertrend_trend_unlock_mode', False):
                                    if self.unlocked_supertrend_dir != side:
                                        self.logger.info(f"🚫 [Supertrend Unlock Filter] Instant Snipe at {price} rejected! Waiting for initial {side.upper()} crossover.")
                                        continue
                                    else:
                                        self.logger.info(f"🔓 [Supertrend Unlock] Path is clear for {side.upper()}!")
                                else:
                                    if not self.supertrend_tracker.is_entry_signal(side):
                                        self.logger.info(f"🚫 [Supertrend Entry Filter] Instant Snipe at {price} rejected! No crossover entry signal.")
                                        continue
                                    else:
                                        self.logger.info(f"📈 [Supertrend Entry Filter] Exact {side.upper()} crossover signal detected!")

                            if self.enable_supertrend_trend_filter and self.supertrend_tracker:
                                if not self.supertrend_tracker.is_trend_aligned(side):
                                    self.logger.info(f"🚫 [Supertrend Trend Filter] Instant Snipe at {price} rejected! Trend direction misaligned.")
                                    continue
                                else:
                                    self.logger.info(f"📈 [Supertrend Trend Filter] Trend is aligned for {side.upper()}.")

                            if getattr(self.dual_engine_tracker, "is_enabled", False):
                                if not self.dual_engine_tracker.is_aligned(side):
                                    self.logger.info(f"🚫 [Dual Engine] Instant Snipe at {price} rejected! {self.dual_engine_tracker.get_metrics_string()}")
                                    continue
                                else:
                                    self.logger.info(f"📈 [Dual Engine] Confirmed aligned for {side.upper()}! {self.dual_engine_tracker.get_metrics_string()}")

                            # --- Multi-Level Orderbook Imbalance (OIB) ---
                            if getattr(self, 'enable_oib_filter', False):
                                oib_ratio = self.calculate_oib(orderbook, depth=10)
                                min_oib_threshold = getattr(self, 'min_oib_threshold', 0.4) # Default 40% support required
                                
                                if side == "buy" and oib_ratio < min_oib_threshold:
                                    self.logger.info(f"🚫 [OIB Filter] Instant Snipe at {price} rejected! Weak Bid presence ({oib_ratio*100:.1f}%).")
                                    continue
                                elif side == "sell" and (1 - oib_ratio) < min_oib_threshold:
                                    self.logger.info(f"🚫 [OIB Filter] Instant Snipe at {price} rejected! Weak Ask presence ({(1-oib_ratio)*100:.1f}%).")
                                    continue

                            # --- Spot Auto Balance Validation ---
                            if getattr(self, 'strategy_mode', 'long') == 'auto':
                                has_balance = await self.spot_bidirectional_executor.validate_balance_for_side(side)
                                if not has_balance:
                                    continue
                                else:
                                    support = oib_ratio if side == "buy" else (1-oib_ratio)
                                    self.logger.info(f"📈 [OIB Filter] Orderbook supports {side.upper()} with {support*100:.1f}% dominance.")

                            # --- AI Model Filter (L2 Predictor) ---
                            override_sl = None
                            override_tp = None
                            if getattr(self, 'enable_ml_filter', False) and getattr(self, 'ml_predictor', None):
                                ml_mode = getattr(self, 'ml_execution_mode', 'basic')
                                is_ai_valid = False
                                
                                if ml_mode == 'advanced':
                                    advanced_setup = await self.ml_predictor.predict_advanced(orderbook, mid_price, side, self)
                                    if advanced_setup and advanced_setup.get("is_valid", False):
                                        is_ai_valid = True
                                        override_sl = advanced_setup.get("sl_price")
                                        override_tp = advanced_setup.get("tp_price")
                                        self.logger.info(f"🔮 [ML Advanced] Instant Setup Generated: SL={override_sl}, TP={override_tp}, R:R={advanced_setup.get('rr_ratio')}")
                                else:
                                    is_ai_valid = await self.ml_predictor.predict(orderbook, mid_price, side)
                                    
                                if not is_ai_valid:
                                    if current_time - getattr(self, '_last_ai_log_time', 0) > 10.0:
                                        self.logger.info(f"🚫 [AI Filter] Instant Snipe at {price} rejected! L2 Model predicts adverse movement.")
                                        self._last_ai_log_time = current_time
                                    continue
                                else:
                                    if getattr(self.ml_predictor, 'is_loaded', False):
                                        self.logger.info(f"🤖 [AI Filter] Model confirmed {side.upper()} order flow!")
                                    else:
                                        self.logger.info(f"⚠️ [AI Filter] Model unavailable. Trade allowed by default.")

                            self.logger.info(f"🟢 Instant Snipe at {price} (Spoof Detect is 0s) {'[HVN Confirmed]' if self.vpvr_enabled else ''}. Executing!")
                            if self.enable_proxy_wall:
                                try:
                                    native_book = await self.public_exchange.fetch_order_book(self.symbol, limit=5)
                                    native_best_bid = native_book['bids'][0][0]
                                    native_best_ask = native_book['asks'][0][0]
                                    native_mid = (native_best_bid + native_best_ask) / 2
                                    await self.execute_snipe(price, side, native_mid, native_best_bid, native_best_ask, override_sl_price=override_sl, override_tp_price=override_tp)
                                except Exception as e:
                                    self.logger.warning(f"Error fetching native execution book for proxy snipe: {e}. Falling back to proxy price.")
                                    await self.execute_snipe(price, side, mid_price, best_bid, best_ask, override_sl_price=override_sl, override_tp_price=override_tp)
                            else:
                                await self.execute_snipe(price, side, mid_price, best_bid, best_ask, override_sl_price=override_sl, override_tp_price=override_tp)
                            self.tracked_walls.clear()
                            current_walls.clear()
                            break

                        if price in self.tracked_walls:
                            # ওয়ালটি এখনও আছে, তাই লাস্ট আপডেট টাইম চেঞ্জ করছি
                            self.tracked_walls[price]['last_seen'] = current_time
                            self.tracked_walls[price]['vol'] = vol
                            
                            # চেক করছি ওয়ালটি পর্যাপ্ত সময় ধরে টিকে আছে কিনা
                            time_alive = current_time - self.tracked_walls[price]['first_seen']
                            if time_alive >= self.min_wall_lifetime:
                                if self.tracked_walls[price].get('hvn_rejected'):
                                    continue

                                if self.vpvr_enabled and self.top_hvns:
                                    is_hvn_aligned = any(abs(price - hvn) / hvn <= (self.vpvr_tolerance / 100.0) for hvn in self.top_hvns)
                                    if not is_hvn_aligned:
                                        self.logger.info(f"🚫 Wall at {price} rejected: Not near any HVN (Tolerance: {self.vpvr_tolerance}%).")
                                        self.tracked_walls[price]['hvn_rejected'] = True
                                        continue

                                # CVD Absorption Check
                                if self.enable_absorption:
                                    if not self.absorption_tracker.is_absorption_detected(side):
                                        continue
                                    self.logger.info(f"🧬 [ABSORPTION] Confirmed Genuine Wall at {price} for {side.upper()} wall!")

                                # BTC Correlation Anti-Fakeout Check
                                if self.enable_btc_correlation and self.btc_correlation_tracker:
                                    if self.tracked_walls[price].get('btc_rejected'):
                                        continue
                                    if not self.btc_correlation_tracker.is_aligned(side):
                                        metrics = self.btc_correlation_tracker.get_metrics_string()
                                        self.logger.info(f"🚫 [BTC Divergence] Confirmed Wall at {price} rejected! {metrics}")
                                        self.tracked_walls[price]['btc_rejected'] = True
                                        continue
                                    else:
                                        self.logger.info(f"✅ [BTC Correlation] Aligned for {side.upper()}! {self.btc_correlation_tracker.get_metrics_string()}")
                                        
                                # Adaptive Trend Filter Check
                                if self.enable_trend_filter and self.trend_finder:
                                    if self.tracked_walls[price].get('trend_rejected'):
                                        continue
                                    target_trade_dir = "buy" if getattr(self, 'strategy_mode', 'long') == 'long' else "sell" 
                                    try:
                                        klines = await market_depth_service.fetch_ohlcv(self.symbol, self.exchange_id, '1m', 1200)
                                        if klines:
                                            close_prices = [float(k['close']) for k in klines]
                                            volumes = [float(k.get('volume', 0)) for k in klines]
                                            trend_analysis = self.trend_finder.analyze_trend(close_prices)
                                            is_acceptable, tb_reason = self.trend_finder.is_trend_acceptable(trend_analysis, target_trade_dir)
                                            
                                            if is_acceptable and getattr(self, 'enable_trend_volume', False):
                                                lookback = self.trend_filter_lookback
                                                recent_vols = volumes[-lookback:] if len(volumes) >= lookback else volumes
                                                if recent_vols:
                                                    avg_vol = sum(recent_vols) / len(recent_vols)
                                                    current_vol = volumes[-1]
                                                    if current_vol < avg_vol * getattr(self, 'trend_volume_multiplier', 1.5):
                                                        is_acceptable = False
                                                        tb_reason = f"Rejected: Volume too low ({current_vol:.2f} < {avg_vol * self.trend_volume_multiplier:.2f})"
                                                    else:
                                                        tb_reason += f" | Vol OK ({current_vol:.2f})"

                                            if not is_acceptable:
                                                self.logger.info(f"🚫 [Trend Filter] Confirmed Snipe at {price} rejected! {tb_reason}")
                                                self.tracked_walls[price]['trend_rejected'] = True
                                                continue
                                            else:
                                                self.logger.info(f"📈 [Trend Filter] {tb_reason}")
                                    except Exception as e:
                                        self.logger.error(f"Failed to execute trend filter check: {e}")
                                        continue
                                        
                                # --- Modular UT Bot Alerts Filter (Confirmed Snipe) ---
                                if self.enable_ut_entry_trigger and self.ut_bot_tracker:
                                    if self.tracked_walls[price].get('ut_entry_rejected'):
                                        continue
                                    if getattr(self, 'ut_trend_unlock_mode', False):
                                        if self.unlocked_ut_dir != side:
                                            self.logger.info(f"🚫 [UT Unlock Filter] Confirmed Snipe at {price} rejected! Waiting for initial {side.upper()} crossover.")
                                            self.tracked_walls[price]['ut_entry_rejected'] = True
                                            continue
                                        else:
                                            self.logger.info(f"🔓 [UT Unlock] Path is clear for {side.upper()}!")
                                    else:
                                        if not self.ut_bot_tracker.is_entry_signal(side):
                                            self.logger.info(f"🚫 [UT Entry Filter] Confirmed Snipe at {price} rejected! No exact crossover entry signal.")
                                            self.tracked_walls[price]['ut_entry_rejected'] = True
                                            continue
                                        else:
                                            self.logger.info(f"📈 [UT Entry Filter] Exact {side.upper()} crossover signal detected!")

                                if self.enable_ut_trend_filter and self.ut_bot_tracker:
                                    if self.tracked_walls[price].get('ut_trend_rejected'):
                                        continue
                                    if not self.ut_bot_tracker.is_trend_aligned(side):
                                        self.logger.info(f"🚫 [UT Trend Filter] Confirmed Snipe at {price} rejected! Trend direction misaligned.")
                                        self.tracked_walls[price]['ut_trend_rejected'] = True
                                        continue
                                    else:
                                        self.logger.info(f"📈 [UT Trend Filter] Trend is aligned for {side.upper()}.")

                                # --- Modular Supertrend Alerts Filter (Confirmed Snipe) ---
                                if self.enable_supertrend_entry_trigger and self.supertrend_tracker:
                                    if self.tracked_walls[price].get('supertrend_entry_rejected'):
                                        continue
                                    if getattr(self, 'supertrend_trend_unlock_mode', False):
                                        if self.unlocked_supertrend_dir != side:
                                            self.logger.info(f"🚫 [Supertrend Unlock Filter] Confirmed Snipe at {price} rejected! Waiting for initial {side.upper()} crossover.")
                                            self.tracked_walls[price]['supertrend_entry_rejected'] = True
                                            continue
                                        else:
                                            self.logger.info(f"🔓 [Supertrend Unlock] Path is clear for {side.upper()}!")
                                    else:
                                        if not self.supertrend_tracker.is_entry_signal(side):
                                            self.logger.info(f"🚫 [Supertrend Entry Filter] Confirmed Snipe at {price} rejected! No exact crossover entry signal.")
                                            self.tracked_walls[price]['supertrend_entry_rejected'] = True
                                            continue
                                        else:
                                            self.logger.info(f"📈 [Supertrend Entry Filter] Exact {side.upper()} crossover signal detected!")

                                if self.enable_supertrend_trend_filter and self.supertrend_tracker:
                                    if self.tracked_walls[price].get('supertrend_trend_rejected'):
                                        continue
                                    if not self.supertrend_tracker.is_trend_aligned(side):
                                        self.logger.info(f"🚫 [Supertrend Trend Filter] Confirmed Snipe at {price} rejected! Trend direction misaligned.")
                                        self.tracked_walls[price]['supertrend_trend_rejected'] = True
                                        continue
                                    else:
                                        self.logger.info(f"📈 [Supertrend Trend Filter] Trend is aligned for {side.upper()}.")

                                if getattr(self.dual_engine_tracker, "is_enabled", False):
                                    if self.tracked_walls[price].get('dual_engine_rejected'):
                                        continue
                                    if not self.dual_engine_tracker.is_aligned(side):
                                        self.logger.info(f"🚫 [Dual Engine] Confirmed Snipe at {price} rejected! {self.dual_engine_tracker.get_metrics_string()}")
                                        self.tracked_walls[price]['dual_engine_rejected'] = True
                                        continue
                                    else:
                                        self.logger.info(f"📈 [Dual Engine] Confirmed aligned for {side.upper()}! {self.dual_engine_tracker.get_metrics_string()}")

                                # --- Multi-Level Orderbook Imbalance (OIB) ---
                                # NOTE: No cache used — OIB is re-evaluated every tick so improving
                                # orderbook conditions can unlock a previously-rejected wall.
                                if getattr(self, 'enable_oib_filter', False):
                                    oib_ratio = self.calculate_oib(orderbook, depth=10)
                                    min_oib_threshold = getattr(self, 'min_oib_threshold', 0.4)
                                    
                                    if side == "buy" and oib_ratio < min_oib_threshold:
                                        self.logger.info(f"🚫 [OIB Filter] Confirmed Snipe at {price} rejected! Weak Bid presence ({oib_ratio*100:.1f}%).")
                                        continue
                                    elif side == "sell" and (1 - oib_ratio) < min_oib_threshold:
                                        self.logger.info(f"🚫 [OIB Filter] Confirmed Snipe at {price} rejected! Weak Ask presence ({(1-oib_ratio)*100:.1f}%).")
                                        continue
                                    else:
                                        support = oib_ratio if side == "buy" else (1-oib_ratio)
                                        self.logger.info(f"📈 [OIB Filter] Confirmed! Orderbook supports {side.upper()} with {support*100:.1f}% dominance.")

                                # --- AI Model Filter (L2 Predictor) ---
                                override_sl = None
                                override_tp = None
                                if getattr(self, 'enable_ml_filter', False) and getattr(self, 'ml_predictor', None):
                                    ml_mode = getattr(self, 'ml_execution_mode', 'basic')
                                    is_ai_valid = False
                                    
                                    if ml_mode == 'advanced':
                                        advanced_setup = await self.ml_predictor.predict_advanced(orderbook, mid_price, side, self)
                                        if advanced_setup and advanced_setup.get("is_valid", False):
                                            is_ai_valid = True
                                            override_sl = advanced_setup.get("sl_price")
                                            override_tp = advanced_setup.get("tp_price")
                                            self.logger.info(f"🔮 [ML Advanced] Confirmed Setup Generated: SL={override_sl}, TP={override_tp}, R:R={advanced_setup.get('rr_ratio')}")
                                    else:
                                        is_ai_valid = await self.ml_predictor.predict(orderbook, mid_price, side)
                                        
                                    if not is_ai_valid:
                                        if current_time - getattr(self, '_last_ai_log_time', 0) > 10.0:
                                            self.logger.info(f"🚫 [AI Filter] Confirmed Snipe at {price} rejected! L2 Model predicts adverse movement.")
                                            self._last_ai_log_time = current_time
                                        continue
                                    else:
                                        if getattr(self.ml_predictor, 'is_loaded', False):
                                            self.logger.info(f"🤖 [AI Filter] Model confirmed {side.upper()} order flow!")
                                        else:
                                            self.logger.info(f"⚠️ [AI Filter] Model unavailable. Trade allowed by default.")

                                self.logger.info(f"🟢 Genuine Wall detected at {price} (Alive for {time_alive:.1f}s) {'[HVN Confirmed]' if self.vpvr_enabled else ''}. Executing Snipe!")
                                if self.enable_proxy_wall:
                                    try:
                                        native_book = await self.public_exchange.fetch_order_book(self.symbol, limit=5)
                                        native_best_bid = native_book['bids'][0][0]
                                        native_best_ask = native_book['asks'][0][0]
                                        native_mid = (native_best_bid + native_best_ask) / 2
                                        await self.execute_snipe(price, side, native_mid, native_best_bid, native_best_ask, override_sl_price=override_sl, override_tp_price=override_tp)
                                    except Exception as e:
                                        self.logger.warning(f"Error fetching native execution book for proxy snipe: {e}. Falling back to proxy price.")
                                        await self.execute_snipe(price, side, mid_price, best_bid, best_ask, override_sl_price=override_sl, override_tp_price=override_tp)
                                else:
                                    await self.execute_snipe(price, side, mid_price, best_bid, best_ask, override_sl_price=override_sl, override_tp_price=override_tp)
                                self.tracked_walls.clear() # এন্ট্রি নেওয়ার পর ট্র্যাকিং ক্লিয়ার
                                break
                        else:
                            # নতুন একটি বড় ওয়াল পাওয়া গেছে, ট্র্যাকিং শুরু
                            self.tracked_walls[price] = {
                                "vol": vol,
                                "type": side,
                                "first_seen": current_time,
                                "last_seen": current_time
                            }
                    
                    # 3. ফেইক বা স্পুফ করা ওয়ালগুলো রিমুভ করা (Grace Period: 2 Seconds)
                    spoofed_prices = []
                    for price, data in self.tracked_walls.items():
                        if price not in current_walls:
                            # Allow a 2-second grace period for network lag or partial fills
                            if current_time - data['last_seen'] > 2.0:
                                spoofed_prices.append(price)
                    
                    for p in spoofed_prices:
                        time_alive = current_time - self.tracked_walls[p]['first_seen']
                        self.logger.info(f"⚠️ Spoofing Detected: Wall at {p} disappeared after {time_alive:.1f}s. Ignoring.")
                        del self.tracked_walls[p]

                else:
                    # Trailing Stop-Loss Engine
                    if self.enable_proxy_wall and hasattr(self, 'current_native_price') and self.current_native_price:
                        await self.manage_risk(self.current_native_price)
                    else:
                        await self.manage_risk(mid_price)

                if self.enable_proxy_wall and hasattr(self, 'current_native_price') and self.current_native_price:
                    self._publish_status(self.current_native_price)
                else:
                    self._publish_status(mid_price)
                # Yield control, watch_order_book automatically pauses until the next orderbook update
                await asyncio.sleep(0.001) 
            
            except Exception as e:
                self.logger.error(f"Hunter Loop Error: {e}")
                await asyncio.sleep(1)

    async def execute_snipe(self, wall_price: float, side: str, current_mid_price: float, best_bid: float = None, best_ask: float = None, override_order_type: str = None, override_limit_price: float = None, override_sl_price: float = None, override_tp_price: float = None):
        # Select correct entry order type depending on the strategy mode
        # User explicitly requested STRICT POST-ONLY limit entry mode for all WallHunter Bot trades.
        snipe_order_type = override_order_type if override_order_type else "limit"
        
        # Determine Maker vs Taker pricing based on the chosen entry order type
        if snipe_order_type == "limit":
            # True Maker Limit Order: stay on the same side of the book
            if side == "buy":
                base_limit_price = best_bid if best_bid else current_mid_price
            else:
                base_limit_price = best_ask if best_ask else current_mid_price
        else:
            # Taker Execution (Market or Marketable Limit): cross the spread
            if side == "buy":
                base_limit_price = best_ask if best_ask else current_mid_price
            else:
                base_limit_price = best_bid if best_bid else current_mid_price
            
        entry_price = override_limit_price if override_limit_price else base_limit_price
        
        # ── Maker-Price Guard (postOnly only) ────────────────────────────────────
        # Binance rejects a postOnly order that would immediately cross the spread
        # (error: "Order would immediately match and take").
        # This guard nudges the price by 1 tick so the order always rests in the book.
        if snipe_order_type == "limit" and not override_limit_price and best_bid and best_ask:
            tick = None
            try:
                # Derive minimum tick size from exchange market info if available
                if hasattr(self, 'engine') and hasattr(self.engine, 'exchange') and self.engine.exchange:
                    mkt = self.engine.exchange.markets.get(self.symbol, {})
                    precision = mkt.get('precision', {}).get('price')
                    if precision:
                        tick = float(precision) if precision > 0 else None
            except Exception:
                tick = None
            if not tick:
                # Fallback: derive tick from best_bid significant digits (e.g. 0.09297 → 0.00001)
                import math
                tick = round(best_bid * 1e-5, 10) if best_bid else 1e-5  # 5 sig-fig fallback

            if side == "sell":
                # postOnly SELL must be strictly ABOVE best_bid to avoid crossing
                if entry_price <= best_bid:
                    adjusted = best_ask + tick
                    self.logger.warning(
                        f"⚠️ [Maker Guard] SELL price {entry_price} ≤ best_bid {best_bid}! "
                        f"Nudging to {adjusted:.8g} (best_ask + 1 tick) to stay postOnly."
                    )
                    entry_price = adjusted
            elif side == "buy":
                # postOnly BUY must be strictly BELOW best_ask to avoid crossing
                if entry_price >= best_ask:
                    adjusted = best_bid - tick
                    self.logger.warning(
                        f"⚠️ [Maker Guard] BUY price {entry_price} ≥ best_ask {best_ask}! "
                        f"Nudging to {adjusted:.8g} (best_bid - 1 tick) to stay postOnly."
                    )
                    entry_price = adjusted
        # ─────────────────────────────────────────────────────────────────────────

        # Calculate base asset amount
        input_amount = self.config.get("amount_per_trade", 10.0)
        strategy_mode = getattr(self, 'strategy_mode', 'long')
        
        if strategy_mode == 'short' or (strategy_mode == 'auto' and side == 'sell'):
            # It's a Short/Distribution entry.
            input_base_amount = self.config.get("amount_base_per_trade")
            if input_base_amount is not None and input_base_amount > 0:
                base_amount = float(f"{input_base_amount:.6f}")
                self.logger.info(f"💡 [Dual Allocation] Using explicit Base Allocation: {base_amount} {self.symbol.split('/')[0]}")
            else:
                trading_mode = getattr(self, 'trading_mode', 'spot')
                if trading_mode == 'spot':
                    # In Spot Short, the input amount is already the Base asset
                    base_amount = float(f"{input_amount:.6f}")
                    self.logger.info(f"💡 [Spot Short] Using {input_amount} Base directly")
                else:
                    # In Futures Short, convert Quote to Base
                    base_amount = float(f"{input_amount / entry_price:.6f}")
                    self.logger.info(f"💡 [Auto Calculation] Converted {input_amount} Quote to {base_amount} Base at price {entry_price}")
        else:
            # In Long mode, the UI input is Quote Asset, so convert to Base Asset
            base_amount = float(f"{input_amount / entry_price:.6f}")
            
        if hasattr(self.engine.exchange, 'amount_to_precision'):
            try:
                base_amount = float(self.engine.exchange.amount_to_precision(self.symbol, base_amount))
            except Exception:
                pass
        
        # In Paper Trading, simulating a market buy exactly at the bid wall gives an artificial instant PnL advantage (Bid-Ask spread). 
        # Using mid_price prevents instant fake TP triggers.
        execution_price = current_mid_price if self.is_paper_trading else entry_price
        
        self.logger.info(f"⚡ [WallHunter {self.bot_id}] Executing Snipe: {side.upper()} {base_amount} {self.symbol} at {execution_price} (Order Type: {snipe_order_type.upper()})")
        
        if snipe_order_type == "marketable_limit":
             # "marketable_limit" is a special instruction for our engine to use LIMIT with buffer on MEXC
             # but we pass "market" to it so it knows to apply the conversion logic if it's MEXC
             snipe_order_type = "market"
             
        order_params = {"postOnly": True} if snipe_order_type == "limit" else {}

        # Pre-calculate TP and SL targets using execution_price
        if self.enable_micro_scalp:
            tick_profit_pct = self.micro_scalp_profit_ticks * 0.0001
            tp_price = execution_price * (1 - tick_profit_pct) if self._is_active_short(side) else execution_price * (1 + tick_profit_pct)
            sl_price = execution_price * (1 + (self.initial_risk_pct / 100)) if self.initial_risk_pct > 0 else (float('inf') if self._is_active_short(side) else 0.0)
        else:
            dynamic_tp_price = None
            if getattr(self, 'enable_wick_sr', False) and getattr(self, 'enable_dynamic_wick_tp', False) and hasattr(self, 'wick_sr_tracker'):
                dynamic_tp_price = self.wick_sr_tracker.get_dynamic_tp(
                    side=side, 
                    entry_price=execution_price, 
                    frontrun_pct=getattr(self, 'dynamic_tp_frontrun_pct', 0.0)
                )

            # AUTO FIBO MAX TP EXTENSION
            if not dynamic_tp_price and getattr(self, 'enable_auto_fibo_tp', False) and not override_tp_price:
                try:
                    fibo_tf = getattr(self, 'auto_fibo_timeframe', '5m')
                    fibo_level = getattr(self, 'auto_fibo_target_level', 1.618)
                    fibo_lookback = getattr(self, 'auto_fibo_lookback', 30)
                    
                    ohlcv = await self.public_exchange.fetch_ohlcv(self.symbol, timeframe=fibo_tf, limit=fibo_lookback)
                    if ohlcv:
                        calculated_tp = calculate_fibo_extension_tp(ohlcv, execution_price, side, float(fibo_level))
                        if calculated_tp:
                            dynamic_tp_price = calculated_tp
                            self.logger.info(f"🎯 [AUTO-FIBO] Computed Maximum Dynamic TP: {dynamic_tp_price:.6f} at {fibo_level}x Extension!")
                except Exception as e:
                    self.logger.error(f"Failed to compute Auto-Fibo TP! Falling back to spread. Err: {e}")

            if self._is_active_short(side):
                sl_price = override_sl_price if override_sl_price else (execution_price * (1 + (self.initial_risk_pct / 100)) if self.initial_risk_pct > 0 else float('inf'))
                if override_tp_price:
                    tp_price = override_tp_price
                    self.logger.info(f"🎯 [Advanced ML Setup] TP Set to {tp_price:.6f} dynamically!")
                elif dynamic_tp_price and dynamic_tp_price < execution_price:
                    tp_price = dynamic_tp_price
                    self.logger.info(f"🎯 [Dynamic TP] Set to {tp_price:.6f} dynamically!")
                else:
                    tp_price = execution_price - self.target_spread
                    if getattr(self, 'enable_dynamic_wick_tp', False) or getattr(self, 'enable_auto_fibo_tp', False):
                        self.logger.info(f"⚠️ [Dynamic TP] Fallback Spread TP activated: {tp_price:.6f}")
            else:
                sl_price = override_sl_price if override_sl_price else (execution_price * (1 - (self.initial_risk_pct / 100)) if self.initial_risk_pct > 0 else 0.0)
                if override_tp_price:
                    tp_price = override_tp_price
                    self.logger.info(f"🎯 [Advanced ML Setup] TP Set to {tp_price:.6f} dynamically!")
                elif dynamic_tp_price and dynamic_tp_price > execution_price:
                    tp_price = dynamic_tp_price
                    self.logger.info(f"🎯 [Dynamic TP] Set to {tp_price:.6f} dynamically!")
                else:
                    tp_price = execution_price + self.target_spread
                    if getattr(self, 'enable_dynamic_wick_tp', False) or getattr(self, 'enable_auto_fibo_tp', False):
                        self.logger.info(f"⚠️ [Dynamic TP] Fallback Spread TP activated: {tp_price:.6f}")

        # --- NATIVE BINANCE OTO/OTOCO PLACEMENT ---
        is_otoco_eligible = (
            getattr(self, 'use_native_binance_otoco', False)
            and not self.is_paper_trading
            and self.exchange_id == 'binance'
            and getattr(self, 'trading_mode', 'spot') == 'spot'
            and snipe_order_type == "limit"
            and not getattr(self, 'enable_tsl', False)
            and not getattr(self, 'atr_sl_enabled', False)
            and not getattr(self, 'enable_ut_trailing_sl', False)
            and not getattr(self, 'enable_supertrend_trailing_sl', False)
        )
        
        res = None
        if is_otoco_eligible and hasattr(self, 'engine') and self.engine and hasattr(self.engine, 'exchange') and self.engine.exchange:
            try:
                native_market = self.engine.exchange.market(self.symbol)
                native_symbol = native_market['id']
                has_tp = bool(tp_price and tp_price > 0)
                has_sl = bool(sl_price and sl_price > 0 and sl_price != float('inf'))
                is_post_only = (order_params.get("postOnly", False))
                
                otoco_payload = {
                    "symbol": native_symbol,
                    "workingType": "LIMIT_MAKER" if is_post_only else "LIMIT",
                    "workingSide": side.upper(),
                    "workingPrice": self.engine.exchange.price_to_precision(self.symbol, execution_price),
                    "workingQuantity": self.engine.exchange.amount_to_precision(self.symbol, base_amount),
                    "pendingSide": "SELL" if side.lower() == "buy" else "BUY",
                    "pendingQuantity": self.engine.exchange.amount_to_precision(self.symbol, base_amount),
                }
                if not is_post_only:
                    otoco_payload["workingTimeInForce"] = "GTC"
                    
                if has_tp and has_sl:
                    if side.lower() == 'buy':
                        otoco_payload['pendingAboveType'] = 'LIMIT_MAKER'
                        otoco_payload['pendingAbovePrice'] = self.engine.exchange.price_to_precision(self.symbol, tp_price)
                        otoco_payload['pendingBelowType'] = 'STOP_LOSS_LIMIT'
                        otoco_payload['pendingBelowTimeInForce'] = 'GTC'
                        otoco_payload['pendingBelowStopPrice'] = self.engine.exchange.price_to_precision(self.symbol, sl_price)
                        otoco_payload['pendingBelowPrice'] = self.engine.exchange.price_to_precision(self.symbol, sl_price * 0.999)
                    else:
                        otoco_payload['pendingAboveType'] = 'STOP_LOSS_LIMIT'
                        otoco_payload['pendingAboveTimeInForce'] = 'GTC'
                        otoco_payload['pendingAboveStopPrice'] = self.engine.exchange.price_to_precision(self.symbol, sl_price)
                        otoco_payload['pendingAbovePrice'] = self.engine.exchange.price_to_precision(self.symbol, sl_price * 1.001)
                        otoco_payload['pendingBelowType'] = 'LIMIT_MAKER'
                        otoco_payload['pendingBelowPrice'] = self.engine.exchange.price_to_precision(self.symbol, tp_price)
                        
                    self.logger.info(f"⚡ [Native OTOCO] Placing Binance atomic OTOCO for {self.symbol} (Entry: {execution_price}, TP: {tp_price}, SL: {sl_price})...")
                    raw_res = await self.engine.exchange.private_post_orderlist_otoco(otoco_payload)
                elif has_tp:
                    otoco_payload['pendingType'] = 'LIMIT_MAKER'
                    otoco_payload['pendingPrice'] = self.engine.exchange.price_to_precision(self.symbol, tp_price)
                    self.logger.info(f"⚡ [Native OTO] Placing Binance atomic OTO (TP only) for {self.symbol}...")
                    raw_res = await self.engine.exchange.private_post_orderlist_oto(otoco_payload)
                elif has_sl:
                    otoco_payload['pendingType'] = 'STOP_LOSS_LIMIT'
                    otoco_payload['pendingTimeInForce'] = 'GTC'
                    otoco_payload['pendingStopPrice'] = self.engine.exchange.price_to_precision(self.symbol, sl_price)
                    otoco_payload['pendingPrice'] = self.engine.exchange.price_to_precision(self.symbol, sl_price * (0.999 if side.lower() == 'buy' else 1.001))
                    self.logger.info(f"⚡ [Native OTO] Placing Binance atomic OTO (SL only) for {self.symbol}...")
                    raw_res = await self.engine.exchange.private_post_orderlist_oto(otoco_payload)
                else:
                    raw_res = None
                    
                if raw_res:
                    order_list = raw_res.get('orderReports', [])
                    working_order = next((o for o in order_list if o.get('type') in ['LIMIT', 'LIMIT_MAKER']), None)
                    if not working_order and len(order_list) > 0:
                        working_order = order_list[0]
                    working_order_id = str(working_order.get('orderId')) if working_order else str(raw_res.get('orderListId'))
                    res = {
                        'id': working_order_id,
                        'orderListId': str(raw_res.get('orderListId', '')),
                        'price': execution_price,
                        'amount': base_amount,
                        'is_native_otoco': True,
                        'info': raw_res
                    }
                    self.logger.info(f"✅ [Native OTOCO] Placed successfully! OrderListId: {res['orderListId']}, WorkingOrderId: {res['id']}")
            except Exception as otoco_err:
                self.logger.info(f"ℹ️ [Native OTOCO] Maker notice ({otoco_err}). Falling back to standard entry...")
                res = None

        if not res:
            res = await self.engine.execute_trade(side, base_amount, execution_price, order_type=snipe_order_type, params=order_params)

        if res:
            self.logger.info(f"✅ [WallHunter {self.bot_id}] Trade executed successfully. Order ID: {res.get('id')}")
            
            # --- Robustness: Initial Position State Save (Immediate) ---
            initial_entry = res.get('average') or res.get('price') or execution_price
            is_native = res.get('is_native_otoco', False)

            self.active_pos = {
                "side": side,
                "entry": initial_entry,
                "amount": base_amount,
                "sl": sl_price,
                "tp": tp_price,
                "tp1": tp_price,
                "tp1_hit": False,
                "breakeven_hit": False,
                "tsl_activated": False,
                "entry_order_id": res.get('id'),
                "order_list_id": res.get('orderListId'),
                "is_native_otoco": is_native,
                "limit_order_id": None,
                "micro_scalp": self.enable_micro_scalp
            }
            if side == "buy":
                self.total_longs += 1
            else:
                self.total_shorts += 1
            self.highest_price = initial_entry
            self.lowest_price = initial_entry
            self._save_state()
            # ----------------------------------------------------------

            # --- NEW: Partial Fill Management for Entry ---
            entry_type = self.sell_order_type if getattr(self, 'strategy_mode', 'long') == "short" else self.buy_order_type
            if entry_type in ['limit', 'marketable_limit'] and res.get('id') and not self.is_paper_trading:
                try:
                    order_status = None
                    # Use dynamic entry_order_timeout
                    sleep_time = 0.5 if snipe_order_type == "limit" else 0.4
                    timeout_secs = getattr(self, "entry_order_timeout", 30.0)
                    max_attempts = int(timeout_secs / sleep_time) if snipe_order_type == "limit" else 5
                    
                    for attempt in range(max_attempts):
                        await asyncio.sleep(sleep_time)
                        try:
                            # To avoid CCXT rate limits on long 30s waits, only fetch every ~1.5 seconds
                            if attempt % 3 == 0 or max_attempts <= 5:
                                order_status = await self.engine.exchange.fetch_order(res['id'], self.symbol)
                                if order_status and order_status.get('status') != 'open':
                                    break
                        except Exception: pass
                    
                    if order_status and order_status.get('status') == 'open':
                        self.logger.warning(f"⚠️ Entry order {res['id']} is still open! Cancelling remainder...")
                        await self.engine.cancel_order(res['id'])
                        await asyncio.sleep(0.5)
                        
                        final_status = await self.engine.exchange.fetch_order(res['id'], self.symbol)
                        filled = final_status.get('filled', 0.0)
                        
                        if filled <= 0:
                            self.logger.info(f"❌ Entry order was completely unfilled before cancellation. Aborting snipe.")
                            self.active_pos = None
                            if side == "buy":
                                self.total_longs = max(0, self.total_longs - 1)
                            else:
                                self.total_shorts = max(0, self.total_shorts - 1)
                            await self._clear_state()
                            return
                            
                        self.logger.info(f"🔄 Partial Fill Detected! Requested: {base_amount}, Filled: {filled}. Adjusting position size.")
                        # Parse precision natively so exchange math doesn't break later
                        base_amount_raw = float(self.engine.exchange.amount_to_precision(self.symbol, filled)) if hasattr(self.engine.exchange, 'amount_to_precision') else filled
                        base_amount = base_amount_raw
                        
                        self.active_pos['amount'] = base_amount
                        self.active_pos['entry'] = final_status.get('average') or final_status.get('price') or initial_entry
                        self._save_state()
                except Exception as e:
                    self.logger.error(f"Error handling partial fill verification on entry: {e}")
            # ---------------------------------------------
            
            # Safely extract average fill price. Fallback to requested entry_price if not provided or 0
            avg_price = res.get('average')
            fill_price = res.get('price')
            
            # If CCXT did not return average price initially, launch a background task
            # We will use current_mid_price (or fill price) temporarily so we can proceed instantly.
            if not self.is_paper_trading and res.get('id') and self.engine.exchange and not (avg_price and avg_price > 0):
                self.logger.info(f"⚡ Price not instantly available for {res.get('id')}. Spawning background tracker...")
                asyncio.create_task(self._fetch_and_update_entry(res['id'], base_amount, current_mid_price))
                # For now, we proceed to set up SL/TP using intermediate price
                pass

            actual_entry = avg_price if avg_price and avg_price > 0 else (fill_price if fill_price and fill_price > 0 else initial_entry)
            actual_entry = float(actual_entry)
            
            # Sanity Check to prevent instant SL logic if CCXT returns an outdated or widely inaccurate fill price
            slippage_pct = abs(actual_entry - current_mid_price) / current_mid_price
            if slippage_pct > 0.02: # If the executed price differs from the mid price by more than 2%
                self.logger.warning(f"Suspicious fill price from CCXT: {actual_entry}. Overriding with mid_price: {current_mid_price}")
                actual_entry = current_mid_price
            
            # --- UPDATED: Position tracking for TP1 and TP2 ---
            if self.enable_micro_scalp:
                if getattr(self, 'enable_dynamic_atr_scalp', False) and getattr(self, 'current_atr', 0) > 0:
                    atr_distance = self.current_atr * getattr(self, 'micro_scalp_atr_multiplier', 0.5)
                    tick_profit_pct = atr_distance / actual_entry if actual_entry > 0 else 0
                    self.logger.info(f"⚡ Dynamic ATR Scalp calculated {tick_profit_pct*100:.3f}% target.")
                else:
                    tick_profit_pct = self.micro_scalp_profit_ticks * 0.0001
                    
                tp_price = actual_entry * (1 - tick_profit_pct) if self._is_active_short() else actual_entry * (1 + tick_profit_pct)
                
                # Make SL dynamic as well if configured, otherwise fallback to initial_risk_pct
                if getattr(self, 'enable_dynamic_atr_scalp', False) and getattr(self, 'current_atr', 0) > 0:
                    sl_distance = self.current_atr * getattr(self, 'atr_multiplier', 1.0)
                    sl_pct = sl_distance / actual_entry if actual_entry > 0 else 0
                    atr_sl = actual_entry * (1 + sl_pct) if self._is_active_short() else actual_entry * (1 - sl_pct)
                    # Guard: ATR SL should never degrade protection vs initial_risk_pct SL
                    if self.initial_risk_pct > 0:
                        base_sl = actual_entry * (1 + (self.initial_risk_pct / 100)) if self._is_active_short() else actual_entry * (1 - (self.initial_risk_pct / 100))
                        sl_price = min(atr_sl, base_sl) if self._is_active_short() else max(atr_sl, base_sl)
                    else:
                        sl_price = atr_sl
                else:
                    if self.initial_risk_pct > 0:
                        sl_price = actual_entry * (1 + (self.initial_risk_pct / 100)) if self._is_active_short() else actual_entry * (1 - (self.initial_risk_pct / 100))
                    else:
                        sl_price = float('inf') if self._is_active_short() else 0.0
                
                self.active_pos = {
                    "entry": actual_entry,
                    "amount": base_amount,
                    "sl": sl_price,
                    "tp1": tp_price,
                    "tp": tp_price,
                    "tp1_hit": True, # Ignore partial TP
                    "breakeven_hit": False,
                    "tsl_activated": False,
                    "entry_order_id": self.active_pos.get('entry_order_id'),
                    "order_list_id": self.active_pos.get('order_list_id'),
                    "is_native_otoco": self.active_pos.get('is_native_otoco', False),
                    "limit_order_id": None,
                    "micro_scalp": True
                }
                self.highest_price = actual_entry
                self.lowest_price = actual_entry
                
                close_side = "buy" if getattr(self, 'strategy_mode', 'long') == "short" else "sell"
                close_amount = base_amount
                
                if not self.active_pos.get('is_native_otoco'):
                    limit_res = await self.engine.execute_trade(close_side, close_amount, tp_price, order_type="limit", params={"postOnly": True})
                    if limit_res and 'id' in limit_res:
                        self.active_pos['limit_order_id'] = limit_res['id']
                        self.logger.info(f"⚡ Micro-Scalp: Placed Limit TP Order {limit_res['id']} at {tp_price}")
                    
                self._save_state()
                self.active_pos['entry_time'] = time.time()
                self.active_pos['zero_tolerance_hit'] = False
                
                # --- Activate Zero Tolerance if Risk is 0 ---
                if self.initial_risk_pct == 0 and self.zero_tolerance_tracker.enable_zero_tolerance:
                    tick_size = 0.0
                    try:
                        if self.engine and self.engine.exchange and self.symbol in self.engine.exchange.markets:
                            mkt = self.engine.exchange.markets[self.symbol]
                            precision = mkt.get('precision', {}).get('price')
                            if precision:
                                tick_size = float(precision)
                    except Exception:
                        pass
                    if not tick_size:
                        tick_size = round(actual_entry * 1e-5, 10) if actual_entry else 1e-5
                    
                    self.zero_tolerance_tracker.activate(actual_entry, side, tick_size)
                    self.logger.info(f"🛡️ Zero Tolerance Tracker Activated! Trigger Price: {self.zero_tolerance_tracker.trigger_price:.6f}")
                # ------------------------------------------
                strategy_m = getattr(self, 'strategy_mode', 'long')
                if strategy_m == 'auto':
                    trade_type = f"Spot Auto ({'Buy' if side == 'buy' else 'Sell'})"
                elif strategy_m == 'short':
                    trade_type = "Spot Base (Short)"
                else:
                    trade_type = "Long" if side == 'buy' else "Short"
                await self._send_telegram(
                    f"⚡ Micro-Scalp Entered!\n"
                    f"Bot Name: {getattr(self, 'bot_name', f'Bot {self.bot_id}')}\n"
                    f"Bot ID: {self.bot_id}\n"
                    f"Trade Types: {trade_type}\n"
                    f"Pair: {self.symbol}\n"
                    f"Entry {actual_entry:.6f}\n"
                    f"TP: {self.active_pos['tp']:.6f}\n"
                    f"SL: {self.active_pos['sl']:.6f}"
                )
                asyncio.create_task(ta_snapshot_service.send_snapshot_telegram(self, actual_entry, trade_type))
                
            else:
                if self._is_active_short():
                    tp1_price = actual_entry * (1 - (getattr(self, 'partial_tp_trigger_pct', 0.0) / 100)) if getattr(self, 'partial_tp_trigger_pct', 0.0) > 0 else actual_entry - (self.target_spread * 0.5)
                    tp_price = actual_entry - self.target_spread
                    sl_price = actual_entry * (1 + (self.initial_risk_pct / 100)) if self.initial_risk_pct > 0 else float('inf')
                else:
                    tp1_price = actual_entry * (1 + (getattr(self, 'partial_tp_trigger_pct', 0.0) / 100)) if getattr(self, 'partial_tp_trigger_pct', 0.0) > 0 else actual_entry + (self.target_spread * 0.5)
                    tp_price = actual_entry + self.target_spread
                    sl_price = actual_entry * (1 - (self.initial_risk_pct / 100)) if self.initial_risk_pct > 0 else 0.0

                self.active_pos = {
                    "entry": actual_entry,
                    "amount": base_amount,
                    "sl": sl_price,
                    "tp1": tp1_price,
                    "tp": tp_price,          # Final TP
                    "tp1_hit": False,
                    "breakeven_hit": False,
                    "tsl_activated": False,
                    "entry_order_id": self.active_pos.get('entry_order_id'),
                    "order_list_id": self.active_pos.get('order_list_id'),
                    "is_native_otoco": self.active_pos.get('is_native_otoco', False),
                    "limit_order_id": None,
                    "micro_scalp": False
                }
                self.highest_price = actual_entry
                self.lowest_price = actual_entry
                
                # Place Limit Order immediately if configured
                exit_order_type = self.buy_order_type if getattr(self, 'strategy_mode', 'long') == "short" else self.sell_order_type
                if exit_order_type == 'limit' and not self.active_pos.get('is_native_otoco'):
                    close_side = "buy" if getattr(self, 'strategy_mode', 'long') == "short" else "sell"
                    close_amount = base_amount
                    limit_res = await self.engine.execute_trade(close_side, close_amount, self.active_pos['tp'], order_type="limit", params={"postOnly": True})
                    if limit_res and 'id' in limit_res:
                        self.active_pos['limit_order_id'] = limit_res['id']
                        self.logger.info(f"Placed Limit TP Order {limit_res['id']} at {self.active_pos['tp']}")
                
                self.logger.info(f"Entered Trade at {actual_entry}. SL: {self.active_pos['sl']}")
                self._save_state()
                self.active_pos['entry_time'] = time.time()
                self.active_pos['zero_tolerance_hit'] = False
                
                # --- Activate Zero Tolerance if Risk is 0 ---
                if self.initial_risk_pct == 0 and self.zero_tolerance_tracker.enable_zero_tolerance:
                    tick_size = 0.0
                    try:
                        if self.engine and self.engine.exchange and self.symbol in self.engine.exchange.markets:
                            mkt = self.engine.exchange.markets[self.symbol]
                            precision = mkt.get('precision', {}).get('price')
                            if precision:
                                tick_size = float(precision)
                    except Exception:
                        pass
                    if not tick_size:
                        tick_size = round(actual_entry * 1e-5, 10) if actual_entry else 1e-5
                    
                    self.zero_tolerance_tracker.activate(actual_entry, side, tick_size)
                    self.logger.info(f"🛡️ Zero Tolerance Tracker Activated! Trigger Price: {self.zero_tolerance_tracker.trigger_price:.6f}")
                # ------------------------------------------
                strategy_m = getattr(self, 'strategy_mode', 'long')
                if strategy_m == 'auto':
                    trade_type = f"Spot Auto ({'Buy' if side == 'buy' else 'Sell'})"
                elif strategy_m == 'short':
                    trade_type = "Spot Base (Short)"
                else:
                    trade_type = "Long" if side == 'buy' else "Short"
                
                ml_health_str = ""
                if self.enable_ml_filter and hasattr(self, 'ml_predictor') and self.ml_predictor:
                    active = getattr(self.ml_predictor, 'last_active_features', 0)
                    total = getattr(self.ml_predictor, 'total_model_features', 0)
                    bullish = getattr(self.ml_predictor, 'bullish_threshold', 0.5) * 100
                    bearish = getattr(self.ml_predictor, 'bearish_threshold', 0.5) * 100
                    pred_score = getattr(self.ml_predictor, 'last_prediction_score', 0.0)
                    ml_health_str = f"🧠 AI Health: {active}/{total} Features Active\n📈 Bullish Threshold: {bullish:.0f}%\n📉 Bearish Threshold: {bearish:.0f}%\n🤖 AI Score: {pred_score:.4f} ({(pred_score*100):.2f}%)\n"

                await self._send_telegram(
                    f"⚡ WallHunter Entered!\n"
                    f"Bot Name: {getattr(self, 'bot_name', f'Bot {self.bot_id}')}\n"
                    f"Bot ID: {self.bot_id}\n"
                    f"Trade Types: {trade_type}\n"
                    f"{ml_health_str}"
                    f"Pair: {self.symbol}\n"
                    f"Entry {actual_entry:.6f}\n"
                    f"TP1: {self.active_pos['tp1']:.6f}\n"
                    f"Final TP: {self.active_pos['tp']:.6f}\n"
                    f"SL: {self.active_pos['sl']:.6f}"
                )
                asyncio.create_task(ta_snapshot_service.send_snapshot_telegram(self, actual_entry, trade_type))

    async def _fetch_and_update_entry(self, order_id: str, amount: float, mid_price: float):
        """Background task to fetch precise execution price without blocking strategy"""
        await asyncio.sleep(0.5) # Give the exchange half a second to settle
        try:
            fetched_order = await self.engine.exchange.fetch_order(order_id, self.symbol)
            if not fetched_order:
                return
            
            avg_price = fetched_order.get('average')
            fill_price = fetched_order.get('price')
            actual_entry = avg_price if avg_price and avg_price > 0 else (fill_price if fill_price and fill_price > 0 else mid_price)
            actual_entry = float(actual_entry)
            
            # Sanity Check
            slippage_pct = abs(actual_entry - mid_price) / mid_price
            if slippage_pct > 0.02:
                self.logger.warning(f"Suspicious delayed fill price: {actual_entry}. Keeping previous {mid_price}.")
                return
                
            # Update only if position is still active
            if self.active_pos and self.active_pos.get('entry') != actual_entry:
                old_entry = self.active_pos['entry']
                self.active_pos['entry'] = actual_entry
                
                # Recalculate SL/TP targets based on exact price
                if self.active_pos.get('micro_scalp'):
                    if getattr(self, 'enable_dynamic_atr_scalp', False) and getattr(self, 'current_atr', 0) > 0:
                        atr_distance = self.current_atr * getattr(self, 'micro_scalp_atr_multiplier', 0.5)
                        tick_profit_pct = atr_distance / actual_entry if actual_entry > 0 else 0
                        sl_distance = self.current_atr * getattr(self, 'atr_multiplier', 1.0)
                        sl_pct = sl_distance / actual_entry if actual_entry > 0 else 0
                        
                        if self._is_active_short():
                            tp_price = actual_entry * (1 - tick_profit_pct)
                            self.active_pos['sl'] = actual_entry * (1 + sl_pct)
                        else:
                            tp_price = actual_entry * (1 + tick_profit_pct)
                            self.active_pos['sl'] = actual_entry * (1 - sl_pct)
                    else:
                        tick_profit_pct = self.micro_scalp_profit_ticks * 0.0001
                        if self._is_active_short():
                            tp_price = actual_entry * (1 - tick_profit_pct)
                            self.active_pos['sl'] = actual_entry * (1 + (self.initial_risk_pct / 100)) if self.initial_risk_pct > 0 else float('inf')
                        else:
                            tp_price = actual_entry * (1 + tick_profit_pct)
                            self.active_pos['sl'] = actual_entry * (1 - (self.initial_risk_pct / 100)) if self.initial_risk_pct > 0 else 0.0
                    self.active_pos['tp'] = tp_price
                    self.active_pos['tp1'] = tp_price
                else:
                    if self._is_active_short():
                        self.active_pos['sl'] = actual_entry * (1 + (self.initial_risk_pct / 100)) if self.initial_risk_pct > 0 else float('inf')
                        self.active_pos['tp1'] = actual_entry - (self.target_spread * 0.5)
                        self.active_pos['tp'] = actual_entry - self.target_spread
                    else:
                        self.active_pos['sl'] = actual_entry * (1 - (self.initial_risk_pct / 100)) if self.initial_risk_pct > 0 else 0.0
                        self.active_pos['tp1'] = actual_entry + (self.target_spread * 0.5)
                        self.active_pos['tp'] = actual_entry + self.target_spread
                    
                self.highest_price = actual_entry
                self.lowest_price = actual_entry
                self.logger.info(f"🔄 Entry precision updated in background: {old_entry:.6f} -> {actual_entry:.6f}")
                
                # If there's an active limit order, we might need to adjust it
                active_limit_id = self.active_pos.get('limit_order_id')
                if active_limit_id:
                    # Cancel the old limit order and replace it with the precise one
                    try:
                        await self.engine.cancel_order(active_limit_id)
                        close_side = "buy" if getattr(self, 'strategy_mode', 'long') == "short" else "sell"
                        close_amount = self.active_pos['amount']
                        limit_res = await self.engine.execute_trade(close_side, close_amount, self.active_pos['tp'], order_type="limit", params={"postOnly": True})
                        if limit_res and 'id' in limit_res:
                            self.active_pos['limit_order_id'] = limit_res['id']
                            self.logger.info(f"🔄 Adjusted Limit TP Order to exact price {self.active_pos['tp']}")
                    except Exception as limit_err:
                        self.logger.error(f"Failed to adjust limit order in background precision update: {limit_err}")
                self._save_state()
                        
        except Exception as e:
            self.logger.warning(f"Background fetch_order failed for {order_id}: {e}")

    async def manage_risk(self, current_price: float):
        if not self.active_pos: return
        
        # --- Wick Detection via Last Traded Price (Ticker) ---
        if not getattr(self, 'is_paper_trading', False):
            import time
            current_time = time.time()
            if current_time - getattr(self, '_last_ticker_check_time', 0) > 1.0:
                self._last_ticker_check_time = current_time
                try:
                    ticker = await self.public_exchange.fetch_ticker(self.symbol)
                    last_price = ticker.get('last')
                    if last_price:
                        last_price = float(last_price)
                        if self._is_active_short():
                            current_price = max(current_price, last_price)
                        else:
                            current_price = min(current_price, last_price)
                except Exception as e:
                    pass

        # --- NEW: Entry Order Guard (Recovery/Pending Fill Monitoring) ---
        entry_order_id = self.active_pos.get('entry_order_id')
        if entry_order_id and not self.is_paper_trading:
            try:
                # Check status of the order that opens the position
                status = await self.engine.exchange.fetch_order(entry_order_id, self.symbol)
                if status and status.get('status') in ['open', 'new']:
                    # Log once every roughly 100 loops or 5 seconds to avoid spam
                    if not hasattr(self, '_last_entry_wait_log') or time.time() - self._last_entry_wait_log > 5.0:
                        self.logger.info(f"⏳ Waiting for entry order {entry_order_id} to fill... ({status.get('status')})")
                        self._last_entry_wait_log = time.time()
                    return # Exit manage_risk early, don't execute actions yet
                
                elif status and status.get('status') in ['closed', 'filled']:
                    self.logger.info(f"✅ Entry Order {entry_order_id} has filled! Position is now officially active.")
                    # Update with actual fill details
                    self.active_pos['entry'] = status.get('average') or status.get('price') or self.active_pos['entry']
                    self.active_pos['amount'] = status.get('filled') or self.active_pos['amount']
                    self.active_pos.pop('entry_order_id', None) # Position established, clear the guard
                    self._save_state()
                    # Now continue to normal risk management (Self-Healing, TP, SL, etc.)
                
                elif status and status.get('status') in ['canceled', 'cancelled', 'expired', 'rejected']:
                    filled = status.get('filled', 0.0)
                    if filled > 0:
                        self.logger.info(f"⚠️ Entry Order {entry_order_id} was {status.get('status')}, but partially filled ({filled}). Continuing as partial position.")
                        self.active_pos['amount'] = filled
                        self.active_pos['entry'] = status.get('average') or status.get('price') or self.active_pos['entry']
                        self.active_pos.pop('entry_order_id', None)
                        self._save_state()
                    else:
                        self.logger.warning(f"🗑️ Entry Order {entry_order_id} was {status.get('status')} with zero fills. Discarding position.")
                        await self._clear_state()
                        self.active_pos = None
                        return
            except Exception as e:
                if "Order not found" in str(e):
                    self.logger.error(f"❌ Entry order {entry_order_id} not found on Binance during recovery. Clearing state.")
                    await self._clear_state()
                    self.active_pos = None
                else:
                    self.logger.warning(f"⚠️ Could not verify entry order {entry_order_id}: {e}")
                return # Skip this tick and retry
        # -----------------------------------------------------------------

        # --- NEW: SL Limit Order Guard (Recovery/Pending Fill Monitoring) ---
        sl_limit_order_id = self.active_pos.get('sl_limit_order_id')
        if sl_limit_order_id and not self.is_paper_trading:
            try:
                status = await self.engine.exchange.fetch_order(sl_limit_order_id, self.symbol)
                if status and status.get('status') in ['open', 'new']:
                    if not hasattr(self, '_last_sl_wait_log') or time.time() - self._last_sl_wait_log > 5.0:
                        self.logger.info(f"⏳ Waiting for Strict Limit SL {sl_limit_order_id} to fill... ({status.get('status')})")
                        self._last_sl_wait_log = time.time()
                    
                    # --- AUTO-CHASE MAKER RULE ---
                    chase_interval = 2.0
                    if not hasattr(self, '_last_sl_chase_time') or time.time() - self._last_sl_chase_time > chase_interval:
                        self._last_sl_chase_time = time.time()
                        try:
                            from app.services.market_depth_service import market_depth_service
                            limit_size = market_depth_service._normalize_order_book_limit(self.exchange_id, 5) if hasattr(market_depth_service, '_normalize_order_book_limit') else 5
                            ob = await self.public_exchange.fetch_order_book(self.symbol, limit=limit_size)
                            best_bid = ob['bids'][0][0] if ob['bids'] else 0
                            best_ask = ob['asks'][0][0] if ob['asks'] else 0
                            
                            close_side = "buy" if getattr(self, 'strategy_mode', 'long') == "short" else "sell"
                            target_price = best_bid if close_side == "buy" else best_ask
                            
                            current_order_price = float(status.get('price', 0))
                            
                            if current_order_price > 0 and target_price > 0 and current_order_price != target_price:
                                self.logger.info(f"🏃 Auto-Chase: Limit SL price ({current_order_price}) left behind! Cancelling to chase {target_price}")
                                try:
                                    await self.engine.cancel_order(sl_limit_order_id)
                                except Exception: pass
                                self.active_pos.pop('sl_limit_order_id', None)
                                self._save_state()
                                return # Next tick will re-assess and replace
                        except Exception as e:
                            self.logger.debug(f"Auto-chase check failed: {e}")
                            
                    return # Exit early, don't execute actions yet while SL is pending on book

                elif status and status.get('status') in ['closed', 'filled']:
                    self.logger.info(f"✅ Strict Limit SL {sl_limit_order_id} has filled!")
                    # Treat same as standard exit
                    filled_price = status.get('average') or status.get('price') or self.active_pos['sl']
                    sell_amount = status.get('filled') or self.active_pos['amount']
                    
                    if getattr(self, 'strategy_mode', 'long') == "short":
                        gross = (self.active_pos['entry'] - filled_price) * sell_amount
                    else:
                        gross = (filled_price - self.active_pos['entry']) * sell_amount
                    pnl_val, fee_paid = self._calculate_net_pnl(gross, self.active_pos['entry'], filled_price, sell_amount, is_maker=True)
                    self.total_realized_pnl += pnl_val
                    self.total_executed_orders += 1
                    if pnl_val > 0:
                        self.total_wins += 1
                    else:
                        self.total_losses += 1
                    
                    # Log exit telegram
                    await self._send_exit_telegram("🛡️ WallHunter EXIT - Stopped out via Limit Maker!", filled_price, pnl_val)
                    await self._clear_state()
                    self.active_pos = None
                    return
                elif status and status.get('status') in ['canceled', 'cancelled', 'expired', 'rejected']:
                    filled = status.get('filled', 0.0)
                    if filled > 0:
                        self.logger.info(f"⚠️ Limit SL Order completely broken but partial fill ({filled}). Discarding position state to sync.")
                    else:
                        self.logger.warning(f"🗑️ Limit SL Order {sl_limit_order_id} was {status.get('status')}. You may need to manual exit.")
                    await self._clear_state()
                    self.active_pos = None
                    return
            except Exception as e:
                self.logger.warning(f"⚠️ Could not verify SL Limit order {sl_limit_order_id}: {e}")
                return
        # -----------------------------------------------------------------

        exit_order_type = self.buy_order_type if getattr(self, 'strategy_mode', 'long') == "short" else self.sell_order_type

        # --- NEW: Supertrend Maker-to-Taker Fallback Dual-Exit ---
        supertrend_reversal = False
        if getattr(self, 'enable_supertrend_exit', False) and getattr(self, 'supertrend_tracker', None):
            # Check for reversal based on mode. Reversal to opposite direction means exit.
            if self._is_active_short():
                if self.supertrend_tracker.is_entry_signal('buy'): # Reverses to LONG -> exit short
                    supertrend_reversal = True
            else:
                if self.supertrend_tracker.is_entry_signal('sell'): # Reverses to SHORT -> exit long
                    supertrend_reversal = True
                    
        if supertrend_reversal and not self.active_pos.get('fallback_exit_in_progress'):
            self.logger.warning(f"🚨 Supertrend Reversal Detected! Triggering Maker-to-Taker Exit.")
            self.active_pos['fallback_exit_in_progress'] = True # Prevent duplicate triggers
            self._save_state()
            asyncio.create_task(self._execute_fallback_exit())
            return
        # ---------------------------------------------------------

        # --- Native Binance OTO/OTOCO Monitoring ---
        if self.active_pos.get('is_native_otoco') and self.active_pos.get('order_list_id') and not self.is_paper_trading:
            now = time.time()
            last_otoco_check = getattr(self, '_last_otoco_check_time', 0.0)
            if now - last_otoco_check >= 1.5:
                self._last_otoco_check_time = now
                try:
                    list_id = int(self.active_pos['order_list_id'])
                    order_list_info = await self.engine.exchange.private_get_orderlist({'orderListId': list_id})
                    if order_list_info:
                        list_status = order_list_info.get('listOrderStatus')
                        if list_status == 'ALL_DONE':
                            orders = order_list_info.get('orders', [])
                            filled_order = None
                            is_tp = False
                            for ord_summary in orders:
                                ord_id = ord_summary.get('orderId')
                                try:
                                    det = await self.engine.exchange.fetch_order(ord_id, self.symbol)
                                    if det and det.get('status') == 'closed' and (det.get('filled', 0) or 0) > 0:
                                        filled_order = det
                                        ord_type = det.get('type', '').upper()
                                        if 'LIMIT' in ord_type and 'STOP' not in ord_type:
                                            is_tp = True
                                        else:
                                            is_tp = False
                                        break
                                except Exception:
                                    pass

                            filled_price = (filled_order.get('average') or filled_order.get('price')) if filled_order else (self.active_pos.get('tp') if is_tp else self.active_pos.get('sl'))
                            if not filled_price or filled_price <= 0:
                                filled_price = current_price
                            sell_amount = (filled_order.get('filled') if filled_order else None) or self.active_pos.get('amount')

                            if getattr(self, 'strategy_mode', 'long') == "short":
                                gross = (self.active_pos['entry'] - filled_price) * sell_amount
                            else:
                                gross = (filled_price - self.active_pos['entry']) * sell_amount

                            is_maker = is_tp
                            pnl_val, fee_paid = self._calculate_net_pnl(gross, self.active_pos['entry'], filled_price, sell_amount, is_maker=is_maker)
                            self.total_realized_pnl += pnl_val
                            self.total_executed_orders += 1
                            if pnl_val > 0:
                                self.total_wins += 1
                            else:
                                self.total_losses += 1

                            tag = "🎯 WallHunter EXIT - Native OTOCO TP Filled!" if is_tp else "🛑 WallHunter EXIT - Native OTOCO SL Triggered!"
                            await self._send_exit_telegram(tag, filled_price, pnl_val)
                            self.logger.info(f"✅ Native OTOCO closed! {'TP' if is_tp else 'SL'} executed at {filled_price:.6f}, Net PnL: {pnl_val:.4f}")
                            await self._clear_state()
                            self.active_pos = None
                            return
                        elif list_status == 'REJECT':
                            self.logger.warning(f"⚠️ Native OTOCO {list_id} was REJECTED by Binance. Reverting to software monitoring...")
                            self.active_pos['is_native_otoco'] = False
                            self._save_state()
                except Exception as e:
                    self.logger.warning(f"Error checking Native OTOCO status: {e}")

            # When native OTOCO is active on Binance, bracket is managed directly on exchange.
            # Return early so software trailing / duplicate market exits don't collide with live exchange orders.
            return

        # 0. Self-Healing: If limit TP order is missing but required (e.g. after restart), place it.
        if (exit_order_type == 'limit' or self.active_pos.get('micro_scalp')) and not self.active_pos.get('limit_order_id') and not self.is_paper_trading and not self.active_pos.get('is_native_otoco'):
            self.logger.info("🛠️ [Self-Healing] Missing Limit TP order detected. Placing now...")
            try:
                close_side = "buy" if getattr(self, 'strategy_mode', 'long') == "short" else "sell"
                close_amount = self.active_pos['amount']
                limit_res = await self.engine.execute_trade(close_side, close_amount, self.active_pos['tp'], order_type="limit", params={"postOnly": True})
                if limit_res and 'id' in limit_res:
                    self.active_pos['limit_order_id'] = limit_res['id']
                    self.logger.info(f"✅ [Self-Healing] Placed missing Limit TP Order {limit_res['id']} at {self.active_pos['tp']}")
                    self._save_state()
            except Exception as e:
                self.logger.error(f"❌ [Self-Healing] Failed to place missing limit order: {e}")
                # We don't return here so it can still potentially trigger a market exit via SL/TP if price hits levels

        # 1. Check if the limit TP order has already been filled by the exchange
        if (exit_order_type == 'limit' or self.active_pos.get('micro_scalp')) and self.active_pos.get('limit_order_id') and not self.is_paper_trading and not self.active_pos.get('is_native_otoco'):
            try:
                order_status = await self.engine.exchange.fetch_order(self.active_pos['limit_order_id'], self.symbol)
                if order_status and order_status.get('status') == 'closed':
                    # The limit order was filled!
                    filled_price = order_status.get('average') or order_status.get('price') or self.active_pos['tp']
                    sell_amount = order_status.get('filled') or self.active_pos.get('amount')
                    
                    if getattr(self, 'strategy_mode', 'long') == "short":
                        gross = (self.active_pos['entry'] - filled_price) * sell_amount
                    else:
                        gross = (filled_price - self.active_pos['entry']) * sell_amount
                    pnl_val, fee_paid = self._calculate_net_pnl(gross, self.active_pos['entry'], filled_price, sell_amount, is_maker=True)
                    self.total_realized_pnl += pnl_val
                    self.total_executed_orders += 1
                    if pnl_val > 0:
                        self.total_wins += 1
                    else:
                        self.total_losses += 1
                    await self._send_exit_telegram("🎯 WallHunter EXIT - Limit TP Filled!", filled_price, pnl_val)
                    self.logger.info(f"✅ Limit TP Order {self.active_pos['limit_order_id']} was filled by exchange at {filled_price}")
                    await self._clear_state()
                    self.active_pos = None
                    return
            except Exception as e:
                self.logger.warning(f"Error checking limit order status: {e}")

        # Capture old SL to detect changes for state saving
        old_sl = self.active_pos.get('sl')
        
        if self._is_active_short():
            if not hasattr(self, 'lowest_price') or self.lowest_price == 0:
                self.lowest_price = current_price
            if current_price < self.lowest_price:
                self.lowest_price = current_price
                
                # Check TSL Activation
                activation_pct = getattr(self, 'tsl_activation_pct', 0.0)
                if activation_pct > 0 and not self.active_pos.get('tsl_activated'):
                    trigger = self.active_pos['entry'] * (1 - (activation_pct / 100))
                    if current_price <= trigger:
                        self.active_pos['tsl_activated'] = True
                        self.logger.info(f"🚀 Trailing SL Activated for SHORT at {current_price:.6f}!")
                
                if activation_pct == 0.0 or self.active_pos.get('tsl_activated'):
                    if getattr(self, 'enable_ut_trailing_sl', False) and getattr(self, 'ut_bot_tracker', None):
                        ut_sl = self.ut_bot_tracker.get_dynamic_trailing_sl("short")
                        if ut_sl > 0:
                            self.active_pos['sl'] = min(self.active_pos['sl'], ut_sl)
                    elif self.atr_sl_enabled and getattr(self, 'current_atr', 0) > 0:
                        new_sl = self.lowest_price + (self.current_atr * self.atr_multiplier)
                        self.active_pos['sl'] = min(self.active_pos['sl'], new_sl)
                    elif getattr(self, 'tsl_pct', 0.0) > 0:
                        new_sl = self.lowest_price * (1 + (self.tsl_pct / 100))
                        self.active_pos['sl'] = min(self.active_pos['sl'], new_sl)

            if getattr(self, 'sl_breakeven_trigger_pct', 0.0) > 0 and not self.active_pos.get('breakeven_hit'):
                trigger_price = self.active_pos['entry'] * (1 - (self.sl_breakeven_trigger_pct / 100))
                if current_price <= trigger_price:
                    new_breakeven_sl = self.active_pos['entry'] * (1 - (self.sl_breakeven_target_pct / 100))
                    if new_breakeven_sl < self.active_pos['sl']:
                        self.active_pos['sl'] = new_breakeven_sl
                        self.active_pos['breakeven_hit'] = True
                        self.logger.info(f"🛡️ Set SL to Risk-Free Breakeven at {new_breakeven_sl:.6f}")
                        asyncio.create_task(self._send_telegram(f"🛡️ Stop-Loss moved to Risk-Free!\nPair: {self.symbol}\nNew SL: {new_breakeven_sl:.6f}"))
        else:
            if current_price > self.highest_price:
                self.highest_price = current_price
                
                # Check TSL Activation
                activation_pct = getattr(self, 'tsl_activation_pct', 0.0)
                if activation_pct > 0 and not self.active_pos.get('tsl_activated'):
                    trigger = self.active_pos['entry'] * (1 + (activation_pct / 100))
                    if current_price >= trigger:
                        self.active_pos['tsl_activated'] = True
                        self.logger.info(f"🚀 Trailing SL Activated for LONG at {current_price:.6f}!")
                
                # Update Trailing SL
                if activation_pct == 0.0 or self.active_pos.get('tsl_activated'):
                    if getattr(self, 'enable_ut_trailing_sl', False) and getattr(self, 'ut_bot_tracker', None):
                        ut_sl = self.ut_bot_tracker.get_dynamic_trailing_sl("long")
                        if ut_sl > 0:
                            self.active_pos['sl'] = max(self.active_pos['sl'], ut_sl)
                    elif self.atr_sl_enabled and getattr(self, 'current_atr', 0) > 0:
                        new_sl = self.highest_price - (self.current_atr * self.atr_multiplier)
                        self.active_pos['sl'] = max(self.active_pos['sl'], new_sl)
                    elif getattr(self, 'tsl_pct', 0.0) > 0:
                        new_sl = self.highest_price * (1 - (self.tsl_pct / 100))
                        self.active_pos['sl'] = max(self.active_pos['sl'], new_sl)

            # --- NEW: Independent Breakeven SL Logic ---
            if getattr(self, 'sl_breakeven_trigger_pct', 0.0) > 0 and not self.active_pos.get('breakeven_hit'):
                trigger_price = self.active_pos['entry'] * (1 + (self.sl_breakeven_trigger_pct / 100))
                if current_price >= trigger_price:
                    new_breakeven_sl = self.active_pos['entry'] * (1 + (self.sl_breakeven_target_pct / 100))
                    # Only move if the new breakeven SL is higher than current SL AND current max price
                    if new_breakeven_sl > self.active_pos['sl']:
                        self.active_pos['sl'] = new_breakeven_sl
                        self.active_pos['breakeven_hit'] = True
                        self.logger.info(f"🛡️ Set SL to Risk-Free Breakeven at {new_breakeven_sl:.6f}")
                        asyncio.create_task(self._send_telegram(f"🛡️ Stop-Loss moved to Risk-Free!\nPair: {self.symbol}\nNew SL: {new_breakeven_sl:.6f}"))

        # Save state if SL was updated (e.g. by TSL or Breakeven)
        if old_sl is not None and self.active_pos.get('sl') != old_sl:
            # --- State Saving Throttler (Performance Optimization) ---
            # Compare current SL against the SL that was last synced to Redis.
            # This prevents spamming the Redis database on micro TSL ticks.
            last_synced = self.active_pos.get('last_synced_sl', old_sl)
            sl_pct_diff = abs(self.active_pos['sl'] - last_synced) / last_synced if last_synced > 0 else 1.0
            is_breakeven = self.active_pos.get('breakeven_hit', False) and not self.active_pos.get('breakeven_synced')
            
            if sl_pct_diff >= 0.0005 or is_breakeven:  # 0.05% change threshold
                self.active_pos['last_synced_sl'] = self.active_pos['sl']
                if is_breakeven:
                    self.active_pos['breakeven_synced'] = True
                self._save_state()

        # --- NEW: Advanced Risk Manager (Global TP & Break-Even) ---
        is_risk_triggered = False
        risk_reason = ""
        if hasattr(self, 'advanced_risk_manager') and self.advanced_risk_manager:
            entry = self.active_pos['entry']
            amount = self.active_pos['amount']
            if getattr(self, 'strategy_mode', 'long') == "short":
                current_pnl_usd = (entry - current_price) * amount
                current_pnl_pct = ((entry - current_price) / entry) * 100
            else:
                current_pnl_usd = (current_price - entry) * amount
                current_pnl_pct = ((current_price - entry) / entry) * 100
                
            risk_res = self.advanced_risk_manager.update_pnl(current_pnl_pct, current_pnl_usd)
            if risk_res["action"] in ["stop_bot", "pause_bot"]:
                is_risk_triggered = True
                risk_reason = risk_res["reason"]
                
                # Stop Bot flag logic
                if risk_res["action"] == "stop_bot":
                    self.logger.warning(f"🛑 [Advanced Risk] Global TP hit! Stopping bot. Reason: {risk_reason}")
                    asyncio.create_task(self._send_telegram(f"🛑 *Bot Stopped by Risk Manager*\nReason: {risk_reason}\nPair: {self.symbol}"))
                    try:
                        from app.services.bot_manager import bot_manager
                        asyncio.create_task(bot_manager.stop_bot(str(self.bot_id), str(self.owner_id)))
                    except Exception as e:
                        self.logger.error(f"Failed to auto-stop via bot_manager: {e}")

        # --- Partial TP Logic ---
        # Only execute TP1 logic if partial_tp_pct > 0
        hit_tp1 = current_price <= self.active_pos['tp1'] if self._is_active_short() else current_price >= self.active_pos['tp1']
        
        if not is_risk_triggered and not self.active_pos.get('micro_scalp') and self.partial_tp_pct > 0 and not self.active_pos.get('tp1_hit') and hit_tp1:
            self.logger.info("🟢 TP1 Hit! Executing Partial Close.")
            sell_amount_raw = self.active_pos['amount'] * (self.partial_tp_pct / 100)
            
            # --- Min Notional Check (Dust Position Preventer) ---
            remaining_amount = self.active_pos['amount'] - sell_amount_raw
            try:
                min_cost = 0.0
                if self.engine.exchange and hasattr(self.engine.exchange, 'markets') and self.symbol in self.engine.exchange.markets:
                    min_cost = self.engine.exchange.markets[self.symbol].get('limits', {}).get('cost', {}).get('min', 0.0)
                
                if min_cost and min_cost > 0:
                    remaining_value = remaining_amount * current_price
                    if remaining_value < min_cost:
                        self.logger.warning(f"Dust Position Prevented: Remaining value ${remaining_value:.2f} < Min Notional ${min_cost:.2f}. Executing 100% close at TP1.")
                        sell_amount_raw = self.active_pos['amount']
            except Exception as e:
                self.logger.error(f"Error checking min notional for TP1: {e}")
            # ----------------------------------------------------

            close_side = "buy" if getattr(self, 'strategy_mode', 'long') == "short" else "sell"
            
            # We no longer scale down by quote balance buffer (0.99) because user explicitly requested 1:1 amount
            close_amount_raw = sell_amount_raw
            sell_amount = float(self.engine.exchange.amount_to_precision(self.symbol, close_amount_raw))
            
            # Force Partial TP to be a Taker (Market) order since it's triggered strictly by a crossover event.
            # Using limits here would assume instantaneous fills, risking desync.
            exit_order_type_actual = 'market'

            res = await self.engine.execute_trade(close_side, sell_amount, current_price, order_type="market")
            if res:
                self.logger.info(f"Executed Market Order for Partial TP at {current_price}")
            
            # Update Limit order to prevent over-selling
            if res and exit_order_type == 'limit' and self.active_pos.get('limit_order_id'):
                try:
                    await self.engine.cancel_order(self.active_pos['limit_order_id'])
                    remaining_raw = self.active_pos['amount'] - sell_amount_raw
                    # Only replace limit if not fully closed
                    if remaining_raw > 0.00000001:
                        rem_close_amount_raw = remaining_raw
                        limit_res = await self.engine.execute_trade(close_side, rem_close_amount_raw, self.active_pos['tp'], order_type="limit", params={"postOnly": True})
                        if limit_res and 'id' in limit_res:
                            self.active_pos['limit_order_id'] = limit_res['id']
                except Exception as e:
                    self.logger.error(f"Failed to update limit order after TP1: {e}")
            
            if res:
                remaining_raw = self.active_pos['amount'] - sell_amount_raw
                exit_price = current_price
                if getattr(self, 'strategy_mode', 'long') == "short":
                    gross = (self.active_pos['entry'] - exit_price) * sell_amount_raw
                else:
                    gross = (exit_price - self.active_pos['entry']) * sell_amount_raw
                
                pnl_val, fee_paid = self._calculate_net_pnl(gross, self.active_pos['entry'], exit_price, sell_amount_raw, is_maker=False)
                self.total_realized_pnl += pnl_val
                
                if remaining_raw <= 0.00000001:  # 100% close
                    self.total_wins += 1
                    self.total_executed_orders += 1
                    await self._send_telegram(f"🎯 WallHunter EXIT - Full TP Hit (Dust Prevented)!\nPair: {self.symbol}\nMode: {getattr(self, 'strategy_mode', 'long').upper()}\n💰 Locked Profit: ${pnl_val:.2f}\n\n📊 Net PnL: ${self.total_realized_pnl:.2f}\n💰 Gross: ${self.total_gross_pnl:.2f} | 💸 Fees: ${self.total_fees_paid:.2f}\n🏆 Wins: {self.total_wins} | 💔 Losses: {self.total_losses}")
                    await self._clear_state()
                    self.active_pos = None
                else:
                    self.active_pos['amount'] = float(self.engine.exchange.amount_to_precision(self.symbol, remaining_raw))
                    self.active_pos['tp1_hit'] = True
                    self._save_state()
                    await self._send_telegram(f"🔓 Partial TP Hit!\nPair: {self.symbol}\nMode: {getattr(self, 'strategy_mode', 'long').upper()}\n💰 Locked Profit: ${pnl_val:.2f}\n\n📊 Net PnL: ${self.total_realized_pnl:.2f}\n💰 Gross: ${self.total_gross_pnl:.2f} | 💸 Fees: ${self.total_fees_paid:.2f}\n🏆 Wins: {self.total_wins} | 💔 Losses: {self.total_losses}")
            else:
                self.logger.warning("❌ Partial TP execution failed on exchange. Skipping partial TP size reduction to stay in sync with exchange.")
                self.active_pos['tp1_hit'] = True

        # --- Zero Tolerance Breakeven Check ---
        is_zero_tolerance_triggered = False
        if getattr(self, 'zero_tolerance_tracker', None) and not self.active_pos.get('zero_tolerance_hit', False):
            side = 'buy' if getattr(self, 'strategy_mode', 'long') == 'long' else 'sell'
            if self.zero_tolerance_tracker.check_trigger(current_price, side):
                is_zero_tolerance_triggered = True
                self.active_pos['zero_tolerance_hit'] = True
                self.logger.info(f"🚨 Zero Tolerance Triggered! Price hit {current_price:.6f}")
        # ------------------------------------

        if is_risk_triggered or is_zero_tolerance_triggered or (current_price >= self.active_pos['sl'] if self._is_active_short() else current_price <= self.active_pos['sl']):
            if is_risk_triggered:
                self.logger.info(f"⚠️ Triggering Advanced Risk Exit: {risk_reason}")
            elif is_zero_tolerance_triggered:
                self.logger.info(f"⚠️ Triggering Zero Tolerance Breakeven Exit at {current_price:.6f}")
            else:
                self.logger.info(f"⚠️ Triggering SL: Current Price ({current_price:.6f}) hit SL ({self.active_pos['sl']:.6f})")
            
            sell_amount_raw = self.active_pos['amount']
            close_side = "buy" if getattr(self, 'strategy_mode', 'long') == "short" else "sell"
            
            if getattr(self, 'strategy_mode', 'long') == "short":
                # Spot Short means we sold X amount of base asset.
                # If price increased (SL hit), buying X back costs MORE quote than we received!
                # We must cap the buy amount to the quote we acquired, otherwise we get Insufficient Balance.
                acquired_quote = sell_amount_raw * float(self.active_pos['entry']) * 0.995
                cost_estimate = sell_amount_raw * current_price
                if cost_estimate > acquired_quote:
                    self.logger.warning(f"Spot Short SL: Cannot afford full {sell_amount_raw} base. Capping based on acquired quote.")
                    close_amount_raw = acquired_quote / current_price
                else:
                    close_amount_raw = sell_amount_raw
            else:
                close_amount_raw = sell_amount_raw
            
            sell_amount_raw = close_amount_raw
            sell_amount = float(self.engine.exchange.amount_to_precision(self.symbol, close_amount_raw)) if hasattr(self.engine.exchange, 'amount_to_precision') else close_amount_raw
            
            # Cancel open limit order if SL/TSL hits (handles both limit sell orders and micro_scalp)
            if (exit_order_type == 'limit' or self.active_pos.get('micro_scalp')) and self.active_pos.get('limit_order_id'):
                canceled = False
                for attempt in range(5):
                    try:
                        self.logger.info(f"Attempting to cancel Limit TP Order {self.active_pos['limit_order_id']} before SL market order (Attempt {attempt+1}/5)")
                        cancel_success = await self.engine.cancel_order(self.active_pos['limit_order_id'])
                        if cancel_success:
                            canceled = True
                            break
                        else:
                            # Verify if it was already cancelled or closed despite the failure
                            try:
                                status = await self.engine.exchange.fetch_order(self.active_pos['limit_order_id'], self.symbol)
                                if status and status.get('status') in ['canceled', 'cancelled', 'closed']:
                                    self.logger.info("Order check: Order is already closed or cancelled.")
                                    canceled = True
                                    break
                            except Exception: pass
                    except Exception as e:
                        err_str = str(e).lower()
                        if "-2011" in err_str or "unknown order" in err_str or "ordernotfound" in err_str:
                            self.logger.info("Order check: Order is already closed or cancelled (Unknown Order).")
                            canceled = True
                            break
                        self.logger.warning(f"Failed to cancel Limit TP Order on attempt {attempt+1}: {e}")
                        
                    await asyncio.sleep(0.5)
                
                if canceled:
                    self.logger.info("Successfully cancelled Limit TP Order due to Stop Loss hit. Extracting remaining position...")
                    await asyncio.sleep(0.5) # Wait for exchange to release the locked base asset balance
                    
                    # --- NEW: Extract remaining balance from the cancelled Limit Order ---
                    try:
                        if not self.is_paper_trading:
                            cancelled_status = await self.engine.exchange.fetch_order(self.active_pos['limit_order_id'], self.symbol)
                            filled = cancelled_status.get('filled', 0.0)
                            if filled > 0:
                                self.logger.info(f"🔄 Open Limit Order was partially filled ({filled}). Adjusting SL Market Sweep amount.")
                                filled_proper = float(self.engine.exchange.amount_to_precision(self.symbol, filled)) if hasattr(self.engine.exchange, 'amount_to_precision') else filled
                                sell_amount_raw = max(0.0, self.active_pos['amount'] - filled_proper)
                                
                                if sell_amount_raw <= 0:
                                    self.logger.info("✅ Partial fill actually completely closed out the remaining position. SL sweep aborted.")
                                    
                                    # Fix: Calculate precise PnL instead of setting to 0
                                    tp_fill_price = cancelled_status.get('average') or self.active_pos['tp']
                                    if getattr(self, 'strategy_mode', 'long') == "short":
                                        pnl_val = (self.active_pos['entry'] - tp_fill_price) * filled_proper
                                    else:
                                        pnl_val = (tp_fill_price - self.active_pos['entry']) * filled_proper
                                        
                                    self.total_realized_pnl += pnl_val
                                    self.total_wins += 1 if pnl_val > 0 else 0
                                    self.total_losses += 1 if pnl_val <= 0 else 0
                                    
                                    await self._send_telegram(f"🛡️ WallHunter EXIT - Stopped out via Limit Sweep!\nPair: {self.symbol}\n💰 Secured PnL: ${pnl_val:.2f}")
                                    await self._clear_state()
                                    self.active_pos = None
                                    return
                                    
                                # Re-calculate correct sizing
                                if getattr(self, 'strategy_mode', 'long') == "short":
                                    close_amount_raw = sell_amount_raw
                                else:
                                    close_amount_raw = sell_amount_raw
                                    
                                sell_amount = float(self.engine.exchange.amount_to_precision(self.symbol, close_amount_raw))
                    except Exception as e:
                        self.logger.error(f"Error fetching filled status of cancelled limit order: {e}")
                    # -------------------------------------------------------------
                else:
                    self.logger.error("🚨 CRITICAL: Could not cancel Limit TP order after 5 attempts! Order remains locked on exchange.")
                    self.logger.warning("Emergency Action: Aborting SL Market sweep. Will retry in the next loop.")
                    return  # Abort to prevent Insufficient Balance. Next loop will retry if condition holds.
                
            exit_order_type_actual = exit_order_type
            if exit_order_type_actual == 'marketable_limit':
                exit_order_type_actual = 'market'
            
            # --- NEW: Advanced SL Execution Routing ---
            sl_exec_type = getattr(self, 'sl_order_type', 'market')
            chase_sl = self.active_pos['sl']
            
            if is_zero_tolerance_triggered:
                sl_exec_type = 'smart_chase'
                chase_sl = self.active_pos['entry']
            
            res = None
            if sl_exec_type == 'market':
                res = await self.engine.execute_trade(close_side, sell_amount, current_price, order_type="market")
                
            elif sl_exec_type == 'limit':
                try:
                    from app.services.market_depth_service import market_depth_service
                    limit_size = market_depth_service._normalize_order_book_limit(self.exchange_id, 5) if hasattr(market_depth_service, '_normalize_order_book_limit') else 5
                    ob = await self.public_exchange.fetch_order_book(self.symbol, limit=limit_size)
                    best_bid = ob['bids'][0][0] if ob['bids'] else current_price
                    best_ask = ob['asks'][0][0] if ob['asks'] else current_price
                except Exception as e:
                    self.logger.warning(f"Could not fetch precise order book for Limit SL, falling back: {e}")
                    best_bid = current_price
                    best_ask = current_price
                    
                target_maker_price = best_bid if close_side == "buy" else best_ask
                
                self.logger.info(f"🛡️ Executing SL with STRICT Limit (Maker) targeting exactly {target_maker_price}")
                limit_sl_res = await self.engine.execute_trade(close_side, sell_amount, target_maker_price, order_type="limit", params={"postOnly": True})
                if limit_sl_res and limit_sl_res.get('id'):
                    self.active_pos['sl_limit_order_id'] = limit_sl_res.get('id')
                    # Do not set res here, we want to wait. The Guard logic at top of manage_risk will handle it.
                    if self.is_paper_trading:
                        res = limit_sl_res
                else:
                    self.logger.debug("SL Limit Maker order rejected by exchange! Will auto-retry on next tick.")
                    
            elif sl_exec_type == 'soft_limit':
                self.logger.info(f"🛡️ Executing SL with Soft Limit Maker at {current_price}")
                limit_sl_res = await self.engine.execute_trade(close_side, sell_amount, current_price, order_type="limit", params={"postOnly": True})
                
                if limit_sl_res and limit_sl_res.get('id'):
                    if self.is_paper_trading:
                        res = limit_sl_res
                    else:
                        # Wait 3 seconds inside this block 
                        self.logger.info(f"⏳ Waiting 3 seconds for Soft Limit SL {limit_sl_res['id']} to fill...")
                        for _ in range(8):  # 8 * 0.4s = 3.2s
                            await asyncio.sleep(0.4)
                            try:
                                check = await self.engine.exchange.fetch_order(limit_sl_res['id'], self.symbol)
                                if check and check.get('status') != 'open':
                                    break
                            except Exception: pass
                            
                        # Re-check status after wait
                        final_check = await self.engine.exchange.fetch_order(limit_sl_res['id'], self.symbol)
                        if final_check and final_check.get('status') == 'open':
                            self.logger.warning("Soft Limit SL did not fill in time! Fallback to Market.")
                            await self.engine.cancel_order(limit_sl_res['id'])
                            await asyncio.sleep(0.5)
                            
                            # Find remaining unfilled portion
                            cancelled_check = await self.engine.exchange.fetch_order(limit_sl_res['id'], self.symbol)
                            rem_filled = cancelled_check.get('filled', 0.0)
                            rem_amount_raw = sell_amount_raw - rem_filled
                            if rem_amount_raw > 0:
                                sweep_amt = float(self.engine.exchange.amount_to_precision(self.symbol, rem_amount_raw)) if hasattr(self.engine.exchange, 'amount_to_precision') else rem_amount_raw
                                res = await self.engine.execute_trade(close_side, sweep_amt, current_price, order_type="market")
                        else:
                            # Filled or cancelled externally
                            res = final_check
                else:
                    self.logger.warning("Soft Limit placement failed. Fallback to Market.")
                    res = await self.engine.execute_trade(close_side, sell_amount, current_price, order_type="market")
                    
            elif sl_exec_type == 'stop_limit':
                # Stop-limit execution: Place standard limit order worst-case 0.1% off current price
                slip_pct = 0.001  # 0.1% buffer
                bounded_price = current_price * (1 - slip_pct) if close_side == "sell" else current_price * (1 + slip_pct)
                self.logger.info(f"🛡️ Executing SL with Stop-Limit Slippage Bound constraint. Target: {bounded_price}")
                # Without postOnly to ensure it crosses
                res = await self.engine.execute_trade(close_side, sell_amount, bounded_price, order_type="limit")
                if not res or not res.get('id'): # Failsafe
                    res = await self.engine.execute_trade(close_side, sell_amount, current_price, order_type="market")
                    
            elif sl_exec_type == 'smart_chase':
                res = await execute_smart_chase(
                    engine=self.engine,
                    public_exchange=self.public_exchange,
                    symbol=self.symbol,
                    exit_side=close_side,
                    sell_amount_raw=sell_amount_raw,
                    current_price=current_price,
                    original_sl=chase_sl,
                    max_deviation_pct=getattr(self, 'smart_chase_deviation_pct', 1.0),
                    chase_delay_ms=getattr(self, 'smart_chase_delay_ms', 1500),
                    max_attempts=getattr(self, 'smart_chase_max_attempts', 15),
                    exchange_id=self.exchange_id,
                    is_futures=False,
                    is_paper_trading=self.is_paper_trading
                )
            # ----------------------------------------
            
            # If Strict Limit Maker was placed OR rejected, we exit here so we don't clear state!
            if sl_exec_type in ('limit', 'smart_chase') and not res:
                if self.active_pos.get('sl_limit_order_id'):
                    self.logger.info("Strict Limit SL order placed. Ending loop tick to wait.")
                self._save_state()
                return
            
            # --- Partial Fill Management for Active SL Exits ---
            if res and res.get('id') and not self.is_paper_trading:
                try:
                    order_status = None
                    for _ in range(5):
                        await asyncio.sleep(0.4)
                        try:
                            order_status = await self.engine.exchange.fetch_order(res['id'], self.symbol)
                            if order_status and order_status.get('status') != 'open':
                                break
                        except Exception: pass
                    
                    if order_status and order_status.get('status') == 'open':
                        self.logger.warning(f"⚠️ Exit SL order {res['id']} is hanging open! Cancelling remainder...")
                        await self.engine.cancel_order(res['id'])
                        await asyncio.sleep(0.5)
                        
                        final_status = await self.engine.exchange.fetch_order(res['id'], self.symbol)
                        filled = final_status.get('filled', 0.0)
                        
                        filled_proper = float(self.engine.exchange.amount_to_precision(self.symbol, filled)) if hasattr(self.engine.exchange, 'amount_to_precision') else filled
                        remaining_base = max(0.0, sell_amount_raw - filled_proper)
                        
                        if remaining_base > 0:
                            self.logger.info(f"🧹 Sweeping SL remainder at Pure Market: {remaining_base} {self.symbol}")
                            sweep_amount_raw = remaining_base
                            sweep_amount = float(self.engine.exchange.amount_to_precision(self.symbol, sweep_amount_raw))
                            
                            sweep_params = {}
                            if close_side == "buy":
                                acquired_quote = sweep_amount_raw * float(self.active_pos['entry']) * 0.995
                                safe_quote = float(self.public_exchange.price_to_precision(self.symbol, acquired_quote)) if hasattr(self.public_exchange, 'price_to_precision') else acquired_quote
                                sweep_params['quoteOrderQty'] = safe_quote
                                sweep_params['cost'] = safe_quote
                            
                            await self.engine.execute_trade(close_side, sweep_amount, current_price, order_type="market", params=sweep_params)
                            self.logger.info("✅ Market sweep completed.")
                except Exception as e:
                    self.logger.error(f"Error checking SL partial fill sweep: {e}")
            # --------------------------------------------------------
            self.total_executed_orders += 1
            
            if getattr(self, 'strategy_mode', 'long') == "short":
                pnl_val = (self.active_pos['entry'] - current_price) * sell_amount_raw
            else:
                pnl_val = (current_price - self.active_pos['entry']) * sell_amount_raw
                
            if self.active_pos.get('tp1_hit'):
                 self.total_realized_pnl += pnl_val
                 self.total_wins += 1
                 await self._send_exit_telegram("🛡️ WallHunter EXIT - Stopped out at Profitable Break-even!", current_price, pnl_val)
            else:
                 self.total_realized_pnl += pnl_val
                 if pnl_val > 0:
                     self.total_wins += 1
                     await self._send_exit_telegram("🛡️ WallHunter EXIT - Stopped out in Profit!", current_price, pnl_val)
                 else:
                     self.total_losses += 1
                     await self._send_exit_telegram("🛑 WallHunter EXIT - Stopped Out!", current_price, pnl_val)
            await self._clear_state()
            self.active_pos = None
            self.logger.info("Exit: Stop Loss / TSL Hit")
            
        elif (current_price <= self.active_pos['tp'] if self._is_active_short() else current_price >= self.active_pos['tp']):
            self.logger.info(f"✅ Triggering Final TP: Current Price ({current_price:.6f}) hit TP ({self.active_pos['tp']:.6f})")
            
            sell_amount_raw = self.active_pos['amount']
            close_side = "buy" if getattr(self, 'strategy_mode', 'long') == "short" else "sell"
            
            if getattr(self, 'strategy_mode', 'long') == "short":
                close_amount_raw = sell_amount_raw
            else:
                close_amount_raw = sell_amount_raw
            
            sell_amount = float(self.engine.exchange.amount_to_precision(self.symbol, close_amount_raw)) if hasattr(self.engine.exchange, 'amount_to_precision') else close_amount_raw
            
            sell_order_type = self.sell_order_type
            if sell_order_type == 'marketable_limit':
                sell_order_type = 'market'

            if sell_order_type == 'market':
                res = await self.engine.execute_trade(close_side, sell_amount, current_price)
                
                # --- NEW: Partial Fill Management for Active TP Exits ---
                if res and res.get('id') and not self.is_paper_trading:
                    try:
                        order_status = None
                        for _ in range(5):
                            await asyncio.sleep(0.4)
                            try:
                                order_status = await self.engine.exchange.fetch_order(res['id'], self.symbol)
                                if order_status and order_status.get('status') != 'open':
                                    break
                            except Exception: pass
                        
                        if order_status and order_status.get('status') == 'open':
                            self.logger.warning(f"⚠️ Exit Final TP order {res['id']} is hanging open! Cancelling remainder...")
                            await self.engine.cancel_order(res['id'])
                            await asyncio.sleep(0.5)
                            
                            final_status = await self.engine.exchange.fetch_order(res['id'], self.symbol)
                            filled = final_status.get('filled', 0.0)
                            
                            filled_proper = float(self.engine.exchange.amount_to_precision(self.symbol, filled)) if hasattr(self.engine.exchange, 'amount_to_precision') else filled
                            remaining_base = max(0.0, sell_amount_raw - filled_proper)
                            
                            if remaining_base > 0:
                                self.logger.info(f"🧹 Sweeping Final TP remainder at Pure Market: {remaining_base} {self.symbol}")
                                sweep_amount_raw = remaining_base
                                sweep_amount = float(self.engine.exchange.amount_to_precision(self.symbol, sweep_amount_raw))
                                
                                sweep_params = {}
                                if close_side == "buy":
                                    acquired_quote = sweep_amount_raw * float(self.active_pos['entry']) * 0.995
                                    safe_quote = float(self.public_exchange.price_to_precision(self.symbol, acquired_quote)) if hasattr(self.public_exchange, 'price_to_precision') else acquired_quote
                                    sweep_params['quoteOrderQty'] = safe_quote
                                    sweep_params['cost'] = safe_quote
                                
                                await self.engine.execute_trade(close_side, sweep_amount, current_price, order_type="market", params=sweep_params)
                                self.logger.info("✅ Market sweep for Final TP completed.")
                    except Exception as e:
                        self.logger.error(f"Error checking Final TP partial fill sweep: {e}")
                # --------------------------------------------------------
            else:
                self.logger.info(f"Target Profit {self.active_pos['tp']} reached. Checking Limit Order {self.active_pos.get('limit_order_id', 'Unknown')} status...")
                if self.is_paper_trading:
                    # Finalize the initial limit order mock by executing a market sell at the TP price
                    await self.engine.execute_trade(close_side, sell_amount, self.active_pos['tp'])
                else:
                    if self.active_pos.get('limit_order_id'):
                        try:
                            order_status = await self.engine.exchange.fetch_order(self.active_pos['limit_order_id'], self.symbol)
                            if order_status and order_status.get('status') in ['closed', 'filled']:
                                self.logger.info("✅ Exchange confirmed Limit TP is fully filled!")
                                current_price = order_status.get('average') or self.active_pos['tp']
                            else:
                                self.logger.info(f"⏳ Limit TP is still {order_status.get('status') if order_status else 'open'}. Waiting for exchange to fill...")
                                return # Do not clear state, keep tracking
                        except Exception as e:
                            self.logger.warning(f"⚠️ Could not verify Limit TP status: {e}. Keeping state active to be safe.")
                            return

            # Calculate PnL
            if getattr(self, 'strategy_mode', 'long') == "short":
                pnl_val = (self.active_pos['entry'] - current_price) * sell_amount_raw
            else:
                pnl_val = (current_price - self.active_pos['entry']) * sell_amount_raw
                
            self.total_realized_pnl += pnl_val
            self.total_executed_orders += 1
            if pnl_val > 0:
                self.total_wins += 1
            else:
                self.total_losses += 1
            await self._send_exit_telegram("🎯 WallHunter EXIT - Final Take Profit Hit!", current_price, pnl_val)
            await self._clear_state()
            self.active_pos = None
            self.logger.info("Exit: Take Profit Hit")

    async def _execute_fallback_exit(self):
        """
        Executes a Maker-to-Taker fallback exit when Supertrend reversal triggers.
        It cancels any existing TP limit orders, places a Maker exit order at the current Best Bid/Ask,
        waits `supertrend_exit_timeout` seconds, and if unfilled, sweeps at Market.
        """
        if not self.active_pos or self.is_paper_trading: return
        
        try:
            # 1. Cancel existing limit TP order or Native Order List if exists
            if self.active_pos.get('order_list_id'):
                try:
                    native_symbol = self.symbol.replace('/', '')
                    await self.engine.exchange.private_delete_orderlist({
                        'symbol': native_symbol,
                        'orderListId': int(self.active_pos['order_list_id'])
                    })
                    self.logger.info(f"🗑️ Cancelled Native Binance Order List {self.active_pos['order_list_id']} for Dual-Exit.")
                except Exception as e:
                    self.logger.warning(f"⚠️ Could not cancel Native Order List: {e}")

            limit_id = self.active_pos.get('limit_order_id')
            if limit_id:
                try:
                    await self.engine.cancel_order(limit_id)
                    self.logger.info(f"🗑️ Cancelled existing Limit TP {limit_id} for Dual-Exit.")
                except Exception as e:
                    self.logger.warning(f"⚠️ Could not cancel existing TP {limit_id} (may have just filled): {e}")
            
            # 2. Fetch current best bid/ask to place a Maker order
            limit_size = market_depth_service._normalize_order_book_limit(self.exchange_id, 5) if hasattr(market_depth_service, '_normalize_order_book_limit') else 5
            ob = await self.public_exchange.fetch_order_book(self.symbol, limit=limit_size)
            best_bid = ob['bids'][0][0] if ob['bids'] else 0
            best_ask = ob['asks'][0][0] if ob['asks'] else 0
            
            close_side = "buy" if getattr(self, 'strategy_mode', 'long') == "short" else "sell"
            # For maker exit: stay on same side. Long exit = Sell = ask side. Short exit = Buy = bid side.
            maker_price = best_ask if close_side == "sell" else best_bid
            
            amount = self.active_pos['amount']
            if close_side == "buy" and getattr(self, 'strategy_mode', 'long') == "short":
                acquired_quote = amount * float(self.active_pos['entry']) * 0.995
                if (amount * maker_price) > acquired_quote:
                    self.logger.warning(f"Dual-Exit Fallback: Capping {amount} base due to insufficient quote balance on Spot Short.")
                    amount = acquired_quote / (maker_price * 1.005) if maker_price > 0 else amount
            
            self.logger.info(f"🛡️ Dual-Exit Step 1: Placing Maker {close_side.upper()} order at {maker_price:.6f}")
            maker_res = await self.engine.execute_trade(close_side, amount, maker_price, order_type="limit", params={"postOnly": True})
            
            if not maker_res or not maker_res.get('id'):
                self.logger.error("❌ Failed to place Maker exit order. Aborting Fallback, reverting to next Risk tick.")
                self.active_pos['fallback_exit_in_progress'] = False
                self._save_state()
                return
                
            fallback_id = maker_res['id']
            timeout_sec = getattr(self, 'supertrend_exit_timeout', 5)
            
            # 3. Wait up to timeout amount
            self.logger.info(f"⏳ Waiting {timeout_sec}s for Maker Fallback Exit ({fallback_id}) to fill...")
            filled = False
            for step in range(timeout_sec * 2): # Check every 0.5 sec
                await asyncio.sleep(0.5)
                try:
                    status = await self.engine.exchange.fetch_order(fallback_id, self.symbol)
                    if status and status.get('status') in ['closed', 'filled']:
                        self.logger.info("✅ Maker Fallback Exit filled completely!")
                        filled = True
                        break
                except Exception: pass
            
            # 4. If not completely filled by timeout, cancel remainder and Sweep
            if not filled:
                try:
                    status = await self.engine.exchange.fetch_order(fallback_id, self.symbol)
                    if status and status.get('status') == 'open':
                        self.logger.warning(f"⚠️ Fallback Maker order {fallback_id} timed out. Cancelling and sweeping remainder...")
                        await self.engine.cancel_order(fallback_id)
                        await asyncio.sleep(0.5)
                        
                        final_status = await self.engine.exchange.fetch_order(fallback_id, self.symbol)
                        filled_amt = final_status.get('filled', 0.0)
                        
                        min_amount = 0.00000001
                        if hasattr(self.public_exchange, 'markets') and self.public_exchange.markets:
                            market = self.public_exchange.markets.get(self.symbol, {})
                            min_amount = market.get('limits', {}).get('amount', {}).get('min', 0.00000001)

                        filled_proper = float(self.engine.exchange.amount_to_precision(self.symbol, filled_amt)) if (hasattr(self.engine.exchange, 'amount_to_precision') and filled_amt >= min_amount) else filled_amt
                        remaining_base = max(0.0, amount - filled_proper)

                        if remaining_base >= min_amount:
                            self.logger.info(f"🧹 Sweeping remainder at TAKER (Market): {remaining_base} {self.symbol}")
                            sweep_amount = float(self.engine.exchange.amount_to_precision(self.symbol, remaining_base)) if hasattr(self.engine.exchange, 'amount_to_precision') else remaining_base
                            sweep_params = {}
                            if close_side == "buy":
                                acquired_quote = remaining_base * float(self.active_pos['entry']) * 0.995
                                safe_quote = float(self.public_exchange.price_to_precision(self.symbol, acquired_quote)) if hasattr(self.public_exchange, 'price_to_precision') else acquired_quote
                                sweep_params['quoteOrderQty'] = safe_quote
                                sweep_params['cost'] = safe_quote
                            await self.engine.execute_trade(close_side, sweep_amount, maker_price, order_type="market", params=sweep_params)
                            self.logger.info("✅ Taker sweep completed.")
                        else:
                            self.logger.info(f"✨ Remaining balance {remaining_base} is below exchange minimum ({min_amount}). Considering position closed.")
                except Exception as e:
                    self.logger.error(f"Error during Maker-to-Taker fallback sweep: {e}")
                    
            # 5. Calculate final position PnL and cleanup
            # Wait a tick so exchange resolves execution
            await asyncio.sleep(1.0)
            
            # We assume position is closed. To be accurate, we'd query trades or use Maker price.
            if getattr(self, 'strategy_mode', 'long') == "short":
                pnl_val = (self.active_pos['entry'] - maker_price) * amount
            else:
                pnl_val = (maker_price - self.active_pos['entry']) * amount
                
            self.total_realized_pnl += pnl_val
            self.total_executed_orders += 1
            if pnl_val > 0:
                self.total_wins += 1
            else:
                self.total_losses += 1
                
            await self._send_exit_telegram("⚡ WallHunter EXIT - Supertrend Fallback Hit!", current_price, pnl_val)
            await self._clear_state()
            self.active_pos = None
            
        except Exception as e:
            self.logger.error(f"Critical error in Fallback Exit loop: {e}")
            if self.active_pos:
                self.active_pos['fallback_exit_in_progress'] = False
                self._save_state()

    async def emergency_sell(self, sell_type: str):
        """Emergency liquidate the active position."""
        if not self.active_pos:
            self.logger.info(f"No active position to emergency sell for bot {self.bot_id}")
            return
            
        sell_amount = self.active_pos['amount']
        
        # Determine the execution price
        try:
            limit = market_depth_service._normalize_order_book_limit(self.exchange_id, 5)
            ob = await self.public_exchange.fetch_order_book(self.symbol, limit=limit)
            best_bid = ob['bids'][0][0] if ob['bids'] else 0
            best_ask = ob['asks'][0][0] if ob['asks'] else 0
            current_price = (best_bid + best_ask) / 2 if best_bid and best_ask else best_bid or best_ask
        except Exception as e:
            self.logger.warning(f"Could not fetch precise market price for emergency sell: {e}")
            current_price = self.active_pos['entry'] if self.active_pos else 0 # Fallback
            
        if not self.active_pos:
            self.logger.info(f"Position closed during emergency sell fetch for bot {self.bot_id}")
            return

        if current_price <= 0:
            raise Exception("Invalid market price fetched.")
            
        # Cancel any open Native Binance Order List first
        if self.active_pos.get('order_list_id') and not self.is_paper_trading:
            try:
                native_symbol = self.symbol.replace('/', '')
                await self.engine.exchange.private_delete_orderlist({
                    'symbol': native_symbol,
                    'orderListId': int(self.active_pos['order_list_id'])
                })
                self.logger.info(f"Cancelled Native Binance Order List {self.active_pos['order_list_id']} for emergency sell.")
            except Exception as e:
                self.logger.warning(f"Failed to cancel order list during emergency sell: {e}")

        # Cancel any open limit orders first
        if self.active_pos.get('limit_order_id'):
            try:
                await self.engine.cancel_order(self.active_pos['limit_order_id'])
                self.logger.info(f"Cancelled open limit order {self.active_pos['limit_order_id']} for emergency sell.")
            except Exception as e:
                self.logger.warning(f"Failed to cancel open limit order during emergency sell: {e}")
                
        close_side = "buy" if getattr(self, 'strategy_mode', 'long') == "short" else "sell"
        action_name = "BUY" if close_side == "buy" else "SELL"
        
        if close_side == "buy" and getattr(self, 'strategy_mode', 'long') == "short":
            acquired_quote = sell_amount * float(self.active_pos['entry']) * 0.995
            if (sell_amount * current_price) > acquired_quote:
                self.logger.warning(f"Emergency Sell: Capping {sell_amount} base due to insufficient quote balance on Spot Short.")
                sell_amount = acquired_quote / (current_price * 1.005) if current_price > 0 else sell_amount
        
        if sell_type in ["market", "marketable_limit"]:
            actual_type = "market" # Engine will convert to marketable limit if needed
            self.logger.info(f"🚨 Executing EMERGENCY {sell_type.upper()} {action_name} for bot {self.bot_id} at ~{current_price}")
            await self.engine.execute_trade(close_side, sell_amount, current_price, order_type=actual_type)
            self.total_executed_orders += 1
            
            # Finalize position and PnL
            if getattr(self, 'strategy_mode', 'long') == "short":
                pnl_val = (self.active_pos['entry'] - current_price) * sell_amount
            else:
                pnl_val = (current_price - self.active_pos['entry']) * sell_amount
                
            self.total_realized_pnl += pnl_val
            if pnl_val > 0:
                self.total_wins += 1
            else:
                self.total_losses += 1
            await self._send_exit_telegram(f"🚨 WallHunter EMERGENCY EXIT - {sell_type.upper()} {action_name}!", current_price, pnl_val)
            self.active_pos = None
            
        elif sell_type == "limit":
            # For a limit exit, we'll try to place it at the best ask/bid or current market mid-price 
            close_price = best_bid if close_side == "buy" and best_bid > 0 else (best_ask if best_ask > 0 else current_price)
            self.logger.info(f"🎯 Executing EMERGENCY LIMIT {action_name} for bot {self.bot_id} at {close_price}")
            limit_res = await self.engine.execute_trade(close_side, sell_amount, close_price, order_type="limit")
            
            if limit_res and 'id' in limit_res:
                self.active_pos['limit_order_id'] = limit_res['id']
                # We also update the TP tracking to this new limit price
                self.active_pos['tp'] = close_price
                self.sell_order_type = 'limit' # Force limit mode if it wasn't
                await self._send_telegram(f"🎯 WallHunter EMERGENCY EXIT - Limit Placed!\nPair: {self.symbol}\nLimit Price: {close_price:.6f}")
            else:
                raise Exception("Failed to place emergency limit order.")
        else:
            raise ValueError(f"Unknown sell_type: {sell_type}")

