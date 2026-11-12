import asyncio
import os
import sys
import types
import unittest
from types import SimpleNamespace


BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def _install_dependency_stubs():
    """Install lightweight stubs for runtime modules unavailable in standalone unit tests."""
    if "fastapi" not in sys.modules:
        fastapi_mod = types.ModuleType("fastapi")

        class HTTPException(Exception):
            def __init__(self, status_code=400, detail=""):
                super().__init__(detail)
                self.status_code = status_code
                self.detail = detail

        fastapi_mod.HTTPException = HTTPException
        sys.modules["fastapi"] = fastapi_mod

    if "app.services.exchange_pool" not in sys.modules:
        ep_mod = types.ModuleType("app.services.exchange_pool")

        async def get_or_create_exchange(*args, **kwargs):
            return None

        ep_mod.get_or_create_exchange = get_or_create_exchange
        sys.modules["app.services.exchange_pool"] = ep_mod

    if "app.core.security" not in sys.modules:
        sec_mod = types.ModuleType("app.core.security")
        sec_mod.decrypt_key = lambda v: v
        sys.modules["app.core.security"] = sec_mod

    if "app.services.notification" not in sys.modules:
        notif_mod = types.ModuleType("app.services.notification")

        class NotificationService:
            sent_messages = []

            @staticmethod
            async def send_message(db, user_id, msg, **kwargs):
                NotificationService.sent_messages.append((user_id, msg, kwargs))

        notif_mod.NotificationService = NotificationService
        sys.modules["app.services.notification"] = notif_mod

    if "app.db.session" not in sys.modules:
        db_mod = types.ModuleType("app.db.session")

        class DummySession:
            def close(self):
                pass

        db_mod.SessionLocal = lambda: DummySession()
        sys.modules["app.db.session"] = db_mod


_install_dependency_stubs()

from app.services.bracket_order_service import BracketOrderService  # noqa: E402
from app.services import manual_smart_chase_executor as chase_exec  # noqa: E402


class MockExchange:
    def __init__(self, symbol="BTC/USDT", tick=0.01, bids=None, asks=None, supports_edit=False, is_inverse=False):
        self.id = "binance"
        self.symbol = symbol
        self.has = {"editOrder": supports_edit}
        base = symbol.split("/")[0]
        quote = symbol.split("/")[1].split(":")[0]
        self.markets = {
            symbol: {
                "symbol": symbol,
                "base": base,
                "quote": quote,
                "inverse": is_inverse,
                "subType": "inverse" if is_inverse else "linear",
                "contractSize": 100.0 if (is_inverse and base == "BTC") else (10.0 if is_inverse else 1.0),
                "precision": {"price": tick, "amount": 1.0 if is_inverse else 0.01},
                "limits": {"cost": {"min": 5.0}},
            }
        }
        self._bids = bids or [[99.90, 50.0]]
        self._asks = asks or [[100.10, 50.0]]
        self._last = float(self._bids[0][0])
        self._next_id = 1000
        self.orders = {}
        self.open_orders = []
        self.positions = []
        self.limit_orders_placed = []
        self.market_orders_placed = []
        self.edited_orders = []
        self.cancelled_orders = []
        self.free_base = 10000.0
        self.free_quote = 100000.0

        # Custom hooks for unit test scenarios
        self.on_create_limit = None
        self.on_edit_order = None
        self.on_cancel_order = None
        self.on_fetch_order = None

    def price_to_precision(self, symbol, price):
        return f"{round(float(price), 4):.4f}"

    def amount_to_precision(self, symbol, amount):
        if self.markets.get(symbol, {}).get("inverse"):
            return f"{int(round(float(amount)))}"
        return f"{round(float(amount), 4):.4f}"

    async def fetch_ticker(self, symbol):
        bid = float(self._bids[0][0])
        ask = float(self._asks[0][0])
        return {"last": self._last, "bid": bid, "ask": ask}

    async def fetch_order_book(self, symbol, limit=5):
        return {"bids": list(self._bids), "asks": list(self._asks)}

    async def fetch_balance(self, params=None):
        base, quote = self.symbol.split("/")[0], self.symbol.split("/")[1].split(":")[0]
        return {
            base: {"free": self.free_base},
            quote: {"free": self.free_quote},
            "free": {base: self.free_base, quote: self.free_quote},
        }

    async def fetch_positions(self, symbols=None, params=None):
        return list(self.positions)

    async def fetch_open_orders(self, symbol=None, params=None):
        if params and params.get("stop"):
            return []
        return list(self.open_orders)

    async def create_limit_order(self, symbol, side, amount, price, params=None):
        if self.on_create_limit:
            res = self.on_create_limit(symbol, side, amount, price, params)
            if res is not None:
                return res
        self._next_id += 1
        oid = str(self._next_id)
        order = {
            "id": oid,
            "symbol": symbol,
            "side": side,
            "amount": float(amount),
            "price": float(price),
            "status": "open",
            "filled": 0.0,
            "params": dict(params or {}),
        }
        self.orders[oid] = order
        self.limit_orders_placed.append(order)
        return order

    async def create_market_order(self, symbol, side, amount, params=None):
        self._next_id += 1
        oid = str(self._next_id)
        order = {
            "id": oid,
            "symbol": symbol,
            "side": side,
            "amount": float(amount),
            "status": "closed",
            "filled": float(amount),
            "params": dict(params or {}),
        }
        self.market_orders_placed.append(order)
        return order

    async def create_order(self, symbol, order_type, side, amount, price=None, params=None):
        self._next_id += 1
        oid = str(self._next_id)
        order = {
            "id": oid,
            "symbol": symbol,
            "type": order_type,
            "side": side,
            "amount": float(amount),
            "price": price,
            "status": "open",
            "filled": 0.0,
            "params": dict(params or {}),
        }
        self.orders[oid] = order
        return order

    async def edit_order(self, order_id, symbol, order_type, side, amount, price, params=None):
        self.edited_orders.append(
            {
                "old_id": str(order_id),
                "symbol": symbol,
                "side": side,
                "amount": float(amount),
                "price": float(price),
            }
        )
        if self.on_edit_order:
            return self.on_edit_order(str(order_id), symbol, order_type, side, amount, price, params)
        self._next_id += 1
        new_id = str(self._next_id)
        order = {
            "id": new_id,
            "symbol": symbol,
            "side": side,
            "amount": float(amount),
            "price": float(price),
            "status": "open",
            "filled": 0.0,
        }
        self.orders[new_id] = order
        return order

    async def fetch_order(self, order_id, symbol, params=None):
        if self.on_fetch_order:
            res = self.on_fetch_order(str(order_id), symbol, params)
            if res is not None:
                return res
        return self.orders.get(str(order_id), {"id": str(order_id), "status": "open", "filled": 0.0})

    async def cancel_order(self, order_id, symbol, params=None):
        self.cancelled_orders.append(str(order_id))
        if self.on_cancel_order:
            res = self.on_cancel_order(str(order_id), symbol, params)
            if res is not None:
                return res
        if str(order_id) in self.orders:
            self.orders[str(order_id)]["status"] = "canceled"
        return {"id": str(order_id), "status": "canceled", "filled": 0.0}


