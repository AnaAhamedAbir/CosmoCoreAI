import logging
import asyncio
import time
import json
import ccxt
import ccxt.pro as ccxt_pro
from app.strategies.helpers.auto_stop_manager import AutoStopManager
from app.utils import get_redis_client
from app.strategies.order_block_bot import OrderBlockExecutionEngine
from app.strategies.helpers.absorption_tracker import AbsorptionTracker
from app.strategies.helpers.iceberg_tracker import IcebergTracker
from app.strategies.helpers.trend_finder import AdaptiveTrendFinder
from app.strategies.helpers.ut_bot_tracker import UTBotTracker
from app.strategies.helpers.ut_standalone_listener import UTStandaloneListener
from app.strategies.helpers.ml_standalone_listener import MLStandaloneListener
from app.strategies.helpers.ml_l2_predictor import MLL2Predictor
from app.strategies.helpers.supertrend_tracker import SupertrendTracker
from app.strategies.helpers.supertrend_standalone_listener import SupertrendStandaloneListener
from app.strategies.helpers.dual_engine_standalone_listener import DualEngineStandaloneListener
from app.strategies.helpers.dual_engine_analyzer import DualEngineTracker
from app.services.market_depth_service import market_depth_service
from app.strategies.helpers.trading_session_filter import TradingSessionTracker
from app.strategies.helpers.wick_sr_tracker import WickSRTracker
from app.strategies.helpers.wick_sr_standalone_listener import WickSRStandaloneListener
from app.strategies.helpers.fibo_tp_calculator import calculate_fibo_extension_tp
from app.strategies.helpers.vwap_sd_tracker import VWAPSDTracker
from app.strategies.helpers.vwap_sd_standalone_listener import VWAPSDStandaloneListener
from app.strategies.helpers.advanced_risk_manager import AdvancedRiskManager
from app.services.ta_snapshot_service import ta_snapshot_service
from app.strategies.smart_chase_executor import execute_smart_chase
from app.strategies.helpers.god_mode_signal_evaluator import GodModeSignalEvaluator

logger = logging.getLogger(__name__)

# ----------------------------------------------------
# 🛡️ CosmoQuant Institutional-Grade Shared Logging System

from app.strategies.wall_hunter.logger import WallHunterLogger, WallHunterFuturesLogger, decrypt_key
from app.strategies.wall_hunter.base import BaseWallHunterBot
from app.strategies.wall_hunter.common_config import apply_common_config_updates

