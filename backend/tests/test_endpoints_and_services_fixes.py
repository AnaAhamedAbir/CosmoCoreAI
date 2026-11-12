import ast
import asyncio
import logging
import os
import sys
import time
import types
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def _install_dependency_stubs():
    """Install lightweight stubs only for third-party / DB modules absent in standalone test runs."""
    # 1. SQLAlchemy stubs
    if "sqlalchemy" not in sys.modules:
        sa_mod = types.ModuleType("sqlalchemy")
        sa_orm = types.ModuleType("sqlalchemy.orm")

        class Session:
            pass

        sa_orm.Session = Session
        sa_mod.orm = sa_orm
        sys.modules["sqlalchemy"] = sa_mod
        sys.modules["sqlalchemy.orm"] = sa_orm

    # 2. Redis / app.core.redis stubs
    if "app.core.redis" not in sys.modules:
        redis_core = types.ModuleType("app.core.redis")

        class _DummyRedisManager:
            def get_redis(self):
                return None

        redis_core.redis_manager = _DummyRedisManager()
        sys.modules["app.core.redis"] = redis_core

    # 3. Security / DB session / Models / Crud / Deps stubs
    if "app.core.security" not in sys.modules:
        sec_mod = types.ModuleType("app.core.security")
        sec_mod.decrypt_key = lambda v: v
        sys.modules["app.core.security"] = sec_mod

    if "app.db.session" not in sys.modules:
        db_mod = types.ModuleType("app.db.session")

        class DummySession:
            def close(self):
                pass

        db_mod.SessionLocal = lambda: DummySession()
        sys.modules["app.db.session"] = db_mod

    if "app.models" not in sys.modules:
        models_mod = types.ModuleType("app.models")

        class _Col:
            def __eq__(self, other):
                return True

        class ApiKey:
            id = _Col()
            user_id = _Col()
            is_enabled = _Col()
            exchange = _Col()

        class User:
            id = 1

        models_mod.ApiKey = ApiKey
        models_mod.User = User
        sys.modules["app.models"] = models_mod

    if "app.crud" not in sys.modules:
        sys.modules["app.crud"] = types.ModuleType("app.crud")

    if "app.api.deps" not in sys.modules:
        deps_mod = types.ModuleType("app.api.deps")
        deps_mod.get_db = lambda: None
        deps_mod.get_current_user = lambda: SimpleNamespace(id=1)
        sys.modules["app.api.deps"] = deps_mod

    if "app.services.notification" not in sys.modules:
        notif_mod = types.ModuleType("app.services.notification")

        class NotificationService:
            sent_messages = []

            @staticmethod
            async def send_message(db, user_id, msg, **kwargs):
                NotificationService.sent_messages.append((user_id, msg, kwargs))

        notif_mod.NotificationService = NotificationService
        sys.modules["app.services.notification"] = notif_mod

    if "app.helpers.orderbook_math" not in sys.modules:
        obm_mod = types.ModuleType("app.helpers.orderbook_math")
        obm_mod.calculate_dynamic_wall_threshold = lambda bids, asks: 1000.0
        sys.modules["app.helpers.orderbook_math"] = obm_mod


_install_dependency_stubs()

from app.api.v1.endpoints import trading as trading_ep  # noqa: E402
from app.services import exchange_pool  # noqa: E402
from app.services.bracket_order_service import BracketOrderService  # noqa: E402
from app.services.manual_smart_chase_executor import ACTIVE_SMART_CHASES  # noqa: E402
from app.services.manual_trade_service import ManualTradeService, manual_trade_service  # noqa: E402
from app.services.market_data_streamer import MarketDataStreamer  # noqa: E402
from app.services import smart_peg_entry_executor as peg_exec  # noqa: E402
from app.services.smart_peg_entry_executor import ACTIVE_SMART_PEGS, execute_smart_peg_entry  # noqa: E402


class _FakeQuery:
    def __init__(self, record):
        self._record = record

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._record


class FakeDB:
    def __init__(self, api_key_record=None):
        self._record = api_key_record or SimpleNamespace(
            id=7,
            user_id=1,
            exchange="binance",
            api_key="key",
            secret_key="sec",
            passphrase=None,
            is_enabled=True,
        )

    def query(self, *args, **kwargs):
        return _FakeQuery(self._record)

    def close(self):
        pass


