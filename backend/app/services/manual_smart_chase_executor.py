"""
Manual Smart Chase Executor
===========================
Executes Smart Chase Limit stop-loss for manual trade bracket orders.
Uses post-only maker orders to exit positions with maker fee savings.
Monitors price deviation against a Circuit Breaker boundary, falling back
to an emergency Market sweep if the market drops too fast or max retries are reached.
"""

import asyncio
import logging
from typing import Optional, Dict, Any
from app.services.notification import NotificationService
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)


def _get_market_tick(exchange, symbol: str, ref_price: float) -> float:
    """Derives minimum price tick size from exchange market metadata or fallback."""
    tick = None
    try:
        mkt = exchange.markets.get(symbol, {}) if hasattr(exchange, 'markets') else {}
        prec = mkt.get('precision', {}).get('price')
        if prec is not None and float(prec) > 0:
            p_val = float(prec)
            if p_val >= 1.0 and p_val == int(p_val):
                tick = 10 ** (-int(p_val))
            else:
                tick = p_val
    except Exception:
        tick = None
    if not tick or tick <= 0:
        tick = round(ref_price * 1e-4, 8) if ref_price else 0.0001
    return tick


def _get_min_notional(exchange, symbol: str) -> float:
    """Extracts minimum notional cost from exchange market limits or returns safe default."""
    try:
        mkt = exchange.markets.get(symbol, {}) if hasattr(exchange, 'markets') else {}
        cost_min = mkt.get('limits', {}).get('cost', {}).get('min')
        if cost_min and float(cost_min) > 0:
            return float(cost_min)
        info_filters = mkt.get('info', {}).get('filters', [])
        for f in info_filters:
            if f.get('filterType') in ['NOTIONAL', 'MIN_NOTIONAL']:
                min_n = f.get('minNotional') or f.get('notional')
                if min_n and float(min_n) > 0:
                    return float(min_n)
    except Exception:
        pass
    return 5.0  # Binance Spot standard min notional is $5.00


from datetime import datetime

# Global registry of active Smart Chase executions: { chase_id: { ... } }
ACTIVE_SMART_CHASES: Dict[str, Dict[str, Any]] = {}


async def stop_smart_chase(
    symbol: str,
    api_key_id: Optional[int] = None,
    user_id: Optional[int] = None,
    chase_id: Optional[str] = None
) -> int:
    """
    Signals any matching active smart chase execution(s) to abort immediately
    and cancel their resting maker order on the exchange.
    Returns the number of stopped chase tasks.
    """
    stopped_count = 0
    for cid, cdata in list(ACTIVE_SMART_CHASES.items()):
        if chase_id:
            if cid != chase_id:
                continue
        else:
            c_sym = str(cdata.get('symbol', '')).split(':')[0].upper()
            target_sym = str(symbol or '').split(':')[0].upper()
            if target_sym and c_sym != target_sym:
                continue

        if api_key_id is not None and cdata.get('api_key_id') is not None and int(cdata.get('api_key_id')) != int(api_key_id):
            continue
        if user_id is not None and cdata.get('user_id') is not None and int(cdata.get('user_id')) != int(user_id):
            continue

        logger.info(f"🛑 [Manual Smart Chase] Aborting active chase {cid} for {symbol}...")
        cancel_evt = cdata.get('cancel_event')
        if cancel_evt and not cancel_evt.is_set():
            cancel_evt.set()

        # Proactively cancel resting maker limit order on exchange if present
        curr_order_id = cdata.get('current_order_id')
        ex = cdata.get('exchange')
        if curr_order_id and ex:
            try:
                await ex.cancel_order(curr_order_id, symbol)
                logger.info(f"🛑 Proactively cancelled resting limit order {curr_order_id} on exchange.")
            except Exception as ce:
                logger.debug(f"Order cancel notice on stop: {ce}")

        stopped_count += 1

    return stopped_count


