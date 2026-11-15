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
import json
import logging
import time
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


def _is_postonly_cross_error(err: Exception) -> bool:
    err_str = str(err).lower()
    return (
        'immediately match' in err_str
        or '-5022' in err_str
        or 'post only' in err_str
        or 'postonly' in err_str
        or 'post-only' in err_str
        or 'gtx' in err_str
        or 'expired' in err_str
    )


def _is_order_already_closed_error(err: Exception) -> bool:
    err_str = str(err).lower()
    return any(kw in err_str for kw in ('filled', 'unknown order', '-2011', '-2013'))


async def _fetch_bbo_fast(exchange, symbol: str, max_age_seconds: float = 0.45) -> Optional[Dict[str, Any]]:
    """Read live orderbook from Redis WS stream (~1ms) when fresh, else fall back to REST."""
    try:
        from app.services.user_order_stream import _get_redis_pub
        r_cli = await _get_redis_pub()
        if r_cli is not None:
            ex_id = str(getattr(exchange, 'id', 'binance') or 'binance').lower()
            raw_ob = await asyncio.wait_for(
                r_cli.get(f"latest_orderbook:{ex_id}:{symbol}"),
                timeout=0.025,
            )
            if raw_ob:
                ob_json = json.loads(raw_ob)
                ts = ob_json.get('ts')
                if ts is not None and 0.0 <= (time.time() - float(ts)) <= max_age_seconds:
                    bids_raw = ob_json.get('bids') or []
                    asks_raw = ob_json.get('asks') or []
                    if bids_raw and asks_raw:
                        bids = [
                            [float(b['price']), float(b['size'])] if isinstance(b, dict) else [float(b[0]), float(b[1])]
                            for b in bids_raw[:5]
                        ]
                        asks = [
                            [float(a['price']), float(a['size'])] if isinstance(a, dict) else [float(a[0]), float(a[1])]
                            for a in asks_raw[:5]
                        ]
                        return {'bids': bids, 'asks': asks}
    except Exception:
        pass

    return await exchange.fetch_order_book(symbol, limit=5)