class WallHunterFuturesStrategy(BaseWallHunterBot):
    state_key_prefix = "wallhunter_futures"

    def __init__(self, bot_record, ccxt_service):
        self.bot_record = bot_record
        self.bot_id = bot_record.id
        self.owner_id = bot_record.owner_id
        self.bot_name = getattr(bot_record, "name", getattr(bot_record, "bot_name", f"Bot {self.bot_id}"))
        self.exchange_service = ccxt_service
        self.config = bot_record.config or {}
        
        self.is_ready = False
        self._init_task = None
        
        # ফিউচার কনফিগারেশন
        self.leverage = self.config.get('leverage', 10)
        self.margin_mode = self.config.get('margin_mode', 'cross')
        self.reduce_only = self.config.get('reduce_only', True)
        self.direction = self.config.get('position_direction', 'auto') # long, short, auto
        self.symbol = bot_record.market
        self.exchange_id = (bot_record.exchange or "binance").lower()
        self.is_paper_trading = bot_record.is_paper_trading
        
        # Initialize Custom Logger for Web Dashboard
        self.logger = WallHunterFuturesLogger(self.bot_id)
        
        # Strategy Params (Adapted from Spot Bot)
        self.vol_threshold = self.config.get("vol_threshold", 500000)
        self.target_spread = self.config.get("target_spread", 0.0002)
        self.initial_risk_pct = self.config.get("risk_pct", 0.5)
        self.tsl_pct = self.config.get("trailing_stop", 0.2)
        self.min_wall_lifetime = self.config.get("min_wall_lifetime", 3.0)
        self.max_wall_distance_pct = self.config.get("max_wall_distance_pct", 1.0)
        self.amount_per_trade = self.config.get("amount_per_trade", 10.0)
        self.buy_order_type = self.config.get("buy_order_type", "market")
        self.sell_order_type = self.config.get("sell_order_type", "market")
        self.sl_order_type = self.config.get("sl_order_type", "smart_chase")
        self.smart_chase_deviation_pct = self.config.get("smart_chase_deviation_pct", 1.0)
        self.smart_chase_delay_ms = self.config.get("smart_chase_delay_ms", 1500)
        self.smart_chase_max_attempts = self.config.get("smart_chase_max_attempts", 15)
        self.limit_buffer = self.config.get("limit_buffer", 0.05)  # % buffer for maker limit orders
        self.tsl_activation_pct = self.config.get("tsl_activation_pct", 0.0)
        self.entry_order_timeout = self.config.get("entry_order_timeout", 30.0)
        # Soft Limit TP: how long (seconds) to wait for a postOnly maker TP order before market sweep
        self.tp_soft_limit_timeout = self.config.get("tp_soft_limit_timeout", 4)
        
        # --- NEW FEATURES: Partial TP & Triggers ---
        self.partial_tp_pct = self.config.get("partial_tp_pct", 50.0)
        self.partial_tp_trigger_pct = self.config.get("partial_tp_trigger_pct", 0.0)
        self.sl_breakeven_trigger_pct = self.config.get("sl_breakeven_trigger_pct", 0.0)
        self.sl_breakeven_target_pct = self.config.get("sl_breakeven_target_pct", 0.0)
        
        self.vpvr_enabled = self.config.get("vpvr_enabled", False)
        self.vpvr_tolerance = self.config.get("vpvr_tolerance", 0.2)
        self.top_hvns = []
        
        self.atr_sl_enabled = self.config.get("atr_sl_enabled", False)
        self.atr_period = self.config.get("atr_period", 14)
        self.atr_multiplier = self.config.get("atr_multiplier", 2.0)
        self.current_atr = 0.0
        
        self.enable_wall_trigger = self.config.get("enable_wall_trigger", True)
        self.enable_liq_trigger = self.config.get("enable_liq_trigger", False)
        self.liq_threshold = self.config.get("liq_threshold", 50000.0)
        self.enable_micro_scalp = self.config.get("enable_micro_scalp", False)
        self.micro_scalp_profit_ticks = self.config.get("micro_scalp_profit_ticks", 2)
        self.micro_scalp_min_wall = self.config.get("micro_scalp_min_wall", 100000.0)
        self.enable_dynamic_atr_scalp = self.config.get("enable_dynamic_atr_scalp", False)
        self.micro_scalp_atr_multiplier = self.config.get("micro_scalp_atr_multiplier", 0.5)
        self.enable_oib_filter = self.config.get("enable_oib_filter", False)
        self.min_oib_threshold = self.config.get("min_oib_threshold", 0.4)
        
        from collections import deque
        self.liq_history = deque()
        self.liq_cascade_window = self.config.get("liq_cascade_window", 5)
        self.enable_liq_cascade = self.config.get("enable_liq_cascade", False)
        self.follow_btc_liq = self.config.get("follow_btc_liq", False)
        self.btc_liq_threshold = self.config.get("btc_liq_threshold", 500000.0)
        self.enable_dynamic_liq = self.config.get("enable_dynamic_liq", False)
        self.dynamic_liq_multiplier = self.config.get("dynamic_liq_multiplier", 1.0)
        
        # --- ML L2 Filter ---
        self.ml_execution_mode = self.config.get("ml_execution_mode", "basic")
        self.enable_ml_filter = self.config.get("enable_ml_filter", False)
        self.ai_model_id = self.config.get("ai_model_id", "")
        self.ml_predictor = None
        if self.enable_ml_filter and self.ai_model_id:
            try:
                self.ml_predictor = MLL2Predictor(self.ai_model_id)
                self.ml_predictor.bullish_threshold = self.config.get("ml_bullish_threshold", 0.5)
                self.ml_predictor.bearish_threshold = self.config.get("ml_bearish_threshold", 0.5)
            except Exception as e:
                self.logger.error(f"Failed to initialize ML Predictor: {e}")
        self.ml_standalone_listener = MLStandaloneListener(self)
        
        # --- Tape Reading / Imbalance ---
        self.enable_ob_imbalance = self.config.get("enable_ob_imbalance", False)
        self.ob_imbalance_ratio = self.config.get("ob_imbalance_ratio", 1.5)
        self.liquidation_safety_pct = self.config.get("liquidation_safety_pct", 5.0)

        # --- Proxy Orderbook Routing (Lead-Lag) ---
        self.enable_proxy_wall = self.config.get("enable_proxy_wall", False)
        self.proxy_exchange = self.config.get("proxy_exchange", self.exchange_id)
        self.proxy_symbol = self.config.get("proxy_symbol", "")
        if self.enable_proxy_wall and self.proxy_symbol:
            ext_suffix = f" on {self.proxy_exchange.upper()}" if self.proxy_exchange != self.exchange_id else ""
            self.logger.info(f"Proxy Orderbook Routing Enabled! Tracking {self.proxy_symbol}{ext_suffix} for Trade Entry on {self.symbol}.")

        # --- CVD Absorption Trigger ---
        self.enable_absorption = self.config.get("enable_absorption", False)
        self.absorption_threshold = self.config.get("absorption_threshold", 50000.0)
        self.absorption_window = self.config.get("absorption_window", 10)
        self.absorption_tracker = AbsorptionTracker(
            threshold=self.absorption_threshold,
            window_seconds=self.absorption_window
        )
        
        # --- NEW FEATURES: Iceberg & Hidden Wall Trigger ---
        self.enable_iceberg_trigger = self.config.get("enable_iceberg_trigger", False)
        self.iceberg_time_window_secs = self.config.get("iceberg_time_window_secs", 10)
        self.iceberg_min_absorbed_vol = self.config.get("iceberg_min_absorbed_vol", 100000.0)
        self.iceberg_tracker = IcebergTracker(
            window_seconds=self.iceberg_time_window_secs,
            min_absorbed_vol=self.iceberg_min_absorbed_vol
        )
        
        # --- BRAND NEW: BTC Correlation Filter ---
        self.enable_btc_correlation = self.config.get("enable_btc_correlation", False)
        self.btc_correlation_threshold = self.config.get("btc_correlation_threshold", 0.7)
        self.btc_time_window = self.config.get("btc_time_window", 15)
        self.btc_min_move_pct = self.config.get("btc_min_move_pct", 0.1)
        self.btc_correlation_tracker = None
        
        # --- NEW: Adaptive Trend Filter ---
        self.enable_trend_filter = self.config.get("enable_trend_filter", False)
        self.trend_filter_lookback = self.config.get("trend_filter_lookback", 200)
        self.trend_filter_threshold = self.config.get("trend_filter_threshold", "Strong")
        self.trend_filter_dev = self.config.get("trend_filter_dev", 2.0)
        self.enable_trend_volume = self.config.get("enable_trend_volume", False)
        self.trend_volume_multiplier = self.config.get("trend_volume_multiplier", 1.5)
        
        self.trend_finder = AdaptiveTrendFinder(
            lookback=self.trend_filter_lookback, 
            threshold=self.trend_filter_threshold,
            dev_threshold=self.trend_filter_dev,
            enable_volume_filter=self.enable_trend_volume,
            volume_multiplier=self.trend_volume_multiplier
        ) if self.enable_trend_filter else None
        
        # --- NEW: Modular UT Bot Alerts ---
        self.enable_ut_trend_filter = self.config.get("enable_ut_trend_filter", False)
        self.enable_ut_entry_trigger = self.config.get("enable_ut_entry_trigger", False)
        self.enable_ut_trailing_sl = self.config.get("enable_ut_trailing_sl", False)
        self.ut_bot_sensitivity = self.config.get("ut_bot_sensitivity", 1.0)
        self.ut_bot_atr_period = self.config.get("ut_bot_atr_period", 10)
        self.ut_bot_use_heikin_ashi = self.config.get("ut_bot_use_heikin_ashi", False)
        self.ut_bot_timeframe = self.config.get("ut_bot_timeframe", "5m")
        self.ut_bot_candle_close = self.config.get("ut_bot_candle_close", False)
        self.ut_bot_validation_secs = self.config.get("ut_bot_validation_secs", 0)
        self.ut_bot_retest_snipe = self.config.get("ut_bot_retest_snipe", False)
        self.ut_trend_unlock_mode = self.config.get("enable_ut_trend_unlock_mode", False)
        
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
        self.enable_god_mode_entry_trigger = self.config.get("enable_god_mode_entry_trigger", False)
        self.god_mode_long_threshold = self.config.get("god_mode_long_threshold", 80)
        self.god_mode_short_threshold = self.config.get("god_mode_short_threshold", -80)

        # --- NEW: Modular Supertrend Alerts ---
        self.enable_supertrend_trend_filter = self.config.get("enable_supertrend_trend_filter", False)
        self.enable_supertrend_entry_trigger = self.config.get("enable_supertrend_entry_trigger", False)
        self.enable_supertrend_trailing_sl = self.config.get("enable_supertrend_trailing_sl", False)
        self.supertrend_trend_unlock_mode = self.config.get("enable_supertrend_trend_unlock_mode", False)
        self.enable_supertrend_exit = self.config.get("enable_supertrend_exit", False)
        self.supertrend_exit_timeout = self.config.get("supertrend_exit_timeout", 5)
        self.supertrend_period = self.config.get("supertrend_period", 10)
        self.supertrend_multiplier = self.config.get("supertrend_multiplier", 3.0)
        self.supertrend_timeframe = self.config.get("supertrend_timeframe", "5m")
        self.supertrend_candle_close = self.config.get("supertrend_candle_close", False)
        
        any_supertrend_enabled = self.enable_supertrend_trend_filter or self.enable_supertrend_entry_trigger or self.enable_supertrend_trailing_sl or self.enable_supertrend_exit
        self.supertrend_tracker = SupertrendTracker(
            exchange_id=self.exchange_id,
            symbol=self.symbol,
            atr_period=self.supertrend_period,
            multiplier=self.supertrend_multiplier,
            timeframe=self.supertrend_timeframe
        ) if any_supertrend_enabled else None
        
        self.supertrend_standalone_listener = SupertrendStandaloneListener(self) if any_supertrend_enabled else None

        _de_enabled = self.config.get("enable_dual_engine", False)
        self.dual_engine_tracker = DualEngineTracker(self.exchange_id, self.symbol, self.config) if _de_enabled else None
        self.dual_engine_standalone = DualEngineStandaloneListener(self) if _de_enabled else None
        
        # --- NEW: Trading Session Tracker ---
        self.trading_sessions = self.config.get("trading_sessions", [self.config.get("trading_session", "None")])
        self.session_tracker = TradingSessionTracker(
            bot_instance=self,
            session_names=self.trading_sessions,
            on_session_end=self._on_trading_session_end
        )
        
        # --- NEW: Smart Wick S/R ---
        self.enable_wick_sr = self.config.get("enable_wick_sr", False)
        self.wick_sr_modes = self.config.get("wick_sr_modes", ["bounce"])
        self.wick_sr_timeframe = self.config.get("wick_sr_timeframe", "1m")
        self.wick_sr_sweep_threshold = self.config.get("wick_sr_sweep_threshold", 3)
        self.wick_sr_min_touches = self.config.get("wick_sr_min_touches", 10)
        self.wick_sr_lookback = self.config.get("wick_sr_lookback", 300)
        self.wick_sr_atr_period = self.config.get("wick_sr_atr_period", 14)
        self.wick_sr_atr_multiplier = self.config.get("wick_sr_atr_multiplier", 0.5)
        self.enable_wick_sr_oib = self.config.get("enable_wick_sr_oib", False)
        self.enable_dynamic_wick_tp = self.config.get("enable_dynamic_wick_tp", False)
        self.dynamic_tp_frontrun_pct = self.config.get("dynamic_tp_frontrun_pct", 0.0)
        
        # --- Auto Fibo Take Profit ---
        self.enable_auto_fibo_tp = self.config.get("enable_auto_fibo_tp", False)
        self.auto_fibo_target_level = self.config.get("auto_fibo_target_level", 1.618)
        self.auto_fibo_timeframe = self.config.get("auto_fibo_timeframe", "5m")
        self.auto_fibo_lookback = self.config.get("auto_fibo_lookback", 30)
        
        self.wick_sr_tracker = WickSRTracker(
            timeframe=self.wick_sr_timeframe,
            sweep_threshold_candles=self.wick_sr_sweep_threshold,
            min_touches=self.wick_sr_min_touches,
            atr_period=self.wick_sr_atr_period,
            atr_multiplier=self.wick_sr_atr_multiplier
        ) if self.enable_wick_sr else None
        
        self.wick_sr_listener = WickSRStandaloneListener(self)
        
        # --- NEW: VWAP SD Sniper ---
        self.enable_vwap_sd_snipe = self.config.get("enable_vwap_sd_snipe", False)
        self.vwap_sd_anchor = self.config.get("vwap_sd_anchor", "Daily")
        self.vwap_sd_multiplier = self.config.get("vwap_sd_multiplier", 3.0)
        self.vwap_sd_min_wall = self.config.get("vwap_sd_min_wall", 500000.0) # Confluence Wall Size
        self.vwap_sd_tracker = VWAPSDTracker(
            anchor=self.vwap_sd_anchor,
            mult3=self.vwap_sd_multiplier
        ) if self.enable_vwap_sd_snipe else None
        self.vwap_sd_listener = VWAPSDStandaloneListener(self) if self.enable_vwap_sd_snipe else None
        # ----------------------------------------
        
        # State
        self.running = False
        self.redis = get_redis_client()
        self.active_pos = None
        self.extreme_price = 0.0 # Will track Highest for Long, Lowest for Short
        self.tracked_walls = {} # {price: {first_seen, last_seen, vol, type}}
        self.unlocked_supertrend_dir = None # Holds 'buy' or 'sell' when unlocked
        self.unlocked_ut_dir = None # Holds 'buy' or 'sell' when unlocked
        self.last_debug_log_time = 0
        self.last_wall_alert_time = 0 # Throttling for entry-phase logs
        
        # Performance Tracking
        self.total_executed_orders = 0
        self._total_realized_pnl = 0.0
        self.total_wins = 0
        self.total_losses = 0
        self.total_longs = 0
        self.total_shorts = 0
        self.auto_stop_manager = AutoStopManager(bot_record.config)
        self.advanced_risk_manager = AdvancedRiskManager(bot_record.config)
        self.total_gross_pnl = 0.0
        self.total_fees_paid = 0.0
        self.maker_fee = 0.001
        self.taker_fee = 0.001
        
        # Tasks
        self._main_task = None
        self._heartbeat_task = None
        self._vpvr_task = None
        self._atr_task = None
        self._liq_task = None
        self._trades_task = None
        
        self.engine = None
        self.is_hedge_mode = False # Default to One-Way


    async def _safe_set_leverage(self):
        """Apply leverage to exchange live safely."""
        try:
            if not getattr(self, 'is_paper_trading', False) and getattr(self, 'private_exchange', None):
                await self.private_exchange.set_leverage(self.leverage, self.symbol)
        except Exception as e:
            self.logger.warning(f"Could not update leverage on exchange: {e}")

    def update_config(self, new_config: dict):
        """Update strategy parameters dynamically."""
        self.logger.info(f"?? [FuturesHunter {self.bot_id}] Live config update: {new_config}")
        updates = []

        if hasattr(self, 'advanced_risk_manager') and self.advanced_risk_manager:
            self.advanced_risk_manager.update_config(new_config)
            updates.append("Advanced Risk Manager config updated")

        if "strategy_mode" in new_config and new_config["strategy_mode"].lower() != getattr(self, "strategy_mode", "long"):
            updates.append(f"Strategy Mode: {getattr(self, 'strategy_mode', 'long').upper()} -> {new_config['strategy_mode'].upper()}")
            self.strategy_mode = new_config["strategy_mode"].lower()

        if "leverage" in new_config and new_config["leverage"] != getattr(self, "leverage", 10):
            updates.append(f"Leverage: {self.leverage}x -> {new_config['leverage']}x")
            self.leverage = new_config["leverage"]
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self._safe_set_leverage())
            except RuntimeError:
                pass

        if "margin_mode" in new_config and new_config["margin_mode"] != getattr(self, "margin_mode", "cross"):
            updates.append(f"Margin Mode: {self.margin_mode} -> {new_config['margin_mode']}")
            self.margin_mode = new_config["margin_mode"]

        if "partial_tp_trigger_pct" in new_config:
            self.partial_tp_trigger_pct = float(new_config["partial_tp_trigger_pct"])
            updates.append(f"Partial TP Trigger: {self.partial_tp_trigger_pct}%")

        apply_common_config_updates(self, new_config, updates)

        if updates:
            msg = f"⚡ [FuturesHunter {self.bot_id}] Live Configuration Updated:\n" + "\n".join([f"- {u}" for u in updates])
            self.logger.info(msg)
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self._send_telegram(f"⚙️ *Live Config Update*\n{self.symbol} Bot #{self.bot_id} (Futures)\n\n" + "\n".join([f"• {u}" for u in updates])))
            except RuntimeError:
                pass
        else:
            self.logger.info(f"⚡ [FuturesHunter {self.bot_id}] Config update received, but no changes detected.")

    async def _initialize_async(self, api_key_record=None):
        """বট স্টার্ট করার মেইন এন্ট্রি পয়েন্ট"""
        self.running = True
        logger.info(f"🚀 [FuturesHunter {self.bot_id}] Starting on {self.symbol}")
        
        try:
            # ১. এক্সচেঞ্জ ইনিশিয়ালাইজেশন
            exchange_id = self.exchange_id
            if exchange_id == 'kucoin':
                exchange_id = 'kucoinfutures'
                
            exchange_class = getattr(ccxt_pro, exchange_id)
            
            # Format Symbol for Futures
            from app.services.ccxt_service import ccxt_service
            self.symbol = ccxt_service.format_futures_symbol(self.symbol, self.exchange_id)
            
            # Public instance for data
            self.public_exchange = exchange_class({'enableRateLimit': True, 'options': {'defaultType': 'swap'}})
            
            # Proxy Exchange Initialization (Cross-Exchange Routing)
            if self.enable_proxy_wall and hasattr(self, 'proxy_exchange') and self.proxy_exchange != self.exchange_id:
                try:
                    proxy_class = getattr(ccxt_pro, self.proxy_exchange, getattr(ccxt, self.proxy_exchange, None))
                    if proxy_class:
                        self.proxy_public_exchange = proxy_class({'enableRateLimit': True, 'options': {'defaultType': 'swap'}})
                        self.logger.info(f"🔄 Dual-Exchange Initialized: Native ({self.exchange_id}) | Proxy ({self.proxy_exchange})")
                    else:
                        raise Exception("Exchange class not found")
                except Exception as e:
                    self.logger.error(f"Failed to load proxy exchange {self.proxy_exchange}: {e}. Falling back to native.")
                    self.proxy_public_exchange = self.public_exchange
            else:
                self.proxy_public_exchange = self.public_exchange
            
            # Private instance for trading
            exchange_params = {
                'enableRateLimit': True,
                'options': {
                    'defaultType': 'swap',
                    'adjustForTimeDifference': True,
                    'recvWindow': 60000 if self.exchange_id == 'mexc' else 30000,
                    'new_updates': True if self.exchange_id == 'mexc' else False
                }
            }
            
            try:
                from app.services.ccxt_service import ccxt_service
                cached_markets = await ccxt_service.get_full_markets(self.exchange_id, 'swap')
                if cached_markets:
                    self.public_exchange.markets = cached_markets
                    self.public_exchange.symbols = list(cached_markets.keys())
                else:
                    await self.public_exchange.load_markets()
                
                # Load markets for proxy exchange if it exists and is different
                if getattr(self, 'proxy_public_exchange', None) and self.proxy_public_exchange != self.public_exchange:
                    try:
                        proxy_markets = await ccxt_service.get_full_markets(self.proxy_exchange, 'swap')
                        if proxy_markets:
                            self.proxy_public_exchange.markets = proxy_markets
                            self.proxy_public_exchange.symbols = list(proxy_markets.keys())
                        else:
                            await self.proxy_public_exchange.load_markets()
                        self.logger.info(f"✅ Connected to Proxy Exchange: {self.proxy_exchange.upper()}")
                    except Exception as e:
                        self.logger.warning(f"Could not load markets for proxy exchange {self.proxy_exchange}: {e}")
            except Exception as e:
                logger.warning(f"Could not load public markets: {e}")

            if not self.is_paper_trading and api_key_record:
                from app.core.security import decrypt_key
                exchange_params.update({
                    'apiKey': decrypt_key(api_key_record.api_key),
                    'secret': decrypt_key(api_key_record.secret_key)
                })
                if hasattr(api_key_record, 'passphrase') and api_key_record.passphrase:
                    exchange_params['password'] = decrypt_key(api_key_record.passphrase)
            
            self.private_exchange = exchange_class(exchange_params)
            
            try:
                from app.services.ccxt_service import ccxt_service
                cached_markets = await ccxt_service.get_full_markets(self.exchange_id, 'swap')
                if cached_markets:
                    self.private_exchange.markets = cached_markets
                    self.private_exchange.symbols = list(cached_markets.keys())
                else:
                    await self.private_exchange.load_markets()
            except Exception as e:
                logger.warning(f"Could not load private markets: {e}")

            # --- ১.৫ ফিউচার সেটিংস সেটআপ (লেভারেজ, মার্জিন মোড) ---
            # MUST happen before Recovery to ensure correct environment (Sandbox vs Live)
            await self.initialize_futures_settings()

            # --- Smart State Recovery & Safe Startup Cleanup ---
            if not self.is_paper_trading and self.private_exchange:
                state_key = f"wallhunter_futures:state:{self.bot_id}"
                recovered_pos = None
                try:
                    saved_state_str = self.redis.get(state_key)
                    if saved_state_str:
                        saved_state = json.loads(saved_state_str.decode('utf-8')) if isinstance(saved_state_str, bytes) else json.loads(saved_state_str)
                        
                        # For Futures, check if we actually have an open position natively
                        positions = await self.private_exchange.fetch_positions([self.symbol])
                        has_pos = False
                        norm_target = self._normalize_symbol(self.symbol)
                        
                        found_symbols = []
                        for p in positions:
                            p_symbol = p.get('symbol', 'UNKNOWN')
                            norm_p = self._normalize_symbol(p_symbol)
                            contracts = float(p.get('contracts', 0) or 0)
                            found_symbols.append(f"{p_symbol}({contracts})")
                            
                            # Log every position found during recovery debug
                            if p_symbol == self.symbol or norm_p == norm_target:
                                if contracts > 0:
                                    has_pos = True
                                    logger.info(f"✅ Found matching active position for {p_symbol} ({contracts} contracts)")
                                    break
                        
                        if has_pos:
                            recovered_pos = saved_state
                            self.active_pos = recovered_pos
                            logger.info(f"🌟 [STATE RECOVERY] Successfully recovered active Futures position!")
                            asyncio.create_task(self._send_telegram(f"🌟 *Futures Sequence Recovered*\nBot successfully reattached to live position on restart!\nEntry: {recovered_pos.get('entry')}"))
                        elif saved_state.get('entry_order_id'):
                            # Recovery for pending entry (order placed but not yet found in positional data)
                            entry_id = saved_state.get('entry_order_id')
                            logger.info(f"🔍 [STATE RECOVERY] Found pending Futures entry order {entry_id}. Checking status...")
                            try:
                                status = await self.private_exchange.fetch_order(entry_id, self.symbol)
                                if status and status.get('status') in ['open', 'new']:
                                    logger.info(f"⏳ Pending entry order {entry_id} is still {status.get('status')}. Attaching bot.")
                                    recovered_pos = saved_state
                                    self.active_pos = recovered_pos
                                elif status and status.get('status') in ['closed', 'filled']:
                                    logger.info(f"🌟 [STATE RECOVERY] Entry order {entry_id} filled while offline! Recovering state.")
                                    recovered_pos = saved_state
                                    recovered_pos['entry'] = status.get('average') or status.get('price') or saved_state.get('entry')
                                    recovered_pos['amount'] = status.get('filled') or saved_state.get('amount')
                                    recovered_pos.pop('entry_order_id', None)
                                    self.active_pos = recovered_pos
                                    self._save_state()
                                else:
                                    logger.info(f"⚠️ Pending entry order {entry_id} was {status.get('status') if status else 'lost'}. Keeping state for safety (User check required).")
                                    # We don't clear state here anymore, letting the loop handle it or user intervene
                            except Exception as e:
                                logger.warning(f"Could not verify pending entry order {entry_id}: {e}")
                        else:
                            logger.info(f"ℹ️ Saved state exists but no native position found. Symbols checked: {found_symbols}")
                            # Conservative: We don't auto-clear Redis here unless we are absolutely sure.
                            # Standard loop will handle it if it needs to open new trades.
                except Exception as e:
                    logger.warning(f"⚠️ Failed to attempt state recovery: {e}")
                    
                if not recovered_pos:
                    try:
                        # Only clear orders if we are starting fresh (no recovered position)
                        self.logger.info(f"🧹 Checking for dangling open orders for {self.symbol} (Bot {self.bot_id})...")
                        open_orders = await self.private_exchange.fetch_open_orders(self.symbol)
                        
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
                                        await self.private_exchange.cancel_order(order['id'], self.symbol)
                                    except Exception as cancel_err:
                                        self.logger.warning(f"Failed to cancel order {order['id']}: {cancel_err}")
                                self.logger.info(f"✅ Dangling orders for Bot {self.bot_id} cleared.")
                        else:
                            self.logger.info(f"✨ No dangling orders found for Bot {self.bot_id}. Isolation check complete.")
                    except Exception as e:
                        self.logger.warning(f"⚠️ Could not perform safe order cleanup: {e}")
            
            # ৩. এক্সিকিউশন ইঞ্জিন
            engine_config = self.config.copy()
            engine_config['symbol'] = self.symbol
            engine_config['trading_mode'] = 'futures'
            engine_config['is_paper_trading'] = self.is_paper_trading
            engine_config['exchange'] = self.exchange_id # Pass actual exchange ID (kucoin)
            engine_config['is_hedge_mode'] = self.is_hedge_mode # পাস করা হলো
            self.engine = OrderBlockExecutionEngine(engine_config, exchange=self.private_exchange, logger=self.logger, bot_id=self.bot_id)
            
            # ৪. মেইন লুপ এবং হার্টবিট শুরু করা
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
                
            if getattr(self, 'ut_bot_tracker', None):
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
                
            # --- Start Session Monitor ---
            await self.session_tracker.start_monitor()
            
            mode_str = "Paper Trading (Future)" if self.is_paper_trading else "Live Trading (Future)"
            
            trigger_logs = []
            if getattr(self, 'enable_wall_trigger', True):
                trigger_logs.append(f"Vol Threshold: {self.vol_threshold}")
            if getattr(self, 'enable_liq_trigger', False):
                trigger_logs.append(f"Liq Threshold: {self.liq_threshold}")
            trigger_str = "\n".join(trigger_logs)
            
            # Optional Limit Buffer: Only show if the order type is not Market
            limit_buffer = self.config.get("limit_buffer", 0.05)
            limit_buffer_str = f"Limit Buffer: {limit_buffer}%\n" if self.buy_order_type.lower() != "market" else ""

            any_ut = getattr(self, 'enable_ut_trend_filter', False) or getattr(self, 'enable_ut_entry_trigger', False) or getattr(self, 'enable_ut_trailing_sl', False)
            ut_summary_str = ""
            if any_ut:
                ut_mode = "Standalone" if (not self.enable_wall_trigger and not self.enable_liq_trigger) else "Confluence"
                ut_summary_str = f"UT Bot Alerts: ACTIVE ({ut_mode})\n"
                if getattr(self, 'enable_ut_entry_trigger', False): ut_summary_str += "  └─ Entry Trigger: ON\n"
                if getattr(self, 'enable_ut_trend_filter', False): ut_summary_str += "  └─ Trend Filter: ON\n"
                if getattr(self, 'enable_ut_trailing_sl', False): ut_summary_str += "  └─ Trailing SL: ON\n"

            any_supertrend = getattr(self, 'enable_supertrend_trend_filter', False) or getattr(self, 'enable_supertrend_entry_trigger', False) or getattr(self, 'enable_supertrend_trailing_sl', False) or getattr(self, 'enable_supertrend_exit', False)
            if any_supertrend:
                st_mode = "Standalone" if (not getattr(self, 'enable_wall_trigger', False) and not getattr(self, 'enable_liq_trigger', False)) else "Confluence"
                ut_summary_str += f"Supertrend Alerts: ACTIVE ({st_mode})\n"
                if getattr(self, 'enable_supertrend_entry_trigger', False): ut_summary_str += "  \u2514\u2500 Entry Trigger: ON\n"
                if getattr(self, 'enable_supertrend_trend_filter', False): ut_summary_str += "  \u2514\u2500 Trend Filter: ON\n"
                if getattr(self, 'enable_supertrend_trailing_sl', False): ut_summary_str += "  \u2514\u2500 Trailing SL: ON\n"
                if getattr(self, 'enable_supertrend_exit', False): ut_summary_str += f"  \u2514\u2500 Reversal Dual-Exit: ON ({getattr(self, 'supertrend_exit_timeout', 5)}s)\n"

            # Wick SR is shown in the BOT ACTIVATED numbered list (bot_manager.py), not here.
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
            
            startup_msg = (
                f"\U0001f7e2 WallHunter Bot [ID {self.bot_id}] Started!\n"
                f"Pair: {self.symbol}\n"
                f"Mode: {mode_str}\n"
                f"{session_str}"
                f"Buy Order: {self.buy_order_type.upper()}\n"
                f"{limit_buffer_str}"
                f"{trigger_str}\n"
                f"{ut_summary_str}"
                f"{risk_summary_str}"
            )

            await self._send_telegram(startup_msg)
            self.is_ready = True
            logger.info(f"\u2705 [FuturesHunter {self.bot_id}] Initialization Complete. Ready to trade.")


            
        except Exception as e:
            logger.error(f"❌ Failed to start Futures Bot {self.bot_id}: {str(e)}")
            await self.stop()
            self.running = False
            raise e

    async def initialize_futures_settings(self):
        """এক্সচেঞ্জে লেভারেজ এবং মার্জিন মোড সেট করবে"""
        try:
            logger.info(f"[{self.bot_id}] Setting up Futures Market: {self.symbol}, Leverage {self.leverage}x, Mode: {self.margin_mode}")
            
            if self.is_paper_trading:
                self.private_exchange.set_sandbox_mode(True)
                
            # সেট লেভারেজ
            try:
                if self.exchange_id == 'mexc':
                    # MEXC requires both long and short leverage to be set separately
                    open_type = 1 if self.margin_mode == 'isolated' else 2
                    await self.private_exchange.set_leverage(self.leverage, self.symbol, {'openType': open_type, 'positionType': 1}) # Long
                    await self.private_exchange.set_leverage(self.leverage, self.symbol, {'openType': open_type, 'positionType': 2}) # Short
                elif self.exchange_id == 'kucoin':
                    if self.margin_mode.lower() == 'cross':
                        await self.private_exchange.set_leverage(self.leverage, self.symbol, {'marginMode': 'cross'})
                    else:
                        # CCXT Kucoin only supports setting Cross leverage. Isolated is default or unsupported.
                        pass
                else:
                    await self.private_exchange.set_leverage(self.leverage, self.symbol)
            except Exception as e:
                logger.warning(f"Could not set leverage (might already be set): {e}")
                
            try:
                if self.exchange_id == 'mexc':
                    # MEXC setMarginMode requires leverage as well, and symbol must be in params for some versions
                    await self.private_exchange.set_margin_mode(self.margin_mode.lower(), self.symbol, {'leverage': self.leverage, 'symbol': self.symbol})
                elif self.exchange_id == 'kucoin':
                    # CCXT handles marginMode casing natively for Kucoin, passing it in params overrides it and breaks it
                    await self.private_exchange.set_margin_mode(self.margin_mode.lower(), self.symbol)
                else:
                    await self.private_exchange.set_margin_mode(self.margin_mode.lower(), self.symbol)
            except Exception as e:
                logger.warning(f"Could not set margin mode (might already be set): {e}")

            # ৩. ডাইনামিক পজিশন মোড ডিটেকশন (Binance Hedge vs One-Way)
            if self.exchange_id in ['binance', 'binanceusdm']:
                # Paper trading-এ API key নেই, private call skip করো
                if self.is_paper_trading:
                    self.is_hedge_mode = False
                    self.logger.info(f"ℹ️ [{self.bot_id}] Paper Trading — skipping position mode detection (defaulting to One-Way).")
                else:
                    try:
                        self.logger.info(f"🔍 [{self.bot_id}] Fetching Binance Position Mode...")
                        # CCXT CamelCase method is the primary (confirmed working)
                        # Fallback chain: CamelCase → snake_case → fapiprivate variant
                        response = None
                        for method_name in [
                            'fapiPrivateGetPositionSideDual',
                            'fapiprivateGetPositionsideDual',
                            'fapiprivate_get_positionside_dual',
                        ]:
                            method = getattr(self.private_exchange, method_name, None)
                            if method and callable(method):
                                try:
                                    response = await method()
                                    break
                                except Exception:
                                    continue

                        if response is not None:
                            self.is_hedge_mode = response.get('dualSidePosition', False)
                            mode_name = "Hedge Mode" if self.is_hedge_mode else "One-Way Mode"
                            self.logger.info(f"✅ [{self.bot_id}] [Binance] Detected Position Mode: {mode_name}")
                        else:
                            raise RuntimeError("All FAPI position mode methods failed or unavailable.")
                    except Exception as e:
                        logger.warning(f"⚠️ [{self.bot_id}] Could not detect Binance position mode (defaulting to One-Way): {e}")
                        self.is_hedge_mode = False
            elif self.exchange_id == 'binancecoinm':
                if self.is_paper_trading:
                    self.is_hedge_mode = False
                    self.logger.info(f"ℹ️ [{self.bot_id}] Paper Trading — skipping COIN-M position mode detection (defaulting to One-Way).")
                else:
                    try:
                        # Inverse Futures (COIN-M) — same fallback chain pattern
                        response = None
                        for method_name in [
                            'dapiPrivateGetPositionSideDual',
                            'dapiprivateGetPositionsideDual',
                            'dapiprivate_get_positionside_dual',
                        ]:
                            method = getattr(self.private_exchange, method_name, None)
                            if method and callable(method):
                                try:
                                    response = await method()
                                    break
                                except Exception:
                                    continue

                        if response is not None:
                            self.is_hedge_mode = response.get('dualSidePosition', False)
                            mode_name = "Hedge Mode" if self.is_hedge_mode else "One-Way Mode"
                            logger.info(f"✅ [{self.bot_id}] [Binance COIN-M] Detected Position Mode: {mode_name}")
                        else:
                            raise RuntimeError("All DAPI position mode methods failed or unavailable.")
                    except Exception as e:
                        logger.warning(f"⚠️ [{self.bot_id}] Could not detect Binance COIN-M position mode: {e}")
                        self.is_hedge_mode = False
                
        except Exception as e:
            logger.error(f"Futures Settings initialization error: {e}")

    async def _run_loop(self):
        """মেইন স্ট্র্যাটেজি লুপ: L2 অর্ডারবুক ট্র্যাকিং"""
        while self.running:
            try:
                # WebSocket এর মাধ্যমে অর্ডারবুক ওয়াচ করা
                limit = market_depth_service._normalize_order_book_limit(self.proxy_exchange if self.enable_proxy_wall else self.exchange_id, 20)
                watch_sym = self.proxy_symbol if self.enable_proxy_wall and self.proxy_symbol else self.symbol
                target_exchange = getattr(self, 'proxy_public_exchange', self.public_exchange)
                
                try:
                    orderbook = await target_exchange.watch_order_book(watch_sym, limit=limit)
                except Exception as e:
                    logger.warning(f"WS Orderbook error: {e}, falling back to REST")
                    await asyncio.sleep(1.5) # Rate limit protection for REST fallback
                    orderbook = await target_exchange.fetch_order_book(watch_sym, limit=limit)
                
                if not orderbook or not orderbook.get('bids') or not orderbook.get('asks'):
                    await asyncio.sleep(1)
                    continue

                best_bid = orderbook['bids'][0][0]
                best_ask = orderbook['asks'][0][0]
                
                if not best_bid or not best_ask or best_bid <= 0 or best_ask <= 0:
                    await asyncio.sleep(0.5)
                    continue
                    
                mid_price = (best_bid + best_ask) / 2
                current_time = time.time()

                # Continuously feed the AI Predictor with Live L2 Snapshots for Advanced Features Memory
                if getattr(self, 'enable_ml_filter', False) and getattr(self, 'ml_predictor', None):
                    if hasattr(self.ml_predictor, 'update_l2_memory'):
                        self.ml_predictor.update_l2_memory(orderbook)

                # Periodic debug info (every 10 seconds)
                if current_time - self.last_debug_log_time >= 10:
                    self.last_debug_log_time = current_time
                    max_bid = max([level[1] for level in orderbook['bids']]) if orderbook['bids'] else 0
                    max_ask = max([level[1] for level in orderbook['asks']]) if orderbook['asks'] else 0
                    # Only show Threshold when Wall Trigger is actually enabled — avoids confusion
                    if getattr(self, 'enable_wall_trigger', False):
                        logger.info(f"🔍 [Debug {self.bot_id}] {self.symbol} Mid: {mid_price:.6f} | Max Bid: {max_bid:,.0f} | Max Ask: {max_ask:,.0f} | Threshold: {self.vol_threshold:,.0f}")
                    else:
                        logger.info(f"🔍 [Debug {self.bot_id}] {self.symbol} Mid: {mid_price:.6f} | Max Bid: {max_bid:,.0f} | Max Ask: {max_ask:,.0f}")

                if not self.active_pos:

                    # --- Realized PNL Auto-Stop Check (Runs only when flat) ---
                    if hasattr(self, 'auto_stop_manager') and self.auto_stop_manager and not self.auto_stop_manager.is_stopped:
                        is_triggered = await self.auto_stop_manager.check_conditions(self.total_realized_pnl, self)
                        if is_triggered:
                            # Bot was stopped by auto_stop_manager
                            continue

                    # --- Session Checks ---
                    if not TradingSessionTracker.is_session_active(self.trading_sessions):
                        await asyncio.sleep(1)
                        continue # Skip entry searches outside of session
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
                    
                    if self.enable_iceberg_trigger:
                        self.iceberg_tracker.update_orderbook(orderbook['bids'], orderbook['asks'])
                        
                        target_side = "buy" if self.direction in ['long', 'auto'] else "sell"
                        
                        ice_res = self.iceberg_tracker.check_for_iceberg(target_side, mid_price)
                        if ice_res and ice_res.get('iceberg_detected'):
                            price = ice_res['price']
                            self.logger.info(f"💎 ICEBERG TRIGGER! Massive absorption detected defending {price}. Executing high-priority Snipe!")
                            
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
                            continue

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
                            if self.direction == 'long' and target_side != 'buy':
                                allowed = False
                            if self.direction == 'short' and target_side != 'sell':
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

                    if getattr(self, 'enable_wick_sr', False) and getattr(self, 'wick_sr_tracker', None):
                        wick_signals = self.wick_sr_tracker.get_signals(mid_price)
                        for w_sig in wick_signals:
                            # Check if the triggered mode is enabled
                            if w_sig['mode'] in self.wick_sr_modes:
                                raw_side = w_sig['side']
                                target_side = 'buy' if raw_side == 'long' else 'sell'
                                
                                # Option: Futures check direction restrictions
                                if target_side == "sell" and self.direction == "long":
                                    continue # Bot restricted to long only
                                elif target_side == "buy" and self.direction == "short":
                                    continue # Bot restricted to short only
                                
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
                                    self.tracked_walls.clear()
                                    break # Exit the wick sig loop to avoid double entries
                            
                        # If a wick signal just executed and opened a position, move to the next tick safely
                        if self.active_pos:
                            continue

                    if not self.enable_wall_trigger:
                        self._publish_status(mid_price)
                        continue

                    current_walls = {}
                    potential_triggers = []
                    
                    # ১. বড় ওয়াল ডিটেক্ট করা
                    bid_vol_total = 0.0
                    ask_vol_total = 0.0
                    
                    # Accumulate volume for imbalance check + detect BUY walls
                    for level in orderbook['bids']:
                        price, vol = level[0], level[1]
                        bid_vol_total += vol
                        if self.direction in ['long', 'auto'] and vol >= self.vol_threshold:
                            dist_pct = (abs(price - mid_price) / mid_price * 100) if mid_price > 0 else 0
                            if dist_pct <= self.max_wall_distance_pct:
                                current_walls[price] = {'vol': vol, 'type': 'buy'}
                        elif self.direction in ['long', 'auto'] and vol >= (self.vol_threshold * 0.5):
                            if current_time - self.last_debug_log_time >= 10:
                                logger.debug(f"ℹ️ Found buy wall at {price} with vol {vol:,.0f} (Too small, threshold: {self.vol_threshold:,.0f})")
                                
                    # Accumulate volume for imbalance check + detect SELL walls
                    for level in orderbook['asks']:
                        price, vol = level[0], level[1]
                        ask_vol_total += vol
                        if self.direction in ['short', 'auto'] and vol >= self.vol_threshold:
                            dist_pct = (abs(price - mid_price) / mid_price * 100) if mid_price > 0 else 0
                            if dist_pct <= self.max_wall_distance_pct:
                                current_walls[price] = {'vol': vol, 'type': 'sell'}
                        elif self.direction in ['short', 'auto'] and vol >= (self.vol_threshold * 0.5):
                            if current_time - self.last_debug_log_time >= 10:
                                logger.debug(f"ℹ️ Found sell wall at {price} with vol {vol:,.0f} (Too small, threshold: {self.vol_threshold:,.0f})")

                    # ২. ট্র্যাকিং এবং স্পুফিং ডিটেকশন (Collect all confirmed walls)
                    for price, info in current_walls.items():
                        if price in self.tracked_walls:
                            self.tracked_walls[price]['last_seen'] = current_time
                            alive_time = current_time - self.tracked_walls[price]['first_seen']
                            
                            if alive_time >= self.min_wall_lifetime:
                                wall_type = self.tracked_walls[price]['type']
                                
                                # VPVR Confirmation
                                if self.vpvr_enabled and self.top_hvns:
                                    is_hvn_aligned = any(abs(price - hvn) / hvn <= (self.vpvr_tolerance / 100.0) for hvn in self.top_hvns if hvn > 0)
                                    if not is_hvn_aligned:
                                        if not self.tracked_walls[price].get('hvn_rejected'):
                                            logger.info(f"🚫 Wall at {price} rejected: Not near any HVN.")
                                            self.tracked_walls[price]['hvn_rejected'] = True
                                        continue
                                
                                potential_triggers.append({
                                    'price': price,
                                    'vol': info['vol'],
                                    'type': wall_type
                                })
                        else:
                            self.tracked_walls[price] = {
                                "vol": info['vol'],
                                "type": info['type'],
                                "first_seen": current_time,
                                "last_seen": current_time
                            }
                    
                    # ৩. সেরা ওয়াল নির্বাচন (Highest Volume Wall)
                    if potential_triggers:
                        # Sort by volume descending
                        potential_triggers.sort(key=lambda x: x['vol'], reverse=True)
                        
                        # Apply Imbalance check if enabled
                        if ask_vol_total == 0 and bid_vol_total == 0:
                            imbalance_ratio = 1.0 # Neutral (prevents fakeout)
                        elif ask_vol_total == 0:
                            imbalance_ratio = 10.0
                        else:
                            imbalance_ratio = bid_vol_total / ask_vol_total
                        
                        best_wall = None
                        for wall in potential_triggers:
                            # If AUTO mode, check imbalance
                            if self.direction == 'auto' and self.enable_ob_imbalance:
                                safe_ratio = self.ob_imbalance_ratio if getattr(self, 'ob_imbalance_ratio', 1.5) > 0 else 1.5
                                if wall['type'] == 'buy' and imbalance_ratio < safe_ratio:
                                    continue # Not enough buy pressure
                                if wall['type'] == 'sell' and imbalance_ratio > (1 / safe_ratio):
                                    continue # Not enough sell pressure
                            
                            best_wall = wall
                            break
                        
                        if best_wall:
                            target_side = "buy" if best_wall['type'] == 'buy' else "sell"
                            should_log_alert = current_time - self.last_wall_alert_time >= 2.0
                            
                            if should_log_alert:
                                self.logger.info(f"🟢 [BEST WALL] {best_wall['type'].upper()} Confirmed at {best_wall['price']} (Vol: {best_wall['vol']}). Snipping!")
                                if self.enable_ob_imbalance:
                                    self.logger.info(f"📊 Market Imbalance: {imbalance_ratio:.2f}x (Threshold: {self.ob_imbalance_ratio}x)")
                                self.last_wall_alert_time = current_time
                            
                            reason = f"Wall confirmed at {best_wall['price']}"
                            if self.enable_ob_imbalance:
                                reason += f" (Imbalance: {imbalance_ratio:.2f}x)"
                            
                            # CVD Absorption Check
                            if self.enable_absorption:
                                wall_type = best_wall['type'] # 'buy' or 'sell'
                                # In Futures, 'buy' wall means we want to go LONG (reversal from shorts hitting the wall)
                                # AbsorptionTracker.is_absorption_detected(side) expects the side of the WALL
                                if not self.absorption_tracker.is_absorption_detected(wall_type):
                                    continue
                                self.logger.info(f"🧬 [ABSORPTION] Confirmed {wall_type.upper()} absorption at {best_wall['price']}!")
                            
                            # BTC Correlation Anti-Fakeout Check
                            if self.enable_btc_correlation and self.btc_correlation_tracker:
                                target_side = "buy" if best_wall['type'] == 'buy' else "sell"
                                if not self.btc_correlation_tracker.is_aligned(target_side):
                                    if should_log_alert:
                                        metrics = self.btc_correlation_tracker.get_metrics_string()
                                        self.logger.info(f"🚫 [BTC Divergence] Wall at {best_wall['price']} rejected! {metrics}")
                                    continue
                                    
                            # Adaptive Trend Filter Check
                            if self.enable_trend_filter and self.trend_finder:
                                target_side = "buy" if best_wall['type'] == 'buy' else "sell"
                                
                                # Fetch recent klines to evaluate trend instantly before snipe
                                try:
                                    klines = await market_depth_service.fetch_ohlcv(self.symbol, self.exchange_id, '1m', 1200)
                                    if klines:
                                        close_prices = [float(k['close']) for k in klines]
                                        volumes = [float(k.get('volume', 0)) for k in klines]
                                        trend_analysis = self.trend_finder.analyze_trend(close_prices)
                                        is_acceptable, tb_reason = self.trend_finder.is_trend_acceptable(trend_analysis, target_side)
                                        
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
                                            if should_log_alert:
                                                self.logger.info(f"🚫 [Trend Filter] Wall at {best_wall['price']} rejected! {tb_reason}")
                                            continue
                                        else:
                                            self.logger.info(f"📈 [Trend Filter] {tb_reason}")
                                            reason += f" ({tb_reason})"
                                except Exception as e:
                                    self.logger.warning(f"⚠️ [Trend Filter] Could not fetch OHLCV for trend check: {e}. Allowing trade (pass-through).")
                                    # Pass-through on fetch failure — don't block entries due to transient network errors

                            # --- Modular UT Bot Alerts Filter ---
                            target_side = "buy" if best_wall['type'] == 'buy' else "sell"
                            if self.enable_ut_entry_trigger and self.ut_bot_tracker:
                                if getattr(self, 'ut_trend_unlock_mode', False):
                                    if self.unlocked_ut_dir != target_side:
                                        if should_log_alert:
                                            self.logger.info(f"🚫 [UT Unlock Filter] Wall at {best_wall['price']} rejected! Waiting for initial {target_side.upper()} crossover.")
                                        continue
                                    else:
                                        self.logger.info(f"🔓 [UT Unlock] Path is clear for {target_side.upper()}!")
                                else:
                                    if not self.ut_bot_tracker.is_entry_signal(target_side):
                                        if should_log_alert:
                                            self.logger.info(f"🚫 [UT Entry Filter] Wall at {best_wall['price']} rejected! No exact crossover entry signal.")
                                        continue
                                    else:
                                        self.logger.info(f"📈 [UT Entry Filter] Exact {target_side.upper()} crossover signal detected!")

                            if self.enable_ut_trend_filter and self.ut_bot_tracker:
                                if not self.ut_bot_tracker.is_trend_aligned(target_side):
                                    if should_log_alert:
                                        self.logger.info(f"🚫 [UT Trend Filter] Wall at {best_wall['price']} rejected! Trend direction misaligned.")
                                    continue
                                else:
                                    self.logger.info(f"📈 [UT Trend Filter] Trend is aligned for {target_side.upper()}.")
                            
                            # --- Modular Supertrend Alerts Filter ---
                            if self.enable_supertrend_entry_trigger and self.supertrend_tracker:
                                if getattr(self, 'supertrend_trend_unlock_mode', False):
                                    if self.unlocked_supertrend_dir != target_side:
                                        if should_log_alert:
                                            self.logger.info(f"🚫 [Supertrend Unlock] Wall at {best_wall['price']} rejected! Waiting for initial {target_side.upper()} crossover.")
                                        continue
                                    else:
                                        self.logger.info(f"🔓 [Supertrend Unlock] Path is clear for {target_side.upper()}!")
                                else:
                                    if not self.supertrend_tracker.is_entry_signal(target_side):
                                        if should_log_alert:
                                            self.logger.info(f"🚫 [Supertrend Entry Filter] Wall at {best_wall['price']} rejected! No crossover entry signal.")
                                        continue
                                    else:
                                        self.logger.info(f"📈 [Supertrend Entry Filter] Exact {target_side.upper()} crossover signal detected!")

                            if self.enable_supertrend_trend_filter and self.supertrend_tracker:
                                if not self.supertrend_tracker.is_trend_aligned(target_side):
                                    if should_log_alert:
                                        self.logger.info(f"🚫 [Supertrend Trend Filter] Wall at {best_wall['price']} rejected! Trend direction misaligned.")
                                    continue
                                else:
                                    self.logger.info(f"📈 [Supertrend Trend Filter] Trend is aligned for {target_side.upper()}.")
                            
                            if getattr(self.dual_engine_tracker, "is_enabled", False):
                                if not self.dual_engine_tracker.is_aligned(target_side):
                                    if should_log_alert:
                                        self.logger.info(f"🚫 [Dual Engine] Wall at {best_wall['price']} rejected! {self.dual_engine_tracker.get_metrics_string()}")
                                    continue
                                else:
                                    self.logger.info(f"📈 [Dual Engine] Confirmed aligned for {target_side.upper()}! {self.dual_engine_tracker.get_metrics_string()}")
                                    reason += f" (Dual Engine)"
                            
                            # --- Multi-Level Orderbook Imbalance (OIB) ---
                            if getattr(self, 'enable_oib_filter', False):
                                oib_ratio = self.calculate_oib(orderbook, depth=10)
                                min_oib_threshold = getattr(self, 'min_oib_threshold', 0.4)
                                
                                if target_side == "buy" and oib_ratio < min_oib_threshold:
                                    if should_log_alert:
                                        self.logger.info(f"🚫 [OIB Filter] Snipe at {best_wall['price']} rejected! Weak Bid presence ({oib_ratio*100:.1f}%).")
                                    continue
                                elif target_side == "sell" and (1 - oib_ratio) < min_oib_threshold:
                                    if should_log_alert:
                                        self.logger.info(f"🚫 [OIB Filter] Snipe at {best_wall['price']} rejected! Weak Ask presence ({(1-oib_ratio)*100:.1f}%).")
                                    continue
                                else:
                                    support = oib_ratio if target_side == "buy" else (1-oib_ratio)
                                    self.logger.info(f"📈 [OIB Filter] Orderbook supports {target_side.upper()} with {support*100:.1f}% dominance.")

                            # --- AI Model Filter (L2 Predictor) ---
                            override_sl_price = None
                            override_tp_price = None
                            if getattr(self, 'enable_ml_filter', False) and getattr(self, 'ml_predictor', None):
                                ml_mode = getattr(self, 'ml_execution_mode', 'basic')
                                is_ai_valid = False
                                
                                if ml_mode == 'advanced':
                                    advanced_setup = await self.ml_predictor.predict_advanced(orderbook, mid_price, target_side, self)
                                    if advanced_setup and advanced_setup.get("is_valid", False):
                                        is_ai_valid = True
                                        override_sl_price = advanced_setup.get("sl_price")
                                        override_tp_price = advanced_setup.get("tp_price")
                                        self.logger.info(f"🔮 [ML Advanced] Confirmed Setup Generated: SL={override_sl_price}, TP={override_tp_price}, R:R={advanced_setup.get('rr_ratio')}")
                                else:
                                    is_ai_valid = await self.ml_predictor.predict(orderbook, mid_price, target_side)
                                    
                                if not is_ai_valid:
                                    if should_log_alert:
                                        if time.time() - getattr(self, '_last_ai_log_time', 0) > 10.0:
                                            self.logger.info(f"🚫 [AI Filter] Snipe at {best_wall['price']} rejected! L2 Model predicts adverse movement.")
                                            self._last_ai_log_time = time.time()
                                    continue
                                else:
                                    if getattr(self.ml_predictor, 'is_loaded', False):
                                        self.logger.info(f"🤖 [AI Filter] Model confirmed {target_side.upper()} order flow!")
                                        reason += " (AI Validated)"
                                    else:
                                        self.logger.info(f"⚠️ [AI Filter] Model unavailable. Trade allowed by default.")
                                        reason += " (AI Bypassed)"

                            if self.enable_proxy_wall:
                                try:
                                    native_book = await self.public_exchange.fetch_order_book(self.symbol, limit=5)
                                    native_best_bid = native_book['bids'][0][0]
                                    native_best_ask = native_book['asks'][0][0]
                                    native_mid = (native_best_bid + native_best_ask) / 2
                                    await self.execute_snipe(best_wall['price'], target_side, native_mid, native_best_bid, native_best_ask, reason=reason, override_sl_price=override_sl_price, override_tp_price=override_tp_price)
                                except Exception as e:
                                    self.logger.warning(f"Error fetching native execution book for proxy snipe: {e}. Falling back to proxy price.")
                                    await self.execute_snipe(best_wall['price'], target_side, mid_price, best_bid, best_ask, reason=reason, override_sl_price=override_sl_price, override_tp_price=override_tp_price)
                            else:
                                await self.execute_snipe(best_wall['price'], target_side, mid_price, best_bid, best_ask, reason=reason, override_sl_price=override_sl_price, override_tp_price=override_tp_price)
                            self.tracked_walls.clear()
                    
                    # ৪. ভ্যানিশ হওয়া ওয়ালগুলো সরানো (Grace Period: 2 Seconds)
                    spoofed = []
                    for p, data in self.tracked_walls.items():
                        if p not in current_walls:
                            # Allow a 2-second grace period for network lag or partial fills
                            if current_time - data['last_seen'] > 2.0:
                                spoofed.append(p)
                                
                    for p in spoofed:
                        del self.tracked_walls[p]
                
                else:
                    # ৪. রিস্ক ম্যানেজমেন্ট (TSL, TP)
                    if self.enable_proxy_wall and hasattr(self, 'current_native_price') and self.current_native_price:
                        await self.manage_risk(self.current_native_price)
                    else:
                        await self.manage_risk(mid_price)

                if self.enable_proxy_wall and hasattr(self, 'current_native_price') and self.current_native_price:
                    self._publish_status(self.current_native_price)
                else:
                    self._publish_status(mid_price)
                await asyncio.sleep(0.001)

            except Exception as e:
                import traceback
                self.logger.error(f"Futures Hunter Loop Error: {e}\n{traceback.format_exc()}")
                await asyncio.sleep(2)

    async def execute_snipe(self, wall_price: float, side: str, current_mid_price: float, best_bid: float = None, best_ask: float = None, reason: str = "Wall Detection", override_order_type: str = None, override_limit_price: float = None, override_sl_price: float = None, override_tp_price: float = None):
        """অর্ডার এক্সিকিউট করা"""
        pos_side = "LONG" if side == "buy" else "SHORT"
        try:
            # User explicitly requested STRICT POST-ONLY limit entry mode for all WallHunter Bot entries.
            snipe_order_type = override_order_type if override_order_type else "limit"
            
            if snipe_order_type == "limit":
                if side == "buy":
                    base_limit_price = best_bid if best_bid else current_mid_price
                else:
                    base_limit_price = best_ask if best_ask else current_mid_price
            else:
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
                    if self.public_exchange and getattr(self.public_exchange, 'markets', None):
                        mkt = self.public_exchange.markets.get(self.symbol, {})
                        precision = mkt.get('precision', {}).get('price')
                        if precision:
                            tick = float(precision) if float(precision) > 0 else None
                except Exception:
                    tick = None
                if not tick:
                    tick = round(best_bid * 1e-5, 10) if best_bid else 1e-5

                if side == "sell":
                    if entry_price <= best_bid:
                        adjusted = best_ask + tick
                        self.logger.warning(
                            f"⚠️ [Maker Guard] SELL entry {entry_price} ≤ best_bid {best_bid}! "
                            f"Nudging to {adjusted:.8g} (best_ask + 1 tick) to stay postOnly."
                        )
                        entry_price = adjusted
                elif side == "buy":
                    if entry_price >= best_ask:
                        adjusted = best_bid - tick
                        self.logger.warning(
                            f"⚠️ [Maker Guard] BUY entry {entry_price} ≥ best_ask {best_ask}! "
                            f"Nudging to {adjusted:.8g} (best_bid - 1 tick) to stay postOnly."
                        )
                        entry_price = adjusted
            # ─────────────────────────────────────────────────────────────────────────

            # --- LIQUIDATION SAFETY GUARD ---
            liq_safety_pct = getattr(self, 'liquidation_safety_pct', 0.0)
            if liq_safety_pct > 0 and self.leverage > 1:
                # Estimate liquidation distance: long liq ≈ entry*(1 - 1/lev), short liq ≈ entry*(1 + 1/lev)
                liq_distance_pct = (1.0 / self.leverage) * 100.0
                if liq_distance_pct < liq_safety_pct:
                    self.logger.info(
                        f"🚫 [Liq Safety] Entry BLOCKED! Estimated liq distance {liq_distance_pct:.1f}% "
                        f"< safety threshold {liq_safety_pct:.1f}% at {self.leverage}x leverage."
                    )
                    return

            # Total Position Size = Amount * Leverage
            total_notional = self.amount_per_trade * self.leverage
            if not entry_price or entry_price <= 0:
                self.logger.error(f"❌ [FuturesHunter] Snipe Aborted: entry_price is zero or invalid ({entry_price}). Cannot calculate position size.")
                return
            base_amount_tokens = total_notional / entry_price
            
            # Convert tokens to contracts (essential for Kucoin, OKX, Bybit, etc.)
            contract_size = 1.0
            if self.public_exchange and getattr(self.public_exchange, 'markets', None):
                market = self.public_exchange.markets.get(self.symbol, {})
                raw_cs = market.get('contractSize', 1.0)
                contract_size = float(raw_cs) if raw_cs and float(raw_cs) > 0 else 1.0
                
            contracts = base_amount_tokens / contract_size
            
            # Fetch minimum contract size from CCXT (usually 1.0)
            min_amount = 1.0
            min_cost = 0.0
            if self.public_exchange and getattr(self.public_exchange, 'markets', None):
                market = self.public_exchange.markets.get(self.symbol, {})
                limits = market.get('limits', {})
                min_amount = limits.get('amount', {}).get('min', 1.0)
                min_cost = limits.get('cost', {}).get('min', 0.0)
                if min_amount is None:
                    min_amount = 1.0
                    
            target_notional = contracts * contract_size * entry_price
            if min_cost and min_cost > 0 and target_notional < min_cost:
                logger.error(f"❌ [FuturesHunter] Snipe Aborted: Target notional ${target_notional:.2f} < Exchange Min Notional ${min_cost:.2f}.")
                return
            
            # Integer rounding for Kucoin/MEXC futures if min_amount is integer-like
            if min_amount >= 1.0:
                base_amount = float(int(contracts))
            else:
                base_amount = float(f"{contracts:.6f}")
                
            if base_amount < min_amount:
                logger.warning(f"Calculated contracts ({base_amount}) < minimum ({min_amount}). Trying to place min_amount, but might fail with Insufficient Balance.")
                base_amount = min_amount
            
            logger.info(f"⚡ [FuturesHunter] Entering {pos_side} at {entry_price} (Amount: {base_amount} contracts)")
            logger.info(f"📝 Reason: {reason}")
            
            if snipe_order_type == "marketable_limit":
                snipe_order_type = "market"
                
            order_params = {"postOnly": True} if snipe_order_type == "limit" else {}
                
            res = await self.engine.execute_trade(side, base_amount, entry_price, order_type=snipe_order_type, params=order_params)
            if res:
                # --- NEW: Partial Fill Management for Entry ---
                if self.buy_order_type in ['limit', 'marketable_limit'] and res.get('id') and not self.is_paper_trading:
                    try:
                        order_status = None
                        timeout_secs = getattr(self, "entry_order_timeout", 30.0)
                        max_attempts = max(1, int(timeout_secs / 1.0))
                        for _ in range(max_attempts):
                            await asyncio.sleep(1.0)
                            try:
                                order_status = await self.engine.exchange.fetch_order(res['id'], self.symbol)
                                if order_status and order_status.get('status') != 'open':
                                    break
                            except Exception: pass
                            
                        if order_status and order_status.get('status') == 'open':
                            logger.warning(f"⚠️ Entry order {res['id']} is still open! Cancelling remainder...")
                            await self.engine.cancel_order(res['id'])
                            await asyncio.sleep(0.5)
                            
                            final_status = await self.engine.exchange.fetch_order(res['id'], self.symbol)
                            filled = final_status.get('filled', 0.0)
                            
                            if filled <= 0:
                                logger.info(f"❌ Entry order was completely unfilled before cancellation. Aborting snipe.")
                                return
                                
                            logger.info(f"🔄 Partial Fill Detected! Requested: {base_amount}, Filled: {filled}. Adjusting position size.")
                            base_amount_raw = float(self.engine.exchange.amount_to_precision(self.symbol, filled)) if hasattr(self.engine.exchange, 'amount_to_precision') else filled
                            base_amount = base_amount_raw
                            
                            res['average'] = final_status.get('average') or res.get('average')
                            res['price'] = final_status.get('price') or res.get('price')
                    except Exception as e:
                        logger.error(f"Error handling partial fill verification on entry: {e}")
                # ---------------------------------------------
                
                actual_entry = res.get('average') or res.get('price') or entry_price
                
                dynamic_tp_price = None
                if getattr(self, 'enable_wick_sr', False) and getattr(self, 'enable_dynamic_wick_tp', False) and hasattr(self, 'wick_sr_tracker'):
                    dynamic_tp_price = self.wick_sr_tracker.get_dynamic_tp(
                        side=side, 
                        entry_price=actual_entry, 
                        frontrun_pct=getattr(self, 'dynamic_tp_frontrun_pct', 0.0)
                    )
                
                # --- NEW: AUTO FIBO MAX TP EXTENSION ---
                if not dynamic_tp_price and getattr(self, 'enable_auto_fibo_tp', False) and not override_tp_price:
                    try:
                        fibo_tf = getattr(self, 'auto_fibo_timeframe', '5m')
                        fibo_level = getattr(self, 'auto_fibo_target_level', 1.618)
                        fibo_lookback = getattr(self, 'auto_fibo_lookback', 30)
                        
                        ohlcv = await self.public_exchange.fetch_ohlcv(self.symbol, timeframe=fibo_tf, limit=fibo_lookback)
                        if ohlcv:
                            calculated_tp = calculate_fibo_extension_tp(ohlcv, actual_entry, side, float(fibo_level))
                            if calculated_tp:
                                dynamic_tp_price = calculated_tp
                                logger.info(f"🎯 [AUTO-FIBO] Computed Maximum Dynamic TP: {dynamic_tp_price:.6f} at {fibo_level}x Extension!")
                    except Exception as e:
                        logger.error(f"Failed to compute Auto-Fibo TP! Falling back to spread. Err: {e}")
                
                if side == "buy": # LONG
                    if override_sl_price:
                        sl_price = override_sl_price
                    else:
                        sl_price = actual_entry * (1 - (self.initial_risk_pct / 100)) if self.initial_risk_pct > 0 else 0.0
                        
                    if override_tp_price:
                        tp_price = override_tp_price
                        logger.info(f"🔮 [ML Advanced TP] Set to {tp_price:.6f} by AI!")
                    elif dynamic_tp_price and dynamic_tp_price > actual_entry:
                        tp_price = dynamic_tp_price
                        logger.info(f"🎯 [Dynamic TP] Set to {tp_price:.6f} dynamically!")
                    else:
                        tp_price = actual_entry + self.target_spread
                        if getattr(self, 'enable_dynamic_wick_tp', False) or getattr(self, 'enable_auto_fibo_tp', False):
                            logger.info(f"⚠️ [Dynamic TP] Fallback Spread TP activated: {tp_price:.6f}")
                    
                    # Apply exchange precision to avoid float imprecision errors (-1111, -5022)
                    try:
                        if self.public_exchange and hasattr(self.public_exchange, 'price_to_precision'):
                            tp_price = float(self.public_exchange.price_to_precision(self.symbol, tp_price))
                            sl_price = float(self.public_exchange.price_to_precision(self.symbol, sl_price)) if sl_price > 0 else sl_price
                    except Exception:
                        pass
                            
                    self.active_pos = {
                        "entry": float(actual_entry),
                        "amount": base_amount,
                        "sl": sl_price,
                        "tp": tp_price,
                        "side": "long",
                        "breakeven_hit": False,
                        "tsl_activated": False,
                        "entry_order_id": res.get('id') if not getattr(self, 'is_paper_trading', False) else None
                    }
                else: # SHORT
                    if override_sl_price:
                        sl_price = override_sl_price
                    else:
                        sl_price = actual_entry * (1 + (self.initial_risk_pct / 100)) if self.initial_risk_pct > 0 else float('inf')
                        
                    if override_tp_price:
                        tp_price = override_tp_price
                        logger.info(f"🔮 [ML Advanced TP] Set to {tp_price:.6f} by AI!")
                    elif dynamic_tp_price and dynamic_tp_price < actual_entry:
                        tp_price = dynamic_tp_price
                        logger.info(f"🎯 [Dynamic TP] Set to {tp_price:.6f} dynamically!")
                    else:
                        tp_price = actual_entry - self.target_spread
                        if getattr(self, 'enable_dynamic_wick_tp', False) or getattr(self, 'enable_auto_fibo_tp', False):
                            logger.info(f"⚠️ [Dynamic TP] Fallback Spread TP activated: {tp_price:.6f}")

                    # Apply exchange precision to avoid float imprecision errors (-1111, -5022)
                    try:
                        if self.public_exchange and hasattr(self.public_exchange, 'price_to_precision'):
                            tp_price = float(self.public_exchange.price_to_precision(self.symbol, tp_price))
                            if sl_price and sl_price != float('inf'):
                                sl_price = float(self.public_exchange.price_to_precision(self.symbol, sl_price))
                    except Exception:
                        pass

                    self.active_pos = {
                        "entry": float(actual_entry),
                        "amount": base_amount,
                        "sl": sl_price,
                        "tp": tp_price,
                        "side": "short",
                        "breakeven_hit": False,
                        "tsl_activated": False,
                        "entry_order_id": res.get('id') if not getattr(self, 'is_paper_trading', False) else None
                    }

                self.extreme_price = actual_entry
                
                # --- NEW: Partial TP1 calculation ---
                if self.enable_micro_scalp:
                    if getattr(self, 'enable_dynamic_atr_scalp', False) and getattr(self, 'current_atr', 0) > 0:
                        atr_distance = self.current_atr * getattr(self, 'micro_scalp_atr_multiplier', 0.5)
                        tick_profit_pct = (atr_distance / actual_entry) if actual_entry > 0 else 0
                        tp_price = actual_entry * (1 + tick_profit_pct) if side == "buy" else actual_entry * (1 - tick_profit_pct)
                    else:
                        tick_profit_pct = self.micro_scalp_profit_ticks * 0.0001
                        tp_price = actual_entry * (1 + tick_profit_pct) if side == "buy" else actual_entry * (1 - tick_profit_pct)
                        
                    # BUG FIX: ATR dynamic SL — use max/min guard so SL never moves against protection
                    if getattr(self, 'enable_dynamic_atr_scalp', False) and getattr(self, 'current_atr', 0) > 0:
                        sl_distance = self.current_atr * getattr(self, 'atr_multiplier', 1.0)
                        sl_pct = (sl_distance / actual_entry) if actual_entry > 0 else 0
                        atr_sl_price = actual_entry * (1 - sl_pct) if side == "buy" else actual_entry * (1 + sl_pct)
                        current_sl = self.active_pos.get('sl', 0)
                        if side == "buy":
                            # For LONG: SL should be as HIGH as possible (closest to entry but still below)
                            self.active_pos['sl'] = max(current_sl, atr_sl_price) if current_sl > 0 else atr_sl_price
                        else:
                            # For SHORT: SL should be as LOW as possible (closest to entry but still above)
                            self.active_pos['sl'] = min(current_sl, atr_sl_price) if current_sl > 0 else atr_sl_price
                        
                    # BUG FIX: include sl_order_id: None to prevent ghost order ID from previous positions
                    self.active_pos.update({
                        "tp": tp_price,
                        "tp1": tp_price, 
                        "tp1_hit": True,
                        "breakeven_hit": False,
                        "limit_order_id": None,
                        "sl_order_id": None  # Clear any stale SL order reference
                    })
                else:
                    if getattr(self, 'partial_tp_trigger_pct', 0.0) > 0:
                        if side == "buy": # LONG
                            tp1_price = actual_entry * (1 + (self.partial_tp_trigger_pct / 100))
                        else: # SHORT
                            tp1_price = actual_entry * (1 - (self.partial_tp_trigger_pct / 100))
                    else:
                        tp_dist = abs(self.active_pos['tp'] - actual_entry)
                        if side == "buy": # LONG
                            tp1_price = actual_entry + (tp_dist * 0.5)
                        else: # SHORT
                            tp1_price = actual_entry - (tp_dist * 0.5)

                    self.active_pos.update({
                        "tp1": tp1_price,
                        "tp1_hit": False,
                        "breakeven_hit": False,
                        "limit_order_id": None,
                        "sl_order_id": None
                    })

                # --- PLACE NATIVE SL ORDER ---
                if getattr(self, 'initial_risk_pct', 0) > 0:
                    exit_side = "sell" if side == "buy" else "buy"
                    sl_type = getattr(self, 'sl_order_type', 'market')
                    
                    native_sl_price = self.active_pos['sl']
                    place_native_sl = True
                    
                    if sl_type == 'smart_chase':
                        # Place a Disaster Native SL at the Circuit Breaker boundary!
                        max_dev = getattr(self, 'smart_chase_deviation_pct', 1.0)
                        if exit_side == "sell": # Long position, SL is below entry
                            native_sl_price = self.active_pos['sl'] * (1 - (max_dev / 100))
                        else: # Short position, SL is above entry
                            native_sl_price = self.active_pos['sl'] * (1 + (max_dev / 100))
                            
                    elif sl_type == 'soft_limit':
                        # Soft limit is handled by bot, place disaster SL 1% away
                        if exit_side == "sell":
                            native_sl_price = self.active_pos['sl'] * 0.99
                        else:
                            native_sl_price = self.active_pos['sl'] * 1.01

                    if place_native_sl:
                        try:
                            # Apply tick size formatting to the price to avoid precision errors
                            native_sl_price = float(self.engine.exchange.price_to_precision(self.symbol, native_sl_price)) if hasattr(self.engine.exchange, 'price_to_precision') else native_sl_price
                            sl_params = {'reduceOnly': True, 'stopPrice': native_sl_price}
                            if sl_type in ('limit', 'stop_limit'):
                                # Native Stop-Limit — price-bounded stop order
                                sl_params['price'] = native_sl_price
                                sl_res = await self.engine.execute_trade(exit_side, base_amount, native_sl_price, order_type="STOP", params=sl_params)
                            else:
                                # market / soft_limit / smart_chase / default → stop_market (safest native fallback)
                                sl_res = await self.engine.execute_trade(exit_side, base_amount, native_sl_price, order_type="stop_market", params=sl_params)
                                
                            if sl_res and 'id' in sl_res:
                                self.active_pos['sl_order_id'] = sl_res['id']
                                self.logger.info(f"Placed Native Disaster/Stop-Loss Order {sl_res['id']} at {native_sl_price}")
                        except Exception as e:
                            self.logger.error(f"Failed to place Native Stop-Loss order: {e}")

                # --- PLACE LIMIT ORDER ---
                exit_order_type = self.sell_order_type if side == "buy" else self.buy_order_type
                if exit_order_type == 'limit':
                    exit_side = "sell" if side == "buy" else "buy"
                    tp_params = {'reduceOnly': True, 'postOnly': True}
                    limit_res = await self.engine.execute_trade(exit_side, base_amount, self.active_pos['tp'], order_type="limit", params=tp_params)
                    if limit_res and 'id' in limit_res:
                        self.active_pos['limit_order_id'] = limit_res['id']
                        self.logger.info(f"Placed Limit TP Order {limit_res['id']} at {self.active_pos['tp']}")

                self.logger.info(f"✅ Position Opened: {pos_side} | Entry {actual_entry}, SL {self.active_pos['sl']}, TP {self.active_pos['tp']}")
                self._save_state()
                self.active_pos['entry_time'] = time.time()
                trade_type = "Long" if side == "buy" else "Short"
                if side == "buy":
                    self.total_longs += 1
                else:
                    self.total_shorts += 1
                
                ml_health_str = ""
                if self.enable_ml_filter and hasattr(self, 'ml_predictor') and self.ml_predictor:
                    active = getattr(self.ml_predictor, 'last_active_features', 0)
                    total = getattr(self.ml_predictor, 'total_model_features', 0)
                    bullish = getattr(self.ml_predictor, 'bullish_threshold', 0.5) * 100
                    bearish = getattr(self.ml_predictor, 'bearish_threshold', 0.5) * 100
                    pred_score = getattr(self.ml_predictor, 'last_prediction_score', 0.0)
                    ml_health_str = f"🧠 AI Health: {active}/{total} Features Active\n📈 Bullish Threshold: {bullish:.0f}%\n📉 Bearish Threshold: {bearish:.0f}%\n🤖 AI Score: {pred_score:.4f} ({(pred_score*100):.2f}%)\n"

                asyncio.create_task(self._send_telegram(
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
                ))
                asyncio.create_task(ta_snapshot_service.send_snapshot_telegram(self, actual_entry, trade_type))
                
        except Exception as e:
            self.logger.error(f"Snipe Execution Error: {e}")

    async def manage_risk(self, current_price: float):
        """রিস্ক ম্যানেজমেন্ট (TP/SL/TSL)"""
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
                        if self.active_pos.get('side') == 'short':
                            current_price = max(current_price, last_price)
                        else:
                            current_price = min(current_price, last_price)
                except Exception as e:
                    pass

        # --- NEW: Entry Order Guard (Recovery Monitoring) ---
        entry_order_id = self.active_pos.get('entry_order_id')
        if entry_order_id and not self.is_paper_trading:
            try:
                status = await self.private_exchange.fetch_order(entry_order_id, self.symbol)
                if status and status.get('status') in ['open', 'new']:
                    # Exit early, waiting for entry fill
                    return
                elif status and status.get('status') in ['closed', 'filled']:
                    self.logger.info(f"✅ Futures Entry Order {entry_order_id} filled. Enabling risk management.")
                    self.active_pos['entry'] = status.get('average') or status.get('price') or self.active_pos['entry']
                    self.active_pos['amount'] = status.get('filled') or self.active_pos['amount']
                    self.active_pos.pop('entry_order_id', None)
                    self._save_state()
                elif status and status.get('status') in ['canceled', 'cancelled', 'expired']:
                    filled = status.get('filled', 0.0)
                    if filled > 0:
                        self.logger.info(f"⚠️ Futures Entry Order {entry_order_id} was cancelled but partially filled ({filled}).")
                        self.active_pos['amount'] = filled
                        self.active_pos.pop('entry_order_id', None)
                        self._save_state()
                    else:
                        self.logger.warning(f"🗑️ Futures Entry Order {entry_order_id} cancelled with zero fill. Discarding position state.")
                        await self._clear_state()
                        self.active_pos = None
                        return
            except Exception as e:
                logger.warning(f"⚠️ Could not verify Futures entry order {entry_order_id}: {e}")
                return
        # ----------------------------------------------------

        # --- NEW: SL Limit Order Guard (Recovery/Pending Fill Monitoring) ---
        sl_limit_order_id = self.active_pos.get('sl_limit_order_id')
        if sl_limit_order_id and not self.is_paper_trading:
            try:
                status = await self.engine.exchange.fetch_order(sl_limit_order_id, self.symbol)
                if status and status.get('status') in ['open', 'new']:
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
                            
                            exit_side = "sell" if self.active_pos.get('side', 'long') == "long" else "buy"
                            target_price = best_bid if exit_side == "buy" else best_ask
                            
                            current_order_price = float(status.get('price', 0))
                            
                            if current_order_price > 0 and target_price > 0 and current_order_price != target_price:
                                logger.info(f"🏃 Auto-Chase: Limit SL price ({current_order_price}) left behind! Cancelling to chase {target_price}")
                                try:
                                    await self.engine.cancel_order(sl_limit_order_id)
                                except Exception: pass
                                self.active_pos.pop('sl_limit_order_id', None)
                                self._save_state()
                                return # Next tick will re-assess and replace
                        except Exception as e:
                            logger.debug(f"Auto-chase check failed: {e}")
                    return # Exit early, don't execute actions yet while SL is pending on book

                elif status and status.get('status') in ['closed', 'filled']:
                    logger.info(f"✅ Strict Limit SL {sl_limit_order_id} has filled!")
                    # Treat same as standard exit
                    filled_price = status.get('average') or status.get('price') or self.active_pos['sl']
                    sell_amount = status.get('filled') or self.active_pos['amount']
                    
                    if self.active_pos.get('side', 'long') == "long":
                        pnl_val = (filled_price - self.active_pos['entry']) * sell_amount
                    else:
                        pnl_val = (self.active_pos['entry'] - filled_price) * sell_amount
                        
                    self.total_realized_pnl += pnl_val
                    self.total_executed_orders += 1
                    if pnl_val > 0:
                        self.total_wins += 1
                    else:
                        self.total_losses += 1
                    
                    await self._send_exit_telegram("🛡️ Futures EXIT - Stopped out via Limit Maker!", filled_price, pnl_val)
                    await self._clear_state()
                    self.active_pos = None
                    return
                elif status and status.get('status') in ['canceled', 'cancelled', 'expired', 'rejected']:
                    filled = status.get('filled', 0.0)
                    if filled > 0:
                        logger.info(f"⚠️ Limit SL Order completely broken but partial fill ({filled}). Discarding position state to sync.")
                    else:
                        logger.warning(f"🗑️ Limit SL Order {sl_limit_order_id} was {status.get('status')}. You may need to manual exit.")
                    await self._clear_state()
                    self.active_pos = None
                    return
            except Exception as e:
                logger.warning(f"⚠️ Could not verify SL Limit order {sl_limit_order_id}: {e}")
                return
        # -----------------------------------------------------------------

        # BUG FIX: Use .get() with a safe default to prevent KeyError on recovered/adopted positions
        side = self.active_pos.get('side', 'long')
        if side not in ('long', 'short'):
            self.logger.warning(f"⚠️ [manage_risk] Unknown side '{side}' in active_pos. Defaulting to 'long'.")
            side = 'long'
        exit_order_type = self.sell_order_type if side == "long" else self.buy_order_type



        # --- NEW: Supertrend Maker-to-Taker Fallback Dual-Exit ---
        supertrend_reversal = False
        if getattr(self, 'enable_supertrend_exit', False) and getattr(self, 'supertrend_tracker', None):
            # Check for reversal based on mode. Reversal to opposite direction means exit.
            if side == "long":
                if self.supertrend_tracker.is_entry_signal('sell'):
                    supertrend_reversal = True
            else:
                if self.supertrend_tracker.is_entry_signal('buy'):
                    supertrend_reversal = True
                    
        if supertrend_reversal and not self.active_pos.get('fallback_exit_in_progress'):
            self.logger.warning(f"🚨 Supertrend Reversal Detected! Triggering Maker-to-Taker Exit.")
            self.active_pos['fallback_exit_in_progress'] = True
            self._save_state()
            asyncio.create_task(self._execute_fallback_exit(current_price))
            return
        # ---------------------------------------------------------

        # 1. Check if the limit TP order has already been filled by the exchange
        if exit_order_type == 'limit' and self.active_pos.get('limit_order_id') and not self.is_paper_trading:
            try:
                order_status = await self.private_exchange.fetch_order(self.active_pos['limit_order_id'], self.symbol)
                if order_status and order_status.get('status') == 'closed':
                    filled_price = order_status.get('average') or order_status.get('price') or self.active_pos['tp']
                    executed_amount = order_status.get('filled') or self.active_pos.get('amount')
                    
                    if side == "long":
                        pnl_val = (filled_price - self.active_pos['entry']) * executed_amount
                    else:
                        pnl_val = (self.active_pos['entry'] - filled_price) * executed_amount
                        
                    self.total_realized_pnl += pnl_val
                    self.total_executed_orders += 1
                    if pnl_val > 0:
                        self.total_wins += 1
                    else:
                        self.total_losses += 1
                        
                    await self._send_exit_telegram("🎯 Futures EXIT - Limit TP Filled!", filled_price, pnl_val)
                    self.logger.info(f"✅ Limit TP Order {self.active_pos['limit_order_id']} was filled by exchange at {filled_price}")
                    
                    # CANCEL DANGLING NATIVE SL
                    if self.active_pos.get('sl_order_id'):
                        try:
                            await self.engine.cancel_order(self.active_pos['sl_order_id'])
                            self.logger.info(f"🧹 Cleaned up hanging Native SL Order {self.active_pos['sl_order_id']} after TP Fill.")
                        except Exception as e:
                            self.logger.warning(f"Failed to clean up Native SL Order: {e}")
                            
                    await self._clear_state()
                    self.active_pos = None
                    return
            except Exception as e:
                logger.warning(f"Error checking limit order status: {e}")

        # Trailing Stop Update
        state_changed = False
        if side == "long":
            if current_price > self.extreme_price:
                self.extreme_price = current_price
                
                # Check TSL Activation
                activation_pct = getattr(self, 'tsl_activation_pct', 0.0)
                if activation_pct > 0 and not self.active_pos.get('tsl_activated'):
                    trigger = self.active_pos['entry'] * (1 + (activation_pct / 100))
                    if current_price >= trigger:
                        self.active_pos['tsl_activated'] = True
                        self.logger.info(f"🚀 Trailing SL Activated for LONG at {current_price:.6f}!")
                
                if activation_pct == 0.0 or self.active_pos.get('tsl_activated'):
                    old_sl = self.active_pos['sl']
                    if getattr(self, 'enable_ut_trailing_sl', False) and getattr(self, 'ut_bot_tracker', None):
                        ut_sl = self.ut_bot_tracker.get_dynamic_trailing_sl("long")
                        if ut_sl > 0:
                            self.active_pos['sl'] = max(self.active_pos['sl'], ut_sl)
                    elif getattr(self, 'enable_supertrend_trailing_sl', False) and getattr(self, 'supertrend_tracker', None):
                        st_sl = self.supertrend_tracker.get_dynamic_trailing_sl("long")
                        if st_sl > 0:
                            self.active_pos['sl'] = max(self.active_pos['sl'], st_sl)
                    elif self.atr_sl_enabled and getattr(self, 'current_atr', 0) > 0:
                        atr_sl = self.extreme_price - (self.current_atr * self.atr_multiplier)
                        if getattr(self, 'tsl_pct', 0.0) > 0:
                            new_sl = self.extreme_price * (1 - (self.tsl_pct / 100))
                            new_sl = max(new_sl, atr_sl)
                        else:
                            new_sl = atr_sl
                        self.active_pos['sl'] = max(self.active_pos['sl'], new_sl)
                    elif getattr(self, 'tsl_pct', 0.0) > 0:
                        new_sl = self.extreme_price * (1 - (self.tsl_pct / 100))
                        self.active_pos['sl'] = max(self.active_pos['sl'], new_sl)
                        
                    # Update Exchange Native SL if moved by at least 0.2%
                    if self.active_pos['sl'] > old_sl and self.active_pos.get('sl_order_id'):
                        pct_change = ((self.active_pos['sl'] - old_sl) / old_sl * 100) if old_sl > 0 else 100.0
                        if pct_change >= 0.2:
                            state_changed = True
                            try:
                                await self.engine.cancel_order(self.active_pos['sl_order_id'])
                                _tsl_sl_type = getattr(self, 'sl_order_type', 'market')
                                _tsl_order_type = "STOP" if _tsl_sl_type in ('limit', 'stop_limit') else "stop_market"
                                
                                native_sl_price = self.active_pos['sl']
                                if _tsl_sl_type == 'smart_chase':
                                    max_dev = getattr(self, 'smart_chase_deviation_pct', 1.0)
                                    native_sl_price = native_sl_price * (1 - (max_dev / 100))
                                elif _tsl_sl_type == 'soft_limit':
                                    native_sl_price = native_sl_price * 0.99
                                    
                                native_sl_price = float(self.engine.exchange.price_to_precision(self.symbol, native_sl_price)) if hasattr(self.engine.exchange, 'price_to_precision') else native_sl_price
                                
                                sl_params = {'reduceOnly': True, 'stopPrice': native_sl_price}
                                if _tsl_sl_type in ('limit', 'stop_limit'):
                                    sl_params['price'] = native_sl_price
                                sl_res = await self.engine.execute_trade("sell", self.active_pos['amount'], native_sl_price, order_type=_tsl_order_type, params=sl_params)
                                if sl_res and 'id' in sl_res:
                                    self.active_pos['sl_order_id'] = sl_res['id']
                                    logger.info(f"🔄 Native TSL Exchange Update: LONG SL moved to {self.active_pos['sl']:.6f} (Native Trigger: {native_sl_price:.6f})")
                            except Exception as e: pass
        else: # short
            if current_price < self.extreme_price or self.extreme_price == 0:
                self.extreme_price = current_price
                
                # Check TSL Activation
                activation_pct = getattr(self, 'tsl_activation_pct', 0.0)
                if activation_pct > 0 and not self.active_pos.get('tsl_activated'):
                    trigger = self.active_pos['entry'] * (1 - (activation_pct / 100))
                    if current_price <= trigger:
                        self.active_pos['tsl_activated'] = True
                        logger.info(f"🚀 Trailing SL Activated for SHORT at {current_price:.6f}!")
                
                if activation_pct == 0.0 or self.active_pos.get('tsl_activated'):
                    old_sl = self.active_pos['sl']
                    if getattr(self, 'enable_ut_trailing_sl', False) and getattr(self, 'ut_bot_tracker', None):
                        ut_sl = self.ut_bot_tracker.get_dynamic_trailing_sl("short")
                        if ut_sl > 0:
                            self.active_pos['sl'] = min(self.active_pos['sl'], ut_sl)
                    elif getattr(self, 'enable_supertrend_trailing_sl', False) and getattr(self, 'supertrend_tracker', None):
                        st_sl = self.supertrend_tracker.get_dynamic_trailing_sl("short")
                        if st_sl > 0:
                            self.active_pos['sl'] = min(self.active_pos['sl'], st_sl)
                    elif self.atr_sl_enabled and getattr(self, 'current_atr', 0) > 0:
                        atr_sl = self.extreme_price + (self.current_atr * self.atr_multiplier)
                        if getattr(self, 'tsl_pct', 0.0) > 0:
                            new_sl = self.extreme_price * (1 + (self.tsl_pct / 100))
                            new_sl = min(new_sl, atr_sl)
                        else:
                            new_sl = atr_sl
                        self.active_pos['sl'] = min(self.active_pos['sl'], new_sl)
                    elif getattr(self, 'tsl_pct', 0.0) > 0:
                        new_sl = self.extreme_price * (1 + (self.tsl_pct / 100))
                        self.active_pos['sl'] = min(self.active_pos['sl'], new_sl)
                        
                    # Update Exchange Native SL if moved by at least 0.2%
                    if self.active_pos['sl'] < old_sl and self.active_pos.get('sl_order_id'):
                        pct_change = ((old_sl - self.active_pos['sl']) / old_sl * 100) if old_sl > 0 else 100.0
                        if pct_change >= 0.2:
                            state_changed = True
                            try:
                                await self.engine.cancel_order(self.active_pos['sl_order_id'])
                                _tsl_sl_type = getattr(self, 'sl_order_type', 'market')
                                _tsl_order_type = "STOP" if _tsl_sl_type in ('limit', 'stop_limit') else "stop_market"
                                
                                native_sl_price = self.active_pos['sl']
                                if _tsl_sl_type == 'smart_chase':
                                    max_dev = getattr(self, 'smart_chase_deviation_pct', 1.0)
                                    native_sl_price = native_sl_price * (1 + (max_dev / 100))
                                elif _tsl_sl_type == 'soft_limit':
                                    native_sl_price = native_sl_price * 1.01
                                    
                                native_sl_price = float(self.engine.exchange.price_to_precision(self.symbol, native_sl_price)) if hasattr(self.engine.exchange, 'price_to_precision') else native_sl_price
                                
                                sl_params = {'reduceOnly': True, 'stopPrice': native_sl_price}
                                if _tsl_sl_type in ('limit', 'stop_limit'):
                                    sl_params['price'] = native_sl_price
                                sl_res = await self.engine.execute_trade("buy", self.active_pos['amount'], native_sl_price, order_type=_tsl_order_type, params=sl_params)
                                if sl_res and 'id' in sl_res:
                                    self.active_pos['sl_order_id'] = sl_res['id']
                                    logger.info(f"🔄 Native TSL Exchange Update: SHORT SL moved to {self.active_pos['sl']:.6f} (Native Trigger: {native_sl_price:.6f})")
                            except Exception as e: pass

        # --- NEW: Independent Breakeven SL Logic ---
        if not self.active_pos: return
        if getattr(self, 'sl_breakeven_trigger_pct', 0.0) > 0 and not self.active_pos.get('breakeven_hit'):
            entry = self.active_pos['entry']
            if side == "long":
                trigger_price = entry * (1 + (self.sl_breakeven_trigger_pct / 100))
                if current_price >= trigger_price:
                    new_breakeven_sl = entry * (1 + (self.sl_breakeven_target_pct / 100))
                    if new_breakeven_sl > self.active_pos['sl']:
                        self.active_pos['sl'] = new_breakeven_sl
                        self.active_pos['breakeven_hit'] = True
                        logger.info(f"🛡️ Set LONG SL to Risk-Free Breakeven at {new_breakeven_sl:.6f}")
                        
                        # UPDATE NATIVE SL ORDER
                        if self.active_pos.get('sl_order_id'):
                            try:
                                await self.engine.cancel_order(self.active_pos['sl_order_id'])
                                _be_sl_type = getattr(self, 'sl_order_type', 'market')
                                _be_order_type = "STOP" if _be_sl_type in ('limit', 'stop_limit') else "stop_market"
                                
                                native_sl_price = new_breakeven_sl
                                if _be_sl_type == 'smart_chase':
                                    max_dev = getattr(self, 'smart_chase_deviation_pct', 1.0)
                                    native_sl_price = native_sl_price * (1 - (max_dev / 100))
                                elif _be_sl_type == 'soft_limit':
                                    native_sl_price = native_sl_price * 0.99
                                    
                                native_sl_price = float(self.engine.exchange.price_to_precision(self.symbol, native_sl_price)) if hasattr(self.engine.exchange, 'price_to_precision') else native_sl_price
                                
                                sl_params = {'reduceOnly': True, 'stopPrice': native_sl_price}
                                if _be_sl_type in ('limit', 'stop_limit'):
                                    sl_params['price'] = native_sl_price
                                sl_res = await self.engine.execute_trade("sell", self.active_pos['amount'], native_sl_price, order_type=_be_order_type, params=sl_params)
                                if sl_res and 'id' in sl_res:
                                    self.active_pos['sl_order_id'] = sl_res['id']
                            except Exception as e: pass
                            
                        asyncio.create_task(self._send_telegram(f"🛡️ Stop-Loss moved to Risk-Free!\nPair: {self.symbol}\nNew SL: {new_breakeven_sl:.6f}"))
            else: # short
                trigger_price = entry * (1 - (self.sl_breakeven_trigger_pct / 100))
                if current_price <= trigger_price:
                    new_breakeven_sl = entry * (1 - (self.sl_breakeven_target_pct / 100))
                    if new_breakeven_sl < self.active_pos['sl']:
                        self.active_pos['sl'] = new_breakeven_sl
                        self.active_pos['breakeven_hit'] = True
                        logger.info(f"🛡️ Set SHORT SL to Risk-Free Breakeven at {new_breakeven_sl:.6f}")
                        
                        # UPDATE NATIVE SL ORDER
                        if self.active_pos.get('sl_order_id'):
                            try:
                                await self.engine.cancel_order(self.active_pos['sl_order_id'])
                                _be_sl_type = getattr(self, 'sl_order_type', 'market')
                                _be_order_type = "STOP" if _be_sl_type in ('limit', 'stop_limit') else "stop_market"
                                
                                native_sl_price = new_breakeven_sl
                                if _be_sl_type == 'smart_chase':
                                    max_dev = getattr(self, 'smart_chase_deviation_pct', 1.0)
                                    native_sl_price = native_sl_price * (1 + (max_dev / 100))
                                elif _be_sl_type == 'soft_limit':
                                    native_sl_price = native_sl_price * 1.01
                                    
                                native_sl_price = float(self.engine.exchange.price_to_precision(self.symbol, native_sl_price)) if hasattr(self.engine.exchange, 'price_to_precision') else native_sl_price
                                
                                sl_params = {'reduceOnly': True, 'stopPrice': native_sl_price}
                                if _be_sl_type in ('limit', 'stop_limit'):
                                    sl_params['price'] = native_sl_price
                                sl_res = await self.engine.execute_trade("buy", self.active_pos['amount'], native_sl_price, order_type=_be_order_type, params=sl_params)
                                if sl_res and 'id' in sl_res:
                                    self.active_pos['sl_order_id'] = sl_res['id']
                            except Exception as e: pass
                            
                        asyncio.create_task(self._send_telegram(f"🛡️ Stop-Loss moved to Risk-Free!\nPair: {self.symbol}\nNew SL: {new_breakeven_sl:.6f}"))

        # --- NEW: Advanced Risk Manager (Global TP & Break-Even) ---
        if not self.active_pos: return
        if hasattr(self, 'advanced_risk_manager') and self.advanced_risk_manager:
            entry = self.active_pos['entry']
            amount = self.active_pos['amount']
            if side == "long":
                current_pnl_usd = (current_price - entry) * amount
                current_pnl_pct = ((current_price - entry) / entry) * 100
            else:
                current_pnl_usd = (entry - current_price) * amount
                current_pnl_pct = ((entry - current_price) / entry) * 100
                
            risk_res = self.advanced_risk_manager.update_pnl(current_pnl_pct, current_pnl_usd)
            if risk_res["action"] in ["stop_bot", "pause_bot"]:
                should_exit = True
                reason = risk_res["reason"]
                
                # Stop Bot flag logic
                if risk_res["action"] == "stop_bot":
                    self.logger.warning(f"🛑 [Advanced Risk] Global TP hit! Stopping bot. Reason: {reason}")
                    asyncio.create_task(self._send_telegram(f"🛑 *Bot Stopped by Risk Manager*\nReason: {reason}\nPair: {self.symbol}"))
                    try:
                        from app.services.bot_manager import bot_manager
                        asyncio.create_task(bot_manager.stop_bot(str(self.bot_id), str(self.owner_id)))
                    except Exception as e:
                        self.logger.error(f"Failed to auto-stop via bot_manager: {e}")
                
                # Proceed to exit immediately
                if should_exit:
                    logger.info(f"🚩 Exiting {side.upper()} Position: {reason} at {current_price}")
                    # Force exit logic will be handled below.
                    
        # TP / SL চেক
        if not self.active_pos: return
        should_exit = should_exit if 'should_exit' in locals() else False
        reason = reason if 'reason' in locals() else ""
        
        if side == "long":
            # Scale-Out (Partial TP1)
            if self.partial_tp_pct > 0 and not self.active_pos.get('tp1_hit') and current_price >= self.active_pos['tp1']:
                await self.execute_partial_close(current_price)
                return

            if current_price >= self.active_pos['tp']:
                if exit_order_type == 'limit' and self.active_pos.get('limit_order_id') and not self.is_paper_trading:
                    pass # Exchange will natively fill the limit order
                else:
                    should_exit = True
                    reason = "Take Profit"
            elif current_price <= self.active_pos['sl']:
                should_exit = True
                reason = "Stop Loss"
        else: # short
            # Scale-Out (Partial TP1)
            if self.partial_tp_pct > 0 and not self.active_pos.get('tp1_hit') and current_price <= self.active_pos['tp1']:
                await self.execute_partial_close(current_price)
                return

            if current_price <= self.active_pos['tp']:
                if exit_order_type == 'limit' and self.active_pos.get('limit_order_id') and not self.is_paper_trading:
                    pass # Exchange will natively fill the limit order
                else:
                    should_exit = True
                    reason = "Take Profit"
            elif current_price >= self.active_pos['sl']:
                should_exit = True
                reason = "Stop Loss"

        if should_exit:
            logger.info(f"🚩 Exiting {side.upper()} Position: {reason} at {current_price}")
            
            sell_amount_raw = self.active_pos['amount']
            
            # Cancel open limit order if SL/TSL hits
            if exit_order_type == 'limit' and self.active_pos.get('limit_order_id'):
                canceled = False
                for attempt in range(5):
                    try:
                        logger.info(f"Attempting to cancel Limit TP Order {self.active_pos['limit_order_id']} before explicit Futures exit (Attempt {attempt+1}/5)")
                        cancel_success = await self.engine.cancel_order(self.active_pos['limit_order_id'])
                        if cancel_success:
                            canceled = True
                            break
                        else:
                            try:
                                status = await self.engine.exchange.fetch_order(self.active_pos['limit_order_id'], self.symbol)
                                if status and status.get('status') in ['canceled', 'cancelled', 'closed']:
                                    logger.info("Order check: Order is already closed or cancelled.")
                                    canceled = True
                                    break
                            except Exception: pass
                    except Exception as e:
                        err_str = str(e).lower()
                        if "-2011" in err_str or "unknown order" in err_str or "ordernotfound" in err_str:
                            logger.info("Order check: Order is already closed or cancelled (Unknown Order).")
                            canceled = True
                            break
                        logger.warning(f"Failed to cancel Limit TP Order on attempt {attempt+1}: {e}")
                    await asyncio.sleep(0.5)

                if canceled:
                    try:
                        logger.info("Successfully cancelled Limit TP Order due to Stop Loss hit/Emergency Sell.")
                        await asyncio.sleep(0.5)
                        
                        if not self.is_paper_trading:
                            cancelled_status = await self.engine.exchange.fetch_order(self.active_pos['limit_order_id'], self.symbol)
                            filled = cancelled_status.get('filled', 0.0)
                            if filled > 0:
                                logger.info(f"🔄 Open Limit Order was partially filled ({filled}). Adjusting Exit sweep amount.")
                                filled_proper = float(self.engine.exchange.amount_to_precision(self.symbol, filled)) if hasattr(self.engine.exchange, 'amount_to_precision') else filled
                                sell_amount_raw = max(0.0, self.active_pos['amount'] - filled_proper)
                                
                                if sell_amount_raw <= 0:
                                    logger.info("✅ Partial fill actually completely closed out the remaining position. Exit sweep aborted.")
                                    await self._send_telegram(f"🏁 *{side.upper()} Closed* via Partial Fill Sweep\nPair: {self.symbol}")
                                    await self._clear_state()
                                    self.active_pos = None
                                    return
                    except Exception as e:
                        logger.error(f"Error fetching filled status of cancelled limit order: {e}")
                else:
                    logger.error("🚨 CRITICAL: Could not cancel Limit TP order after 5 attempts! Order remains locked on exchange.")
                    logger.warning("Emergency Action: Aborting Futures Market exit sweep. Will retry in the next loop.")
                    return

            # Cancel open Native SL order if SL/TSL hits manually
            native_sl_already_filled = False
            if self.active_pos.get('sl_order_id'):
                try:
                    if hasattr(self.engine, 'cancel_order_with_status'):
                        success, status = await self.engine.cancel_order_with_status(self.active_pos['sl_order_id'])
                        if status == "already_filled":
                            native_sl_already_filled = True
                    else:
                        await self.engine.cancel_order(self.active_pos['sl_order_id'])
                    logger.info("Successfully cancelled Native SL Order.")
                except Exception as e:
                    pass

            if native_sl_already_filled:
                # --- DOUBLE VERIFICATION: Did it actually fill or was it manually cancelled? ---
                if not self.is_paper_trading:
                    try:
                        positions = await self.private_exchange.fetch_positions([self.symbol])
                        has_pos = False
                        for p in positions:
                            if p.get('symbol') == self.symbol or self._normalize_symbol(p.get('symbol')) == self._normalize_symbol(self.symbol):
                                if float(p.get('contracts', 0) or 0) > 0:
                                    has_pos = True
                                    break
                        if has_pos:
                            logger.warning("🚨 WARNING: Native SL returned 'Unknown Order' but position is STILL OPEN! (Likely manually cancelled). Proceeding with bot exit routing.")
                            native_sl_already_filled = False
                    except Exception as e:
                        logger.error(f"Error verifying position for Native SL fill: {e}")
                        # In case of API failure, it's safer to attempt the exit routing which uses reduceOnly anyway
                        native_sl_already_filled = False

            if native_sl_already_filled:
                logger.info("✅ Native SL already filled/closed natively! Skipping bot exit routing.")
                assumed_exit = self.active_pos['sl'] if reason == "Stop Loss" else self.active_pos['tp']
                amount = self.active_pos['amount']
                if self.active_pos.get('side', 'long') == "long":
                    pnl_val = (assumed_exit - self.active_pos['entry']) * amount
                else:
                    pnl_val = (self.active_pos['entry'] - assumed_exit) * amount
                self.total_realized_pnl += pnl_val
                self.total_executed_orders += 1
                if pnl_val > 0:
                    self.total_wins += 1
                else:
                    self.total_losses += 1
                await self._send_telegram(f"🏁 *{side.upper()} Closed Natively* ({reason})\nPair: {self.symbol}\n💰 Trade PnL: ${pnl_val:.2f}\n\n📊 Net PnL: ${self.total_realized_pnl:.2f}\n🏆 Wins: {self.total_wins} | 💔 Losses: {self.total_losses}")
                await self._clear_state()
                self.active_pos = None
                return
            
            # ফিউচার ক্লোজের জন্য বিপরীত অর্ডার
            exit_side = "sell" if side == "long" else "buy"
            
            exit_order_type_actual = exit_order_type
            if exit_order_type_actual == "marketable_limit":
                exit_order_type_actual = "market"

            # TP/SL/TSL are always market-type execution unless explicit limit
            
            # --- NEW: Advanced SL Execution Routing ---
            res = None
            if reason == "Stop Loss":
                sl_exec_type = getattr(self, 'sl_order_type', 'market')
                
                if sl_exec_type == 'market':
                    res = await self.engine.execute_trade(exit_side, sell_amount_raw, current_price, order_type="market", params={'reduceOnly': True})
                elif sl_exec_type == 'limit':
                    try:
                        from app.services.market_depth_service import market_depth_service
                        limit_size = market_depth_service._normalize_order_book_limit(self.exchange_id, 5) if hasattr(market_depth_service, '_normalize_order_book_limit') else 5
                        ob = await self.public_exchange.fetch_order_book(self.symbol, limit=limit_size)
                        best_bid = ob['bids'][0][0] if ob['bids'] else current_price
                        best_ask = ob['asks'][0][0] if ob['asks'] else current_price
                    except Exception as e:
                        logger.warning(f"Could not fetch precise order book for Limit SL, falling back: {e}")
                        best_bid = current_price
                        best_ask = current_price
                        
                    target_maker_price = best_bid if exit_side == "buy" else best_ask
                    
                    logger.info(f"🛡️ Executing Futures SL with STRICT Limit (Maker) targeting exactly {target_maker_price}")
                    limit_sl_res = await self.engine.execute_trade(exit_side, sell_amount_raw, target_maker_price, order_type="limit", params={'reduceOnly': True, 'postOnly': True})
                    if limit_sl_res and limit_sl_res.get('id'):
                        self.active_pos['sl_limit_order_id'] = limit_sl_res.get('id')
                        if self.is_paper_trading:
                            res = limit_sl_res
                    else:
                        logger.debug("SL Limit Maker order rejected by exchange! Will auto-retry on next tick.")
                elif sl_exec_type == 'soft_limit':
                    logger.info(f"🛡️ Executing Futures SL with Soft Limit Maker at {current_price}")
                    limit_sl_res = await self.engine.execute_trade(exit_side, sell_amount_raw, current_price, order_type="limit", params={'reduceOnly': True, 'postOnly': True})
                    if limit_sl_res and limit_sl_res.get('id'):
                        if self.is_paper_trading:
                            res = limit_sl_res
                        else:
                            logger.info(f"⏳ Waiting 3 seconds for Soft Limit SL {limit_sl_res['id']} to fill...")
                            for _ in range(8):
                                await asyncio.sleep(0.4)
                                try:
                                    check = await self.engine.exchange.fetch_order(limit_sl_res['id'], self.symbol)
                                    if check and check.get('status') != 'open': break
                                except Exception: pass
                            
                            final_check = await self.engine.exchange.fetch_order(limit_sl_res['id'], self.symbol)
                            if final_check and final_check.get('status') == 'open':
                                logger.warning("Futures Soft Limit SL did not fill in time! Fallback to Market.")
                                await self.engine.cancel_order(limit_sl_res['id'])
                                await asyncio.sleep(0.5)
                                
                                cancelled_check = await self.engine.exchange.fetch_order(limit_sl_res['id'], self.symbol)
                                rem_filled = cancelled_check.get('filled', 0.0)
                                rem_amount_raw = sell_amount_raw - rem_filled
                                if rem_amount_raw > 0:
                                    sweep_amt = float(self.engine.exchange.amount_to_precision(self.symbol, rem_amount_raw)) if hasattr(self.engine.exchange, 'amount_to_precision') else rem_amount_raw
                                    res = await self.engine.execute_trade(exit_side, sweep_amt, current_price, order_type="market", params={'reduceOnly': True})
                            else:
                                res = final_check
                    else:
                        logger.warning("Soft Limit placement failed. Fallback to Market.")
                        res = await self.engine.execute_trade(exit_side, sell_amount_raw, current_price, order_type="market", params={'reduceOnly': True})
                elif sl_exec_type == 'stop_limit':
                    slip_pct = 0.001
                    bounded_price = current_price * (1 - slip_pct) if exit_side == "sell" else current_price * (1 + slip_pct)
                    logger.info(f"🛡️ Executing Futures SL with Stop-Limit Slippage Bound constraint. Target: {bounded_price}")
                    res = await self.engine.execute_trade(exit_side, sell_amount_raw, bounded_price, order_type="limit", params={'reduceOnly': True})
                    if not res or not res.get('id'):
                        res = await self.engine.execute_trade(exit_side, sell_amount_raw, current_price, order_type="market", params={'reduceOnly': True})
                        
                elif sl_exec_type == 'smart_chase':
                    res = await execute_smart_chase(
                        engine=self.engine,
                        public_exchange=self.public_exchange,
                        symbol=self.symbol,
                        exit_side=exit_side,
                        sell_amount_raw=sell_amount_raw,
                        current_price=current_price,
                        original_sl=self.active_pos['sl'],
                        max_deviation_pct=getattr(self, 'smart_chase_deviation_pct', 1.0),
                        chase_delay_ms=getattr(self, 'smart_chase_delay_ms', 1500),
                        max_attempts=getattr(self, 'smart_chase_max_attempts', 15),
                        exchange_id=self.exchange_id,
                        is_futures=True,
                        is_paper_trading=self.is_paper_trading
                    )

                if sl_exec_type in ('limit', 'smart_chase') and not res:
                    if self.active_pos.get('sl_limit_order_id'):
                        logger.info("Futures Strict Limit SL order placed. Ending loop tick to wait.")
                        self._save_state()
                        return
                    else:
                        if not self.is_paper_trading:
                            try:
                                positions = await self.private_exchange.fetch_positions([self.symbol])
                                has_pos = False
                                for p in positions:
                                    if p.get('symbol') == self.symbol or self._normalize_symbol(p.get('symbol')) == self._normalize_symbol(self.symbol):
                                        if float(p.get('contracts', 0) or 0) > 0:
                                            has_pos = True
                                            break
                                if not has_pos:
                                    logger.info("✅ Position already closed natively (e.g. Native SL hit). Exiting loop.")
                                    assumed_exit = self.active_pos['sl'] if reason == "Stop Loss" else self.active_pos['tp']
                                    amount = self.active_pos['amount']
                                    if self.active_pos.get('side', 'long') == "long":
                                        pnl_val = (assumed_exit - self.active_pos['entry']) * amount
                                    else:
                                        pnl_val = (self.active_pos['entry'] - assumed_exit) * amount
                                    self.total_realized_pnl += pnl_val
                                    self.total_executed_orders += 1
                                    if pnl_val > 0:
                                        self.total_wins += 1
                                    else:
                                        self.total_losses += 1
                                    await self._clear_state()
                                    self.active_pos = None
                                    return
                            except Exception as e:
                                logger.error(f"Error checking position: {e}")
                        self._save_state()
                        return
            else:
                # ── Soft Limit TP Exit ────────────────────────────────────────────────
                # For Take Profit exits where exit_order_type == 'limit':
                #   Instead of converting limit → market (always Taker), we use a
                #   time-bounded Maker approach:
                #     1. Place postOnly limit at best ask/bid (safe maker price)
                #     2. Poll for fill up to `tp_soft_limit_timeout` seconds
                #     3. If filled → Maker fee ✅
                #     4. If NOT filled → cancel + market sweep → Taker fee (guaranteed exit)
                # For all other exit_order_type values (market, marketable_limit): direct market.
                # ─────────────────────────────────────────────────────────────────────
                if reason == "Take Profit" and exit_order_type_actual == "limit" and not self.is_paper_trading:
                    try:
                        # Fetch live best bid/ask for a safe postOnly maker price
                        ob = await self.public_exchange.fetch_order_book(self.symbol, limit=5)
                        best_bid_tp = ob['bids'][0][0] if ob.get('bids') else current_price
                        best_ask_tp = ob['asks'][0][0] if ob.get('asks') else current_price

                        # Maker price: SELL (long exit) → sit at ask+1tick; BUY (short exit) → bid-1tick
                        tick_tp = 0.0
                        try:
                            mkt_tp = self.public_exchange.markets.get(self.symbol, {})
                            p_tp = mkt_tp.get('precision', {}).get('price')
                            if p_tp and float(p_tp) > 0:
                                tick_tp = float(p_tp)
                        except Exception:
                            pass
                        if not tick_tp:
                            tick_tp = round(best_bid_tp * 1e-5, 10)

                        if exit_side == "sell":
                            soft_tp_price = best_ask_tp + tick_tp  # above bid → rests on book
                        else:
                            soft_tp_price = best_bid_tp - tick_tp  # below ask → rests on book

                        if hasattr(self.public_exchange, 'price_to_precision'):
                            soft_tp_price = float(self.public_exchange.price_to_precision(self.symbol, soft_tp_price))

                        logger.info(
                            f"🎯 [Soft Limit TP] Placing postOnly {exit_side.upper()} at {soft_tp_price} "
                            f"(bid={best_bid_tp}, ask={best_ask_tp}). Aiming for Maker fee..."
                        )
                        soft_tp_res = await self.engine.execute_trade(
                            exit_side, sell_amount_raw, soft_tp_price,
                            order_type="limit",
                            params={'reduceOnly': True, 'postOnly': True}
                        )

                        if soft_tp_res and soft_tp_res.get('id'):
                            soft_tp_id = soft_tp_res['id']
                            timeout_secs = getattr(self, 'tp_soft_limit_timeout', 4)
                            polls = int(timeout_secs / 0.5)
                            logger.info(f"⏳ [Soft Limit TP] Polling {soft_tp_id} for {timeout_secs}s...")

                            for _ in range(polls):
                                await asyncio.sleep(0.5)
                                try:
                                    chk = await self.engine.exchange.fetch_order(soft_tp_id, self.symbol)
                                    if chk and chk.get('status') not in ['open', 'new']:
                                        break
                                except Exception:
                                    pass

                            final_chk = await self.engine.exchange.fetch_order(soft_tp_id, self.symbol)
                            if final_chk and final_chk.get('status') in ['closed', 'filled']:
                                logger.info("✅ [Soft Limit TP] Maker order filled! Paying Maker fee.")
                                res = final_chk
                            else:
                                # Timeout — cancel and sweep at market
                                logger.warning(
                                    f"⚠️ [Soft Limit TP] {soft_tp_id} did not fill in {timeout_secs}s. "
                                    f"Cancelling and sweeping at Market (Taker)..."
                                )
                                try:
                                    await self.engine.cancel_order(soft_tp_id)
                                    await asyncio.sleep(0.3)
                                    cancel_chk = await self.engine.exchange.fetch_order(soft_tp_id, self.symbol)
                                    already_filled = cancel_chk.get('filled', 0.0)
                                    rem_amount = max(0.0, sell_amount_raw - already_filled)
                                    if rem_amount > 0:
                                        sweep_amt = float(self.engine.exchange.amount_to_precision(self.symbol, rem_amount)) if hasattr(self.engine.exchange, 'amount_to_precision') else rem_amount
                                        res = await self.engine.execute_trade(
                                            exit_side, sweep_amt, current_price,
                                            order_type="market",
                                            params={'reduceOnly': True}
                                        )
                                        logger.info("✅ [Soft Limit TP] Market sweep completed (Taker fallback).")
                                    else:
                                        res = cancel_chk  # partial fill already closed it
                                        logger.info("✅ [Soft Limit TP] Partial fill during cancel swept remaining position.")
                                except Exception as sweep_e:
                                    logger.error(f"[Soft Limit TP] Sweep failed: {sweep_e}. Forcing market exit.")
                                    res = await self.engine.execute_trade(
                                        exit_side, sell_amount_raw, current_price,
                                        order_type="market",
                                        params={'reduceOnly': True}
                                    )
                        else:
                            # postOnly placement failed (e.g. -5022 already retried) → market
                            logger.warning("[Soft Limit TP] postOnly placement failed. Falling back to Market.")
                            res = await self.engine.execute_trade(
                                exit_side, sell_amount_raw, current_price,
                                order_type="market",
                                params={'reduceOnly': True}
                            )
                    except Exception as soft_tp_e:
                        logger.error(f"[Soft Limit TP] Exception: {soft_tp_e}. Falling back to Market.")
                        res = await self.engine.execute_trade(
                            exit_side, sell_amount_raw, current_price,
                            order_type="market",
                            params={'reduceOnly': True}
                        )
                else:
                    # market / marketable_limit / paper trading — direct execution
                    actual_type = exit_order_type_actual if exit_order_type_actual != "limit" else "market"
                    res = await self.engine.execute_trade(exit_side, sell_amount_raw, current_price, order_type=actual_type, params={'reduceOnly': True})
            
            if not res and not self.is_paper_trading:
                logger.warning("Exit order execution failed or returned empty. Verifying position state with exchange...")
                try:
                    positions = await self.private_exchange.fetch_positions([self.symbol])
                    has_pos = False
                    for p in positions:
                        if p.get('symbol') == self.symbol or self._normalize_symbol(p.get('symbol')) == self._normalize_symbol(self.symbol):
                            if float(p.get('contracts', 0) or 0) > 0:
                                has_pos = True
                                break
                    if not has_pos:
                        logger.info("✅ Position already closed natively. Exiting loop.")
                        assumed_exit = self.active_pos['sl'] if reason == "Stop Loss" else self.active_pos['tp']
                        amount = self.active_pos['amount']
                        if self.active_pos.get('side', 'long') == "long":
                            pnl_val = (assumed_exit - self.active_pos['entry']) * amount
                        else:
                            pnl_val = (self.active_pos['entry'] - assumed_exit) * amount
                        self.total_realized_pnl += pnl_val
                        self.total_executed_orders += 1
                        if pnl_val > 0:
                            self.total_wins += 1
                        else:
                            self.total_losses += 1
                        await self._clear_state()
                        self.active_pos = None
                        return
                except Exception as e:
                    logger.error(f"Error checking position after exit failure: {e}")
                self._save_state()
                return

            # --- NEW: Partial Fill Management for Active Exits ---
            if res and res.get('id') and not self.is_paper_trading:
                try:
                    order_status = None
                    for _ in range(5):
                        await asyncio.sleep(0.4)
                        try:
                            order_status = await self.engine.exchange.fetch_order(res['id'], self.symbol)
                            if order_status and order_status.get('status') != 'open': break
                        except Exception: pass
                        
                    if order_status and order_status.get('status') == 'open':
                        logger.warning(f"⚠️ Exit Futures order {res['id']} is hanging open! Cancelling remainder...")
                        await self.engine.cancel_order(res['id'])
                        await asyncio.sleep(0.5)
                        
                        final_status = await self.engine.exchange.fetch_order(res['id'], self.symbol)
                        filled = final_status.get('filled', 0.0)
                        
                        filled_proper = float(self.engine.exchange.amount_to_precision(self.symbol, filled)) if hasattr(self.engine.exchange, 'amount_to_precision') else filled
                        remaining_base = max(0.0, sell_amount_raw - filled_proper)
                        
                        if remaining_base > 0:
                            logger.info(f"🧹 Sweeping Futures remainder at Pure Market: {remaining_base} {self.symbol}")
                            sweep_amount = float(self.engine.exchange.amount_to_precision(self.symbol, remaining_base))
                            await self.engine.execute_trade(exit_side, sweep_amount, current_price, order_type="market", params={'reduceOnly': True})
                            logger.info("✅ Market sweep completed.")
                except Exception as e:
                    logger.error(f"Error checking Futures partial fill sweep: {e}")
            # ----------------------------------------------------
            
            if res:
                actual_exit_price = current_price
                if not self.is_paper_trading:
                    try:
                        if 'final_status' in locals() and final_status and final_status.get('average'):
                            actual_exit_price = float(final_status['average'])
                        elif res.get('average'):
                            actual_exit_price = float(res['average'])
                    except Exception: pass
                    
                pnl_val = (actual_exit_price - self.active_pos['entry']) * sell_amount_raw if side == "long" else (self.active_pos['entry'] - actual_exit_price) * sell_amount_raw
                self.total_realized_pnl += pnl_val
                self.total_executed_orders += 1
                if pnl_val > 0:
                    self.total_wins += 1
                else:
                    self.total_losses += 1
                
                logger.info(f"✅ {side.upper()} Position Closed: {reason}")
                await self._send_telegram(f"🏁 *{side.upper()} Closed* ({reason})\nPrice: {current_price}\nPair: {self.symbol}\n💰 Trade PnL: ${pnl_val:.2f}\n\n📊 Net PnL: ${self.total_realized_pnl:.2f}\n💰 Gross: ${self.total_gross_pnl:.2f} | 💸 Fees: ${self.total_fees_paid:.2f}\n🏆 Wins: {self.total_wins} | 💔 Losses: {self.total_losses}")
                await self._clear_state()
                self.active_pos = None

    async def execute_partial_close(self, current_price: float):
        """TP1 এ পজিশনের একাংশ ক্লোজ করা এবং SL ব্রেক-ইভেনে আনা"""
        side = self.active_pos['side']
        entry = self.active_pos['entry']
        amount = self.active_pos['amount']
        exit_order_type = self.sell_order_type if side == "long" else self.buy_order_type
        
        sell_amount_raw = amount * (self.partial_tp_pct / 100)
        
        # Determine precision and limits based on market config
        min_amount = 1.0
        min_cost = 0.0
        contract_size = 1.0
        if self.public_exchange and getattr(self.public_exchange, 'markets', None):
            market = self.public_exchange.markets.get(self.symbol, {})
            min_amount = market.get('limits', {}).get('amount', {}).get('min', 1.0)
            if min_amount is None: min_amount = 1.0
            min_cost = market.get('limits', {}).get('cost', {}).get('min', 0.0)
            contract_size = market.get('contractSize', 1.0)

        # --- Min Notional Check (Dust Position Preventer) ---
        remaining_raw = amount - sell_amount_raw
        if min_cost and min_cost > 0:
            remaining_value = remaining_raw * contract_size * current_price
            if remaining_value < min_cost:
                logger.warning(f"Dust Prevented: Remaining value ${remaining_value:.2f} < Min Notional ${min_cost:.2f}. Partial TP upgrading to 100% close.")
                sell_amount_raw = amount
        # ----------------------------------------------------

        if min_amount >= 1.0:
            sell_amount = float(int(sell_amount_raw))
        else:
            sell_amount = float(f"{sell_amount_raw:.6f}")
            
        if sell_amount < min_amount:
            logger.warning(f"Partial TP amount {sell_amount_raw} is less than minimum {min_amount}. Skipping Partial TP.")
            self.active_pos['tp1_hit'] = True
            return
            
        logger.info(f"🔓 [PARTIAL TP] Closing {sell_amount} contracts ({self.partial_tp_pct}% logic) of {side.upper()} at {current_price}")
        
        exit_side = "sell" if side == "long" else "buy"
        
        # Force Market Taker for Partial TP to prevent execution freezes
        res = await self.engine.execute_trade(exit_side, sell_amount, current_price, order_type="market", params={'reduceOnly': True})
        if res: logger.info(f"Executed MARKET Taker Order for guaranteed Partial TP at {current_price}")
            
        # Update Limit order to prevent over-selling
        if res and exit_order_type == 'limit' and self.active_pos.get('limit_order_id'):
            try:
                await self.engine.cancel_order(self.active_pos['limit_order_id'])
                remain_amount = self.active_pos['amount'] - sell_amount
                if remain_amount > 0.00000001:
                    limit_res = await self.engine.execute_trade(exit_side, remain_amount, self.active_pos['tp'], order_type="limit", params={'reduceOnly': True, 'postOnly': True})
                    if limit_res and 'id' in limit_res:
                        self.active_pos['limit_order_id'] = limit_res['id']
            except Exception as e:
                logger.error(f"Failed to update Limit order after TP1: {e}")

        # Update Native Stop-Loss order
        if res and self.active_pos.get('sl_order_id'):
            try:
                await self.engine.cancel_order(self.active_pos['sl_order_id'])
                remain_amount = self.active_pos['amount'] - sell_amount
                if remain_amount > 0.00000001:
                    sl_params = {'reduceOnly': True, 'stopPrice': self.active_pos['sl']}
                    sl_res = await self.engine.execute_trade(exit_side, remain_amount, self.active_pos['sl'], order_type="stop_market", params=sl_params)
                    if sl_res and 'id' in sl_res:
                        self.active_pos['sl_order_id'] = sl_res['id']
            except Exception as e:
                logger.error(f"Failed to update Native SL order after TP1: {e}")
        
        if res:
            pnl_val = (current_price - entry) * sell_amount if side == "long" else (entry - current_price) * sell_amount
            self.total_realized_pnl += pnl_val
            
            self.active_pos['amount'] -= sell_amount
            
            if self.active_pos['amount'] <= 0.00000001:
                self.total_executed_orders += 1
                if pnl_val > 0:
                    self.total_wins += 1
                else:
                    self.total_losses += 1
                    
                logger.info(f"✅ TP1 Full Output Completed. Dust position was prevented.")
                await self._send_exit_telegram("🎯 *Full TP Hit at TP1!* (Dust Prevented)", current_price, pnl_val)
                await self._clear_state()
                self.active_pos = None
            else:
                self.active_pos['tp1_hit'] = True
                self._save_state()
                logger.info(f"✅ Partial TP Completed. Remaining: {self.active_pos['amount']}, SL: {self.active_pos['sl']}")
                await self._send_telegram(f"🔓 *Partial TP1 Hit!* ({self.partial_tp_pct}%)\nRemaining amount running.")
        else:
            logger.warning("❌ Partial TP execution failed. Marking tp1_hit as True to prevent infinite loop spam, position size unchanged.")
            self.active_pos['tp1_hit'] = True

    async def _execute_fallback_exit(self, current_price: float):
        """
        Executes a Maker-to-Taker fallback exit when Supertrend reversal triggers for Futures.
        It cancels any existing TP limit orders, places a Maker exit order at the current Best Bid/Ask,
        waits `supertrend_exit_timeout` seconds, and if unfilled, sweeps at Market.
        """
        if not self.active_pos or self.is_paper_trading: return
        
        try:
            side = self.active_pos['side']
            
            # 1. Cancel existing limit TP order if it exists
            limit_id = self.active_pos.get('limit_order_id')
            if limit_id:
                try:
                    await self.engine.cancel_order(limit_id)
                    logger.info(f"🗑️ Cancelled existing Limit TP {limit_id} for Dual-Exit.")
                except Exception as e:
                    logger.warning(f"⚠️ Could not cancel existing TP {limit_id} (may have just filled): {e}")
                    
            sl_id = self.active_pos.get('sl_order_id')
            if sl_id:
                try:
                    await self.engine.cancel_order(sl_id)
                except Exception: pass
            
            # 2. Fetch current best bid/ask to place a Maker order
            limit_size = market_depth_service._normalize_order_book_limit(self.exchange_id, 5) if hasattr(market_depth_service, '_normalize_order_book_limit') else 5
            ob = await self.public_exchange.fetch_order_book(self.symbol, limit=limit_size)
            best_bid = ob['bids'][0][0] if ob['bids'] else current_price
            best_ask = ob['asks'][0][0] if ob['asks'] else current_price
            
            close_side = "sell" if side == "long" else "buy"
            # For maker exit: Long exit = Sell = ask side. Short exit = Buy = bid side.
            maker_price = best_ask if close_side == "sell" else best_bid
            amount = self.active_pos['amount']
            
            logger.info(f"🛡️ Dual-Exit Step 1: Placing Futures Maker {close_side.upper()} order at {maker_price:.6f}")
            maker_res = await self.engine.execute_trade(close_side, amount, maker_price, order_type="limit", params={"postOnly": True, "reduceOnly": True})
            
            if not maker_res or not maker_res.get('id'):
                logger.error("❌ Failed to place Maker exit order. Aborting Fallback, reverting to next Risk tick.")
                self.active_pos['fallback_exit_in_progress'] = False
                self._save_state()
                return
                
            fallback_id = maker_res['id']
            timeout_sec = getattr(self, 'supertrend_exit_timeout', 5)
            
            # 3. Wait up to timeout amount
            logger.info(f"⏳ Waiting {timeout_sec}s for Maker Fallback Exit ({fallback_id}) to fill...")
            filled = False
            for step in range(timeout_sec * 2): # Check every 0.5 sec
                await asyncio.sleep(0.5)
                try:
                    status = await self.engine.exchange.fetch_order(fallback_id, self.symbol)
                    if status and status.get('status') in ['closed', 'filled']:
                        logger.info("✅ Maker Fallback Exit filled completely!")
                        filled = True
                        break
                except Exception: pass
            
            # 4. If not completely filled by timeout, cancel remainder and Sweep
            if not filled:
                try:
                    status = await self.engine.exchange.fetch_order(fallback_id, self.symbol)
                    if status and status.get('status') == 'open':
                        logger.warning(f"⚠️ Fallback Maker order {fallback_id} timed out. Cancelling and sweeping remainder...")
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
                            logger.info(f"🧹 Sweeping remainder at TAKER (Market): {remaining_base} {self.symbol}")
                            sweep_amount = float(self.engine.exchange.amount_to_precision(self.symbol, remaining_base)) if hasattr(self.engine.exchange, 'amount_to_precision') else remaining_base
                            await self.engine.execute_trade(close_side, sweep_amount, maker_price, order_type="market", params={"reduceOnly": True})
                            logger.info("✅ Taker sweep completed.")
                        else:
                            logger.info(f"✨ Remaining balance {remaining_base} is below exchange minimum ({min_amount}). Considering position closed.")
                except Exception as e:
                    logger.error(f"Error during Maker-to-Taker fallback sweep: {e}")
                    
            # 5. Calculate final position PnL and cleanup
            await asyncio.sleep(1.0)
            
            if side == "short":
                pnl_val = (self.active_pos['entry'] - maker_price) * amount
            else:
                pnl_val = (maker_price - self.active_pos['entry']) * amount
                
            self.total_realized_pnl += pnl_val
            self.total_executed_orders += 1
            if pnl_val > 0:
                self.total_wins += 1
            else:
                self.total_losses += 1
                
            await self._send_exit_telegram(f"⚡ Futures EXIT - Supertrend Fallback Hit! (Mode: {side.upper()})", filled_price, pnl_val)
            await self._clear_state()
            self.active_pos = None
            
        except Exception as e:
            logger.error(f"Critical error in Fallback Exit loop: {e}")
            if self.active_pos:
                self.active_pos['fallback_exit_in_progress'] = False
                self._save_state()

    async def emergency_sell(self, sell_type: str):
        """Emergency liquidate the active position."""
        if not self.active_pos:
            logger.info(f"No active position to emergency sell for bot {self.bot_id}")
            return
            
        side = self.active_pos['side']
        amount = self.active_pos['amount']
        
        # Determine current market price
        try:
            limit = market_depth_service._normalize_order_book_limit(self.exchange_id, 5)
            ob = await self.public_exchange.fetch_order_book(self.symbol, limit=limit)
            best_bid = ob['bids'][0][0] if ob['bids'] else 0
            best_ask = ob['asks'][0][0] if ob['asks'] else 0
            current_price = (best_bid + best_ask) / 2 if best_bid and best_ask else best_bid or best_ask
        except Exception as e:
            logger.warning(f"Could not fetch precise price for emergency sell: {e}")
            self.logger.warning(f"Could not fetch precise price for emergency sell: {e}")
            current_price = self.active_pos['entry'] if self.active_pos else 0

        if not self.active_pos:
            self.logger.info(f"Position closed during emergency sell fetch for bot {self.bot_id}")
            return

        # Cancel any open limit orders first
        if self.sell_order_type == 'limit' and self.active_pos.get('limit_order_id'):
            try:
                await self.engine.cancel_order(self.active_pos['limit_order_id'])
                self.logger.info(f"Cancelled open limit order {self.active_pos['limit_order_id']} for emergency sell.")
            except Exception as e:
                self.logger.warning(f"Failed to cancel open limit order during emergency sell: {e}")

        # Determine exit side
        exit_side = "sell" if side == "long" else "buy"
        
        self.logger.info(f"🚨 [EMERGENCY] Closing {side.upper()} position for bot {self.bot_id} via {sell_type.upper()}")
        
        actual_type = sell_type
        if actual_type == "marketable_limit":
            actual_type = "market"
            
        res = await self.engine.execute_trade(exit_side, amount, current_price, order_type=actual_type)
        if res:
            pnl_val = (current_price - self.active_pos['entry']) * amount if side == "long" else (self.active_pos['entry'] - current_price) * amount
            
            self.total_realized_pnl += pnl_val
            self.total_executed_orders += 1
            if pnl_val > 0:
                self.total_wins += 1
            else:
                self.total_losses += 1
                
            await self._send_telegram(f"🚨 *EMERGENCY EXIT* triggered!\nPair: {self.symbol}\nSide: {side.upper()}\nExit Price: {current_price}\n💰 Trade PnL: ${pnl_val:.2f}\n\n📊 Net PnL: ${self.total_realized_pnl:.2f}\n💰 Gross: ${self.total_gross_pnl:.2f} | 💸 Fees: ${self.total_fees_paid:.2f}\n🏆 Wins: {self.total_wins} | 💔 Losses: {self.total_losses}")
            self.active_pos = None
            self.logger.info(f"✅ Emergency exit completed.")

