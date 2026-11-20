import asyncio
import importlib.util
import os
import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import patch

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def _ensure_stub_modules():
    """Install lightweight stubs only for optional deps absent in standalone Windows Python."""
    if 'ccxt' not in sys.modules and importlib.util.find_spec('ccxt') is None:
        sys.modules['ccxt'] = types.ModuleType('ccxt')
        sys.modules['ccxt.pro'] = types.ModuleType('ccxt.pro')
        sys.modules['ccxt.async_support'] = types.ModuleType('ccxt.async_support')

    if 'fastapi' not in sys.modules and importlib.util.find_spec('fastapi') is None:
        fastapi_mod = types.ModuleType('fastapi')

        class HTTPException(Exception):
            def __init__(self, status_code=400, detail=''):
                super().__init__(detail)
                self.status_code = status_code
                self.detail = detail

        fastapi_mod.HTTPException = HTTPException
        sys.modules['fastapi'] = fastapi_mod

    if 'jose' not in sys.modules and importlib.util.find_spec('jose') is None:
        jose_mod = types.ModuleType('jose')
        jose_mod.jwt = SimpleNamespace(encode=lambda *a, **kw: '', decode=lambda *a, **kw: {})
        jose_mod.JWTError = Exception
        sys.modules['jose'] = jose_mod

    if 'sqlalchemy' not in sys.modules and importlib.util.find_spec('sqlalchemy') is None:
        sa_mod = types.ModuleType('sqlalchemy')
        sa_orm = types.ModuleType('sqlalchemy.orm')
        sa_sql = types.ModuleType('sqlalchemy.sql')
        sa_mod.Boolean = sa_mod.Column = sa_mod.DateTime = sa_mod.Float = lambda *a, **kw: None
        sa_mod.ForeignKey = sa_mod.Integer = sa_mod.JSON = sa_mod.String = lambda *a, **kw: None
        sa_mod.create_engine = lambda *a, **kw: None
        sa_orm.Session = object
        sa_orm.relationship = lambda *a, **kw: None
        sa_orm.sessionmaker = lambda *a, **kw: (lambda: None)
        sa_sql.func = SimpleNamespace(now=lambda: None)
        sa_mod.orm = sa_orm
        sa_mod.sql = sa_sql
        sys.modules['sqlalchemy'] = sa_mod
        sys.modules['sqlalchemy.orm'] = sa_orm
        sys.modules['sqlalchemy.sql'] = sa_sql

    if 'app.core.security' not in sys.modules:
        sec_mod = types.ModuleType('app.core.security')
        sec_mod.decrypt_key = lambda v: v
        sys.modules['app.core.security'] = sec_mod

    if 'app.core.config' not in sys.modules:
        cfg_mod = types.ModuleType('app.core.config')
        cfg_mod.settings = SimpleNamespace(REDIS_URL='redis://localhost:6379/0', DATABASE_URL='sqlite://')
        sys.modules['app.core.config'] = cfg_mod

    if 'app.services.exchange_pool' not in sys.modules:
        ep_mod = types.ModuleType('app.services.exchange_pool')

        async def get_or_create_exchange(*args, **kwargs):
            return None

        async def prewarm_exchange_connections(*args, **kwargs):
            return None

        ep_mod.get_or_create_exchange = get_or_create_exchange
        ep_mod.is_ws_api_ready = lambda *a, **kw: False
        ep_mod.prewarm_exchange_connections = prewarm_exchange_connections
        sys.modules['app.services.exchange_pool'] = ep_mod

    if 'app.services.notification' not in sys.modules:
        notif_mod = types.ModuleType('app.services.notification')

        class NotificationService:
            @staticmethod
            async def send_message(*args, **kwargs):
                return None

        notif_mod.NotificationService = NotificationService
        sys.modules['app.services.notification'] = notif_mod

    if 'app.db.base_class' not in sys.modules:
        bc_mod = types.ModuleType('app.db.base_class')

        class Base:
            pass

        bc_mod.Base = Base
        sys.modules['app.db.base_class'] = bc_mod

    if 'app.db.session' not in sys.modules:
        sess_mod = types.ModuleType('app.db.session')
        sess_mod.SessionLocal = lambda: SimpleNamespace(close=lambda: None)
        sys.modules['app.db.session'] = sess_mod

    if 'app.models' not in sys.modules and hasattr(sys.modules.get('sqlalchemy'), '__file__') is False:
        models_mod = types.ModuleType('app.models')
        models_mod.ApiKey = object
        models_mod.User = object
        models_mod.ManualTradeMonitor = object
        sys.modules['app.models'] = models_mod

    if 'app.services.ml_predictor' not in sys.modules:
        mlp_mod = types.ModuleType('app.services.ml_predictor')
        mlp_mod.predict = lambda *a, **kw: {}
        mlp_mod.warmup_model_and_features = lambda *a, **kw: True
        sys.modules['app.services.ml_predictor'] = mlp_mod


