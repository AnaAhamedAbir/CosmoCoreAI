"""
Smart Peg Entry Executor
========================
Executes dynamic orderbook-shadowing entry orders for manual trading.
Places Post-Only Maker limit orders at the Best Bid (Buy) or Best Ask (Sell),
continuously shadowing top-of-book (Queue Priority preserved) and re-pegging
sub-second whenever outbid until 100% filled.

Once filled, automatically links and spawns configured Attached TP & Attached SL
(including Smart Chase SL, Trailing SL, or Fixed SL).
"""

import asyncio
import logging
from typing import Optional, Dict, Any
from datetime import datetime
from app.services.notification import NotificationService
from app.db.session import SessionLocal
from app.services.manual_smart_chase_executor import (
    _get_market_tick,
    _get_min_notional,
    _calc_order_notional_usd,
    _is_inverse_market
)

logger = logging.getLogger(__name__)

# Global registry of active Smart Peg Entry executions: { peg_id: { ... } }
ACTIVE_SMART_PEGS: Dict[str, Dict[str, Any]] = {}


async def stop_smart_peg(
    symbol: str,
    api_key_id: Optional[int] = None,
    user_id: Optional[int] = None,
    peg_id: Optional[str] = None
) -> int:
    """
    Signals any matching active smart peg entry execution(s) to abort immediately
    and cancel their resting maker order on the exchange.
    Returns the number of stopped peg tasks.
    """
    stopped_count = 0
    for pid, pdata in list(ACTIVE_SMART_PEGS.items()):
        if peg_id:
            if pid != peg_id:
                continue
        else:
            raw_p_sym = str(pdata.get('symbol', '')).strip()
            raw_target_sym = str(symbol or '').strip()
            if raw_target_sym:
                if (':' in raw_p_sym) != (':' in raw_target_sym):
                    continue
                if raw_p_sym.split(':')[0].upper() != raw_target_sym.split(':')[0].upper():
                    continue

        if api_key_id is not None and pdata.get('api_key_id') is not None and int(pdata.get('api_key_id')) != int(api_key_id):
            continue
        if user_id is not None and pdata.get('user_id') is not None and int(pdata.get('user_id')) != int(user_id):
            continue

        logger.info(f"🛑 [Smart Peg Entry] Aborting active peg {pid} for {pdata.get('symbol') or symbol}...")
        cancel_evt = pdata.get('cancel_event')
        if cancel_evt and not cancel_evt.is_set():
            cancel_evt.set()

        # Proactively cancel resting maker limit order on exchange if present
        curr_order_id = pdata.get('current_order_id')
        ex = pdata.get('exchange')
        if curr_order_id and ex:
            try:
                await ex.cancel_order(curr_order_id, pdata.get('symbol') or symbol)
                logger.info(f"🛑 Proactively cancelled resting entry limit order {curr_order_id} on exchange.")
            except Exception as ce:
                logger.debug(f"Order cancel notice on stop peg: {ce}")

        stopped_count += 1

    return stopped_count


