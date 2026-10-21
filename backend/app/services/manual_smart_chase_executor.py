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
    3. Places Post-Only Maker limit order.
    4. Waits for chase_delay_ms.
    5. If filled: Cancels TP / Disaster SL, notifies user, finishes.
    6. If unfilled: Cancels order, accounts for any partial fill, recalculates and chases.
    7. If Circuit Breaker breached or max_attempts exceeded: Forces Market Sweep.
    """
    chase_delay_sec = max(0.2, chase_delay_ms / 1000.0)
    exchange_name = getattr(api_key_record, 'exchange', 'exchange').capitalize() if api_key_record else 'Exchange'

    logger.info(
        f"🛡️ [Manual Smart Chase] Starting for {symbol} ({exit_side.upper()}) | "
        f"Amount: {sell_amount_raw} | SL Trigger: {original_sl} | Max Dev: {max_deviation_pct}% | Delay: {chase_delay_ms}ms"
    )

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

        # 1. Fetch best maker price from orderbook
        current_price = original_sl
        try:
            ob = await exchange.fetch_order_book(symbol, limit=5)
            best_bid = ob['bids'][0][0] if ob.get('bids') else current_price
            best_ask = ob['asks'][0][0] if ob.get('asks') else current_price
            current_price = best_bid if exit_side == "sell" else best_ask
        except Exception as ob_e:
            logger.warning(f"⚠️ [Manual Smart Chase] Could not fetch orderbook, falling back to ticker: {ob_e}")
            try:
                ticker = await exchange.fetch_ticker(symbol)
                current_price = ticker.get('last') or original_sl
                best_bid = ticker.get('bid') or current_price
                best_ask = ticker.get('ask') or current_price
            except Exception:
                best_bid = original_sl
                best_ask = original_sl

        # Target Maker Price:
        # Sell -> lowest ask (front of asks)
        # Buy -> highest bid (front of bids)
        target_maker_price = best_ask if exit_side == "sell" else best_bid

        # Add 1-tick front-running if spread allows without taking
        try:
            mkt = exchange.markets.get(symbol, {}) if hasattr(exchange, 'markets') else {}
            tick = mkt.get('precision', {}).get('price')
            if tick and float(tick) > 0:
                tick_val = float(tick)
                if exit_side == "sell" and (best_ask - tick_val) > best_bid:
                    target_maker_price = best_ask - tick_val
                elif exit_side == "buy" and (best_bid + tick_val) < best_ask:
                    target_maker_price = best_bid + tick_val
        except Exception:
            pass

        if hasattr(exchange, 'price_to_precision'):
            try:
                target_maker_price = float(exchange.price_to_precision(symbol, target_maker_price))
            except Exception:
                pass

        # 2. Check Circuit Breaker
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

        # 3. Place Post-Only Maker Order
        logger.info(f"⚡ [Manual Smart Chase] Attempt {attempts}/{max_attempts}: Placing Post-Only {exit_side.upper()} at {target_maker_price}")
        ex_params = {'postOnly': True}
        if is_futures:
            ex_params['reduceOnly'] = True

        chase_res = None
        try:
            if exchange.has.get('createOrderWs'):
                try:
                    chase_res = await exchange.create_order_ws(
                        symbol, 'limit', exit_side, remaining_amount, target_maker_price, ex_params
                    )
                except Exception as ws_e:
                    logger.debug(f"WS order placement failed ({ws_e}), falling back to REST.")
            if not chase_res:
                chase_res = await exchange.create_limit_order(
                    symbol, exit_side, remaining_amount, target_maker_price, ex_params
                )
        except Exception as place_e:
            logger.debug(f"Post-only order rejected or failed (spread crossed): {place_e}")
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

    # 4. Fallback if max attempts reached without full fill
    if final_res is None and remaining_amount > 0:
        logger.warning(
            f"⚠️ [Manual Smart Chase] Max attempts ({max_attempts}) reached without full fill. Forcing Market Sweep!"
        )
        await _cleanup_other_orders()
        params = {'reduceOnly': True} if is_futures else {}
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
