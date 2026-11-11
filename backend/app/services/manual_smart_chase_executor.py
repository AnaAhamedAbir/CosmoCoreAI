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
import time
from datetime import datetime
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


def _is_inverse_market(exchange, symbol: str) -> bool:
    """Checks whether the market is a Coin-Margined Inverse contract."""
    try:
        if hasattr(exchange, 'markets') and exchange.markets and symbol in exchange.markets:
            mkt = exchange.markets[symbol]
            return bool(mkt.get('inverse') or mkt.get('subType') == 'inverse')
    except Exception:
        pass
    if ':' in symbol:
        parts = symbol.split('/')
        base = parts[0]
        settle = parts[1].split(':')[1] if ':' in parts[1] else ''
        if settle.upper() == base.upper():
            return True
    return False


def _calc_order_notional_usd(exchange, symbol: str, amount: float, price: float) -> float:
    """Calculates order USD notional correctly for Linear, Inverse, and Spot markets."""
    if not amount:
        return 0.0
    try:
        if _is_inverse_market(exchange, symbol):
            contract_size = 1.0
            if hasattr(exchange, 'markets') and exchange.markets and symbol in exchange.markets:
                contract_size = float(exchange.markets[symbol].get('contractSize') or 1.0)
            else:
                base = symbol.split('/')[0]
                contract_size = 100.0 if base.upper() == 'BTC' else 10.0
            return float(amount) * contract_size
    except Exception:
        pass
    return float(amount) * float(price or 0.0)


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


async def _get_live_position_contracts(exchange, symbol: str, exit_side: str, is_inverse: bool = False) -> float:
    """
    Fetches the live open position size (in contracts or base units) for the symbol
    corresponding to the position we are attempting to exit.
    Returns 0.0 if the position is already closed or does not exist.
    Returns -1.0 if the exchange API call failed (failsafe to avoid false zero).
    """
    try:
        pos_params = {'subType': 'inverse'} if is_inverse else {}
        positions = await exchange.fetch_positions([symbol], pos_params)
        if not positions:
            return 0.0

        target_clean = symbol.replace('/', '').replace(':', '').upper()
        target_base = symbol.split('/')[0].upper()
        expected_hedge_side = 'LONG' if exit_side.lower() == 'sell' else 'SHORT'

        matching_pos_found = False
        for p in positions:
            p_sym = str(p.get('symbol') or '')
            p_info_sym = str(p.get('info', {}).get('symbol') or '')

            clean_p = p_sym.replace('/', '').replace(':', '').upper()
            clean_info = p_info_sym.replace('_', '').upper()

            matches = (
                p_sym == symbol
                or clean_p == target_clean
                or clean_info == target_clean
                or (clean_info.startswith(target_base) and any(x in clean_info for x in ['USD', 'USDT', 'FDUSD', 'PERP']))
            )
            if not matches:
                continue

            pos_side = str(p.get('info', {}).get('positionSide') or p.get('side') or '').upper()
            if pos_side in ['LONG', 'SHORT'] and pos_side != expected_hedge_side:
                # Opposite side in hedge mode, skip
                continue

            matching_pos_found = True
            contracts = float(p.get('contracts') or 0.0)
            if contracts == 0.0:
                raw_amt = p.get('info', {}).get('positionAmt')
                if raw_amt is not None:
                    contracts = abs(float(raw_amt))

            if contracts > 0.0:
                return contracts

        if matching_pos_found:
            return 0.0
        return 0.0
    except Exception as e:
        logger.warning(f"⚠️ [Manual Smart Chase] Position check non-fatal error: {e}")
        return -1.0


