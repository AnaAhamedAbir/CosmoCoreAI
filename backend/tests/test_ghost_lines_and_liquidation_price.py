import asyncio
import importlib.util
import os
import sys
import time
import types
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def _install_missing_stubs() -> None:
    """Install lightweight stubs only when third-party deps are unavailable (host dev env)."""
    if importlib.util.find_spec("redis") is None and "redis" not in sys.modules:
        redis_mod = types.ModuleType("redis")
        redis_exc = types.ModuleType("redis.exceptions")
        redis_async = types.ModuleType("redis.asyncio")
        redis_mod.ConnectionPool = MagicMock()
        redis_mod.Redis = MagicMock()
        redis_mod.from_url = MagicMock()
        redis_exc.ConnectionError = Exception
        redis_async.Redis = object
        redis_async.from_url = MagicMock()
        redis_mod.asyncio = redis_async
        redis_mod.exceptions = redis_exc
        sys.modules["redis"] = redis_mod
        sys.modules["redis.exceptions"] = redis_exc
        sys.modules["redis.asyncio"] = redis_async

    if importlib.util.find_spec("ccxt") is None and "ccxt" not in sys.modules:
        ccxt_mod = types.ModuleType("ccxt")
        ccxt_pro = types.ModuleType("ccxt.pro")
        ccxt_async = types.ModuleType("ccxt.async_support")
        ccxt_pro.Exchange = object
        ccxt_mod.pro = ccxt_pro
        ccxt_mod.async_support = ccxt_async
        sys.modules["ccxt"] = ccxt_mod
        sys.modules["ccxt.pro"] = ccxt_pro
        sys.modules["ccxt.async_support"] = ccxt_async

    if importlib.util.find_spec("fastapi") is None and "fastapi" not in sys.modules:
        fa = types.ModuleType("fastapi")
        fa.HTTPException = Exception
        sys.modules["fastapi"] = fa

    if importlib.util.find_spec("sqlalchemy") is None and "sqlalchemy" not in sys.modules:
        sa = types.ModuleType("sqlalchemy")
        sa_orm = types.ModuleType("sqlalchemy.orm")
        sa_orm.Session = object
        sa.orm = sa_orm
        sys.modules["sqlalchemy"] = sa
        sys.modules["sqlalchemy.orm"] = sa_orm

    if "app.core.config" not in sys.modules:
        cfg = types.ModuleType("app.core.config")
        cfg.settings = SimpleNamespace(
            API_V1_STR="/api/v1",
            REDIS_URL="redis://localhost:6379/0",
            TRUST_PROXY_HEADERS=True,
        )
        sys.modules["app.core.config"] = cfg

    if "app.core.security" not in sys.modules:
        sec = types.ModuleType("app.core.security")
        sec.verify_token = MagicMock(return_value=None)
        sec.decrypt_key = lambda k: k
        sys.modules["app.core.security"] = sec

    if "app.core.redis" not in sys.modules:
        rc = types.ModuleType("app.core.redis")
        rc.redis_manager = SimpleNamespace(get_redis=lambda: None)
        sys.modules["app.core.redis"] = rc

    if "app.db.session" not in sys.modules:
        dbs = types.ModuleType("app.db.session")
        dbs.SessionLocal = MagicMock()
        sys.modules["app.db.session"] = dbs

    if "app.models" not in sys.modules:
        m = types.ModuleType("app.models")
        m.User = type("User", (), {"id": 1, "email": None})
        m.ApiKey = type("ApiKey", (), {"id": None, "user_id": None, "is_enabled": True, "exchange": None})
        sys.modules["app.models"] = m

    if "app.services.notification" not in sys.modules:
        notif = types.ModuleType("app.services.notification")
        notif.NotificationService = SimpleNamespace(send_message=AsyncMock())
        sys.modules["app.services.notification"] = notif

    if "app.services.websocket_manager" not in sys.modules:
        wsm = types.ModuleType("app.services.websocket_manager")
        wsm.manager = SimpleNamespace(broadcast=AsyncMock())
        sys.modules["app.services.websocket_manager"] = wsm


_install_missing_stubs()