class MockExchange:
    def __init__(self, symbol="DOGE/USDT", is_inverse=False, contract_size=1.0, tick=0.0001):
        self.id = "binance"
        self.apiKey = "test_key"
        self.has = {"editOrder": True, "createOrderWs": False}
        base = symbol.split("/")[0]
        quote = symbol.split("/")[1].split(":")[0]
        self.markets = {
            symbol: {
                "symbol": symbol,
                "base": base,
                "quote": quote,
                "settle": base if is_inverse else quote,
                "inverse": is_inverse,
                "subType": "inverse" if is_inverse else "linear",
                "contractSize": contract_size,
                "precision": {"price": tick, "amount": 1.0 if is_inverse else 0.01},
                "limits": {"cost": {"min": 5.0}},
            }
        }
        self._bids = [[0.0999, 10000.0]]
        self._asks = [[0.1001, 10000.0]]
        self._last = 0.10
        self.open_orders = []
        self.orders_by_id = {}
        self.balance_queue = []
        self.cancelled_ids = []
        self.cancel_all_calls = []
        self.market_orders = []
        self.limit_orders = []
        self.edit_responses = []
        self._next_id = 500
        self.positions = []

    def price_to_precision(self, symbol, price):
        return f"{round(float(price), 6):.6f}"

    def amount_to_precision(self, symbol, amount):
        if self.markets.get(symbol, {}).get("inverse"):
            return str(int(round(float(amount))))
        return f"{round(float(amount), 4):.4f}"

    async def fetch_ticker(self, symbol):
        return {"last": self._last, "close": self._last, "bid": self._bids[0][0], "ask": self._asks[0][0]}

    async def fetch_order_book(self, symbol, limit=5):
        return {"bids": list(self._bids), "asks": list(self._asks)}

    async def fetch_open_orders(self, symbol, params=None):
        return list(self.open_orders)

    async def fetch_order(self, oid, symbol, params=None):
        if str(oid) in self.orders_by_id:
            return dict(self.orders_by_id[str(oid)])
        raise Exception(f"Order {oid} not found")

    async def fetch_balance(self, params=None):
        if self.balance_queue:
            return self.balance_queue.pop(0)
        return {}

    async def fetch_positions(self, symbols=None, params=None):
        return list(self.positions)

    async def cancel_order(self, oid, symbol, params=None):
        self.cancelled_ids.append(str(oid))
        return {"id": str(oid), "status": "canceled"}

    async def cancel_all_orders(self, symbol):
        self.cancel_all_calls.append(symbol)
        return []

    async def edit_order(self, oid, symbol, order_type, side, amount, price, params=None):
        if self.edit_responses:
            return self.edit_responses.pop(0)
        return {"id": str(oid), "symbol": symbol, "side": side, "amount": float(amount), "price": float(price), "status": "open"}

    async def create_market_order(self, symbol, side, amount, params=None):
        self._next_id += 1
        order = {"id": str(self._next_id), "symbol": symbol, "side": side, "amount": float(amount), "status": "closed", "params": dict(params or {})}
        self.market_orders.append(order)
        return order

    async def create_limit_order(self, symbol, side, amount, price, params=None):
        self._next_id += 1
        order = {"id": str(self._next_id), "symbol": symbol, "side": side, "amount": float(amount), "price": float(price), "status": "open", "filled": 0.0, "params": dict(params or {})}
        self.limit_orders.append(order)
        return order

    async def set_margin_mode(self, mode, symbol):
        return {"status": "ok"}

    async def set_leverage(self, lev, symbol):
        return {"status": "ok"}


def _clear_registries():
    BracketOrderService.ACTIVE_SOFTWARE_SL.clear()
    BracketOrderService.ACTIVE_ENTRY_BRACKETS.clear()
    BracketOrderService.ACTIVE_ENTRY_MONITORS.clear()
    BracketOrderService.KNOWN_TP_ORDER_IDS.clear()
    ACTIVE_SMART_CHASES.clear()
    ACTIVE_SMART_PEGS.clear()
    ManualTradeService._WALLET_BALANCE_CACHE.clear()
    ManualTradeService._OPEN_ORDERS_CACHE.clear()
    ManualTradeService._LEVERAGE_CACHE.clear()
    ManualTradeService._HEDGE_MODE_CACHE.clear()