_ensure_stub_modules()

from fastapi import HTTPException  # noqa: E402
from app.services.anti_wick_guard import (  # noqa: E402
    compute_anti_wick_disaster_price,
    evaluate_anti_wick_trigger,
)
from app.services.bracket_order_service import BracketOrderService  # noqa: E402
from app.services.manual_trade_service import ManualTradeService  # noqa: E402


class _FakeOhlcvExchange:
    def __init__(self, candles=None, ticker=None):
        self.id = 'binance'
        self.candles = candles or []
        self.ticker = ticker or {'last': 102.0, 'bid': 101.9, 'ask': 102.1}
        self.markets = {'BTC/USDT:USDT': {'precision': {'price': 0.01, 'amount': 0.001}}}
        self.created_orders = []
        self.cancelled_orders = []

    def price_to_precision(self, symbol, price):
        return f"{round(float(price), 4)}"

    def amount_to_precision(self, symbol, amount):
        return f"{round(float(amount), 4)}"

    async def fetch_ohlcv(self, symbol, timeframe='1m', limit=3):
        return list(self.candles)

    async def fetch_ticker(self, symbol):
        return dict(self.ticker)

    async def cancel_order(self, oid, symbol, params=None):
        self.cancelled_orders.append((oid, symbol, params))
        return {'id': oid, 'status': 'canceled'}

    async def create_order(self, symbol, order_type, side, amount, price=None, params=None):
        oid = f"ord_{len(self.created_orders) + 1}"
        self.created_orders.append((oid, symbol, order_type, side, amount, price, params))
        return {'id': oid, 'status': 'open'}

    async def create_market_order(self, symbol, side, amount, params=None):
        oid = f"mkt_{len(self.created_orders) + 1}"
        self.created_orders.append((oid, symbol, 'market', side, amount, None, params))
        return {'id': oid, 'status': 'closed'}


