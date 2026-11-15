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

        class Session:
            pass

        sa_orm.Session = Session
        sa_mod.orm = sa_orm
        sys.modules["sqlalchemy"] = sa_mod
        sys.modules["sqlalchemy.orm"] = sa_orm

    if "app.core.redis" not in sys.modules:
        redis_core = types.ModuleType("app.core.redis")

        class _DummyRedisManager:
            def get_redis(self):
                return None

        redis_core.redis_manager = _DummyRedisManager()
        sys.modules["app.core.redis"] = redis_core

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

        models_mod.ApiKey = ApiKey
        sys.modules["app.models"] = models_mod

    if "app.services.notification" not in sys.modules:
        notif_mod = types.ModuleType("app.services.notification")

        class NotificationService:
            @staticmethod
            async def send_message(*args, **kwargs):
                pass

        notif_mod.NotificationService = NotificationService
        sys.modules["app.services.notification"] = notif_mod

    if "app.services.exchange_pool" not in sys.modules:
        ep_mod = types.ModuleType("app.services.exchange_pool")

        async def get_or_create_exchange(*args, **kwargs):
            return None

        ep_mod.get_or_create_exchange = get_or_create_exchange
        sys.modules["app.services.exchange_pool"] = ep_mod

    if "app.services.user_order_stream" not in sys.modules:
        uos_mod = types.ModuleType("app.services.user_order_stream")
        uos_mod.mark_order_replaced = lambda *args, **kwargs: None

        async def ensure_user_order_stream(*args, **kwargs):
            return None

        uos_mod.ensure_user_order_stream = ensure_user_order_stream
        sys.modules["app.services.user_order_stream"] = uos_mod


_install_stubs()

import ccxt  # noqa: E402
from app.services import user_order_stream  # noqa: E402
from app.services.bracket_order_service import BracketOrderService  # noqa: E402
from app.services.manual_trade_service import ManualTradeService  # noqa: E402


class _DummyQuery:
    def __init__(self, result):
        self._result = result

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._result


class _DummyDB:
    def __init__(self, api_key_record):
        self._api_key_record = api_key_record

    def query(self, *args, **kwargs):
        return _DummyQuery(self._api_key_record)