class TestBracketAndSmartChaseFixes(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        BracketOrderService.ACTIVE_SOFTWARE_SL.clear()
        BracketOrderService.ACTIVE_ENTRY_BRACKETS.clear()
        BracketOrderService.ACTIVE_ENTRY_MONITORS.clear()
        BracketOrderService.ENTRY_BRACKET_LOCKS.clear()
        BracketOrderService.KNOWN_TP_ORDER_IDS.clear()
        chase_exec.ACTIVE_SMART_CHASES.clear()

    async def asyncTearDown(self):
        for sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.values()):
            sdata["cancelled"] = True
        for cdata in list(chase_exec.ACTIVE_SMART_CHASES.values()):
            evt = cdata.get("cancel_event")
            if evt:
                evt.set()
        await asyncio.sleep(0.05)
        BracketOrderService.ACTIVE_SOFTWARE_SL.clear()
        BracketOrderService.ACTIVE_ENTRY_BRACKETS.clear()
        BracketOrderService.KNOWN_TP_ORDER_IDS.clear()
        chase_exec.ACTIVE_SMART_CHASES.clear()

    # ── FIX 1 TESTS ───────────────────────────────────────────────────────────

    async def test_fix1_edit_order_cancel_response_deducts_partial_fill_and_prevents_double_subtract(self):
        """Spot cancelReplace partial fill on cancelResponse decrements remaining_amount & registry, and same-OID edit doesn't double subtract."""
        ex = MockExchange(
            symbol="BTC/USDT",
            tick=0.01,
            bids=[[99.90, 50.0]],
            asks=[[100.10, 50.0]],
            supports_edit=True,
        )
        ex.free_base = 100.0
        edit_calls = 0

        def handle_edit(old_oid, sym, otype, side, amount, price, params):
            nonlocal edit_calls
            edit_calls += 1
            if edit_calls == 1:
                # Simulate Spot cancelReplace: old order had 40.0 filled on cancelResponse, new order 2001 placed
                new_ord = {
                    "id": "2001",
                    "symbol": sym,
                    "side": side,
                    "amount": float(amount),
                    "price": float(price),
                    "status": "open",
                    "filled": 0.0,
                    "info": {"cancelResponse": {"executedQty": "40.0"}},
                }
                ex.orders["2001"] = new_ord
                # Drop OB again by >=3 ticks so next poll forces Priority 2 fallback
                ex._bids = [[99.40, 50.0]]
                ex._asks = [[99.60, 50.0]]
                return new_ord
            # Second edit fails to fall back to Priority 2 cancel_order
            raise Exception("force fallback cancel")

        def handle_cancel(oid, sym, params):
            if oid == "2001":
                return {"id": "2001", "status": "canceled", "filled": 20.0}
            return {"id": oid, "status": "canceled", "filled": 0.0}

        ex.on_edit_order = handle_edit
        ex.on_cancel_order = handle_cancel

        task = asyncio.create_task(
            chase_exec.execute_manual_smart_chase(
                exchange=ex,
                symbol="BTC/USDT",
                exit_side="sell",
                sell_amount_raw=100.0,
                entry_price=102.0,
                original_sl=100.0,
                max_deviation_pct=5.0,
                chase_delay_ms=300,
                max_attempts=6,
                is_futures=False,
                chase_id="chase_fix1_spot",
                chase_mode="dynamic_bbo",
            )
        )

        # Wait until initial order placed, then drop OB by 3+ ticks to trigger urgent drift Priority 1 edit_order
        for _ in range(25):
            await asyncio.sleep(0.05)
            if len(ex.limit_orders_placed) >= 1:
                ex._bids = [[99.70, 50.0]]
                ex._asks = [[99.90, 50.0]]
                break

        # Wait until second limit order (after Priority 2 cancel of 2001) is placed with remaining 40.0
        for _ in range(40):
            await asyncio.sleep(0.05)
            if len(ex.limit_orders_placed) >= 2:
                second_order = ex.limit_orders_placed[-1]
                second_order["status"] = "closed"
                second_order["filled"] = second_order["amount"]
                break

        res = await asyncio.wait_for(task, timeout=6.0)
        self.assertIsNotNone(res)
        self.assertEqual(res["status"], "closed")
        self.assertGreaterEqual(len(ex.limit_orders_placed), 2)
        # 100.0 initial - 40.0 (cancelResponse) - 20.0 (Priority 2 cancel_res) = 40.0!
        self.assertAlmostEqual(ex.limit_orders_placed[1]["amount"], 40.0, places=4)

    async def test_fix1_same_oid_watch_loop_and_cancel_no_double_subtraction(self):
        """Same-order-ID edit + intermediate watch partial fill + Priority 2 cancel subtracts delta exactly once."""
        ex = MockExchange(
            symbol="BTC/USDT:USDT",
            tick=0.01,
            bids=[[99.90, 50.0]],
            asks=[[100.10, 50.0]],
            supports_edit=True,
        )
        ex.positions = [{"symbol": "BTC/USDT:USDT", "contracts": 100.0, "info": {"symbol": "BTCUSDT"}}]
        fetch_count = 0

        def handle_fetch(oid, sym, params):
            nonlocal fetch_count
            if oid == "1001":
                fetch_count += 1
                if fetch_count == 1:
                    # Poll 3 reports 30.0 partial fill while order remains open
                    return {"id": "1001", "status": "open", "filled": 30.0}
                return {"id": "1001", "status": "open", "filled": 30.0}
            return None

        def handle_edit(old_oid, sym, otype, side, amount, price, params):
            # Keeps same order ID and reports cumulative 30.0 already processed
            if old_oid == "1001" and len(ex.edited_orders) == 1:
                ex._bids = [[99.40, 50.0]]
                ex._asks = [[99.60, 50.0]]
                return {
                    "id": "1001",
                    "status": "open",
                    "filled": 30.0,
                    "info": {"cancelResponse": {"executedQty": "30.0"}},
                }
            raise Exception("fallback to priority 2 cancel")

        def handle_cancel(oid, sym, params):
            if oid == "1001":
                # Cumulative filled is now 50.0 (30.0 already processed + 20.0 new)
                return {"id": "1001", "status": "canceled", "filled": 50.0}
            return {"id": oid, "status": "canceled", "filled": 0.0}

        ex.on_fetch_order = handle_fetch
        ex.on_edit_order = handle_edit
        ex.on_cancel_order = handle_cancel

        task = asyncio.create_task(
            chase_exec.execute_manual_smart_chase(
                exchange=ex,
                symbol="BTC/USDT:USDT",
                exit_side="sell",
                sell_amount_raw=100.0,
                entry_price=102.0,
                original_sl=100.0,
                max_deviation_pct=5.0,
                chase_delay_ms=300,
                max_attempts=6,
                is_futures=True,
                chase_id="chase_fix1_same_oid",
                chase_mode="dynamic_bbo",
            )
        )

        # Wait until poll 3 processed the 30.0 partial fill, then shift OB by 3+ ticks
        for _ in range(40):
            await asyncio.sleep(0.05)
            cdata = chase_exec.ACTIVE_SMART_CHASES.get("chase_fix1_same_oid")
            if cdata and cdata["amount"] == 70.0:
                ex._bids = [[99.70, 50.0]]
                ex._asks = [[99.90, 50.0]]
                break

        # Update live position to 50.0 and mark second order closed once placed
        for _ in range(50):
            await asyncio.sleep(0.05)
            if len(ex.limit_orders_placed) >= 2:
                second_order = ex.limit_orders_placed[-1]
                second_order["status"] = "closed"
                second_order["filled"] = second_order["amount"]
                break

        res = await asyncio.wait_for(task, timeout=6.0)
        self.assertEqual(res["status"], "closed")
        self.assertGreaterEqual(len(ex.limit_orders_placed), 2)
        # 100.0 - 30.0 (watch poll) - 0.0 (same-OID edit) - 20.0 (50.0 - 30.0 on cancel) = 50.0
        self.assertAlmostEqual(ex.limit_orders_placed[1]["amount"], 50.0, places=4)

    async def test_fix1_edit_order_immediate_closed_and_dust_cancel_response(self):
        """edit_order returning status='closed' exits immediately; cancelResponse leaving dust cancels replacement and finishes."""
        ex = MockExchange(
            symbol="BTC/USDT",
            tick=0.01,
            bids=[[99.90, 50.0]],
            asks=[[100.10, 50.0]],
            supports_edit=True,
        )
        ex.free_base = 10.0

        def handle_edit_closed(old_oid, sym, otype, side, amount, price, params):
            return {"id": "3001", "status": "closed", "filled": float(amount), "average": float(price)}

        ex.on_edit_order = handle_edit_closed
        task = asyncio.create_task(
            chase_exec.execute_manual_smart_chase(
                exchange=ex,
                symbol="BTC/USDT",
                exit_side="sell",
                sell_amount_raw=10.0,
                entry_price=102.0,
                original_sl=100.0,
                max_deviation_pct=5.0,
                chase_delay_ms=200,
                max_attempts=5,
                is_futures=False,
                chase_id="chase_edit_closed",
                chase_mode="dynamic_bbo",
            )
        )
        for _ in range(20):
            await asyncio.sleep(0.05)
            if len(ex.limit_orders_placed) >= 1:
                ex._bids = [[99.70, 50.0]]
                ex._asks = [[99.90, 50.0]]
                break

        res = await asyncio.wait_for(task, timeout=4.0)
        self.assertEqual(res["id"], "3001")
        self.assertEqual(res["status"], "closed")
        self.assertEqual(len(ex.market_orders_placed), 0)

        # Subcase B: cancelResponse fills 9.99 leaving 0.01 ($0.99 < $5 min notional)
        ex2 = MockExchange(
            symbol="BTC/USDT",
            tick=0.01,
            bids=[[99.90, 50.0]],
            asks=[[100.10, 50.0]],
            supports_edit=True,
        )
        ex2.free_base = 10.0

        def handle_edit_dust(old_oid, sym, otype, side, amount, price, params):
            return {
                "id": "3002",
                "status": "open",
                "filled": 0.0,
                "info": {"cancelResponse": {"executedQty": "9.99"}},
            }

        ex2.on_edit_order = handle_edit_dust
        task2 = asyncio.create_task(
            chase_exec.execute_manual_smart_chase(
                exchange=ex2,
                symbol="BTC/USDT",
                exit_side="sell",
                sell_amount_raw=10.0,
                entry_price=102.0,
                original_sl=100.0,
                max_deviation_pct=5.0,
                chase_delay_ms=200,
                max_attempts=5,
                is_futures=False,
                chase_id="chase_edit_dust",
                chase_mode="dynamic_bbo",
            )
        )
        for _ in range(20):
            await asyncio.sleep(0.05)
            if len(ex2.limit_orders_placed) >= 1:
                ex2._bids = [[99.70, 50.0]]
                ex2._asks = [[99.90, 50.0]]
                break

        res2 = await asyncio.wait_for(task2, timeout=4.0)
        self.assertEqual(res2["status"], "closed")
        self.assertIn("3002", ex2.cancelled_orders)
        self.assertEqual(len(ex2.market_orders_placed), 0)

    # ── FIX 2 TESTS ───────────────────────────────────────────────────────────

    async def test_fix2_cleanup_other_orders_protects_independent_tps_and_chases(self):
        """_cleanup_other_orders must never cancel TPs in ACTIVE_ENTRY_BRACKETS, KNOWN_TP_ORDER_IDS, ACTIVE_SOFTWARE_SL, or other chases."""
        ex = MockExchange(symbol="BTC/USDT", tick=0.01, bids=[[99.90, 50.0]], asks=[[100.10, 50.0]])
        ex.free_base = 1.0

        # Protect independent entries
        BracketOrderService.ACTIVE_ENTRY_BRACKETS["entry_other"] = {
            "entry_order_id": "entry_other",
            "tp_order_id": "tp_other_eb",
            "symbol": "BTC/USDT",
            "side": "sell",
            "cancelled": False,
        }
        BracketOrderService.ACTIVE_ENTRY_BRACKETS["entry_cancelled"] = {
            "entry_order_id": "entry_cancelled",
            "tp_order_id": "tp_cancelled_eb",
            "symbol": "BTC/USDT",
            "side": "sell",
            "cancelled": True,
        }
        BracketOrderService.KNOWN_TP_ORDER_IDS.update({"tp_known_other", "tp_own"})
        BracketOrderService.ACTIVE_SOFTWARE_SL["sl_other"] = {
            "id": "sl_other",
            "tp_order_id": "tp_other_sl",
            "disaster_sl_order_id": "dis_other_sl",
            "cancelled": False,
        }
        chase_exec.ACTIVE_SMART_CHASES["chase_other"] = {
            "chase_id": "chase_other",
            "current_order_id": "chase_other_ord",
        }

        ex.open_orders = [
            {"id": "tp_other_eb", "side": "sell", "type": "limit"},
            {"id": "tp_cancelled_eb", "side": "sell", "type": "limit"},
            {"id": "tp_known_other", "side": "sell", "type": "limit"},
            {"id": "tp_other_sl", "side": "sell", "type": "limit"},
            {"id": "dis_other_sl", "side": "sell", "type": "stop_market", "stopPrice": 90.0},
            {"id": "chase_other_ord", "side": "sell", "type": "limit"},
            {"id": "orphan_conflict", "side": "sell", "type": "limit", "reduceOnly": True},
        ]

        # First attempt triggers -2010 insufficient balance so _cleanup_other_orders(scan_unlinked=True) runs
        attempt_counter = 0

        def handle_create(sym, side, amt, px, params):
            nonlocal attempt_counter
            attempt_counter += 1
            if attempt_counter == 1:
                raise Exception("-2010 insufficient balance")
            return None  # Use default creation on attempt 2

        ex.on_create_limit = handle_create

        task = asyncio.create_task(
            chase_exec.execute_manual_smart_chase(
                exchange=ex,
                symbol="BTC/USDT",
                exit_side="sell",
                sell_amount_raw=1.0,
                entry_price=102.0,
                original_sl=100.0,
                max_deviation_pct=5.0,
                chase_delay_ms=200,
                max_attempts=4,
                is_futures=False,
                tp_order_id="tp_own",
                chase_id="chase_own",
                chase_mode="dynamic_bbo",
            )
        )

        for _ in range(40):
            await asyncio.sleep(0.05)
            if len(ex.limit_orders_placed) >= 1:
                ex.limit_orders_placed[0]["status"] = "closed"
                ex.limit_orders_placed[0]["filled"] = 1.0
                break

        await asyncio.wait_for(task, timeout=5.0)

        self.assertIn("tp_own", ex.cancelled_orders)
        self.assertIn("orphan_conflict", ex.cancelled_orders)
        self.assertIn("tp_cancelled_eb", ex.cancelled_orders)

        self.assertNotIn("tp_other_eb", ex.cancelled_orders)
        self.assertNotIn("tp_known_other", ex.cancelled_orders)
        self.assertNotIn("tp_other_sl", ex.cancelled_orders)
        self.assertNotIn("dis_other_sl", ex.cancelled_orders)
        self.assertNotIn("chase_other_ord", ex.cancelled_orders)

    # ── FIX 3 TESTS ───────────────────────────────────────────────────────────

    def test_fix3_wall_aware_deep_walls_front_run_inside_spread_strict_maker(self):
        """Deep bid wall (sell) and deep ask wall (buy) front-run inside spread while staying strict Maker."""
        ex = MockExchange(symbol="BTC/USDT", tick=0.01)
        ex.price_to_precision = lambda s, p: f"{round(float(p), 2):.2f}"

        # Sell exit with wide spread (100.00 / 100.50), uniform asks, huge bid wall at bids[3]=99.70
        ob = {
            "bids": [[100.00, 10.0], [99.90, 10.0], [99.80, 10.0], [99.70, 500.0]],
            "asks": [[100.50, 10.0], [100.60, 10.0], [100.70, 10.0], [100.80, 10.0]],
        }
        sell_px = chase_exec._calculate_target_maker_price(
            exit_side="sell",
            ob=ob,
            tick=0.01,
            peg_strategy="wall_aware",
            wall_multiplier=2.5,
            max_chase_price=99.50,
            exchange=ex,
            symbol="BTC/USDT",
        )
        self.assertAlmostEqual(sell_px, 100.01, places=4)
        self.assertGreater(sell_px, 100.00)
        self.assertLess(sell_px, 100.50)

        # If max_chase_price is stricter (100.05 > 100.01), candidate 100.01 is rejected -> falls back to best_ask 100.50
        sell_px_bounded = chase_exec._calculate_target_maker_price(
            exit_side="sell",
            ob=ob,
            tick=0.01,
            peg_strategy="wall_aware",
            wall_multiplier=2.5,
            max_chase_price=100.05,
            exchange=ex,
            symbol="BTC/USDT",
        )
        self.assertAlmostEqual(sell_px_bounded, 100.50, places=4)

        # Buy exit with wide spread (100.00 / 100.50), uniform bids, huge ask wall at asks[3]=100.80
        ob_buy = {
            "bids": [[100.00, 10.0], [99.90, 10.0], [99.80, 10.0], [99.70, 10.0]],
            "asks": [[100.50, 10.0], [100.60, 10.0], [100.70, 10.0], [100.80, 500.0]],
        }
        buy_px = chase_exec._calculate_target_maker_price(
            exit_side="buy",
            ob=ob_buy,
            tick=0.01,
            peg_strategy="wall_aware",
            wall_multiplier=2.5,
            max_chase_price=101.00,
            exchange=ex,
            symbol="BTC/USDT",
        )
        self.assertAlmostEqual(buy_px, 100.49, places=4)
        self.assertGreater(buy_px, 100.00)
        self.assertLess(buy_px, 100.50)

        # Strict Maker check when spread == tick (100.00 / 100.01)
        ob_tight = {
            "bids": [[100.00, 10.0], [99.70, 500.0]],
            "asks": [[100.01, 10.0], [100.80, 500.0]],
        }
        self.assertAlmostEqual(
            chase_exec._calculate_target_maker_price("sell", ob_tight, 0.01, "wall_aware", 2.5, 99.0, ex, "BTC/USDT"),
            100.01,
            places=4,
        )
        self.assertAlmostEqual(
            chase_exec._calculate_target_maker_price("buy", ob_tight, 0.01, "wall_aware", 2.5, 101.0, ex, "BTC/USDT"),
            100.00,
            places=4,
        )

    # ── FIX 4 TESTS ───────────────────────────────────────────────────────────

    async def test_fix4_get_live_position_contracts_exact_quote_and_inverse_matching(self):
        """_get_live_position_contracts never cross-matches BTCUSDC vs BTCUSDT or DOGEUSDT vs DOGE/USD:DOGE."""
        ex = MockExchange(symbol="BTC/USDT:USDT")

        # 1. BTCUSDC position must NOT match BTC/USDT:USDT
        ex.positions = [
            {"symbol": "BTC/USDC:USDC", "contracts": 5.0, "info": {"symbol": "BTCUSDC"}},
            {"symbol": "", "contracts": 3.0, "info": {"symbol": "BTCUSDC"}},
        ]
        res = await chase_exec._get_live_position_contracts(ex, "BTC/USDT:USDT", "sell", is_inverse=False)
        self.assertEqual(res, 0.0)

        # 2. Exact linear match via info.symbol when unified symbol empty
        ex.positions = [
            {"symbol": "BTC/USDC:USDC", "contracts": 5.0, "info": {"symbol": "BTCUSDC"}},
            {"symbol": "", "contracts": 0.0, "info": {"symbol": "BTCUSDT", "positionAmt": "1.75"}},
        ]
        res2 = await chase_exec._get_live_position_contracts(ex, "BTC/USDT:USDT", "sell", is_inverse=False)
        self.assertAlmostEqual(res2, 1.75, places=4)

        # 3. Inverse COIN-M DOGE/USD:DOGE rejects DOGEUSDT and matches DOGEUSD_PERP
        ex.positions = [
            {"symbol": "DOGE/USDT:USDT", "contracts": 500.0, "info": {"symbol": "DOGEUSDT"}},
            {"symbol": "", "contracts": 250.0, "info": {"symbol": "DOGEUSDT"}},
        ]
        res3 = await chase_exec._get_live_position_contracts(ex, "DOGE/USD:DOGE", "sell", is_inverse=True)
        self.assertEqual(res3, 0.0)

        ex.positions.append({"symbol": "", "contracts": 42.0, "info": {"symbol": "DOGEUSD_PERP"}})
        res4 = await chase_exec._get_live_position_contracts(ex, "DOGE/USD:DOGE", "sell", is_inverse=True)
        self.assertAlmostEqual(res4, 42.0, places=4)

    # ── FIX 5 TESTS ───────────────────────────────────────────────────────────

    async def test_fix5_active_smart_chase_live_target_update_tighten_and_loosen(self):
        """update_software_bracket updates ACTIVE_SMART_CHASES original_sl & max_chase_price and running loop syncs cleanly."""
        # Part A: Tightening SL triggers circuit breaker sweep
        ex = MockExchange(symbol="BTC/USDT", tick=0.01, bids=[[99.20, 50.0]], asks=[[99.30, 50.0]])
        ex.free_base = 1.0
        task = asyncio.create_task(
            chase_exec.execute_manual_smart_chase(
                exchange=ex,
                symbol="BTC/USDT",
                exit_side="sell",
                sell_amount_raw=1.0,
                entry_price=102.0,
                original_sl=100.0,
                max_deviation_pct=1.0,  # initial max_chase_price = 99.0
                chase_delay_ms=200,
                max_attempts=10,
                is_futures=False,
                chase_id="chase_fix5_tighten",
                chase_mode="dynamic_bbo",
            )
        )

        for _ in range(30):
            await asyncio.sleep(0.05)
            if "chase_fix5_tighten" in chase_exec.ACTIVE_SMART_CHASES and len(ex.limit_orders_placed) >= 1:
                break

        c_meta = chase_exec.ACTIVE_SMART_CHASES["chase_fix5_tighten"]
        self.assertEqual(c_meta["max_deviation_pct"], 1.0)
        self.assertAlmostEqual(c_meta["max_chase_price"], 99.0, places=4)

        # Tighten SL to 101.0 -> max_chase_price becomes 99.99 > 99.30 -> triggers market sweep
        upd = await BracketOrderService.update_software_bracket("chase_fix5_tighten", 101.0, api_key_id=1, user_id=0)
        self.assertEqual(upd["status"], "success")
        self.assertAlmostEqual(upd["max_chase_price"], 99.99, places=4)

        res = await asyncio.wait_for(task, timeout=4.0)
        self.assertIsNotNone(res)
        self.assertEqual(len(ex.market_orders_placed), 1)

        # Part B: Loosening SL prevents false circuit breaker sweep when price drops below old max_chase_price
        ex2 = MockExchange(symbol="BTC/USDT", tick=0.01, bids=[[99.20, 50.0]], asks=[[99.30, 50.0]])
        ex2.free_base = 1.0
        task2 = asyncio.create_task(
            chase_exec.execute_manual_smart_chase(
                exchange=ex2,
                symbol="BTC/USDT",
                exit_side="sell",
                sell_amount_raw=1.0,
                entry_price=102.0,
                original_sl=100.0,
                max_deviation_pct=1.0,  # initial max_chase_price = 99.0
                chase_delay_ms=200,
                max_attempts=10,
                is_futures=False,
                chase_id="chase_fix5_loosen",
                chase_mode="dynamic_bbo",
            )
        )

        for _ in range(30):
            await asyncio.sleep(0.05)
            if "chase_fix5_loosen" in chase_exec.ACTIVE_SMART_CHASES and len(ex2.limit_orders_placed) >= 1:
                break

        await BracketOrderService.update_software_bracket("chase_fix5_loosen", 98.0, api_key_id=1, user_id=0)
        self.assertAlmostEqual(chase_exec.ACTIVE_SMART_CHASES["chase_fix5_loosen"]["max_chase_price"], 97.02, places=4)

        # Wait a poll so inner watch syncs new max_chase_price=97.02, then drop book to 98.40 / 98.50 (below old 99.0, above new 97.02)
        await asyncio.sleep(0.35)
        ex2._bids = [[98.40, 50.0]]
        ex2._asks = [[98.50, 50.0]]

        for _ in range(40):
            await asyncio.sleep(0.05)
            if len(ex2.limit_orders_placed) >= 2:
                o2 = ex2.limit_orders_placed[-1]
                o2["status"] = "closed"
                o2["filled"] = 1.0
                break

        res2 = await asyncio.wait_for(task2, timeout=5.0)
        self.assertEqual(res2["status"], "closed")
        self.assertEqual(len(ex2.market_orders_placed), 0)
        self.assertAlmostEqual(ex2.limit_orders_placed[-1]["price"], 98.50, places=2)

    # ── FIX 6 TESTS ───────────────────────────────────────────────────────────

    async def test_fix6_mark_entry_bracket_closed_across_loops_prevents_stale_drag_sl_cancel(self):
        """Closed brackets are removed from ACTIVE_ENTRY_BRACKETS and KNOWN_TP_ORDER_IDS across monitor loops."""
        # Direct helper test (both entry-keyed and tp:-keyed entries)
        BracketOrderService.ACTIVE_ENTRY_BRACKETS["e1"] = {"entry_order_id": "e1", "tp_order_id": "tp1", "cancelled": False}
        BracketOrderService.ACTIVE_ENTRY_BRACKETS["tp:tp2"] = {"entry_order_id": None, "tp_order_id": "tp2", "cancelled": False}
        BracketOrderService.KNOWN_TP_ORDER_IDS.update({"tp1", "tp2", "tp_other"})

        BracketOrderService._mark_entry_bracket_closed(entry_order_id="e1", tp_order_id="tp1")
        self.assertNotIn("e1", BracketOrderService.ACTIVE_ENTRY_BRACKETS)
        self.assertNotIn("tp1", BracketOrderService.KNOWN_TP_ORDER_IDS)
        self.assertIn("tp:tp2", BracketOrderService.ACTIVE_ENTRY_BRACKETS)
        self.assertIn("tp_other", BracketOrderService.KNOWN_TP_ORDER_IDS)

        BracketOrderService._mark_entry_bracket_closed(tp_order_id="tp2")
        self.assertNotIn("tp:tp2", BracketOrderService.ACTIVE_ENTRY_BRACKETS)
        self.assertNotIn("tp2", BracketOrderService.KNOWN_TP_ORDER_IDS)
        self.assertIn("tp_other", BracketOrderService.KNOWN_TP_ORDER_IDS)

        # End-to-end Smart Chase monitor loop: TP fills -> ACTIVE_ENTRY_BRACKETS & KNOWN_TP_ORDER_IDS cleaned
        ex = MockExchange(symbol="BTC/USDT", tick=0.01, bids=[[100.0, 50.0]], asks=[[100.1, 50.0]])
        ex._last = 100.0
        api_rec = SimpleNamespace(id=1, exchange="binance", api_key="k", secret_key="s", passphrase=None)
        tp_cfg = {"enabled": True, "mode": "absolute", "value": 105.0, "order_type": "Limit", "timeout_mins": 0}
        sl_cfg = {
            "enabled": True,
            "type": "smart_chase",
            "mode": "absolute",
            "value": 95.0,
            "smart_chase_delay_ms": 200,
            "smart_chase_max_attempts": 3,
        }
        res = await BracketOrderService._spawn_bracket_for_amount(
            exchange=ex,
            symbol="BTC/USDT",
            side="buy",
            filled_amount=1.0,
            average_price=100.0,
            is_futures=False,
            tp_config=tp_cfg,
            sl_config=sl_cfg,
            user_id=0,
            api_key_record=api_rec,
            entry_order_id="entry_fix6",
        )
        old_tp_id = res["tp_order_id"]
        self.assertIn("entry_fix6", BracketOrderService.ACTIVE_ENTRY_BRACKETS)
        self.assertIn(old_tp_id, BracketOrderService.KNOWN_TP_ORDER_IDS)

        # Simulate TP fill on exchange
        ex.orders[old_tp_id]["status"] = "closed"
        ex.orders[old_tp_id]["filled"] = 1.0
        ex._last = 105.0
        ex._bids = [[105.0, 50.0]]
        ex._asks = [[105.1, 50.0]]

        for _ in range(30):
            await asyncio.sleep(0.1)
            if "entry_fix6" not in BracketOrderService.ACTIVE_ENTRY_BRACKETS and len(BracketOrderService.ACTIVE_SOFTWARE_SL) == 0:
                break

        self.assertNotIn("entry_fix6", BracketOrderService.ACTIVE_ENTRY_BRACKETS)
        self.assertNotIn(old_tp_id, BracketOrderService.KNOWN_TP_ORDER_IDS)

        # Simulate Fixed SL Auto-Breakeven loop exit via user cancellation -> cleans entry bracket too
        BracketOrderService.ACTIVE_ENTRY_BRACKETS["entry_fixed_6"] = {
            "entry_order_id": "entry_fixed_6",
            "tp_order_id": "tp_fixed_6",
            "cancelled": False,
        }
        BracketOrderService.KNOWN_TP_ORDER_IDS.add("tp_fixed_6")
        fixed_task = asyncio.create_task(
            BracketOrderService._fixed_sl_auto_breakeven_loop(
                exchange=ex,
                symbol="BTC/USDT",
                opposite_side="sell",
                amount=1.0,
                entry_price=100.0,
                initial_sl_price=95.0,
                is_futures=False,
                user_id=0,
                api_key_record=api_rec,
                tp_order_id="tp_fixed_6",
                auto_breakeven_enabled=False,
                entry_order_id="entry_fixed_6",
            )
        )
        await asyncio.sleep(0.05)
        for sdata in BracketOrderService.ACTIVE_SOFTWARE_SL.values():
            sdata["cancelled"] = True
        await asyncio.wait_for(fixed_task, timeout=3.0)
        self.assertNotIn("entry_fixed_6", BracketOrderService.ACTIVE_ENTRY_BRACKETS)
        self.assertNotIn("tp_fixed_6", BracketOrderService.KNOWN_TP_ORDER_IDS)

        # Simulate Trailing SL loop exit via user cancellation -> cleans entry bracket too
        BracketOrderService.ACTIVE_ENTRY_BRACKETS["entry_trail_6"] = {
            "entry_order_id": "entry_trail_6",
            "tp_order_id": "tp_trail_6",
            "cancelled": False,
        }
        BracketOrderService.KNOWN_TP_ORDER_IDS.add("tp_trail_6")
        trail_task = asyncio.create_task(
            BracketOrderService._software_trailing_stop_loop(
                exchange=ex,
                symbol="BTC/USDT",
                opposite_side="sell",
                amount=1.0,
                entry_price=100.0,
                mode="percentage",
                val=2.0,
                is_futures=False,
                user_id=0,
                api_key_record=api_rec,
                tp_order_id="tp_trail_6",
                is_smart_chase_exit=True,
                entry_order_id="entry_trail_6",
            )
        )
        await asyncio.sleep(0.05)
        for sdata in BracketOrderService.ACTIVE_SOFTWARE_SL.values():
            sdata["cancelled"] = True
        await asyncio.wait_for(trail_task, timeout=2.0)
        self.assertNotIn("entry_trail_6", BracketOrderService.ACTIVE_ENTRY_BRACKETS)
        self.assertNotIn("tp_trail_6", BracketOrderService.KNOWN_TP_ORDER_IDS)

    # ── FIX 7 TESTS ───────────────────────────────────────────────────────────

    async def test_fix7_vwap_entry_price_sync_for_auto_breakeven_across_loops(self):
        """Partial-fill VWAP entry_price updates on sl_meta immediately propagate to Auto-Breakeven calculations."""
        ex = MockExchange(symbol="BTC/USDT", tick=0.01, bids=[[101.50, 50.0]], asks=[[101.60, 50.0]])
        ex._last = 101.50
        api_rec = SimpleNamespace(id=1, exchange="binance", api_key="k", secret_key="s", passphrase=None)

        # 1. Smart Chase Monitor Loop
        sc_task = asyncio.create_task(
            BracketOrderService._smart_chase_monitor_loop(
                exchange=ex,
                symbol="BTC/USDT",
                opposite_side="sell",
                amount=1.0,
                entry_price=100.0,
                sl_price=95.0,
                max_deviation_pct=1.0,
                chase_delay_ms=200,
                max_attempts=2,
                is_futures=False,
                user_id=0,
                api_key_record=api_rec,
                auto_breakeven_enabled=True,
                auto_breakeven_trigger_pct=2.0,
                auto_breakeven_buffer_pct=0.1,
                entry_order_id="vwap_sc",
            )
        )
        await asyncio.sleep(0.2)
        sl_id = next(iter(BracketOrderService.ACTIVE_SOFTWARE_SL.keys()))
        sl_meta = BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]
        # At entry=100.0 and bid=101.50 (+1.5% < 2.0%), BE must NOT activate yet
        self.assertFalse(sl_meta["breakeven_activated"])

        # Simulate partial-fill VWAP consolidation lowering entry_price to 98.0 (+3.57% >= 2.0%)
        sl_meta["entry_price"] = 98.0
        for _ in range(20):
            await asyncio.sleep(0.1)
            if sl_meta.get("breakeven_activated"):
                break

        self.assertTrue(sl_meta["breakeven_activated"])
        # Target BE = 98.0 * 1.001 = 98.098 (NOT 100.0 * 1.001 = 100.1)
        self.assertAlmostEqual(sl_meta["trigger_price"], 98.098, places=3)
        sl_meta["cancelled"] = True
        await asyncio.wait_for(sc_task, timeout=2.0)

        # 2. Trailing Stop Loop
        tr_task = asyncio.create_task(
            BracketOrderService._software_trailing_stop_loop(
                exchange=ex,
                symbol="BTC/USDT",
                opposite_side="sell",
                amount=1.0,
                entry_price=100.0,
                mode="percentage",
                val=10.0,
                is_futures=False,
                user_id=0,
                api_key_record=api_rec,
                is_smart_chase_exit=True,
                auto_breakeven_enabled=True,
                auto_breakeven_trigger_pct=2.0,
                auto_breakeven_buffer_pct=0.1,
                entry_order_id="vwap_tr",
            )
        )
        await asyncio.sleep(0.05)
        tr_id = next(iter(BracketOrderService.ACTIVE_SOFTWARE_SL.keys()))
        tr_meta = BracketOrderService.ACTIVE_SOFTWARE_SL[tr_id]
        tr_meta["entry_price"] = 98.0

        for _ in range(20):
            await asyncio.sleep(0.1)
            if tr_meta.get("breakeven_activated"):
                break

        self.assertTrue(tr_meta["breakeven_activated"])
        self.assertAlmostEqual(tr_meta["trigger_price"], 98.098, places=3)
        tr_meta["cancelled"] = True
        await asyncio.wait_for(tr_task, timeout=2.0)

        # 3. Fixed SL Auto-Breakeven Loop
        fx_task = asyncio.create_task(
            BracketOrderService._fixed_sl_auto_breakeven_loop(
                exchange=ex,
                symbol="BTC/USDT",
                opposite_side="sell",
                amount=1.0,
                entry_price=100.0,
                initial_sl_price=95.0,
                is_futures=False,
                user_id=0,
                api_key_record=api_rec,
                auto_breakeven_enabled=True,
                auto_breakeven_trigger_pct=2.0,
                auto_breakeven_buffer_pct=0.1,
                entry_order_id="vwap_fx",
            )
        )
        await asyncio.sleep(0.05)
        fx_id = next(iter(BracketOrderService.ACTIVE_SOFTWARE_SL.keys()))
        fx_meta = BracketOrderService.ACTIVE_SOFTWARE_SL[fx_id]
        fx_meta["entry_price"] = 98.0

        for _ in range(30):
            await asyncio.sleep(0.1)
            if fx_meta.get("breakeven_activated"):
                break

        self.assertTrue(fx_meta["breakeven_activated"])
        self.assertAlmostEqual(fx_meta["trigger_price"], 98.098, places=3)
        fx_meta["cancelled"] = True
        await asyncio.wait_for(fx_task, timeout=3.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
