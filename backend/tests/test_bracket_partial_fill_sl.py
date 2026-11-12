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
    # Stub app package hierarchy without triggering full app.__init__ if needed
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
    def __init__(self, symbol="DOGE/FDUSD", tick=0.00001, bids=None, asks=None):
        self.id = "binance"
        self.symbol = symbol
        self.markets = {
            symbol: {
                "symbol": symbol,
                "base": symbol.split("/")[0],
                "quote": symbol.split("/")[1].split(":")[0],
                "precision": {"price": tick, "amount": 1.0},
                "limits": {"cost": {"min": 5.0}},
            }
        }
        self._bids = bids or [[0.06763, 50000.0]]
        self._asks = asks or [[0.06766, 50000.0]]
        self._next_id = 100
        self.orders = {}
        self.limit_orders_placed = []
        self.market_orders_placed = []
        self.cancelled_orders = []
        self.conditional_orders_placed = []
        self.free_quote = 1000.0
        self.free_base = 50000.0

    def price_to_precision(self, symbol, price):
        return f"{round(float(price), 5):.5f}"

    def amount_to_precision(self, symbol, amount):
        return f"{int(round(float(amount)))}"

    async def fetch_ticker(self, symbol):
        bid = float(self._bids[0][0])
        ask = float(self._asks[0][0])
        return {"last": bid, "bid": bid, "ask": ask}

    async def fetch_order_book(self, symbol, limit=5):
        return {"bids": list(self._bids), "asks": list(self._asks)}

    async def fetch_balance(self, params=None):
        base, quote = self.symbol.split("/")[0], self.symbol.split("/")[1].split(":")[0]
        return {
            base: {"free": self.free_base},
            quote: {"free": self.free_quote},
            "free": {base: self.free_base, quote: self.free_quote},
        }

    async def create_limit_order(self, symbol, side, amount, price, params=None):
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
            "params": dict(params or {}),
        }
        self.conditional_orders_placed.append(order)
        self.orders[oid] = order
        return order

    async def fetch_order(self, order_id, symbol, params=None):
        return self.orders.get(str(order_id), {"id": str(order_id), "status": "open", "filled": 0.0})

    async def cancel_order(self, order_id, symbol, params=None):
        self.cancelled_orders.append(str(order_id))
        if str(order_id) in self.orders:
            self.orders[str(order_id)]["status"] = "canceled"
        return {"id": str(order_id), "status": "canceled", "filled": 0.0}


