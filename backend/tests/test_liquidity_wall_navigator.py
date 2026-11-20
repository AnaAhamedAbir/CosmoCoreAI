import asyncio
import os
import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import patch

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def _install_stubs():
    if "app.services.notification" not in sys.modules:
        notif_mod = types.ModuleType("app.services.notification")

        class NotificationService:
            @staticmethod
            async def send_message(*args, **kwargs):
                return None

        notif_mod.NotificationService = NotificationService
        sys.modules["app.services.notification"] = notif_mod

    if "app.db.session" not in sys.modules:
        sess_mod = types.ModuleType("app.db.session")
        sess_mod.SessionLocal = lambda: None
        sys.modules["app.db.session"] = sess_mod

    if "app.services.user_order_stream" not in sys.modules:
        uos_mod = types.ModuleType("app.services.user_order_stream")

        async def _get_redis_pub():
            return None

        async def publish_order_sync_event(*args, **kwargs):
            return None

        uos_mod._get_redis_pub = _get_redis_pub
        uos_mod.ensure_user_order_stream = lambda *a, **kw: None
        uos_mod.mark_order_replaced = lambda *a, **kw: None
        uos_mod.publish_order_sync_event = publish_order_sync_event
        sys.modules["app.services.user_order_stream"] = uos_mod
    elif not hasattr(sys.modules["app.services.user_order_stream"], "_get_redis_pub"):
        async def _get_redis_pub():
            return None
        sys.modules["app.services.user_order_stream"]._get_redis_pub = _get_redis_pub


_install_stubs()

from app.services.liquidity_wall_navigator import (
    compute_smart_peg_entry_price,
    detect_orderbook_walls,
    evaluate_wall_spoof_event,
    find_nearest_wall_targets,
)
from app.services.smart_peg_entry_executor import execute_smart_peg_entry


class _DummyExchange:
    id = "binance"
    has = {"createOrderWs": False, "editOrderWs": False, "editOrder": False}
    markets = {
        "DOGE/USDT": {
            "base": "DOGE",
            "quote": "USDT",
            "precision": {"price": 5, "amount": 0},
            "limits": {"cost": {"min": 5.0}},
        }
    }

    def price_to_precision(self, symbol, price):
        return f"{float(price):.5f}"

    def amount_to_precision(self, symbol, amount):
        return str(int(round(float(amount))))