class TestGhostLinesAndLiquidationPrice(unittest.TestCase):
    def test_get_active_position_returns_liquidation_price_for_futures_and_zero_for_spot(self):
        from app.services.manual_trade_service import ManualTradeService

        async def _run():
            spot_res = await ManualTradeService.get_active_position(
                db=MagicMock(),
                user_id=1,
                api_key_id=10,
                symbol="BTC/USDT",
            )
            self.assertEqual(spot_res["liquidation_price"], 0.0)
            self.assertEqual(spot_res["side"], "none")

            fake_rec = SimpleNamespace(
                id=10, user_id=1, exchange="binance", api_key="k", secret_key="s", passphrase=None, is_enabled=True
            )
            fake_db = MagicMock()
            fake_db.query.return_value.filter.return_value.first.return_value = fake_rec

            fake_ex = MagicMock()
            fake_ex.id = "binance"
            fake_ex.markets = {
                "DOGE/USDT:USDT": {
                    "id": "DOGEUSDT",
                    "symbol": "DOGE/USDT:USDT",
                    "linear": True,
                    "inverse": False,
                    "contractSize": 1.0,
                }
            }
            fake_ex.fetch_positions = AsyncMock(
                return_value=[
                    {
                        "symbol": "DOGE/USDT:USDT",
                        "contracts": 500.0,
                        "side": "long",
                        "entryPrice": 0.1500,
                        "markPrice": 0.1550,
                        "liquidationPrice": 0.1234,
                        "leverage": 10,
                        "marginMode": "isolated",
                        "unrealizedPnl": 2.5,
                    }
                ]
            )
            ManualTradeService._POSITION_CACHE.pop((10, "DOGE/USDT:USDT"), None)
            try:
                with (
                    patch.object(ManualTradeService, "_lookup_api_key_record", return_value=fake_rec),
                    patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=fake_ex)),
                    patch.object(ManualTradeService, "_prewarm_futures_trading_state", AsyncMock()),
                ):
                    fut_res = await ManualTradeService.get_active_position(
                        db=fake_db,
                        user_id=1,
                        api_key_id=10,
                        symbol="DOGE/USDT:USDT",
                        force_refresh=True,
                    )
                self.assertEqual(fut_res["side"], "long")
                self.assertAlmostEqual(fut_res["liquidation_price"], 0.1234, places=6)
                self.assertEqual(fut_res["leverage"], 10.0)
                self.assertEqual(fut_res["margin_mode"], "isolated")
            finally:
                ManualTradeService._POSITION_CACHE.pop((10, "DOGE/USDT:USDT"), None)

        asyncio.run(_run())

    def test_disaster_sl_replacement_suppresses_inflight_ws_order_added_event(self):
        from app.services.bracket_order_service import BracketOrderService
        from app.services.user_order_stream import _is_internal_disaster_sl_id

        async def _run():
            sl_id = "test-sl-ghost-guard"
            fake_ex = MagicMock()
            fake_ex.id = "binance"
            fake_ex.markets = {
                "DOGE/USDT:USDT": {
                    "id": "DOGEUSDT",
                    "symbol": "DOGE/USDT:USDT",
                    "linear": True,
                    "inverse": False,
                    "contractSize": 1.0,
                }
            }
            fake_ex.price_to_precision = lambda sym, px: f"{float(px):.4f}"
            fake_ex.amount_to_precision = lambda sym, amt: f"{float(amt):.1f}"

            BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id] = {
                "id": sl_id,
                "api_key_id": 42,
                "symbol": "DOGE/USDT:USDT",
                "side": "sell",
                "amount": 100.0,
                "mode": "STOP",
                "type": "fixed",
                "trigger_price": 0.1400,
                "price": 0.1400,
                "disaster_sl_order_id": "old_dis_1",
                "is_futures": True,
                "exchange": fake_ex,
                "cancelled": False,
            }

            observed_inflight_hidden = False

            async def _fake_place_cond(ex, sym, otype, side, amt, stop_price=None, callback_rate=None, extra_params=None):
                nonlocal observed_inflight_hidden
                observed_inflight_hidden = _is_internal_disaster_sl_id(
                    api_key_id=42,
                    oid="new_dis_2",
                    symbol="DOGE/USDT:USDT",
                    side="sell",
                    raw_type="stop_market",
                )
                return {"id": "new_dis_2", "status": "open"}

            try:
                with (
                    patch.object(BracketOrderService, "_cancel_futures_order_universal", AsyncMock(return_value=None)),
                    patch.object(BracketOrderService, "_place_futures_conditional_order", side_effect=_fake_place_cond),
                    patch.object(BracketOrderService, "_apply_futures_exit_params", AsyncMock(return_value={"reduceOnly": True})),
                ):
                    await BracketOrderService.update_software_bracket(
                        sl_id=sl_id,
                        new_price=0.1420,
                        api_key_id=42,
                        user_id=0,
                        send_notify=False,
                    )

                self.assertTrue(observed_inflight_hidden)
                self.assertEqual(BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]["disaster_sl_order_id"], "new_dis_2")
                self.assertTrue(
                    _is_internal_disaster_sl_id(42, "new_dis_2", symbol="DOGE/USDT:USDT", side="sell", raw_type="stop_market")
                )
            finally:
                BracketOrderService.ACTIVE_SOFTWARE_SL.pop(sl_id, None)
                BracketOrderService._KNOWN_DISASTER_SL_IDS.pop("new_dis_2", None)
                BracketOrderService._PENDING_DISASTER_SL_SCOPES.clear()

        asyncio.run(_run())

    def test_edit_manual_trade_preserves_take_profit_market_conditional_type(self):
        from app.services.manual_trade_service import ManualTradeService
        from app.services.bracket_order_service import BracketOrderService

        async def _run():
            fake_rec = SimpleNamespace(
                id=77, user_id=3, exchange="binance", api_key="k", secret_key="s", passphrase=None, is_enabled=True
            )
            fake_db = MagicMock()
            fake_db.query.return_value.filter.return_value.first.return_value = fake_rec

            fake_ex = MagicMock()
            fake_ex.id = "binance"
            fake_ex.markets = {
                "DOGE/USDT:USDT": {
                    "id": "DOGEUSDT",
                    "symbol": "DOGE/USDT:USDT",
                    "linear": True,
                    "inverse": False,
                    "contractSize": 1.0,
                }
            }
            fake_ex.has = {"editOrderWs": False, "editOrder": False, "createOrderWs": False}
            fake_ex.price_to_precision = lambda sym, px: f"{float(px):.4f}"
            fake_ex.amount_to_precision = lambda sym, amt: f"{float(amt):.1f}"

            ManualTradeService._ORDER_META_CACHE[(77, "tp_mkt_1")] = (
                {
                    "id": "tp_mkt_1",
                    "side": "sell",
                    "price": 0.1800,
                    "amount": 100.0,
                    "isSoftwareSL": False,
                    "mode": "TP",
                    "rawType": "take_profit_market",
                },
                time.time(),
            )

            captured_place = []

            async def _fake_place_cond(ex, sym, otype, side, amt, stop_price=None, callback_rate=None, extra_params=None):
                captured_place.append((otype, side, amt, stop_price, dict(extra_params or {})))
                return {"id": "tp_mkt_2", "status": "open", "price": stop_price, "amount": amt}

            try:
                with (
                    patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=fake_ex)),
                    patch.object(ManualTradeService, "_is_binance_hedge_mode", AsyncMock(return_value=False)),
                    patch.object(BracketOrderService, "_cancel_futures_order_universal", AsyncMock(return_value=None)),
                    patch.object(BracketOrderService, "_place_futures_conditional_order", side_effect=_fake_place_cond),
                    patch.object(BracketOrderService, "_apply_futures_exit_params", AsyncMock(return_value={"reduceOnly": True})),
                ):
                    res = await ManualTradeService.edit_manual_trade(
                        db=fake_db,
                        user_id=3,
                        api_key_id=77,
                        order_id="tp_mkt_1",
                        symbol="DOGE/USDT:USDT",
                        side="sell",
                        amount=100.0,
                        new_price=0.1850,
                    )

                self.assertEqual(res["id"], "tp_mkt_2")
                self.assertEqual(len(captured_place), 1)
                self.assertEqual(captured_place[0][0], "TAKE_PROFIT_MARKET")
                self.assertAlmostEqual(captured_place[0][3], 0.1850, places=5)
            finally:
                ManualTradeService._ORDER_META_CACHE.pop((77, "tp_mkt_1"), None)
                ManualTradeService._ORDER_META_CACHE.pop((77, "tp_mkt_2"), None)

        asyncio.run(_run())

    def test_get_open_limit_orders_attaches_linked_entry_price_for_spot_tp_bracket(self):
        from app.services.manual_trade_service import ManualTradeService
        from app.services.bracket_order_service import BracketOrderService

        async def _run():
            fake_rec = SimpleNamespace(
                id=88, user_id=4, exchange="binance", api_key="k", secret_key="s", passphrase=None, is_enabled=True
            )
            fake_db = MagicMock()
            fake_ex = MagicMock()
            fake_ex.id = "binance"
            fake_ex.markets = {"DOGE/FDUSD": {"id": "DOGEFDUSD", "symbol": "DOGE/FDUSD", "linear": False, "inverse": False}}
            fake_ex.fetch_open_orders = AsyncMock(
                return_value=[
                    {
                        "id": "spot_tp_101",
                        "status": "open",
                        "type": "limit",
                        "side": "sell",
                        "price": 0.1650,
                        "amount": 500.0,
                        "filled": 0.0,
                        "remaining": 500.0,
                        "info": {},
                    }
                ]
            )

            BracketOrderService.ACTIVE_ENTRY_BRACKETS["entry_spot_1"] = {
                "entry_order_id": "entry_spot_1",
                "api_key_id": 88,
                "symbol": "DOGE/FDUSD",
                "side": "sell",
                "amount": 500.0,
                "entry_price": 0.1500,
                "tp_order_id": "spot_tp_101",
                "tp_price": 0.1650,
                "cancelled": False,
            }
            ManualTradeService._OPEN_ORDERS_CACHE.pop((88, "DOGE/FDUSD"), None)
            try:
                with (
                    patch.object(ManualTradeService, "_lookup_api_key_record", return_value=fake_rec),
                    patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=fake_ex)),
                    patch("app.services.user_order_stream.ensure_user_order_stream", lambda *_, **__: None),
                ):
                    res = await ManualTradeService.get_open_limit_orders(
                        db=fake_db,
                        user_id=4,
                        api_key_id=88,
                        symbol="DOGE/FDUSD",
                        force_refresh=True,
                    )
                orders = res.get("orders") or []
                self.assertEqual(len(orders), 1)
                self.assertEqual(orders[0]["mode"], "TP")
                self.assertAlmostEqual(orders[0]["entryPrice"], 0.1500, places=6)
            finally:
                BracketOrderService.ACTIVE_ENTRY_BRACKETS.pop("entry_spot_1", None)
                ManualTradeService._OPEN_ORDERS_CACHE.pop((88, "DOGE/FDUSD"), None)
                ManualTradeService._ORDER_META_CACHE.pop((88, "spot_tp_101"), None)

        asyncio.run(_run())

    def test_mark_entry_bracket_closed_preserves_on_entry_fill_and_clears_on_tp_terminal(self):
        from app.services.bracket_order_service import BracketOrderService

        BracketOrderService.ACTIVE_ENTRY_BRACKETS["entry_tp_only_1"] = {
            "entry_order_id": "entry_tp_only_1",
            "api_key_id": 89,
            "symbol": "DOGE/FDUSD",
            "side": "sell",
            "amount": 250.0,
            "entry_price": 0.1550,
            "tp_order_id": "spot_tp_only_202",
            "tp_price": 0.1700,
            "cancelled": False,
        }
        BracketOrderService.KNOWN_TP_ORDER_IDS.add("spot_tp_only_202")
        try:
            # Simulates user_order_stream on entry fill: status="closed" passes entry_order_id=None, tp_order_id=oid
            BracketOrderService._mark_entry_bracket_closed(entry_order_id=None, tp_order_id="entry_tp_only_1")
            self.assertIn("entry_tp_only_1", BracketOrderService.ACTIVE_ENTRY_BRACKETS)
            self.assertIn("spot_tp_only_202", BracketOrderService.KNOWN_TP_ORDER_IDS)

            # Simulates user_order_stream on TP fill: clears ACTIVE_ENTRY_BRACKETS + KNOWN_TP_ORDER_IDS
            BracketOrderService._mark_entry_bracket_closed(entry_order_id=None, tp_order_id="spot_tp_only_202")
            self.assertNotIn("entry_tp_only_1", BracketOrderService.ACTIVE_ENTRY_BRACKETS)
            self.assertNotIn("spot_tp_only_202", BracketOrderService.KNOWN_TP_ORDER_IDS)
        finally:
            BracketOrderService.ACTIVE_ENTRY_BRACKETS.pop("entry_tp_only_1", None)
            BracketOrderService.KNOWN_TP_ORDER_IDS.discard("spot_tp_only_202")


if __name__ == "__main__":
    unittest.main()
