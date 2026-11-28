import asyncio
import pytest

from app.services.maker_tp_guard import (
    compute_maker_safe_tp_price,
    is_gtc_taker_net_profitable,
    place_strict_maker_tp_order,
)


class _DummyExchange:
    markets = {
        "BTC/USDC:USDC": {
            "precision": {"price": 0.1},
            "maker": 0.0,
            "taker": 0.0004,
        }
    }


def test_compute_maker_safe_tp_price_flash_drop_short():
    # User's exact scenario: Short @ 59750, TP @ 59745, flash-drop to 59740/59741
    px, repegged = compute_maker_safe_tp_price(
        opposite_side="buy",
        target_tp_price=59745.0,
        best_bid=59740.0,
        best_ask=59741.0,
        tick_size=0.1,
    )
    assert repegged is True
    assert px == pytest.approx(59740.0)
    assert px < 59741.0  # strictly Maker side
    assert px <= 59745.0  # more profitable than original TP


def test_compute_maker_safe_tp_price_normal_non_crossing():
    px, repegged = compute_maker_safe_tp_price(
        opposite_side="buy",
        target_tp_price=59745.0,
        best_bid=59748.0,
        best_ask=59749.0,
        tick_size=0.1,
    )
    assert repegged is False
    assert px == pytest.approx(59745.0)


def test_tight_scalp_blocks_unprofitable_gtc_taker():
    # $5 profit on $59,750 = 0.00837% vs 0.04% taker fee -> guaranteed net loss!
    assert (
        is_gtc_taker_net_profitable(
            entry_price=59750.0,
            est_exit_price=59745.0,
            opposite_side="buy",
            taker_rate=0.0004,
        )
        is False
    )
    # Wide TP (+$200 = 0.335% > 1.5 * 0.04% = 0.06%) -> net profitable
    assert (
        is_gtc_taker_net_profitable(
            entry_price=59750.0,
            est_exit_price=59550.0,
            opposite_side="buy",
            taker_rate=0.0004,
        )
        is True
    )


def test_place_strict_maker_tp_single_rtt_on_flash_drop(monkeypatch):
    import app.services.maker_tp_guard as guard_mod

    async def fake_ram_bbo(*args, **kwargs):
        return 59740.0, 59741.0

    monkeypatch.setattr(guard_mod, "_read_ram_bbo_fast", fake_ram_bbo)

    calls = []

    async def fake_place(px, amt, params):
        calls.append((px, amt, dict(params)))
        return {"id": "tp-1", "status": "open", "price": px}

    res, placed_px, meta = asyncio.run(
        place_strict_maker_tp_order(
            order_ex=_DummyExchange(),
            symbol="BTC/USDC:USDC",
            opposite_side="buy",
            amount=0.1,
            target_tp_price=59745.0,
            entry_price=59750.0,
            base_params={"reduceOnly": True},
            is_futures=True,
            place_limit_fn=fake_place,
            format_price_fn=lambda p: round(p, 1),
            strict_maker=True,
        )
    )

    assert len(calls) == 1  # 1 single RTT (<250ms), zero wasted round-trips!
    assert calls[0][2].get("postOnly") is True
    assert placed_px == pytest.approx(59740.0)
    assert meta["is_maker"] is True
    assert meta["was_repegged"] is True


def test_place_strict_maker_tp_blocks_losing_gtc_after_gtx_expiry(monkeypatch):
    import app.services.maker_tp_guard as guard_mod

    bbo_seq = iter([(59740.0, 59741.0), (59742.0, 59743.0), (59744.0, 59745.0)])

    async def fake_ram_bbo(*args, **kwargs):
        try:
            return next(bbo_seq)
        except StopIteration:
            return 59744.0, 59745.0

    monkeypatch.setattr(guard_mod, "_read_ram_bbo_fast", fake_ram_bbo)

    calls = []

    async def fake_place(px, amt, params):
        calls.append((px, dict(params)))
        # First 3 attempts expire in flight; 4th deep passive GTX succeeds
        if len(calls) <= 3:
            return {"id": f"exp-{len(calls)}", "status": "expired"}
        return {"id": "tp-deep-maker", "status": "open", "price": px}

    res, placed_px, meta = asyncio.run(
        place_strict_maker_tp_order(
            order_ex=_DummyExchange(),
            symbol="BTC/USDC:USDC",
            opposite_side="buy",
            amount=0.1,
            target_tp_price=59745.0,
            entry_price=59750.0,
            base_params={"reduceOnly": True},
            is_futures=True,
            place_limit_fn=fake_place,
            format_price_fn=lambda p: round(p, 1),
            strict_maker=True,
            max_maker_attempts=3,
        )
    )

    # Every single call MUST be postOnly=True — NEVER GTC Taker!
    assert all(p.get("postOnly") is True for _, p in calls)
    assert meta["is_maker"] is True
    assert placed_px < 59745.0
    assert res["id"] == "tp-deep-maker"
