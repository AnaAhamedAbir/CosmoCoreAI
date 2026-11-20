import asyncio
import os
import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def _install_stubs():
    """Install lightweight stubs for third-party modules absent in standalone Windows Python."""
    if "fastapi" not in sys.modules:
        fastapi_mod = types.ModuleType("fastapi")

        class HTTPException(Exception):
            def __init__(self, status_code=400, detail=""):
                super().__init__(detail)
                self.status_code = status_code
                self.detail = detail

        fastapi_mod.HTTPException = HTTPException
        sys.modules["fastapi"] = fastapi_mod

    if "sqlalchemy" not in sys.modules:
        sa_mod = types.ModuleType("sqlalchemy")
        sa_orm = types.ModuleType("sqlalchemy.orm")
        sa_sql = types.ModuleType("sqlalchemy.sql")

        class _Col:
            def __init__(self, name="col"):
                self.name = name

            def __eq__(self, other):
                return ("eq", self.name, other)

            def in_(self, values):
                return ("in", self.name, list(values))

            def asc(self):
                return ("asc", self.name)

        def _dummy(*args, **kwargs):
            return _Col(args[0] if args else "col")

        class _Func:
            @staticmethod
            def now():
                return None

        sa_mod.Boolean = _dummy
        sa_mod.Column = lambda *a, **kw: _Col()
        sa_mod.DateTime = _dummy
        sa_mod.Float = _dummy
        sa_mod.ForeignKey = _dummy
        sa_mod.Integer = _dummy
        sa_mod.JSON = _dummy
        sa_mod.String = _dummy
        sa_mod.create_engine = lambda *a, **kw: None
        sa_orm.Session = object
        sa_orm.sessionmaker = lambda *a, **kw: (lambda: None)
        sa_sql.func = _Func
        sa_mod.orm = sa_orm
        sa_mod.sql = sa_sql
        sys.modules["sqlalchemy"] = sa_mod
        sys.modules["sqlalchemy.orm"] = sa_orm
        sys.modules["sqlalchemy.sql"] = sa_sql

    if "app.db.base_class" not in sys.modules:
        bc_mod = types.ModuleType("app.db.base_class")

        class Base:
            pass

        bc_mod.Base = Base
        sys.modules["app.db.base_class"] = bc_mod

    if "app.core.security" not in sys.modules:
        sec_mod = types.ModuleType("app.core.security")
        sec_mod.decrypt_key = lambda v: v
        sys.modules["app.core.security"] = sec_mod

    if "app.core.config" not in sys.modules:
        cfg_mod = types.ModuleType("app.core.config")
        cfg_mod.settings = SimpleNamespace(REDIS_URL="redis://localhost:6379/0", DATABASE_URL="sqlite://")
        sys.modules["app.core.config"] = cfg_mod

    if "app.services.exchange_pool" not in sys.modules:
        ep_mod = types.ModuleType("app.services.exchange_pool")

        async def get_or_create_exchange(*args, **kwargs):
            return None

        ep_mod.get_or_create_exchange = get_or_create_exchange
        ep_mod.is_ws_api_ready = lambda *a, **kw: False
        sys.modules["app.services.exchange_pool"] = ep_mod

    if "app.services.notification" not in sys.modules:
        notif_mod = types.ModuleType("app.services.notification")

        class NotificationService:
            sent_messages = []

            @staticmethod
            async def send_message(db, user_id, msg, **kwargs):
                NotificationService.sent_messages.append((user_id, msg, kwargs))

        notif_mod.NotificationService = NotificationService
        sys.modules["app.services.notification"] = notif_mod

    if "app.services.user_order_stream" not in sys.modules:
        uos_mod = types.ModuleType("app.services.user_order_stream")
        uos_mod.ensure_user_order_stream = lambda *a, **kw: None
        uos_mod.mark_order_replaced = lambda *a, **kw: None

        async def publish_order_sync_event(*args, **kwargs):
            return None

        async def _get_redis_pub():
            return None

        uos_mod.publish_order_sync_event = publish_order_sync_event
        uos_mod._get_redis_pub = _get_redis_pub
        sys.modules["app.services.user_order_stream"] = uos_mod