async def execute_smart_peg_entry(
    exchange,
    symbol: str,
    side: str,                  # 'buy' or 'sell'
    amount: float,              # target entry amount
    is_futures: bool = False,
    user_id: int = 0,
    api_key_record = None,
    tp_config: Optional[dict] = None,
    sl_config: Optional[dict] = None,
    max_chase_deviation_pct: float = 2.0, # 0 = unlimited, >0 = maximum price drift cap from start
    max_attempts: int = 0,      # 0 = unlimited
    peg_id: Optional[str] = None,
    reduce_only: bool = False
) -> Optional[Dict[str, Any]]:
    """
    Executes a continuous Dynamic BBO Maker Peg Entry.
    Shadows Best Bid (Buy) or Best Ask (Sell) at top-of-book until fully filled,
    then automatically spawns Attached TP / SL brackets.
    """
    exchange_name = getattr(api_key_record, 'exchange', 'exchange').capitalize() if api_key_record else 'Exchange'
    min_notional = _get_min_notional(exchange, symbol)

    logger.info(
        f"⚡ [Smart Peg Entry] Starting for {symbol} ({side.upper()}) | Amount: {amount} | "
        f"Max Dev Cap: {max_chase_deviation_pct}% | MinNotional: ${min_notional:.2f}"
    )

    # Detect Binance Hedge Mode on Futures
    is_hedge_mode = False
    is_inverse = _is_inverse_market(exchange, symbol)
    if is_futures and exchange_name.lower().startswith('binance'):
        methods = (
            ['dapiPrivateGetPositionSideDual', 'fapiPrivateGetPositionSideDual']
            if is_inverse else
            ['fapiPrivateGetPositionSideDual', 'dapiPrivateGetPositionSideDual']
        )
        for method_name in methods:
            method = getattr(exchange, method_name, None)
            if method and callable(method):
                try:
                    res = await method()
                    is_hedge_mode = bool(res.get('dualSidePosition', False))
                    logger.info(f"⚡ [Smart Peg Entry] Binance Futures mode: {'Hedge' if is_hedge_mode else 'One-Way'}")
                    break
                except Exception:
                    pass

    # Send Notification helper
    async def _send_notify(msg: str):
        if user_id:
            try:
                db = SessionLocal()
                try:
                    await NotificationService.send_message(db, user_id, msg)
                finally:
                    db.close()
            except Exception as notify_err:
                logger.warning(f"Telegram notification failed (non-fatal): {notify_err}")

    # Format initial amount
    remaining_amount = amount
    if hasattr(exchange, 'amount_to_precision'):
        try:
            remaining_amount = float(exchange.amount_to_precision(symbol, remaining_amount))
        except Exception:
            pass

    # Balance sync helper to avoid "insufficient balance" rejections
    async def _sync_and_clamp_amount(price: float) -> float:
        nonlocal remaining_amount
        if is_futures:
            return remaining_amount

        try:
            parts = symbol.split('/')
            if len(parts) >= 2:
                base_asset = parts[0]
                quote_asset = parts[1].split(':')[0]
                bal = await exchange.fetch_balance()

                if side.lower() == "buy":
                    # Buying base using quote (e.g. FDUSD or USDT)
                    free_quote = float(bal.get(quote_asset, {}).get('free', 0.0))
                    if free_quote <= 0:
                        logger.warning(f"⚠️ [Smart Peg Entry] No free {quote_asset} available to buy {base_asset}!")
                        return 0.0

                    # Reserve 0.2% for maker fee buffer so Binance never rejects
                    usable_quote = free_quote * 0.998
                    max_affordable_base = usable_quote / price if price > 0 else 0.0

                    if max_affordable_base < remaining_amount:
                        adjusted = float(exchange.amount_to_precision(symbol, max_affordable_base))
                        if adjusted != remaining_amount:
                            logger.info(
                                f"🔄 [Smart Peg Entry] Clamped buy amount from {remaining_amount} to affordable {base_asset} ({usable_quote:.4f} {quote_asset} free): {adjusted}"
                            )
                            remaining_amount = adjusted
                else:
                    # Selling base for quote
                    free_base = float(bal.get(base_asset, {}).get('free', 0.0))
                    if free_base <= 0:
                        logger.warning(f"⚠️ [Smart Peg Entry] No free {base_asset} available to sell!")
                        return 0.0
                    if free_base < remaining_amount:
                        adjusted = float(exchange.amount_to_precision(symbol, free_base))
                        if adjusted != remaining_amount:
                            logger.info(
                                f"🔄 [Smart Peg Entry] Clamped sell amount from {remaining_amount} to available {base_asset}: {adjusted}"
                            )
                            remaining_amount = adjusted
        except Exception as sync_e:
            logger.warning(f"⚠️ [Smart Peg Entry] Balance sync warning (non-fatal): {sync_e}")

        return remaining_amount

    # Fetch initial orderbook for benchmark price
    initial_ob = None
    try:
        initial_ob = await exchange.fetch_order_book(symbol, limit=5)
    except Exception as ob_err:
        logger.error(f"❌ [Smart Peg Entry] Failed to fetch initial orderbook: {ob_err}")
        return None

    if not initial_ob or not initial_ob.get('bids') or not initial_ob.get('asks') or len(initial_ob['bids']) == 0 or len(initial_ob['asks']) == 0:
        logger.error("❌ [Smart Peg Entry] Empty orderbook returned. Aborting.")
        return None

    b_bid = float(initial_ob['bids'][0][0])
    b_ask = float(initial_ob['asks'][0][0])
    initial_benchmark_price = b_bid if side.lower() == 'buy' else b_ask

    # Initial clamp
    remaining_amount = await _sync_and_clamp_amount(initial_benchmark_price)
    initial_notional = _calc_order_notional_usd(exchange, symbol, remaining_amount, initial_benchmark_price)
    if remaining_amount <= 0 or initial_notional < min_notional:
        logger.warning(f"⚠️ [Smart Peg Entry] Amount {remaining_amount} (~${initial_notional:.2f}) below min notional ${min_notional:.2f}. Aborted.")
        return None

    cid = peg_id or f"peg_{getattr(api_key_record, 'id', user_id)}_{symbol}_{int(datetime.utcnow().timestamp())}"
    cancel_event = asyncio.Event()

    ACTIVE_SMART_PEGS[cid] = {
        'peg_id': cid,
        'symbol': symbol,
        'api_key_id': getattr(api_key_record, 'id', None),
        'user_id': user_id,
        'exchange': exchange,
        'side': side.lower(),
        'amount': remaining_amount,
        'filled_amount': 0.0,
        'initial_price': initial_benchmark_price,
        'status': 'pegging',
        'current_attempt': 0,
        'max_attempts': max_attempts,
        'current_maker_price': initial_benchmark_price,
        'current_order_id': None,
        'cancel_event': cancel_event,
        'started_at': datetime.utcnow().isoformat()
    }

    cached_ob = initial_ob
    attempts = 0
    total_filled = 0.0
    accumulated_cost = 0.0
    final_res = None

    while remaining_amount > 0 and not cancel_event.is_set():
        if max_attempts > 0 and attempts >= max_attempts:
            logger.info(f"⚠️ [Smart Peg Entry] Reached max attempts ({max_attempts}). Stopping.")
            msg = (
                f"⚠️ *Smart Peg Entry Stopped: Max Attempts Reached*\n"
                f"Exchange: {exchange_name}\n"
                f"Pair: `{symbol}`\n"
                f"Side: {side.upper()}\n"
                f"Total Attempts: `{attempts}/{max_attempts}`\n"
                f"Total Filled: `{total_filled}/{amount}`"
            )
            await _send_notify(msg)
            break

        attempts += 1

        # 1. Fetch live orderbook (reuse pre-cached orderbook for 0ms latency on re-pegs!)
        ob = None
        if cached_ob is not None:
            ob = cached_ob
            cached_ob = None
        else:
            try:
                ob = await exchange.fetch_order_book(symbol, limit=5)
            except Exception as ob_e:
                logger.warning(f"⚠️ [Smart Peg Entry] Could not fetch orderbook: {ob_e}")

        if not ob or not ob.get('bids') or not ob.get('asks') or len(ob['bids']) == 0 or len(ob['asks']) == 0:
            await asyncio.sleep(0.5)
            continue

        best_bid = float(ob['bids'][0][0])
        best_ask = float(ob['asks'][0][0])
        tick = _get_market_tick(exchange, symbol, best_bid)

        # 2. Determine Best Maker Price
        # BUY Entry: place at best_bid (if best_bid >= best_ask, place at best_ask - tick)
        # SELL Entry: place at best_ask (if best_ask <= best_bid, place at best_bid + tick)
        if side.lower() == "buy":
            target_maker_price = best_bid
            if target_maker_price >= best_ask:
                target_maker_price = best_ask - tick
        else:
            target_maker_price = best_ask
            if target_maker_price <= best_bid:
                target_maker_price = best_bid + tick

        if hasattr(exchange, 'price_to_precision'):
            try:
                target_maker_price = float(exchange.price_to_precision(symbol, target_maker_price))
            except Exception:
                pass

        # Precision sanity check against spread
        if side.lower() == "buy" and target_maker_price >= best_ask:
            target_maker_price = float(exchange.price_to_precision(symbol, best_ask - tick)) if hasattr(exchange, 'price_to_precision') else (best_ask - tick)
        elif side.lower() == "sell" and target_maker_price <= best_bid:
            target_maker_price = float(exchange.price_to_precision(symbol, best_bid + tick)) if hasattr(exchange, 'price_to_precision') else (best_bid + tick)

        # 3. Check Price Cap Deviation Guard
        if max_chase_deviation_pct and max_chase_deviation_pct > 0:
            if side.lower() == "buy":
                max_allowed_price = initial_benchmark_price * (1 + (max_chase_deviation_pct / 100.0))
                if target_maker_price > max_allowed_price:
                    logger.warning(
                        f"🛑 [Smart Peg Entry] Price {target_maker_price} drifted beyond max cap {max_allowed_price:.6f} "
                        f"(+{max_chase_deviation_pct}% from initial {initial_benchmark_price}). Stopping peg to protect capital."
                    )
                    msg = (
                        f"🛑 *Smart Peg Entry Stopped: Price Drift Cap Hit!*\n"
                        f"Exchange: {exchange_name}\n"
                        f"Pair: `{symbol}`\n"
                        f"Side: {side.upper()}\n"
                        f"Maker Price `{target_maker_price}` drifted beyond cap `{max_allowed_price:.6f}` "
                        f"(+{max_chase_deviation_pct}% drift from initial `{initial_benchmark_price}`).\n"
                        f"Total Filled: `{total_filled}/{amount}`"
                    )
                    await _send_notify(msg)
                    break
            else:
                min_allowed_price = initial_benchmark_price * (1 - (max_chase_deviation_pct / 100.0))
                if target_maker_price < min_allowed_price:
                    logger.warning(
                        f"🛑 [Smart Peg Entry] Price {target_maker_price} drifted below min cap {min_allowed_price:.6f} "
                        f"(-{max_chase_deviation_pct}% from initial {initial_benchmark_price}). Stopping peg to protect capital."
                    )
                    msg = (
                        f"🛑 *Smart Peg Entry Stopped: Price Drift Cap Hit!*\n"
                        f"Exchange: {exchange_name}\n"
                        f"Pair: `{symbol}`\n"
                        f"Side: {side.upper()}\n"
                        f"Maker Price `{target_maker_price}` drifted below min cap `{min_allowed_price:.6f}` "
                        f"(-{max_chase_deviation_pct}% drift from initial `{initial_benchmark_price}`).\n"
                        f"Total Filled: `{total_filled}/{amount}`"
                    )
                    await _send_notify(msg)
                    break

        # Re-clamp amount
        remaining_amount = await _sync_and_clamp_amount(target_maker_price)
        order_notional = _calc_order_notional_usd(exchange, symbol, remaining_amount, target_maker_price)
        if remaining_amount <= 0 or order_notional < min_notional:
            logger.info(f"✅ [Smart Peg Entry] Remaining value ${order_notional:.2f} < min notional ${min_notional:.2f}. Done.")
            break

        # Update registry state
        if cid in ACTIVE_SMART_PEGS:
            ACTIVE_SMART_PEGS[cid]['current_attempt'] = attempts
            ACTIVE_SMART_PEGS[cid]['current_maker_price'] = target_maker_price
            ACTIVE_SMART_PEGS[cid]['amount'] = remaining_amount

        # 4. Place Post-Only Maker Order
        logger.info(
            f"⚡ [Smart Peg Entry] Attempt {attempts}: Sending Post-Only {side.upper()} "
            f"for {remaining_amount} at {target_maker_price} (Book: Bid={best_bid}, Ask={best_ask})"
        )
        ex_params = {'postOnly': True}
        if is_futures:
            if is_hedge_mode:
                if reduce_only:
                    ex_params['positionSide'] = 'SHORT' if side.lower() == 'buy' else 'LONG'
                else:
                    ex_params['positionSide'] = 'LONG' if side.lower() == 'buy' else 'SHORT'
            elif reduce_only:
                ex_params['reduceOnly'] = True

        peg_order = None
        try:
            peg_order = await exchange.create_limit_order(
                symbol, side.lower(), remaining_amount, target_maker_price, ex_params
            )
            # On Binance Futures, a GTX Post-Only order that crosses the spread returns HTTP 200 with status='expired'
            if peg_order and str(peg_order.get('status', '')).lower() in ('expired', 'rejected', 'canceled', 'cancelled'):
                raise Exception(f"Post-Only GTX order returned status={peg_order.get('status')}")
        except Exception as place_err:
            err_str = str(place_err).lower()
            is_postonly = (
                'immediately match' in err_str or '-5022' in err_str or
                'post only' in err_str or 'postonly' in err_str or
                'post-only' in err_str or 'expired' in err_str
            )
            if is_postonly:
                logger.warning(f"⚠️ [Smart Peg Entry] Post-Only touched spread ({place_err}). Retrying 1 tick safer...")
                peg_order = None
                try:
                    f_ob = await exchange.fetch_order_book(symbol, limit=5)
                    if f_ob and f_ob.get('bids') and f_ob.get('asks'):
                        f_bid = float(f_ob['bids'][0][0])
                        f_ask = float(f_ob['asks'][0][0])
                        adj_price = (f_bid - tick) if side.lower() == 'buy' else (f_ask + tick)
                        if hasattr(exchange, 'price_to_precision') and getattr(exchange, 'markets', None) and symbol in exchange.markets:
                            adj_price = float(exchange.price_to_precision(symbol, adj_price))
                        peg_order = await exchange.create_limit_order(symbol, side.lower(), remaining_amount, adj_price, ex_params)
                        if peg_order and str(peg_order.get('status', '')).lower() not in ('expired', 'rejected', 'canceled', 'cancelled') and peg_order.get('id'):
                            target_maker_price = adj_price
                        else:
                            peg_order = None
                except Exception as adj_e:
                    logger.debug(f"Post-only fallback retry failed: {adj_e}")
                    peg_order = None
            else:
                logger.warning(f"⚠️ [Smart Peg Entry] Placement error: {place_err}")

            if not peg_order or not peg_order.get('id'):
                await asyncio.sleep(0.3)
                continue

        order_id = peg_order['id']
        if cid in ACTIVE_SMART_PEGS:
            ACTIVE_SMART_PEGS[cid]['current_order_id'] = order_id

        logger.info(f"✅ [Smart Peg Entry] Order #{order_id} ACTIVE at {target_maker_price} (Queue Priority Active)")

        # 5. Dynamic BBO Peg Watch Loop (250ms polling)
        peg_poll_interval = 0.25
        poll_count = 0
        latest_order_chk = None
        user_cancelled = False
        repeg_triggered = False
        order_processed_filled = 0.0

        # If order already filled immediately, skip watch loop
        if str(peg_order.get('status', '')).lower() in ('closed', 'filled'):
            latest_order_chk = peg_order
        else:
            while True:
                if cancel_event.is_set():
                    user_cancelled = True
                    break

                await asyncio.sleep(peg_poll_interval)
                poll_count += 1

                # In-loop fast fill detection every 2 polls (~0.5s)
                if poll_count % 2 == 0:
                    try:
                        chk_in_loop = await exchange.fetch_order(order_id, symbol)
                        chk_st = str(chk_in_loop.get('status', '')).lower()
                        if chk_st in ['closed', 'filled']:
                            logger.info(f"✅ [Smart Peg Entry] Order #{order_id} filled detected during BBO shadow watch!")
                            latest_order_chk = chk_in_loop
                            break
                        elif chk_st in ['expired', 'canceled', 'cancelled', 'rejected']:
                            latest_order_chk = chk_in_loop
                            repeg_triggered = True
                            break
                        else:
                            curr_loop_filled = float(chk_in_loop.get('filled') or 0.0)
                            if curr_loop_filled > order_processed_filled:
                                chunk_filled = curr_loop_filled - order_processed_filled
                                exec_p = float(chk_in_loop.get('average') or chk_in_loop.get('price') or target_maker_price)
                                chunk_notional = _calc_order_notional_usd(exchange, symbol, chunk_filled, exec_p)
                                if is_futures or chunk_notional >= min_notional or total_filled > 0:
                                    order_processed_filled = curr_loop_filled
                                    total_filled += chunk_filled
                                    accumulated_cost += (chunk_filled * exec_p)
                                    remaining_amount = max(0.0, remaining_amount - chunk_filled)
                                    if cid in ACTIVE_SMART_PEGS:
                                        ACTIVE_SMART_PEGS[cid]['filled_amount'] = total_filled
                                        ACTIVE_SMART_PEGS[cid]['amount'] = remaining_amount
                                    logger.info(
                                        f"⚡ [Smart Peg Entry] Resting Partial Fill detected on #{order_id}: "
                                        f"+{chunk_filled} @ {exec_p} (Total Filled: {total_filled}/{amount})"
                                    )
                                    if (tp_config or sl_config) and not reduce_only:
                                        from app.services.bracket_order_service import BracketOrderService
                                        asyncio.create_task(
                                            BracketOrderService._spawn_bracket_for_amount(
                                                exchange=exchange,
                                                symbol=symbol,
                                                side=side.lower(),
                                                filled_amount=chunk_filled,
                                                average_price=exec_p,
                                                is_futures=is_futures,
                                                tp_config=tp_config,
                                                sl_config=sl_config,
                                                user_id=user_id,
                                                api_key_record=api_key_record,
                                                entry_order_id=cid
                                            )
                                        )
                    except Exception as poll_e:
                        logger.debug(f"Entry order poll check notice: {poll_e}")

                # Fetch live orderbook to verify if we are still top of book
                try:
                    latest_ob = await exchange.fetch_order_book(symbol, limit=5)
                    if latest_ob and latest_ob.get('bids') and latest_ob.get('asks') and len(latest_ob['bids']) > 0 and len(latest_ob['asks']) > 0:
                        l_best_bid = float(latest_ob['bids'][0][0])
                        l_best_ask = float(latest_ob['asks'][0][0])
                        l_tick = _get_market_tick(exchange, symbol, l_best_bid)

                        if side.lower() == "buy":
                            new_maker = l_best_bid
                            if new_maker >= l_best_ask:
                                new_maker = l_best_ask - l_tick
                        else:
                            new_maker = l_best_ask
                            if new_maker <= l_best_bid:
                                new_maker = l_best_bid + l_tick

                        if hasattr(exchange, 'price_to_precision') and getattr(exchange, 'markets', None) and symbol in exchange.markets:
                            try:
                                new_maker = float(exchange.price_to_precision(symbol, new_maker))
                            except Exception:
                                pass

                        # Outbid / Spread shift condition with FIFO Queue Priority protection:
                        # - If someone outbids our maker order (new_maker > target for Buy, new_maker < target for Sell),
                        #   wait at least 3 polls (0.75s) to avoid micro-flicker churn, then step ahead.
                        # - If top-of-book retreats away from our resting order, wait at least 6 polls (1.5s)
                        #   because our resting order is already at the very front of the book about to get filled!
                        if new_maker != target_maker_price:
                            is_outbid = (new_maker > target_maker_price) if side.lower() == "buy" else (new_maker < target_maker_price)
                            min_polls_required = 3 if is_outbid else 6
                            if poll_count >= min_polls_required:
                                logger.info(
                                    f"⚡ [Smart Peg Entry] BBO shifted ({'outbid' if is_outbid else 'retreat'}): {target_maker_price} ➜ {new_maker} "
                                    f"(Bid={l_best_bid}, Ask={l_best_ask}). Re-pegging!"
                                )
                                repeg_triggered = True
                                cached_ob = latest_ob  # Pre-cache for 0ms re-peg!
                                break
                except Exception as ob_p_err:
                    logger.debug(f"Entry BBO poll non-fatal error: {ob_p_err}")

        # Handle user cancellation
        if user_cancelled:
            logger.info(f"🛑 [Smart Peg Entry] Cancelled by user during attempt {attempts}!")
            cancel_res = None
            try:
                cancel_res = await exchange.cancel_order(order_id, symbol)
                logger.info(f"🛑 Cancelled active entry order #{order_id} on exchange.")
            except Exception as ce:
                logger.debug(f"Cancel order notice: {ce}")

            # Check if there was any partial fill before cancellation took effect
            try:
                raw_p_filled = float((cancel_res or {}).get('filled') or 0.0) if isinstance(cancel_res, dict) else 0.0
                if raw_p_filled <= 0:
                    cancel_chk = await exchange.fetch_order(order_id, symbol)
                    raw_p_filled = float(cancel_chk.get('filled') or 0.0)
                p_filled = max(0.0, raw_p_filled - order_processed_filled)
                if p_filled > 0:
                    order_processed_filled = raw_p_filled
                    total_filled += p_filled
                    exec_p = float((cancel_res or {}).get('average') or (cancel_res or {}).get('price') or target_maker_price)
                    logger.info(f"🔄 [Smart Peg Entry] Captured partial fill upon cancel: {p_filled} at {exec_p}")

                    # Spawn bracket for this filled chunk if configured (and not a reduceOnly exit)
                    if (tp_config or sl_config) and not reduce_only:
                        from app.services.bracket_order_service import BracketOrderService
                        asyncio.create_task(
                            BracketOrderService._spawn_bracket_for_amount(
                                exchange=exchange,
                                symbol=symbol,
                                side=side.lower(),
                                filled_amount=p_filled,
                                average_price=exec_p,
                                is_futures=is_futures,
                                tp_config=tp_config,
                                sl_config=sl_config,
                                user_id=user_id,
                                api_key_record=api_key_record,
                                entry_order_id=cid
                            )
                        )
            except Exception as p_err:
                logger.debug(f"User cancel partial fill check: {p_err}")

            final_res = {'status': 'cancelled', 'id': 'user_stopped', 'filled': total_filled}
            msg = (
                f"🛑 *Smart Peg Entry Stopped Manually!*\n"
                f"Exchange: {exchange_name}\n"
                f"Pair: `{symbol}`\n"
                f"Action: Entry peg stopped by user. Limit order #{order_id} cancelled."
                + (f"\nFilled before cancel: `{total_filled}/{amount}`" if total_filled > 0 else "")
            )
            await _send_notify(msg)
            break

        # Check order fill status
        try:
            chk = latest_order_chk if (latest_order_chk and latest_order_chk.get('status', '').lower() in ['closed', 'filled']) else await exchange.fetch_order(order_id, symbol)
            status = chk.get('status', '').lower()

            if status in ['closed', 'filled']:
                raw_filled_amt = float(chk.get('filled') or (remaining_amount + order_processed_filled))
                filled_amt = max(0.0, raw_filled_amt - order_processed_filled)
                exec_price = float(chk.get('average') or chk.get('price') or target_maker_price)
                if filled_amt > 0:
                    order_processed_filled = raw_filled_amt
                    total_filled += filled_amt
                    accumulated_cost += (filled_amt * exec_price)
                    remaining_amount = max(0.0, remaining_amount - filled_amt)
                final_res = chk

                logger.info(
                    f"🎯 [Smart Peg Entry] 100% FILLED! Amount: {raw_filled_amt} at {exec_price} "
                    f"(Total Filled: {total_filled}/{amount}) as Maker ⚡"
                )

                # Link Attached TP & Attached SL (or Smart Chase SL) for the newly filled delta
                if filled_amt > 0 and (tp_config or sl_config) and not reduce_only:
                    from app.services.bracket_order_service import BracketOrderService
                    logger.info(f"🚀 [Smart Peg Entry] Spawning Attached TP/SL Brackets for filled entry position...")
                    asyncio.create_task(
                        BracketOrderService._spawn_bracket_for_amount(
                            exchange=exchange,
                            symbol=symbol,
                            side=side.lower(),
                            filled_amount=filled_amt,
                            average_price=exec_price,
                            is_futures=is_futures,
                            tp_config=tp_config,
                            sl_config=sl_config,
                            user_id=user_id,
                            api_key_record=api_key_record,
                            entry_order_id=cid
                        )
                    )

                msg = (
                    f"🎯 *Smart Peg Entry Filled!*\n"
                    f"Exchange: {exchange_name}\n"
                    f"Pair: `{symbol}`\n"
                    f"Side: {side.upper()} (Maker Entry ⚡)\n"
                    f"Filled Amount: `{total_filled}`\n"
                    f"Price: `{exec_price}`\n"
                    f"Attempts: {attempts}"
                )
                await _send_notify(msg)
                break
            else:
                # Cancel order to chase closer / re-peg
                cancel_res = None
                try:
                    cancel_res = await exchange.cancel_order(order_id, symbol)
                except Exception as c_err:
                    logger.debug(f"Cancel entry order notice: {c_err}")
                await asyncio.sleep(0.05)

                # Check partial fill
                try:
                    raw_p_filled = float(cancel_res.get('filled') or 0.0) if isinstance(cancel_res, dict) and cancel_res.get('filled') is not None else 0.0
                    if raw_p_filled <= 0:
                        cancel_chk = await exchange.fetch_order(order_id, symbol)
                        raw_p_filled = float(cancel_chk.get('filled') or 0.0)
                    p_filled = max(0.0, raw_p_filled - order_processed_filled)
                    if p_filled > 0:
                        logger.info(f"🔄 [Smart Peg Entry] Partial fill on re-peg cancel: {p_filled}")
                        order_processed_filled = raw_p_filled
                        total_filled += p_filled
                        exec_p = float((cancel_res or {}).get('average') or (cancel_res or {}).get('price') or target_maker_price)
                        accumulated_cost += (p_filled * exec_p)
                        remaining_amount = max(0.0, remaining_amount - p_filled)

                        # Spawn bracket for this partial chunk if configured
                        if (tp_config or sl_config) and not reduce_only:
                            from app.services.bracket_order_service import BracketOrderService
                            asyncio.create_task(
                                BracketOrderService._spawn_bracket_for_amount(
                                    exchange=exchange,
                                    symbol=symbol,
                                    side=side.lower(),
                                    filled_amount=p_filled,
                                    average_price=exec_p,
                                    is_futures=is_futures,
                                    tp_config=tp_config,
                                    sl_config=sl_config,
                                    user_id=user_id,
                                    api_key_record=api_key_record,
                                    entry_order_id=cid
                                )
                            )

                        if cid in ACTIVE_SMART_PEGS:
                            ACTIVE_SMART_PEGS[cid]['filled_amount'] = total_filled
                            ACTIVE_SMART_PEGS[cid]['amount'] = remaining_amount

                        rem_val = _calc_order_notional_usd(exchange, symbol, remaining_amount, target_maker_price)
                        if remaining_amount <= 0 or rem_val < min_notional:
                            logger.info(f"✅ [Smart Peg Entry] Position complete (remaining ${rem_val:.2f} < ${min_notional:.2f}).")
                            final_res = cancel_res or {'status': 'closed', 'id': order_id, 'filled': total_filled}
                            break
                except Exception as p_err:
                    logger.debug(f"Partial check failed: {p_err}")

        except Exception as stat_err:
            logger.error(f"Error checking entry order status: {stat_err}")
            await asyncio.sleep(0.25)
        finally:
            if cid in ACTIVE_SMART_PEGS:
                ACTIVE_SMART_PEGS[cid]['current_order_id'] = None

    ACTIVE_SMART_PEGS.pop(cid, None)
    return final_res