async def _place_maker_order(exchange, symbol: str, side: str, amount: float, price: float, ex_params: dict, is_futures: bool):
    """Place a Post-Only Maker limit order via WS API (~80-150ms) with seamless REST fallback."""
    if getattr(exchange, 'has', {}).get('createOrderWs'):
        try:
            from app.services.manual_trade_service import ManualTradeService
            ws_type, ws_params = ManualTradeService._sanitize_ws_order_args(
                exchange, 'limit', ex_params, is_futures, is_edit=False
            )
            order = await exchange.create_order_ws(symbol, ws_type, side.lower(), amount, price, ws_params)
            if order and str(order.get('status', '')).lower() in ('expired', 'rejected', 'canceled', 'cancelled'):
                raise Exception(f"Post-Only GTX order returned status={order.get('status')}")
            return order
        except Exception as ws_err:
            if _is_postonly_cross_error(ws_err):
                raise
            logger.debug(f"[Smart Peg Entry] createOrderWs fallback to REST: {ws_err}")

    order = await exchange.create_limit_order(symbol, side.lower(), amount, price, ex_params)
    if order and str(order.get('status', '')).lower() in ('expired', 'rejected', 'canceled', 'cancelled'):
        raise Exception(f"Post-Only GTX order returned status={order.get('status')}")
    return order


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
    reduce_only: bool = False,
    urgent_mode: bool = False,
    start_time: float = 0.0,
    leverage: Optional[int] = None,
    margin_mode: Optional[str] = None,
    ai_filter_info: Optional[str] = None,
    contract_size: float = 1.0,
    is_inverse: Optional[bool] = None,
    send_initial_notify: bool = True,
    anchor_price: Optional[float] = None,
    preloaded_ob: Optional[Dict[str, Any]] = None,
    preloaded_balance: Optional[Dict[str, Any]] = None,
    skip_exchange_upgrade: bool = False,
) -> Optional[Dict[str, Any]]:
    """
    Executes a continuous Dynamic BBO Maker Peg Entry.
    Shadows Best Bid (Buy) or Best Ask (Sell) at top-of-book until fully filled,
    then automatically spawns Attached TP / SL brackets.
    """
    t_peg_start = time.perf_counter()

    # ── STEP 0: Upgrade to dedicated unthrottled order exchange pool instance (purpose='order') ──
    if api_key_record and not skip_exchange_upgrade:
        try:
            from app.services.exchange_pool import get_or_create_exchange
            from app.core.security import decrypt_key
            decrypted_api_key = decrypt_key(api_key_record.api_key)
            decrypted_secret = decrypt_key(api_key_record.secret_key)
            raw_pp = getattr(api_key_record, 'passphrase', None)
            passphrase = decrypt_key(raw_pp) if raw_pp else None
            order_exchange = await get_or_create_exchange(
                api_key_id=api_key_record.id,
                exchange_name=api_key_record.exchange,
                decrypted_api_key=decrypted_api_key,
                decrypted_secret=decrypted_secret,
                is_futures=is_futures,
                passphrase=passphrase,
                purpose="order"
            )
            if order_exchange:
                exchange = order_exchange
                logger.info(f"⚡ [Smart Peg Entry] Upgraded to unthrottled dedicated order exchange for {symbol}")
        except Exception as ex_upgrade_err:
            logger.debug(f"Smart Peg exchange upgrade fallback: {ex_upgrade_err}")

    exchange_name = getattr(api_key_record, 'exchange', 'exchange').capitalize() if api_key_record else 'Exchange'
    min_notional = _get_min_notional(exchange, symbol)

    logger.info(
        f"⚡ [Smart Peg Entry] Starting for {symbol} ({side.upper()}) | Amount: {amount} | "
        f"Max Dev Cap: {max_chase_deviation_pct}% | MinNotional: ${min_notional:.2f}"
    )

    # Detect Binance Hedge Mode on Futures (cached to avoid 150ms roundtrip)
    is_hedge_mode = False
    is_inverse = bool(is_inverse) if is_inverse is not None else _is_inverse_market(exchange, symbol)
    if is_futures and exchange_name.lower().startswith('binance'):
        try:
            from app.services.manual_trade_service import ManualTradeService
            is_hedge_mode = await ManualTradeService._is_binance_hedge_mode(exchange, symbol, is_inverse=is_inverse)
            logger.info(f"⚡ [Smart Peg Entry] Binance Futures mode (cached): {'Hedge' if is_hedge_mode else 'One-Way'}")
        except Exception:
            is_hedge_mode = False

    # Send Notification helper
    async def _send_notify(msg: str):
        if user_id:
            try:
                db = SessionLocal()
                try:
                    await NotificationService.send_message(db, user_id, msg, alert_type="alert_manual_trade")
                finally:
                    db.close()
            except Exception as notify_err:
                logger.warning(f"Telegram notification failed (non-fatal): {notify_err}")

    # Format initial amount
    remaining_amount = amount
    attempts = 0
    attempt_max_str = str(max_attempts) if max_attempts > 0 else '∞ (Continuous)'
    if hasattr(exchange, 'amount_to_precision'):
        try:
            remaining_amount = float(exchange.amount_to_precision(symbol, remaining_amount))
        except Exception:
            pass

    async def _fetch_balance_fast() -> dict:
        from app.services.manual_trade_service import ManualTradeService
        return await ManualTradeService._fetch_wallet_balance(exchange, symbol)

    # Balance sync helper to avoid "insufficient balance" rejections
    async def _sync_and_clamp_amount(price: float, cached_bal: Optional[dict] = None, force_refresh: bool = False) -> float:
        nonlocal remaining_amount
        if is_futures:
            return remaining_amount

        # Ultra-fast path: on subsequent re-peg attempts without balance errors, avoid 300ms REST roundtrip
        if not force_refresh and attempts >= 1 and cached_bal is None and remaining_amount > 0:
            return remaining_amount

        try:
            parts = symbol.split('/')
            if len(parts) >= 2:
                base_asset = parts[0]
                quote_asset = parts[1].split(':')[0]
                bal = cached_bal or await _fetch_balance_fast()

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

    # Fetch initial orderbook & balance in PARALLEL (or reuse preloaded snapshots for ~0ms overhead)
    has_preloaded_ob = bool(
        isinstance(preloaded_ob, dict) and preloaded_ob.get('bids') and preloaded_ob.get('asks')
    )
    initial_ob = preloaded_ob if has_preloaded_ob else None
    cached_bal = preloaded_balance if isinstance(preloaded_balance, dict) else None
    try:
        need_ob = initial_ob is None
        need_bal = (not is_futures) and (cached_bal is None)
        if need_ob and need_bal:
            initial_ob, cached_bal = await asyncio.gather(_fetch_bbo_fast(exchange, symbol), _fetch_balance_fast())
        elif need_ob:
            initial_ob = await _fetch_bbo_fast(exchange, symbol)
        elif need_bal:
            cached_bal = await _fetch_balance_fast()
    except Exception as ob_err:
        logger.error(f"❌ [Smart Peg Entry] Failed to fetch initial data: {ob_err}")
        return None

    if not initial_ob or not initial_ob.get('bids') or not initial_ob.get('asks') or len(initial_ob['bids']) == 0 or len(initial_ob['asks']) == 0:
        logger.error("❌ [Smart Peg Entry] Empty orderbook returned. Aborting.")
        return None

    b_bid = float(initial_ob['bids'][0][0])
    b_ask = float(initial_ob['asks'][0][0])
    market_benchmark_price = b_bid if side.lower() == 'buy' else b_ask
    initial_benchmark_price = float(anchor_price) if (anchor_price and float(anchor_price) > 0) else market_benchmark_price

    # Initial clamp (uses pre-fetched cached_bal for 0ms overhead)
    remaining_amount = await _sync_and_clamp_amount(initial_benchmark_price, cached_bal=cached_bal)
    initial_notional = _calc_order_notional_usd(exchange, symbol, remaining_amount, initial_benchmark_price)
    if remaining_amount <= 0 or initial_notional < min_notional:
        logger.warning(f"⚠️ [Smart Peg Entry] Amount {remaining_amount} (~${initial_notional:.2f}) below min notional ${min_notional:.2f}. Aborted.")
        return None

    cid = peg_id or f"peg_{getattr(api_key_record, 'id', user_id)}_{str(symbol).replace('/', '_').replace(':', '_')}_{int(datetime.utcnow().timestamp())}"
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
        'anchor_price': float(anchor_price) if (anchor_price and float(anchor_price) > 0) else None,
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
                ob = await _fetch_bbo_fast(exchange, symbol)
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
            if anchor_price and float(anchor_price) > 0:
                target_maker_price = min(target_maker_price, float(anchor_price))
        else:
            target_maker_price = best_ask
            if target_maker_price <= best_bid:
                target_maker_price = best_bid + tick
            if anchor_price and float(anchor_price) > 0:
                target_maker_price = max(target_maker_price, float(anchor_price))

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
            peg_order = await _place_maker_order(
                exchange, symbol, side, remaining_amount, target_maker_price, ex_params, is_futures
            )
        except Exception as place_err:
            if _is_postonly_cross_error(place_err):
                logger.warning(f"⚠️ [Smart Peg Entry] Post-Only touched spread ({place_err}). Retrying 1 tick safer...")
                peg_order = None
                try:
                    f_ob = await _fetch_bbo_fast(exchange, symbol)
                    if f_ob and f_ob.get('bids') and f_ob.get('asks'):
                        f_bid = float(f_ob['bids'][0][0])
                        f_ask = float(f_ob['asks'][0][0])
                        adj_price = (f_bid - tick) if side.lower() == 'buy' else (f_ask + tick)
                        if hasattr(exchange, 'price_to_precision') and getattr(exchange, 'markets', None) and symbol in exchange.markets:
                            adj_price = float(exchange.price_to_precision(symbol, adj_price))
                        peg_order = await _place_maker_order(
                            exchange, symbol, side, remaining_amount, adj_price, ex_params, is_futures
                        )
                        if peg_order and peg_order.get('id'):
                            target_maker_price = adj_price
                        else:
                            peg_order = None
                except Exception as adj_e:
                    logger.debug(f"Post-only fallback retry failed: {adj_e}")
                    peg_order = None
            else:
                logger.warning(f"⚠️ [Smart Peg Entry] Placement error: {place_err}")

            if not peg_order or not peg_order.get('id'):
                await asyncio.sleep(0.2)
                continue

        order_id = peg_order['id']
        if cid in ACTIVE_SMART_PEGS:
            ACTIVE_SMART_PEGS[cid]['current_order_id'] = order_id

        logger.info(f"✅ [Smart Peg Entry] Order #{order_id} ACTIVE at {target_maker_price} (Queue Priority Active)")

        # Send Telegram notification for first Smart Peg order placed (with accurate latency_ms)
        if send_initial_notify and attempts == 1 and user_id:
            try:
                from app.services.manual_trade_service import _send_trade_fired_notification
                t_placed = time.perf_counter()
                t_base = start_time if (start_time and start_time > 0) else t_peg_start
                first_order_latency_ms = max(1, int((t_placed - t_base) * 1000))
                asyncio.create_task(
                    _send_trade_fired_notification(
                        user_id=user_id,
                        exchange_name=exchange_name,
                        symbol=symbol,
                        side=side,
                        order_type='SmartPeg',
                        amount=remaining_amount,
                        fill_price=target_maker_price,
                        latency_ms=first_order_latency_ms,
                        attached_tp=tp_config,
                        attached_sl=sl_config,
                        leverage=leverage,
                        margin_mode=margin_mode,
                        is_futures=is_futures,
                        max_dev=max_chase_deviation_pct,
                        contract_size=contract_size,
                        is_inverse=is_inverse,
                        ai_filter_info=ai_filter_info,
                        anchor_price=anchor_price
                    )
                )
            except Exception as notify_first_err:
                logger.warning(f"Failed to send Smart Peg trade fired notification: {notify_first_err}")

        # 5. Dynamic BBO Peg Watch Loop (100ms in urgent_mode, 150ms standard; WS BBO + parallel fill check)
        peg_poll_interval = 0.10 if urgent_mode else 0.15
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

                # Fetch order status (every 2 polls) and live BBO in PARALLEL to avoid serial REST delay
                chk_in_loop = None
                latest_ob = None
                if poll_count % 2 == 0:
                    order_res, ob_res = await asyncio.gather(
                        exchange.fetch_order(order_id, symbol),
                        _fetch_bbo_fast(exchange, symbol),
                        return_exceptions=True,
                    )
                    if isinstance(order_res, Exception):
                        logger.debug(f"Entry order poll check notice: {order_res}")
                    else:
                        chk_in_loop = order_res
                    if isinstance(ob_res, Exception):
                        logger.debug(f"Entry BBO poll non-fatal error: {ob_res}")
                    else:
                        latest_ob = ob_res
                else:
                    try:
                        latest_ob = await _fetch_bbo_fast(exchange, symbol)
                    except Exception as ob_p_err:
                        logger.debug(f"Entry BBO poll non-fatal error: {ob_p_err}")

                if chk_in_loop:
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

                # Verify if we are still top of book
                try:
                    if latest_ob and latest_ob.get('bids') and latest_ob.get('asks') and len(latest_ob['bids']) > 0 and len(latest_ob['asks']) > 0:
                        l_best_bid = float(latest_ob['bids'][0][0])
                        l_best_ask = float(latest_ob['asks'][0][0])
                        l_tick = _get_market_tick(exchange, symbol, l_best_bid)

                        if side.lower() == "buy":
                            new_maker = l_best_bid
                            if new_maker >= l_best_ask:
                                new_maker = l_best_ask - l_tick
                            if anchor_price and float(anchor_price) > 0:
                                new_maker = min(new_maker, float(anchor_price))
                        else:
                            new_maker = l_best_ask
                            if new_maker <= l_best_bid:
                                new_maker = l_best_bid + l_tick
                            if anchor_price and float(anchor_price) > 0:
                                new_maker = max(new_maker, float(anchor_price))

                        if hasattr(exchange, 'price_to_precision') and getattr(exchange, 'markets', None) and symbol in exchange.markets:
                            try:
                                new_maker = float(exchange.price_to_precision(symbol, new_maker))
                            except Exception:
                                pass

                        # Outbid / Spread shift condition with FIFO Queue Priority protection:
                        # - Outbid: 2 polls (~300ms standard, 100ms urgent) to step ahead quickly while avoiding 1-tick noise.
                        # - Retreat: 4 polls (~600ms standard, 200ms urgent) because resting order is at front of queue.
                        if new_maker != target_maker_price:
                            is_outbid = (new_maker > target_maker_price) if side.lower() == "buy" else (new_maker < target_maker_price)
                            min_polls_required = (1 if is_outbid else 2) if urgent_mode else (2 if is_outbid else 4)
                            if poll_count >= min_polls_required:
                                logger.info(
                                    f"⚡ [Smart Peg Entry] BBO shifted ({'outbid' if is_outbid else 'retreat'}): {target_maker_price} ➜ {new_maker} "
                                    f"(Bid={l_best_bid}, Ask={l_best_ask}). Fast re-pegging to BBO..."
                                )
                                # ── PRICE CAP DEVIATION GUARD PRE-CHECK ON NEW_MAKER ──
                                if max_chase_deviation_pct and max_chase_deviation_pct > 0:
                                    if side.lower() == "buy":
                                        max_allowed_price = initial_benchmark_price * (1 + (max_chase_deviation_pct / 100.0))
                                        if new_maker > max_allowed_price:
                                            logger.warning(
                                                f"🛑 [Smart Peg Entry] New maker price {new_maker} drifted beyond max cap {max_allowed_price:.6f} "
                                                f"(+{max_chase_deviation_pct}% from initial {initial_benchmark_price}). Stopping peg to protect capital."
                                            )
                                            break
                                    else:
                                        min_allowed_price = initial_benchmark_price * (1 - (max_chase_deviation_pct / 100.0))
                                        if new_maker < min_allowed_price:
                                            logger.warning(
                                                f"🛑 [Smart Peg Entry] New maker price {new_maker} drifted below min cap {min_allowed_price:.6f} "
                                                f"(-{max_chase_deviation_pct}% from initial {initial_benchmark_price}). Stopping peg to protect capital."
                                            )
                                            break

                                # ── PRIORITY 0 (WS ~80-150ms) & PRIORITY 1 (REST ~250ms): NATIVE ATOMIC RE-PEG ──
                                try:
                                    from app.services.user_order_stream import mark_order_replaced
                                    mark_order_replaced(str(order_id))
                                except Exception:
                                    pass

                                from app.services.manual_trade_service import ManualTradeService
                                ws_edit_type, ws_edit_params = ManualTradeService._sanitize_ws_order_args(
                                    exchange, 'limit', ex_params, is_futures, is_edit=True
                                )
                                edit_candidates = []
                                if getattr(exchange, 'has', {}).get('editOrderWs') and hasattr(exchange, 'edit_order_ws'):
                                    edit_candidates.append(('WS', exchange.edit_order_ws, ws_edit_type, ws_edit_params))
                                if getattr(exchange, 'has', {}).get('editOrder') and hasattr(exchange, 'edit_order'):
                                    rest_type, rest_params = (
                                        (ws_edit_type, ws_edit_params) if is_futures else ('limit', ex_params)
                                    )
                                    edit_candidates.append(('REST', exchange.edit_order, rest_type, rest_params))

                                edit_res = None
                                edit_channel = None
                                repeg_ms = 0
                                order_filled_during_edit = False

                                for ch_name, edit_fn, e_type, e_params in edit_candidates:
                                    t_repeg_start = time.perf_counter()
                                    try:
                                        candidate_res = await edit_fn(
                                            order_id, symbol, e_type, side.lower(), remaining_amount, new_maker, e_params
                                        )
                                        repeg_ms = int((time.perf_counter() - t_repeg_start) * 1000)
                                        if candidate_res and candidate_res.get('id'):
                                            edit_res = candidate_res
                                            edit_channel = ch_name
                                            break
                                    except Exception as edit_err:
                                        repeg_ms = int((time.perf_counter() - t_repeg_start) * 1000)
                                        if _is_order_already_closed_error(edit_err):
                                            logger.info(f"✅ [Smart Peg Entry] Order #{order_id} filled or closed during edit ({edit_err}). Verifying fill status...")
                                            try:
                                                chk_fill = await exchange.fetch_order(order_id, symbol)
                                                if chk_fill.get('status', '').lower() in ['closed', 'filled']:
                                                    latest_order_chk = chk_fill
                                                    order_filled_during_edit = True
                                                    break
                                            except Exception:
                                                pass
                                        logger.info(f"{ch_name} editOrder fallback notice ({edit_err}) [{repeg_ms}ms]")

                                if order_filled_during_edit:
                                    break

                                if edit_res and edit_res.get('id'):
                                    old_oid = order_id
                                    order_id = str(edit_res.get('id'))
                                    target_maker_price = new_maker
                                    attempts += 1

                                    # Check if there was a partial fill on the cancelled order during atomic cancelReplace (Spot)
                                    cancel_info = edit_res.get('info', {}).get('cancelResponse', {}) if isinstance(edit_res, dict) else {}
                                    if cancel_info:
                                        c_raw_filled = float(cancel_info.get('executedQty') or 0.0)
                                        chunk = max(0.0, c_raw_filled - order_processed_filled)
                                        if chunk > 0:
                                            total_filled += chunk
                                            exec_p = float(cancel_info.get('price') or target_maker_price)
                                            accumulated_cost += (chunk * exec_p)
                                            remaining_amount = max(0.0, remaining_amount - chunk)
                                            logger.info(f"🔄 [Smart Peg Entry] Captured partial fill during atomic cancelReplace: {chunk} at {exec_p}")
                                            if (tp_config or sl_config) and not reduce_only:
                                                from app.services.bracket_order_service import BracketOrderService
                                                asyncio.create_task(
                                                    BracketOrderService._spawn_bracket_for_amount(
                                                        exchange=exchange,
                                                        symbol=symbol,
                                                        side=side.lower(),
                                                        filled_amount=chunk,
                                                        average_price=exec_p,
                                                        is_futures=is_futures,
                                                        tp_config=tp_config,
                                                        sl_config=sl_config,
                                                        user_id=user_id,
                                                        api_key_record=api_key_record,
                                                        entry_order_id=cid
                                                    )
                                                )

                                    if old_oid != order_id:
                                        order_processed_filled = 0.0

                                    if cid in ACTIVE_SMART_PEGS:
                                        ACTIVE_SMART_PEGS[cid]['current_order_id'] = order_id
                                        ACTIVE_SMART_PEGS[cid]['current_maker_price'] = target_maker_price
                                        ACTIVE_SMART_PEGS[cid]['current_attempt'] = attempts
                                        ACTIVE_SMART_PEGS[cid]['filled_amount'] = total_filled
                                        ACTIVE_SMART_PEGS[cid]['amount'] = remaining_amount

                                    logger.info(
                                        f"⚡ [Smart Peg Entry] {edit_channel} atomic re-peg SUCCESS in {repeg_ms}ms! ⚡ "
                                        f"Order #{old_oid} ➜ #{order_id} at {target_maker_price} (Attempt {attempts}/{attempt_max_str})"
                                    )

                                    if str(edit_res.get('status', '')).lower() in ('closed', 'filled'):
                                        logger.info(f"🎯 [Smart Peg Entry] New order #{order_id} filled immediately upon replacement!")
                                        latest_order_chk = edit_res
                                        break

                                    poll_count = 0

                                    if max_attempts > 0 and attempts >= max_attempts:
                                        logger.info(f"⚠️ [Smart Peg Entry] Max attempts ({max_attempts}) reached after re-peg.")
                                        break

                                    continue  # Stay right in BBO shadow watch loop! Zero delay!

                                # Fallback: Break to clean zero-delay cancel + create
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
            chk = None
            if latest_order_chk and latest_order_chk.get('status', '').lower() in ['closed', 'filled']:
                chk = latest_order_chk
            elif not repeg_triggered:
                try:
                    chk = await exchange.fetch_order(order_id, symbol)
                except Exception as f_err:
                    logger.debug(f"Fetch entry order check notice: {f_err}")

            status = chk.get('status', '').lower() if chk else ''

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

                fill_duration_ms = max(1, int((time.perf_counter() - t_peg_start) * 1000))
                msg = (
                    f"🎯 *Smart Peg Entry Filled!*\n"
                    f"Exchange: {exchange_name}\n"
                    f"Pair: `{symbol}`\n"
                    f"Side: {side.upper()} (Maker Entry ⚡)\n"
                    f"Filled Amount: `{total_filled}`\n"
                    f"Price: `${exec_price:,.4f}`\n"
                    f"Attempts: {attempts}\n"
                    f"⏱ Fill Duration: `{fill_duration_ms} ms` ({fill_duration_ms / 1000:.2f}s) ⚡\n"
                    f"Time: `{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}`"
                )
                await _send_notify(msg)
                break
            else:
                # ── PRIORITY 2: ZERO-DELAY CANCEL + RE-PEG FALLBACK ──
                cancel_res = None
                was_already_filled = False
                try:
                    t_c0 = time.perf_counter()
                    cancel_res = await exchange.cancel_order(order_id, symbol)
                    c_ms = int((time.perf_counter() - t_c0) * 1000)
                    logger.info(f"⚡ [Smart Peg Entry] Cancelled resting entry order #{order_id} in {c_ms}ms")
                except Exception as c_err:
                    err_s = str(c_err).lower()
                    if any(kw in err_s for kw in ['filled', 'unknown order', '-2011', '-2013']):
                        was_already_filled = True
                        logger.info(f"✅ [Smart Peg Entry] Order #{order_id} was already filled before cancel: {c_err}")
                    else:
                        logger.debug(f"Cancel entry order notice: {c_err}")

                # If order was filled right before or during cancel:
                if was_already_filled or (cancel_res and str(cancel_res.get('status', '')).lower() in ['closed', 'filled']):
                    try:
                        chk = await exchange.fetch_order(order_id, symbol)
                        if chk.get('status', '').lower() in ['closed', 'filled']:
                            raw_filled_amt = float(chk.get('filled') or (remaining_amount + order_processed_filled))
                            filled_amt = max(0.0, raw_filled_amt - order_processed_filled)
                            exec_price = float(chk.get('average') or chk.get('price') or target_maker_price)
                            if filled_amt > 0:
                                order_processed_filled = raw_filled_amt
                                total_filled += filled_amt
                                accumulated_cost += (filled_amt * exec_price)
                                remaining_amount = max(0.0, remaining_amount - filled_amt)
                            final_res = chk
                            if filled_amt > 0 and (tp_config or sl_config) and not reduce_only:
                                from app.services.bracket_order_service import BracketOrderService
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
                            fill_duration_ms = max(1, int((time.perf_counter() - t_peg_start) * 1000))
                            msg = (
                                f"🎯 *Smart Peg Entry Filled!*\n"
                                f"Exchange: {exchange_name}\n"
                                f"Pair: `{symbol}`\n"
                                f"Side: {side.upper()} (Maker Entry ⚡)\n"
                                f"Filled Amount: `{total_filled}`\n"
                                f"Price: `${exec_price:,.4f}`\n"
                                f"Attempts: {attempts}\n"
                                f"⏱ Fill Duration: `{fill_duration_ms} ms` ({fill_duration_ms / 1000:.2f}s) ⚡\n"
                                f"Time: `{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}`"
                            )
                            await _send_notify(msg)
                            break
                    except Exception:
                        pass

                # Check partial fill directly from atomic cancel response (0ms delay!)
                try:
                    raw_p_filled = 0.0
                    if isinstance(cancel_res, dict):
                        raw_p_filled = float(cancel_res.get('filled') or cancel_res.get('info', {}).get('executedQty') or 0.0)
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