async def execute_manual_smart_chase(
    exchange,
    symbol: str,
    exit_side: str,              # 'sell' to close long, 'buy' to close short
    sell_amount_raw: float,
    entry_price: float,
    original_sl: float,
    max_deviation_pct: float = 1.0,
    chase_delay_ms: int = 1500,
    max_attempts: int = 15,
    is_futures: bool = False,
    user_id: int = 0,
    api_key_record = None,
    tp_order_id: Optional[str] = None,
    disaster_sl_order_id: Optional[str] = None,
    chase_id: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Executes Smart Chase Limit exit for manual trade positions.
    1. Immediately cancels TP and Disaster SL to unlock held balances.
    2. Syncs and clamps amount against live wallet balance (prevents -2010 insufficient balance).
    3. Checks exchange Min Notional filter (prevents -1013 NOTIONAL dust rejection).
    4. Checks Circuit Breaker: original_sl +/- max_deviation_pct.
    5. Fetches L2 orderbook and targets best maker price (Best Ask for Sell, Best Bid for Buy).
    6. Uses Maker-Price Guard to guarantee orders rest in book and avoid post-only rejections.
    7. Places Post-Only Maker limit order.
    8. Waits for chase_delay_ms.
    9. If filled: Notifies user, finishes.
    10. If unfilled: Cancels order, accounts for partial fill, recalculates and chases.
    11. If Circuit Breaker breached or max_attempts exceeded: Forces Market Sweep with balance clamping and notional guard.
    """
    chase_delay_sec = max(0.2, chase_delay_ms / 1000.0)
    exchange_name = getattr(api_key_record, 'exchange', 'exchange').capitalize() if api_key_record else 'Exchange'
    min_notional = _get_min_notional(exchange, symbol)

    logger.info(
        f"🛡️ [Manual Smart Chase] Starting for {symbol} ({exit_side.upper()}) | "
        f"Amount: {sell_amount_raw} | SL Trigger: {original_sl} | Max Dev: {max_deviation_pct}% | Delay: {chase_delay_ms}ms | MinNotional: ${min_notional:.2f}"
    )

    # Detect Binance Hedge Mode on Futures to avoid -4061 rejection
    is_hedge_mode = False
    if is_futures and exchange_name.lower().startswith('binance'):
        for method_name in [
            'fapiPrivateGetPositionSideDual',
            'fapiprivateGetPositionsideDual',
            'fapiprivate_get_positionside_dual',
            'dapiPrivateGetPositionSideDual',
            'dapiprivateGetPositionsideDual',
            'dapiprivate_get_positionside_dual'
        ]:
            method = getattr(exchange, method_name, None)
            if method and callable(method):
                try:
                    res = await method()
                    is_hedge_mode = bool(res.get('dualSidePosition', False))
                    logger.info(f"🛡️ [Manual Smart Chase] Binance Futures mode: {'Hedge' if is_hedge_mode else 'One-Way'}")
                    break
                except Exception:
                    pass

    # Cancel TP and Disaster SL helper (concurrent execution)
    async def _cleanup_other_orders():
        nonlocal tp_order_id, disaster_sl_order_id
        cancel_tasks = []
        labels = []
        if tp_order_id:
            cancel_tasks.append(exchange.cancel_order(tp_order_id, symbol))
            labels.append(('TP', tp_order_id))
        if disaster_sl_order_id:
            cancel_tasks.append(exchange.cancel_order(disaster_sl_order_id, symbol))
            labels.append(('Disaster SL', disaster_sl_order_id))

        if cancel_tasks:
            results = await asyncio.gather(*cancel_tasks, return_exceptions=True)
            for (lbl, oid), res in zip(labels, results):
                if isinstance(res, Exception):
                    logger.debug(f"Failed to cancel {lbl} order {oid}: {res}")
                else:
                    logger.info(f"🛡️ [Manual Smart Chase] Cancelled {lbl} order {oid} to release locked balance")
        tp_order_id = None
        disaster_sl_order_id = None

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

    # ── STEP 1: IMMEDIATELY CANCEL TP & DISASTER SL CONCURRENTLY ──
    await _cleanup_other_orders()

    # Format initial amount
    remaining_amount = sell_amount_raw
    if hasattr(exchange, 'amount_to_precision'):
        try:
            remaining_amount = float(exchange.amount_to_precision(symbol, remaining_amount))
        except Exception:
            pass

    # Balance sync helper to avoid "insufficient balance" rejections
    async def _sync_and_clamp_amount(price: float, cached_bal: Optional[dict] = None) -> float:
        nonlocal remaining_amount
        if is_futures:
            return remaining_amount

        try:
            parts = symbol.split('/')
            if len(parts) >= 2:
                base_asset = parts[0]
                quote_asset = parts[1].split(':')[0]

                bal = cached_bal if cached_bal is not None else await exchange.fetch_balance()
                if exit_side == "sell":
                    # Exiting Long: We are selling base_asset (e.g. DOGE)
                    free_base = float(bal.get(base_asset, {}).get('free', 0.0))
                    if free_base <= 0:
                        logger.warning(f"⚠️ [Manual Smart Chase] No free {base_asset} available to sell!")
                        return 0.0
                    if free_base < remaining_amount:
                        adjusted = float(exchange.amount_to_precision(symbol, free_base))
                        if adjusted != remaining_amount:
                            logger.info(
                                f"🔄 [Manual Smart Chase] Clamped sell amount from {remaining_amount} to available {base_asset} balance: {adjusted}"
                            )
                            remaining_amount = adjusted
                else:
                    # Exiting Short: We are buying base_asset using quote_asset (e.g. FDUSD)
                    free_quote = float(bal.get(quote_asset, {}).get('free', 0.0))
                    if free_quote <= 0:
                        logger.warning(f"⚠️ [Manual Smart Chase] No free {quote_asset} available to buy {base_asset}!")
                        return 0.0

                    # Reserve 0.2% for maker fee buffer so Binance never rejects for insufficient quote balance
                    usable_quote = free_quote * 0.998
                    max_affordable_base = usable_quote / price if price > 0 else 0.0

                    if max_affordable_base < remaining_amount:
                        adjusted = float(exchange.amount_to_precision(symbol, max_affordable_base))
                        if adjusted != remaining_amount:
                            logger.info(
                                f"🔄 [Manual Smart Chase] Clamped buy amount from {remaining_amount} to affordable {base_asset} ({usable_quote:.4f} {quote_asset} free): {adjusted}"
                            )
                            remaining_amount = adjusted
        except Exception as sync_e:
            logger.warning(f"⚠️ [Manual Smart Chase] Balance sync warning (non-fatal): {sync_e}")

        return remaining_amount

    # ── STEP 2: CONCURRENT BALANCE SYNC & L2 ORDERBOOK FETCH ──
    # Concurrently fetching balance and initial L2 book saves ~250-350ms of network latency!
    cached_initial_ob = None
    initial_bal = None
    if not is_futures:
        await asyncio.sleep(0.1)  # Minimal 100ms buffer for Binance ledger release
        bal_res, ob_res = await asyncio.gather(
            exchange.fetch_balance(),
            exchange.fetch_order_book(symbol, limit=5),
            return_exceptions=True
        )
        if not isinstance(ob_res, Exception) and isinstance(ob_res, dict):
            cached_initial_ob = ob_res
        if not isinstance(bal_res, Exception) and isinstance(bal_res, dict):
            initial_bal = bal_res
    else:
        try:
            cached_initial_ob = await exchange.fetch_order_book(symbol, limit=5)
        except Exception:
            cached_initial_ob = None

    # Initial clamp (instant, using pre-fetched balance)
    remaining_amount = await _sync_and_clamp_amount(original_sl, cached_bal=initial_bal)
    initial_notional = remaining_amount * original_sl
    if remaining_amount <= 0 or initial_notional < min_notional:
        logger.info(
            f"✅ [Manual Smart Chase] Aborted: initial amount {remaining_amount} (~${initial_notional:.2f}) is dust or below Min Notional ${min_notional:.2f}."
        )
        return {'status': 'closed', 'id': 'dust_prevented', 'filled': sell_amount_raw}

    # Circuit Breaker Price Boundary
    max_chase_price = (
        original_sl * (1 - (max_deviation_pct / 100.0))
        if exit_side == "sell"
        else original_sl * (1 + (max_deviation_pct / 100.0))
    )

    cid = chase_id or f"chase_{getattr(api_key_record, 'id', user_id)}_{symbol}_{int(datetime.utcnow().timestamp())}"
    cancel_event = asyncio.Event()

    ACTIVE_SMART_CHASES[cid] = {
        'chase_id': cid,
        'symbol': symbol,
        'api_key_id': getattr(api_key_record, 'id', None),
        'user_id': user_id,
        'exchange': exchange,
        'side': exit_side,
        'original_sl': original_sl,
        'amount': remaining_amount,
        'status': 'chasing',
        'current_attempt': 0,
        'max_attempts': max_attempts,
        'current_maker_price': original_sl,
        'current_order_id': None,
        'cancel_event': cancel_event,
        'started_at': datetime.utcnow().isoformat()
    }

    chase_active = True
    attempts = 0
    final_res = None

    while chase_active:
        if cancel_event.is_set():
            logger.info(f"🛑 [Manual Smart Chase] Cancel signal detected before attempt {attempts + 1}. Aborting.")
            final_res = {'status': 'cancelled', 'id': 'user_stopped'}
            break

        if max_attempts > 0 and attempts >= max_attempts:
            break

        attempts += 1

        # 1. Fetch live orderbook (reuse pre-fetched cached_initial_ob on Attempt 1 for zero-wait execution!)
        current_price = original_sl
        ob = None
        if attempts == 1 and cached_initial_ob is not None:
            ob = cached_initial_ob
            cached_initial_ob = None
        else:
            try:
                ob = await exchange.fetch_order_book(symbol, limit=5)
            except Exception as ob_e:
                logger.warning(f"⚠️ [Manual Smart Chase] Could not fetch orderbook, falling back to ticker: {ob_e}")

        if ob and ob.get('bids') and ob.get('asks') and len(ob['bids']) > 0 and len(ob['asks']) > 0:
            best_bid = float(ob['bids'][0][0])
            best_ask = float(ob['asks'][0][0])
            current_price = best_bid if exit_side == "sell" else best_ask
        else:
            try:
                ticker = await exchange.fetch_ticker(symbol)
                current_price = float(ticker.get('last') or original_sl)
                best_bid = float(ticker.get('bid') or current_price)
                best_ask = float(ticker.get('ask') or current_price)
            except Exception:
                best_bid = original_sl
                best_ask = original_sl

        tick = _get_market_tick(exchange, symbol, current_price)

        # 2. Maker Price Guard:
        # To guarantee Post-Only order rests in book without immediately matching:
        # SELL order must be strictly ABOVE best_bid (at best_ask, or best_bid + 1 tick)
        # BUY order must be strictly BELOW best_ask (at best_bid, or best_ask - 1 tick)
        if exit_side == "sell":
            target_maker_price = best_ask
            if target_maker_price <= best_bid:
                target_maker_price = best_bid + tick
        else:
            target_maker_price = best_bid
            if target_maker_price >= best_ask:
                target_maker_price = best_ask - tick

        if hasattr(exchange, 'price_to_precision'):
            try:
                target_maker_price = float(exchange.price_to_precision(symbol, target_maker_price))
            except Exception:
                pass

        # Ensure precision formatting didn't round back onto the spread
        if exit_side == "sell" and target_maker_price <= best_bid:
            target_maker_price = float(exchange.price_to_precision(symbol, best_bid + tick)) if hasattr(exchange, 'price_to_precision') else (best_bid + tick)
        elif exit_side == "buy" and target_maker_price >= best_ask:
            target_maker_price = float(exchange.price_to_precision(symbol, best_ask - tick)) if hasattr(exchange, 'price_to_precision') else (best_ask - tick)

        # Synchronize and clamp amount with live wallet balance before placing
        remaining_amount = await _sync_and_clamp_amount(target_maker_price)
        order_notional = remaining_amount * target_maker_price
        if remaining_amount <= 0 or order_notional < min_notional:
            logger.info(
                f"✅ [Manual Smart Chase] Remaining order value ${order_notional:.2f} < Min Notional ${min_notional:.2f}. "
                f"Position is effectively closed (dust prevented)."
            )
            final_res = final_res or {'status': 'closed', 'id': 'dust_closed', 'filled': remaining_amount}
            break

        # Update live registry state for frontend tracking
        if cid in ACTIVE_SMART_CHASES:
            ACTIVE_SMART_CHASES[cid]['current_attempt'] = attempts
            ACTIVE_SMART_CHASES[cid]['current_maker_price'] = target_maker_price
            ACTIVE_SMART_CHASES[cid]['amount'] = remaining_amount

        # 3. Check Circuit Breaker
        circuit_breaker_hit = False
        if exit_side == "sell" and target_maker_price < max_chase_price:
            circuit_breaker_hit = True
        elif exit_side == "buy" and target_maker_price > max_chase_price:
            circuit_breaker_hit = True

        if circuit_breaker_hit:
            logger.warning(
                f"🚨 [Manual Smart Chase] Circuit Breaker hit! Target {target_maker_price} breached limit {max_chase_price}. Sweeping Market!"
            )
            params = {'reduceOnly': True} if is_futures else {}
            if is_futures and is_hedge_mode:
                params['positionSide'] = 'LONG' if exit_side == 'sell' else 'SHORT'

            sweep_amt = remaining_amount
            if not is_futures:
                try:
                    bal = await exchange.fetch_balance()
                    parts = symbol.split('/')
                    base_asset = parts[0]
                    quote_asset = parts[1].split(':')[0]
                    if exit_side == 'sell':
                        free_b = float(bal.get(base_asset, {}).get('free', 0.0))
                        sweep_amt = float(exchange.amount_to_precision(symbol, free_b))
                    else:
                        free_q = float(bal.get(quote_asset, {}).get('free', 0.0))
                        usable_q = free_q * 0.985
                        sweep_amt = float(exchange.amount_to_precision(symbol, usable_q / target_maker_price))
                except Exception as b_err:
                    logger.debug(f"Sweep balance check non-fatal error: {b_err}")

            sweep_notional = sweep_amt * target_maker_price
            if sweep_amt > 0 and sweep_notional >= min_notional:
                try:
                    final_res = await exchange.create_market_order(symbol, exit_side, sweep_amt, params=params)
                    msg = (
                        f"🚨 *Smart Chase Circuit Breaker Triggered!*\n"
                        f"Exchange: {exchange_name}\n"
                        f"Pair: `{symbol}`\n"
                        f"Action: Emergency Market Sweep ({exit_side.upper()})\n"
                        f"Amount: `{sweep_amt}`\n"
                        f"Breached Price: `{target_maker_price}`\n"
                        f"Original SL: `{original_sl}` (Max Dev: {max_deviation_pct}%)"
                    )
                    await _send_notify(msg)
                except Exception as sweep_e:
                    logger.error(f"❌ Market Sweep failed: {sweep_e}")
            elif sweep_amt > 0:
                logger.info(
                    f"ℹ️ [Manual Smart Chase] Circuit Breaker sweep value ${sweep_notional:.2f} < Min Notional ${min_notional:.2f}. "
                    f"Skipping market order (dust prevented)."
                )
                final_res = {'status': 'closed', 'id': 'dust_sweep_skipped', 'filled': sweep_amt}
            break

        # 4. Prepare params & Place Post-Only Maker Order
        logger.info(
            f"⚡ [Manual Smart Chase] Attempt {attempts}/{max_attempts}: Sending Post-Only {exit_side.upper()} "
            f"for {remaining_amount} at {target_maker_price} (Orderbook: Bid={best_bid}, Ask={best_ask})"
        )
        ex_params = {'postOnly': True}
        if is_futures:
            ex_params['reduceOnly'] = True
            if is_hedge_mode:
                ex_params['positionSide'] = 'LONG' if exit_side == 'sell' else 'SHORT'

        chase_res = None
        try:
            chase_res = await exchange.create_limit_order(
                symbol, exit_side, remaining_amount, target_maker_price, ex_params
            )
        except Exception as place_e:
            err_str = str(place_e)
            is_postonly_rejection = (
                'immediately match' in err_str.lower()
                or '-5022' in err_str
                or '-2010' in err_str
                or 'post only' in err_str.lower()
                or 'postonly' in err_str.lower()
            )

            if is_postonly_rejection:
                logger.warning(
                    f"⚠️ [Manual Smart Chase] Post-Only rejected by exchange (spread crossed: {err_str}). "
                    f"Re-fetching book and retrying with safe maker buffer..."
                )
                try:
                    # Nudge 1 tick further away to ensure it rests as maker
                    fresh_ob = await exchange.fetch_order_book(symbol, limit=5)
                    f_bid = float(fresh_ob['bids'][0][0]) if fresh_ob.get('bids') else best_bid
                    f_ask = float(fresh_ob['asks'][0][0]) if fresh_ob.get('asks') else best_ask

                    if exit_side == "sell":
                        adj_price = f_ask + tick
                    else:
                        adj_price = f_bid - tick

                    if hasattr(exchange, 'price_to_precision'):
                        adj_price = float(exchange.price_to_precision(symbol, adj_price))

                    # Re-sync amount for adjusted price
                    remaining_amount = await _sync_and_clamp_amount(adj_price)
                    adj_notional = remaining_amount * adj_price

                    if adj_notional >= min_notional and ((exit_side == "sell" and adj_price >= max_chase_price) or (exit_side == "buy" and adj_price <= max_chase_price)):
                        logger.info(f"🔄 Retrying with adjusted maker price {adj_price}...")
                        chase_res = await exchange.create_limit_order(
                            symbol, exit_side, remaining_amount, adj_price, ex_params
                        )
                        if chase_res and chase_res.get('id'):
                            target_maker_price = adj_price
                except Exception as retry_e:
                    logger.warning(f"⚠️ Adjusted Maker retry failed: {retry_e}")
            else:
                logger.warning(f"⚠️ [Manual Smart Chase] Order placement error on attempt {attempts}: {err_str}")

            if not chase_res or not chase_res.get('id'):
                # Check if position was closed externally
                if attempts == 1 and is_futures:
                    try:
                        positions = await exchange.fetch_positions([symbol])
                        pos = None
                        for p in positions:
                            if p.get('symbol') == symbol:
                                pos = p
                                break
                        if not pos or float(pos.get('contracts', 0) or pos.get('info', {}).get('positionAmt', 0)) == 0:
                            logger.info("✅ Position already closed natively. Aborting Smart Chase.")
                            break
                    except Exception:
                        pass
                await asyncio.sleep(chase_delay_sec)
                continue

        if chase_res and chase_res.get('id'):
            order_id = chase_res['id']
            if cid in ACTIVE_SMART_CHASES:
                ACTIVE_SMART_CHASES[cid]['current_order_id'] = order_id
            logger.info(f"✅ [Manual Smart Chase] Order #{order_id} ACTIVE on exchange book at {target_maker_price}")

            # Wait for fill with immediate cancel event wake-up
            try:
                await asyncio.wait_for(cancel_event.wait(), timeout=chase_delay_sec)
                # If we get here, user cancelled during the attempt!
                logger.info(f"🛑 [Manual Smart Chase] User cancelled Smart Chase during attempt {attempts}!")
                try:
                    await exchange.cancel_order(order_id, symbol)
                    logger.info(f"🛑 Cancelled active maker limit order #{order_id} on exchange.")
                except Exception as ce:
                    logger.debug(f"Cancel order on stop: {ce}")
                final_res = {'status': 'cancelled', 'id': 'user_stopped'}
                msg = (
                    f"🛑 *Smart Chase Stopped Manually!*\n"
                    f"Exchange: {exchange_name}\n"
                    f"Pair: `{symbol}`\n"
                    f"Action: Stopped by user. Limit order #{order_id} cancelled."
                )
                await _send_notify(msg)
                break
            except asyncio.TimeoutError:
                pass

            try:
                chk = await exchange.fetch_order(order_id, symbol)
                status = chk.get('status', '').lower()

                if status in ['closed', 'filled']:
                    logger.info("✅ [Manual Smart Chase] Maker Limit Order filled successfully!")
                    final_res = chk
                    msg = (
                        f"🎯 *Smart Chase Limit SL Filled!*\n"
                        f"Exchange: {exchange_name}\n"
                        f"Pair: `{symbol}`\n"
                        f"Side: {exit_side.upper()}\n"
                        f"Amount: `{remaining_amount}`\n"
                        f"Executed Price: `{target_maker_price}` (Maker Fee Saved ⚡)\n"
                        f"Attempts: {attempts}"
                    )
                    await _send_notify(msg)
                    break
                else:
                    # Cancel order to chase closer
                    try:
                        await exchange.cancel_order(order_id, symbol)
                    except Exception as cancel_e:
                        logger.debug(f"Cancel chase order error: {cancel_e}")
                    await asyncio.sleep(0.2)

                    # Check partial fill
                    try:
                        cancel_chk = await exchange.fetch_order(order_id, symbol)
                        filled = float(cancel_chk.get('filled') or 0.0)
                        if filled > 0:
                            logger.info(f"🔄 Partial fill detected: {filled}")
                            remaining_amount = max(0.0, remaining_amount - filled)
                            if hasattr(exchange, 'amount_to_precision'):
                                try:
                                    remaining_amount = float(exchange.amount_to_precision(symbol, remaining_amount))
                                except Exception:
                                    pass
                            rem_val = remaining_amount * target_maker_price
                            if remaining_amount <= 0 or rem_val < min_notional:
                                logger.info(
                                    f"✅ [Manual Smart Chase] Fully closed or remaining value ${rem_val:.2f} < Min Notional ${min_notional:.2f}. Dust prevented."
                                )
                                final_res = cancel_chk
                                break
                    except Exception as chk_e:
                        logger.debug(f"Partial check failed: {chk_e}")

            except Exception as chk_err:
                logger.error(f"Error checking order status: {chk_err}")
                await asyncio.sleep(chase_delay_sec)
            finally:
                if cid in ACTIVE_SMART_CHASES:
                    ACTIVE_SMART_CHASES[cid]['current_order_id'] = None

    # Check if cancelled by user
    if final_res and final_res.get('status') == 'cancelled':
        logger.info(f"🛑 [Manual Smart Chase] Cancelled by user. Skipping final fallback market sweep.")
        ACTIVE_SMART_CHASES.pop(cid, None)
        return final_res

    # 5. Fallback if max attempts reached without full fill
    if final_res is None and remaining_amount > 0:
        logger.warning(
            f"⚠️ [Manual Smart Chase] Max attempts ({max_attempts}) reached without full fill. Forcing Market Sweep!"
        )
        params = {'reduceOnly': True} if is_futures else {}
        if is_futures and is_hedge_mode:
            params['positionSide'] = 'LONG' if exit_side == 'sell' else 'SHORT'

        sweep_amt = remaining_amount
        mkt_price = original_sl
        if not is_futures:
            try:
                bal = await exchange.fetch_balance()
                parts = symbol.split('/')
                base_asset = parts[0]
                quote_asset = parts[1].split(':')[0]
                try:
                    t = await exchange.fetch_ticker(symbol)
                    mkt_price = float(t.get('ask') or t.get('last') or original_sl)
                except Exception:
                    mkt_price = original_sl

                if exit_side == 'sell':
                    free_b = float(bal.get(base_asset, {}).get('free', 0.0))
                    sweep_amt = float(exchange.amount_to_precision(symbol, free_b))
                else:
                    free_q = float(bal.get(quote_asset, {}).get('free', 0.0))
                    usable_q = free_q * 0.985
                    sweep_amt = float(exchange.amount_to_precision(symbol, usable_q / mkt_price))
            except Exception as b_err:
                logger.debug(f"Sweep balance check non-fatal error: {b_err}")

        sweep_notional = sweep_amt * mkt_price
        if sweep_amt > 0 and sweep_notional >= min_notional:
            try:
                final_res = await exchange.create_market_order(symbol, exit_side, sweep_amt, params=params)
                msg = (
                    f"⚠️ *Smart Chase Reached Max Attempts!*\n"
                    f"Exchange: {exchange_name}\n"
                    f"Pair: `{symbol}`\n"
                    f"Action: Final Market Sweep ({exit_side.upper()})\n"
                    f"Amount: `{sweep_amt}`\n"
                    f"Attempts: {attempts}/{max_attempts}"
                )
                await _send_notify(msg)
            except Exception as sweep_err:
                logger.error(f"❌ Final fallback market sweep failed: {sweep_err}")
        elif sweep_amt > 0:
            logger.info(
                f"ℹ️ [Manual Smart Chase] Final fallback sweep value ${sweep_notional:.2f} < Min Notional ${min_notional:.2f}. "
                f"Dust prevented, skipping market sweep."
            )
            final_res = {'status': 'closed', 'id': 'dust_sweep_skipped', 'filled': remaining_amount}

    ACTIVE_SMART_CHASES.pop(cid, None)
    return final_res