_install_stubs()


class _FakeColumn:
    def __init__(self, name):
        self.name = name

    def __eq__(self, other):
        return ("eq", self.name, other)

    def in_(self, values):
        return ("in", self.name, list(values))

    def asc(self):
        return ("asc", self.name)


class FakeManualTradeMonitor:
    __tablename__ = "manual_trade_monitors"
    id = _FakeColumn("id")
    monitor_id = _FakeColumn("monitor_id")
    kind = _FakeColumn("kind")
    user_id = _FakeColumn("user_id")
    api_key_id = _FakeColumn("api_key_id")
    symbol = _FakeColumn("symbol")
    status = _FakeColumn("status")

    class _Table:
        @staticmethod
        def create(bind=None, checkfirst=True):
            return True

    __table__ = _Table()

    def __init__(self, **kwargs):
        self.id = kwargs.get("id", 0)
        for k, v in kwargs.items():
            setattr(self, k, v)


class FakeApiKey:
    id = _FakeColumn("id")
    is_enabled = _FakeColumn("is_enabled")

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


class InMemoryStore:
    def __init__(self):
        self.monitors = []
        self.api_keys = []
        self._next_id = 1


class _FakeQuery:
    def __init__(self, store: InMemoryStore, model_cls):
        self.store = store
        self.model_cls = model_cls
        self.filters = []

    def filter(self, *conds):
        self.filters.extend(conds)
        return self

    def order_by(self, *args):
        return self

    def _matches(self, row):
        for cond in self.filters:
            if isinstance(cond, tuple):
                op, field, val = cond
                row_val = getattr(row, field, None)
                if op == "eq" and row_val != val:
                    return False
                if op == "in" and row_val not in val:
                    return False
        return True

    def all(self):
        items = self.store.monitors if self.model_cls is FakeManualTradeMonitor else self.store.api_keys
        return [r for r in items if self._matches(r)]

    def first(self):
        res = self.all()
        return res[0] if res else None


class FakeSession:
    def __init__(self, store: InMemoryStore):
        self.store = store
        self.pending = []

    def query(self, model_cls):
        return _FakeQuery(self.store, model_cls)

    def add(self, obj):
        if getattr(obj, "id", 0) == 0:
            obj.id = self.store._next_id
            self.store._next_id += 1
        self.pending.append(obj)

    def commit(self):
        for obj in self.pending:
            if obj not in self.store.monitors:
                self.store.monitors.append(obj)
        self.pending.clear()

    def rollback(self):
        self.pending.clear()

    def close(self):
        pass


# Register fake models & session cleanly before importing recovery/persistence modules
fake_store = InMemoryStore()

db_sess_mod = types.ModuleType("app.db.session")
db_sess_mod.engine = object()
db_sess_mod.SessionLocal = lambda: FakeSession(fake_store)
sys.modules["app.db.session"] = db_sess_mod

mon_mod = types.ModuleType("app.models.manual_trade_monitor")
mon_mod.ManualTradeMonitor = FakeManualTradeMonitor
sys.modules["app.models.manual_trade_monitor"] = mon_mod

models_mod = types.ModuleType("app.models")
models_mod.ApiKey = FakeApiKey
models_mod.ManualTradeMonitor = FakeManualTradeMonitor
sys.modules["app.models"] = models_mod

from app.services import manual_trade_persistence as persistence  # noqa: E402
from app.services import manual_trade_recovery as recovery  # noqa: E402
from app.services.bracket_order_service import BracketOrderService  # noqa: E402
from app.services import manual_smart_chase_executor as chase_exec  # noqa: E402
from app.services import smart_peg_entry_executor as peg_exec  # noqa: E402