class TestIcebergBracketAndEditFixes(unittest.TestCase):
    def setUp(self):
        BracketOrderService.ACTIVE_ENTRY_MONITORS.clear()
        ManualTradeService._OPEN_ORDERS_CACHE.clear()

    def test_monitor_and_execute_bracket_resolves_replaced_entry_without_name_error(self):
        async def _run():
            api_key_record = SimpleNamespace(
                id=1, user_id=1, exchange="binance", api_key="k", secret_key="s", passphrase=None
            )
            fetched_ids = []

            class MockExchange:
                id = "binance"

                async def fetch_order(self, oid, symbol):
                    fetched_ids.append(str(oid))
                    if str(oid) == "4044303430":
                        # Simulate edit_order replacement handoff happening mid-flight
                        BracketOrderService.ACTIVE_ENTRY_MONITORS["4044303430"]["replaced_by"] = "4044309999"
                        BracketOrderService.ACTIVE_ENTRY_MONITORS["4044309999"] = {
                            "entry_order_id": "4044309999",
                            "symbol": symbol,
                            "cancelled": False,
                        }
                        return {"id": "4044303430", "status": "canceled", "filled": 0.0}
                    return {"id": "4044309999", "status": "closed", "filled": 608.0, "average": 0.1234}

            spawn_mock = AsyncMock()
            orig_sleep = asyncio.sleep
            with (
                patch("app.services.bracket_order_service.get_or_create_exchange", AsyncMock(return_value=MockExchange())),
                patch.object(BracketOrderService, "_spawn_bracket_for_amount", spawn_mock),
                patch.object(BracketOrderService, "_send_entry_filled_notification", AsyncMock()),
                patch("app.services.bracket_order_service.asyncio.sleep", AsyncMock(return_value=None)),
            ):
                await BracketOrderService.monitor_and_execute_bracket(
                    api_key_record=api_key_record,
                    entry_order_id="4044303430",
                    symbol="DOGE/FDUSD",
                    side="buy",
                    amount=608.0,
                    is_futures=False,
                    tp_config={"mode": "percentage", "value": 2.0, "timeout_mins": 0},
                    sl_config=None,
                    initial_entry_price=0.1234,
                    user_id=0,
                )
            await orig_sleep(0)

            self.assertEqual(fetched_ids, ["4044303430", "4044309999"])
            spawn_mock.assert_awaited_once()
            self.assertNotIn("4044303430", BracketOrderService.ACTIVE_ENTRY_MONITORS)
            self.assertNotIn("4044309999", BracketOrderService.ACTIVE_ENTRY_MONITORS)

        asyncio.run(_run())

    def test_edit_manual_trade_iceberg_omits_icebergAmount_on_binance_and_passes_ccxt_payload(self):
        async def _run():
            api_key_record = SimpleNamespace(
                id=1, user_id=1, exchange="binance", is_enabled=True, api_key="k", secret_key="s", passphrase=None
            )
            db = _DummyDB(api_key_record)
            ManualTradeService._OPEN_ORDERS_CACHE[(1, "DOGE/FDUSD")] = (
                9999999999.0,
                {
                    "orders": [
                        {
                            "id": "4044303430",
                            "symbol": "DOGE/FDUSD",
                            "isIceberg": True,
                            "icebergQty": 250.0,
                            "isPostOnly": False,
                        }
                    ]
                },
            )

            captured_edit_calls = []
            test_case = self

            class MockBinanceExchange:
                id = "binance"
                has = {"editOrder": True, "editOrderWs": False, "createOrderWs": False}

                def amount_to_precision(self, symbol, amount):
                    return str(int(round(float(amount)))) if float(amount).is_integer() else str(round(float(amount), 2))

                def price_to_precision(self, symbol, price):
                    return f"{float(price):.5f}"

                async def edit_order(self, oid, symbol, order_type, side, amount, price, params):
                    captured_edit_calls.append((oid, symbol, order_type, side, amount, price, dict(params)))
                    # Also validate with real ccxt.binance.edit_spot_order_request that no unknown params leak
                    real_binance = ccxt.binance()
                    real_binance.markets = {
                        "DOGE/FDUSD": {
                            "id": "DOGEFDUSD",
                            "symbol": "DOGE/FDUSD",
                            "spot": True,
                            "contract": False,
                            "linear": False,
                            "inverse": False,
                            "option": False,
                            "type": "spot",
                            "precision": {"amount": 1.0, "price": 0.00001},
                            "info": {
                                "orderTypes": ["LIMIT", "LIMIT_MAKER", "MARKET", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT"]
                            },
                        }
                    }
                    real_binance.markets_by_id = {"DOGEFDUSD": [real_binance.markets["DOGE/FDUSD"]]}
                    payload = real_binance.edit_spot_order_request(oid, symbol, order_type, side, amount, price, params)
                    test_case.assertNotIn("icebergAmount", payload)
                    test_case.assertEqual(payload.get("icebergQty"), "250")
                    test_case.assertEqual(payload.get("timeInForce"), "GTC")
                    return {"id": "4044309999", "status": "open", "price": price, "amount": amount}

            mock_ex = MockBinanceExchange()
            with (
                patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=mock_ex)),
                patch("app.services.user_order_stream.mark_order_replaced", lambda *_: None),
            ):
                res = await ManualTradeService.edit_manual_trade(
                    db=db,
                    user_id=1,
                    api_key_id=1,
                    order_id="4044303430",
                    symbol="DOGE/FDUSD",
                    side="buy",
                    amount=608.76,
                    new_price=0.12345,
                )

            self.assertEqual(len(captured_edit_calls), 1)
            sent_params = captured_edit_calls[0][6]
            self.assertNotIn("icebergAmount", sent_params)
            self.assertEqual(sent_params.get("icebergQty"), "250")
            self.assertEqual(sent_params.get("timeInForce"), "GTC")
            self.assertEqual(res.get("id"), "4044309999")

        asyncio.run(_run())

    def test_sanitize_ws_order_args_prevents_binance_postonly_leak(self):
        ex = SimpleNamespace(id="binance")

        # Spot create_order_ws with postOnly=True -> LIMIT_MAKER, no postOnly / timeInForce
        ws_type, ws_params = ManualTradeService._sanitize_ws_order_args(
            ex, "limit", {"postOnly": True}, is_futures=False, is_edit=False
        )
        self.assertEqual(ws_type, "LIMIT_MAKER")
        self.assertNotIn("postOnly", ws_params)
        self.assertNotIn("timeInForce", ws_params)

        # Verify real ccxt.pro.binance payload after extend() has no postOnly leak
        real_binance = ccxt.binance()
        real_binance.markets = {
            "DOGE/FDUSD": {
                "id": "DOGEFDUSD",
                "symbol": "DOGE/FDUSD",
                "spot": True,
                "contract": False,
                "linear": False,
                "inverse": False,
                "option": False,
                "swap": False,
                "future": False,
                "type": "spot",
                "precision": {"amount": 1.0, "price": 0.00001},
                "info": {"orderTypes": ["LIMIT", "LIMIT_MAKER", "MARKET"]},
            }
        }
        real_binance.markets_by_id = {"DOGEFDUSD": [real_binance.markets["DOGE/FDUSD"]]}
        req = real_binance.create_order_request("DOGE/FDUSD", ws_type, "buy", 100, 0.1, ws_params)
        extended = real_binance.extend(req, ws_params)
        self.assertEqual(extended["type"], "LIMIT_MAKER")
        self.assertNotIn("postOnly", extended)
        self.assertNotIn("timeInForce", extended)

        # Futures create_order_ws with postOnly=True -> limit + timeInForce='GTX', no postOnly
        fut_type, fut_params = ManualTradeService._sanitize_ws_order_args(
            ex, "limit", {"postOnly": True, "reduceOnly": True}, is_futures=True, is_edit=False
        )
        self.assertEqual(fut_type, "limit")
        self.assertEqual(fut_params, {"timeInForce": "GTX", "reduceOnly": True})

        # Futures edit_order_ws with postOnly=True -> limit, drops postOnly and timeInForce
        edit_fut_type, edit_fut_params = ManualTradeService._sanitize_ws_order_args(
            ex, "limit", {"postOnly": True}, is_futures=True, is_edit=True
        )
        self.assertEqual(edit_fut_type, "limit")
        self.assertEqual(edit_fut_params, {})


if __name__ == "__main__":
    unittest.main()