class TestAntiWickAndHudBackend(unittest.IsolatedAsyncioTestCase):
    def tearDown(self):
        BracketOrderService.ACTIVE_SOFTWARE_SL.clear()

    async def test_anti_wick_dwell_absorbs_fake_wick_and_confirms_real_break(self):
        state = {}
        ex = _FakeOhlcvExchange()

        # 1. Price briefly dips below SL 100.0 at t=1000
        fired, reason = await evaluate_anti_wick_trigger(
            state, ex, 'BTC/USDT', 'sell',
            current_price=99.6, trigger_price=100.0,
            anti_wick_mode='dwell', dwell_seconds=3.0,
            disaster_bypass_pct=2.0, now_ts=1000.0,
        )
        self.assertFalse(fired)
        self.assertEqual(reason, 'holding_dwell')
        self.assertEqual(state['anti_wick_state'], 'holding_dwell')

        # 2. Still below SL at t=1002.0 (2s < 3s dwell) -> still holding
        fired, reason = await evaluate_anti_wick_trigger(
            state, ex, 'BTC/USDT', 'sell',
            current_price=99.5, trigger_price=100.0,
            anti_wick_mode='dwell', dwell_seconds=3.0,
            disaster_bypass_pct=2.0, now_ts=1002.0,
        )
        self.assertFalse(fired)
        self.assertAlmostEqual(state['anti_wick_remaining_sec'], 1.0, places=2)

        # 3. Wick snapped back above 100.0 at t=1002.5 -> timer resets cleanly!
        fired, reason = await evaluate_anti_wick_trigger(
            state, ex, 'BTC/USDT', 'sell',
            current_price=100.2, trigger_price=100.0,
            anti_wick_mode='dwell', dwell_seconds=3.0,
            disaster_bypass_pct=2.0, now_ts=1002.5,
        )
        self.assertFalse(fired)
        self.assertEqual(reason, 'monitoring')
        self.assertIsNone(state.get('anti_wick_breach_started_at'))

        # 4. New breakdown sustained >= 3.0s -> confirmed!
        await evaluate_anti_wick_trigger(
            state, ex, 'BTC/USDT', 'sell',
            current_price=99.4, trigger_price=100.0,
            anti_wick_mode='dwell', dwell_seconds=3.0,
            disaster_bypass_pct=2.0, now_ts=1010.0,
        )
        fired, reason = await evaluate_anti_wick_trigger(
            state, ex, 'BTC/USDT', 'sell',
            current_price=99.3, trigger_price=100.0,
            anti_wick_mode='dwell', dwell_seconds=3.0,
            disaster_bypass_pct=2.0, now_ts=1013.1,
        )
        self.assertTrue(fired)
        self.assertEqual(reason, 'dwell_confirmed')

    async def test_anti_wick_flash_crash_bypasses_wait(self):
        state = {}
        ex = _FakeOhlcvExchange()
        # Disaster threshold is 2.0% past 100.0 -> 98.0 triggers immediate bypass!
        fired, reason = await evaluate_anti_wick_trigger(
            state, ex, 'BTC/USDT', 'sell',
            current_price=97.9, trigger_price=100.0,
            anti_wick_mode='candle_close', timeframe='5m',
            disaster_bypass_pct=2.0, now_ts=1000.0,
        )
        self.assertTrue(fired)
        self.assertEqual(reason, 'disaster_crash_bypass')
        self.assertAlmostEqual(compute_anti_wick_disaster_price(100.0, 'sell', 2.0), 98.0, places=4)

    async def test_anti_wick_candle_close_rejects_safe_bar_and_confirms_broken_bar(self):
        state = {}
        # 1m bucket 20 -> t=1200..1259
        bucket_20_open_ms = 20 * 60 * 1000
        ex = _FakeOhlcvExchange(candles=[[bucket_20_open_ms, 100.5, 100.6, 99.4, 100.3, 500]])

        fired, reason = await evaluate_anti_wick_trigger(
            state, ex, 'BTC/USDT', 'sell',
            current_price=99.5, trigger_price=100.0,
            anti_wick_mode='candle_close', timeframe='1m',
            disaster_bypass_pct=3.0, now_ts=1240.0,
        )
        self.assertFalse(fired)
        self.assertEqual(reason, 'holding_candle')

        # Candle rolls to bucket 21 (t=1261) and OHLCV bar closed at 100.3 (> SL 100.0) -> saved!
        fired, reason = await evaluate_anti_wick_trigger(
            state, ex, 'BTC/USDT', 'sell',
            current_price=100.2, trigger_price=100.0,
            anti_wick_mode='candle_close', timeframe='1m',
            disaster_bypass_pct=3.0, now_ts=1261.0,
        )
        self.assertFalse(fired)
        self.assertEqual(reason, 'candle_wick_saved')

        # Next bucket 22 (t=1330) breaches intrabar; at bucket 23 bar closed at 99.2 (<= 100.0) -> confirmed!
        bucket_22_open_ms = 22 * 60 * 1000
        ex.candles = [[bucket_22_open_ms, 100.1, 100.2, 99.0, 99.2, 900]]
        await evaluate_anti_wick_trigger(
            state, ex, 'BTC/USDT', 'sell',
            current_price=99.4, trigger_price=100.0,
            anti_wick_mode='candle_close', timeframe='1m',
            disaster_bypass_pct=3.0, now_ts=1330.0,
        )
        fired, reason = await evaluate_anti_wick_trigger(
            state, ex, 'BTC/USDT', 'sell',
            current_price=99.3, trigger_price=100.0,
            anti_wick_mode='candle_close', timeframe='1m',
            disaster_bypass_pct=3.0, now_ts=1381.0,
        )
        self.assertTrue(fired)
        self.assertEqual(reason, 'candle_close_confirmed')

    async def test_move_active_sl_to_breakeven_guards_loss_and_moves_in_profit(self):
        ex = _FakeOhlcvExchange(ticker={'last': 99.5, 'bid': 99.4, 'ask': 99.6})
        BracketOrderService.ACTIVE_SOFTWARE_SL['sl_be_1'] = {
            'id': 'sl_be_1',
            'api_key_id': 7,
            'symbol': 'BTC/USDT:USDT',
            'side': 'sell',
            'amount': 0.5,
            'entry_price': 100.0,
            'trigger_price': 98.0,
            'price': 98.0,
            'mode': 'SMART_CHASE',
            'exchange': ex,
            'is_futures': True,
            'cancelled': False,
        }

        with patch.object(BracketOrderService, '_fetch_ticker_fast', return_value={'last': 99.5, 'bid': 99.4, 'ask': 99.6}):
            with self.assertRaises(HTTPException) as ctx:
                await BracketOrderService.move_active_sl_to_breakeven(
                    api_key_id=7, symbol='BTC/USDT:USDT', user_id=1, buffer_pct=0.05
                )
            self.assertEqual(ctx.exception.status_code, 400)

        # Now price is in profit @ 102.0 -> move SL cleanly to 100.05
        with patch.object(BracketOrderService, '_fetch_ticker_fast', return_value={'last': 102.0, 'bid': 101.9, 'ask': 102.1}):
            res = await BracketOrderService.move_active_sl_to_breakeven(
                api_key_id=7, symbol='BTC/USDT:USDT', user_id=0, buffer_pct=0.05
            )
        self.assertEqual(res['status'], 'success')
        self.assertAlmostEqual(res['breakeven_price'], 100.05, places=4)
        self.assertEqual(BracketOrderService.ACTIVE_SOFTWARE_SL['sl_be_1']['trigger_price'], 100.05)
        self.assertTrue(BracketOrderService.ACTIVE_SOFTWARE_SL['sl_be_1']['breakeven_activated'])

        # Drag-spawned SL (no entry_order_id) with stale drag price should prefer true fallback_entry_price
        BracketOrderService.ACTIVE_SOFTWARE_SL['sl_drag_1'] = {
            'id': 'sl_drag_1',
            'api_key_id': 7,
            'symbol': 'BTC/USDT:USDT',
            'side': 'sell',
            'amount': 0.5,
            'entry_order_id': None,
            'entry_price': 101.8,  # stale drag market price
            'trigger_price': 99.0,
            'price': 99.0,
            'mode': 'SMART_CHASE',
            'exchange': ex,
            'is_futures': True,
            'cancelled': False,
        }
        del BracketOrderService.ACTIVE_SOFTWARE_SL['sl_be_1']
        with patch.object(BracketOrderService, '_fetch_ticker_fast', return_value={'last': 102.0, 'bid': 101.9, 'ask': 102.1}):
            res_drag = await BracketOrderService.move_active_sl_to_breakeven(
                api_key_id=7, symbol='BTC/USDT:USDT', user_id=0, buffer_pct=0.05, fallback_entry_price=100.0
            )
        self.assertAlmostEqual(res_drag['breakeven_price'], 100.05, places=4)
        self.assertEqual(BracketOrderService.ACTIVE_SOFTWARE_SL['sl_drag_1']['entry_price'], 100.0)

    async def test_ml_filter_live_preview_blends_l2_and_returns_gauge(self):
        fake_pred = {
            'signal': 'BUY',
            'confidence': 0.70,
            'bullish_prob': 0.70,
            'bearish_prob': 0.30,
            'algorithm': 'XGBoost',
            'microstructure': {'flow_bullish_score': 0.68, 'flow_bearish_score': 0.32},
        }
        fake_ob = {'bids': [[100.0, 80.0]], 'asks': [[100.1, 20.0]]}
        with patch('app.services.manual_trade_service.ManualTradeService._inspect_ml_filter_route', return_value=(True, 'AlphaL2')), \
             patch('app.services.liquidity_wall_navigator.fetch_l2_depth_fast', return_value=fake_ob), \
             patch('app.services.ml_predictor.predict', return_value=fake_pred):
            res = await ManualTradeService.get_ml_filter_live_preview(
                symbol='BTC/USDT', ml_model_id='model_1', bullish_thresh=0.55, bearish_thresh=0.55
            )
        self.assertEqual(res['status'], 'ok')
        self.assertEqual(res['model_name'], 'AlphaL2')
        # 0.85 * 0.70 + 0.15 * 0.80 = 0.715 -> 71.5%
        self.assertAlmostEqual(res['bullish_pct'], 71.5, places=1)
        self.assertEqual(res['flow_bull_pct'], 68.0)
        self.assertEqual(res['l2_bid_pct'], 80.0)
        self.assertTrue(res['buy_ready'])


if __name__ == '__main__':
    unittest.main()
