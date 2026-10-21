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
    disaster_sl_order_id: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Executes Smart Chase Limit exit for manual trade positions.
    1. Checks Circuit Breaker: original_sl +/- max_deviation_pct.
    2. Fetches L2 orderbook and targets best maker price (Best Ask for Sell, Best Bid for Buy).
    3. Uses Maker-Price Guard to guarantee orders rest in book and avoid post-only rejections.
    4. Places Post-Only Maker limit order.
    5. Waits for chase_delay_ms.
    6. If filled: Cancels TP / Disaster SL, notifies user, finishes.
    7. If unfilled: Cancels order, accounts for partial fill, recalculates and chases.
    8. If Circuit Breaker breached or max_attempts exceeded: Forces Market Sweep.
    """
    chase_delay_sec = max(0.2, chase_delay_ms / 1000.0)
    exchange_name = getattr(api_key_record, 'exchange', 'exchange').capitalize() if api_key_record else 'Exchange'

    logger.info(
        f"🛡️ [Manual Smart Chase] Starting for {symbol} ({exit_side.upper()}) | "
        f"Amount: {sell_amount_raw} | SL Trigger: {original_sl} | Max Dev: {max_deviation_pct}% | Delay: {chase_delay_ms}ms"
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

    # Cancel TP and Disaster SL helper
    async def _cleanup_other_orders():
        if tp_order_id:
            try:
                await exchange.cancel_order(tp_order_id, symbol)
                logger.info(f"🛡️ [Manual Smart Chase] Cancelled TP order {tp_order_id}")
            except Exception as e:
                logger.debug(f"Failed to cancel TP order: {e}")
        if disaster_sl_order_id:
            try:
                await exchange.cancel_order(disaster_sl_order_id, symbol)
                logger.info(f"🛡️ [Manual Smart Chase] Cancelled Disaster SL order {disaster_sl_order_id}")
            except Exception as e:
                logger.debug(f"Failed to cancel Disaster SL order: {e}")

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

    # Format amount
    remaining_amount = sell_amount_raw
    if hasattr(exchange, 'amount_to_precision'):
        try:
            remaining_amount = float(exchange.amount_to_precision(symbol, remaining_amount))
        except Exception:
            pass

    if remaining_amount <= 0:
        logger.info(f"✅ [Manual Smart Chase] Aborted: remaining amount {sell_amount_raw} is dust.")
        await _cleanup_other_orders()
        return {'status': 'closed', 'id': 'dust_prevented', 'filled': sell_amount_raw}

    # Circuit Breaker Price Boundary
    max_chase_price = (
        original_sl * (1 - (max_deviation_pct / 100.0))
        if exit_side == "sell"
        else original_sl * (1 + (max_deviation_pct / 100.0))
    )

    chase_active = True
    attempts = 0
    final_res = None

    while chase_active:
        if max_attempts > 0 and attempts >= max_attempts:
            break

        attempts += 1

        # 1. Fetch live orderbook
        current_price = original_sl
        try:
            ob = await exchange.fetch_order_book(symbol, limit=5)
            best_bid = float(ob['bids'][0][0]) if ob.get('bids') and len(ob['bids']) > 0 else current_price
            best_ask = float(ob['asks'][0][0]) if ob.get('asks') and len(ob['asks']) > 0 else current_price
            current_price = best_bid if exit_side == "sell" else best_ask
        except Exception as ob_e:
            logger.warning(f"⚠️ [Manual Smart Chase] Could not fetch orderbook, falling back to ticker: {ob_e}")
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
            await _cleanup_other_orders()
            params = {'reduceOnly': True} if is_futures else {}
            if is_futures and is_hedge_mode:
                params['positionSide'] = 'LONG' if exit_side == 'sell' else 'SHORT'
            try:
                final_res = await exchange.create_market_order(symbol, exit_side, remaining_amount, params=params)
                msg = (
                    f"🚨 *Smart Chase Circuit Breaker Triggered!*\n"
                    f"Exchange: {exchange_name}\n"
                    f"Pair: `{symbol}`\n"
                    f"Action: Emergency Market Sweep ({exit_side.upper()})\n"
                    f"Amount: `{remaining_amount}`\n"
                    f"Breached Price: `{target_maker_price}`\n"
                    f"Original SL: `{original_sl}` (Max Dev: {max_deviation_pct}%)"
                )
                await _send_notify(msg)
            except Exception as sweep_e:
                logger.error(f"❌ Market Sweep failed: {sweep_e}")
            break

        # 4. Prepare params & Place Post-Only Maker Order
        logger.info(
            f"⚡ [Manual Smart Chase] Attempt {attempts}/{max_attempts}: Sending Post-Only {exit_side.upper()} "
            f"at {target_maker_price} (Orderbook: Bid={best_bid}, Ask={best_ask})"
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

                    # Ensure not breaching circuit breaker
                    if (exit_side == "sell" and adj_price >= max_chase_price) or (exit_side == "buy" and adj_price <= max_chase_price):
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
                            await _cleanup_other_orders()
                            break
                    except Exception:
                        pass
                await asyncio.sleep(chase_delay_sec)
                continue

        if chase_res and chase_res.get('id'):
            order_id = chase_res['id']
            logger.info(f"✅ [Manual Smart Chase] Order #{order_id} ACTIVE on exchange book at {target_maker_price}")

            # Wait for fill
            await asyncio.sleep(chase_delay_sec)

            try:
                chk = await exchange.fetch_order(order_id, symbol)
                status = chk.get('status', '').lower()

                if status in ['closed', 'filled']:
                    logger.info("✅ [Manual Smart Chase] Maker Limit Order filled successfully!")
                    final_res = chk
                    await _cleanup_other_orders()
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
                            if remaining_amount <= 0:
                                logger.info("✅ Fully closed via partial fills.")
                                final_res = cancel_chk
                                await _cleanup_other_orders()
                                break
                    except Exception as chk_e:
                        logger.debug(f"Partial check failed: {chk_e}")

            except Exception as chk_err:
                logger.error(f"Error checking order status: {chk_err}")
                await asyncio.sleep(chase_delay_sec)

    # 5. Fallback if max attempts reached without full fill
    if final_res is None and remaining_amount > 0:
        logger.warning(
            f"⚠️ [Manual Smart Chase] Max attempts ({max_attempts}) reached without full fill. Forcing Market Sweep!"
        )
        await _cleanup_other_orders()
        params = {'reduceOnly': True} if is_futures else {}
        if is_futures and is_hedge_mode:
            params['positionSide'] = 'LONG' if exit_side == 'sell' else 'SHORT'
        try:
            final_res = await exchange.create_market_order(symbol, exit_side, remaining_amount, params=params)
            msg = (
                f"⚠️ *Smart Chase Reached Max Attempts!*\n"
                f"Exchange: {exchange_name}\n"
                f"Pair: `{symbol}`\n"
                f"Action: Final Market Sweep ({exit_side.upper()})\n"
                f"Amount: `{remaining_amount}`\n"
                f"Attempts: {attempts}/{max_attempts}"
            )
            await _send_notify(msg)
        except Exception as sweep_err:
            logger.error(f"❌ Final fallback market sweep failed: {sweep_err}")

    return final_res