class TestEndpointsAndServicesFixes(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        _clear_registries()

    async def asyncTearDown(self):
        _clear_registries()
        await exchange_pool.close_all()

    # ------------------------------------------------------------------
    # Fix 1: Inverse Futures Drag TP/SL uses contracts, not base coins
    # ------------------------------------------------------------------
    async def test_drag_bracket_inverse_futures_uses_contracts_not_base_coins(self):
        ex = MockExchange("DOGE/USD:DOGE", is_inverse=True, contract_size=10.0)
        ex._last = 0.10
        db = FakeDB()
        user = SimpleNamespace(id=1)

        spawn_calls = []

        async def fake_spawn(**kwargs):
            spawn_calls.append(kwargs)
            return {"tp_order_id": "tp_inv_1", "tp_price": 0.12}

        with patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=ex)), \
             patch.object(ManualTradeService, "get_active_position", AsyncMock(return_value={
                 "amount": 5000.0,
                 "contracts": 50.0,
                 "contract_size": 10.0,
                 "is_inverse": True,
                 "side": "long",
             })), \
             patch.object(BracketOrderService, "_spawn_bracket_for_amount", side_effect=fake_spawn):

            # Case A: req.amount omitted -> must use 50.0 contracts, not 5000.0 base coins
            res1 = await trading_ep.place_drag_bracket_endpoint(
                trading_ep.PlaceDragBracketRequest(
                    api_key_id=7, symbol="DOGE/USD:DOGE", bracket_type="tp", price=0.12, amount=None, is_futures=True
                ),
                db=db,
                current_user=user,
            )
            self.assertEqual(res1["amount"], 50.0)
            self.assertEqual(spawn_calls[0]["filled_amount"], 50.0)

            # Case B: legacy client sends req.amount == base coins (5000.0) -> corrected to 50.0 contracts
            res2 = await trading_ep.place_drag_bracket_endpoint(
                trading_ep.PlaceDragBracketRequest(
                    api_key_id=7, symbol="DOGE/USD:DOGE", bracket_type="sl", price=0.08, amount=5000.0, is_futures=True
                ),
                db=db,
                current_user=user,
            )
            self.assertEqual(res2["amount"], 50.0)
            self.assertEqual(spawn_calls[1]["filled_amount"], 50.0)

    # ------------------------------------------------------------------
    # Fix 2: Futures pending limit order (pos_amt == 0) resolves size
    # ------------------------------------------------------------------
    async def test_drag_bracket_futures_pending_order_pos_zero_succeeds(self):
        ex = MockExchange("BTC/USDT:USDT", is_inverse=False, tick=0.1)
        ex._last = 62000.0
        ex.open_orders = [
            {"id": "fut_entry_1", "symbol": "BTC/USDT:USDT", "side": "buy", "amount": 0.25, "remaining": 0.25, "price": 60000.0}
        ]
        db = FakeDB()
        user = SimpleNamespace(id=1)

        spawn_calls = []

        async def fake_spawn(**kwargs):
            spawn_calls.append(kwargs)
            return {"tp_order_id": "tp_fut_1", "tp_price": 65000.0}

        with patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=ex)), \
             patch.object(ManualTradeService, "get_active_position", AsyncMock(return_value={
                 "amount": 0.0, "contracts": 0.0, "contract_size": 1.0, "is_inverse": False, "side": "none"
             })), \
             patch.object(BracketOrderService, "_spawn_bracket_for_amount", side_effect=fake_spawn):

            res = await trading_ep.place_drag_bracket_endpoint(
                trading_ep.PlaceDragBracketRequest(
                    api_key_id=7,
                    symbol="BTC/USDT:USDT",
                    bracket_type="tp",
                    price=65000.0,
                    amount=None,
                    is_futures=True,
                    target_order_id="fut_entry_1",
                ),
                db=db,
                current_user=user,
            )

        self.assertEqual(res["status"], "success")
        self.assertEqual(res["amount"], 0.25)
        self.assertEqual(res["entry_side"], "buy")
        self.assertEqual(spawn_calls[0]["filled_amount"], 0.25)
        self.assertEqual(spawn_calls[0]["entry_order_id"], "fut_entry_1")

    # ------------------------------------------------------------------
    # Fix 3: Side resolution before heuristic, Spot order vs wallet, stale TP check
    # ------------------------------------------------------------------
    async def test_drag_sl_across_market_keeps_entry_side_and_updates_existing_sl(self):
        ex = MockExchange("DOGE/USDT", tick=0.0001)
        ex._last = 0.10
        db = FakeDB()
        user = SimpleNamespace(id=1)

        BracketOrderService.ACTIVE_SOFTWARE_SL["sl_long_1"] = {
            "api_key_id": 7,
            "symbol": "DOGE/USDT",
            "side": "sell",  # exit side for Long entry
            "amount": 100.0,
            "trigger_price": 0.09,
            "price": 0.09,
            "status": "monitoring",
            "cancelled": False,
            "tp_order_id": "tp_existing",
            "type": "smart_chase",
        }

        update_mock = AsyncMock(return_value={"status": "success"})
        with patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=ex)), \
             patch.object(BracketOrderService, "update_software_bracket", update_mock):

            # Drag SL ABOVE current price (0.10) into profit at 0.11 without req.side
            res = await trading_ep.place_drag_bracket_endpoint(
                trading_ep.PlaceDragBracketRequest(
                    api_key_id=7,
                    symbol="DOGE/USDT",
                    bracket_type="sl",
                    price=0.11,
                    amount=None,
                    is_futures=False,
                    side=None,
                    target_order_id="sl_long_1",
                ),
                db=db,
                current_user=user,
            )

        self.assertEqual(res["entry_side"], "buy")
        update_mock.assert_awaited_once()
        self.assertEqual(BracketOrderService.ACTIVE_SOFTWARE_SL["sl_long_1"]["trigger_price"], 0.11)

    async def test_drag_tp_respects_req_side_when_crossed_and_spot_order_uses_remaining(self):
        ex = MockExchange("DOGE/USDT", tick=0.0001)
        ex._last = 0.10
        ex.open_orders = [
            {"id": "spot_entry_1", "symbol": "DOGE/USDT", "side": "buy", "amount": 50.0, "remaining": 30.0, "price": 0.09}
        ]
        db = FakeDB()
        user = SimpleNamespace(id=1)

        spawn_calls = []

        async def fake_spawn(**kwargs):
            spawn_calls.append(kwargs)
            return {"tp_order_id": "tp_new_1", "tp_price": kwargs["tp_config"]["value"]}

        fast_bal_mock = AsyncMock(return_value={"base_free": 9999.0, "quote_free": 5000.0})
        with patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=ex)), \
             patch.object(ManualTradeService, "get_fast_balance", fast_bal_mock), \
             patch.object(BracketOrderService, "_spawn_bracket_for_amount", side_effect=fake_spawn):

            # Even though TP price 0.095 < current_px 0.10, req.side='buy' must be honored
            # and amount must come from spot_entry_1 remaining (30.0), not wallet (9999.0)!
            res = await trading_ep.place_drag_bracket_endpoint(
                trading_ep.PlaceDragBracketRequest(
                    api_key_id=7,
                    symbol="DOGE/USDT",
                    bracket_type="tp",
                    price=0.095,
                    amount=None,
                    is_futures=False,
                    side="buy",
                    target_order_id="spot_entry_1",
                ),
                db=db,
                current_user=user,
            )

        self.assertEqual(res["amount"], 30.0)
        self.assertEqual(res["entry_side"], "buy")
        self.assertEqual(spawn_calls[0]["side"], "buy")
        self.assertEqual(spawn_calls[0]["filled_amount"], 30.0)
        fast_bal_mock.assert_not_awaited()

    async def test_resolve_drag_tp_link_marks_stale_closed_tp_cancelled(self):
        ex = MockExchange("DOGE/USDT", tick=0.0001)
        ex.orders_by_id["tp_stale"] = {"id": "tp_stale", "status": "closed"}
        ex.open_orders = [
            {"id": "tp_live", "side": "sell", "price": 0.125, "amount": 100.0, "remaining": 100.0}
        ]

        BracketOrderService.ACTIVE_ENTRY_BRACKETS["entry_old"] = {
            "entry_order_id": "entry_old",
            "api_key_id": 7,
            "symbol": "DOGE/USDT",
            "side": "sell",
            "amount": 100.0,
            "tp_order_id": "tp_stale",
            "tp_price": 0.12,
            "cancelled": False,
        }

        tp_id, entry_id, tp_px = await trading_ep._resolve_drag_tp_link(
            exchange=ex,
            symbol="DOGE/USDT",
            api_key_id=7,
            opposite_side="sell",
            final_amount=100.0,
            final_price=0.09,
            current_px=0.10,
            target_order_id=None,
        )

        self.assertTrue(BracketOrderService.ACTIVE_ENTRY_BRACKETS["entry_old"]["cancelled"])
        self.assertEqual(tp_id, "tp_live")
        self.assertIsNone(entry_id)
        self.assertEqual(tp_px, 0.125)

    # ------------------------------------------------------------------
    # Fix 4: sl_meta['mode'] uses sl_config['mode'], not sl_config['type']
    # ------------------------------------------------------------------
    async def test_drag_sl_update_sets_mode_correctly(self):
        ex = MockExchange("DOGE/USDT", tick=0.0001)
        ex._last = 0.10
        db = FakeDB()
        user = SimpleNamespace(id=1)

        BracketOrderService.ACTIVE_SOFTWARE_SL["sl_fix4"] = {
            "api_key_id": 7,
            "symbol": "DOGE/USDT",
            "side": "sell",
            "amount": 100.0,
            "trigger_price": 0.09,
            "price": 0.09,
            "status": "monitoring",
            "cancelled": False,
            "tp_order_id": "tp_1",
            "type": "smart_chase",
            "mode": "PERCENTAGE",
        }

        with patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=ex)), \
             patch.object(BracketOrderService, "update_software_bracket", AsyncMock(return_value={"status": "success"})):

            await trading_ep.place_drag_bracket_endpoint(
                trading_ep.PlaceDragBracketRequest(
                    api_key_id=7,
                    symbol="DOGE/USDT",
                    bracket_type="sl",
                    price=0.088,
                    amount=100.0,
                    is_futures=False,
                    side="buy",
                    target_order_id="sl_fix4",
                    sl_config={"type": "trailing_chase", "mode": "absolute"},
                ),
                db=db,
                current_user=user,
            )

        self.assertEqual(BracketOrderService.ACTIVE_SOFTWARE_SL["sl_fix4"]["type"], "trailing_chase")
        self.assertEqual(BracketOrderService.ACTIVE_SOFTWARE_SL["sl_fix4"]["mode"], "ABSOLUTE")

    # ------------------------------------------------------------------
    # Fix 5: Smart Chase edit flags + TP edit syncs ID & price (even same ID)
    # ------------------------------------------------------------------
    async def test_edit_order_updates_smart_chase_target_and_max_chase_price(self):
        db = FakeDB()
        user = SimpleNamespace(id=1)

        ACTIVE_SMART_CHASES["chase_sell_1"] = {
            "chase_id": "chase_sell_1",
            "symbol": "DOGE/USDT",
            "side": "sell",
            "amount": 200.0,
            "original_sl": 0.10,
            "current_maker_price": 0.10,
            "max_deviation_pct": 2.0,
            "max_chase_price": 0.098,
            "target_updated": False,
        }

        with patch.object(BracketOrderService, "_send_sl_modified_notification", AsyncMock()):
            res = await trading_ep.edit_order(
                api_key_id=7,
                order_id="chase_sell_1",
                request=trading_ep.EditOrderRequest(symbol="DOGE/USDT", side="sell", amount=200.0, new_price=0.12),
                db=db,
                current_user=user,
            )

        self.assertEqual(res["price"], 0.12)
        c = ACTIVE_SMART_CHASES["chase_sell_1"]
        self.assertTrue(c["target_updated"])
        self.assertEqual(c["original_sl"], 0.12)
        self.assertEqual(c["current_maker_price"], 0.12)
        self.assertAlmostEqual(c["max_chase_price"], 0.12 * 0.98, places=8)

    async def test_edit_manual_trade_and_edit_order_sync_tp_price_even_when_id_unchanged(self):
        ex = MockExchange("BTC/USDT:USDT", tick=0.1)
        ex.edit_responses = [
            {"id": "tp_same_id", "symbol": "BTC/USDT:USDT", "side": "sell", "amount": 1.0, "price": 65000.0, "status": "open"}
        ]
        db = FakeDB()
        user = SimpleNamespace(id=1)

        BracketOrderService.ACTIVE_SOFTWARE_SL["sl_sync_1"] = {
            "api_key_id": 7,
            "symbol": "BTC/USDT:USDT",
            "side": "sell",
            "tp_order_id": "tp_same_id",
            "tp_price": 64000.0,
            "cancelled": False,
        }
        BracketOrderService.ACTIVE_ENTRY_BRACKETS["entry_sync_1"] = {
            "entry_order_id": "entry_sync_1",
            "api_key_id": 7,
            "symbol": "BTC/USDT:USDT",
            "side": "sell",
            "tp_order_id": "tp_same_id",
            "tp_price": 64000.0,
            "cancelled": False,
        }

        with patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=ex)):
            await ManualTradeService.edit_manual_trade(
                db=db,
                user_id=1,
                api_key_id=7,
                order_id="tp_same_id",
                symbol="BTC/USDT:USDT",
                side="sell",
                amount=1.0,
                new_price=65000.0,
            )

        self.assertEqual(BracketOrderService.ACTIVE_SOFTWARE_SL["sl_sync_1"]["tp_order_id"], "tp_same_id")
        self.assertEqual(BracketOrderService.ACTIVE_SOFTWARE_SL["sl_sync_1"]["tp_price"], 65000.0)
        self.assertEqual(BracketOrderService.ACTIVE_ENTRY_BRACKETS["entry_sync_1"]["tp_order_id"], "tp_same_id")
        self.assertEqual(BracketOrderService.ACTIVE_ENTRY_BRACKETS["entry_sync_1"]["tp_price"], 65000.0)

        # Also test edit_order endpoint directly with mocked edit_manual_trade keeping same ID at new price
        with patch.object(ManualTradeService, "edit_manual_trade", AsyncMock(return_value={"id": "tp_same_id", "price": 66000.0})):
            await trading_ep.edit_order(
                api_key_id=7,
                order_id="tp_same_id",
                request=trading_ep.EditOrderRequest(symbol="BTC/USDT:USDT", side="sell", amount=1.0, new_price=66000.0),
                db=db,
                current_user=user,
            )

        self.assertEqual(BracketOrderService.ACTIVE_SOFTWARE_SL["sl_sync_1"]["tp_price"], 66000.0)
        self.assertEqual(BracketOrderService.ACTIVE_ENTRY_BRACKETS["entry_sync_1"]["tp_price"], 66000.0)

    # ------------------------------------------------------------------
    # Fix 6: Emergency Force Order custom_amount on Linear trim & Inverse
    # ------------------------------------------------------------------
    async def test_emergency_force_order_custom_amount_linear_trim_and_inverse(self):
        db = FakeDB()

        # 6A. Linear Futures opposite position trim with custom_amount=3.5
        ex_lin = MockExchange("ETH/USDT:USDT", is_inverse=False, tick=0.01)
        ex_lin._bids = [[2000.0, 10.0]]
        ex_lin._asks = [[2001.0, 10.0]]
        ex_lin.balance_queue = [{"USDT": {"free": 5000.0, "total": 5000.0}}]

        with patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=ex_lin)), \
             patch.object(ManualTradeService, "get_active_position", AsyncMock(return_value={
                 "amount": 10.0, "contracts": 10.0, "contract_size": 1.0, "is_inverse": False, "side": "long"
             })), \
             patch.object(ManualTradeService, "_is_binance_hedge_mode", AsyncMock(return_value=False)):

            res_lin = await ManualTradeService.execute_emergency_force_order(
                db=db,
                user_id=1,
                api_key_id=7,
                symbol="ETH/USDT:USDT",
                side="sell",
                execution_mode="market",
                size_pct=0,
                custom_amount=3.5,
            )

        self.assertEqual(res_lin["amount"], 3.5)
        self.assertEqual(ex_lin.market_orders[-1]["amount"], 3.5)

        # 6B. COIN-M Inverse Futures opposite position trim with custom_amount=7 contracts
        ex_inv = MockExchange("DOGE/USD:DOGE", is_inverse=True, contract_size=10.0, tick=0.0001)
        ex_inv._bids = [[0.10, 1000.0]]
        ex_inv._asks = [[0.1001, 1000.0]]
        ex_inv.balance_queue = [{"DOGE": {"free": 1000.0, "total": 1000.0}}]

        with patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=ex_inv)), \
             patch.object(ManualTradeService, "get_active_position", AsyncMock(return_value={
                 "amount": 2000.0, "contracts": 20.0, "contract_size": 10.0, "is_inverse": True, "side": "long"
             })), \
             patch.object(ManualTradeService, "_is_binance_hedge_mode", AsyncMock(return_value=False)):

            res_inv_trim = await ManualTradeService.execute_emergency_force_order(
                db=db,
                user_id=1,
                api_key_id=7,
                symbol="DOGE/USD:DOGE",
                side="sell",
                execution_mode="market",
                size_pct=0,
                custom_amount=7,
            )

        self.assertEqual(res_inv_trim["amount"], 7.0)
        self.assertEqual(ex_inv.market_orders[-1]["amount"], 7.0)

        # 6C. COIN-M Inverse Futures entry with custom_amount=15 contracts (instead of 100% margin)
        ex_inv.balance_queue = [{"DOGE": {"free": 1000.0, "total": 1000.0}}]
        with patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=ex_inv)), \
             patch.object(ManualTradeService, "get_active_position", AsyncMock(return_value={
                 "amount": 0.0, "contracts": 0.0, "contract_size": 10.0, "is_inverse": True, "side": "none"
             })), \
             patch.object(ManualTradeService, "_is_binance_hedge_mode", AsyncMock(return_value=False)):

            res_inv_entry = await ManualTradeService.execute_emergency_force_order(
                db=db,
                user_id=1,
                api_key_id=7,
                symbol="DOGE/USD:DOGE",
                side="buy",
                execution_mode="market",
                size_pct=0,
                custom_amount=15,
                leverage=10,
            )

        self.assertEqual(res_inv_entry["amount"], 15.0)
        self.assertEqual(ex_inv.market_orders[-1]["amount"], 15.0)

    # ------------------------------------------------------------------
    # Fix 7: Spot close_active_position extracts raw CCXT base balance
    # ------------------------------------------------------------------
    async def test_close_active_position_spot_unlocks_and_sells_raw_ccxt_balance(self):
        ex = MockExchange("DOGE/USDT", tick=0.0001)
        ex.balance_queue = [
            {"DOGE": {"free": 40.0, "used": 60.0}, "free": {"DOGE": 40.0}, "used": {"DOGE": 60.0}},
            {"DOGE": {"free": 100.0, "used": 0.0}, "free": {"DOGE": 100.0}, "used": {"DOGE": 0.0}},
        ]
        db = FakeDB()

        with patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=ex)):
            res = await ManualTradeService.close_active_position(db=db, user_id=1, api_key_id=7, symbol="DOGE/USDT")

        self.assertTrue(res["success"])
        self.assertEqual(ex.cancel_all_calls, ["DOGE/USDT"])
        self.assertEqual(res["closed_amount"], 100.0)
        self.assertEqual(ex.market_orders[-1]["side"], "sell")
        self.assertEqual(ex.market_orders[-1]["amount"], 100.0)

    # ------------------------------------------------------------------
    # Fix 8: WebSocket order placement records non-zero API latency
    # ------------------------------------------------------------------
    async def test_place_manual_trade_ws_order_latency_is_measured(self):
        ex = MockExchange("DOGE/USDT", tick=0.0001)
        ex.has["createOrderWs"] = True
        ex.balance_queue = [{"USDT": {"free": 1000.0, "total": 1000.0}}]

        async def slow_ws_order(symbol, order_type, side, amount, price, params):
            await asyncio.sleep(0.035)
            return {"id": "ws_ord_1", "symbol": symbol, "side": side, "amount": amount, "price": 0.10, "status": "closed"}

        ex.create_order_ws = slow_ws_order
        db = FakeDB()
        req = SimpleNamespace(
            api_key_id=7,
            exchange_id="binance",
            symbol="DOGE/USDT",
            side="buy",
            type="market",
            amount=50.0,
            price=0.10,
            params={},
            attached_tp=None,
            attached_sl=None,
            use_native_tp_sl=False,
            iceberg_qty=None,
            enable_ml_filter=False,
        )

        with patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=ex)), \
             patch("app.services.manual_trade_service._send_trade_fired_notification", AsyncMock()), \
             self.assertLogs("app.services.manual_trade_service", level="INFO") as cm:
            await ManualTradeService.place_manual_trade(db=db, user_id=1, order_req=req, start_time=time.perf_counter())

        exec_lines = [line for line in cm.output if "[EXEC TIMING]" in line]
        self.assertTrue(exec_lines, "Expected [EXEC TIMING] log line")
        api_part = exec_lines[-1].split("BinanceAPI=")[1].split("ms")[0]
        self.assertGreaterEqual(int(api_part), 20)

    # ------------------------------------------------------------------
    # Fix 9: Emergency Maker Peg sends ONE alert with full params
    # ------------------------------------------------------------------
    async def test_emergency_force_order_maker_peg_single_alert_and_params(self):
        ex = MockExchange("DOGE/USDT:USDT", tick=0.0001)
        ex._bids = [[0.0999, 5000.0]]
        ex._asks = [[0.1001, 5000.0]]
        ex.balance_queue = [{"USDT": {"free": 1000.0, "total": 1000.0}}]
        db = FakeDB()

        peg_calls = []
        notify_calls = []

        async def fake_peg(**kwargs):
            peg_calls.append(kwargs)
            return {"id": "peg_1", "status": "open"}

        async def fake_notify(**kwargs):
            notify_calls.append(kwargs)

        with patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=ex)), \
             patch.object(ManualTradeService, "get_active_position", AsyncMock(return_value={
                 "amount": 0.0, "contracts": 0.0, "contract_size": 1.0, "is_inverse": False, "side": "none"
             })), \
             patch.object(ManualTradeService, "_is_binance_hedge_mode", AsyncMock(return_value=False)), \
             patch.object(peg_exec, "execute_smart_peg_entry", side_effect=fake_peg), \
             patch("app.services.manual_trade_service._send_trade_fired_notification", side_effect=fake_notify):

            t0 = time.perf_counter()
            res = await ManualTradeService.execute_emergency_force_order(
                db=db,
                user_id=1,
                api_key_id=7,
                symbol="DOGE/USDT:USDT",
                side="buy",
                execution_mode="limit_maker",
                size_pct=50.0,
                leverage=15,
                margin_mode="isolated",
                start_time=t0,
            )
            await asyncio.sleep(0)

        self.assertEqual(res["status"], "pegging")
        # Must NOT send duplicate pre-alert inside execute_emergency_force_order
        self.assertEqual(len(notify_calls), 0)
        self.assertEqual(len(peg_calls), 1)
        self.assertEqual(peg_calls[0]["start_time"], t0)
        self.assertEqual(peg_calls[0]["leverage"], 15)
        self.assertEqual(peg_calls[0]["margin_mode"], "isolated")
        self.assertEqual(peg_calls[0]["contract_size"], 1.0)
        self.assertFalse(peg_calls[0]["is_inverse"])
        self.assertTrue(peg_calls[0]["send_initial_notify"])

        # Also test execute_smart_peg_entry send_initial_notify=False vs True when peg order actually lands
        ex2 = MockExchange("DOGE/USDT", tick=0.0001)
        ex2._bids = [[0.0999, 5000.0]]
        ex2._asks = [[0.1001, 5000.0]]
        ex2.balance_queue = [
            {"USDT": {"free": 1000.0, "total": 1000.0}},
            {"USDT": {"free": 1000.0, "total": 1000.0}},
            {"USDT": {"free": 1000.0, "total": 1000.0}},
            {"USDT": {"free": 1000.0, "total": 1000.0}},
        ]

        placed_peg_orders = []

        async def immediate_fill(symbol, side, amount, price, params=None):
            o = {"id": "peg_filled_1", "symbol": symbol, "side": side, "amount": amount, "price": price, "status": "closed", "filled": amount, "average": price}
            placed_peg_orders.append(o)
            return o

        ex2.create_limit_order = immediate_fill
        sent_initial = []

        async def capture_notify(**kwargs):
            sent_initial.append(kwargs)

        with patch("app.services.manual_trade_service._send_trade_fired_notification", side_effect=capture_notify):
            await execute_smart_peg_entry(
                exchange=ex2,
                symbol="DOGE/USDT",
                side="buy",
                amount=100.0,
                is_futures=False,
                user_id=1,
                max_attempts=1,
                send_initial_notify=False,
            )
            await asyncio.sleep(0)
        self.assertEqual(len(placed_peg_orders), 1)
        self.assertEqual(len(sent_initial), 0)

        with patch("app.services.manual_trade_service._send_trade_fired_notification", side_effect=capture_notify):
            await execute_smart_peg_entry(
                exchange=ex2,
                symbol="DOGE/USDT",
                side="buy",
                amount=100.0,
                is_futures=False,
                user_id=1,
                max_attempts=1,
                start_time=time.perf_counter() - 0.02,
                leverage=10,
                margin_mode="isolated",
                contract_size=1.0,
                is_inverse=False,
                send_initial_notify=True,
            )
            await asyncio.sleep(0)
        self.assertEqual(len(placed_peg_orders), 2)
        self.assertEqual(len(sent_initial), 1)
        self.assertEqual(sent_initial[0]["leverage"], 10)
        self.assertEqual(sent_initial[0]["margin_mode"], "isolated")
        self.assertFalse(sent_initial[0]["is_inverse"])
        self.assertGreaterEqual(sent_initial[0]["latency_ms"], 1)

    # ------------------------------------------------------------------
    # Fix 10: MarketDataStreamer separates Spot & Futures instances + main.py pre-warm
    # ------------------------------------------------------------------
    async def test_market_data_streamer_spot_and_futures_isolated_and_main_prewarms_both(self):
        MarketDataStreamer._instance = None
        streamer = MarketDataStreamer()

        class DummyWSEx:
            def __init__(self, opts):
                self.options = dict(opts)
                self.markets = {"BTC/USDT": {}}
                self.closed = False

            async def load_markets(self):
                pass

            async def close(self):
                self.closed = True

        with patch.object(peg_exec, "__name__", peg_exec.__name__), \
             patch("app.services.market_data_streamer.ccxtpro") as mock_pro:
            mock_pro.binance = lambda opts: DummyWSEx(opts)
            mock_pro.kucoinfutures = lambda opts: DummyWSEx(opts)

            fut_ex = await streamer._get_exchange_instance("binance", "BTC/USDT:USDT")
            spot_ex = await streamer._get_exchange_instance("binance", "BTC/USDT")
            kc_ex = await streamer._get_exchange_instance("kucoin", "BTC/USDT:USDT")

            self.assertIsNot(fut_ex, spot_ex)
            self.assertIn("binance_futures", streamer._exchange_instances)
            self.assertIn("binance_spot", streamer._exchange_instances)
            self.assertIn("kucoinfutures_futures", streamer._exchange_instances)
            self.assertEqual(fut_ex.options["options"]["defaultType"], "swap")
            self.assertEqual(spot_ex.options["options"]["defaultType"], "spot")

            # Stopping spot stream must close only binance_spot, leaving binance_futures alive
            streamer._active_streams.update({"binance:BTC/USDT", "binance:BTC/USDT:USDT"})
            await streamer.stop_streaming("binance:BTC/USDT")
            self.assertTrue(spot_ex.closed)
            self.assertFalse(fut_ex.closed)
            self.assertNotIn("binance_spot", streamer._exchange_instances)
            self.assertIn("binance_futures", streamer._exchange_instances)

            await streamer.stop_all()
            self.assertTrue(fut_ex.closed)
            self.assertTrue(kc_ex.closed)
            MarketDataStreamer._instance = None

        # Verify main.py pre-warms BOTH Spot and Futures on MarketDataStreamer
        main_path = os.path.join(BACKEND_DIR, "app", "main.py")
        with open(main_path, "r", encoding="utf-8") as f:
            main_src = f.read()
        tree = ast.parse(main_src)
        prewarm_args = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                if node.func.attr == "_get_exchange_instance":
                    args = [a.value for a in node.args if isinstance(a, ast.Constant)]
                    prewarm_args.append(tuple(args))
        self.assertIn(("binance", "BTC/USDT"), prewarm_args)
        self.assertIn(("binance", "BTC/USDT:USDT"), prewarm_args)

    # ------------------------------------------------------------------
    # Fix 11: ExchangePool REST-only exchange fallback & isolated set_markets
    # ------------------------------------------------------------------
    async def test_exchange_pool_rest_fallback_and_isolated_markets(self):
        import ccxt.async_support as ccxt_async
        import ccxt.pro as ccxtpro

        # 11A. REST-only exchange ('bitbank' is in ccxt.async_support, not ccxt.pro)
        with patch.object(ccxt_async.bitbank, "load_markets", AsyncMock(return_value={})):
            rest_ex = await exchange_pool.get_or_create_exchange(
                api_key_id=901,
                exchange_name="bitbank",
                decrypted_api_key="k",
                decrypted_secret="s",
                is_futures=False,
                purpose="order",
            )
        self.assertEqual(rest_ex.id, "bitbank")

        with self.assertRaises(ValueError):
            await exchange_pool.get_or_create_exchange(
                api_key_id=902,
                exchange_name="definitely_unsupported_exchange_xyz",
                decrypted_api_key="k",
                decrypted_secret="s",
                is_futures=False,
                purpose="order",
            )

        # 11B. Order instance isolates markets/currencies via set_markets (no shared mutable dict aliasing)
        real_gen = ccxtpro.binance({"enableRateLimit": True})
        real_gen.set_markets(
            [{"id": "BTCUSDT", "symbol": "BTC/USDT", "base": "BTC", "quote": "USDT", "spot": True, "linear": False, "inverse": False}],
            {"BTC": {"id": "BTC", "code": "BTC", "precision": 8}},
        )
        async with exchange_pool._pool_lock:
            exchange_pool._pool[exchange_pool._make_cache_key(903, False, "general")] = (real_gen, time.time())

        order_ex = await exchange_pool.get_or_create_exchange(
            api_key_id=903,
            exchange_name="binance",
            decrypted_api_key="k",
            decrypted_secret="s",
            is_futures=False,
            purpose="order",
        )

        self.assertIsNot(order_ex.markets, real_gen.markets)
        self.assertIsNot(order_ex.currencies, real_gen.currencies)
        self.assertIsNot(order_ex.markets["BTC/USDT"], real_gen.markets["BTC/USDT"])
        order_ex.markets["BTC/USDT"]["mutated_by_order"] = True
        self.assertNotIn("mutated_by_order", real_gen.markets["BTC/USDT"])

    async def test_drag_bracket_spot_swing_and_tp_cross_market_and_buy_chase_edit(self):
        ex = MockExchange("DOGE/USDT", tick=0.0001)
        ex._last = 0.10
        db = FakeDB()
        user = SimpleNamespace(id=1)

        spawn_calls = []

        async def fake_spawn(**kwargs):
            spawn_calls.append(kwargs)
            return {"tp_order_id": "tp_new_2", "tp_price": kwargs["tp_config"]["value"]}

        # Spot swing without target_order_id preserves wallet balance fallback
        with patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=ex)), \
             patch.object(ManualTradeService, "get_fast_balance", AsyncMock(return_value={"base_free": 450.0, "quote_free": 50.0})), \
             patch.object(BracketOrderService, "_spawn_bracket_for_amount", side_effect=fake_spawn):

            res_swing = await trading_ep.place_drag_bracket_endpoint(
                trading_ep.PlaceDragBracketRequest(
                    api_key_id=7, symbol="DOGE/USDT", bracket_type="tp", price=0.12, amount=None, is_futures=False
                ),
                db=db,
                current_user=user,
            )
        self.assertEqual(res_swing["amount"], 450.0)
        self.assertEqual(res_swing["entry_side"], "buy")

        # Existing TP dragged below current price resolves entry_side='buy' from ACTIVE_ENTRY_BRACKETS, cancels old TP, updates SL link
        BracketOrderService.ACTIVE_ENTRY_BRACKETS["entry_x"] = {
            "entry_order_id": "entry_x",
            "api_key_id": 7,
            "symbol": "DOGE/USDT",
            "side": "sell",
            "amount": 120.0,
            "tp_order_id": "tp_old_x",
            "tp_price": 0.13,
            "cancelled": False,
        }
        BracketOrderService.ACTIVE_SOFTWARE_SL["sl_x"] = {
            "api_key_id": 7,
            "symbol": "DOGE/USDT",
            "side": "sell",
            "amount": 120.0,
            "tp_order_id": "tp_old_x",
            "entry_order_id": "entry_x",
            "status": "monitoring",
            "cancelled": False,
        }
        with patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=ex)), \
             patch.object(BracketOrderService, "_spawn_bracket_for_amount", side_effect=fake_spawn):

            res_tp = await trading_ep.place_drag_bracket_endpoint(
                trading_ep.PlaceDragBracketRequest(
                    api_key_id=7,
                    symbol="DOGE/USDT",
                    bracket_type="tp",
                    price=0.095,
                    amount=None,
                    is_futures=False,
                    side=None,
                    target_order_id="tp_old_x",
                ),
                db=db,
                current_user=user,
            )
        self.assertEqual(res_tp["entry_side"], "buy")
        self.assertIn("tp_old_x", ex.cancelled_ids)
        self.assertEqual(BracketOrderService.ACTIVE_SOFTWARE_SL["sl_x"]["tp_order_id"], "tp_new_2")
        self.assertEqual(BracketOrderService.ACTIVE_SOFTWARE_SL["sl_x"]["tp_price"], 0.095)

        # Buy-side chase edit via update_software_bracket_endpoint recomputes max_chase_price upward
        ACTIVE_SMART_CHASES["chase_buy_1"] = {
            "chase_id": "chase_buy_1",
            "symbol": "DOGE/USDT",
            "side": "buy",
            "amount": 100.0,
            "original_sl": 0.10,
            "current_maker_price": 0.10,
            "max_deviation_pct": 3.0,
            "max_chase_price": 0.103,
            "target_updated": False,
        }
        with patch.object(BracketOrderService, "_send_sl_modified_notification", AsyncMock()):
            await trading_ep.update_software_bracket_endpoint(
                api_key_id=7,
                sl_id="chase_buy_1",
                req=trading_ep.UpdateSoftwareBracketRequest(symbol="DOGE/USDT", side="buy", new_price=0.11, amount=100.0),
                db=db,
                current_user=user,
            )
        self.assertTrue(ACTIVE_SMART_CHASES["chase_buy_1"]["target_updated"])
        self.assertAlmostEqual(ACTIVE_SMART_CHASES["chase_buy_1"]["max_chase_price"], 0.11 * 1.03, places=8)


if __name__ == "__main__":
    unittest.main(verbosity=2)