def _calculate_target_maker_price(
    exit_side: str,
    ob: dict,
    tick: float,
    peg_strategy: str = 'bbo',
    wall_multiplier: float = 2.5,
    max_chase_price: float = 0.0,
    exchange = None,
    symbol: str = ''
) -> float:
    """
    Computes optimal maker price based on chosen microstructure peg strategy:
    - 'bbo': Standard Level 1 BBO (Best Ask for sell, Best Bid for buy)
    - 'inside_spread': Jumps 1 tick inside the spread for #1 queue priority maker fill
    - 'wall_aware': Scans L2 depth, detects support/resistance walls (> multiplier * avg),
                    and front-runs 1 tick ahead.
    Guarantees strict Post-Only maker boundary (never crosses the spread).
    """
    bids = ob.get('bids', []) if ob else []
    asks = ob.get('asks', []) if ob else []
    if not bids or not asks:
        return 0.0

    best_bid = float(bids[0][0])
    best_ask = float(asks[0][0])
    spread = best_ask - best_bid

    target_price = best_ask if exit_side == "sell" else best_bid

    # Strategy 1: Liquidity-Wall Aware Pegging (Microstructure Wall Front-Running)
    if peg_strategy == 'wall_aware' and len(bids) >= 2 and len(asks) >= 2:
        try:
            if exit_side == "sell":  # Long Exit (Selling base): check ask resistance wall or bid support
                ask_qtys = [float(a[1]) for a in asks[:10] if len(a) > 1]
                avg_ask_vol = (sum(ask_qtys) / len(ask_qtys)) if ask_qtys else 0.0
                detected_wall_price = None

                for a in asks[:10]:
                    p, q = float(a[0]), float(a[1])
                    if avg_ask_vol > 0 and q >= avg_ask_vol * wall_multiplier and (max_chase_price == 0 or p >= max_chase_price):
                        detected_wall_price = p
                        break

                if detected_wall_price and (detected_wall_price - tick) > best_bid:
                    target_price = detected_wall_price - tick
                else:
                    # Check for bid support wall to rest safely right above it
                    bid_qtys = [float(b[1]) for b in bids[:10] if len(b) > 1]
                    avg_bid_vol = (sum(bid_qtys) / len(bid_qtys)) if bid_qtys else 0.0
                    for b in bids[:10]:
                        p, q = float(b[0]), float(b[1])
                        if avg_bid_vol > 0 and q >= avg_bid_vol * wall_multiplier and (max_chase_price == 0 or p >= max_chase_price):
                            if (p + tick) > best_bid:
                                target_price = p + tick
                            break
            else:  # Short Exit (Buying base): check bid support wall or ask resistance
                bid_qtys = [float(b[1]) for b in bids[:10] if len(b) > 1]
                avg_bid_vol = (sum(bid_qtys) / len(bid_qtys)) if bid_qtys else 0.0
                detected_wall_price = None

                for b in bids[:10]:
                    p, q = float(b[0]), float(b[1])
                    if avg_bid_vol > 0 and q >= avg_bid_vol * wall_multiplier and (max_chase_price == 0 or p <= max_chase_price):
                        detected_wall_price = p
                        break

                if detected_wall_price and (detected_wall_price + tick) < best_ask:
                    target_price = detected_wall_price + tick
                else:
                    # Check for ask resistance wall to rest safely right below it
                    ask_qtys = [float(a[1]) for a in asks[:10] if len(a) > 1]
                    avg_ask_vol = (sum(ask_qtys) / len(ask_qtys)) if ask_qtys else 0.0
                    for a in asks[:10]:
                        p, q = float(a[0]), float(a[1])
                        if avg_ask_vol > 0 and q >= avg_ask_vol * wall_multiplier and (max_chase_price == 0 or p <= max_chase_price):
                            if (p - tick) < best_ask:
                                target_price = p - tick
                            break
        except Exception as wall_err:
            logger.debug(f"Wall detection fallback: {wall_err}")

    # Strategy 2: Inside-Spread Pegging
    elif peg_strategy == 'inside_spread' and spread > (tick * 1.5):
        if exit_side == "sell":
            candidate = best_ask - tick
            if candidate > best_bid:
                target_price = candidate
        else:
            candidate = best_bid + tick
            if candidate < best_ask:
                target_price = candidate

    # Strict Maker Post-Only Guard: Must remain strictly on the maker side
    if exit_side == "sell":
        if target_price <= best_bid:
            target_price = best_bid + tick
    else:
        if target_price >= best_ask:
            target_price = best_ask - tick

    # Format with exchange precision
    if exchange and hasattr(exchange, 'price_to_precision') and symbol:
        try:
            target_price = float(exchange.price_to_precision(symbol, target_price))
        except Exception:
            pass

    # Ensure precision rounding didn't cross the spread
    if exit_side == "sell" and target_price <= best_bid:
        target_price = float(exchange.price_to_precision(symbol, best_bid + tick)) if (exchange and hasattr(exchange, 'price_to_precision')) else (best_bid + tick)
        if target_price <= best_bid:
            target_price = best_ask
    elif exit_side == "buy" and target_price >= best_ask:
        target_price = float(exchange.price_to_precision(symbol, best_ask - tick)) if (exchange and hasattr(exchange, 'price_to_precision')) else (best_ask - tick)
        if target_price >= best_ask:
            target_price = best_bid

    return target_price


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
            raw_c_sym = str(cdata.get('symbol', '')).strip()
            raw_target_sym = str(symbol or '').strip()
            if raw_target_sym:
                if (':' in raw_c_sym) != (':' in raw_target_sym):
                    continue
                if raw_c_sym.split(':')[0].upper() != raw_target_sym.split(':')[0].upper():
                    continue

        if api_key_id is not None and cdata.get('api_key_id') is not None and int(cdata.get('api_key_id')) != int(api_key_id):
            continue
        if user_id is not None and cdata.get('user_id') is not None and int(cdata.get('user_id')) != int(user_id):
            continue

        logger.info(f"🛑 [Manual Smart Chase] Aborting active chase {cid} for {cdata.get('symbol') or symbol}...")
        cancel_evt = cdata.get('cancel_event')
        if cancel_evt and not cancel_evt.is_set():
            cancel_evt.set()

        # Proactively cancel resting maker limit order on exchange if present
        curr_order_id = cdata.get('current_order_id')
        ex = cdata.get('exchange')
        if curr_order_id and ex:
            try:
                await ex.cancel_order(curr_order_id, cdata.get('symbol') or symbol)
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
    chase_id: Optional[str] = None,
    chase_mode: str = 'dynamic_bbo',  # 'dynamic_bbo' for real-time orderbook shadowing, 'interval' for timer
    trigger_source: str = 'bid_ask',
    peg_strategy: str = 'bbo',        # 'bbo', 'inside_spread', or 'wall_aware'
    wall_multiplier: float = 2.5
) -> Optional[Dict[str, Any]]:
    # ── STEP 0: Upgrade to dedicated unthrottled order exchange pool instance (purpose='order') ──
    if api_key_record:
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
                logger.info(f"⚡ [Manual Smart Chase] Upgraded to unthrottled dedicated order exchange for {symbol}")
        except Exception as ex_upgrade_err:
            logger.debug(f"Smart Chase exchange upgrade fallback: {ex_upgrade_err}")

    chase_delay_sec = max(0.2, chase_delay_ms / 1000.0)
    exchange_name = getattr(api_key_record, 'exchange', 'exchange').capitalize() if api_key_record else 'Exchange'
    min_notional = _get_min_notional(exchange, symbol)
    ob_depth_limit = 20 if peg_strategy == 'wall_aware' else 5

    exec_info = (
        f"Real-Time BBO Shadowing (FIFO resting: {max(1.2, min(chase_delay_sec, 2.5)):.1f}s)"
        if chase_mode == 'dynamic_bbo'
        else f"Interval Timer ({chase_delay_ms}ms throttle)"
    )
    logger.info(
        f"🛡️ [Manual Smart Chase] Starting for {symbol} ({exit_side.upper()}) | Mode: {chase_mode.upper()} | "
        f"Strategy: {peg_strategy.upper()} | Amount: {sell_amount_raw} | SL Trigger: {original_sl} | "
        f"Max Dev: {max_deviation_pct}% | Execution: {exec_info} | MinNotional: ${min_notional:.2f}"
    )

    # Detect Binance Hedge Mode on Futures to avoid -4061 rejection
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
                    logger.info(f"🛡️ [Manual Smart Chase] Binance Futures mode: {'Hedge' if is_hedge_mode else 'One-Way'}")
                    break
                except Exception:
                    pass

    # Cancel this bracket's own TP and Disaster SL (protecting other independent brackets on the same symbol!)
    async def _cleanup_other_orders(scan_unlinked: bool = False):
        nonlocal tp_order_id, disaster_sl_order_id
        from app.services.bracket_order_service import BracketOrderService
        cancel_tasks = []
        labels = []
        had_own_linked_orders = bool(tp_order_id or disaster_sl_order_id)
        if tp_order_id:
            cancel_tasks.append(BracketOrderService._cancel_futures_order_universal(exchange, tp_order_id, symbol))
            labels.append(('TP', str(tp_order_id)))
        if disaster_sl_order_id:
            cancel_tasks.append(BracketOrderService._cancel_futures_order_universal(exchange, disaster_sl_order_id, symbol))
            labels.append(('Disaster SL', str(disaster_sl_order_id)))

        # Only scan open orders on exchange if requested (e.g. balance/reduceOnly blocked) or if no linked TP/SL ID was passed,
        # and ALWAYS protect TP / Disaster SL orders belonging to other active brackets in ACTIVE_SOFTWARE_SL!
        if scan_unlinked or not had_own_linked_orders:
            protected_order_ids = set()
            try:
                for s_id, s_data in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
                    if chase_id and str(s_id) == str(chase_id):
                        continue
                    if s_data.get('cancelled'):
                        continue
                    if s_data.get('tp_order_id'):
                        protected_order_ids.add(str(s_data.get('tp_order_id')))
                    if s_data.get('disaster_sl_order_id'):
                        protected_order_ids.add(str(s_data.get('disaster_sl_order_id')))
            except Exception:
                pass

            try:
                open_orders = await exchange.fetch_open_orders(symbol)
                if is_futures:
                    try:
                        cond_orders = await exchange.fetch_open_orders(symbol, params={'stop': True})
                        if cond_orders:
                            open_orders.extend(cond_orders)
                    except Exception:
                        pass
                for o in open_orders:
                    oid = str(o.get('id'))
                    if not oid or oid in [l[1] for l in labels] or oid in protected_order_ids:
                        continue
                    o_side = str(o.get('side', '')).lower()
                    o_info = o.get('info', {}) if isinstance(o.get('info'), dict) else {}
                    is_reduce = o.get('reduceOnly') or o_info.get('reduceOnly') in [True, 'true', 'True']
                    raw_type = str(o.get('type', '')).lower()
                    info_type = str(o_info.get('orderType') or o_info.get('type') or o_info.get('origType') or '').lower()
                    has_trig = False
                    for cand in (o.get('stopPrice'), o.get('triggerPrice'), o_info.get('triggerPrice'), o_info.get('stopPrice'), o_info.get('activatePrice')):
                        if cand is not None:
                            try:
                                if float(cand) > 0:
                                    has_trig = True
                                    break
                            except (ValueError, TypeError):
                                pass
                    is_stop = (
                        'stop' in raw_type or 'take_profit' in raw_type or
                        'stop' in info_type or 'take_profit' in info_type or
                        has_trig
                    )

                    if o_side == exit_side or (is_reduce and o_side == exit_side) or (is_stop and o_side == exit_side):
                        cancel_tasks.append(BracketOrderService._cancel_futures_order_universal(exchange, oid, symbol))
                        labels.append(('ConflictingExitOrder', oid))
            except Exception as open_err:
                logger.debug(f"Open orders fetch during cleanup non-fatal error: {open_err}")

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
                    await NotificationService.send_message(db, user_id, msg, alert_type="alert_manual_trade")
                finally:
                    db.close()
            except Exception as notify_err:
                logger.warning(f"Telegram notification failed (non-fatal): {notify_err}")

    # ── STEP 1: IMMEDIATELY CANCEL TP & DISASTER SL CONCURRENTLY ──
    await _cleanup_other_orders()

    # Format initial amount
    remaining_amount = sell_amount_raw
    attempts = 0
    attempt_max_str = str(max_attempts) if max_attempts > 0 else '∞ (Continuous)'
    if hasattr(exchange, 'amount_to_precision'):
        try:
            remaining_amount = float(exchange.amount_to_precision(symbol, remaining_amount))
        except Exception:
            pass

    # Balance sync helper to avoid "insufficient balance" rejections
    async def _sync_and_clamp_amount(price: float, cached_bal: Optional[dict] = None, force_refresh: bool = False) -> float:
        nonlocal remaining_amount
        # Ultra-fast path: on subsequent re-peg attempts without balance errors or partial fills, avoid 300ms REST roundtrip
        if not force_refresh and attempts > 1 and cached_bal is None and remaining_amount > 0:
            return remaining_amount

        if is_futures:
            try:
                is_inv = _is_inverse_market(exchange, symbol)
                live_contracts = await _get_live_position_contracts(exchange, symbol, exit_side, is_inv)
                if live_contracts == 0.0:
                    logger.info(
                        f"✅ [Manual Smart Chase] Live futures position for {symbol} is 0.0! "
                        f"Position was closed/filled externally."
                    )
                    remaining_amount = 0.0
                    return 0.0
                elif live_contracts > 0.0 and live_contracts < remaining_amount:
                    adjusted = float(exchange.amount_to_precision(symbol, live_contracts)) if hasattr(exchange, 'amount_to_precision') else live_contracts
                    if adjusted != remaining_amount:
                        logger.info(
                            f"🔄 [Manual Smart Chase] Clamped exit amount from {remaining_amount} to live position: {adjusted}"
                        )
                        remaining_amount = adjusted
            except Exception as fe:
                logger.warning(f"⚠️ [Manual Smart Chase] Futures position sync warning: {fe}")
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
            exchange.fetch_order_book(symbol, limit=ob_depth_limit),
            return_exceptions=True
        )
        if not isinstance(ob_res, Exception) and isinstance(ob_res, dict):
            cached_initial_ob = ob_res
        if not isinstance(bal_res, Exception) and isinstance(bal_res, dict):
            initial_bal = bal_res
    else:
        pos_fut_res, ob_res = await asyncio.gather(
            _sync_and_clamp_amount(original_sl),
            exchange.fetch_order_book(symbol, limit=ob_depth_limit),
            return_exceptions=True
        )
        if not isinstance(ob_res, Exception) and isinstance(ob_res, dict):
            cached_initial_ob = ob_res

    # Initial clamp (instant, using pre-fetched balance)
    if not is_futures:
        remaining_amount = await _sync_and_clamp_amount(original_sl, cached_bal=initial_bal)

    # Spot-specific ledger lag resilience: if balance is 0 right after cancelling TP order, give Binance ledger a short moment to release
    if not is_futures and remaining_amount <= 0 and sell_amount_raw > 0:
        for r_attempt in range(2):
            await asyncio.sleep(0.25)
            try:
                fresh_bal = await exchange.fetch_balance()
                remaining_amount = await _sync_and_clamp_amount(original_sl, cached_bal=fresh_bal)
                if remaining_amount > 0:
                    logger.info(f"🔓 [Manual Smart Chase] Spot balance successfully unlocked: {remaining_amount}")
                    break
            except Exception as fb_err:
                logger.debug(f"Spot balance re-fetch error: {fb_err}")

    if is_futures and remaining_amount <= 0:
        logger.info(
            f"✅ [Manual Smart Chase] Position for {symbol} is already 0.0 before start. Terminating immediately."
        )
        return {'status': 'closed', 'id': 'position_already_closed', 'filled': sell_amount_raw}

    initial_notional = _calc_order_notional_usd(exchange, symbol, remaining_amount, original_sl)
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
        'chase_mode': chase_mode,
        'trigger_source': trigger_source,
        'peg_strategy': peg_strategy,
        'wall_multiplier': wall_multiplier,
        'cancel_event': cancel_event,
        'started_at': datetime.utcnow().isoformat()
    }

    chase_active = True
    attempts = 0
    reduce_only_rejections = 0
    final_res = None

    while chase_active:
        if cancel_event.is_set():
            logger.info(f"🛑 [Manual Smart Chase] Cancel signal detected before attempt {attempts + 1}. Aborting.")
            final_res = {'status': 'cancelled', 'id': 'user_stopped'}
            break

        if max_attempts > 0 and attempts >= max_attempts:
            break

        attempts += 1

        # 1. Fetch live orderbook (reuse pre-fetched cached_initial_ob for zero-wait execution on initial run and re-pegs!)
        current_price = original_sl
        ob = None
        if cached_initial_ob is not None:
            ob = cached_initial_ob
            cached_initial_ob = None
        else:
            try:
                ob = await exchange.fetch_order_book(symbol, limit=ob_depth_limit)
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
                ob = {'bids': [[best_bid, 1.0]], 'asks': [[best_ask, 1.0]]}
            except Exception:
                best_bid = original_sl
                best_ask = original_sl
                ob = {'bids': [[best_bid, 1.0]], 'asks': [[best_ask, 1.0]]}

        tick = _get_market_tick(exchange, symbol, current_price)

        # 2. Compute Maker Price according to chosen Strategy (BBO / Inside-Spread / Wall-Aware)
        target_maker_price = _calculate_target_maker_price(
            exit_side=exit_side,
            ob=ob,
            tick=tick,
            peg_strategy=peg_strategy,
            wall_multiplier=wall_multiplier,
            max_chase_price=max_chase_price,
            exchange=exchange,
            symbol=symbol
        )

        # Synchronize and clamp amount with live wallet balance before placing
        remaining_amount = await _sync_and_clamp_amount(target_maker_price)
        order_notional = _calc_order_notional_usd(exchange, symbol, remaining_amount, target_maker_price)
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
            params = {}
            if is_futures:
                if is_hedge_mode:
                    params['positionSide'] = 'LONG' if exit_side == 'sell' else 'SHORT'
                else:
                    params['reduceOnly'] = True

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

            sweep_notional = _calc_order_notional_usd(exchange, symbol, sweep_amt, target_maker_price)
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
        attempt_max_str = str(max_attempts) if max_attempts > 0 else '∞ (Continuous)'
        logger.info(
            f"⚡ [Manual Smart Chase] Attempt {attempts}/{attempt_max_str}: Sending Post-Only {exit_side.upper()} "
            f"for {remaining_amount} at {target_maker_price} (Orderbook: Bid={best_bid}, Ask={best_ask})"
        )
        ex_params = {'postOnly': True}
        if is_futures:
            if is_hedge_mode:
                ex_params['positionSide'] = 'LONG' if exit_side == 'sell' else 'SHORT'
                ex_params.pop('reduceOnly', None)
            else:
                ex_params['reduceOnly'] = True

        chase_res = None
        try:
            chase_res = await exchange.create_limit_order(
                symbol, exit_side, remaining_amount, target_maker_price, ex_params
            )
            if chase_res and str(chase_res.get('status', '')).lower() in ('expired', 'rejected', 'canceled', 'cancelled'):
                raise Exception(f"Post-Only GTX order returned status={chase_res.get('status')}")
        except Exception as place_e:
            err_str = str(place_e)
            is_postonly_rejection = (
                'immediately match' in err_str.lower()
                or '-5022' in err_str
                or (is_futures and '-2010' in err_str)
                or 'post only' in err_str.lower()
                or 'postonly' in err_str.lower()
                or 'post-only' in err_str.lower()
                or 'expired' in err_str.lower()
            )

            if is_postonly_rejection:
                logger.warning(
                    f"⚠️ [Manual Smart Chase] Post-Only rejected by exchange (spread crossed: {err_str}). "
                    f"Re-fetching book and retrying with safe maker buffer..."
                )
                chase_res = None
                try:
                    # Nudge 1 tick further away to ensure it rests as maker
                    fresh_ob = await exchange.fetch_order_book(symbol, limit=5)
                    f_bid = float(fresh_ob['bids'][0][0]) if fresh_ob.get('bids') else best_bid
                    f_ask = float(fresh_ob['asks'][0][0]) if fresh_ob.get('asks') else best_ask

                    if exit_side == "sell":
                        adj_price = f_ask + tick
                    else:
                        adj_price = f_bid - tick

                    if hasattr(exchange, 'price_to_precision') and getattr(exchange, 'markets', None) and symbol in exchange.markets:
                        adj_price = float(exchange.price_to_precision(symbol, adj_price))

                    # Re-sync amount for adjusted price
                    remaining_amount = await _sync_and_clamp_amount(adj_price)
                    adj_notional = remaining_amount * adj_price

                    if adj_notional >= min_notional and ((exit_side == "sell" and adj_price >= max_chase_price) or (exit_side == "buy" and adj_price <= max_chase_price)):
                        logger.info(f"🔄 Retrying with adjusted maker price {adj_price}...")
                        chase_res = await exchange.create_limit_order(
                            symbol, exit_side, remaining_amount, adj_price, ex_params
                        )
                        if chase_res and str(chase_res.get('status', '')).lower() not in ('expired', 'rejected', 'canceled', 'cancelled') and chase_res.get('id'):
                            target_maker_price = adj_price
                        else:
                            chase_res = None
                except Exception as retry_e:
                    logger.warning(f"⚠️ Adjusted Maker retry failed: {retry_e}")
                    chase_res = None
            elif '-2022' in err_str or '-4118' in err_str or 'reduceonly' in err_str.lower():
                reduce_only_rejections += 1
                logger.warning(
                    f"⚠️ [Manual Smart Chase] ReduceOnly rejection (-2022/-4118) #{reduce_only_rejections} on attempt {attempts}: {err_str}. "
                    f"Force clearing unlinked open orders on exchange and checking live position..."
                )
                await _cleanup_other_orders(scan_unlinked=True)
                if is_futures:
                    is_inv = _is_inverse_market(exchange, symbol)
                    live_pos = await _get_live_position_contracts(exchange, symbol, exit_side, is_inv)
                    if live_pos == 0.0:
                        logger.info(
                            f"✅ [Manual Smart Chase] Live position for {symbol} is 0.0 after ReduceOnly rejection. "
                            f"Position has already been closed/filled. Terminating Smart Chase."
                        )
                        final_res = {'status': 'closed', 'id': 'position_already_closed', 'filled': sell_amount_raw}
                        break
                    elif live_pos > 0.0 and live_pos < remaining_amount:
                        remaining_amount = float(exchange.amount_to_precision(symbol, live_pos)) if hasattr(exchange, 'amount_to_precision') else live_pos
                        logger.info(f"🔄 Re-clamped remaining amount to live position: {remaining_amount}")

                if reduce_only_rejections >= 3:
                    logger.error(
                        f"❌ [Manual Smart Chase] ReduceOnly rejected {reduce_only_rejections} times consecutively. "
                        f"Position likely closed or blocked by exchange. Aborting Smart Chase to prevent loop."
                    )
                    final_res = {'status': 'closed', 'id': 'reduce_only_aborted', 'filled': sell_amount_raw}
                    break

                await asyncio.sleep(0.2)
                continue
            elif not is_futures and ('insufficient' in err_str.lower() or '-2010' in err_str):
                logger.warning(
                    f"⚠️ [Manual Smart Chase] Spot balance not free (-2010/insufficient) on attempt {attempts}: {err_str}. "
                    f"Force clearing unlinked open orders on exchange and re-clamping balance..."
                )
                await _cleanup_other_orders(scan_unlinked=True)
                await asyncio.sleep(0.25)
                remaining_amount = await _sync_and_clamp_amount(target_maker_price, force_refresh=True)
                continue
            else:
                logger.warning(f"⚠️ [Manual Smart Chase] Order placement error on attempt {attempts}: {err_str}")

            if not chase_res or not chase_res.get('id'):
                # Check if position was closed externally
                if is_futures:
                    try:
                        is_inv = _is_inverse_market(exchange, symbol)
                        live_pos = await _get_live_position_contracts(exchange, symbol, exit_side, is_inv)
                        if live_pos == 0.0:
                            logger.info("✅ [Manual Smart Chase] Position already closed natively. Aborting Smart Chase.")
                            final_res = {'status': 'closed', 'id': 'position_already_closed', 'filled': sell_amount_raw}
                            break
                        elif live_pos > 0.0 and live_pos < remaining_amount:
                            remaining_amount = float(exchange.amount_to_precision(symbol, live_pos)) if hasattr(exchange, 'amount_to_precision') else live_pos
                    except Exception:
                        pass
                await asyncio.sleep(chase_delay_sec)
                continue

        if chase_res and chase_res.get('id'):
            order_id = chase_res['id']
            if cid in ACTIVE_SMART_CHASES:
                ACTIVE_SMART_CHASES[cid]['current_order_id'] = order_id
            logger.info(f"✅ [Manual Smart Chase] Order #{order_id} ACTIVE on exchange book at {target_maker_price} (Mode: {chase_mode.upper()})")

            user_cancelled = False
            repeg_triggered = False

            if chase_mode == 'dynamic_bbo':
                # ── DYNAMIC BBO PEGGING ENGINE (Order Book Shadowing with Queue Priority) ──
                # Actively monitors the orderbook top with FIFO Queue Priority protection.
                # Key rules:
                # 1. Minimum Resting Time: Every order rests at least min_resting_sec (default 1.2s - 2.5s)
                #    on the exchange book to gain FIFO queue priority before being cancelled.
                # 2. Directional One-Way Chase (Never run away from incoming fills!):
                #    - If BUY SL (Short Exit): When price drops towards our order (favorable), DO NOT CANCEL!
                #      Let sellers fill our resting bid. Only chase UP if sellers move higher away from us.
                #    - If SELL SL (Long Exit): When price rises towards our order (favorable), DO NOT CANCEL!
                #      Let buyers fill our resting ask. Only chase DOWN if buyers drop lower away from us.
                # 3. Fast Fill Detection: Checks order status frequently to capture fills immediately.
                peg_poll_interval = 0.25  # 250ms orderbook sampling
                min_resting_sec = max(1.2, min(chase_delay_sec, 2.5))  # Minimum 1.2s - 2.5s queue holding time
                max_peg_watch_time = max(15.0, chase_delay_sec * 5.0)  # Give resting order ample time (15s+) at Top-of-Book
                start_watch_time = asyncio.get_event_loop().time()
                latest_order_chk = None
                poll_count = 0

                while True:
                    if cancel_event.is_set():
                        user_cancelled = True
                        break

                    await asyncio.sleep(peg_poll_interval)
                    poll_count += 1

                    # Fast fill detection: check order status every ~0.75s (3 polls) to detect fills immediately
                    if poll_count % 3 == 0:
                        try:
                            chk_in_loop = await exchange.fetch_order(order_id, symbol)
                            if chk_in_loop.get('status', '').lower() in ['closed', 'filled']:
                                logger.info(f"✅ [Dynamic BBO Peg] Order #{order_id} filled detected during BBO shadow watch!")
                                latest_order_chk = chk_in_loop
                                break
                        except Exception as poll_chk_e:
                            logger.debug(f"Order poll check notice: {poll_chk_e}")

                    elapsed = asyncio.get_event_loop().time() - start_watch_time
                    if elapsed >= max_peg_watch_time:
                        logger.info(f"⏱️ [Dynamic BBO Peg] Order #{order_id} rested for {elapsed:.1f}s at Top-of-Book. Synchronizing...")
                        break

                    try:
                        latest_ob = await exchange.fetch_order_book(symbol, limit=ob_depth_limit)
                        if latest_ob and latest_ob.get('bids') and latest_ob.get('asks') and len(latest_ob['bids']) > 0 and len(latest_ob['asks']) > 0:
                            l_best_bid = float(latest_ob['bids'][0][0])
                            l_best_ask = float(latest_ob['asks'][0][0])
                            l_tick = _get_market_tick(exchange, symbol, l_best_bid)

                            # ── CIRCUIT BREAKER IN-LOOP CHECK ──
                            if (exit_side == "sell" and l_best_bid < max_chase_price) or (exit_side == "buy" and l_best_ask > max_chase_price):
                                logger.warning(
                                    f"🚨 [Dynamic BBO Peg] Circuit Breaker breached during orderbook watch! "
                                    f"Book: Bid={l_best_bid}, Ask={l_best_ask} vs Limit={max_chase_price}. Breaking to sweep immediately!"
                                )
                                break

                            new_maker_price = _calculate_target_maker_price(
                                exit_side=exit_side,
                                ob=latest_ob,
                                tick=l_tick,
                                peg_strategy=peg_strategy,
                                wall_multiplier=wall_multiplier,
                                max_chase_price=max_chase_price,
                                exchange=exchange,
                                symbol=symbol
                            )

                            # ── DIRECTIONAL CHASE RULE (Never run away from incoming fills!) ──
                            # For BUY SL: We only chase if the market moved UP (higher than our bid), leaving us behind.
                            # If market moved DOWN (lower than our bid), incoming market sellers will hit our bid! NEVER retreat!
                            # For SELL SL: We only chase if the market moved DOWN (lower than our ask), leaving us behind.
                            # If market moved UP (higher than our ask), incoming market buyers will hit our ask! NEVER retreat!
                            is_running_away = False
                            if exit_side == "buy":
                                if new_maker_price > target_maker_price:
                                    is_running_away = True
                            else:
                                if new_maker_price < target_maker_price:
                                    is_running_away = True

                            # If market moved away, only cancel after giving the order its minimum resting time (FIFO queue priority)
                            # Urgent exception: If market drifted by 3 or more ticks, re-peg immediately so we don't get left too far behind
                            drift_ticks = abs(new_maker_price - target_maker_price) / l_tick if l_tick > 0 else 1.0
                            is_urgent_drift = is_running_away and (drift_ticks >= 3.0)

                            if is_running_away and (elapsed >= min_resting_sec or is_urgent_drift):
                                logger.info(
                                    f"⚡ [Dynamic BBO Peg] Market shifted away: {target_maker_price} ➜ {new_maker_price} "
                                    f"(Bid={l_best_bid}, Ask={l_best_ask}) after {elapsed:.2f}s resting. Fast re-pegging to maintain maker priority..."
                                )
                                # ── CIRCUIT BREAKER PRE-CHECK ON NEW TARGET PRICE ──
                                if (exit_side == "sell" and new_maker_price < max_chase_price) or (exit_side == "buy" and new_maker_price > max_chase_price):
                                    logger.warning(
                                        f"🚨 [Dynamic BBO Peg] Circuit breaker breached on new target price {new_maker_price}! Sweeping market immediately!"
                                    )
                                    break

                                # ── PRIORITY 1: HIGH-SPEED NATIVE ATOMIC EDIT_ORDER (cancelReplace on Spot, PUT on Futures) ──
                                t_repeg_start = time.perf_counter()
                                native_repeg_ok = False

                                if getattr(exchange, 'has', {}).get('editOrder'):
                                    try:
                                        edit_res = await exchange.edit_order(
                                            order_id, symbol, 'limit', exit_side, remaining_amount, new_maker_price, ex_params
                                        )
                                        repeg_ms = int((time.perf_counter() - t_repeg_start) * 1000)
                                        if edit_res and edit_res.get('id'):
                                            old_oid = order_id
                                            order_id = str(edit_res.get('id'))
                                            target_maker_price = new_maker_price
                                            attempts += 1

                                            if cid in ACTIVE_SMART_CHASES:
                                                ACTIVE_SMART_CHASES[cid]['current_order_id'] = order_id
                                                ACTIVE_SMART_CHASES[cid]['current_maker_price'] = target_maker_price
                                                ACTIVE_SMART_CHASES[cid]['current_attempt'] = attempts

                                            logger.info(
                                                f"⚡ [Dynamic BBO Peg] Native atomic re-peg SUCCESS in {repeg_ms}ms! ⚡ "
                                                f"Order #{old_oid} ➜ #{order_id} at {target_maker_price} (Attempt {attempts}/{attempt_max_str})"
                                            )

                                            # Check if the new order was immediately filled upon replacement
                                            if str(edit_res.get('status', '')).lower() in ('closed', 'filled'):
                                                logger.info(f"🎯 [Dynamic BBO Peg] New order #{order_id} filled immediately upon replacement!")
                                                latest_order_chk = edit_res
                                                break

                                            start_watch_time = asyncio.get_event_loop().time()
                                            poll_count = 0
                                            native_repeg_ok = True

                                            if max_attempts > 0 and attempts >= max_attempts:
                                                logger.info(f"⚠️ [Dynamic BBO Peg] Max attempts ({max_attempts}) reached after re-peg.")
                                                break

                                            continue  # Stay right in BBO shadow loop! Zero delay!
                                    except Exception as edit_err:
                                        err_str = str(edit_err).lower()
                                        repeg_ms = int((time.perf_counter() - t_repeg_start) * 1000)

                                        # Fast check: If exchange reports order already closed/filled
                                        if any(kw in err_str for kw in ['filled', 'unknown order', '-2011', '-2013']):
                                            logger.info(f"✅ [Dynamic BBO Peg] Order #{order_id} filled or closed during edit ({edit_err}). Verifying fill status...")
                                            try:
                                                chk_fill = await exchange.fetch_order(order_id, symbol)
                                                if chk_fill.get('status', '').lower() in ['closed', 'filled']:
                                                    latest_order_chk = chk_fill
                                                    break
                                            except Exception:
                                                pass

                                        logger.info(f"Native editOrder fallback notice ({edit_err}) [{repeg_ms}ms], proceeding with zero-delay cancel+create")

                                # Fallback: Break to clean zero-delay cancel + create
                                repeg_triggered = True
                                cached_initial_ob = latest_ob  # Pre-cache for next attempt!
                                break
                    except Exception as ob_poll_e:
                        logger.debug(f"BBO poll non-fatal error: {ob_poll_e}")
            else:
                # Interval Timer Mode: Wait for full chase_delay_sec
                try:
                    await asyncio.wait_for(cancel_event.wait(), timeout=chase_delay_sec)
                    user_cancelled = True
                except asyncio.TimeoutError:
                    pass

            # Handle user cancellation
            if user_cancelled:
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

            # Check if order was filled or needs fallback cancellation
            try:
                chk = None
                if latest_order_chk and latest_order_chk.get('status', '').lower() in ['closed', 'filled']:
                    chk = latest_order_chk
                elif not repeg_triggered:
                    try:
                        chk = await exchange.fetch_order(order_id, symbol)
                    except Exception as f_err:
                        logger.debug(f"Fetch order check notice: {f_err}")

                status = chk.get('status', '').lower() if chk else ''

                if status in ['closed', 'filled']:
                    logger.info("✅ [Manual Smart Chase] Maker Limit Order filled successfully!")
                    final_res = chk

                    loss_pct = 0.0
                    pnl_val = 0.0
                    if entry_price > 0 and target_maker_price > 0:
                        if exit_side.lower() == 'sell':
                            loss_pct = (target_maker_price - entry_price) / entry_price * 100.0
                            pnl_val = (target_maker_price - entry_price) * float(remaining_amount)
                        else:
                            loss_pct = (entry_price - target_maker_price) / entry_price * 100.0
                            pnl_val = (entry_price - target_maker_price) * float(remaining_amount)

                    loss_str = f"{loss_pct:.2f}%" if loss_pct < 0 else f"+{loss_pct:.2f}%"
                    pnl_str = f"-${abs(pnl_val):,.2f} USDT" if pnl_val < 0 else f"+${pnl_val:,.2f} USDT"
                    close_action = "SELL (Close) 🔴" if exit_side.lower() == 'sell' else "BUY (Close) 🔴"
                    chase_strat = "Dynamic BBO Peg" if chase_mode == 'dynamic_bbo' else "Interval Chase"

                    msg = (
                        f"🛑 *TRADE COMPLETED: STOP-LOSS EXECUTED*\n"
                        f"━━━━━━━━━━━━━━━━━━━━\n"
                        f"• Pair: `{symbol}`\n"
                        f"• Exit Side: *{close_action}*\n"
                        f"• Amount: `{remaining_amount}`\n"
                        f"• Entry Price: `${entry_price:,.4f}`\n"
                        f"• Exit Price: `${target_maker_price:,.4f}`\n"
                        f"• Drawdown: `{loss_str}` ({pnl_str})\n"
                        f"• SL Method: `Smart Chase ({chase_strat} - Zero Slippage)`\n"
                        f"• Re-peg Attempts: `{attempts}`\n"
                        f"• Time: `{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}`\n\n"
                        f"⚠️ Capital Protected: Position closed according to risk plan."
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
                        logger.info(f"⚡ [Dynamic BBO Peg] Cancelled resting limit order #{order_id} in {c_ms}ms")
                    except Exception as cancel_e:
                        c_err = str(cancel_e).lower()
                        if any(kw in c_err for kw in ['filled', 'unknown order', '-2011', '-2013']):
                            was_already_filled = True
                            logger.info(f"✅ [Dynamic BBO Peg] Order #{order_id} was already filled before cancel: {cancel_e}")
                        else:
                            logger.debug(f"Cancel chase order error: {cancel_e}")

                    # If order was filled right before or during cancel:
                    if was_already_filled or (cancel_res and str(cancel_res.get('status', '')).lower() in ['closed', 'filled']):
                        try:
                            chk = await exchange.fetch_order(order_id, symbol)
                            if chk.get('status', '').lower() in ['closed', 'filled']:
                                final_res = chk
                                loss_pct = 0.0
                                pnl_val = 0.0
                                if entry_price > 0 and target_maker_price > 0:
                                    if exit_side.lower() == 'sell':
                                        loss_pct = (target_maker_price - entry_price) / entry_price * 100.0
                                        pnl_val = (target_maker_price - entry_price) * float(remaining_amount)
                                    else:
                                        loss_pct = (entry_price - target_maker_price) / entry_price * 100.0
                                        pnl_val = (entry_price - target_maker_price) * float(remaining_amount)
                                loss_str = f"{loss_pct:.2f}%" if loss_pct < 0 else f"+{loss_pct:.2f}%"
                                pnl_str = f"-${abs(pnl_val):,.2f} USDT" if pnl_val < 0 else f"+${pnl_val:,.2f} USDT"
                                close_action = "SELL (Close) 🔴" if exit_side.lower() == 'sell' else "BUY (Close) 🔴"
                                chase_strat = "Dynamic BBO Peg" if chase_mode == 'dynamic_bbo' else "Interval Chase"
                                msg = (
                                    f"🛑 *TRADE COMPLETED: STOP-LOSS EXECUTED*\n"
                                    f"━━━━━━━━━━━━━━━━━━━━\n"
                                    f"• Pair: `{symbol}`\n"
                                    f"• Exit Side: *{close_action}*\n"
                                    f"• Amount: `{remaining_amount}`\n"
                                    f"• Entry Price: `${entry_price:,.4f}`\n"
                                    f"• Exit Price: `${target_maker_price:,.4f}`\n"
                                    f"• Drawdown: `{loss_str}` ({pnl_str})\n"
                                    f"• SL Method: `Smart Chase ({chase_strat} - Zero Slippage)`\n"
                                    f"• Re-peg Attempts: `{attempts}`\n"
                                    f"• Time: `{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}`\n\n"
                                    f"⚠️ Capital Protected: Position closed according to risk plan."
                                )
                                await _send_notify(msg)
                                break
                        except Exception:
                            pass

                    # Check partial fill directly from atomic cancel response (0ms delay!)
                    try:
                        filled = 0.0
                        if isinstance(cancel_res, dict):
                            filled = float(cancel_res.get('filled') or cancel_res.get('info', {}).get('executedQty') or 0.0)
                        if filled > 0:
                            logger.info(f"🔄 Partial fill detected on cancel: {filled}")
                            remaining_amount = max(0.0, remaining_amount - filled)
                            if hasattr(exchange, 'amount_to_precision'):
                                try:
                                    remaining_amount = float(exchange.amount_to_precision(symbol, remaining_amount))
                                except Exception:
                                    pass
                            rem_val = _calc_order_notional_usd(exchange, symbol, remaining_amount, target_maker_price)
                            if remaining_amount <= 0 or rem_val < min_notional:
                                logger.info(
                                    f"✅ [Manual Smart Chase] Fully closed or remaining value ${rem_val:.2f} < Min Notional ${min_notional:.2f}. Dust prevented."
                                )
                                final_res = cancel_res or {'status': 'closed', 'id': order_id, 'filled': filled}
                                break
                    except Exception as chk_e:
                        logger.debug(f"Partial check failed: {chk_e}")

            except Exception as chk_err:
                logger.error(f"Error checking order status: {chk_err}")
                await asyncio.sleep(0.25)
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
        params = {}
        if is_futures:
            if is_hedge_mode:
                params['positionSide'] = 'LONG' if exit_side == 'sell' else 'SHORT'
            else:
                params['reduceOnly'] = True

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
