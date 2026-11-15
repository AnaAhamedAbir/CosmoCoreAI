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

        async def _get_redis_pub():
            return None

        uos_mod.ensure_user_order_stream = ensure_user_order_stream
        uos_mod._get_redis_pub = _get_redis_pub
        sys.modules["app.services.user_order_stream"] = uos_mod


_install_stubs()

import json  # noqa: E402
import time  # noqa: E402
import ccxt  # noqa: E402
from app.services import user_order_stream  # noqa: E402
from app.services import smart_peg_entry_executor as peg_exec  # noqa: E402
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

    def test_smart_peg_fetch_bbo_fast_uses_fresh_redis_and_rejects_stale(self):
        async def _run():
            rest_calls = []

            class MockEx:
                id = "binance"

                async def fetch_order_book(self, symbol, limit=5):
                    rest_calls.append(symbol)
                    return {"bids": [[0.0580, 100.0]], "asks": [[0.0581, 100.0]]}

            ex = MockEx()
            fresh_payload = json.dumps({
                "bids": [{"price": 0.0588, "size": 500.0}],
                "asks": [{"price": 0.0589, "size": 500.0}],
                "ts": time.time(),
            })
            stale_payload = json.dumps({
                "bids": [{"price": 0.0500, "size": 500.0}],
                "asks": [{"price": 0.0501, "size": 500.0}],
                "ts": time.time() - 2.0,
            })

            class DummyRedis:
                def __init__(self, val):
                    self.val = val

                async def get(self, key):
                    return self.val

            # 1. Fresh Redis -> zero REST calls
            with patch.object(user_order_stream, "_get_redis_pub", AsyncMock(return_value=DummyRedis(fresh_payload))):
                ob = await peg_exec._fetch_bbo_fast(ex, "DOGE/FDUSD")
                self.assertEqual(ob["bids"][0][0], 0.0588)
                self.assertEqual(ob["asks"][0][0], 0.0589)
                self.assertEqual(len(rest_calls), 0)

            # 2. Stale Redis -> falls back to REST fetch_order_book
            with patch.object(user_order_stream, "_get_redis_pub", AsyncMock(return_value=DummyRedis(stale_payload))):
                ob2 = await peg_exec._fetch_bbo_fast(ex, "DOGE/FDUSD")
                self.assertEqual(ob2["bids"][0][0], 0.0580)
                self.assertEqual(len(rest_calls), 1)

        asyncio.run(_run())

    def test_smart_peg_spot_uses_ws_place_and_ws_repeg_then_completes(self):
        async def _run():
            peg_exec.ACTIVE_SMART_PEGS.clear()
            ws_create_calls = []
            ws_edit_calls = []

            class MockSpotWSExchange:
                id = "binance"
                has = {"createOrderWs": True, "editOrderWs": True, "editOrder": True}
                markets = {
                    "DOGE/FDUSD": {
                        "symbol": "DOGE/FDUSD",
                        "base": "DOGE",
                        "quote": "FDUSD",
                        "spot": True,
                        "contract": False,
                        "inverse": False,
                        "precision": {"price": 0.00001, "amount": 1.0},
                        "limits": {"cost": {"min": 5.0}},
                    }
                }

                def price_to_precision(self, symbol, price):
                    return f"{float(price):.5f}"

                def amount_to_precision(self, symbol, amount):
                    return str(int(round(float(amount))))

                async def fetch_balance(self):
                    return {"FDUSD": {"free": 1000.0}, "DOGE": {"free": 0.0}}

                async def fetch_order_book(self, symbol, limit=5):
                    # Initial book: 0.05880; after 2 polls outbids to 0.05885
                    if len(ws_create_calls) == 0:
                        return {"bids": [[0.05880, 500.0]], "asks": [[0.05890, 500.0]]}
                    return {"bids": [[0.05885, 500.0]], "asks": [[0.05890, 500.0]]}

                async def create_order_ws(self, symbol, order_type, side, amount, price, params):
                    ws_create_calls.append((order_type, price, dict(params)))
                    return {"id": "1001", "status": "open", "price": price, "amount": amount}

                async def edit_order_ws(self, oid, symbol, order_type, side, amount, price, params):
                    ws_edit_calls.append((oid, order_type, price, dict(params)))
                    return {
                        "id": "1002",
                        "status": "closed",
                        "filled": amount,
                        "average": price,
                        "price": price,
                        "info": {"cancelResponse": {"executedQty": "0"}},
                    }

                async def fetch_order(self, oid, symbol):
                    return {"id": oid, "status": "open", "filled": 0.0, "price": 0.05880}

            ex = MockSpotWSExchange()
            with patch("app.services.smart_peg_entry_executor.asyncio.sleep", AsyncMock(return_value=None)):
                res = await peg_exec.execute_smart_peg_entry(
                    exchange=ex,
                    symbol="DOGE/FDUSD",
                    side="buy",
                    amount=480.0,
                    is_futures=False,
                    user_id=0,
                    send_initial_notify=False,
                )

            self.assertEqual(len(ws_create_calls), 1)
            self.assertEqual(ws_create_calls[0][0], "LIMIT_MAKER")
            self.assertNotIn("postOnly", ws_create_calls[0][2])
            self.assertEqual(len(ws_edit_calls), 1)
            self.assertEqual(ws_edit_calls[0][0], "1001")
            self.assertEqual(ws_edit_calls[0][1], "LIMIT_MAKER")
            self.assertEqual(ws_edit_calls[0][2], 0.05885)
            self.assertNotIn("postOnly", ws_edit_calls[0][3])
            self.assertEqual(res.get("id"), "1002")
            self.assertEqual(res.get("status"), "closed")

        asyncio.run(_run())

    def test_smart_peg_futures_rest_edit_omits_postonly_and_tif(self):
        async def _run():
            peg_exec.ACTIVE_SMART_PEGS.clear()
            rest_edit_calls = []

            class MockFuturesExchange:
                id = "binance"
                has = {"createOrderWs": True, "editOrderWs": False, "editOrder": True}
                markets = {
                    "DOGE/USDT:USDT": {
                        "symbol": "DOGE/USDT:USDT",
                        "base": "DOGE",
                        "quote": "USDT",
                        "spot": False,
                        "contract": True,
                        "linear": True,
                        "inverse": False,
                        "precision": {"price": 0.00001, "amount": 1.0},
                        "limits": {"cost": {"min": 5.0}},
                    }
                }

                def price_to_precision(self, symbol, price):
                    return f"{float(price):.5f}"

                def amount_to_precision(self, symbol, amount):
                    return str(int(round(float(amount))))

                async def fetch_order_book(self, symbol, limit=5):
                    if not getattr(self, "_placed", False):
                        return {"bids": [[0.10000, 500.0]], "asks": [[0.10010, 500.0]]}
                    return {"bids": [[0.10005, 500.0]], "asks": [[0.10010, 500.0]]}

                async def create_order_ws(self, symbol, order_type, side, amount, price, params):
                    self._placed = True
                    self._create_params = dict(params)
                    return {"id": "2001", "status": "open", "price": price, "amount": amount}

                async def edit_order(self, oid, symbol, order_type, side, amount, price, params):
                    rest_edit_calls.append((oid, order_type, price, dict(params)))
                    return {"id": "2001", "status": "closed", "filled": amount, "average": price, "price": price}

                async def fetch_order(self, oid, symbol):
                    return {"id": oid, "status": "open", "filled": 0.0, "price": 0.10000}

            ex = MockFuturesExchange()
            with (
                patch.object(ManualTradeService, "_is_binance_hedge_mode", AsyncMock(return_value=False)),
                patch("app.services.smart_peg_entry_executor.asyncio.sleep", AsyncMock(return_value=None)),
            ):
                res = await peg_exec.execute_smart_peg_entry(
                    exchange=ex,
                    symbol="DOGE/USDT:USDT",
                    side="buy",
                    amount=100.0,
                    is_futures=True,
                    user_id=0,
                    send_initial_notify=False,
                )

            self.assertEqual(ex._create_params, {"timeInForce": "GTX"})
            self.assertEqual(len(rest_edit_calls), 1)
            self.assertNotIn("postOnly", rest_edit_calls[0][3])
            self.assertNotIn("timeInForce", rest_edit_calls[0][3])
            self.assertEqual(res.get("status"), "closed")

        asyncio.run(_run())

    def test_emergency_force_sell_all_mode_counts_cancelled_iceberg_amount_when_free_lags(self):
        async def _run():
            api_key_record = SimpleNamespace(
                id=1, user_id=1, exchange="binance", is_enabled=True, api_key="k", secret_key="s", passphrase=None
            )
            db = _DummyDB(api_key_record)
            ManualTradeService.invalidate_open_orders_cache(1, "DOGE/FDUSD")

            captured_peg_amounts = []

            class MockSpotExchange:
                id = "binance"
                markets = {
                    "DOGE/FDUSD": {
                        "symbol": "DOGE/FDUSD",
                        "base": "DOGE",
                        "quote": "FDUSD",
                        "spot": True,
                        "inverse": False,
                        "contractSize": 1.0,
                        "precision": {"amount": 1.0, "price": 0.00001},
                    }
                }

                def amount_to_precision(self, symbol, amount):
                    return str(int(float(amount)))

                async def fetch_open_orders(self, symbol):
                    return [
                        {
                            "id": "4044333102",
                            "status": "open",
                            "type": "limit",
                            "side": "sell",
                            "price": 0.0600,
                            "amount": 507.0,
                            "remaining": 507.0,
                            "info": {"origQty": "507", "icebergQty": "250"},
                        }
                    ]

                async def cancel_all_orders(self, symbol):
                    return []

                async def fetch_order_book(self, symbol, limit=5):
                    return {"bids": [[0.05879, 1000.0]], "asks": [[0.05880, 1000.0]]}

                async def fetch_balance(self, params=None):
                    # Simulate Binance balance lag where cancelled 507 DOGE has not moved into free yet
                    return {
                        "DOGE": {"free": 25.0, "used": 507.0, "total": 532.0},
                        "FDUSD": {"free": 10.0, "used": 0.0, "total": 10.0},
                    }

            mock_ex = MockSpotExchange()

            async def _fake_smart_peg(**kwargs):
                captured_peg_amounts.append(kwargs["amount"])
                return {"status": "closed"}

            scheduled_tasks = []
            orig_create_task = asyncio.create_task

            def _track_task(coro):
                t = orig_create_task(coro)
                scheduled_tasks.append(t)
                return t

            with (
                patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=mock_ex)),
                patch("app.services.user_order_stream.ensure_user_order_stream", lambda *_, **__: None),
                patch("app.services.manual_smart_chase_executor.stop_smart_chase", AsyncMock(return_value=0)),
                patch("app.services.smart_peg_entry_executor.stop_smart_peg", AsyncMock(return_value=0)),
                patch("app.services.smart_peg_entry_executor.execute_smart_peg_entry", side_effect=_fake_smart_peg),
                patch("app.services.manual_trade_service.asyncio.sleep", AsyncMock(return_value=None)),
                patch("app.services.manual_trade_service.asyncio.create_task", side_effect=_track_task),
            ):
                res = await ManualTradeService.execute_emergency_force_order(
                    db=db,
                    user_id=1,
                    api_key_id=1,
                    symbol="DOGE/FDUSD",
                    side="sell",
                    execution_mode="limit_maker",
                    size_pct=100.0,
                    target_order_id="all",
                )
                if scheduled_tasks:
                    await asyncio.gather(*scheduled_tasks)

            self.assertEqual(res["status"], "pegging")
            self.assertGreater(res["amount"], 500.0)
            self.assertEqual(captured_peg_amounts, [res["amount"]])

        asyncio.run(_run())

    def test_emergency_force_sell_specific_order_uses_free_plus_used_when_total_omitted(self):
        async def _run():
            api_key_record = SimpleNamespace(
                id=1, user_id=1, exchange="binance", is_enabled=True, api_key="k", secret_key="s", passphrase=None
            )
            db = _DummyDB(api_key_record)

            class MockSpotExchange:
                id = "binance"
                markets = {
                    "DOGE/FDUSD": {
                        "symbol": "DOGE/FDUSD",
                        "base": "DOGE",
                        "quote": "FDUSD",
                        "spot": True,
                        "inverse": False,
                        "contractSize": 1.0,
                        "precision": {"amount": 1.0, "price": 0.00001},
                    }
                }

                def amount_to_precision(self, symbol, amount):
                    return str(int(float(amount)))

                async def cancel_order(self, oid, symbol):
                    return {"id": oid, "status": "canceled"}

                async def fetch_order_book(self, symbol, limit=5):
                    return {"bids": [[0.05879, 1000.0]], "asks": [[0.05880, 1000.0]]}

                async def fetch_balance(self, params=None):
                    return {
                        "DOGE": {"free": 25.0, "used": 507.0},
                        "FDUSD": {"free": 10.0, "used": 0.0, "total": 10.0},
                    }

            mock_ex = MockSpotExchange()

            async def _fake_smart_peg(**kwargs):
                return {"status": "closed"}

            with (
                patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=mock_ex)),
                patch("app.services.manual_smart_chase_executor.stop_smart_chase", AsyncMock(return_value=0)),
                patch("app.services.smart_peg_entry_executor.stop_smart_peg", AsyncMock(return_value=0)),
                patch("app.services.smart_peg_entry_executor.execute_smart_peg_entry", side_effect=_fake_smart_peg),
                patch("app.services.manual_trade_service.asyncio.sleep", AsyncMock(return_value=None)),
            ):
                res = await ManualTradeService.execute_emergency_force_order(
                    db=db,
                    user_id=1,
                    api_key_id=1,
                    symbol="DOGE/FDUSD",
                    side="sell",
                    execution_mode="limit_maker",
                    size_pct=100.0,
                    target_order_id="4044333102",
                    target_order_amount=507.0,
                )
                await asyncio.sleep(0)

            self.assertEqual(res["amount"], 507.0)

        asyncio.run(_run())

    def test_emergency_force_sell_fast_path_uses_ws_and_reuses_preloaded_snapshots(self):
        async def _run():
            api_key_record = SimpleNamespace(
                id=1, user_id=1, exchange="binance", is_enabled=True, api_key="k", secret_key="s", passphrase=None
            )
            db = _DummyDB(api_key_record)

            rest_calls = []
            ws_calls = []
            fresh_payload = json.dumps({
                "bids": [[0.05879, 500.0]],
                "asks": [[0.05880, 500.0]],
                "ts": time.time(),
            })

            class FakeRedis:
                async def get(self, key):
                    return fresh_payload

            class MockSpotWsExchange:
                id = "binance"
                has = {
                    "cancelOrderWs": True,
                    "fetchBalanceWs": True,
                    "createOrderWs": True,
                    "editOrderWs": True,
                    "fetchOrderWs": False,
                }
                markets = {
                    "DOGE/FDUSD": {
                        "symbol": "DOGE/FDUSD",
                        "base": "DOGE",
                        "quote": "FDUSD",
                        "spot": True,
                        "inverse": False,
                        "contractSize": 1.0,
                        "precision": {"amount": 1.0, "price": 0.00001},
                    }
                }

                def amount_to_precision(self, symbol, amount):
                    return str(int(float(amount)))

                def price_to_precision(self, symbol, price):
                    return f"{float(price):.5f}"

                async def cancel_order_ws(self, oid, symbol):
                    ws_calls.append(("cancel_order_ws", oid))
                    return {"id": oid, "status": "canceled"}

                async def cancel_order(self, oid, symbol):
                    rest_calls.append(("cancel_order", oid))
                    return {"id": oid, "status": "canceled"}

                async def fetch_balance_ws(self, params=None):
                    ws_calls.append(("fetch_balance_ws",))
                    return {
                        "DOGE": {"free": 507.0, "used": 0.0, "total": 507.0},
                        "FDUSD": {"free": 10.0, "used": 0.0, "total": 10.0},
                    }

                async def fetch_balance(self, params=None):
                    rest_calls.append(("fetch_balance",))
                    return await self.fetch_balance_ws(params)

                async def fetch_order_book(self, symbol, limit=5):
                    rest_calls.append(("fetch_order_book",))
                    return {"bids": [[0.05879, 500.0]], "asks": [[0.05880, 500.0]]}

                async def create_order_ws(self, symbol, order_type, side, amount, price, params):
                    ws_calls.append(("create_order_ws", order_type, side, amount, price))
                    return {"id": "4044999999", "status": "closed", "filled": amount, "average": price, "price": price}

            mock_ex = MockSpotWsExchange()
            scheduled_tasks = []
            orig_create_task = asyncio.create_task

            def _track_task(coro):
                t = orig_create_task(coro)
                scheduled_tasks.append(t)
                return t

            with (
                patch.object(ManualTradeService, "_get_exchange", AsyncMock(return_value=mock_ex)),
                patch("app.services.user_order_stream._get_redis_pub", AsyncMock(return_value=FakeRedis())),
                patch("app.services.manual_smart_chase_executor.stop_smart_chase", AsyncMock(return_value=0)),
                patch("app.services.smart_peg_entry_executor.stop_smart_peg", AsyncMock(return_value=0)),
                patch("app.services.manual_trade_service.asyncio.create_task", side_effect=_track_task),
            ):
                res = await ManualTradeService.execute_emergency_force_order(
                    db=db,
                    user_id=1,
                    api_key_id=1,
                    symbol="DOGE/FDUSD",
                    side="sell",
                    execution_mode="limit_maker",
                    size_pct=100.0,
                    target_order_id="4044333102",
                    target_order_amount=507.0,
                )
                if scheduled_tasks:
                    await asyncio.gather(*scheduled_tasks)

            self.assertEqual(res["status"], "pegging")
            self.assertEqual(res["amount"], 507.0)
            self.assertEqual(rest_calls, [])
            self.assertEqual(
                ws_calls,
                [
                    ("cancel_order_ws", "4044333102"),
                    ("fetch_balance_ws",),
                    ("create_order_ws", "LIMIT_MAKER", "sell", 507.0, 0.0588),
                ],
            )

        asyncio.run(_run())

    def test_fetch_wallet_balance_fixes_spot_ws_empty_dicts_and_falls_back_to_rest(self):
        async def _run():
            real_binance = ccxt.binance()

            class MockSpotWSBrokenParse:
                id = "binance"
                has = {"fetchBalanceWs": True}
                markets = {}

                def parse_balance_custom(self, response, type=None, marginMode=None, isPortfolioMargin=False):
                    return real_binance.parse_balance_custom(response, type=type, marginMode=marginMode, isPortfolioMargin=isPortfolioMargin)

                async def fetch_balance_ws(self, params=None):
                    # Reproduces ccxt.pro.binance bug: handle_account_status_ws calls parseBalanceCustom(result) with type=None
                    return {
                        "info": {
                            "updateTime": 1660801833000,
                            "accountType": "SPOT",
                            "balances": [
                                {"asset": "DOGE", "free": "507.3", "locked": "0.0"},
                                {"asset": "FDUSD", "free": "42.5", "locked": "10.0"},
                            ],
                        },
                        "free": {},
                        "used": {},
                        "total": {},
                    }

                async def fetch_balance(self, params=None):
                    raise AssertionError("REST fetch_balance should not be called when WS info.balances normalizes")

            bal = await ManualTradeService._fetch_wallet_balance(MockSpotWSBrokenParse(), "DOGE/FDUSD")
            self.assertAlmostEqual(float(bal["DOGE"]["free"]), 507.3, places=4)
            self.assertAlmostEqual(float(bal["FDUSD"]["free"]), 42.5, places=4)
            self.assertAlmostEqual(float(bal["FDUSD"]["used"]), 10.0, places=4)

            # Case 2: Completely empty WS balance triggers REST fallback cleanly
            class MockEmptyWSWithRestFallback:
                id = "binance"
                has = {"fetchBalanceWs": True}
                markets = {}

                async def fetch_balance_ws(self, params=None):
                    return {"info": {}, "free": {}, "used": {}, "total": {}}

                async def fetch_balance(self, params=None):
                    return {
                        "DOGE": {"free": 120.0, "used": 0.0, "total": 120.0},
                        "FDUSD": {"free": 88.0, "used": 0.0, "total": 88.0},
                        "free": {"DOGE": 120.0, "FDUSD": 88.0},
                        "used": {"DOGE": 0.0, "FDUSD": 0.0},
                        "total": {"DOGE": 120.0, "FDUSD": 88.0},
                    }

            bal_rest = await ManualTradeService._fetch_wallet_balance(MockEmptyWSWithRestFallback(), "DOGE/FDUSD")
            self.assertAlmostEqual(float(bal_rest["DOGE"]["free"]), 120.0, places=4)
            self.assertAlmostEqual(float(bal_rest["FDUSD"]["free"]), 88.0, places=4)

        asyncio.run(_run())


if __name__ == "__main__":
    unittest.main()