class MockExchange:
    def __init__(self, symbol="BTC/USDT:USDT"):
        self.id = "binance"
        self.symbol = symbol
        self.markets = {
            symbol: {
                "symbol": symbol,
                "base": symbol.split("/")[0],
                "quote": symbol.split("/")[1].split(":")[0],
                "inverse": False,
                "subType": "linear",
                "contractSize": 1.0,
                "precision": {"price": 0.01, "amount": 0.001},
                "limits": {"cost": {"min": 5.0}},
            }
        }
        self.orders = {}
        self.positions = []
        self.balances = {}
        self.cancelled = []

    def price_to_precision(self, symbol, price):
        return f"{round(float(price), 2):.2f}"

    def amount_to_precision(self, symbol, amount):
        return f"{round(float(amount), 4):.4f}"

    async def fetch_order(self, order_id, symbol, params=None):
        return self.orders.get(str(order_id), {"id": str(order_id), "status": "open", "filled": 0.0})

    async def cancel_order(self, order_id, symbol, params=None):
        self.cancelled.append((str(order_id), symbol, dict(params or {})))
        if str(order_id) in self.orders:
            self.orders[str(order_id)]["status"] = "canceled"
        return {"id": str(order_id), "status": "canceled", "filled": 0.0}

    async def fetch_positions(self, symbols=None, params=None):
        return list(self.positions)

    async def fetch_balance(self, params=None):
        return dict(self.balances)

    async def fetch_ticker(self, symbol):
        return {"last": 50000.0, "bid": 49999.0, "ask": 50001.0}

    async def fetch_order_book(self, symbol, limit=5):
        return {"bids": [[49999.0, 10.0]], "asks": [[50001.0, 10.0]]}