class TestLiquidityWallNavigator(unittest.TestCase):
    def test_detect_and_front_run_nearest_buy_and_sell_walls(self):
        ex = _DummyExchange()
        ob = {
            "bids": [
                [0.15000, 1000],
                [0.14995, 1200],
                [0.14990, 900],
                [0.14920, 50000],  # Big Buy Wall (~50x normal)
                [0.14850, 1100],
            ],
            "asks": [
                [0.15010, 1100],
                [0.15020, 950],
                [0.15080, 45000],  # Big Sell Wall (~40x normal)
                [0.15150, 1200],
            ],
        }
        walls = detect_orderbook_walls(ob, wall_multiplier=2.5)
        self.assertEqual(len(walls["buy_walls"]), 1)
        self.assertAlmostEqual(walls["buy_walls"][0]["price"], 0.14920)
        self.assertEqual(len(walls["sell_walls"]), 1)
        self.assertAlmostEqual(walls["sell_walls"][0]["price"], 0.15080)

        targets = find_nearest_wall_targets(ob, wall_multiplier=2.5, front_run_ticks=1, exchange=ex, symbol="DOGE/USDT")
        self.assertAlmostEqual(targets["buy_front_run_price"], 0.14921, places=5)
        self.assertAlmostEqual(targets["sell_front_run_price"], 0.15079, places=5)

    def test_compute_smart_peg_entry_price_strategies_and_strict_maker(self):
        ex = _DummyExchange()
        ob = {
            "bids": [
                [0.15000, 1000],
                [0.14990, 1200],
                [0.14950, 40000],  # Buy support wall
                [0.14900, 1000],
            ],
            "asks": [
                [0.15020, 1100],
                [0.15030, 1000],
                [0.15090, 42000],  # Sell resistance wall
                [0.15120, 1000],
            ],
        }
        tick = 0.00001

        px_bbo, wall_bbo = compute_smart_peg_entry_price("buy", ob, tick, peg_strategy="bbo", exchange=ex, symbol="DOGE/USDT")
        self.assertAlmostEqual(px_bbo, 0.15000, places=5)
        self.assertIsNone(wall_bbo)

        px_in, _ = compute_smart_peg_entry_price("buy", ob, tick, peg_strategy="inside_spread", exchange=ex, symbol="DOGE/USDT")
        self.assertAlmostEqual(px_in, 0.15001, places=5)
        self.assertLess(px_in, 0.15020)

        px_wall_buy, tracked_buy = compute_smart_peg_entry_price(
            "buy", ob, tick, peg_strategy="wall_aware", wall_multiplier=2.5, front_run_ticks=2, exchange=ex, symbol="DOGE/USDT"
        )
        self.assertAlmostEqual(px_wall_buy, 0.14952, places=5)
        self.assertIsNotNone(tracked_buy)
        self.assertAlmostEqual(tracked_buy["price"], 0.14950, places=5)

        px_wall_sell, tracked_sell = compute_smart_peg_entry_price(
            "sell", ob, tick, peg_strategy="wall_aware", wall_multiplier=2.5, front_run_ticks=1, exchange=ex, symbol="DOGE/USDT"
        )
        self.assertAlmostEqual(px_wall_sell, 0.15089, places=5)
        self.assertIsNotNone(tracked_sell)
        self.assertAlmostEqual(tracked_sell["price"], 0.15090, places=5)

        # Anchor cap respected even when wall is above anchor
        px_anchored, _ = compute_smart_peg_entry_price(
            "buy", ob, tick, peg_strategy="wall_aware", anchor_price=0.14930, exchange=ex, symbol="DOGE/USDT"
        )
        self.assertLessEqual(px_anchored, 0.14930)

    def test_evaluate_wall_spoof_event_detects_pulled_wall(self):
        tracked = {"price": 0.14950, "size": 50000.0, "type": "buy"}
        ob_intact = {"bids": [[0.15000, 1000], [0.14950, 48000]], "asks": [[0.15010, 1000]]}
        spoofed, sz, _ = evaluate_wall_spoof_event(tracked, ob_intact, pull_drop_ratio=0.55)
        self.assertFalse(spoofed)
        self.assertEqual(sz, 48000.0)

        ob_pulled = {"bids": [[0.15000, 1000], [0.14950, 1200], [0.14900, 1000]], "asks": [[0.15010, 1000]]}
        spoofed2, sz2, reason = evaluate_wall_spoof_event(tracked, ob_pulled, pull_drop_ratio=0.55)
        self.assertTrue(spoofed2)
        self.assertEqual(sz2, 1200.0)
        self.assertIn("pulled", reason)

        # If wall drifted deeper beyond visible depth window (0.14950 < deepest 0.14980), do not false-trigger spoof
        ob_shifted_up = {"bids": [[0.15010, 1000], [0.14980, 1000]], "asks": [[0.15020, 1000]]}
        spoofed3, _, _ = evaluate_wall_spoof_event(tracked, ob_shifted_up, pull_drop_ratio=0.55)
        self.assertFalse(spoofed3)

    def test_smart_peg_wall_aware_anti_spoof_retreats_and_fills(self):
        async def _run():
            ob_phase1 = {
                "bids": [
                    [0.15000, 1000],
                    [0.14990, 1100],
                    [0.14980, 950],
                    [0.14970, 1050],
                    [0.14960, 1000],
                    [0.14950, 50000],  # Spoof wall
                    [0.14920, 1000],
                    [0.14900, 1100],
                    [0.14880, 45000],  # Real backup wall
                    [0.14850, 1000],
                ],
                "asks": [[0.15020, 1000], [0.15030, 1000]],
            }
            # Phase 2: whale pulls the 0.14950 spoof wall, leaving real wall at 0.14880
            ob_phase2 = {
                "bids": [
                    [0.14980, 1000],
                    [0.14970, 950],
                    [0.14960, 1050],
                    [0.14950, 800],    # Spoof wall pulled!
                    [0.14920, 1000],
                    [0.14900, 1100],
                    [0.14880, 45000],  # Real wall remains
                    [0.14850, 1000],
                ],
                "asks": [[0.15000, 1000], [0.15010, 1000]],
            }

            call_idx = {"ob": 0, "orders": []}

            class _FakePegExchange(_DummyExchange):
                async def fetch_balance(self):
                    return {"USDT": {"free": 5000.0, "used": 0.0, "total": 5000.0}, "free": {"USDT": 5000.0}}

                async def fetch_order_book(self, symbol, limit=20):
                    call_idx["ob"] += 1
                    return ob_phase1 if call_idx["ob"] <= 2 else ob_phase2

                async def create_limit_order(self, symbol, side, amount, price, params=None):
                    oid = f"oid-{len(call_idx['orders']) + 1}"
                    call_idx["orders"].append((oid, float(price)))
                    # First order (at spoof wall front-run 0.14951) stays open; second order (after spoof pull -> 0.14881) fills!
                    st = "open" if len(call_idx["orders"]) == 1 else "closed"
                    return {
                        "id": oid,
                        "status": st,
                        "price": float(price),
                        "average": float(price),
                        "filled": float(amount) if st == "closed" else 0.0,
                    }

                async def fetch_order(self, oid, symbol):
                    return {"id": oid, "status": "open", "filled": 0.0}

                async def cancel_order(self, oid, symbol):
                    return {"id": oid, "status": "canceled", "filled": 0.0}

            ex = _FakePegExchange()
            with (
                patch("app.services.smart_peg_entry_executor._fetch_bbo_fast", side_effect=ex.fetch_order_book),
                patch("app.services.manual_trade_persistence.schedule_upsert_monitor", return_value=None),
                patch("app.services.manual_trade_persistence.schedule_update_monitor", return_value=None),
                patch("app.services.manual_trade_persistence.schedule_mark_terminal", return_value=None),
            ):
                res = await execute_smart_peg_entry(
                    exchange=ex,
                    symbol="DOGE/USDT",
                    side="buy",
                    amount=1000.0,
                    is_futures=False,
                    user_id=1,
                    api_key_record=SimpleNamespace(id=1, exchange="binance", api_key="k", secret_key="s"),
                    peg_strategy="wall_aware",
                    wall_multiplier=2.5,
                    wall_front_run_ticks=1,
                    anti_spoof_guard=True,
                    send_initial_notify=False,
                    skip_exchange_upgrade=True,
                )

            self.assertIsNotNone(res)
            self.assertEqual(res.get("status"), "closed")
            self.assertGreaterEqual(len(call_idx["orders"]), 2)
            # Order 1 front-ran 0.14950 wall at 0.14951
            self.assertAlmostEqual(call_idx["orders"][0][1], 0.14951, places=5)
            # After 0.14950 wall got pulled, Anti-Spoof retreated to front-run 0.14880 wall at 0.14881!
            self.assertAlmostEqual(call_idx["orders"][1][1], 0.14881, places=5)

        asyncio.run(_run())


if __name__ == "__main__":
    unittest.main()