class TestBracketPartialFillSL(unittest.IsolatedAsyncioTestCase):
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
        await asyncio.sleep(0.05)
        BracketOrderService.ACTIVE_SOFTWARE_SL.clear()
        BracketOrderService.ACTIVE_ENTRY_BRACKETS.clear()
        chase_exec.ACTIVE_SMART_CHASES.clear()

    async def test_doge_fdusd_partial_fill_smart_chase_price_mode_does_not_corrupt_sl(self):
        """
        Reproduces the exact DOGE/FDUSD Spot SELL partial-fill sequence:
        Chunk 1: 1148.0 @ 0.06764 -> TP @ 0.06759, Smart Chase SL @ 0.06784
        Chunk 2: 9363.0 @ 0.06764 -> Consolidated TP 10511.0 @ 0.06759
        Must keep Smart Chase trigger_price at 0.06784 (NOT 0.0002!) and NOT sweep market at 0.06766.
        """
        ex = MockExchange(symbol="DOGE/FDUSD", tick=0.00001, bids=[[0.06763, 50000.0]], asks=[[0.06766, 50000.0]])
        api_rec = SimpleNamespace(id=1, exchange="binance", api_key="k", secret_key="s", passphrase=None)
        tp_cfg = {"enabled": True, "mode": "price", "value": 0.00005, "order_type": "Limit", "timeout_mins": 0}
        sl_cfg = {
            "enabled": True,
            "type": "smart_chase",
            "mode": "price",
            "value": 0.0002,
            "smart_chase_deviation_pct": 5.0,
            "smart_chase_delay_ms": 200,
            "smart_chase_max_attempts": 5,
            "smart_chase_mode": "dynamic_bbo",
            "smart_chase_trigger_source": "bid_ask",
            "smart_chase_peg_strategy": "bbo",
        }

        # Chunk 1: 1148.0 filled
        res1 = await BracketOrderService._spawn_bracket_for_amount(
            exchange=ex,
            symbol="DOGE/FDUSD",
            side="sell",
            filled_amount=1148.0,
            average_price=0.06764,
            is_futures=False,
            tp_config=tp_cfg,
            sl_config=sl_cfg,
            user_id=1,
            api_key_record=api_rec,
            entry_order_id="entry_doge_1",
        )
        self.assertEqual(res1["tp_price"], 0.06759)
        self.assertEqual(len(BracketOrderService.ACTIVE_SOFTWARE_SL), 1)
        sl_entry = next(iter(BracketOrderService.ACTIVE_SOFTWARE_SL.values()))
        self.assertAlmostEqual(sl_entry["trigger_price"], 0.06784, places=5)

        # Chunk 2: remaining 9363.0 filled (consolidation)
        res2 = await BracketOrderService._spawn_bracket_for_amount(
            exchange=ex,
            symbol="DOGE/FDUSD",
            side="sell",
            filled_amount=9363.0,
            average_price=0.06764,
            is_futures=False,
            tp_config=tp_cfg,
            sl_config=sl_cfg,
            user_id=1,
            api_key_record=api_rec,
            entry_order_id="entry_doge_1",
        )
        self.assertEqual(res2["amount"], 10511.0)
        self.assertEqual(res2["tp_price"], 0.06759)

        # Allow monitor loop ticks to run at ask=0.06766 (below 0.06784 SL)
        await asyncio.sleep(0.6)

        self.assertEqual(len(ex.market_orders_placed), 0, "Must NOT fire emergency market sweep at 0.06766!")
        self.assertIn(sl_entry["id"], BracketOrderService.ACTIVE_SOFTWARE_SL)
        self.assertAlmostEqual(sl_entry["trigger_price"], 0.06784, places=5)
        self.assertIsNone(sl_entry.get("manual_trigger_override"))
        self.assertEqual(sl_entry["amount"], 10511.0)

        # Now move Best Ask to 0.06784 to verify Smart Chase triggers cleanly as Post-Only Maker (NOT Circuit Breaker!)
        orig_upgrade = chase_exec
        ex._bids = [[0.06782, 50000.0]]
        ex._asks = [[0.06784, 50000.0]]

        # Wait for SL trigger + maker placement, then mark chase order filled
        for _ in range(15):
            await asyncio.sleep(0.15)
            # Check if Smart Chase placed a postOnly BUY limit order at 0.06782
            chase_buy_limits = [o for o in ex.limit_orders_placed if o["side"] == "buy" and o["params"].get("postOnly") and o["price"] == 0.06782]
            if chase_buy_limits:
                chase_buy_limits[0]["status"] = "closed"
                chase_buy_limits[0]["filled"] = chase_buy_limits[0]["amount"]
                break

        self.assertEqual(len(ex.market_orders_placed), 0, "Smart Chase should exit via Maker Limit, not Market Sweep!")
        chase_buys = [o for o in ex.limit_orders_placed if o["side"] == "buy" and o["price"] == 0.06782]
        self.assertGreaterEqual(len(chase_buys), 1)
        self.assertTrue(chase_buys[0]["params"].get("postOnly"))

    async def test_percentage_mode_partial_fill_recalculates_from_weighted_entry(self):
        ex = MockExchange(symbol="BTC/USDT", tick=0.1, bids=[[99.9, 10.0]], asks=[[100.1, 10.0]])
        ex.price_to_precision = lambda s, p: f"{round(float(p), 2):.2f}"
        api_rec = SimpleNamespace(id=1, exchange="binance", api_key="k", secret_key="s", passphrase=None)
        sl_cfg = {"enabled": True, "type": "smart_chase", "mode": "percentage", "value": 2.0}

        # Chunk 1: 1.0 @ 100.0 -> Long SL should be 98.0
        await BracketOrderService._spawn_bracket_for_amount(
            exchange=ex, symbol="BTC/USDT", side="buy", filled_amount=1.0, average_price=100.0,
            is_futures=False, tp_config=None, sl_config=sl_cfg, user_id=1, api_key_record=api_rec,
            entry_order_id="entry_btc_pct",
        )
        sl_entry = next(iter(BracketOrderService.ACTIVE_SOFTWARE_SL.values()))
        self.assertAlmostEqual(sl_entry["trigger_price"], 98.0, places=2)

        # Chunk 2: 1.0 @ 102.0 -> weighted_entry = 101.0 -> Long SL 2% below = 98.98 (NOT 2.0!)
        await BracketOrderService._spawn_bracket_for_amount(
            exchange=ex, symbol="BTC/USDT", side="buy", filled_amount=1.0, average_price=102.0,
            is_futures=False, tp_config=None, sl_config=sl_cfg, user_id=1, api_key_record=api_rec,
            entry_order_id="entry_btc_pct",
        )
        self.assertAlmostEqual(sl_entry["trigger_price"], 98.98, places=2)
        self.assertIsNone(sl_entry.get("manual_trigger_override"))

    async def test_trailing_and_manual_override_preserved_on_consolidation(self):
        ex = MockExchange(symbol="DOGE/FDUSD", tick=0.00001, bids=[[0.06760, 50000.0]], asks=[[0.06762, 50000.0]])
        api_rec = SimpleNamespace(id=1, exchange="binance", api_key="k", secret_key="s", passphrase=None)
        trail_cfg = {"enabled": True, "type": "trailing_chase", "mode": "price", "value": 0.0002}

        await BracketOrderService._spawn_bracket_for_amount(
            exchange=ex, symbol="DOGE/FDUSD", side="sell", filled_amount=500.0, average_price=0.06764,
            is_futures=False, tp_config=None, sl_config=trail_cfg, user_id=1, api_key_record=api_rec,
            entry_order_id="entry_trail_1",
        )
        sl_entry = next(iter(BracketOrderService.ACTIVE_SOFTWARE_SL.values()))
        sl_entry["trigger_price"] = 0.06780

        # Consolidation chunk must NOT clobber trailing trigger_price or set manual_trigger_override
        await BracketOrderService._spawn_bracket_for_amount(
            exchange=ex, symbol="DOGE/FDUSD", side="sell", filled_amount=500.0, average_price=0.06764,
            is_futures=False, tp_config=None, sl_config=trail_cfg, user_id=1, api_key_record=api_rec,
            entry_order_id="entry_trail_1",
        )
        self.assertAlmostEqual(sl_entry["trigger_price"], 0.06780, places=5)
        self.assertIsNone(sl_entry.get("manual_trigger_override"))

        # Explicit non-consolidation absolute override (e.g. chart drag) DOES update trigger_price & manual_trigger_override
        drag_cfg = {"enabled": True, "type": "trailing_chase", "mode": "absolute", "value": 0.06795}
        await BracketOrderService._spawn_bracket_for_amount(
            exchange=ex, symbol="DOGE/FDUSD", side="sell", filled_amount=1000.0, average_price=0.06764,
            is_futures=False, tp_config=None, sl_config=drag_cfg, user_id=1, api_key_record=api_rec,
            entry_order_id="entry_trail_1", is_consolidation_chunk=False,
        )
        self.assertAlmostEqual(sl_entry["trigger_price"], 0.06795, places=5)
        self.assertAlmostEqual(sl_entry["manual_trigger_override"], 0.06795, places=5)

    async def test_manual_override_and_breakeven_not_clobbered_by_consolidation(self):
        ex = MockExchange(symbol="DOGE/FDUSD", tick=0.00001, bids=[[0.06740, 50000.0]], asks=[[0.06742, 50000.0]])
        api_rec = SimpleNamespace(id=1, exchange="binance", api_key="k", secret_key="s", passphrase=None)
        sl_cfg = {"enabled": True, "type": "smart_chase", "mode": "price", "value": 0.0002}

        await BracketOrderService._spawn_bracket_for_amount(
            exchange=ex, symbol="DOGE/FDUSD", side="sell", filled_amount=500.0, average_price=0.06764,
            is_futures=False, tp_config=None, sl_config=sl_cfg, user_id=1, api_key_record=api_rec,
            entry_order_id="entry_be_1",
        )
        sl_entry = next(iter(BracketOrderService.ACTIVE_SOFTWARE_SL.values()))
        sl_entry["breakeven_activated"] = True
        sl_entry["trigger_price"] = 0.06760

        await BracketOrderService._spawn_bracket_for_amount(
            exchange=ex, symbol="DOGE/FDUSD", side="sell", filled_amount=500.0, average_price=0.06764,
            is_futures=False, tp_config=None, sl_config=sl_cfg, user_id=1, api_key_record=api_rec,
            entry_order_id="entry_be_1",
        )
        self.assertAlmostEqual(sl_entry["trigger_price"], 0.06760, places=5)


if __name__ == "__main__":
    unittest.main(verbosity=2)