class TestManualTradeAutoRecovery(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        fake_store.monitors.clear()
        fake_store.api_keys = [
            FakeApiKey(
                id=7,
                user_id=42,
                exchange="binance",
                api_key="k",
                secret_key="s",
                passphrase=None,
                is_enabled=True,
            )
        ]
        fake_store._next_id = 1
        persistence._LAST_HWM_PERSIST.clear()
        BracketOrderService.ACTIVE_SOFTWARE_SL.clear()
        BracketOrderService.ACTIVE_ENTRY_BRACKETS.clear()
        BracketOrderService.ACTIVE_ENTRY_MONITORS.clear()
        BracketOrderService.KNOWN_TP_ORDER_IDS.clear()
        chase_exec.ACTIVE_SMART_CHASES.clear()
        peg_exec.ACTIVE_SMART_PEGS.clear()

    def test_persistence_upsert_update_migrate_and_scope_isolation(self):
        ok = persistence.upsert_monitor_sync(
            monitor_id="sl-spot-1",
            kind="software_sl",
            user_id=42,
            api_key_id=7,
            symbol="BTC/USDT",
            is_futures=False,
            side="sell",
            status="monitoring",
            sl_type="smart_chase",
            amount=0.5,
            entry_price=60000.0,
            trigger_price=58000.0,
            tp_order_id="tp-1",
            tp_price=65000.0,
        )
        self.assertTrue(ok)
        persistence.upsert_monitor_sync(
            monitor_id="sl-fut-1",
            kind="software_sl",
            user_id=42,
            api_key_id=7,
            symbol="BTC/USDT:USDT",
            is_futures=True,
            side="sell",
            status="monitoring",
            sl_type="fixed",
            amount=0.5,
            entry_price=60000.0,
            trigger_price=58000.0,
        )
        # Cancelling Spot BTC/USDT must NOT cancel Futures BTC/USDT:USDT
        cleared = persistence.mark_terminal_by_scope_sync(7, "BTC/USDT", status="cancelled")
        self.assertEqual(cleared, 1)
        by_id = {r.monitor_id: r for r in fake_store.monitors}
        self.assertEqual(by_id["sl-spot-1"].status, "cancelled")
        self.assertEqual(by_id["sl-fut-1"].status, "monitoring")

        # Entry monitor ID migration on cancelReplace
        persistence.upsert_monitor_sync(
            monitor_id="entry-100",
            kind="entry_monitor",
            user_id=42,
            api_key_id=7,
            symbol="DOGE/FDUSD",
            is_futures=False,
            side="buy",
            status="monitoring",
            amount=1000.0,
            entry_price=0.15,
            entry_order_id="entry-100",
        )
        self.assertTrue(persistence.replace_entry_monitor_id_sync("entry-100", "entry-200"))
        self.assertEqual(fake_store.monitors[-1].monitor_id, "entry-200")
        self.assertEqual(fake_store.monitors[-1].entry_order_id, "entry-200")

    async def test_recover_smart_chase_sl_when_futures_position_open(self):
        persistence.upsert_monitor_sync(
            monitor_id="sl-chase-resume-1",
            kind="software_sl",
            user_id=42,
            api_key_id=7,
            symbol="BTC/USDT:USDT",
            is_futures=True,
            side="sell",
            status="monitoring",
            sl_type="smart_chase",
            sl_mode="SMART_CHASE",
            amount=0.25,
            entry_price=60000.0,
            trigger_price=58500.0,
            entry_order_id="ent-1",
            tp_order_id="tp-999",
            tp_price=64000.0,
            disaster_sl_order_id="dis-888",
            breakeven_activated=True,
            config={"max_deviation_pct": 1.5, "chase_mode": "dynamic_bbo"},
        )
        ex = MockExchange("BTC/USDT:USDT")
        ex.orders["tp-999"] = {"id": "tp-999", "status": "open", "filled": 0.0}
        ex.orders["dis-888"] = {"id": "dis-888", "status": "open", "filled": 0.0}
        ex.positions = [{"symbol": "BTC/USDT:USDT", "contracts": 0.25, "info": {"symbol": "BTCUSDT", "positionSide": "LONG", "positionAmt": "0.25"}}]

        loop_mock = AsyncMock()
        with (
            patch.object(recovery, "_get_exchanges_for_record", AsyncMock(return_value=(ex, ex))),
            patch.object(BracketOrderService, "_smart_chase_monitor_loop", loop_mock),
        ):
            summary = await recovery.recover_manual_trade_monitors(startup_delay_seconds=0.0)
            await asyncio.sleep(0)

        self.assertEqual(summary["resumed"], 1)
        self.assertIn("tp-999", BracketOrderService.KNOWN_TP_ORDER_IDS)
        self.assertIn("ent-1", BracketOrderService.ACTIVE_ENTRY_BRACKETS)
        loop_mock.assert_awaited_once()
        kwargs = loop_mock.call_args.kwargs
        self.assertEqual(kwargs["sl_id"], "sl-chase-resume-1")
        self.assertEqual(kwargs["sl_price"], 58500.0)
        self.assertTrue(kwargs["initial_breakeven_activated"])
        self.assertEqual(kwargs["tp_order_id"], "tp-999")
        self.assertEqual(kwargs["disaster_sl_order_id"], "dis-888")

    async def test_recover_trailing_sl_preserves_high_water_mark(self):
        persistence.upsert_monitor_sync(
            monitor_id="sl-trail-1",
            kind="software_sl",
            user_id=42,
            api_key_id=7,
            symbol="BTC/USDT:USDT",
            is_futures=True,
            side="sell",
            status="monitoring",
            sl_type="trailing_chase",
            sl_mode="TRAILING_CHASE",
            amount=0.5,
            entry_price=60000.0,
            trigger_price=61880.0,
            highest_price=63140.0,
            lowest_price=60000.0,
            manual_trigger_override=61000.0,
            config={"val": 2.0, "sl_mode_raw": "percentage", "is_smart_chase_exit": True},
        )
        ex = MockExchange("BTC/USDT:USDT")
        ex.positions = [{"symbol": "BTC/USDT:USDT", "contracts": 0.5, "info": {"symbol": "BTCUSDT", "positionSide": "LONG", "positionAmt": "0.5"}}]

        trail_mock = AsyncMock()
        with (
            patch.object(recovery, "_get_exchanges_for_record", AsyncMock(return_value=(ex, ex))),
            patch.object(BracketOrderService, "_software_trailing_stop_loop", trail_mock),
        ):
            summary = await recovery.recover_manual_trade_monitors(startup_delay_seconds=0.0)
            await asyncio.sleep(0)

        self.assertEqual(summary["resumed"], 1)
        trail_mock.assert_awaited_once()
        kwargs = trail_mock.call_args.kwargs
        self.assertEqual(kwargs["sl_id"], "sl-trail-1")
        self.assertEqual(kwargs["initial_highest_price"], 63140.0)
        self.assertEqual(kwargs["initial_manual_trigger_override"], 61000.0)
        self.assertTrue(kwargs["is_smart_chase_exit"])

    async def test_recover_skips_and_cleans_up_when_tp_filled_offline(self):
        persistence.upsert_monitor_sync(
            monitor_id="sl-already-won",
            kind="software_sl",
            user_id=42,
            api_key_id=7,
            symbol="BTC/USDT:USDT",
            is_futures=True,
            side="sell",
            status="monitoring",
            sl_type="smart_chase",
            amount=0.2,
            entry_price=60000.0,
            trigger_price=58500.0,
            tp_order_id="tp-filled-1",
            disaster_sl_order_id="dis-orphan-1",
        )
        ex = MockExchange("BTC/USDT:USDT")
        ex.orders["tp-filled-1"] = {"id": "tp-filled-1", "status": "closed", "filled": 0.2, "average": 64000.0}

        loop_mock = AsyncMock()
        with (
            patch.object(recovery, "_get_exchanges_for_record", AsyncMock(return_value=(ex, ex))),
            patch.object(BracketOrderService, "_smart_chase_monitor_loop", loop_mock),
        ):
            summary = await recovery.recover_manual_trade_monitors(startup_delay_seconds=0.0)
            await asyncio.sleep(0)

        self.assertEqual(summary["completed_offline"], 1)
        self.assertEqual(summary["resumed"], 0)
        loop_mock.assert_not_awaited()
        self.assertEqual(fake_store.monitors[0].status, "completed")
        self.assertTrue(any(cid == "dis-orphan-1" for cid, _, _ in ex.cancelled))

    async def test_recover_entry_monitor_spawns_brackets_if_filled_offline(self):
        persistence.upsert_monitor_sync(
            monitor_id="entry-filled-offline",
            kind="entry_monitor",
            user_id=42,
            api_key_id=7,
            symbol="DOGE/USDT",
            is_futures=False,
            side="buy",
            status="monitoring",
            amount=1000.0,
            entry_price=0.20,
            entry_order_id="entry-filled-offline",
            config={
                "tp_config": {"enabled": True, "mode": "percentage", "value": 5.0, "order_type": "Limit"},
                "sl_config": {"enabled": True, "type": "smart_chase", "mode": "percentage", "value": 2.0},
                "processed_amount": 0.0,
            },
        )
        ex = MockExchange("DOGE/USDT")
        ex.orders["entry-filled-offline"] = {
            "id": "entry-filled-offline",
            "status": "closed",
            "filled": 1000.0,
            "average": 0.198,
        }

        spawn_mock = AsyncMock()
        with (
            patch.object(recovery, "_get_exchanges_for_record", AsyncMock(return_value=(ex, ex))),
            patch.object(BracketOrderService, "_spawn_bracket_for_amount", spawn_mock),
        ):
            summary = await recovery.recover_manual_trade_monitors(startup_delay_seconds=0.0)
            await asyncio.sleep(0)

        self.assertEqual(summary["completed_offline"], 1)
        spawn_mock.assert_awaited_once()
        self.assertEqual(fake_store.monitors[0].status, "completed")

    async def test_recover_active_smart_chase_cancels_stale_order_and_resumes(self):
        persistence.upsert_monitor_sync(
            monitor_id="chase-active-1",
            kind="smart_chase",
            user_id=42,
            api_key_id=7,
            symbol="BTC/USDT:USDT",
            is_futures=True,
            side="sell",
            status="chasing",
            sl_type="smart_chase",
            amount=1.0,
            entry_price=60000.0,
            trigger_price=59000.0,
            config={
                "original_sl": 59000.0,
                "current_order_id": "stale-maker-1",
                "max_deviation_pct": 1.0,
            },
        )
        ex = MockExchange("BTC/USDT:USDT")
        ex.positions = [{"symbol": "BTC/USDT:USDT", "contracts": 1.0, "info": {"symbol": "BTCUSDT", "positionSide": "LONG", "positionAmt": "1.0"}}]
        ex.orders["stale-maker-1"] = {"id": "stale-maker-1", "status": "open", "filled": 0.3}

        chase_mock = AsyncMock()
        with (
            patch.object(recovery, "_get_exchanges_for_record", AsyncMock(return_value=(ex, ex))),
            patch.object(chase_exec, "execute_manual_smart_chase", chase_mock),
        ):
            summary = await recovery.recover_manual_trade_monitors(startup_delay_seconds=0.0)
            await asyncio.sleep(0)

        self.assertEqual(summary["resumed"], 1)
        self.assertTrue(any(cid == "stale-maker-1" for cid, _, _ in ex.cancelled))
        chase_mock.assert_awaited_once()
        self.assertEqual(chase_mock.call_args.kwargs["chase_id"], "chase-active-1")
        self.assertAlmostEqual(chase_mock.call_args.kwargs["sell_amount_raw"], 0.7, places=4)

    def test_async_fifo_persistence_ordering(self):
        persistence.schedule_upsert_monitor(
            monitor_id="fifo-1",
            kind="software_sl",
            user_id=42,
            api_key_id=7,
            symbol="ETH/USDT",
            is_futures=False,
            side="sell",
            status="monitoring",
            sl_type="fixed",
            amount=2.0,
            entry_price=3000.0,
            trigger_price=2850.0,
        )
        persistence.schedule_update_monitor(
            "fifo-1",
            fields={"trigger_price": 3010.0, "breakeven_activated": True},
        )
        persistence.schedule_mark_terminal("fifo-1", status="completed", reason="fifo_done")
        persistence._PERSIST_EXECUTOR.submit(lambda: None).result(timeout=2.0)

        by_id = {r.monitor_id: r for r in fake_store.monitors}
        self.assertIn("fifo-1", by_id)
        row = by_id["fifo-1"]
        self.assertEqual(row.trigger_price, 3010.0)
        self.assertTrue(row.breakeven_activated)
        self.assertEqual(row.status, "completed")
        self.assertEqual((row.config or {}).get("terminal_reason"), "fifo_done")

    async def test_recover_restores_initial_trigger_price_and_manual_override(self):
        persistence.upsert_monitor_sync(
            monitor_id="sl-trail-trig-1",
            kind="software_sl",
            user_id=42,
            api_key_id=7,
            symbol="BTC/USDT:USDT",
            is_futures=True,
            side="sell",
            status="monitoring",
            sl_type="trailing",
            sl_mode="percentage",
            amount=0.4,
            entry_price=60000.0,
            trigger_price=61880.0,
            highest_price=63140.0,
            lowest_price=60000.0,
            manual_trigger_override=61000.0,
            config={"val": 2.0, "sl_mode_raw": "percentage"},
        )
        persistence.upsert_monitor_sync(
            monitor_id="sl-fixed-override-1",
            kind="software_sl",
            user_id=42,
            api_key_id=7,
            symbol="ETH/USDT:USDT",
            is_futures=True,
            side="sell",
            status="monitoring",
            sl_type="fixed",
            sl_mode="STOP",
            amount=1.0,
            entry_price=3000.0,
            trigger_price=2950.0,
            manual_trigger_override=2960.0,
            config={"auto_breakeven_enabled": True},
        )
        ex = MockExchange("BTC/USDT:USDT")
        ex.positions = [
            {"symbol": "BTC/USDT:USDT", "contracts": 0.4, "info": {"symbol": "BTCUSDT", "positionSide": "LONG", "positionAmt": "0.4"}},
            {"symbol": "ETH/USDT:USDT", "contracts": 1.0, "info": {"symbol": "ETHUSDT", "positionSide": "LONG", "positionAmt": "1.0"}},
        ]

        trail_mock = AsyncMock()
        fixed_mock = AsyncMock()
        with (
            patch.object(recovery, "_get_exchanges_for_record", AsyncMock(return_value=(ex, ex))),
            patch.object(BracketOrderService, "_software_trailing_stop_loop", trail_mock),
            patch.object(BracketOrderService, "_fixed_sl_auto_breakeven_loop", fixed_mock),
        ):
            summary = await recovery.recover_manual_trade_monitors(startup_delay_seconds=0.0)
            await asyncio.sleep(0)

        self.assertEqual(summary["resumed"], 2)
        self.assertEqual(trail_mock.call_args.kwargs["initial_trigger_price"], 61880.0)
        self.assertEqual(trail_mock.call_args.kwargs["initial_manual_trigger_override"], 61000.0)
        self.assertEqual(fixed_mock.call_args.kwargs["initial_manual_trigger_override"], 2960.0)

    async def test_recover_spot_clamps_partial_tp_balance(self):
        persistence.upsert_monitor_sync(
            monitor_id="sl-spot-partial-tp",
            kind="software_sl",
            user_id=42,
            api_key_id=7,
            symbol="BTC/USDT",
            is_futures=False,
            side="sell",
            status="monitoring",
            sl_type="smart_chase",
            sl_mode="SMART_CHASE",
            amount=1.0,
            entry_price=60000.0,
            trigger_price=58000.0,
            tp_order_id="tp-spot-part",
            tp_price=65000.0,
        )
        ex = MockExchange("BTC/USDT")
        ex.orders["tp-spot-part"] = {"id": "tp-spot-part", "status": "open", "filled": 0.4}
        ex.balances = {"free": {"BTC": 0.6}, "total": {"BTC": 0.6}}

        chase_mock = AsyncMock()
        with (
            patch.object(recovery, "_get_exchanges_for_record", AsyncMock(return_value=(ex, ex))),
            patch.object(BracketOrderService, "_smart_chase_monitor_loop", chase_mock),
        ):
            summary = await recovery.recover_manual_trade_monitors(startup_delay_seconds=0.0)
            await asyncio.sleep(0)

        self.assertEqual(summary["resumed"], 1)
        self.assertAlmostEqual(chase_mock.call_args.kwargs["amount"], 0.6, places=4)

    async def test_recover_native_otoco_passes_skip_entry_fill_notify(self):
        persistence.upsert_monitor_sync(
            monitor_id="otoco:55",
            kind="native_otoco",
            user_id=42,
            api_key_id=7,
            symbol="BTC/USDT",
            is_futures=False,
            side="buy",
            status="monitoring",
            amount=0.1,
            entry_price=60000.0,
            tp_order_id="otoco-tp-55",
            config={"raw_res": {"orderListId": 55, "orderReports": []}, "working_filled": True},
        )
        ex = MockExchange("BTC/USDT")
        ex.orders["otoco-tp-55"] = {"id": "otoco-tp-55", "status": "open", "filled": 0.0}

        otoco_mock = AsyncMock()
        with (
            patch.object(recovery, "_get_exchanges_for_record", AsyncMock(return_value=(ex, ex))),
            patch.object(BracketOrderService, "monitor_native_otoco", otoco_mock),
        ):
            summary = await recovery.recover_manual_trade_monitors(startup_delay_seconds=0.0)
            await asyncio.sleep(0)

        self.assertEqual(summary["resumed"], 1)
        otoco_mock.assert_awaited_once()
        self.assertEqual(otoco_mock.call_args.kwargs["api_key_id"], 7)
        self.assertTrue(otoco_mock.call_args.kwargs["skip_entry_fill_notify"])

    async def test_fixed_sl_loop_survives_transient_connection_drop_and_shutdown_cancel(self):
        ex = MockExchange("BTC/USDT:USDT")
        call_count = 0

        async def flaky_ticker(exchange_arg, symbol_arg, require_last=True):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ConnectionError("Temporary VPS connection drop")
            return {"last": 60500.0, "bid": 60499.0, "ask": 60501.0}

        api_key_rec = fake_store.api_keys[0]
        orig_sleep = asyncio.sleep

        async def fast_sleep(delay):
            await orig_sleep(0.01 if delay >= 1.0 else delay)

        with (
            patch.object(BracketOrderService, "_fetch_ticker_fast", side_effect=flaky_ticker),
            patch("app.services.bracket_order_service.asyncio.sleep", side_effect=fast_sleep),
        ):
            task = asyncio.create_task(
                BracketOrderService._fixed_sl_auto_breakeven_loop(
                    exchange=ex,
                    symbol="BTC/USDT:USDT",
                    opposite_side="sell",
                    amount=0.5,
                    entry_price=60000.0,
                    initial_sl_price=59000.0,
                    is_futures=True,
                    user_id=42,
                    api_key_record=api_key_rec,
                    sl_id="sl-fixed-netdrop",
                )
            )
            # Wait enough ticks for transient ConnectionError + successful recovery tick
            for _ in range(30):
                if call_count >= 2:
                    break
                await orig_sleep(0.01)

            self.assertGreaterEqual(call_count, 2)
            self.assertIn("sl-fixed-netdrop", BracketOrderService.ACTIVE_SOFTWARE_SL)
            self.assertFalse(task.done())

            # Simulate server shutdown task cancellation
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        # Wait for FIFO executor flush and ensure DB row stayed 'monitoring' (not marked terminal on shutdown)
        persistence._PERSIST_EXECUTOR.submit(lambda: None).result(timeout=2.0)
        by_id = {r.monitor_id: r for r in fake_store.monitors}
        self.assertIn("sl-fixed-netdrop", by_id)
        self.assertEqual(by_id["sl-fixed-netdrop"].status, "monitoring")

    async def test_recovery_retries_on_transient_boot_network_error(self):
        persistence.upsert_monitor_sync(
            monitor_id="sl-boot-retry-1",
            kind="software_sl",
            user_id=42,
            api_key_id=7,
            symbol="BTC/USDT:USDT",
            is_futures=True,
            side="sell",
            status="monitoring",
            sl_type="smart_chase",
            amount=0.3,
            entry_price=60000.0,
            trigger_price=58500.0,
        )
        ex = MockExchange("BTC/USDT:USDT")
        ex.positions = [{"symbol": "BTC/USDT:USDT", "contracts": 0.3, "info": {"symbol": "BTCUSDT", "positionSide": "LONG", "positionAmt": "0.3"}}]

        attempts = 0

        async def flaky_exchanges(rec, is_fut):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise ConnectionError("Boot DNS not ready")
            return ex, ex

        chase_mock = AsyncMock()
        with (
            patch.object(recovery, "RECOVERY_RETRY_DELAYS", (0.01,)),
            patch.object(recovery, "_get_exchanges_for_record", side_effect=flaky_exchanges),
            patch.object(BracketOrderService, "_smart_chase_monitor_loop", chase_mock),
        ):
            summary = await recovery.recover_manual_trade_monitors(startup_delay_seconds=0.0)
            await asyncio.sleep(0)

        self.assertEqual(attempts, 2)
        self.assertEqual(summary["errors"], 0)
        self.assertEqual(summary["resumed"], 1)
        chase_mock.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
