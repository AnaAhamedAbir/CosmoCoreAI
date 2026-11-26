"""
Bracket Order Service
=====================
Entry order fill হওয়ার পর স্বয়ংক্রিয়ভাবে opposite Take-Profit order place করে।
Background asyncio task হিসেবে চলে — main request কে block করে না।

Fixes applied:
  BUG-03: passphrase empty string guard
  BUG-07: Telegram notification after TP placed (uses own DB session)
  BUG-10: Proper partial fill handling at timeout
"""

import time
import asyncio
import logging
from decimal import Decimal
from typing import Optional
from app.services.exchange_pool import get_or_create_exchange
try:
    from app.services.exchange_pool import is_ws_api_ready
except ImportError:
    def is_ws_api_ready(exchange, is_futures: bool = False, is_inverse: bool = False) -> bool:
        return True
from app.core.security import decrypt_key
from app.services.notification import NotificationService

import uuid
from fastapi import HTTPException

logger = logging.getLogger(__name__)

class BracketOrderService:
    ACTIVE_SOFTWARE_SL = {}  # { sl_id: { symbol, side, amount, trigger_price, mode } }
    KNOWN_TP_ORDER_IDS = set()  # Set of exchange order IDs placed as Attached Take-Profit orders
    ENTRY_BRACKET_LOCKS = {}  # { entry_order_id: asyncio.Lock } to serialize partial-fill chunks of the same entry order
    ACTIVE_ENTRY_BRACKETS = {}  # { entry_order_id: { tp_order_id, amount, entry_price, symbol, side, api_key_id } }
    ACTIVE_ENTRY_MONITORS = {}  # { entry_order_id: { symbol, api_key_id, cancelled } }

    @staticmethod
    async def _fetch_ticker_fast(exchange, symbol: str, require_last: bool = False) -> dict:
        """Read Redis @bookTicker/@trade cache (~1ms, 0 REST weight) with seamless REST fallback."""
        try:
            from app.services.smart_peg_entry_executor import _fetch_ticker_fast
            return await _fetch_ticker_fast(exchange, symbol, require_last=require_last)
        except Exception:
            return await exchange.fetch_ticker(symbol)

    @staticmethod
    def _get_sl_param(sl_config: dict, snake_key: str, camel_key: str, default_val):
        if not sl_config or not isinstance(sl_config, dict):
            return default_val
        val = sl_config.get(snake_key)
        if val is not None and val != '':
            return val
        val = sl_config.get(camel_key)
        if val is not None and val != '':
            return val
        return default_val

    @staticmethod
    def _compute_tp_price(tp_config: dict, ref_price: float, opposite_side: str) -> float:
        """Compute absolute Take-Profit price from tp_config ('percentage', 'absolute', or 'price' offset)."""
        if not tp_config or not isinstance(tp_config, dict):
            return 0.0
        mode = str(tp_config.get('mode', 'percentage')).lower()
        try:
            val = float(tp_config.get('value', 0) or 0.0)
        except (ValueError, TypeError):
            return 0.0
        if mode == 'percentage':
            pct = val / 100.0
            return ref_price * (1 + pct) if opposite_side == 'sell' else ref_price * (1 - pct)
        if mode == 'absolute':
            return val
        return ref_price + val if opposite_side == 'sell' else ref_price - val

    @staticmethod
    def _compute_sl_price(sl_config: dict, ref_price: float, opposite_side: str) -> float:
        """Compute absolute Stop-Loss trigger price from sl_config ('percentage', 'absolute', or 'price' offset)."""
        if not sl_config or not isinstance(sl_config, dict):
            return 0.0
        sl_mode = str(sl_config.get('mode', 'percentage')).lower()
        if sl_mode == 'atr':
            return 0.0
        try:
            sl_val = float(sl_config.get('value', 0) or 0.0)
        except (ValueError, TypeError):
            return 0.0
        if sl_val <= 0:
            return 0.0
        if sl_mode == 'percentage':
            pct = sl_val / 100.0
            return ref_price * (1 - pct) if opposite_side == 'sell' else ref_price * (1 + pct)
        if sl_mode == 'absolute':
            return sl_val
        return ref_price - sl_val if opposite_side == 'sell' else ref_price + sl_val

    @staticmethod
    def _safe_amount_to_precision(exchange, symbol: str, amount: float) -> float:
        """Safely formats amount using exchange market precision, with fallback if markets are unloaded."""
        try:
            val = float(amount)
        except (ValueError, TypeError):
            return 0.0
        if val <= 0:
            return 0.0
        # Normalize IEEE-754 binary float dust (e.g. 0.009 - 0.005 = 0.003999999999999999 -> 0.004)
        # before CCXT's TRUNCATE-mode amount_to_precision floors away an entire lot step!
        try:
            val = float(Decimal(f"{val:.12g}"))
        except Exception:
            pass
        try:
            if exchange and getattr(exchange, 'markets', None) and symbol in exchange.markets:
                return float(exchange.amount_to_precision(symbol, val))
        except Exception as e:
            logger.debug(f"_safe_amount_to_precision fallback for {symbol}: {e}")
        if ':' in symbol:
            parts = symbol.split('/')
            base = parts[0] if parts else ''
            settle = parts[1].split(':')[1] if (len(parts) > 1 and ':' in parts[1]) else ''
            if base and settle and base.upper() == settle.upper():
                return float(max(1, round(val)))
        return float(round(val, 6))

    @staticmethod
    def _safe_price_to_precision(exchange, symbol: str, price: float) -> float:
        """Safely formats price using exchange market precision, with smart decimal fallback if markets are unloaded."""
        try:
            val = float(price)
        except (ValueError, TypeError):
            return 0.0
        if val <= 0:
            return 0.0
        try:
            if exchange and getattr(exchange, 'markets', None) and symbol in exchange.markets:
                return float(exchange.price_to_precision(symbol, val))
        except Exception as e:
            logger.debug(f"_safe_price_to_precision fallback for {symbol}: {e}")
        if val >= 1000:
            return float(round(val, 2))
        if val >= 1:
            return float(round(val, 4))
        if val >= 0.01:
            return float(round(val, 5))
        if val >= 0.0001:
            return float(round(val, 6))
        return float(round(val, 8))

    @staticmethod
    def _resolve_native_futures_symbol(exchange, symbol: str, is_inverse: bool = False) -> str:
        """Resolves unified CCXT symbol (e.g. DOGE/USDC:USDC or DOGE/USD:DOGE) to native Binance symbol ID."""
        try:
            if exchange and getattr(exchange, 'markets', None) and symbol in exchange.markets:
                mkt_id = exchange.markets[symbol].get('id')
                if mkt_id:
                    return str(mkt_id)
        except Exception:
            pass
        clean = str(symbol).split(':')[0].replace('/', '').upper()
        if is_inverse and not clean.endswith('_PERP'):
            return f"{clean}_PERP"
        return clean

    @staticmethod
    async def _fetch_futures_order_universal(exchange, order_id: str, symbol: str, is_conditional: bool = False) -> dict:
        """
        Fetches a Futures order across both standard (/fapi/v1/order or /dapi/v1/order) and
        conditional/algo (/fapi/v1/algoOrder) endpoints so STOP_MARKET / TAKE_PROFIT_MARKET /
        TRAILING_STOP_MARKET orders never fail with -2013.
        On COIN-M (inverse), all orders live on standard /dapi/v1/order.
        """
        if not exchange or not order_id:
            return {}
        oid_str = str(order_id)
        is_inverse = False
        try:
            if getattr(exchange, 'markets', None) and symbol in exchange.markets:
                mkt = exchange.markets[symbol]
                is_inverse = bool(mkt.get('inverse') or mkt.get('subType') == 'inverse')
            elif ':' in str(symbol or ''):
                parts = str(symbol).split('/')
                if len(parts) > 1 and ':' in parts[1]:
                    is_inverse = (parts[0].upper() == parts[1].split(':')[1].upper())
        except Exception:
            pass

        if is_conditional and not is_inverse:
            try:
                return await exchange.fetch_order(oid_str, symbol, params={'stop': True})
            except Exception:
                return await exchange.fetch_order(oid_str, symbol)
        else:
            try:
                return await exchange.fetch_order(oid_str, symbol)
            except Exception:
                return await exchange.fetch_order(oid_str, symbol, params={'stop': True})

    @staticmethod
    async def _place_futures_conditional_order(
        exchange,
        symbol: str,
        order_type: str,
        side: str,
        amount: float,
        stop_price: float = None,
        callback_rate: float = None,
        extra_params: dict = None
    ) -> dict:
        """
        Bullet-proof placement for Futures conditional orders (STOP_MARKET, TAKE_PROFIT_MARKET, TRAILING_STOP_MARKET).
        Bypasses CCXT 4.5.76's broken `create_order_ws` (which leaks `stopPrice` into `algoOrder.place`),
        tries standard REST `exchange.create_order`, and automatically falls back to raw Binance
        `fapiPrivatePostAlgoOrder` / `fapiPrivatePostOrder` / `dapiPrivatePostOrder` if needed.
        """
        if not getattr(exchange, 'markets', None):
            try:
                await asyncio.wait_for(exchange.load_markets(), timeout=6.0)
            except Exception:
                pass

        is_inverse = False
        try:
            if getattr(exchange, 'markets', None) and symbol in exchange.markets:
                mkt = exchange.markets[symbol]
                is_inverse = bool(mkt.get('inverse') or mkt.get('subType') == 'inverse')
            elif ':' in symbol:
                parts = symbol.split('/')
                base = parts[0]
                settle = parts[1].split(':')[1] if ':' in parts[1] else ''
                if settle.upper() == base.upper():
                    is_inverse = True
        except Exception:
            pass

        prec_amount = BracketOrderService._safe_amount_to_precision(exchange, symbol, amount)
        prec_stop = BracketOrderService._safe_price_to_precision(exchange, symbol, stop_price) if stop_price is not None else None
        stop_str = None
        if prec_stop is not None:
            try:
                if getattr(exchange, 'markets', None) and symbol in exchange.markets and hasattr(exchange, 'price_to_precision'):
                    stop_str = str(exchange.price_to_precision(symbol, prec_stop))
            except Exception:
                stop_str = None
            if not stop_str:
                stop_str = f"{float(prec_stop):.8f}".rstrip('0').rstrip('.') or "0"

        params = dict(extra_params or {})
        if prec_stop is not None:
            params['stopPrice'] = prec_stop
        if callback_rate is not None:
            params['callbackRate'] = callback_rate

        last_err = None

        # Tier 1: Standard CCXT REST create_order (for Linear Swap uses fapiPrivatePostAlgoOrder cleanly)
        if not is_inverse:
            try:
                res = await exchange.create_order(symbol, order_type, side, prec_amount, None, dict(params))
                if res and res.get('id'):
                    return res
            except Exception as e1:
                last_err = e1
                logger.warning(f"⚠️ [Futures Conditional] Tier-1 create_order({order_type}) failed for {symbol}: {e1}")

        # Tier 2: Direct Binance fapiPrivatePostAlgoOrder (USDⓈ-M Linear Conditional Algo Endpoint)
        native_sym = BracketOrderService._resolve_native_futures_symbol(exchange, symbol, is_inverse=is_inverse)
        if not is_inverse and hasattr(exchange, 'fapiPrivatePostAlgoOrder'):
            try:
                algo_req = {
                    'algoType': 'CONDITIONAL',
                    'symbol': native_sym,
                    'side': side.upper(),
                    'type': order_type.upper(),
                    'quantity': str(prec_amount),
                }
                if stop_str is not None:
                    algo_req['triggerPrice'] = stop_str
                if callback_rate is not None:
                    algo_req['callbackRate'] = str(callback_rate)
                if params.get('positionSide'):
                    algo_req['positionSide'] = str(params['positionSide']).upper()
                elif params.get('reduceOnly'):
                    algo_req['reduceOnly'] = 'true'

                raw_algo = await exchange.fapiPrivatePostAlgoOrder(algo_req)
                algo_id = raw_algo.get('algoId') or raw_algo.get('orderId')
                if algo_id:
                    logger.info(f"✅ [Futures Conditional] Tier-2 fapiPrivatePostAlgoOrder({order_type}) succeeded! ID: {algo_id}")
                    return {'id': str(algo_id), 'info': raw_algo, 'status': 'open'}
            except Exception as e2:
                last_err = e2
                logger.warning(f"⚠️ [Futures Conditional] Tier-2 fapiPrivatePostAlgoOrder({order_type}) failed for {symbol}: {e2}")

        # Tier 3: Direct Binance Standard Order Endpoint (dapiPrivatePostOrder for COIN-M / fapiPrivatePostOrder fallback)
        post_method_name = 'dapiPrivatePostOrder' if is_inverse else 'fapiPrivatePostOrder'
        post_method = getattr(exchange, post_method_name, None)
        if post_method and callable(post_method):
            try:
                std_req = {
                    'symbol': native_sym,
                    'side': side.upper(),
                    'type': order_type.upper(),
                    'quantity': str(int(prec_amount)) if is_inverse else str(prec_amount),
                }
                if stop_str is not None:
                    std_req['stopPrice'] = stop_str
                if callback_rate is not None:
                    std_req['callbackRate'] = str(callback_rate)
                if params.get('positionSide'):
                    std_req['positionSide'] = str(params['positionSide']).upper()
                elif params.get('reduceOnly'):
                    std_req['reduceOnly'] = 'true'

                raw_std = await post_method(std_req)
                std_id = raw_std.get('orderId') or raw_std.get('algoId')
                if std_id:
                    logger.info(f"✅ [Futures Conditional] Tier-3 {post_method_name}({order_type}) succeeded! ID: {std_id}")
                    return {'id': str(std_id), 'info': raw_std, 'status': 'open'}
            except Exception as e3:
                last_err = e3
                logger.warning(f"⚠️ [Futures Conditional] Tier-3 {post_method_name}({order_type}) failed for {symbol}: {e3}")

        # Tier 4: Final attempt via CCXT create_order if inverse skipped Tier 1
        if is_inverse:
            try:
                res = await exchange.create_order(symbol, order_type, side, prec_amount, None, dict(params))
                if res and res.get('id'):
                    return res
            except Exception as e4:
                last_err = e4

        raise last_err or RuntimeError(f"Failed to place {order_type} conditional order for {symbol}")

    _HEDGE_MODE_CACHE = {}  # { cache_key: (is_hedge, expire_timestamp) }

    @staticmethod
    async def _apply_futures_exit_params(exchange, symbol: str, exit_side: str, base_params: dict = None) -> dict:
        """
        Futures exit orders (TP, SL, Disaster SL, Trailing SL) er jonno Binance Hedge Mode
        ebong One-Way Mode onujayi sothik params (positionSide vs reduceOnly) set kore.
        Uses ManualTradeService._is_binance_hedge_mode RAM cache (0ms) instead of uncached REST calls.
        """
        params = dict(base_params or {})
        is_futures = ':' in symbol
        if not is_futures:
            return params

        ex_id = getattr(exchange, 'id', '').lower()
        if ex_id.startswith('binance'):
            is_inverse = False
            try:
                if hasattr(exchange, 'markets') and exchange.markets and symbol in exchange.markets:
                    mkt = exchange.markets[symbol]
                    is_inverse = bool(mkt.get('inverse') or mkt.get('subType') == 'inverse')
                elif ':' in symbol:
                    parts = symbol.split('/')
                    base = parts[0]
                    settle = parts[1].split(':')[1] if ':' in parts[1] else ''
                    if settle.upper() == base.upper():
                        is_inverse = True
            except Exception:
                pass

            is_hedge_mode = False
            try:
                from app.services.manual_trade_service import ManualTradeService
                is_hedge_mode = await ManualTradeService._is_binance_hedge_mode(
                    exchange, symbol, is_inverse=is_inverse
                )
            except Exception:
                cache_key = f"{getattr(exchange, 'apiKey', '')}_{is_inverse}"
                now = time.time()
                cached_h = BracketOrderService._HEDGE_MODE_CACHE.get(cache_key)
                if cached_h and now < cached_h[1]:
                    is_hedge_mode = cached_h[0]
                else:
                    methods = (
                        ['dapiPrivateGetPositionSideDual', 'fapiPrivateGetPositionSideDual']
                        if is_inverse else
                        ['fapiPrivateGetPositionSideDual', 'dapiPrivateGetPositionSideDual']
                    )
                    for m_name in methods:
                        m = getattr(exchange, m_name, None)
                        if m and callable(m):
                            try:
                                res = await m()
                                is_hedge_mode = bool(res.get('dualSidePosition', False))
                                BracketOrderService._HEDGE_MODE_CACHE[cache_key] = (is_hedge_mode, now + 3600)
                                break
                            except Exception:
                                pass

            if is_hedge_mode:
                params['positionSide'] = 'LONG' if exit_side.lower() == 'sell' else 'SHORT'
                params.pop('reduceOnly', None)
                return params

        params['reduceOnly'] = True
        return params

    @staticmethod
    async def _check_futures_position_is_open(exchange, symbol: str, opposite_side: str = None) -> bool:
        """
        Checks if the live futures position for the symbol is still open (> 0 contracts).
        Handles both Linear (USDT-M) and Inverse (COIN-M) markets as well as Hedge Mode.
        Returns False if position contracts == 0, True if > 0 or if check fails (failsafe).
        """
        try:
            is_inverse = False
            if hasattr(exchange, 'markets') and exchange.markets and symbol in exchange.markets:
                mkt = exchange.markets[symbol]
                is_inverse = bool(mkt.get('inverse') or mkt.get('subType') == 'inverse')
            elif ':' in symbol:
                parts = symbol.split('/')
                base = parts[0]
                settle = parts[1].split(':')[1] if ':' in parts[1] else ''
                if settle.upper() == base.upper():
                    is_inverse = True

            clean_sym = str(symbol).split(':')[0].upper().replace('/', '')
            native_sym = BracketOrderService._resolve_native_futures_symbol(exchange, symbol, is_inverse=is_inverse)
            expected_hedge_side = ('LONG' if opposite_side.lower() == 'sell' else 'SHORT') if opposite_side else None

            # Fast & reliable direct Binance positionRisk check (does not require load_markets or leverageBrackets)
            ex_id = getattr(exchange, 'id', '').lower()
            if ex_id.startswith('binance'):
                try:
                    raw_positions = None
                    if is_inverse and hasattr(exchange, 'dapiPrivateGetPositionRisk'):
                        raw_positions = await exchange.dapiPrivateGetPositionRisk({'pair': clean_sym})
                    elif not is_inverse and hasattr(exchange, 'fapiPrivateV2GetPositionRisk'):
                        raw_positions = await exchange.fapiPrivateV2GetPositionRisk({'symbol': native_sym})
                    elif not is_inverse and hasattr(exchange, 'fapiPrivateV3GetPositionRisk'):
                        raw_positions = await exchange.fapiPrivateV3GetPositionRisk({'symbol': native_sym})

                    if isinstance(raw_positions, list) and len(raw_positions) > 0:
                        matched_record = False
                        for rp in raw_positions:
                            rp_sym = str(rp.get('symbol', '')).replace('_', '').upper()
                            if rp_sym == clean_sym or clean_sym in rp_sym:
                                pos_side = str(rp.get('positionSide') or 'BOTH').upper()
                                if expected_hedge_side and pos_side in ['LONG', 'SHORT'] and pos_side != expected_hedge_side:
                                    continue
                                matched_record = True
                                pos_amt = float(rp.get('positionAmt') or 0.0)
                                if abs(pos_amt) > 0:
                                    return True
                        if matched_record:
                            return False
                except Exception as direct_pos_err:
                    logger.debug(f"Direct positionRisk check fallback for {symbol}: {direct_pos_err}")

            pos_params = {'subType': 'inverse'} if is_inverse else {}
            positions = await exchange.fetch_positions([symbol], pos_params)
            if not positions:
                return False

            matching_pos_found = False
            for p in positions:
                p_sym = str(p.get('symbol', '')).split(':')[0].upper().replace('/', '')
                info_sym = str(p.get('info', {}).get('symbol', '')).replace('_', '').upper()
                if p_sym == clean_sym or clean_sym in info_sym:
                    if expected_hedge_side:
                        pos_side = str(p.get('info', {}).get('positionSide') or p.get('side') or '').upper()
                        if pos_side in ['LONG', 'SHORT'] and pos_side != expected_hedge_side:
                            continue

                    matching_pos_found = True
                    raw_contracts = float(p.get('contracts', 0) or p.get('info', {}).get('positionAmt', 0))
                    if abs(raw_contracts) > 0:
                        return True

            if matching_pos_found:
                return False
            return False
        except Exception as pos_e:
            logger.debug(f"Position check non-fatal error: {pos_e}")
            return True

    @staticmethod
    async def _send_entry_filled_notification(
        user_id: int, symbol: str, side: str, filled: float, total_amount: float, average_price: float, is_futures: bool
    ):
        """Sends formatted Entry Limit Order Filled alert to Telegram."""
        if not user_id:
            return
        from app.db.session import SessionLocal
        from app.services.notification import NotificationService

        db = SessionLocal()
        try:
            side_upper = side.upper()
            side_icon = "🟢" if side_upper in ("BUY", "LONG") else "🔴"
            fill_pct = (filled / total_amount * 100.0) if total_amount > 0 else 100.0
            total_val = float(filled) * float(average_price) if average_price > 0 else 0.0

            msg = (
                f"📥 *ENTRY ORDER FILLED!*\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"• Pair: `{symbol}`\n"
                f"• Side: *{side_upper}* {side_icon}\n"
                f"• Filled: `{filled} / {total_amount}` ({fill_pct:.1f}%)\n"
                f"• Avg Fill Price: `${average_price:,.4f}`\n"
                f"• Total Value: ~${total_val:,.2f}\n\n"
                f"⚡ Take-Profit & Stop-Loss brackets are now ACTIVE & Monitoring!"
            )
            await NotificationService.send_message(db, user_id, msg, parse_mode="Markdown", alert_type="alert_manual_trade")
        except Exception as e:
            logger.warning(f"Failed to send entry fill notification: {e}")
        finally:
            db.close()

    @staticmethod
    async def _send_tp_completed_notification(
        user_id: int,
        symbol: str,
        opposite_side: str,
        amount: float,
        entry_price: float,
        exit_price: float
    ):
        """Sends formatted Take-Profit Hit / Trade Complete alert to Telegram."""
        if not user_id:
            return
        from app.db.session import SessionLocal
        from app.services.notification import NotificationService

        db = SessionLocal()
        try:
            gain_pct = 0.0
            pnl_val = 0.0
            if entry_price > 0 and exit_price > 0:
                if opposite_side.lower() == 'sell': # Long position closed
                    gain_pct = (exit_price - entry_price) / entry_price * 100.0
                    pnl_val = (exit_price - entry_price) * float(amount)
                else: # Short position closed
                    gain_pct = (entry_price - exit_price) / entry_price * 100.0
                    pnl_val = (entry_price - exit_price) * float(amount)

            gain_str = f"+{gain_pct:.2f}% 📈" if gain_pct >= 0 else f"{gain_pct:.2f}% 📉"
            pnl_str = f"+${pnl_val:,.2f} USDT 💰" if pnl_val >= 0 else f"-${abs(pnl_val):,.2f} USDT"
            exit_price_str = f"${exit_price:,.4f}" if exit_price > 0 else "Target Price"
            entry_price_str = f"${entry_price:,.4f}" if entry_price > 0 else "N/A"

            close_action = "SELL / CLOSE LONG 🟢" if opposite_side.lower() == 'sell' else "BUY / CLOSE SHORT 🟢"

            msg = (
                f"🏆 *TRADE COMPLETED: TAKE-PROFIT HIT!* 🎯\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"• Pair: `{symbol}`\n"
                f"• Closed Side: *{close_action}*\n"
                f"• Closed Amount: `{amount}`\n"
                f"• Entry Price: `{entry_price_str}`\n"
                f"• Exit Price: `{exit_price_str}`\n"
                f"• Price Gain: *{gain_str}*\n"
                f"• Est. Net Profit: *{pnl_str}*\n\n"
                f"✅ Target achieved successfully! Position fully closed."
            )
            await NotificationService.send_message(db, user_id, msg, parse_mode="Markdown", alert_type="alert_manual_trade")
        except Exception as e:
            logger.warning(f"Failed to send TP completion notification: {e}")
        finally:
            db.close()

    @staticmethod
    async def _send_sl_completed_notification(
        user_id: int,
        symbol: str,
        opposite_side: str,
        amount: float,
        entry_price: float,
        exit_price: float,
        sl_method: str = "Fixed Stop-Loss"
    ):
        """Sends formatted Stop-Loss Executed / Trade Complete alert to Telegram."""
        if not user_id:
            return
        from app.db.session import SessionLocal
        from app.services.notification import NotificationService

        db = SessionLocal()
        try:
            loss_pct = 0.0
            pnl_val = 0.0
            if entry_price > 0 and exit_price > 0:
                if opposite_side.lower() == 'sell':
                    loss_pct = (exit_price - entry_price) / entry_price * 100.0
                    pnl_val = (exit_price - entry_price) * float(amount)
                else:
                    loss_pct = (entry_price - exit_price) / entry_price * 100.0
                    pnl_val = (entry_price - exit_price) * float(amount)

            loss_str = f"{loss_pct:.2f}%" if loss_pct < 0 else f"+{loss_pct:.2f}%"
            pnl_str = f"-${abs(pnl_val):,.2f} USDT" if pnl_val < 0 else f"+${pnl_val:,.2f} USDT"
            exit_price_str = f"${exit_price:,.4f}" if exit_price > 0 else "Market Price"
            entry_price_str = f"${entry_price:,.4f}" if entry_price > 0 else "N/A"

            close_action = "SELL (Close) 🔴" if opposite_side.lower() == 'sell' else "BUY (Close) 🔴"

            msg = (
                f"🛑 *TRADE COMPLETED: STOP-LOSS EXECUTED*\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"• Pair: `{symbol}`\n"
                f"• Exit Side: *{close_action}*\n"
                f"• Amount: `{amount}`\n"
                f"• Entry Price: `{entry_price_str}`\n"
                f"• Exit Price: `{exit_price_str}`\n"
                f"• Drawdown: `{loss_str}` ({pnl_str})\n"
                f"• SL Method: `{sl_method}`\n\n"
                f"⚠️ Capital Protected: Position closed according to risk plan."
            )
            await NotificationService.send_message(db, user_id, msg, parse_mode="Markdown", alert_type="alert_manual_trade")
        except Exception as e:
            logger.warning(f"Failed to send SL completion notification: {e}")
        finally:
            db.close()

    @staticmethod
    async def _send_breakeven_notification(
        user_id: int,
        symbol: str,
        entry_price: float,
        current_price: float,
        target_be: float,
        profit_pct: float
    ):
        """Sends formatted Auto-Breakeven alert to Telegram."""
        if not user_id:
            return
        from app.db.session import SessionLocal
        from app.services.notification import NotificationService

        db = SessionLocal()
        try:
            msg = (
                f"🛡️ *SL MOVED TO BREAK-EVEN!*\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"• Pair: `{symbol}`\n"
                f"• Entry Price: `${entry_price:,.4f}`\n"
                f"• Current Price: `${current_price:,.4f}` (+{profit_pct:.2f}% Profit)\n"
                f"• New Protected SL: `${target_be:,.4f}` (Fees Covered)\n\n"
                f"🎉 Trade is now 100% RISK-FREE! কোনো লস হওয়ার সুযোগ নেই।"
            )
            await NotificationService.send_message(db, user_id, msg, parse_mode="Markdown", alert_type="alert_manual_trade")
        except Exception as e:
            logger.warning(f"Failed to send Breakeven notification: {e}")
        finally:
            db.close()
    @staticmethod
    async def _send_order_cancelled_notification(
        user_id: int, symbol: str, side: str, status: str, processed_amount: float, total_amount: float
    ):
        """Sends formatted Order Cancelled / Expired alert to Telegram."""
        if not user_id:
            return
        from app.db.session import SessionLocal
        from app.services.notification import NotificationService

        db = SessionLocal()
        try:
            side_upper = side.upper()
            side_icon = "🟢" if side_upper in ("BUY", "LONG") else "🔴"
            msg = (
                f"⚠️ *ENTRY ORDER CANCELLED / EXPIRED*\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"• Pair: `{symbol}`\n"
                f"• Side: *{side_upper}* {side_icon}\n"
                f"• Status: `{status.upper()}`\n"
                f"• Filled before cancel: `{processed_amount} / {total_amount}`\n\n"
                f"ℹ️ Order lifecycle has ended on the exchange."
            )
            await NotificationService.send_message(db, user_id, msg, parse_mode="Markdown", alert_type="alert_manual_trade")
        except Exception as e:
            logger.warning(f"Failed to send order cancelled notification: {e}")
        finally:
            db.close()

    @staticmethod
    async def _send_bracket_failure_alert(user_id: int, symbol: str, order_kind: str, error_msg: str):
        """Sends urgent alert to Telegram if a TP or SL bracket order could not be placed on the exchange."""
        if not user_id:
            return
        from app.db.session import SessionLocal
        from app.services.notification import NotificationService
        db = SessionLocal()
        try:
            msg = (
                f"🚨 *CRITICAL: BRACKET {order_kind.upper()} PLACEMENT FAILED!* 🚨\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"• Pair: `{symbol}`\n"
                f"• Target Order: *{order_kind}*\n"
                f"• Exchange Rejection: `{error_msg}`\n\n"
                f"⚠️ *ACTION REQUIRED:* আপনার পজিশনটি এই মুহূর্তে {order_kind} ছাড়াই ওপেন রয়েছে! অনাকাঙ্ক্ষিত লস এড়াতে অবিলম্বে এক্সচেঞ্জে (Binance) গিয়ে ম্যানুয়ালি {order_kind} সেট করুন।"
            )
            await NotificationService.send_message(db, user_id, msg, parse_mode="Markdown", alert_type="alert_manual_trade")
        except Exception as notify_err:
            logger.warning(f"Failed to send bracket failure alert: {notify_err}")
        finally:
            db.close()

    @staticmethod
    async def monitor_native_otoco(
        exchange, symbol: str, side: str, amount: float, entry_price: float,
        raw_res: dict, user_id: int, api_key_id: Optional[int] = None,
        monitor_id: Optional[str] = None,
        skip_entry_fill_notify: bool = False,
    ):
        """
        Monitors Binance Native Spot OTO/OTOCO order list.
        Sends Telegram notifications for Entry fill, TP fill, or SL fill.
        """
        if not user_id:
            return
        mid = None
        try:
            from app.services.manual_trade_persistence import (
                schedule_mark_terminal,
                schedule_update_monitor,
                schedule_upsert_monitor,
            )

            order_list = raw_res.get('orderReports', [])
            side_up = str(side or '').upper()
            working_order = next(
                (o for o in order_list if str(o.get('side', '')).upper() == side_up and str(o.get('status', '')).upper() != 'PENDING_NEW'),
                None
            )
            if not working_order:
                working_order = next((o for o in order_list if o.get('type') in ('LIMIT', 'LIMIT_MAKER')), None)
            tp_order = next((o for o in order_list if o is not working_order and o.get('type') in ('LIMIT', 'LIMIT_MAKER')), None)
            sl_order = next((o for o in order_list if o is not working_order and 'STOP' in str(o.get('type', ''))), None)

            working_id = working_order.get('orderId') if working_order else None
            tp_id = tp_order.get('orderId') if tp_order else None
            sl_id = sl_order.get('orderId') if sl_order else None
            opposite_side = 'sell' if side.lower() == 'buy' else 'buy'

            mid = monitor_id or f"otoco:{working_id or tp_id or sl_id or raw_res.get('orderListId', '')}"
            if api_key_id and mid and mid != "otoco:":
                schedule_upsert_monitor(
                    monitor_id=mid,
                    kind="native_otoco",
                    user_id=user_id,
                    api_key_id=api_key_id,
                    symbol=symbol,
                    is_futures=False,
                    side=side,
                    status="monitoring",
                    amount=float(amount or 0.0),
                    entry_price=float(entry_price or 0.0),
                    entry_order_id=str(working_id) if working_id else None,
                    tp_order_id=str(tp_id) if tp_id else None,
                    config={"raw_res": raw_res},
                )

            # 1. Wait for working entry order to fill
            if working_id:
                for _ in range(600):
                    await asyncio.sleep(2)
                    try:
                        chk = await exchange.fetch_order(str(working_id), symbol)
                        st = chk.get('status', '').lower()
                        if st in ('closed', 'filled'):
                            if mid:
                                schedule_update_monitor(mid, config_patch={'working_filled': True})
                            if not skip_entry_fill_notify:
                                fill_p = float(chk.get('average') or chk.get('price') or entry_price)
                                await BracketOrderService._send_entry_filled_notification(
                                    user_id=user_id,
                                    symbol=symbol,
                                    side=side,
                                    filled=amount,
                                    total_amount=amount,
                                    average_price=fill_p,
                                    is_futures=False
                                )
                            break
                        elif st in ('canceled', 'cancelled', 'expired', 'rejected'):
                            await BracketOrderService._send_order_cancelled_notification(
                                user_id=user_id,
                                symbol=symbol,
                                side=side,
                                status=st,
                                processed_amount=0,
                                total_amount=amount
                            )
                            if mid:
                                schedule_mark_terminal(mid, status="cancelled", reason=f"otoco_working_{st}")
                            return
                    except Exception:
                        pass

            # 2. Wait for either TP or SL order to fill
            for _ in range(86400):
                await asyncio.sleep(3)
                try:
                    if tp_id:
                        tp_chk = await exchange.fetch_order(str(tp_id), symbol)
                        if tp_chk.get('status', '').lower() in ('closed', 'filled'):
                            exit_p = float(tp_chk.get('average') or tp_chk.get('price') or 0.0)
                            await BracketOrderService._send_tp_completed_notification(
                                user_id=user_id,
                                symbol=symbol,
                                opposite_side=opposite_side,
                                amount=amount,
                                entry_price=entry_price,
                                exit_price=exit_p
                            )
                            if mid:
                                schedule_mark_terminal(mid, status="completed", reason="otoco_tp_filled")
                            return

                    if sl_id:
                        sl_chk = await exchange.fetch_order(str(sl_id), symbol)
                        if sl_chk.get('status', '').lower() in ('closed', 'filled'):
                            exit_p = float(sl_chk.get('average') or sl_chk.get('price') or 0.0)
                            await BracketOrderService._send_sl_completed_notification(
                                user_id=user_id,
                                symbol=symbol,
                                opposite_side=opposite_side,
                                amount=amount,
                                entry_price=entry_price,
                                exit_price=exit_p,
                                sl_method="Native Spot OTOCO Stop-Loss"
                            )
                            if mid:
                                schedule_mark_terminal(mid, status="completed", reason="otoco_sl_filled")
                            return
                except Exception:
                    pass
            if mid:
                schedule_mark_terminal(mid, status="completed", reason="otoco_monitor_timeout")
        except Exception as e:
            logger.debug(f"monitor_native_otoco notice: {e}")


    
    @staticmethod
    async def _cancel_futures_order_universal(
        exchange, order_id: str, symbol: str, is_conditional: Optional[bool] = None
    ):
        """
        Safely cancels an order on Futures/Spot using WebSocket API when already connected (~80-250ms)
        with instant REST fallback.
        - On COIN-M (inverse, e.g. DOGE/USD:DOGE): all orders (both standard limit and STOP_MARKET)
          live on standard /dapi/v1/order, so we skip the non-existent /dapi/v1/algoOrder endpoint.
        - On Linear (USDT-M): uses single targeted endpoint when `is_conditional` is known, or
          concurrently tries both when unknown.
        """
        if not order_id or not exchange:
            return

        is_futures = ':' in str(symbol or '')
        is_inverse = False
        if is_futures:
            try:
                if getattr(exchange, 'markets', None) and symbol in exchange.markets:
                    mkt = exchange.markets[symbol]
                    is_inverse = bool(mkt.get('inverse') or mkt.get('subType') == 'inverse')
                else:
                    parts = str(symbol).split('/')
                    if len(parts) > 1 and ':' in parts[1]:
                        is_inverse = (parts[0].upper() == parts[1].split(':')[1].upper())
            except Exception:
                pass

        async def _cancel_std():
            if (
                getattr(exchange, 'has', {}).get('cancelOrderWs')
                and hasattr(exchange, 'cancel_order_ws')
                and is_ws_api_ready(exchange, is_futures=is_futures, is_inverse=is_inverse)
            ):
                try:
                    return await exchange.cancel_order_ws(order_id, symbol)
                except Exception as ws_err:
                    err_low = str(ws_err).lower()
                    if any(k in err_low for k in ('unknown order', '-2011', '-2013', 'does not exist')):
                        raise
                    logger.debug(f"cancel_order_ws fallback to REST for {order_id}: {ws_err}")
            return await exchange.cancel_order(order_id, symbol)

        if not is_futures:
            try:
                await _cancel_std()
                logger.info(f"✅ Cancelled order {order_id} on {symbol}")
            except Exception as e:
                logger.debug(f"Standard cancel notice for {order_id}: {e}")
            return

        # COIN-M Inverse Futures: conditional STOP_MARKET & limit orders are both on standard /dapi/v1/order
        if is_inverse:
            try:
                await _cancel_std()
                logger.info(f"✅ Cancelled COIN-M order {order_id} on {symbol}")
                return
            except Exception as inv_err:
                logger.debug(f"COIN-M standard cancel notice for {order_id}: {inv_err}")
                try:
                    await exchange.cancel_order(order_id, symbol, params={'stop': True})
                except Exception:
                    pass
                return

        if is_conditional is True:
            try:
                await exchange.cancel_order(order_id, symbol, params={'stop': True})
                logger.info(f"✅ Cancelled conditional/algo order {order_id} on {symbol}")
                return
            except Exception:
                try:
                    await _cancel_std()
                except Exception:
                    pass
                return

        if is_conditional is False:
            try:
                await _cancel_std()
                logger.info(f"✅ Cancelled regular order {order_id} on {symbol}")
                return
            except Exception:
                try:
                    await exchange.cancel_order(order_id, symbol, params={'stop': True})
                except Exception:
                    pass
                return

        res_std, res_stop = await asyncio.gather(
            _cancel_std(),
            exchange.cancel_order(order_id, symbol, params={'stop': True}),
            return_exceptions=True,
        )
        if not isinstance(res_std, Exception):
            logger.info(f"✅ Cancelled regular order {order_id} on {symbol}")
        elif not isinstance(res_stop, Exception):
            logger.info(f"✅ Cancelled conditional/algo order {order_id} on {symbol}")
        else:
            logger.debug(f"Cancel notice for {order_id} on {symbol}: std={res_std} | stop={res_stop}")

    @staticmethod
    async def _send_sl_modified_notification(
        user_id: int, symbol: str, side: str, amount: float, new_price: float, latency_ms: int, mode_label: str = "Software Stop-Loss", exchange_name: str = "Binance"
    ):
        if not user_id:
            return
        from app.services.notification import NotificationService
        from datetime import datetime, timezone
        from app.db.session import SessionLocal
        db = SessionLocal()
        try:
            now_utc = datetime.now(timezone.utc)
            time_str = now_utc.strftime("%Y-%m-%d %H:%M:%S UTC")
            action_text = "BUY 🟢" if str(side).lower() == 'buy' else "SELL 🔴"
            speed_text = f"⏱ Execution Speed: `{latency_ms} ms` ⚡\n" if latency_ms > 0 else ""
            msg = (
                f"🛡️ *{mode_label.upper()} MODIFIED*\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"• Exchange: `{exchange_name.capitalize()}`\n"
                f"• Pair: `{symbol}`\n"
                f"• Action: *{action_text}*\n"
                f"• Amount: `{amount}`\n"
                f"• New Trigger Price: `${new_price:,.4f}`\n"
                f"• Status: `Active Monitoring 🛡️`\n"
                f"• Time: `{time_str}`\n"
                f"{speed_text}"
            )
            await NotificationService.send_message(db, user_id, msg, parse_mode="Markdown", alert_type="alert_manual_trade")
        except Exception as e:
            logger.warning(f"Failed to send SL modified notification: {e}")
        finally:
            db.close()

    @staticmethod
    async def move_active_sl_to_breakeven(
        api_key_id: int,
        symbol: str,
        user_id: int = 0,
        buffer_pct: float = 0.05,
        fallback_entry_price: float = 0.0,
    ) -> dict:
        """
        1-Click move of all active Software SL monitors for `(api_key_id, symbol)`
        to `Entry Price +/- buffer_pct%` (Fee-covered Breakeven).
        Guards against moving SL onto the wrong side of live market price.
        """
        sa = str(symbol or '').strip()
        sa_base = sa.split(':')[0].upper()
        sa_fut = ':' in sa

        def _match(meta: dict) -> bool:
            if not meta or meta.get('cancelled'):
                return False
            k_id = meta.get('api_key_id')
            if k_id is not None and api_key_id is not None and int(k_id) != int(api_key_id):
                return False
            sb = str(meta.get('symbol') or '').strip()
            return ((':' in sb) == sa_fut) and (sb.split(':')[0].upper() == sa_base)

        candidates = [
            (sid, sdata)
            for sid, sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items())
            if _match(sdata)
        ]
        if not candidates:
            raise HTTPException(
                status_code=404,
                detail=f"No active Software SL monitor found for {symbol} to move to Breakeven."
            )

        clean_buf = max(0.0, min(2.0, float(buffer_pct if buffer_pct is not None else 0.05)))
        first_meta = candidates[0][1]
        ex = first_meta.get('exchange')
        ref_sym = first_meta.get('symbol') or symbol
        live_px = 0.0
        if ex is not None:
            try:
                tkr = await BracketOrderService._fetch_ticker_fast(ex, ref_sym, require_last=False)
                live_px = float(tkr.get('last') or tkr.get('bid') or tkr.get('ask') or 0.0)
            except Exception:
                live_px = 0.0

        updated_ids = []
        final_be_price = 0.0
        used_entry = 0.0
        for sid, sdata in candidates:
            has_fill_entry = bool(sdata.get('entry_order_id'))
            entry_px = (
                float(fallback_entry_price)
                if (not has_fill_entry and float(fallback_entry_price or 0.0) > 0)
                else float(sdata.get('entry_price') or fallback_entry_price or 0.0)
            )
            if entry_px <= 0:
                raise HTTPException(status_code=400, detail=f"Entry price unavailable for {symbol}; cannot compute Breakeven.")
            sdata['entry_price'] = entry_px
            opp_side = str(sdata.get('side') or 'sell').lower()
            target_be = entry_px * (1.0 + clean_buf / 100.0) if opp_side == 'sell' else entry_px * (1.0 - clean_buf / 100.0)
            target_be = BracketOrderService._safe_price_to_precision(sdata.get('exchange') or ex, ref_sym, target_be) or target_be

            if live_px > 0:
                if opp_side == 'sell' and live_px <= target_be:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Cannot set Breakeven (${target_be}): current price (${live_px}) is not in profit above entry yet."
                    )
                if opp_side == 'buy' and live_px >= target_be:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Cannot set Breakeven (${target_be}): current price (${live_px}) is not in profit below entry yet."
                    )

            curr_trig = float(sdata.get('trigger_price') or 0.0)
            # Keep SL already tighter than BE if already moved higher/lower
            if opp_side == 'sell' and curr_trig >= target_be:
                final_be_price = curr_trig
                used_entry = entry_px
                sdata['breakeven_activated'] = True
                updated_ids.append(sid)
                continue
            if opp_side == 'buy' and curr_trig > 0 and curr_trig <= target_be:
                final_be_price = curr_trig
                used_entry = entry_px
                sdata['breakeven_activated'] = True
                updated_ids.append(sid)
                continue

            sdata['breakeven_activated'] = True
            try:
                from app.services.manual_trade_persistence import schedule_update_monitor
                schedule_update_monitor(sid, fields={'breakeven_activated': True})
            except Exception:
                pass
            await BracketOrderService.update_software_bracket(
                sl_id=sid,
                new_price=target_be,
                api_key_id=api_key_id,
                user_id=user_id,
                set_manual_override=True,
                send_notify=True,
            )
            final_be_price = target_be
            used_entry = entry_px
            updated_ids.append(sid)

        return {
            "status": "success",
            "symbol": ref_sym,
            "entry_price": used_entry,
            "breakeven_price": final_be_price,
            "buffer_pct": clean_buf,
            "updated_sl_ids": updated_ids,
            "message": f"🛡️ SL moved to Breakeven @ ${final_be_price} (+{clean_buf:.2f}% fee buffer)",
        }

    @staticmethod
    async def update_software_bracket(
        sl_id: str,
        new_price: float,
        api_key_id: int = None,
        user_id: int = 0,
        set_manual_override: bool = True,
        send_notify: bool = True,
    ) -> dict:
        """
        Dynamically update the trigger price of an active software SL (Smart Chase, Trailing, Fixed).
        Safely re-calculates futures disaster stops if active.
        """
        t0 = time.perf_counter()
        sl_meta = BracketOrderService.ACTIVE_SOFTWARE_SL.get(sl_id)
        if not sl_meta:
            from app.services.manual_smart_chase_executor import ACTIVE_SMART_CHASES, _compute_max_chase_price
            if sl_id in ACTIVE_SMART_CHASES:
                chase_meta = ACTIVE_SMART_CHASES[sl_id]
                chase_ex = chase_meta.get('exchange')
                chase_sym = chase_meta.get('symbol', '')
                prec_price = float(new_price)
                if chase_ex and getattr(chase_ex, 'markets', None) and chase_sym in chase_ex.markets:
                    prec_price = BracketOrderService._safe_price_to_precision(chase_ex, chase_sym, new_price) or float(new_price)
                chase_side = str(chase_meta.get('side', 'sell')).lower()
                chase_dev = float(chase_meta.get('max_deviation_pct') if chase_meta.get('max_deviation_pct') is not None else 1.0)
                new_max_chase = _compute_max_chase_price(prec_price, chase_dev, chase_side)
                chase_meta['original_sl'] = prec_price
                chase_meta['max_chase_price'] = new_max_chase
                chase_meta['current_maker_price'] = prec_price
                chase_meta['target_updated'] = True
                try:
                    from app.services.manual_trade_persistence import schedule_update_monitor
                    schedule_update_monitor(
                        sl_id,
                        fields={'trigger_price': prec_price},
                        config_patch={'original_sl': prec_price, 'max_chase_price': new_max_chase},
                    )
                except Exception:
                    pass
                total_ms = int((time.perf_counter() - t0) * 1000)
                logger.info(
                    f"🎯 Updated active smart chase target for {sl_id} to {prec_price} "
                    f"(max_chase_price={new_max_chase}) in {total_ms}ms"
                )
                if user_id and send_notify:
                    asyncio.create_task(BracketOrderService._send_sl_modified_notification(
                        user_id=user_id,
                        symbol=chase_sym,
                        side=chase_meta.get('side', ''),
                        amount=float(chase_meta.get('amount', 0.0)),
                        new_price=prec_price,
                        latency_ms=total_ms,
                        mode_label="Smart Chase Target"
                    ))
                return {
                    "status": "success",
                    "sl_id": sl_id,
                    "new_price": prec_price,
                    "max_chase_price": new_max_chase,
                    "execution_speed_ms": total_ms,
                    "message": f"Updated active Smart Chase target to {prec_price}"
                }
            raise HTTPException(status_code=404, detail="Software SL bracket not found or already triggered/closed.")

        symbol = sl_meta.get('symbol')
        side = sl_meta.get('side')
        amount = sl_meta.get('amount', 0.0)
        exchange = sl_meta.get('exchange')
        is_futures = sl_meta.get('is_futures', False)
        mode = sl_meta.get('mode', 'SMART_CHASE')

        # Format price with exchange precision safely
        prec_price = BracketOrderService._safe_price_to_precision(exchange, symbol, new_price)

        # Update metadata dynamically
        sl_meta['trigger_price'] = prec_price
        sl_meta['price'] = prec_price
        if set_manual_override:
            sl_meta['manual_trigger_override'] = prec_price
        try:
            from app.services.anti_wick_guard import _reset_hold_state
            _reset_hold_state(sl_meta)
        except Exception:
            pass
        try:
            from app.services.manual_trade_persistence import schedule_update_monitor
            upd_fields = {'trigger_price': prec_price}
            if set_manual_override:
                upd_fields['manual_trigger_override'] = prec_price
            schedule_update_monitor(sl_id, fields=upd_fields)
        except Exception:
            pass

        # If disaster SL order exists on futures exchange, replace it with updated disaster level.
        # For SMART_CHASE / TRAILING software monitors, the active RAM trigger (`trigger_price`) updates in <1ms;
        # moving the distant backup Disaster SL runs coalesced in the background so chart dragging stays instant!
        disaster_order_id = sl_meta.get('disaster_sl_order_id')
        max_dev = float(sl_meta.get('max_deviation_pct') or 1.0)
        is_native_fixed_stop = str(mode or '').strip().upper() in ('STOP', 'FIXED', 'STOP_MARKET')
        if disaster_order_id and exchange and is_futures:
            seq = int(sl_meta.get('_disaster_seq', 0)) + 1
            sl_meta['_disaster_seq'] = seq
            lock = sl_meta.get('_disaster_lock')
            if lock is None:
                lock = asyncio.Lock()
                sl_meta['_disaster_lock'] = lock

            async def _replace_disaster_sl(target_trig_price: float, my_seq: int):
                try:
                    async with lock:
                        if sl_meta.get('_disaster_seq') != my_seq:
                            return
                        if sl_id not in BracketOrderService.ACTIVE_SOFTWARE_SL or sl_meta.get('cancelled'):
                            return
                        curr_dis_id = sl_meta.get('disaster_sl_order_id')
                        if not curr_dis_id:
                            return

                        try:
                            from app.services.user_order_stream import mark_order_replaced
                            mark_order_replaced(str(curr_dis_id), ttl_seconds=6.0)
                        except Exception:
                            pass

                        order_ex = exchange
                        api_key_rec = sl_meta.get('api_key_record')
                        if api_key_rec and hasattr(api_key_rec, 'api_key') and hasattr(api_key_rec, 'secret_key'):
                            try:
                                dec_api = decrypt_key(api_key_rec.api_key)
                                dec_sec = decrypt_key(api_key_rec.secret_key)
                                raw_pp = getattr(api_key_rec, 'passphrase', None)
                                dec_pp = decrypt_key(raw_pp) if raw_pp else None
                                cand_ex = await get_or_create_exchange(
                                    api_key_id=api_key_rec.id,
                                    exchange_name=api_key_rec.exchange,
                                    decrypted_api_key=dec_api,
                                    decrypted_secret=dec_sec,
                                    is_futures=is_futures,
                                    passphrase=dec_pp,
                                    purpose="order",
                                )
                                if cand_ex is not None:
                                    order_ex = cand_ex
                            except Exception:
                                order_ex = exchange

                        curr_mode = sl_meta.get('mode', 'SMART_CHASE')
                        aw_mode = str(sl_meta.get('anti_wick_mode') or 'instant').lower()
                        if aw_mode in ('dwell', 'candle_close'):
                            from app.services.anti_wick_guard import compute_anti_wick_disaster_price
                            disaster_price = compute_anti_wick_disaster_price(
                                target_trig_price,
                                side,
                                float(sl_meta.get('anti_wick_disaster_pct') or 2.0),
                            )
                        elif str(curr_mode or '').strip().upper() in ('STOP', 'FIXED', 'STOP_MARKET'):
                            disaster_price = target_trig_price
                        else:
                            disaster_price = (
                                target_trig_price * (1 - (max_dev / 100.0))
                                if side == 'sell'
                                else target_trig_price * (1 + (max_dev / 100.0))
                            )
                        disaster_price_prec = BracketOrderService._safe_price_to_precision(order_ex, symbol, disaster_price)
                        disaster_params = await BracketOrderService._apply_futures_exit_params(
                            order_ex, symbol, side, {'stopPrice': disaster_price_prec}
                        )
                        curr_amt = sl_meta.get('amount') if sl_meta.get('amount') is not None else amount
                        prec_amount = BracketOrderService._safe_amount_to_precision(order_ex, symbol, curr_amt)

                        # Cancel old disaster SL & place updated disaster SL concurrently in 1 RTT
                        cancel_task = BracketOrderService._cancel_futures_order_universal(
                            order_ex, curr_dis_id, symbol, is_conditional=True
                        )
                        place_task = BracketOrderService._place_futures_conditional_order(
                            order_ex, symbol, 'STOP_MARKET', side, prec_amount,
                            stop_price=disaster_price_prec, extra_params=disaster_params
                        )
                        _, d_res = await asyncio.gather(cancel_task, place_task, return_exceptions=True)
                        if isinstance(d_res, Exception) or not isinstance(d_res, dict) or not d_res.get('id'):
                            if sl_meta.get('_disaster_seq') == my_seq and not sl_meta.get('cancelled'):
                                d_res = await BracketOrderService._place_futures_conditional_order(
                                    order_ex, symbol, 'STOP_MARKET', side, prec_amount,
                                    stop_price=disaster_price_prec, extra_params=disaster_params
                                )
                        if isinstance(d_res, dict) and d_res.get('id'):
                            sl_meta['disaster_sl_order_id'] = d_res.get('id')
                            try:
                                from app.services.manual_trade_persistence import schedule_update_monitor
                                schedule_update_monitor(
                                    sl_id,
                                    fields={'disaster_sl_order_id': str(d_res.get('id'))},
                                )
                            except Exception:
                                pass
                            logger.info(f"🛡️ Replaced Native Disaster SL at {disaster_price_prec} (New ID: {d_res.get('id')})")
                except Exception as d_err:
                    logger.warning(f"⚠️ Failed to update native disaster SL: {d_err}")

            if is_native_fixed_stop:
                await _replace_disaster_sl(prec_price, seq)
            else:
                asyncio.create_task(_replace_disaster_sl(prec_price, seq))

        total_ms = int((time.perf_counter() - t0) * 1000)
        logger.info(f"✅ Software SL [{mode}] for {symbol} ({side}) trigger price updated to {prec_price} in {total_ms}ms")
        if user_id and send_notify:
            sl_mode_label = str(mode).replace('_', ' ').title() + " Stop-Loss"
            exch_name = str(getattr(exchange, 'id', 'Binance') if exchange else 'Binance')
            asyncio.create_task(BracketOrderService._send_sl_modified_notification(
                user_id=user_id,
                symbol=symbol,
                side=side,
                amount=amount,
                new_price=prec_price,
                latency_ms=total_ms,
                mode_label=sl_mode_label,
                exchange_name=exch_name
            ))

        return {
            "status": "success",
            "sl_id": sl_id,
            "symbol": symbol,
            "side": side,
            "new_price": prec_price,
            "mode": mode,
            "execution_speed_ms": total_ms,
            "message": f"Stop-Loss trigger price successfully updated to {prec_price}"
        }
    
    @staticmethod
    async def monitor_and_execute_bracket(
        api_key_record,
        entry_order_id: str,
        symbol: str,
        side: str,          # Entry side ('buy' or 'sell')
        amount: float,
        is_futures: bool,
        tp_config: dict = None,
        sl_config: dict = None,
        initial_entry_price: float = 0.0,
        user_id: int = 0,   # BUG-07: pass user_id for notification
        linked_tp_order_id: str = None,
        linked_tp_price: float = None,
        initial_filled_amount: float = 0.0,
        initial_filled_price: float = 0.0,
        resume_processed_amount: Optional[float] = None,
    ):
        """
        Background task:
        1. Monitors the entry order status for up to `timeout_mins`.
        2. Detects full or partial fills (via instant UserOrderStream wakeup or adaptive polling).
        3. Fires opposite Take-Profit & Stop-Loss orders concurrently based on the config.
        4. Sends notifications and syncs TP/SL lines to the chart immediately.
        """
        current_entry_id = str(entry_order_id) if entry_order_id else None
        try:
            # BUG-03 fix: Guard against empty string passphrase crashing decrypt_key
            decrypted_api_key = decrypt_key(api_key_record.api_key)
            decrypted_secret  = decrypt_key(api_key_record.secret_key)
            raw_pp = getattr(api_key_record, 'passphrase', None)
            passphrase = decrypt_key(raw_pp) if raw_pp else None

            exchange = await get_or_create_exchange(
                api_key_id=api_key_record.id,
                exchange_name=api_key_record.exchange,
                decrypted_api_key=decrypted_api_key,
                decrypted_secret=decrypted_secret,
                is_futures=is_futures,
                passphrase=passphrase,
            )

            # Ultra-fast 0ms shortcut when Market / Limit order already filled on placement response
            init_filled = float(initial_filled_amount or 0.0)
            if init_filled > 0:
                fill_px = float(initial_filled_price or initial_entry_price or 0.0)
                if user_id and fill_px > 0:
                    asyncio.create_task(
                        BracketOrderService._send_entry_filled_notification(
                            user_id=user_id,
                            symbol=symbol,
                            side=side,
                            filled=init_filled,
                            total_amount=amount,
                            average_price=fill_px,
                            is_futures=is_futures,
                        )
                    )
                if tp_config or sl_config:
                    await BracketOrderService._spawn_bracket_for_amount(
                        exchange, symbol, side, init_filled, fill_px,
                        is_futures, tp_config, sl_config, user_id, api_key_record,
                        entry_order_id=current_entry_id,
                        linked_tp_order_id=linked_tp_order_id,
                        linked_tp_price=linked_tp_price,
                    )
                if init_filled >= float(amount or 0.0) * 0.99:
                    return

            # Determine if unlimited monitoring (0, None, <=0) is requested
            is_unlimited = False
            active_timeouts = []

            for cfg in (tp_config, sl_config):
                if cfg is not None and isinstance(cfg, dict) and cfg:
                    t_val = cfg.get('timeout_mins')
                    try:
                        if t_val is None or float(t_val) <= 0:
                            is_unlimited = True
                        else:
                            active_timeouts.append(float(t_val))
                    except (ValueError, TypeError):
                        is_unlimited = True

            if is_unlimited or not active_timeouts:
                is_unlimited = True
                max_timeout_mins = 0
            else:
                max_timeout_mins = max(active_timeouts)

            logger.info(
                f"🛡️ Bracket Monitor started | Order: {entry_order_id} | "
                f"Symbol: {symbol} | Timeout: {'Unlimited (Until Filled)' if is_unlimited else f'{max_timeout_mins} min'}"
            )

            processed_amount = float(resume_processed_amount) if resume_processed_amount is not None else init_filled
            average_price = float(initial_filled_price or initial_entry_price or 0.0)
            order_closed = False
            order_was_cancelled = False
            elapsed_seconds = 0
            fill_event = asyncio.Event()
            if current_entry_id:
                BracketOrderService.ACTIVE_ENTRY_MONITORS[current_entry_id] = {
                    'entry_order_id': current_entry_id,
                    'symbol': symbol,
                    'api_key_id': getattr(api_key_record, 'id', None),
                    'linked_tp_order_id': str(linked_tp_order_id) if linked_tp_order_id else None,
                    'linked_tp_price': float(linked_tp_price) if linked_tp_price else None,
                    'cancelled': False,
                    'fill_event': fill_event,
                }
                try:
                    from app.services.manual_trade_persistence import schedule_upsert_monitor
                    schedule_upsert_monitor(
                        monitor_id=current_entry_id,
                        kind='entry_monitor',
                        user_id=user_id,
                        api_key_id=getattr(api_key_record, 'id', None),
                        symbol=symbol,
                        is_futures=is_futures,
                        side=side,
                        status='monitoring',
                        amount=float(amount or 0.0),
                        entry_price=average_price,
                        entry_order_id=current_entry_id,
                        tp_order_id=str(linked_tp_order_id) if linked_tp_order_id else None,
                        tp_price=float(linked_tp_price) if linked_tp_price else None,
                        config={
                            'tp_config': tp_config,
                            'sl_config': sl_config,
                            'processed_amount': processed_amount,
                        },
                    )
                except Exception:
                    pass

            def _resolve_active_entry_id(curr_id: Optional[str]) -> Optional[str]:
                """Follow any cancelReplace / edit_order ID handoff chain seamlessly."""
                seen = set()
                while curr_id and curr_id not in seen:
                    seen.add(curr_id)
                    meta = BracketOrderService.ACTIVE_ENTRY_MONITORS.get(curr_id)
                    next_id = meta.get('replaced_by') if isinstance(meta, dict) else None
                    if next_id and str(next_id) != curr_id:
                        curr_id = str(next_id)
                    else:
                        break
                return curr_id

            # ── Polling + Event-Driven Wakeup Loop ─────────────────────
            while True:
                current_entry_id = _resolve_active_entry_id(current_entry_id)
                mon_meta = BracketOrderService.ACTIVE_ENTRY_MONITORS.get(current_entry_id, {}) if current_entry_id else {}
                if mon_meta.get('cancelled'):
                    order_was_cancelled = True
                    logger.info(f"🛑 Bracket Monitor for {current_entry_id} aborted by Emergency Force Order.")
                    break
                if not is_unlimited and elapsed_seconds >= max_timeout_mins * 60:
                    break
                
                # Adaptive Polling: Fast initial check (200ms -> 450ms for 30s), woken INSTANTLY (<1ms) by UserOrderStream on WS fill
                if elapsed_seconds == 0:
                    sleep_time = 0.20
                elif elapsed_seconds < 30: # First 30 secs (hot fill window)
                    sleep_time = 0.45
                elif elapsed_seconds < 300: # Next ~5 mins
                    sleep_time = 1.5
                elif elapsed_seconds < 3600: # Next 1 hour
                    sleep_time = 10
                else: # After 1 hour
                    sleep_time = 30

                mon_fill_ev = mon_meta.get('fill_event') or fill_event
                t_wait0 = time.perf_counter()
                try:
                    await asyncio.wait_for(mon_fill_ev.wait(), timeout=sleep_time)
                    mon_fill_ev.clear()
                    elapsed_seconds += max(0.05, time.perf_counter() - t_wait0)
                except asyncio.TimeoutError:
                    elapsed_seconds += sleep_time

                current_entry_id = _resolve_active_entry_id(current_entry_id)
                mon_meta = BracketOrderService.ACTIVE_ENTRY_MONITORS.get(current_entry_id, {}) if current_entry_id else {}
                if mon_meta.get('cancelled'):
                    order_was_cancelled = True
                    logger.info(f"🛑 Bracket Monitor for {current_entry_id} aborted by Emergency Force Order.")
                    break

                try:
                    polled_entry_id = current_entry_id
                    ws_snap = mon_meta.pop('ws_order_snapshot', None) if isinstance(mon_meta, dict) else None
                    if isinstance(ws_snap, dict) and str(ws_snap.get('status') or '').lower():
                        order_status = ws_snap
                    else:
                        order_status = await exchange.fetch_order(polled_entry_id, symbol)
                    status = str(order_status.get('status') or '').lower()
                    filled = float(order_status.get('filled') or 0.0)
                    if status in ('closed', 'filled') and filled <= 0 and amount > 0:
                        filled = float(amount)

                    if filled > processed_amount + 1e-12:
                        newly_filled = float(Decimal(str(filled)) - Decimal(str(processed_amount)))
                        average_price = float(
                            order_status.get('average') or
                            order_status.get('price') or
                            initial_entry_price or
                            0.0
                        )
                        if average_price <= 0:
                            try:
                                ticker = await BracketOrderService._fetch_ticker_fast(exchange, symbol, require_last=False)
                                average_price = float(ticker.get('last') or ticker.get('close') or 0.0)
                            except Exception:
                                pass

                        # On Spot, if a partial fill chunk is below $5.00 min notional while the entry order is still open
                        # and no bracket exists yet for this entry_order_id, wait for more fills (or order close) before spawning TP
                        chunk_notional = newly_filled * average_price
                        if not is_futures and status == 'open' and processed_amount <= 0 and 0 < chunk_notional < 5.0:
                            logger.info(
                                f"⏳ [Bracket Monitor] Partial fill {newly_filled} (${chunk_notional:.2f} < $5.00 Spot Min Notional) "
                                f"for {polled_entry_id}. Waiting for additional fill or order close..."
                            )
                        else:
                            logger.info(f"⚡ Partial/Full fill detected for {polled_entry_id}: {newly_filled} @ {average_price} (Total: {filled}/{amount})")
                            
                            # Spawning bracket for this chunk (pass authoritative cumulative_filled to prevent any truncation drift)
                            asyncio.create_task(
                                BracketOrderService._spawn_bracket_for_amount(
                                    exchange, symbol, side, newly_filled, average_price,
                                    is_futures, tp_config, sl_config, user_id, api_key_record,
                                    entry_order_id=polled_entry_id,
                                    linked_tp_order_id=linked_tp_order_id,
                                    linked_tp_price=linked_tp_price,
                                    cumulative_filled=filled,
                                )
                            )
                            # Send Entry Order Fill notification to Telegram
                            if user_id:
                                asyncio.create_task(
                                    BracketOrderService._send_entry_filled_notification(
                                        user_id=user_id,
                                        symbol=symbol,
                                        side=side,
                                        filled=filled,
                                        total_amount=amount,
                                        average_price=average_price,
                                        is_futures=is_futures
                                    )
                                )
                            processed_amount = filled
                            if current_entry_id:
                                try:
                                    from app.services.manual_trade_persistence import schedule_update_monitor
                                    schedule_update_monitor(
                                        current_entry_id,
                                        config_patch={'processed_amount': processed_amount},
                                    )
                                except Exception:
                                    pass

                    exchange_order_amt = float(order_status.get('amount') or 0.0)
                    target_full_amt = exchange_order_amt if exchange_order_amt > 0 else float(amount or 0.0)
                    if status in ('closed', 'filled') or (target_full_amt > 0 and processed_amount >= target_full_amt - 1e-9):
                        order_closed = True
                        break

                    elif status in ('canceled', 'cancelled', 'expired', 'rejected'):
                        # If the order was replaced during a drag-modify/edit_order, seamlessly follow the new order ID
                        next_id = _resolve_active_entry_id(polled_entry_id)
                        if next_id and next_id != polled_entry_id:
                            logger.info(f"🔄 Bracket Monitor migrated seamlessly: {polled_entry_id} -> {next_id}")
                            current_entry_id = next_id
                            continue
                        logger.info(f"⚠️ Bracket Monitor: Entry {polled_entry_id} canceled. Total processed: {processed_amount}")
                        if user_id:
                            asyncio.create_task(
                                BracketOrderService._send_order_cancelled_notification(
                                    user_id=user_id,
                                    symbol=symbol,
                                    side=side,
                                    status=status,
                                    processed_amount=processed_amount,
                                    total_amount=amount
                                )
                            )
                        order_closed = True
                        order_was_cancelled = True
                        break

                except Exception as poll_e:
                    logger.debug(f"Bracket Monitor poll error (non-fatal): {poll_e}")

            if not order_closed and processed_amount < amount and not is_unlimited:
                logger.warning(
                    f"⏰ Bracket Monitor: Entry {current_entry_id or entry_order_id} timed out "
                    f"after {max_timeout_mins} mins. Processed {processed_amount}/{amount}."
                )

            term_id = current_entry_id or (str(entry_order_id) if entry_order_id else None)
            if term_id:
                try:
                    from app.services.manual_trade_persistence import schedule_mark_terminal
                    schedule_mark_terminal(
                        term_id,
                        status='cancelled' if order_was_cancelled else 'completed',
                        reason='entry_cancelled' if order_was_cancelled else ('entry_timeout' if not order_closed else 'entry_completed'),
                    )
                except Exception:
                    pass

        except Exception as main_e:
            logger.error(f"Bracket Monitor critical failure: {main_e}", exc_info=True)
        finally:
            if entry_order_id:
                BracketOrderService.ACTIVE_ENTRY_MONITORS.pop(str(entry_order_id), None)
            if current_entry_id and current_entry_id != str(entry_order_id):
                BracketOrderService.ACTIVE_ENTRY_MONITORS.pop(current_entry_id, None)


    @staticmethod
    def _matches_bracket_ref(sid: str, sdata: dict, ref_id: str) -> bool:
        if not ref_id:
            return False
        ref_str = str(ref_id)
        return (
            str(sid) == ref_str
            or str(sdata.get('entry_order_id') or '') == ref_str
            or str(sdata.get('tp_order_id') or '') == ref_str
        )

    @staticmethod
    def _mark_entry_bracket_closed(entry_order_id: str = None, tp_order_id: str = None):
        """Marks matching ACTIVE_ENTRY_BRACKETS entries closed/cancelled, removes them, and discards stale TP IDs."""
        entry_str = str(entry_order_id) if entry_order_id else None
        tp_str = str(tp_order_id) if tp_order_id else None

        if tp_str:
            BracketOrderService.KNOWN_TP_ORDER_IDS.discard(tp_str)

        if not entry_str and not tp_str:
            return

        for eb_key, eb_data in list(BracketOrderService.ACTIVE_ENTRY_BRACKETS.items()):
            if not isinstance(eb_data, dict):
                continue
            eb_entry = str(eb_data.get('entry_order_id') or '')
            eb_tp = str(eb_data.get('tp_order_id') or '')
            matched = (
                (entry_str and (str(eb_key) == entry_str or eb_entry == entry_str))
                or (tp_str and (str(eb_key) == f"tp:{tp_str}" or eb_tp == tp_str))
            )
            if matched:
                eb_data['cancelled'] = True
                if eb_tp:
                    BracketOrderService.KNOWN_TP_ORDER_IDS.discard(eb_tp)
                BracketOrderService.ACTIVE_ENTRY_BRACKETS.pop(eb_key, None)

    @staticmethod
    async def _check_linked_tp_filled(
        exchange,
        symbol: str,
        is_futures: bool,
        sl_meta: dict,
        fallback_tp_order_id: str = None,
        user_id: int = None,
        entry_price: float = 0.0,
        opposite_side: str = 'sell',
        default_amount: float = 0.0,
        context_label: str = "SL monitor",
    ) -> bool:
        curr_tp_id = sl_meta.get('tp_order_id') or fallback_tp_order_id
        if not curr_tp_id:
            return False
        try:
            tp_chk = (
                await BracketOrderService._fetch_futures_order_universal(
                    exchange, curr_tp_id, symbol, is_conditional=False
                )
                if is_futures else await exchange.fetch_order(curr_tp_id, symbol)
            )
            if tp_chk and str(tp_chk.get('status', '')).lower() in ['closed', 'filled']:
                logger.info(f"🎯 TP order {curr_tp_id} filled! Closing {context_label} for {symbol}.")
                BracketOrderService._mark_entry_bracket_closed(
                    entry_order_id=sl_meta.get('entry_order_id'),
                    tp_order_id=curr_tp_id,
                )
                try:
                    api_key_id = sl_meta.get('api_key_id')
                    if api_key_id is not None:
                        from app.services.manual_trade_service import ManualTradeService
                        ManualTradeService.invalidate_open_orders_cache(int(api_key_id), symbol)
                except Exception:
                    pass
                exit_price = float(tp_chk.get('average') or tp_chk.get('price') or 0.0)
                fill_amt = float(tp_chk.get('filled') or tp_chk.get('amount') or default_amount)
                if user_id:
                    try:
                        asyncio.create_task(
                            BracketOrderService._send_tp_completed_notification(
                                user_id=user_id,
                                symbol=symbol,
                                opposite_side=opposite_side,
                                amount=fill_amt,
                                entry_price=entry_price,
                                exit_price=exit_price
                            )
                        )
                    except Exception as notify_err:
                        logger.debug(f"TP completed notification notice: {notify_err}")
                return True
            if tp_chk and not sl_meta.get('tp_price'):
                tp_px = float(tp_chk.get('price') or tp_chk.get('stopPrice') or 0.0)
                if tp_px > 0:
                    sl_meta['tp_price'] = tp_px
        except Exception as tp_chk_err:
            logger.debug(f"TP order check error: {tp_chk_err}")
        return False

    @staticmethod
    async def _spawn_bracket_for_amount(
        exchange, symbol: str, side: str, filled_amount: float, average_price: float,
        is_futures: bool, tp_config: dict, sl_config: dict, user_id: int, api_key_record,
        entry_order_id: str = None,
        is_consolidation_chunk: bool = True,
        linked_tp_order_id: str = None,
        linked_tp_price: float = None,
        cumulative_filled: Optional[float] = None,
    ):
        lock_key = str(entry_order_id) if entry_order_id else (f"tp:{linked_tp_order_id}" if linked_tp_order_id else None)
        entry_lock = None
        t_spawn_start = time.perf_counter()
        if lock_key:
            entry_lock = BracketOrderService.ENTRY_BRACKET_LOCKS.setdefault(lock_key, asyncio.Lock())
            await entry_lock.acquire()
        try:
            # Resolve dedicated unthrottled order exchange instance (0ms credential & pool cache hit)
            order_ex = exchange
            if api_key_record and hasattr(api_key_record, 'api_key') and hasattr(api_key_record, 'secret_key'):
                try:
                    from app.services.manual_trade_service import ManualTradeService
                    cand_ex = await ManualTradeService._get_exchange(api_key_record, is_futures, purpose="order")
                    if cand_ex is not None:
                        order_ex = cand_ex
                except Exception:
                    order_ex = exchange

            # Ensure exchange markets are loaded if possible (non-fatal)
            if not getattr(exchange, 'markets', None):
                try:
                    await asyncio.wait_for(exchange.load_markets(), timeout=6.0)
                except Exception as lm_err:
                    logger.debug(f"Non-fatal load_markets notice in _spawn_bracket_for_amount: {lm_err}")

            # Guarantee average_price is a valid positive number
            average_price = float(average_price or 0.0)
            if average_price <= 0:
                try:
                    ticker = await BracketOrderService._fetch_ticker_fast(exchange, symbol, require_last=False)
                    average_price = float(ticker.get('last') or ticker.get('close') or ticker.get('bid') or ticker.get('ask') or 0.0)
                    logger.info(f"📊 Resolved fallback average_price={average_price} from live ticker for {symbol}")
                except Exception as tick_err:
                    logger.warning(f"Failed to fetch fallback ticker price for {symbol}: {tick_err}")

            # Check if this is an Inverse / COIN-M contract (e.g. DOGE/USD:DOGE)
            is_inverse = False
            try:
                if hasattr(exchange, 'markets') and exchange.markets and symbol in exchange.markets:
                    mkt = exchange.markets[symbol]
                    is_inverse = bool(mkt.get('inverse') or mkt.get('subType') == 'inverse')
                elif ':' in symbol:
                    parts = symbol.split('/')
                    base = parts[0]
                    settle = parts[1].split(':')[1] if ':' in parts[1] else ''
                    if settle.upper() == base.upper():
                        is_inverse = True
            except Exception:
                pass

            if is_inverse:
                final_amount = max(1.0, round(float(filled_amount)))
            else:
                final_amount = BracketOrderService._safe_amount_to_precision(exchange, symbol, filled_amount)
            if final_amount <= 0:
                return
            opposite_side = 'sell' if side.lower() == 'buy' else 'buy'
            api_key_id = getattr(api_key_record, 'id', None)

            tp_order_id = str(linked_tp_order_id) if linked_tp_order_id else None
            resolved_tp_price = float(linked_tp_price) if linked_tp_price and float(linked_tp_price) > 0 else None

            # --- Partial Fill / Iceberg Bracket Consolidation (SAME entry_order_id ONLY) ---
            # Consolidate ONLY when multiple partial fill chunks come from the exact SAME entry_order_id.
            # Separate manual trade orders have distinct entry_order_ids and MUST maintain their own individual TP and SL!
            existing_sl = None
            matched_eb_key = None
            target_id_str = str(entry_order_id) if entry_order_id else (str(linked_tp_order_id) if linked_tp_order_id else None)
            if target_id_str:
                for sid, sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
                    if sdata.get('cancelled') or sdata.get('status') != 'monitoring':
                        continue
                    if api_key_id is not None and sdata.get('api_key_id') is not None and int(sdata.get('api_key_id')) != int(api_key_id):
                        continue
                    if str(sdata.get('symbol', '')).strip().upper() == str(symbol).strip().upper() and str(sdata.get('side', '')).lower() == opposite_side:
                        if BracketOrderService._matches_bracket_ref(sid, sdata, target_id_str):
                            existing_sl = sdata
                            break
                for eb_key, eb_cand in list(BracketOrderService.ACTIVE_ENTRY_BRACKETS.items()):
                    if (
                        not eb_cand.get('cancelled')
                        and (api_key_id is None or eb_cand.get('api_key_id') is None or int(eb_cand.get('api_key_id')) == int(api_key_id))
                        and str(eb_cand.get('symbol', '')).strip().upper() == str(symbol).strip().upper()
                        and str(eb_cand.get('side', '')).lower() == opposite_side
                        and (
                            str(eb_key) == target_id_str
                            or str(eb_cand.get('entry_order_id') or '') == target_id_str
                            or str(eb_cand.get('tp_order_id') or '') == target_id_str
                        )
                    ):
                        matched_eb_key = str(eb_key)
                        if existing_sl is None:
                            existing_sl = eb_cand
                        break

            if existing_sl is not None:
                if is_consolidation_chunk:
                    prev_amt = float(existing_sl.get('amount') or 0.0)
                    raw_sum = float(Decimal(str(prev_amt)) + Decimal(str(final_amount)))
                    if cumulative_filled is not None and float(cumulative_filled) > 0:
                        cum_prec = (
                            max(1.0, round(float(cumulative_filled)))
                            if is_inverse
                            else BracketOrderService._safe_amount_to_precision(exchange, symbol, float(cumulative_filled))
                        )
                        raw_total = max(raw_sum, cum_prec)
                    else:
                        raw_total = raw_sum
                    new_total_amt = BracketOrderService._safe_amount_to_precision(exchange, symbol, raw_total)
                    prev_entry = float(existing_sl.get('entry_price') or average_price)
                    weighted_entry = ((prev_amt * prev_entry) + (final_amount * average_price)) / raw_total if raw_total > 0 else average_price
                else:
                    new_total_amt = BracketOrderService._safe_amount_to_precision(exchange, symbol, final_amount)
                    weighted_entry = float(existing_sl.get('entry_price') or average_price)

                existing_sl['amount'] = new_total_amt
                existing_sl['entry_price'] = weighted_entry
                if matched_eb_key and matched_eb_key in BracketOrderService.ACTIVE_ENTRY_BRACKETS:
                    BracketOrderService.ACTIVE_ENTRY_BRACKETS[matched_eb_key]['amount'] = new_total_amt
                    BracketOrderService.ACTIVE_ENTRY_BRACKETS[matched_eb_key]['entry_price'] = weighted_entry

                # Consolidate or replace TP order if configured
                if tp_config:
                    old_tp_id = existing_sl.get('tp_order_id')
                    tp_target_amt = new_total_amt
                    if old_tp_id:
                        old_tp_filled = 0.0
                        old_tp_already_closed = False
                        try:
                            old_tp_chk = (
                                await BracketOrderService._fetch_futures_order_universal(exchange, old_tp_id, symbol, is_conditional=False)
                                if is_futures else await exchange.fetch_order(old_tp_id, symbol)
                            )
                            if old_tp_chk:
                                old_tp_filled = float(old_tp_chk.get('filled') or 0.0)
                                if str(old_tp_chk.get('status', '')).lower() in ('closed', 'filled'):
                                    old_tp_already_closed = True
                        except Exception:
                            pass
                        if not old_tp_already_closed:
                            if is_futures:
                                await BracketOrderService._cancel_futures_order_universal(exchange, old_tp_id, symbol)
                            else:
                                await exchange.cancel_order(old_tp_id, symbol)
                            await asyncio.sleep(0.15)
                        if old_tp_filled > 0 and is_consolidation_chunk:
                            rem_after_old_tp = float(Decimal(str(raw_total)) - Decimal(str(old_tp_filled)))
                            tp_target_amt = BracketOrderService._safe_amount_to_precision(
                                exchange, symbol, max(final_amount, rem_after_old_tp)
                            )

                    tp_order_type = tp_config.get('order_type', 'Limit').lower()
                    tp_price = BracketOrderService._compute_tp_price(tp_config, weighted_entry, opposite_side)

                    final_tp_price = BracketOrderService._safe_price_to_precision(order_ex, symbol, tp_price)
                    t_cons_tp_start = time.perf_counter()
                    ex_params = await BracketOrderService._apply_futures_exit_params(order_ex, symbol, opposite_side) if is_futures else {}
                    try:
                        tp_res = None
                        if tp_order_type == 'limit':
                            ex_params_po = dict(ex_params)
                            ex_params_po['postOnly'] = True
                            try:
                                tp_res = await order_ex.create_limit_order(symbol, opposite_side, tp_target_amt, final_tp_price, ex_params_po)
                            except Exception as po_cons_err:
                                logger.warning(f"Consolidated TP Post-Only rejected ({po_cons_err}). Retrying with standard GTC Limit...")
                                tp_res = None
                            if not tp_res or str(tp_res.get('status', '')).lower() in ('expired', 'canceled', 'cancelled', 'rejected'):
                                ex_params_gtc = dict(ex_params)
                                ex_params_gtc.pop('postOnly', None)
                                ex_params_gtc['timeInForce'] = 'GTC'
                                tp_res = await order_ex.create_limit_order(symbol, opposite_side, tp_target_amt, final_tp_price, ex_params_gtc)
                        else:
                            if is_futures:
                                tp_cond_params = dict(ex_params)
                                tp_cond_params['stopPrice'] = final_tp_price
                                tp_res = await BracketOrderService._place_futures_conditional_order(
                                    order_ex, symbol, 'TAKE_PROFIT_MARKET', opposite_side, tp_target_amt,
                                    stop_price=final_tp_price, extra_params=tp_cond_params
                                )
                            else:
                                ex_params_gtc = dict(ex_params)
                                ex_params_gtc.pop('postOnly', None)
                                ex_params_gtc['timeInForce'] = 'GTC'
                                tp_res = await order_ex.create_limit_order(symbol, opposite_side, tp_target_amt, final_tp_price, ex_params_gtc)
                        cons_tp_ms = max(1, int((time.perf_counter() - t_cons_tp_start) * 1000))
                        if tp_res and tp_res.get('id'):
                            new_tp_id = str(tp_res.get('id'))
                            if old_tp_id and str(old_tp_id) != new_tp_id:
                                BracketOrderService.KNOWN_TP_ORDER_IDS.discard(str(old_tp_id))
                            tp_order_id = new_tp_id
                            resolved_tp_price = float(final_tp_price)
                            existing_sl['tp_order_id'] = new_tp_id
                            existing_sl['tp_price'] = resolved_tp_price
                            if matched_eb_key and matched_eb_key in BracketOrderService.ACTIVE_ENTRY_BRACKETS:
                                BracketOrderService.ACTIVE_ENTRY_BRACKETS[matched_eb_key]['tp_order_id'] = new_tp_id
                                BracketOrderService.ACTIVE_ENTRY_BRACKETS[matched_eb_key]['tp_price'] = resolved_tp_price
                            BracketOrderService.KNOWN_TP_ORDER_IDS.add(new_tp_id)
                            # Link to any active software SL
                            for sid, sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
                                if (
                                    not sdata.get('cancelled')
                                    and sdata.get('status') == 'monitoring'
                                    and (api_key_id is None or sdata.get('api_key_id') is None or int(sdata.get('api_key_id')) == int(api_key_id))
                                    and str(sdata.get('symbol', '')).strip().upper() == str(symbol).strip().upper()
                                    and str(sdata.get('side', '')).lower() == opposite_side
                                ):
                                    if (
                                        (target_id_str and BracketOrderService._matches_bracket_ref(sid, sdata, target_id_str))
                                        or (old_tp_id and str(sdata.get('tp_order_id') or '') == str(old_tp_id))
                                    ):
                                        sdata['tp_order_id'] = new_tp_id
                                        sdata['tp_price'] = resolved_tp_price
                            logger.info(f"🔄 Consolidated Bracket TP to {tp_target_amt} at {final_tp_price} in {cons_tp_ms}ms (ID: {new_tp_id})")
                            if user_id:
                                try:
                                    from app.db.session import SessionLocal
                                    db = SessionLocal()
                                    try:
                                        exchange_display = api_key_record.exchange.capitalize() if api_key_record else "Exchange"
                                        msg = (
                                            f"🔄 *CONSOLIDATED TP UPDATED*\n"
                                            f"━━━━━━━━━━━━━━━━━━━━\n"
                                            f"• Exchange: `{exchange_display}`\n"
                                            f"• Pair: `{symbol}`\n"
                                            f"• TP Side: *{opposite_side.upper()}*\n"
                                            f"• Consolidated Amount: `{tp_target_amt}`\n"
                                            f"• TP Target Price: `${final_tp_price}`\n"
                                            f"⏱ Placement Speed: `{cons_tp_ms} ms` ⚡"
                                        )
                                        await NotificationService.send_message(db, user_id, msg, parse_mode="Markdown", alert_type="alert_manual_trade")
                                    finally:
                                        db.close()
                                except Exception as notify_cons_err:
                                    logger.debug(f"Consolidated TP notification notice: {notify_cons_err}")
                    except Exception as tp_cons_err:
                        logger.warning(f"Failed to replace consolidated TP order: {tp_cons_err}")

                # Check if an active software SL monitor is running for this bracket
                has_active_sl_loop = False
                for sid, sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
                    if (
                        not sdata.get('cancelled')
                        and sdata.get('status') == 'monitoring'
                        and (api_key_id is None or sdata.get('api_key_id') is None or int(sdata.get('api_key_id')) == int(api_key_id))
                        and str(sdata.get('symbol', '')).strip().upper() == str(symbol).strip().upper()
                        and str(sdata.get('side', '')).lower() == opposite_side
                        and target_id_str
                        and BracketOrderService._matches_bracket_ref(sid, sdata, target_id_str)
                    ):
                        has_active_sl_loop = True
                        sdata['amount'] = new_total_amt
                        sdata['entry_price'] = weighted_entry
                        if sl_config:
                            sl_type_curr = str(sl_config.get('type') or sdata.get('type') or 'fixed').lower()
                            sl_mode_curr = str(sl_config.get('mode', 'percentage')).lower()
                            is_trailing_type = (
                                sl_type_curr in ('trailing', 'trailing_chase')
                                or str(sdata.get('type') or '').lower() in ('trailing', 'trailing_chase')
                            )
                            # On partial-fill consolidation chunks, recalculate SL from weighted_entry & mode
                            # (unless trailing, auto-breakeven activated, or manually dragged on chart) instead of
                            # treating relative price/% offsets as an absolute trigger price.
                            should_update_sl = (
                                not is_consolidation_chunk
                                or (
                                    not is_trailing_type
                                    and not sdata.get('breakeven_activated')
                                    and sdata.get('manual_trigger_override') is None
                                )
                            )
                            if should_update_sl:
                                computed_sl = BracketOrderService._compute_sl_price(sl_config, weighted_entry, opposite_side)
                                if computed_sl > 0:
                                    prec_sl = BracketOrderService._safe_price_to_precision(exchange, symbol, computed_sl)
                                    if prec_sl > 0:
                                        sdata['trigger_price'] = prec_sl
                                        sdata['price'] = prec_sl
                                        if not is_consolidation_chunk and sl_mode_curr == 'absolute':
                                            sdata['manual_trigger_override'] = prec_sl
                        try:
                            from app.services.manual_trade_persistence import schedule_update_monitor
                            cons_fields = {
                                'amount': float(new_total_amt),
                                'entry_price': float(weighted_entry),
                                'trigger_price': float(sdata.get('trigger_price')) if sdata.get('trigger_price') is not None else None,
                                'manual_trigger_override': float(sdata.get('manual_trigger_override')) if sdata.get('manual_trigger_override') is not None else None,
                                'tp_order_id': str(sdata.get('tp_order_id')) if sdata.get('tp_order_id') else None,
                                'tp_price': float(sdata.get('tp_price')) if sdata.get('tp_price') else None,
                            }
                            cons_fields = {k: v for k, v in cons_fields.items() if v is not None}
                            if cons_fields:
                                schedule_update_monitor(str(sid), fields=cons_fields)
                        except Exception:
                            pass
                        break

                # Consolidate / Update Futures disaster SL if present (after trigger_price is synced)
                old_dis_id = existing_sl.get('disaster_sl_order_id')
                if old_dis_id and is_futures and existing_sl.get('id'):
                    try:
                        await BracketOrderService.update_software_bracket(
                            existing_sl['id'],
                            float(existing_sl.get('trigger_price') or existing_sl.get('price') or weighted_entry),
                            api_key_id,
                            user_id,
                            set_manual_override=not is_consolidation_chunk,
                            send_notify=not is_consolidation_chunk,
                        )
                    except Exception as dis_cons_err:
                        logger.debug(f"Consolidate disaster SL notice: {dis_cons_err}")

                # If sl_config was requested but NO software SL monitor is running yet,
                # we must NOT return early — we must proceed down to start the SL monitor loop!
                if sl_config and not has_active_sl_loop:
                    logger.info(f"Bracket entry #{target_id_str} has no active software SL monitor. Proceeding to spawn SL monitor...")
                    final_amount = new_total_amt
                    average_price = weighted_entry
                    tp_order_id = str(existing_sl.get('tp_order_id') or tp_order_id or '') or None
                    if not resolved_tp_price and existing_sl.get('tp_price'):
                        resolved_tp_price = float(existing_sl['tp_price'])
                    tp_config = None  # Consolidated TP was already handled above
                else:
                    if is_consolidation_chunk:
                        logger.info(
                            f"🔄 [Bracket Monitor] Consolidated partial fill chunk (+{final_amount} -> total {new_total_amt}) "
                            f"into active bracket for entry #{target_id_str} on {symbol}"
                        )
                    else:
                        logger.info(
                            f"🎯 [Bracket Update] Bracket updated to {new_total_amt} "
                            f"for entry #{target_id_str} on {symbol}"
                        )
                    resolved_tp = str(existing_sl.get('tp_order_id') or tp_order_id or '') or None
                    resolved_px = float(existing_sl.get('tp_price') or resolved_tp_price or 0.0) or None
                    return {
                        'tp_order_id': resolved_tp,
                        'tp_price': resolved_px,
                        'entry_order_id': str(entry_order_id) if entry_order_id else None,
                        'amount': new_total_amt,
                    }

            # --- Binance Spot OCO handling ---
            sl_type = sl_config.get('type', 'fixed') if sl_config else None
            sl_auto_be = bool(sl_config.get('auto_breakeven_enabled') or False) if sl_config else False
            tp_order_type_cfg = tp_config.get('order_type', 'Limit').lower() if tp_config else 'limit'
            if (
                exchange.id == 'binance'
                and not is_futures
                and not entry_order_id
                and tp_config
                and sl_config
                and sl_type == 'fixed'
                and not sl_auto_be
                and tp_order_type_cfg == 'limit'
            ):
                logger.info(f"⚡ Bracket Monitor: Using Native Binance OCO for {symbol} (Market Entry Fallback)")
                
                # Calculate TP & SL Prices
                tp_price = BracketOrderService._compute_tp_price(tp_config, average_price, opposite_side)
                sl_price = BracketOrderService._compute_sl_price(sl_config, average_price, opposite_side)
                
                try:
                    native_symbol = BracketOrderService._resolve_native_futures_symbol(exchange, symbol, False)
                    payload = {
                        "symbol": native_symbol,
                        "side": opposite_side.upper(),
                        "quantity": str(BracketOrderService._safe_amount_to_precision(exchange, symbol, final_amount)),
                    }
                    
                    if opposite_side == 'sell': # We bought, now we sell
                        payload['aboveType'] = 'LIMIT_MAKER'
                        payload['abovePrice'] = str(BracketOrderService._safe_price_to_precision(exchange, symbol, tp_price))
                        payload['belowType'] = 'STOP_LOSS_LIMIT'
                        payload['belowTimeInForce'] = 'GTC'
                        payload['belowStopPrice'] = str(BracketOrderService._safe_price_to_precision(exchange, symbol, sl_price))
                        payload['belowPrice'] = str(BracketOrderService._safe_price_to_precision(exchange, symbol, sl_price * 0.999))
                    else: # We sold, now we buy
                        payload['aboveType'] = 'STOP_LOSS_LIMIT'
                        payload['aboveTimeInForce'] = 'GTC'
                        payload['aboveStopPrice'] = str(BracketOrderService._safe_price_to_precision(exchange, symbol, sl_price))
                        payload['abovePrice'] = str(BracketOrderService._safe_price_to_precision(exchange, symbol, sl_price * 1.001))
                        payload['belowType'] = 'LIMIT_MAKER'
                        payload['belowPrice'] = str(BracketOrderService._safe_price_to_precision(exchange, symbol, tp_price))
                        
                    t_oco_start = time.perf_counter()
                    raw_res = await exchange.private_post_orderlist_oco(payload)
                    oco_placement_ms = max(1, int((time.perf_counter() - t_oco_start) * 1000))
                    if isinstance(raw_res, dict):
                        oco_lines = []
                        for rep in (raw_res.get('orderReports') or []):
                            rep_oid = str(rep.get('orderId') or '')
                            rep_type = str(rep.get('type', '')).upper()
                            if rep_oid:
                                if rep_type in ('LIMIT_MAKER', 'LIMIT'):
                                    BracketOrderService.KNOWN_TP_ORDER_IDS.add(rep_oid)
                                rep_px = float(rep.get('price') or rep.get('stopPrice') or (tp_price if rep_type in ('LIMIT_MAKER', 'LIMIT') else sl_price) or 0.0)
                                is_sl_leg = 'STOP' in rep_type
                                if rep_px > 0:
                                    oco_lines.append({
                                        'id': rep_oid,
                                        'side': opposite_side,
                                        'price': rep_px,
                                        'amount': float(final_amount),
                                        'filled': 0.0,
                                        'remaining': float(final_amount),
                                        'isSoftwareSL': is_sl_leg,
                                        'mode': 'STOP' if is_sl_leg else 'TP',
                                    })
                        if api_key_id is not None:
                            try:
                                from app.services.manual_trade_service import ManualTradeService
                                ManualTradeService.invalidate_open_orders_cache(int(api_key_id), symbol)
                            except Exception:
                                pass
                        if user_id and oco_lines and api_key_id is not None:
                            try:
                                from app.services.user_order_stream import publish_order_sync_event
                                asyncio.create_task(
                                    publish_order_sync_event(
                                        user_id=user_id,
                                        event="order_added",
                                        api_key_id=int(api_key_id),
                                        symbol=symbol,
                                        orders=oco_lines,
                                        replace_id=str(entry_order_id) if entry_order_id else None,
                                    )
                                )
                            except Exception:
                                pass
                    logger.info(f"✅ Native Binance OCO placed successfully in {oco_placement_ms}ms! ID: {raw_res.get('orderListId')}")
                    
                    if user_id:
                        async def _notify_oco():
                            try:
                                from app.db.session import SessionLocal
                                db = SessionLocal()
                                try:
                                    msg = (
                                        f"✅ *NATIVE OCO PLACED (SPOT)*\n"
                                        f"━━━━━━━━━━━━━━━━━━━━\n"
                                        f"• Exchange: Binance Spot\n"
                                        f"• Pair: `{symbol}`\n"
                                        f"• Amount: `{final_amount}`\n"
                                        f"• TP Target Price: `${BracketOrderService._safe_price_to_precision(exchange, symbol, tp_price)}`\n"
                                        f"• SL Trigger Price: `${BracketOrderService._safe_price_to_precision(exchange, symbol, sl_price)}`\n"
                                        f"⏱ Placement Speed: `{oco_placement_ms} ms` ⚡"
                                    )
                                    await NotificationService.send_message(db, user_id, msg, parse_mode="Markdown", alert_type="alert_manual_trade")
                                finally:
                                    db.close()
                            except Exception:
                                pass
                        asyncio.create_task(_notify_oco())
                    return # Exit since we placed both successfully!
                except Exception as e:
                    logger.warning(f"⚠️ Native OCO failed ({e}). Falling back to Software Bracket TP/SL.")

            # Execute TP and SL concurrently in 1 single RTT (~255ms) so chart lines appear right away!
            pre_sl_ids = set(BracketOrderService.ACTIVE_SOFTWARE_SL.keys()) if sl_config else set()

            async def _exec_tp_leg():
                nonlocal tp_order_id, resolved_tp_price
                if not tp_config:
                    return
                tp_order_type = tp_config.get('order_type', 'Limit').lower()
                mode          = tp_config.get('mode', 'percentage')
                val           = float(tp_config.get('value', 0))
                tp_price      = BracketOrderService._compute_tp_price(tp_config, average_price, opposite_side)
                final_tp_price = BracketOrderService._safe_price_to_precision(order_ex, symbol, tp_price)

                t_tp_start = time.perf_counter()
                ex_params = await BracketOrderService._apply_futures_exit_params(order_ex, symbol, opposite_side) if is_futures else {}
                try:
                    tp_res = None
                    async def _place_tp_limit(px: float, amt: float, p_dict: dict):
                        if getattr(order_ex, 'has', {}).get('createOrderWs') and is_ws_api_ready(
                            order_ex, is_futures=is_futures, is_inverse=is_inverse
                        ):
                            try:
                                from app.services.manual_trade_service import ManualTradeService
                                ws_type, ws_params = ManualTradeService._sanitize_ws_order_args(
                                    order_ex, 'limit', p_dict, is_futures, is_edit=False
                                )
                                return await order_ex.create_order_ws(symbol, ws_type, opposite_side, amt, px, ws_params)
                            except Exception:
                                pass
                        return await order_ex.create_limit_order(symbol, opposite_side, amt, px, p_dict)

                    if tp_order_type == 'limit':
                        # 1ms local Redis BBO check: if final_tp_price already crosses the book,
                        # skip the doomed Post-Only (GTX) attempt to avoid wasting 1 extra RTT (~255ms)
                        skip_post_only = False
                        try:
                            import json
                            from app.services.smart_peg_entry_executor import _get_redis_bbo
                            r_bbo = await asyncio.wait_for(_get_redis_bbo(), timeout=0.015)
                            if r_bbo is not None:
                                ex_name = str(getattr(order_ex, 'id', 'binance')).lower()
                                raw_bbo = await asyncio.wait_for(r_bbo.get(f"bbo:{ex_name}:{symbol}"), timeout=0.015)
                                if raw_bbo:
                                    bbo_d = json.loads(raw_bbo)
                                    if (time.time() - float(bbo_d.get("ts") or 0)) < 2.5:
                                        b_bid = float(bbo_d.get("bid") or 0)
                                        b_ask = float(bbo_d.get("ask") or 0)
                                        if opposite_side == 'buy' and b_ask > 0 and final_tp_price >= b_ask:
                                            skip_post_only = True
                                        elif opposite_side == 'sell' and b_bid > 0 and final_tp_price <= b_bid:
                                            skip_post_only = True
                        except Exception:
                            pass

                        if not skip_post_only:
                            # 1st attempt: Post-Only Maker limit order (saves fees)
                            ex_params_po = dict(ex_params)
                            ex_params_po['postOnly'] = True
                            try:
                                tp_res = await _place_tp_limit(final_tp_price, final_amount, ex_params_po)
                            except Exception as po_e:
                                logger.warning(f"⚠️ Bracket TP Post-Only rejected ({po_e}). Retrying immediately with standard GTC Limit...")
                                tp_res = None

                        # On Binance Futures, a GTX Post-Only order that crosses the book returns HTTP 200 with status='expired'
                        if not tp_res or str(tp_res.get('status', '')).lower() in ('expired', 'canceled', 'cancelled', 'rejected'):
                            if tp_res:
                                logger.warning(
                                    f"⚠️ Bracket TP Post-Only returned status='{tp_res.get('status')}' on {symbol}. "
                                    f"Retrying immediately with standard GTC Limit..."
                                )
                            ex_params_gtc = dict(ex_params)
                            ex_params_gtc.pop('postOnly', None)
                            ex_params_gtc['timeInForce'] = 'GTC'
                            tp_res = await _place_tp_limit(final_tp_price, final_amount, ex_params_gtc)
                            logger.info(f"✅ Bracket Monitor: Standard GTC Limit TP placed successfully! ID: {tp_res.get('id')}")
                        else:
                            logger.info(f"✅ Bracket Monitor: Maker Post-Only TP placed! ID: {tp_res.get('id')}")
                    else:
                        # Market TP: Place a conditional TAKE_PROFIT_MARKET order at final_tp_price on Futures
                        # (Never fire an immediate market order right after entry!)
                        if is_futures:
                            tp_cond_params = dict(ex_params)
                            tp_cond_params['stopPrice'] = final_tp_price
                            tp_res = await BracketOrderService._place_futures_conditional_order(
                                order_ex, symbol, 'TAKE_PROFIT_MARKET', opposite_side, final_amount,
                                stop_price=final_tp_price, extra_params=tp_cond_params
                            )
                            logger.info(f"✅ Bracket Monitor: Conditional TAKE_PROFIT_MARKET placed at {final_tp_price}! ID: {tp_res.get('id')}")
                        else:
                            ex_params_gtc = dict(ex_params)
                            ex_params_gtc.pop('postOnly', None)
                            ex_params_gtc['timeInForce'] = 'GTC'
                            tp_res = await _place_tp_limit(final_tp_price, final_amount, ex_params_gtc)
                            logger.info(f"✅ Bracket Monitor: Spot Limit TP placed at {final_tp_price}! ID: {tp_res.get('id')}")

                    tp_placement_ms = max(1, int((time.perf_counter() - t_tp_start) * 1000))
                    if tp_res:
                        tp_order_id = tp_res.get('id')
                        resolved_tp_price = float(final_tp_price)
                        if tp_order_id:
                            BracketOrderService.KNOWN_TP_ORDER_IDS.add(str(tp_order_id))

                    logger.info(f"✅ Bracket Monitor: TP placed in {tp_placement_ms}ms! ID: {tp_res.get('id') if tp_res else 'N/A'}")

                    if user_id and tp_res:
                        async def _notify_tp():
                            try:
                                from app.db.session import SessionLocal
                                db = SessionLocal()
                                try:
                                    tp_type_label = "Post-Only Maker" if tp_order_type == 'limit' else ("Conditional Market" if is_futures else "Limit")
                                    exchange_display = api_key_record.exchange.capitalize() if api_key_record else "Exchange"
                                    msg = (
                                        f"🎯 *TAKE-PROFIT ORDER PLACED*\n"
                                        f"━━━━━━━━━━━━━━━━━━━━\n"
                                        f"• Exchange: `{exchange_display}`\n"
                                        f"• Pair: `{symbol}`\n"
                                        f"• TP Side: *{opposite_side.upper()}*\n"
                                        f"• Amount: `{final_amount}`\n"
                                        f"• TP Target Price: `${final_tp_price}`\n"
                                        f"• Mode: `{mode}` ({val}{'%' if mode == 'percentage' else '$'})\n"
                                        f"• Order Type: `{tp_type_label}`\n"
                                        f"• Status: `Resting in Orderbook 🎯`\n"
                                        f"⏱ Placement Speed: `{tp_placement_ms} ms` ⚡"
                                    )
                                    await NotificationService.send_message(db, user_id, msg, parse_mode="Markdown", alert_type="alert_manual_trade")
                                finally:
                                    db.close()
                            except Exception as notify_err:
                                logger.warning(f"TP notification failed (non-fatal): {notify_err}")
                        asyncio.create_task(_notify_tp())

                except Exception as ex_e:
                    logger.error(f"❌ Bracket Monitor: Failed to place TP Order! {ex_e}")
                    if user_id:
                        asyncio.create_task(
                            BracketOrderService._send_bracket_failure_alert(
                                user_id, symbol, "Take-Profit (TP)", str(ex_e)
                            )
                        )

            async def _exec_sl_leg():
                if not sl_config:
                    return
                sl_type = sl_config.get('type', 'fixed')
                sl_mode = sl_config.get('mode', 'percentage')
                sl_val  = float(sl_config.get('value', 0))
                
                atr_period = int(BracketOrderService._get_sl_param(sl_config, 'atr_period', 'atrPeriod', 10))
                atr_multiplier = float(BracketOrderService._get_sl_param(sl_config, 'atr_multiplier', 'atrMultiplier', 2.0))
                atr_timeframe = str(BracketOrderService._get_sl_param(sl_config, 'atr_timeframe', 'atrTimeframe', '15m'))

                is_trailing_chase = (sl_type == 'trailing_chase')
                peg_strategy = str(BracketOrderService._get_sl_param(sl_config, 'smart_chase_peg_strategy', 'smartChasePegStrategy', 'bbo')).lower()
                wall_multiplier = float(BracketOrderService._get_sl_param(sl_config, 'smart_chase_wall_multiplier', 'smartChaseWallMultiplier', 2.5))
                auto_breakeven_enabled = bool(BracketOrderService._get_sl_param(sl_config, 'auto_breakeven_enabled', 'autoBreakevenEnabled', False))
                auto_breakeven_trigger_pct = float(BracketOrderService._get_sl_param(sl_config, 'auto_breakeven_trigger_pct', 'autoBreakevenTriggerPct', 1.0))
                auto_breakeven_buffer_pct = float(BracketOrderService._get_sl_param(sl_config, 'auto_breakeven_buffer_pct', 'autoBreakevenBufferPct', 0.05))
                max_dev = float(BracketOrderService._get_sl_param(sl_config, 'smart_chase_deviation_pct', 'smartChaseDeviationPct', 1.0))
                chase_delay = int(BracketOrderService._get_sl_param(sl_config, 'smart_chase_delay_ms', 'smartChaseDelayMs', 1500))
                max_attempts = int(BracketOrderService._get_sl_param(sl_config, 'smart_chase_max_attempts', 'smartChaseMaxAttempts', 10000))
                chase_mode = str(BracketOrderService._get_sl_param(sl_config, 'smart_chase_mode', 'smartChaseMode', 'dynamic_bbo')).lower()
                trigger_source = str(BracketOrderService._get_sl_param(sl_config, 'smart_chase_trigger_source', 'smartChaseTriggerSource', 'bid_ask')).lower()
                anti_wick_mode = str(BracketOrderService._get_sl_param(sl_config, 'anti_wick_mode', 'antiWickMode', 'instant')).lower()
                anti_wick_dwell_seconds = float(BracketOrderService._get_sl_param(sl_config, 'anti_wick_dwell_seconds', 'antiWickDwellSeconds', 3.0))
                anti_wick_timeframe = str(BracketOrderService._get_sl_param(sl_config, 'anti_wick_timeframe', 'antiWickTimeframe', '1m')).lower()
                anti_wick_disaster_pct = float(BracketOrderService._get_sl_param(sl_config, 'anti_wick_disaster_pct', 'antiWickDisasterPct', 2.0))

                if sl_type in ['trailing', 'trailing_chase']:
                    placed_native = False
                    if (
                        not is_trailing_chase
                        and not auto_breakeven_enabled
                        and anti_wick_mode == 'instant'
                        and is_futures
                        and sl_mode == 'percentage'
                    ):
                        # Try Native Trailing Stop Market for Futures (Taker Exit)
                        try:
                            logger.info(f"🚀 Bracket Monitor: Placing Native Trailing Stop for {symbol} (Futures)")
                            sl_params = await BracketOrderService._apply_futures_exit_params(
                                order_ex, symbol, opposite_side, {'callbackRate': sl_val}
                            )
                            sl_res = await BracketOrderService._place_futures_conditional_order(
                                order_ex, symbol, 'TRAILING_STOP_MARKET', opposite_side, final_amount,
                                callback_rate=sl_val, extra_params=sl_params
                            )
                            logger.info(f"✅ Native Trailing SL placed! ID: {sl_res.get('id')}")
                            placed_native = True
                            
                            if user_id:
                                async def _notify_trail():
                                    try:
                                        from app.db.session import SessionLocal
                                        db = SessionLocal()
                                        try:
                                            msg = (
                                                f"🛡️ *Native Trailing SL Executed*\n"
                                                f"Exchange: {api_key_record.exchange.capitalize()}\n"
                                                f"Pair: `{symbol}`\n"
                                                f"Callback Rate: `{sl_val}%`"
                                            )
                                            await NotificationService.send_message(db, user_id, msg, alert_type="alert_manual_trade")
                                        finally:
                                            db.close()
                                    except Exception:
                                        pass
                                asyncio.create_task(_notify_trail())

                            # Spawn OCO Watchdog so Native Trailing SL and TP cancel each other when one fills
                            init_trail_sl = (
                                average_price * (1 - sl_val / 100.0)
                                if opposite_side == 'sell'
                                else average_price * (1 + sl_val / 100.0)
                            )
                            asyncio.create_task(
                                BracketOrderService._fixed_sl_auto_breakeven_loop(
                                    exchange=exchange,
                                    symbol=symbol,
                                    opposite_side=opposite_side,
                                    amount=final_amount,
                                    entry_price=average_price,
                                    initial_sl_price=BracketOrderService._safe_price_to_precision(exchange, symbol, init_trail_sl),
                                    is_futures=is_futures,
                                    user_id=user_id,
                                    api_key_record=api_key_record,
                                    tp_order_id=tp_order_id,
                                    disaster_sl_order_id=sl_res.get('id') if sl_res else None,
                                    auto_breakeven_enabled=False,
                                    auto_breakeven_trigger_pct=auto_breakeven_trigger_pct,
                                    auto_breakeven_buffer_pct=auto_breakeven_buffer_pct,
                                    entry_order_id=entry_order_id
                                )
                            )
                        except Exception as e:
                            logger.error(f"❌ Failed to place native Trailing SL: {e}. Falling back to software loop.")
                    
                    # Trailing Chase MUST run via Software Maker Loop (never native taker)
                    if is_trailing_chase:
                        placed_native = False

                    if not placed_native:
                        logger.info(f"🚀 Bracket Monitor: Starting Software {'Trailing Chase (Maker)' if is_trailing_chase else 'Trailing Stop'} for {symbol}")
                        asyncio.create_task(
                            BracketOrderService._software_trailing_stop_loop(
                                exchange=exchange,
                                symbol=symbol,
                                opposite_side=opposite_side,
                                amount=final_amount,
                                entry_price=average_price,
                                mode=sl_mode,
                                val=sl_val,
                                is_futures=is_futures,
                                user_id=user_id,
                                api_key_record=api_key_record,
                                atr_period=atr_period,
                                atr_multiplier=atr_multiplier,
                                atr_timeframe=atr_timeframe,
                                tp_order_id=tp_order_id,
                                is_smart_chase_exit=is_trailing_chase,
                                max_deviation_pct=max_dev,
                                chase_delay_ms=chase_delay,
                                max_attempts=max_attempts,
                                chase_mode=chase_mode,
                                trigger_source=trigger_source,
                                peg_strategy=peg_strategy,
                                wall_multiplier=wall_multiplier,
                                auto_breakeven_enabled=auto_breakeven_enabled,
                                auto_breakeven_trigger_pct=auto_breakeven_trigger_pct,
                                auto_breakeven_buffer_pct=auto_breakeven_buffer_pct,
                                entry_order_id=entry_order_id,
                                tp_price=resolved_tp_price,
                                anti_wick_mode=anti_wick_mode,
                                anti_wick_dwell_seconds=anti_wick_dwell_seconds,
                                anti_wick_timeframe=anti_wick_timeframe,
                                anti_wick_disaster_pct=anti_wick_disaster_pct,
                            )
                        )
                elif sl_type == 'smart_chase':
                    sl_price = BracketOrderService._compute_sl_price(sl_config, average_price, opposite_side) or average_price
                    final_sl_price = BracketOrderService._safe_price_to_precision(exchange, symbol, sl_price)

                    disaster_sl_order_id = None
                    if is_futures:
                        try:
                            eff_dis_pct = max(float(max_dev), float(anti_wick_disaster_pct)) if anti_wick_mode != 'instant' else float(max_dev)
                            disaster_price = final_sl_price * (1 - (eff_dis_pct / 100.0)) if opposite_side == 'sell' else final_sl_price * (1 + (eff_dis_pct / 100.0))
                            disaster_price_prec = BracketOrderService._safe_price_to_precision(order_ex, symbol, disaster_price)
                            disaster_params = await BracketOrderService._apply_futures_exit_params(
                                order_ex, symbol, opposite_side, {'stopPrice': disaster_price_prec}
                            )
                            d_res = await BracketOrderService._place_futures_conditional_order(
                                order_ex, symbol, 'STOP_MARKET', opposite_side, final_amount,
                                stop_price=disaster_price_prec, extra_params=disaster_params
                            )
                            disaster_sl_order_id = d_res.get('id')
                            logger.info(f"🛡️ Bracket Monitor: Native Disaster SL placed at {disaster_price_prec} (ID: {disaster_sl_order_id})")
                        except Exception as d_err:
                            logger.warning(f"⚠️ Failed to place native disaster SL: {d_err}")

                    side_tag = "BUY (Buy-Back ⚡)" if opposite_side.lower() == 'buy' else "SELL (Long Exit 🛡️)"
                    tp_tag = f" | Linked TP: #{tp_order_id}" if tp_order_id else ""
                    logger.info(
                        f"🚀 Bracket Monitor: Starting Smart Chase Limit SL for {symbol} | Action: {side_tag} | "
                        f"Amount: {final_amount} | Trigger: {final_sl_price}{tp_tag} | "
                        f"Strategy: {peg_strategy.upper()} | Mode: {chase_mode.upper()} | Anti-Wick: {anti_wick_mode.upper()}"
                    )
                    asyncio.create_task(
                        BracketOrderService._smart_chase_monitor_loop(
                            exchange=exchange,
                            symbol=symbol,
                            opposite_side=opposite_side,
                            amount=final_amount,
                            entry_price=average_price,
                            sl_price=final_sl_price,
                            max_deviation_pct=max_dev,
                            chase_delay_ms=chase_delay,
                            max_attempts=max_attempts,
                            is_futures=is_futures,
                            user_id=user_id,
                            api_key_record=api_key_record,
                            tp_order_id=tp_order_id,
                            disaster_sl_order_id=disaster_sl_order_id,
                            chase_mode=chase_mode,
                            trigger_source=trigger_source,
                            peg_strategy=peg_strategy,
                            wall_multiplier=wall_multiplier,
                            auto_breakeven_enabled=auto_breakeven_enabled,
                            auto_breakeven_trigger_pct=auto_breakeven_trigger_pct,
                            auto_breakeven_buffer_pct=auto_breakeven_buffer_pct,
                            entry_order_id=entry_order_id,
                            tp_price=resolved_tp_price,
                            anti_wick_mode=anti_wick_mode,
                            anti_wick_dwell_seconds=anti_wick_dwell_seconds,
                            anti_wick_timeframe=anti_wick_timeframe,
                            anti_wick_disaster_pct=anti_wick_disaster_pct,
                        )
                    )
                else:
                    sl_price = BracketOrderService._compute_sl_price(sl_config, average_price, opposite_side) or average_price
                    final_sl_price = BracketOrderService._safe_price_to_precision(exchange, symbol, sl_price)

                    if not is_futures:
                        logger.info(
                            f"🛡️ Bracket Monitor: Starting Software Fixed SL Monitor for Spot {symbol} at {final_sl_price} "
                            f"(Auto-Breakeven: {auto_breakeven_enabled} | Anti-Wick: {anti_wick_mode.upper()})"
                        )
                        asyncio.create_task(
                            BracketOrderService._fixed_sl_auto_breakeven_loop(
                                exchange=exchange,
                                symbol=symbol,
                                opposite_side=opposite_side,
                                amount=final_amount,
                                entry_price=average_price,
                                initial_sl_price=final_sl_price,
                                is_futures=False,
                                user_id=user_id,
                                api_key_record=api_key_record,
                                tp_order_id=tp_order_id,
                                disaster_sl_order_id=None,
                                auto_breakeven_enabled=auto_breakeven_enabled,
                                auto_breakeven_trigger_pct=auto_breakeven_trigger_pct,
                                auto_breakeven_buffer_pct=auto_breakeven_buffer_pct,
                                entry_order_id=entry_order_id,
                                tp_price=resolved_tp_price,
                                anti_wick_mode=anti_wick_mode,
                                anti_wick_dwell_seconds=anti_wick_dwell_seconds,
                                anti_wick_timeframe=anti_wick_timeframe,
                                anti_wick_disaster_pct=anti_wick_disaster_pct,
                            )
                        )
                    else:
                        if anti_wick_mode in ('dwell', 'candle_close'):
                            from app.services.anti_wick_guard import compute_anti_wick_disaster_price
                            native_stop_px = BracketOrderService._safe_price_to_precision(
                                order_ex,
                                symbol,
                                compute_anti_wick_disaster_price(final_sl_price, opposite_side, anti_wick_disaster_pct),
                            ) or final_sl_price
                        else:
                            native_stop_px = final_sl_price
                        sl_params = await BracketOrderService._apply_futures_exit_params(
                            order_ex, symbol, opposite_side, {'stopPrice': native_stop_px}
                        )
                        sl_res = None
                        try:
                            sl_res = await BracketOrderService._place_futures_conditional_order(
                                order_ex, symbol, 'STOP_MARKET', opposite_side, final_amount,
                                stop_price=native_stop_px, extra_params=sl_params
                            )
                            logger.info(
                                f"✅ Bracket Monitor: SL placed at {native_stop_px}"
                                f"{f' (Disaster cushion for {anti_wick_mode} @ {final_sl_price})' if anti_wick_mode != 'instant' else ''}! "
                                f"ID: {sl_res.get('id') if sl_res else 'Local'}"
                            )

                            if user_id:
                                async def _notify_fixed_sl():
                                    try:
                                        from app.db.session import SessionLocal
                                        db = SessionLocal()
                                        try:
                                            msg = (
                                                f"🛡️ *Bracket SL Executed (Chunk)*\n"
                                                f"Exchange: {api_key_record.exchange.capitalize()}\n"
                                                f"Pair: `{symbol}`\n"
                                                f"SL Side: {opposite_side.upper()}\n"
                                                f"Amount: `{final_amount}`\n"
                                                f"Stop Price: `{final_sl_price}`\n"
                                                f"Mode: {sl_mode} ({sl_val}{'%' if sl_mode == 'percentage' else '$'})"
                                            )
                                            await NotificationService.send_message(db, user_id, msg, alert_type="alert_manual_trade")
                                        finally:
                                            db.close()
                                    except Exception as notify_err:
                                        logger.warning(f"SL notification failed (non-fatal): {notify_err}")
                                asyncio.create_task(_notify_fixed_sl())

                        except Exception as ex_e:
                            logger.error(
                                f"❌ Bracket Monitor: Native STOP_MARKET SL failed on {symbol} ({ex_e}). "
                                f"Falling back to Software Fixed SL Monitor at {final_sl_price}!"
                            )
                            if user_id:
                                asyncio.create_task(
                                    BracketOrderService._send_bracket_failure_alert(
                                        user_id, symbol, "Stop-Loss (Native -> Software Fallback Active)", str(ex_e)
                                    )
                                )

                        # Always spawn OCO Watchdog / Software SL Fallback (and Auto-Breakeven / Anti-Wick if enabled)
                        logger.info(
                            f"🛡️ Spawning Fixed SL {'Anti-Wick' if anti_wick_mode != 'instant' else ('Auto-Breakeven' if auto_breakeven_enabled else 'OCO Watchdog')} loop for {symbol} "
                            f"(SL: {sl_res.get('id') if sl_res else 'Software-Fallback'}, TP: {tp_order_id or 'None'})"
                        )
                        asyncio.create_task(
                            BracketOrderService._fixed_sl_auto_breakeven_loop(
                                exchange=exchange,
                                symbol=symbol,
                                opposite_side=opposite_side,
                                amount=final_amount,
                                entry_price=average_price,
                                initial_sl_price=final_sl_price,
                                is_futures=is_futures,
                                user_id=user_id,
                                api_key_record=api_key_record,
                                tp_order_id=tp_order_id,
                                disaster_sl_order_id=sl_res.get('id') if sl_res else None,
                                auto_breakeven_enabled=auto_breakeven_enabled,
                                auto_breakeven_trigger_pct=auto_breakeven_trigger_pct,
                                auto_breakeven_buffer_pct=auto_breakeven_buffer_pct,
                                entry_order_id=entry_order_id,
                                tp_price=resolved_tp_price,
                                anti_wick_mode=anti_wick_mode,
                                anti_wick_dwell_seconds=anti_wick_dwell_seconds,
                                anti_wick_timeframe=anti_wick_timeframe,
                                anti_wick_disaster_pct=anti_wick_disaster_pct,
                            )
                        )

            leg_tasks = []
            if tp_config:
                leg_tasks.append(_exec_tp_leg())
            if sl_config:
                leg_tasks.append(_exec_sl_leg())
            if leg_tasks:
                await asyncio.gather(*leg_tasks)

            eb_key = str(entry_order_id) if entry_order_id else (matched_eb_key or (f"tp:{tp_order_id}" if tp_order_id else None))
            resolved_tp_id = str(tp_order_id) if tp_order_id else None
            if eb_key:
                prev_eb = BracketOrderService.ACTIVE_ENTRY_BRACKETS.get(eb_key)
                if not resolved_tp_id and prev_eb and not tp_config:
                    resolved_tp_id = str(prev_eb.get('tp_order_id') or '') or None
                if not resolved_tp_price and prev_eb and not tp_config and prev_eb.get('tp_price'):
                    resolved_tp_price = float(prev_eb['tp_price'])
                resolved_eb_entry = (
                    str(entry_order_id) if entry_order_id
                    else (prev_eb.get('entry_order_id') if prev_eb else None)
                )
                BracketOrderService.ACTIVE_ENTRY_BRACKETS[eb_key] = {
                    'entry_order_id': resolved_eb_entry,
                    'api_key_id': api_key_id,
                    'symbol': symbol,
                    'side': opposite_side,
                    'amount': final_amount,
                    'entry_price': average_price,
                    'tp_order_id': resolved_tp_id,
                    'tp_price': resolved_tp_price,
                    'cancelled': False,
                }
            if eb_key or sl_config:
                # Yield 1 event-loop tick so any spawned SL monitor task registers in ACTIVE_SOFTWARE_SL before lock release
                await asyncio.sleep(0)

            # Sync TP link into newly spawned SL monitors + push instant chart lines via WS order_sync
            pushed_bracket_lines = []
            if resolved_tp_id and resolved_tp_price:
                tp_line = {
                    'id': str(resolved_tp_id),
                    'side': opposite_side,
                    'price': float(resolved_tp_price),
                    'amount': float(final_amount),
                    'filled': 0.0,
                    'remaining': float(final_amount),
                    'isSoftwareSL': False,
                    'mode': 'TP',
                    'isPostOnly': bool(tp_order_type_cfg == 'limit'),
                }
                pushed_bracket_lines.append(tp_line)
                if api_key_id is not None:
                    try:
                        from app.services.manual_trade_service import ManualTradeService
                        ManualTradeService._ORDER_META_CACHE[(int(api_key_id), str(resolved_tp_id))] = (tp_line, time.time())
                    except Exception:
                        pass

            if sl_config:
                for sid, sdata in list(BracketOrderService.ACTIVE_SOFTWARE_SL.items()):
                    if sid not in pre_sl_ids and isinstance(sdata, dict) and not sdata.get('cancelled'):
                        tp_linked = False
                        if resolved_tp_id and not sdata.get('tp_order_id'):
                            sdata['tp_order_id'] = str(resolved_tp_id)
                            tp_linked = True
                        if resolved_tp_price and not sdata.get('tp_price'):
                            sdata['tp_price'] = float(resolved_tp_price)
                            tp_linked = True
                        if tp_linked:
                            try:
                                from app.services.manual_trade_persistence import schedule_update_monitor
                                tp_upd = {}
                                if sdata.get('tp_order_id'):
                                    tp_upd['tp_order_id'] = str(sdata['tp_order_id'])
                                if sdata.get('tp_price'):
                                    tp_upd['tp_price'] = float(sdata['tp_price'])
                                if tp_upd:
                                    schedule_update_monitor(str(sid), fields=tp_upd)
                            except Exception:
                                pass
                        sl_px = float(sdata.get('trigger_price') if sdata.get('trigger_price') is not None else sdata.get('price', 0.0))
                        if sl_px > 0 and sdata.get('status') != 'pegging':
                            pushed_bracket_lines.append({
                                'id': str(sid),
                                'side': str(sdata.get('side') or opposite_side),
                                'price': sl_px,
                                'amount': float(sdata.get('amount') or final_amount),
                                'filled': 0.0,
                                'remaining': float(sdata.get('amount') or final_amount),
                                'isSoftwareSL': True,
                                'mode': sdata.get('mode', 'SMART_CHASE'),
                                'type': sdata.get('type', 'smart_chase'),
                            })

            if api_key_id is not None:
                try:
                    from app.services.manual_trade_service import ManualTradeService
                    ManualTradeService.invalidate_open_orders_cache(int(api_key_id), symbol)
                except Exception:
                    pass
                if user_id and pushed_bracket_lines:
                    try:
                        from app.services.user_order_stream import publish_order_sync_event
                        asyncio.create_task(
                            publish_order_sync_event(
                                user_id=user_id,
                                event="order_added",
                                api_key_id=int(api_key_id),
                                symbol=symbol,
                                orders=pushed_bracket_lines,
                                replace_id=str(entry_order_id) if entry_order_id else None,
                            )
                        )
                    except Exception:
                        pass

            return {
                'tp_order_id': resolved_tp_id,
                'tp_price': resolved_tp_price,
                'entry_order_id': str(entry_order_id) if entry_order_id else None,
                'amount': final_amount,
            }

        except Exception as chunk_e:
            logger.error(f"Failed to spawn bracket for chunk: {chunk_e}")
        finally:
            if entry_lock is not None and entry_lock.locked():
                entry_lock.release()


    @staticmethod
    async def _software_trailing_stop_loop(
        exchange, symbol: str, opposite_side: str, amount: float,
        entry_price: float, mode: str, val: float, is_futures: bool,
        user_id: int, api_key_record,
        atr_period: int = 10, atr_multiplier: float = 2.0, atr_timeframe: str = '15m',
        tp_order_id: str = None,
        is_smart_chase_exit: bool = False,
        max_deviation_pct: float = 1.0,
        chase_delay_ms: int = 1500,
        max_attempts: int = 10000,
        chase_mode: str = 'dynamic_bbo',
        trigger_source: str = 'bid_ask',
        peg_strategy: str = 'bbo',
        wall_multiplier: float = 2.5,
        auto_breakeven_enabled: bool = False,
        auto_breakeven_trigger_pct: float = 1.0,
        auto_breakeven_buffer_pct: float = 0.05,
        entry_order_id: str = None,
        tp_price: float = None,
        sl_id: Optional[str] = None,
        initial_highest_price: Optional[float] = None,
        initial_lowest_price: Optional[float] = None,
        initial_breakeven_activated: bool = False,
        initial_manual_trigger_override: Optional[float] = None,
        initial_trigger_price: Optional[float] = None,
        anti_wick_mode: str = 'instant',
        anti_wick_dwell_seconds: float = 3.0,
        anti_wick_timeframe: str = '1m',
        anti_wick_disaster_pct: float = 2.0,
    ):
        highest_price = float(initial_highest_price) if initial_highest_price else entry_price
        lowest_price = float(initial_lowest_price) if initial_lowest_price else entry_price
        init_trig = (
            float(initial_trigger_price)
            if initial_trigger_price is not None
            else (float(initial_manual_trigger_override) if initial_manual_trigger_override is not None else entry_price)
        )
        
        sl_id = sl_id or str(uuid.uuid4())
        BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id] = {
            'id': sl_id,
            'entry_order_id': str(entry_order_id) if entry_order_id else None,
            'api_key_id': getattr(api_key_record, 'id', None),
            'api_key_record': api_key_record,
            'user_id': user_id,
            'symbol': symbol,
            'side': opposite_side,
            'amount': amount,
            'type': 'trailing_chase' if is_smart_chase_exit else 'trailing',
            'mode': 'TRAILING_CHASE' if is_smart_chase_exit else mode,
            'price': init_trig,
            'trigger_price': init_trig,
            'highest_price': highest_price,
            'lowest_price': lowest_price,
            'entry_price': entry_price,
            'val': val,
            'is_futures': is_futures,
            'exchange': exchange,
            'status': 'monitoring',
            'chase_mode': chase_mode,
            'trigger_source': trigger_source,
            'peg_strategy': peg_strategy,
            'wall_multiplier': wall_multiplier,
            'auto_breakeven_enabled': auto_breakeven_enabled,
            'auto_breakeven_trigger_pct': auto_breakeven_trigger_pct,
            'auto_breakeven_buffer_pct': auto_breakeven_buffer_pct,
            'breakeven_activated': bool(initial_breakeven_activated),
            'anti_wick_mode': str(anti_wick_mode or 'instant').lower(),
            'anti_wick_dwell_seconds': float(anti_wick_dwell_seconds or 3.0),
            'anti_wick_timeframe': str(anti_wick_timeframe or '1m').lower(),
            'anti_wick_disaster_pct': float(anti_wick_disaster_pct or 2.0),
            'anti_wick_state': 'monitoring',
            'max_deviation_pct': max_deviation_pct,
            'max_attempts': max_attempts,
            'chase_delay_ms': chase_delay_ms,
            'tp_order_id': str(tp_order_id) if tp_order_id else None,
            'tp_price': float(tp_price) if tp_price else None
        }
        if initial_manual_trigger_override is not None:
            BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]['manual_trigger_override'] = float(initial_manual_trigger_override)
        try:
            from app.services.manual_trade_persistence import schedule_upsert_monitor
            schedule_upsert_monitor(
                monitor_id=sl_id,
                kind='software_sl',
                user_id=user_id,
                api_key_id=getattr(api_key_record, 'id', None),
                symbol=symbol,
                is_futures=is_futures,
                side=opposite_side,
                status='monitoring',
                sl_type='trailing_chase' if is_smart_chase_exit else 'trailing',
                sl_mode='TRAILING_CHASE' if is_smart_chase_exit else str(mode),
                amount=float(amount or 0.0),
                entry_price=float(entry_price or 0.0),
                trigger_price=float(init_trig),
                highest_price=highest_price,
                lowest_price=lowest_price,
                entry_order_id=str(entry_order_id) if entry_order_id else None,
                tp_order_id=str(tp_order_id) if tp_order_id else None,
                tp_price=float(tp_price) if tp_price else None,
                breakeven_activated=bool(initial_breakeven_activated),
                manual_trigger_override=float(initial_manual_trigger_override) if initial_manual_trigger_override is not None else None,
                config={
                    'val': float(val or 0.0),
                    'sl_mode_raw': str(mode),
                    'atr_period': int(atr_period),
                    'atr_multiplier': float(atr_multiplier),
                    'atr_timeframe': str(atr_timeframe),
                    'is_smart_chase_exit': bool(is_smart_chase_exit),
                    'max_deviation_pct': float(max_deviation_pct),
                    'chase_delay_ms': int(chase_delay_ms),
                    'max_attempts': int(max_attempts),
                    'chase_mode': str(chase_mode),
                    'trigger_source': str(trigger_source),
                    'peg_strategy': str(peg_strategy),
                    'wall_multiplier': float(wall_multiplier),
                    'auto_breakeven_enabled': bool(auto_breakeven_enabled),
                    'auto_breakeven_trigger_pct': float(auto_breakeven_trigger_pct),
                    'auto_breakeven_buffer_pct': float(auto_breakeven_buffer_pct),
                    'anti_wick_mode': str(anti_wick_mode or 'instant').lower(),
                    'anti_wick_dwell_seconds': float(anti_wick_dwell_seconds or 3.0),
                    'anti_wick_timeframe': str(anti_wick_timeframe or '1m').lower(),
                    'anti_wick_disaster_pct': float(anti_wick_disaster_pct or 2.0),
                },
            )
        except Exception:
            pass

        logger.info(
            f"🏁 {'Trailing Chase (Maker)' if is_smart_chase_exit else 'Trailing SL'} loop started for {symbol} | "
            f"Entry: {entry_price} | Strategy: {peg_strategy.upper()}"
        )

        # ATR Calculation Setup
        last_atr_fetch_time = 0
        current_atr = 0.0
        current_price = entry_price  # Fix: Initialize current_price before loop
        sl_triggered = False
        loop_tick = 0
        pos_closed_streak = 0
        was_tp_touched = False
        
        ut_bot = None
        if mode == 'atr':
            from app.strategies.helpers.ut_bot_tracker import UTBotTracker
            # We assume use_heikin_ashi=False for now since manual trade doesn't specify
            ut_bot = UTBotTracker(exchange.id, symbol, sensitivity=atr_multiplier, atr_period=atr_period, use_heikin_ashi=False, timeframe=atr_timeframe)

        while True:
            aw_trail_pre = str(
                (BracketOrderService.ACTIVE_SOFTWARE_SL.get(sl_id) or {}).get('anti_wick_mode') or anti_wick_mode or 'instant'
            ).lower() != 'instant'
            await asyncio.sleep(0.3 if (is_smart_chase_exit or aw_trail_pre) else 1.0)  # Ultra-responsive 300ms poll for Trailing Chase & Anti-Wick
            loop_tick += 1
            # Check if monitor was cancelled by user
            sl_meta = BracketOrderService.ACTIVE_SOFTWARE_SL.get(sl_id)
            if not sl_meta or sl_meta.get('cancelled'):
                logger.info(f"🛑 Trailing SL monitor cancelled by user for {symbol}.")
                try:
                    from app.services.manual_trade_persistence import schedule_mark_terminal
                    schedule_mark_terminal(sl_id, status='cancelled', reason='trailing_cancelled')
                except Exception:
                    pass
                BracketOrderService._mark_entry_bracket_closed(
                    entry_order_id=(sl_meta.get('entry_order_id') if sl_meta else entry_order_id),
                    tp_order_id=((sl_meta.get('tp_order_id') if sl_meta else None) or tp_order_id),
                )
                if sl_id in BracketOrderService.ACTIVE_SOFTWARE_SL:
                    del BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]
                return

            # Keep dynamic entry_price, amount, TP, settings, and disaster order IDs synchronized
            if sl_meta.get('entry_price'):
                entry_price = float(sl_meta['entry_price'])
            if sl_meta.get('amount') is not None:
                amount = float(sl_meta['amount'])
            if sl_meta.get('tp_order_id'):
                tp_order_id = sl_meta['tp_order_id']
            if sl_meta.get('max_attempts') is not None:
                max_attempts = int(sl_meta['max_attempts'])
            if sl_meta.get('chase_delay_ms'):
                chase_delay_ms = int(sl_meta['chase_delay_ms'])
            if sl_meta.get('trigger_source'):
                trigger_source = str(sl_meta['trigger_source']).lower()
            if sl_meta.get('chase_mode'):
                chase_mode = str(sl_meta['chase_mode']).lower()
            if sl_meta.get('peg_strategy'):
                peg_strategy = str(sl_meta['peg_strategy']).lower()
            if sl_meta.get('max_deviation_pct'):
                max_deviation_pct = float(sl_meta['max_deviation_pct'])
            if sl_meta.get('wall_multiplier'):
                wall_multiplier = float(sl_meta['wall_multiplier'])
            if 'auto_breakeven_enabled' in sl_meta:
                auto_breakeven_enabled = bool(sl_meta['auto_breakeven_enabled'])
            if sl_meta.get('auto_breakeven_trigger_pct'):
                auto_breakeven_trigger_pct = float(sl_meta['auto_breakeven_trigger_pct'])
            if sl_meta.get('auto_breakeven_buffer_pct'):
                auto_breakeven_buffer_pct = float(sl_meta['auto_breakeven_buffer_pct'])
            if sl_meta.get('anti_wick_mode'):
                anti_wick_mode = str(sl_meta['anti_wick_mode']).lower()
            if sl_meta.get('anti_wick_dwell_seconds') is not None:
                anti_wick_dwell_seconds = float(sl_meta['anti_wick_dwell_seconds'])
            if sl_meta.get('anti_wick_timeframe'):
                anti_wick_timeframe = str(sl_meta['anti_wick_timeframe']).lower()
            if sl_meta.get('anti_wick_disaster_pct') is not None:
                anti_wick_disaster_pct = float(sl_meta['anti_wick_disaster_pct'])

            try:
                ticker = await BracketOrderService._fetch_ticker_fast(
                    exchange, symbol, require_last=(trigger_source not in ['bid_ask', 'bbo'])
                )
                last_price = float(ticker.get('last') or 0.0)
                best_bid = float(ticker.get('bid') or last_price)
                best_ask = float(ticker.get('ask') or last_price)
                if trigger_source in ['bid_ask', 'bbo']:
                    current_price = best_bid if opposite_side == 'sell' else best_ask
                else:
                    current_price = last_price
                if not current_price:
                    continue

                curr_tp_price = float(sl_meta.get('tp_price') or tp_price or 0.0)
                if curr_tp_price > 0:
                    if opposite_side == 'sell' and max(last_price, best_bid, best_ask) >= curr_tp_price * 0.998:
                        was_tp_touched = True
                    elif opposite_side == 'buy' and min(last_price, best_bid, best_ask) <= curr_tp_price * 1.002:
                        was_tp_touched = True

                # Security Check: Ensure linked TP or Futures position hasn't closed (keep REST cadence ~3.6-4.0s even at 0.3s loop)
                trail_rest_mod = 12 if (is_smart_chase_exit or aw_trail_pre) else 4
                if was_tp_touched or not curr_tp_price or loop_tick % trail_rest_mod == 0:
                    tp_filled = await BracketOrderService._check_linked_tp_filled(
                        exchange=exchange,
                        symbol=symbol,
                        is_futures=is_futures,
                        sl_meta=sl_meta,
                        fallback_tp_order_id=tp_order_id,
                        user_id=user_id,
                        entry_price=entry_price,
                        opposite_side=opposite_side,
                        default_amount=amount,
                        context_label="trailing stop monitor",
                    )

                    if tp_filled:
                        break

                if is_futures and loop_tick > 5 and loop_tick % trail_rest_mod == 0:
                    try:
                        pos_open = await BracketOrderService._check_futures_position_is_open(exchange, symbol, opposite_side)
                        if not pos_open:
                            pos_closed_streak += 1
                        else:
                            pos_closed_streak = 0
                        if pos_closed_streak >= 2:
                            logger.info(f"🚫 Position closed externally. Canceling software trailing stop for {symbol}.")
                            curr_tp = sl_meta.get('tp_order_id') or tp_order_id
                            if curr_tp:
                                await BracketOrderService._cancel_futures_order_universal(exchange, curr_tp, symbol)
                            BracketOrderService._mark_entry_bracket_closed(
                                entry_order_id=sl_meta.get('entry_order_id'),
                                tp_order_id=curr_tp,
                            )
                            break
                    except Exception as pos_e:
                        logger.debug(f"Position check non-fatal error: {pos_e}")

                # ── AUTO-BREAKEVEN CHECK ──
                if auto_breakeven_enabled and not sl_meta.get('breakeven_activated', False) and entry_price > 0 and current_price > 0:
                    profit_pct = 0.0
                    if opposite_side == 'sell':
                        profit_pct = ((current_price - entry_price) / entry_price) * 100.0
                    else:
                        profit_pct = ((entry_price - current_price) / entry_price) * 100.0

                    if profit_pct >= auto_breakeven_trigger_pct:
                        be_buf = auto_breakeven_buffer_pct / 100.0
                        target_be = entry_price * (1.0 + be_buf) if opposite_side == 'sell' else entry_price * (1.0 - be_buf)
                        target_be = BracketOrderService._safe_price_to_precision(exchange, symbol, target_be)

                        should_move = False
                        curr_trig = float(sl_meta.get('trigger_price') or 0.0)
                        if opposite_side == 'sell' and target_be > curr_trig:
                            should_move = True
                        elif opposite_side == 'buy' and (curr_trig == 0 or target_be < curr_trig):
                            should_move = True

                        if should_move:
                            sl_meta['breakeven_activated'] = True
                            sl_meta['manual_trigger_override'] = target_be
                            sl_meta['trigger_price'] = target_be
                            sl_meta['price'] = target_be
                            try:
                                from app.services.manual_trade_persistence import schedule_update_monitor
                                schedule_update_monitor(
                                    sl_id,
                                    fields={
                                        'breakeven_activated': True,
                                        'manual_trigger_override': float(target_be),
                                        'trigger_price': float(target_be),
                                    },
                                )
                            except Exception:
                                pass
                            logger.info(f"🛡️ [Auto-Breakeven] Activated for Trailing {symbol}! Profit: +{profit_pct:.2f}% >= +{auto_breakeven_trigger_pct}%. SL moved to {target_be}")
                            if user_id:
                                asyncio.create_task(
                                    BracketOrderService._send_breakeven_notification(
                                        user_id=user_id,
                                        symbol=symbol,
                                        entry_price=entry_price,
                                        current_price=current_price,
                                        target_be=target_be,
                                        profit_pct=profit_pct
                                    )
                                )
                
                # Fetch ATR periodically if mode is ATR
                if mode == 'atr' and ut_bot:
                    import time
                    now = time.time()
                    # Refresh ATR every 10 seconds to closely track the indicator
                    if now - last_atr_fetch_time > 10:
                        try:
                            # Fetch 250 candles to get a stable RMA (TradingView default smoothing)
                            ohlcv = await exchange.fetch_ohlcv(symbol, timeframe=atr_timeframe, limit=250)
                            if ohlcv and len(ohlcv) > atr_period:
                                data = [{'time': o[0], 'open': o[1], 'high': o[2], 'low': o[3], 'close': o[4]} for o in ohlcv]
                                ut_bot._calculate_ut_bot(data)
                                current_atr = ut_bot.latest_trailing_stop
                                last_atr_fetch_time = now
                                logger.debug(f"Calculated UT Bot Trailing Stop for {symbol}: {current_atr}")
                        except Exception as atr_e:
                            logger.warning(f"Failed to fetch UT Bot Trailing Stop: {atr_e}")
                            
                    # If we don't have ATR yet, skip this tick
                    if current_atr <= 0:
                        continue
                        
                trigger_price = 0.0
                manual_override = sl_meta.get('manual_trigger_override')
                if opposite_side == 'sell': # We are Long, so we want to sell
                    highest_price = max(highest_price, current_price)
                    if mode == 'percentage':
                        new_trigger = highest_price * (1 - (val / 100.0))
                        trigger_price = max(trigger_price, new_trigger) if trigger_price > 0 else new_trigger
                    elif mode == 'atr':
                        # current_atr is the exact UT Bot Trailing Stop Price
                        new_trigger = current_atr
                        trigger_price = max(trigger_price, new_trigger) if trigger_price > 0 else new_trigger
                    else:
                        new_trigger = highest_price - val
                        trigger_price = max(trigger_price, new_trigger) if trigger_price > 0 else new_trigger
                        
                    if manual_override is not None:
                        trigger_price = max(trigger_price, float(manual_override))

                    BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]['trigger_price'] = trigger_price
                    BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]['price'] = trigger_price
                    BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]['highest_price'] = highest_price
                    BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]['lowest_price'] = lowest_price
                    try:
                        from app.services.manual_trade_persistence import schedule_throttled_trailing_hwm
                        schedule_throttled_trailing_hwm(sl_id, highest_price, lowest_price, trigger_price)
                    except Exception:
                        pass

                    from app.services.anti_wick_guard import evaluate_anti_wick_trigger
                    long_aw_triggered, _ = await evaluate_anti_wick_trigger(
                        state=sl_meta,
                        exchange=exchange,
                        symbol=symbol,
                        opposite_side=opposite_side,
                        current_price=current_price,
                        trigger_price=trigger_price,
                        anti_wick_mode=anti_wick_mode,
                        dwell_seconds=anti_wick_dwell_seconds,
                        timeframe=anti_wick_timeframe,
                        disaster_bypass_pct=anti_wick_disaster_pct,
                    )
                    if long_aw_triggered:
                        if (was_tp_touched or not curr_tp_price) and await BracketOrderService._check_linked_tp_filled(
                            exchange=exchange,
                            symbol=symbol,
                            is_futures=is_futures,
                            sl_meta=sl_meta,
                            fallback_tp_order_id=tp_order_id,
                            user_id=user_id,
                            entry_price=entry_price,
                            opposite_side=opposite_side,
                            default_amount=amount,
                            context_label="trailing stop monitor",
                        ):
                            sl_triggered = False
                            break
                        logger.info(f"💥 Trailing SL triggered for Long. High: {highest_price}, Trigger: {trigger_price}, Current: {current_price}")
                        sl_triggered = True
                        break
                else: # We are Short, so we want to buy
                    lowest_price = min(lowest_price, current_price)
                    if mode == 'percentage':
                        new_trigger = lowest_price * (1 + (val / 100.0))
                        trigger_price = min(trigger_price, new_trigger) if trigger_price > 0 else new_trigger
                    elif mode == 'atr':
                        # current_atr is the exact UT Bot Trailing Stop Price
                        new_trigger = current_atr
                        trigger_price = min(trigger_price, new_trigger) if trigger_price > 0 else new_trigger
                    else:
                        new_trigger = lowest_price + val
                        trigger_price = min(trigger_price, new_trigger) if trigger_price > 0 else new_trigger
                        
                    if manual_override is not None:
                        trigger_price = min(trigger_price, float(manual_override)) if trigger_price > 0 else float(manual_override)

                    BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]['trigger_price'] = trigger_price
                    BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]['price'] = trigger_price
                    BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]['highest_price'] = highest_price
                    BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]['lowest_price'] = lowest_price
                    try:
                        from app.services.manual_trade_persistence import schedule_throttled_trailing_hwm
                        schedule_throttled_trailing_hwm(sl_id, highest_price, lowest_price, trigger_price)
                    except Exception:
                        pass

                    from app.services.anti_wick_guard import evaluate_anti_wick_trigger
                    short_aw_triggered, _ = await evaluate_anti_wick_trigger(
                        state=sl_meta,
                        exchange=exchange,
                        symbol=symbol,
                        opposite_side=opposite_side,
                        current_price=current_price,
                        trigger_price=trigger_price,
                        anti_wick_mode=anti_wick_mode,
                        dwell_seconds=anti_wick_dwell_seconds,
                        timeframe=anti_wick_timeframe,
                        disaster_bypass_pct=anti_wick_disaster_pct,
                    )
                    if short_aw_triggered:
                        if (was_tp_touched or not curr_tp_price) and await BracketOrderService._check_linked_tp_filled(
                            exchange=exchange,
                            symbol=symbol,
                            is_futures=is_futures,
                            sl_meta=sl_meta,
                            fallback_tp_order_id=tp_order_id,
                            user_id=user_id,
                            entry_price=entry_price,
                            opposite_side=opposite_side,
                            default_amount=amount,
                            context_label="trailing stop monitor",
                        ):
                            sl_triggered = False
                            break
                        logger.info(f"💥 Trailing SL triggered for Short. Low: {lowest_price}, Trigger: {trigger_price}, Current: {current_price}")
                        sl_triggered = True
                        break

            except Exception as e:
                logger.debug(f"Trailing SL tick error: {e}")
                
        # Close the position!
        curr_entry_id = (sl_meta.get('entry_order_id') if sl_meta else None) or entry_order_id
        curr_tp_id = (sl_meta.get('tp_order_id') if sl_meta else None) or tp_order_id
        if not sl_triggered:
            try:
                from app.services.manual_trade_persistence import schedule_mark_terminal
                schedule_mark_terminal(sl_id, status='completed', reason='trailing_tp_or_closed')
            except Exception:
                pass
            BracketOrderService._mark_entry_bracket_closed(entry_order_id=curr_entry_id, tp_order_id=curr_tp_id)
            if sl_id in BracketOrderService.ACTIVE_SOFTWARE_SL:
                del BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]
            return

        cancelled_during_exec = False
        try:
            curr_amount = float(sl_meta.get('amount') if (sl_meta and sl_meta.get('amount') is not None) else amount)
            BracketOrderService._mark_entry_bracket_closed(entry_order_id=curr_entry_id, tp_order_id=curr_tp_id)

            # ── TRAILING CHASE: ZERO-FEE MAKER PEGGING EXIT ──
            # execute_manual_smart_chase handles cancelling curr_tp_id & balance check directly without redundant pre-waits
            if is_smart_chase_exit:
                try:
                    from app.services.manual_smart_chase_executor import execute_manual_smart_chase
                    logger.info(f"⚡ [Trailing Chase] Triggered at {trigger_price}! Launching Smart Chase Dynamic Maker Exit...")
                    await execute_manual_smart_chase(
                        exchange=exchange,
                        symbol=symbol,
                        exit_side=opposite_side,
                        sell_amount_raw=curr_amount,
                        entry_price=entry_price,
                        original_sl=trigger_price,
                        max_deviation_pct=max_deviation_pct,
                        chase_delay_ms=chase_delay_ms,
                        max_attempts=max_attempts,
                        is_futures=is_futures,
                        user_id=user_id,
                        api_key_record=api_key_record,
                        tp_order_id=curr_tp_id,
                        chase_id=sl_id,
                        chase_mode=chase_mode,
                        trigger_source=trigger_source,
                        peg_strategy=peg_strategy,
                        wall_multiplier=wall_multiplier,
                        entry_order_id=curr_entry_id
                    )
                    return
                except Exception as chase_err:
                    logger.error(f"❌ Trailing Chase Maker exit failed ({chase_err}). Fallback to Market sweep.")

            if curr_tp_id:
                await BracketOrderService._cancel_futures_order_universal(exchange, curr_tp_id, symbol)
                logger.info(f"Cancelled TP order {curr_tp_id} before executing SL.")
                await asyncio.sleep(0.15)

            final_amount = curr_amount
            if not is_futures and opposite_side.lower() == 'sell':
                try:
                    base_currency = symbol.split('/')[0]
                    balance = await exchange.fetch_balance()
                    available = float(balance.get(base_currency, {}).get('free', 0.0))
                    if 0 < available < curr_amount:
                        final_amount = BracketOrderService._safe_amount_to_precision(exchange, symbol, available)
                        logger.info(f"Adjusted SL sell amount to available balance: {final_amount}")
                    elif available == 0:
                        logger.warning("No balance available to execute Trailing SL (maybe already closed by TP).")
                        return
                except Exception as bal_e:
                    logger.warning(f"Failed to fetch balance before SL: {bal_e}")

            params = await BracketOrderService._apply_futures_exit_params(exchange, symbol, opposite_side) if is_futures else {}
            sl_res = await exchange.create_market_order(symbol, opposite_side, final_amount, params=params)

            logger.info(f"✅ Trailing SL Executed! ID: {sl_res.get('id')}")

            if user_id:
                mode_str = f"ATR (TF: {atr_timeframe}, Period: {atr_period}, Mult: {atr_multiplier})" if mode == 'atr' else f"{mode} ({val}{'%' if mode == 'percentage' else '$'})"
                asyncio.create_task(
                    BracketOrderService._send_sl_completed_notification(
                        user_id=user_id,
                        symbol=symbol,
                        opposite_side=opposite_side,
                        amount=amount,
                        entry_price=entry_price,
                        exit_price=current_price,
                        sl_method=f"Trailing SL ({mode_str})"
                    )
                )
        except asyncio.CancelledError:
            cancelled_during_exec = True
            raise
        except Exception as e:
            logger.error(f"❌ Failed to execute Trailing SL: {e}")
        finally:
            try:
                from app.services.manual_trade_persistence import schedule_mark_terminal
                if not cancelled_during_exec and not is_smart_chase_exit:
                    schedule_mark_terminal(sl_id, status='completed', reason='trailing_market_executed')
            except Exception:
                pass
            BracketOrderService._mark_entry_bracket_closed(entry_order_id=curr_entry_id, tp_order_id=curr_tp_id)
            if sl_id in BracketOrderService.ACTIVE_SOFTWARE_SL:
                del BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]

    @staticmethod
    async def _fixed_sl_auto_breakeven_loop(
        exchange, symbol: str, opposite_side: str, amount: float,
        entry_price: float, initial_sl_price: float, is_futures: bool,
        user_id: int, api_key_record,
        tp_order_id: str = None,
        disaster_sl_order_id: str = None,
        auto_breakeven_enabled: bool = True,
        auto_breakeven_trigger_pct: float = 1.0,
        auto_breakeven_buffer_pct: float = 0.05,
        entry_order_id: str = None,
        tp_price: float = None,
        sl_id: Optional[str] = None,
        initial_breakeven_activated: bool = False,
        initial_manual_trigger_override: Optional[float] = None,
        anti_wick_mode: str = 'instant',
        anti_wick_dwell_seconds: float = 3.0,
        anti_wick_timeframe: str = '1m',
        anti_wick_disaster_pct: float = 2.0,
    ):
        sl_id = sl_id or str(uuid.uuid4())
        BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id] = {
            'id': sl_id,
            'entry_order_id': str(entry_order_id) if entry_order_id else None,
            'api_key_id': getattr(api_key_record, 'id', None),
            'api_key_record': api_key_record,
            'user_id': user_id,
            'symbol': symbol,
            'side': opposite_side,
            'amount': amount,
            'type': 'fixed',
            'mode': 'STOP',
            'price': initial_sl_price,
            'trigger_price': initial_sl_price,
            'entry_price': entry_price,
            'disaster_sl_order_id': disaster_sl_order_id,
            'is_futures': is_futures,
            'exchange': exchange,
            'status': 'monitoring',
            'auto_breakeven_enabled': auto_breakeven_enabled,
            'breakeven_activated': bool(initial_breakeven_activated),
            'anti_wick_mode': str(anti_wick_mode or 'instant').lower(),
            'anti_wick_dwell_seconds': float(anti_wick_dwell_seconds or 3.0),
            'anti_wick_timeframe': str(anti_wick_timeframe or '1m').lower(),
            'anti_wick_disaster_pct': float(anti_wick_disaster_pct or 2.0),
            'anti_wick_state': 'monitoring',
            'tp_order_id': str(tp_order_id) if tp_order_id else None,
            'tp_price': float(tp_price) if tp_price else None
        }
        if initial_manual_trigger_override is not None:
            BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]['manual_trigger_override'] = float(initial_manual_trigger_override)
        try:
            from app.services.manual_trade_persistence import schedule_upsert_monitor
            schedule_upsert_monitor(
                monitor_id=sl_id,
                kind='software_sl',
                user_id=user_id,
                api_key_id=getattr(api_key_record, 'id', None),
                symbol=symbol,
                is_futures=is_futures,
                side=opposite_side,
                status='monitoring',
                sl_type='fixed',
                sl_mode='STOP',
                amount=float(amount or 0.0),
                entry_price=float(entry_price or 0.0),
                trigger_price=float(initial_sl_price or 0.0),
                entry_order_id=str(entry_order_id) if entry_order_id else None,
                tp_order_id=str(tp_order_id) if tp_order_id else None,
                tp_price=float(tp_price) if tp_price else None,
                disaster_sl_order_id=str(disaster_sl_order_id) if disaster_sl_order_id else None,
                breakeven_activated=bool(initial_breakeven_activated),
                manual_trigger_override=float(initial_manual_trigger_override) if initial_manual_trigger_override is not None else None,
                config={
                    'auto_breakeven_enabled': bool(auto_breakeven_enabled),
                    'auto_breakeven_trigger_pct': float(auto_breakeven_trigger_pct),
                    'auto_breakeven_buffer_pct': float(auto_breakeven_buffer_pct),
                    'anti_wick_mode': str(anti_wick_mode or 'instant').lower(),
                    'anti_wick_dwell_seconds': float(anti_wick_dwell_seconds or 3.0),
                    'anti_wick_timeframe': str(anti_wick_timeframe or '1m').lower(),
                    'anti_wick_disaster_pct': float(anti_wick_disaster_pct or 2.0),
                },
            )
        except Exception:
            pass
        logger.info(
            f"🛡️ [Fixed SL Watchdog/Breakeven] Started for {symbol} | Initial SL: {initial_sl_price} | "
            f"Native SL ID: {disaster_sl_order_id or 'Software-Fallback'} | TP ID: {tp_order_id or 'None'} | "
            f"Auto-BE: {auto_breakeven_enabled} (+{auto_breakeven_trigger_pct}% -> +{auto_breakeven_buffer_pct}%) | "
            f"Anti-Wick: {str(anti_wick_mode or 'instant').upper()}"
        )

        loop_tick = 0
        pos_closed_streak = 0
        should_mark_terminal = False
        terminal_status = 'completed'
        terminal_reason = 'fixed_sl_finished'

        try:
            while True:
                aw_active_pre = str(
                    (BracketOrderService.ACTIVE_SOFTWARE_SL.get(sl_id) or {}).get('anti_wick_mode') or anti_wick_mode or 'instant'
                ).lower() != 'instant'
                await asyncio.sleep(0.35 if aw_active_pre else 1.5)
                loop_tick += 1
                sl_meta = BracketOrderService.ACTIVE_SOFTWARE_SL.get(sl_id)
                if not sl_meta or sl_meta.get('cancelled'):
                    logger.info(f"🛑 Fixed SL Auto-Breakeven monitor cancelled by user for {symbol}.")
                    should_mark_terminal = True
                    terminal_status = 'cancelled'
                    terminal_reason = 'fixed_sl_cancelled'
                    BracketOrderService._mark_entry_bracket_closed(
                        entry_order_id=(sl_meta.get('entry_order_id') if sl_meta else entry_order_id),
                        tp_order_id=((sl_meta.get('tp_order_id') if sl_meta else None) or tp_order_id),
                    )
                    curr_disaster = (sl_meta.get('disaster_sl_order_id') if sl_meta else None) or disaster_sl_order_id
                    if curr_disaster:
                        await BracketOrderService._cancel_futures_order_universal(exchange, curr_disaster, symbol)
                    return

                try:
                    # Synchronize dynamic entry_price, amount, and order IDs
                    if sl_meta.get('entry_price'):
                        entry_price = float(sl_meta['entry_price'])
                    if sl_meta.get('amount') is not None:
                        amount = float(sl_meta['amount'])
                    if sl_meta.get('tp_order_id'):
                        tp_order_id = sl_meta['tp_order_id']
                    if sl_meta.get('disaster_sl_order_id'):
                        disaster_sl_order_id = sl_meta['disaster_sl_order_id']

                    should_poll_rest = (not aw_active_pre) or (loop_tick % 4 == 1)
                    # 1. Check if TP order filled on exchange
                    curr_tp_id = sl_meta.get('tp_order_id') or tp_order_id
                    if curr_tp_id and should_poll_rest:
                        try:
                            tp_chk = (
                                await BracketOrderService._fetch_futures_order_universal(exchange, curr_tp_id, symbol, is_conditional=False)
                                if is_futures else await exchange.fetch_order(curr_tp_id, symbol)
                            )
                            if tp_chk and str(tp_chk.get('status', '')).lower() in ['closed', 'filled']:
                                logger.info(f"🎯 TP order {curr_tp_id} filled! Cancelling SL and closing Fixed SL monitor for {symbol}.")
                                should_mark_terminal = True
                                terminal_status = 'completed'
                                terminal_reason = 'fixed_sl_tp_filled'
                                BracketOrderService._mark_entry_bracket_closed(
                                    entry_order_id=sl_meta.get('entry_order_id'),
                                    tp_order_id=curr_tp_id,
                                )
                                exit_price = float(tp_chk.get('average') or tp_chk.get('price') or 0.0)
                                if user_id:
                                    try:
                                        asyncio.create_task(
                                            BracketOrderService._send_tp_completed_notification(
                                                user_id=user_id,
                                                symbol=symbol,
                                                opposite_side=opposite_side,
                                                amount=amount,
                                                entry_price=entry_price,
                                                exit_price=exit_price
                                            )
                                        )
                                    except Exception:
                                        pass
                                curr_disaster = sl_meta.get('disaster_sl_order_id') or disaster_sl_order_id
                                if curr_disaster:
                                    await BracketOrderService._cancel_futures_order_universal(exchange, curr_disaster, symbol)
                                return
                        except Exception:
                            pass

                    # 2. Check if native SL order filled on futures (conditional/algo order aware)
                    curr_disaster = sl_meta.get('disaster_sl_order_id') or disaster_sl_order_id
                    if curr_disaster and should_poll_rest:
                        try:
                            sl_chk = (
                                await BracketOrderService._fetch_futures_order_universal(exchange, curr_disaster, symbol, is_conditional=True)
                                if is_futures else await exchange.fetch_order(curr_disaster, symbol)
                            )
                            if sl_chk and str(sl_chk.get('status', '')).lower() in ['closed', 'filled']:
                                logger.info(f"🛡️ Native Fixed SL order {curr_disaster} filled! Cancelling TP and closing monitor for {symbol}.")
                                should_mark_terminal = True
                                terminal_status = 'completed'
                                terminal_reason = 'fixed_sl_native_filled'
                                BracketOrderService._mark_entry_bracket_closed(
                                    entry_order_id=sl_meta.get('entry_order_id'),
                                    tp_order_id=curr_tp_id,
                                )
                                exit_p = float(sl_chk.get('average') or sl_chk.get('price') or sl_chk.get('stopPrice') or initial_sl_price)
                                if user_id:
                                    asyncio.create_task(
                                        BracketOrderService._send_sl_completed_notification(
                                            user_id=user_id,
                                            symbol=symbol,
                                            opposite_side=opposite_side,
                                            amount=amount,
                                            entry_price=entry_price,
                                            exit_price=exit_p,
                                            sl_method="Native Futures Fixed SL"
                                        )
                                    )
                                if curr_tp_id:
                                    await BracketOrderService._cancel_futures_order_universal(exchange, curr_tp_id, symbol)
                                return
                        except Exception:
                            pass

                    # 3. Check if position was closed externally (after initial indexing grace period of 5 ticks / ~7.5s)
                    if is_futures and should_poll_rest and loop_tick > 5:
                        pos_open = await BracketOrderService._check_futures_position_is_open(exchange, symbol, opposite_side)
                        if not pos_open:
                            pos_closed_streak += 1
                        else:
                            pos_closed_streak = 0
                        if pos_closed_streak >= 2:
                            logger.info(f"🚫 Position confirmed closed externally on {symbol}. Cleaning up bracket orders.")
                            should_mark_terminal = True
                            terminal_status = 'completed'
                            terminal_reason = 'fixed_sl_position_closed'
                            if curr_disaster:
                                await BracketOrderService._cancel_futures_order_universal(exchange, curr_disaster, symbol)
                            if curr_tp_id:
                                await BracketOrderService._cancel_futures_order_universal(exchange, curr_tp_id, symbol)
                            BracketOrderService._mark_entry_bracket_closed(
                                entry_order_id=sl_meta.get('entry_order_id'),
                                tp_order_id=curr_tp_id,
                            )
                            return

                    ticker = await BracketOrderService._fetch_ticker_fast(exchange, symbol, require_last=True)
                    current_price = float(ticker.get('last') or 0.0)
                    if current_price <= 0:
                        continue

                    # 4. Auto-Breakeven check
                    if auto_breakeven_enabled and not sl_meta.get('breakeven_activated', False) and entry_price > 0:
                        profit_pct = (
                            ((current_price - entry_price) / entry_price * 100.0)
                            if opposite_side == 'sell'
                            else ((entry_price - current_price) / entry_price * 100.0)
                        )
                        if profit_pct >= auto_breakeven_trigger_pct:
                            be_buf = auto_breakeven_buffer_pct / 100.0
                            target_be = entry_price * (1.0 + be_buf) if opposite_side == 'sell' else entry_price * (1.0 - be_buf)
                            target_be = BracketOrderService._safe_price_to_precision(exchange, symbol, target_be)

                            sl_meta['breakeven_activated'] = True
                            try:
                                from app.services.manual_trade_persistence import schedule_update_monitor
                                schedule_update_monitor(sl_id, fields={'breakeven_activated': True})
                            except Exception:
                                pass
                            logger.info(f"🛡️ [Auto-Breakeven] Activated for Fixed SL {symbol}! Profit: +{profit_pct:.2f}% >= +{auto_breakeven_trigger_pct}%. Moving SL to {target_be}")
                            await BracketOrderService.update_software_bracket(sl_id, target_be, getattr(api_key_record, 'id', None), user_id)
                            if user_id:
                                asyncio.create_task(
                                    BracketOrderService._send_breakeven_notification(
                                        user_id=user_id,
                                        symbol=symbol,
                                        entry_price=entry_price,
                                        current_price=current_price,
                                        target_be=target_be,
                                        profit_pct=profit_pct
                                    )
                                )

                    # 5. If Spot (or Futures when Anti-Wick software guard is active or native STOP_MARKET placement failed), check trigger condition
                    curr_disaster = sl_meta.get('disaster_sl_order_id') or disaster_sl_order_id
                    aw_mode_curr = str(sl_meta.get('anti_wick_mode') or anti_wick_mode or 'instant').lower()
                    aw_dwell_curr = float(sl_meta.get('anti_wick_dwell_seconds') if sl_meta.get('anti_wick_dwell_seconds') is not None else anti_wick_dwell_seconds)
                    aw_tf_curr = str(sl_meta.get('anti_wick_timeframe') or anti_wick_timeframe or '1m').lower()
                    aw_dis_curr = float(sl_meta.get('anti_wick_disaster_pct') if sl_meta.get('anti_wick_disaster_pct') is not None else anti_wick_disaster_pct)
                    if (not is_futures or not curr_disaster or aw_mode_curr != 'instant') and current_price > 0:
                        current_trig = float(sl_meta.get('trigger_price') or initial_sl_price)
                        from app.services.anti_wick_guard import evaluate_anti_wick_trigger
                        triggered, _ = await evaluate_anti_wick_trigger(
                            state=sl_meta,
                            exchange=exchange,
                            symbol=symbol,
                            opposite_side=opposite_side,
                            current_price=current_price,
                            trigger_price=current_trig,
                            anti_wick_mode=aw_mode_curr,
                            dwell_seconds=aw_dwell_curr,
                            timeframe=aw_tf_curr,
                            disaster_bypass_pct=aw_dis_curr,
                        )
                        if triggered:
                            curr_amount = float(sl_meta.get('amount') if sl_meta.get('amount') is not None else amount)
                            if await BracketOrderService._check_linked_tp_filled(
                                exchange=exchange,
                                symbol=symbol,
                                is_futures=is_futures,
                                sl_meta=sl_meta,
                                fallback_tp_order_id=tp_order_id,
                                user_id=user_id,
                                entry_price=entry_price,
                                opposite_side=opposite_side,
                                default_amount=curr_amount,
                                context_label="Fixed SL monitor",
                            ):
                                should_mark_terminal = True
                                terminal_status = 'completed'
                                terminal_reason = 'fixed_sl_tp_filled'
                                if curr_disaster:
                                    await BracketOrderService._cancel_futures_order_universal(exchange, curr_disaster, symbol)
                                return
                            logger.info(
                                f"💥 Software Fixed SL triggered on {'Futures' if is_futures else 'Spot'} {symbol}! "
                                f"Current: {current_price}, Trigger: {current_trig}. Exiting market..."
                            )
                            should_mark_terminal = True
                            terminal_status = 'completed'
                            terminal_reason = 'fixed_sl_market_executed'
                            try:
                                if curr_disaster and is_futures:
                                    await BracketOrderService._cancel_futures_order_universal(exchange, curr_disaster, symbol, is_conditional=True)
                                curr_tp_id = sl_meta.get('tp_order_id') or tp_order_id
                                if curr_tp_id:
                                    await BracketOrderService._cancel_futures_order_universal(exchange, curr_tp_id, symbol)
                                    await asyncio.sleep(0.15)
                                BracketOrderService._mark_entry_bracket_closed(
                                    entry_order_id=sl_meta.get('entry_order_id') or entry_order_id,
                                    tp_order_id=curr_tp_id,
                                )
                                sell_amt = curr_amount
                                if not is_futures and opposite_side.lower() == 'sell':
                                    try:
                                        base_currency = symbol.split('/')[0]
                                        balance = await exchange.fetch_balance()
                                        available = float(balance.get(base_currency, {}).get('free', 0.0))
                                        if 0 < available < curr_amount:
                                            sell_amt = BracketOrderService._safe_amount_to_precision(exchange, symbol, available)
                                        elif available <= 0:
                                            logger.warning("No free base balance available to execute Spot Fixed SL (maybe already closed by TP).")
                                            return
                                    except Exception as bal_e:
                                        logger.debug(f"Spot Fixed SL balance check notice: {bal_e}")
                                exit_params = await BracketOrderService._apply_futures_exit_params(exchange, symbol, opposite_side) if is_futures else {}
                                await exchange.create_market_order(symbol, opposite_side, sell_amt, params=exit_params)
                                if user_id:
                                    asyncio.create_task(
                                        BracketOrderService._send_sl_completed_notification(
                                            user_id=user_id,
                                            symbol=symbol,
                                            opposite_side=opposite_side,
                                            amount=sell_amt,
                                            entry_price=entry_price,
                                            exit_price=current_price,
                                            sl_method=f"{'Futures' if is_futures else 'Spot'} Fixed SL (Software Market Trigger)"
                                        )
                                    )
                            except Exception as mkt_err:
                                logger.error(f"Failed to market exit on Fixed SL for {symbol}: {mkt_err}")
                            return
                except asyncio.CancelledError:
                    raise
                except Exception as tick_err:
                    logger.debug(f"Fixed SL Auto-Breakeven transient tick error for {symbol}: {tick_err}")
        except asyncio.CancelledError:
            raise
        except Exception as loop_err:
            logger.error(f"Error in Fixed SL Auto-Breakeven loop: {loop_err}")
        finally:
            curr_meta = BracketOrderService.ACTIVE_SOFTWARE_SL.get(sl_id)
            if should_mark_terminal:
                try:
                    from app.services.manual_trade_persistence import schedule_mark_terminal
                    schedule_mark_terminal(
                        sl_id,
                        status=terminal_status,
                        reason=terminal_reason,
                    )
                except Exception:
                    pass
                BracketOrderService._mark_entry_bracket_closed(
                    entry_order_id=(curr_meta.get('entry_order_id') if curr_meta else None) or entry_order_id,
                    tp_order_id=(curr_meta.get('tp_order_id') if curr_meta else None) or tp_order_id,
                )
            if sl_id in BracketOrderService.ACTIVE_SOFTWARE_SL:
                del BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]

    @staticmethod
    async def _smart_chase_monitor_loop(
        exchange, symbol: str, opposite_side: str, amount: float,
        entry_price: float, sl_price: float, max_deviation_pct: float,
        chase_delay_ms: int, max_attempts: int, is_futures: bool,
        user_id: int, api_key_record,
        tp_order_id: str = None, disaster_sl_order_id: str = None,
        chase_mode: str = 'dynamic_bbo',
        trigger_source: str = 'bid_ask',
        peg_strategy: str = 'bbo',
        wall_multiplier: float = 2.5,
        auto_breakeven_enabled: bool = False,
        auto_breakeven_trigger_pct: float = 1.0,
        auto_breakeven_buffer_pct: float = 0.05,
        entry_order_id: str = None,
        tp_price: float = None,
        sl_id: Optional[str] = None,
        initial_breakeven_activated: bool = False,
        initial_manual_trigger_override: Optional[float] = None,
        anti_wick_mode: str = 'instant',
        anti_wick_dwell_seconds: float = 3.0,
        anti_wick_timeframe: str = '1m',
        anti_wick_disaster_pct: float = 2.0,
    ):
        sl_id = sl_id or str(uuid.uuid4())
        BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id] = {
            'id': sl_id,
            'entry_order_id': str(entry_order_id) if entry_order_id else None,
            'api_key_id': getattr(api_key_record, 'id', None),
            'api_key_record': api_key_record,
            'user_id': user_id,
            'symbol': symbol,
            'side': opposite_side,
            'amount': amount,
            'type': 'smart_chase',
            'mode': 'SMART_CHASE',
            'chase_mode': chase_mode,
            'trigger_source': trigger_source,
            'peg_strategy': peg_strategy,
            'wall_multiplier': wall_multiplier,
            'max_attempts': max_attempts,
            'chase_delay_ms': chase_delay_ms,
            'price': sl_price,
            'trigger_price': sl_price,
            'entry_price': entry_price,
            'disaster_sl_order_id': disaster_sl_order_id,
            'is_futures': is_futures,
            'max_deviation_pct': max_deviation_pct,
            'exchange': exchange,
            'status': 'monitoring',
            'auto_breakeven_enabled': auto_breakeven_enabled,
            'auto_breakeven_trigger_pct': auto_breakeven_trigger_pct,
            'auto_breakeven_buffer_pct': auto_breakeven_buffer_pct,
            'breakeven_activated': bool(initial_breakeven_activated),
            'anti_wick_mode': str(anti_wick_mode or 'instant').lower(),
            'anti_wick_dwell_seconds': float(anti_wick_dwell_seconds or 3.0),
            'anti_wick_timeframe': str(anti_wick_timeframe or '1m').lower(),
            'anti_wick_disaster_pct': float(anti_wick_disaster_pct or 2.0),
            'anti_wick_state': 'monitoring',
            'tp_order_id': str(tp_order_id) if tp_order_id else None,
            'tp_price': float(tp_price) if tp_price else None,
        }
        if initial_manual_trigger_override is not None:
            BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]['manual_trigger_override'] = float(initial_manual_trigger_override)
        try:
            from app.services.manual_trade_persistence import schedule_upsert_monitor
            schedule_upsert_monitor(
                monitor_id=sl_id,
                kind='software_sl',
                user_id=user_id,
                api_key_id=getattr(api_key_record, 'id', None),
                symbol=symbol,
                is_futures=is_futures,
                side=opposite_side,
                status='monitoring',
                sl_type='smart_chase',
                sl_mode='SMART_CHASE',
                amount=float(amount or 0.0),
                entry_price=float(entry_price or 0.0),
                trigger_price=float(sl_price or 0.0),
                entry_order_id=str(entry_order_id) if entry_order_id else None,
                tp_order_id=str(tp_order_id) if tp_order_id else None,
                tp_price=float(tp_price) if tp_price else None,
                disaster_sl_order_id=str(disaster_sl_order_id) if disaster_sl_order_id else None,
                breakeven_activated=bool(initial_breakeven_activated),
                manual_trigger_override=float(initial_manual_trigger_override) if initial_manual_trigger_override is not None else None,
                config={
                    'max_deviation_pct': float(max_deviation_pct),
                    'chase_delay_ms': int(chase_delay_ms),
                    'max_attempts': int(max_attempts),
                    'chase_mode': str(chase_mode),
                    'trigger_source': str(trigger_source),
                    'peg_strategy': str(peg_strategy),
                    'wall_multiplier': float(wall_multiplier),
                    'auto_breakeven_enabled': bool(auto_breakeven_enabled),
                    'auto_breakeven_trigger_pct': float(auto_breakeven_trigger_pct),
                    'auto_breakeven_buffer_pct': float(auto_breakeven_buffer_pct),
                    'anti_wick_mode': str(anti_wick_mode or 'instant').lower(),
                    'anti_wick_dwell_seconds': float(anti_wick_dwell_seconds or 3.0),
                    'anti_wick_timeframe': str(anti_wick_timeframe or '1m').lower(),
                    'anti_wick_disaster_pct': float(anti_wick_disaster_pct or 2.0),
                },
            )
        except Exception:
            pass

        side_tag = "BUY (Buy-Back ⚡)" if opposite_side.lower() == 'buy' else "SELL (Long Exit 🛡️)"
        tp_tag = f" | Linked TP: #{tp_order_id} (@ {tp_price})" if tp_order_id else " | Linked TP: None"
        logger.info(
            f"🏁 Smart Chase Monitor started for {symbol} | Action: {side_tag} | Amount: {amount} | "
            f"Trigger: {sl_price} | Strategy: {peg_strategy.upper()} | Mode: {chase_mode.upper()} | "
            f"Source: {trigger_source.upper()} | Anti-Wick: {str(anti_wick_mode or 'instant').upper()} | Entry: {entry_price}{tp_tag}"
        )
        sl_triggered = False
        loop_tick = 0
        pos_closed_streak = 0
        was_tp_touched = False
        tp_touch_grace = 0

        while True:
            # Check if monitor was cancelled by user
            sl_meta = BracketOrderService.ACTIVE_SOFTWARE_SL.get(sl_id)
            if not sl_meta or sl_meta.get('cancelled'):
                logger.info(f"🛑 Smart Chase monitor cancelled by user for {symbol}.")
                try:
                    from app.services.manual_trade_persistence import schedule_mark_terminal
                    schedule_mark_terminal(sl_id, status='cancelled', reason='smart_chase_monitor_cancelled')
                except Exception:
                    pass
                BracketOrderService._mark_entry_bracket_closed(
                    entry_order_id=(sl_meta.get('entry_order_id') if sl_meta else entry_order_id),
                    tp_order_id=((sl_meta.get('tp_order_id') if sl_meta else None) or tp_order_id),
                )
                curr_disaster = (sl_meta.get('disaster_sl_order_id') if sl_meta else None) or disaster_sl_order_id
                if curr_disaster:
                    await BracketOrderService._cancel_futures_order_universal(exchange, curr_disaster, symbol)
                if sl_id in BracketOrderService.ACTIVE_SOFTWARE_SL:
                    del BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]
                return

            # Keep dynamic entry_price, TP, disaster SL, and amount synchronized from sl_meta (e.g. if edited via chart drag or partial fill)
            if sl_meta.get('entry_price'):
                entry_price = float(sl_meta['entry_price'])
            if sl_meta.get('tp_order_id'):
                if str(sl_meta['tp_order_id']) != str(tp_order_id or ''):
                    was_tp_touched = False
                    tp_touch_grace = 0
                tp_order_id = sl_meta['tp_order_id']
            if sl_meta.get('tp_price'):
                tp_price = float(sl_meta['tp_price'])
            if sl_meta.get('disaster_sl_order_id'):
                disaster_sl_order_id = sl_meta['disaster_sl_order_id']
            curr_amount = float(sl_meta.get('amount') if (sl_meta and sl_meta.get('amount') is not None) else amount)
            curr_sl_price = float(sl_meta.get('trigger_price') if (sl_meta and sl_meta.get('trigger_price') is not None) else sl_price)
            if sl_meta.get('max_attempts') is not None:
                max_attempts = int(sl_meta['max_attempts'])
            if sl_meta.get('chase_delay_ms'):
                chase_delay_ms = int(sl_meta['chase_delay_ms'])
            if sl_meta.get('trigger_source'):
                trigger_source = str(sl_meta['trigger_source']).lower()
            if sl_meta.get('chase_mode'):
                chase_mode = str(sl_meta['chase_mode']).lower()
            if sl_meta.get('peg_strategy'):
                peg_strategy = str(sl_meta['peg_strategy']).lower()
            if sl_meta.get('max_deviation_pct'):
                max_deviation_pct = float(sl_meta['max_deviation_pct'])
            if sl_meta.get('wall_multiplier'):
                wall_multiplier = float(sl_meta['wall_multiplier'])
            if 'auto_breakeven_enabled' in sl_meta:
                auto_breakeven_enabled = bool(sl_meta['auto_breakeven_enabled'])
            if sl_meta.get('auto_breakeven_trigger_pct'):
                auto_breakeven_trigger_pct = float(sl_meta['auto_breakeven_trigger_pct'])
            if sl_meta.get('auto_breakeven_buffer_pct'):
                auto_breakeven_buffer_pct = float(sl_meta['auto_breakeven_buffer_pct'])
            if sl_meta.get('anti_wick_mode'):
                anti_wick_mode = str(sl_meta['anti_wick_mode']).lower()
            if sl_meta.get('anti_wick_dwell_seconds') is not None:
                anti_wick_dwell_seconds = float(sl_meta['anti_wick_dwell_seconds'])
            if sl_meta.get('anti_wick_timeframe'):
                anti_wick_timeframe = str(sl_meta['anti_wick_timeframe']).lower()
            if sl_meta.get('anti_wick_disaster_pct') is not None:
                anti_wick_disaster_pct = float(sl_meta['anti_wick_disaster_pct'])

            try:
                # ── PRIORITY 1: FETCH LIVE BBO / TICKER (Redis WS cache ~1ms, REST fallback) ──
                ticker = await BracketOrderService._fetch_ticker_fast(
                    exchange, symbol, require_last=(trigger_source not in ['bid_ask', 'bbo'])
                )
                last_price = float(ticker.get('last') or 0.0)
                best_bid = float(ticker.get('bid') or last_price)
                best_ask = float(ticker.get('ask') or last_price)

                if trigger_source in ['bid_ask', 'bbo']:
                    # Long exit (sell): evaluate against Best Bid (the highest price buyers will pay right now)
                    # Short exit (buy): evaluate against Best Ask (the lowest price sellers will accept right now)
                    current_price = best_bid if opposite_side == 'sell' else best_ask
                    source_label = f"Best {'Bid' if opposite_side == 'sell' else 'Ask'} ({current_price})"
                else:
                    current_price = last_price
                    source_label = f"Last Price ({current_price})"

                # Dynamic trigger price (in case user dragged/edited on chart)
                current_sl_trigger = float(sl_meta.get('trigger_price') if sl_meta.get('trigger_price') is not None else sl_price)
                sl_price = current_sl_trigger

                # ── AUTO-BREAKEVEN CHECK ──
                if auto_breakeven_enabled and not sl_meta.get('breakeven_activated', False) and entry_price > 0 and current_price > 0:
                    profit_pct = 0.0
                    if opposite_side == 'sell':
                        profit_pct = ((current_price - entry_price) / entry_price) * 100.0
                    else:
                        profit_pct = ((entry_price - current_price) / entry_price) * 100.0

                    if profit_pct >= auto_breakeven_trigger_pct:
                        be_buf = auto_breakeven_buffer_pct / 100.0
                        target_be = entry_price * (1.0 + be_buf) if opposite_side == 'sell' else entry_price * (1.0 - be_buf)
                        target_be = BracketOrderService._safe_price_to_precision(exchange, symbol, target_be)

                        should_move = False
                        curr_trig = float(sl_meta.get('trigger_price') or 0.0)
                        if opposite_side == 'sell' and target_be > curr_trig:
                            should_move = True
                        elif opposite_side == 'buy' and (curr_trig == 0 or target_be < curr_trig):
                            should_move = True

                        if should_move:
                            sl_meta['breakeven_activated'] = True
                            try:
                                from app.services.manual_trade_persistence import schedule_update_monitor
                                schedule_update_monitor(sl_id, fields={'breakeven_activated': True})
                            except Exception:
                                pass
                            logger.info(f"🛡️ [Auto-Breakeven] Activated for Smart Chase {symbol}! Profit: +{profit_pct:.2f}% >= +{auto_breakeven_trigger_pct}%. Updating SL to {target_be}")
                            await BracketOrderService.update_software_bracket(sl_id, target_be, getattr(api_key_record, 'id', None), user_id)
                            current_sl_trigger = target_be
                            sl_price = target_be
                            if user_id:
                                asyncio.create_task(
                                    BracketOrderService._send_breakeven_notification(
                                        user_id=user_id,
                                        symbol=symbol,
                                        entry_price=entry_price,
                                        current_price=current_price,
                                        target_be=target_be,
                                        profit_pct=profit_pct
                                    )
                                )

                if current_price > 0:
                    from app.services.anti_wick_guard import evaluate_anti_wick_trigger
                    should_trigger_sl, aw_reason = await evaluate_anti_wick_trigger(
                        state=sl_meta,
                        exchange=exchange,
                        symbol=symbol,
                        opposite_side=opposite_side,
                        current_price=current_price,
                        trigger_price=current_sl_trigger,
                        anti_wick_mode=anti_wick_mode,
                        dwell_seconds=anti_wick_dwell_seconds,
                        timeframe=anti_wick_timeframe,
                        disaster_bypass_pct=anti_wick_disaster_pct,
                    )

                    if should_trigger_sl:
                        # Pre-trigger TP & position verification (Spot + Futures):
                        # Only make a pre-trigger REST call to check TP if price previously touched TP or TP price is unknown.
                        # When price moved toward SL without ever touching TP, skipping this saves ~150-250ms on trigger!
                        known_tp_price = float(sl_meta.get('tp_price') or tp_price or 0.0)
                        if (was_tp_touched or tp_touch_grace > 0 or not known_tp_price) and await BracketOrderService._check_linked_tp_filled(
                            exchange=exchange,
                            symbol=symbol,
                            is_futures=is_futures,
                            sl_meta=sl_meta,
                            fallback_tp_order_id=tp_order_id,
                            user_id=user_id,
                            entry_price=entry_price,
                            opposite_side=opposite_side,
                            default_amount=curr_amount,
                            context_label="Smart Chase monitor",
                        ):
                            curr_disaster = sl_meta.get('disaster_sl_order_id') or disaster_sl_order_id
                            if curr_disaster:
                                await BracketOrderService._cancel_futures_order_universal(exchange, curr_disaster, symbol)
                            sl_triggered = False
                            break

                        # Ensure futures position didn't already close externally (manual close)
                        if is_futures and loop_tick > 6 and pos_closed_streak > 0:
                            pos_still_open = await BracketOrderService._check_futures_position_is_open(exchange, symbol, opposite_side)
                            if not pos_still_open:
                                logger.info(f"🚫 Position closed externally before Smart Chase SL trigger for {symbol}. Skipping Smart Chase.")
                                curr_disaster = sl_meta.get('disaster_sl_order_id') or disaster_sl_order_id
                                if curr_disaster:
                                    await BracketOrderService._cancel_futures_order_universal(exchange, curr_disaster, symbol)
                                BracketOrderService._mark_entry_bracket_closed(
                                    entry_order_id=sl_meta.get('entry_order_id'),
                                    tp_order_id=sl_meta.get('tp_order_id') or tp_order_id,
                                )
                                sl_triggered = False
                                break

                        logger.info(f"💥 Smart Chase SL Triggered for {opposite_side.upper()}! {source_label} vs {current_sl_trigger} [Source: {trigger_source.upper()}]")
                        sl_triggered = True
                        break

                # ── PRIORITY 2: FAST PRICE-TRIGGERED + ADAPTIVE PERIODIC TP / POSITION CHECK ──
                # Immediately checks TP fill when live ticker reaches TP price (~0.5s), and falls back to adaptive periodic polling
                loop_tick += 1
                curr_tp_id = sl_meta.get('tp_order_id') or tp_order_id
                curr_tp_price = float(sl_meta.get('tp_price') or tp_price or 0.0)
                active_sl_count = sum(
                    1 for s in BracketOrderService.ACTIVE_SOFTWARE_SL.values()
                    if not s.get('cancelled') and s.get('status') == 'monitoring'
                )
                periodic_mod = 8 if active_sl_count <= 3 else (14 if active_sl_count <= 10 else 24)

                tp_touched = False
                tp_near = False
                if curr_tp_id and curr_tp_price > 0:
                    px_candidates = [px for px in (last_price, best_bid, best_ask) if px and px > 0]
                    if px_candidates:
                        if opposite_side == 'sell':
                            hi_px = max(px_candidates)
                            tp_touched = hi_px >= curr_tp_price
                            tp_near = hi_px >= curr_tp_price * 0.998
                        else:
                            lo_px = min(px_candidates)
                            tp_touched = lo_px <= curr_tp_price
                            tp_near = lo_px <= curr_tp_price * 1.002

                first_touch = tp_touched and not was_tp_touched
                if tp_touched:
                    tp_touch_grace = 6
                elif tp_touch_grace > 0:
                    tp_touch_grace -= 1
                was_tp_touched = tp_touched

                should_run_periodic = (loop_tick % periodic_mod == 0)
                should_run_tp_check = bool(
                    curr_tp_id and (
                        first_touch
                        or ((tp_touched or tp_near or tp_touch_grace > 0) and loop_tick % 2 == 0)
                        or should_run_periodic
                    )
                )

                if should_run_tp_check or should_run_periodic:
                    tp_or_disaster_filled = False
                    try:
                        # Check if TP already filled on exchange (using latest dynamic TP ID)
                        if should_run_tp_check:
                            tp_or_disaster_filled = await BracketOrderService._check_linked_tp_filled(
                                exchange=exchange,
                                symbol=symbol,
                                is_futures=is_futures,
                                sl_meta=sl_meta,
                                fallback_tp_order_id=tp_order_id,
                                user_id=user_id,
                                entry_price=entry_price,
                                opposite_side=opposite_side,
                                default_amount=curr_amount,
                                context_label="Smart Chase monitor",
                            )

                        # Check if Disaster SL already filled on exchange
                        curr_disaster = sl_meta.get('disaster_sl_order_id') or disaster_sl_order_id
                        if not tp_or_disaster_filled and should_run_periodic and curr_disaster and is_futures:
                            try:
                                dis_chk = await BracketOrderService._fetch_futures_order_universal(
                                    exchange, curr_disaster, symbol, is_conditional=True
                                )
                                if dis_chk and str(dis_chk.get('status', '')).lower() in ['closed', 'filled']:
                                    logger.info(f"🛡️ Native Disaster SL {curr_disaster} filled! Canceling TP and closing Smart Chase for {symbol}.")
                                    tp_or_disaster_filled = True
                                    if curr_tp_id:
                                        await BracketOrderService._cancel_futures_order_universal(exchange, curr_tp_id, symbol)
                            except Exception:
                                pass

                        if not tp_or_disaster_filled and should_run_periodic and is_futures and loop_tick >= 12:
                            pos_open = await BracketOrderService._check_futures_position_is_open(exchange, symbol, opposite_side)
                            if not pos_open:
                                pos_closed_streak += 1
                            else:
                                pos_closed_streak = 0
                            if pos_closed_streak >= 2:
                                tp_or_disaster_filled = True
                    except Exception as pos_e:
                        logger.debug(f"Position check non-fatal error: {pos_e}")

                    if tp_or_disaster_filled:
                        logger.info(f"🚫 Position closed externally (TP filled or position closed). Canceling Smart Chase monitor for {symbol}.")
                        curr_disaster = sl_meta.get('disaster_sl_order_id') or disaster_sl_order_id
                        if curr_disaster:
                            await BracketOrderService._cancel_futures_order_universal(exchange, curr_disaster, symbol)
                        BracketOrderService._mark_entry_bracket_closed(
                            entry_order_id=sl_meta.get('entry_order_id'),
                            tp_order_id=curr_tp_id,
                        )
                        sl_triggered = False
                        break

            except Exception as e:
                logger.debug(f"Smart Chase monitor tick error: {e}")

            # Ultra-responsive 250ms–350ms adaptive sleep (250ms when within 0.5% of trigger, 350ms otherwise)
            near_sl_trigger = (
                current_price > 0
                and current_sl_trigger > 0
                and abs(current_price - current_sl_trigger) / current_sl_trigger <= 0.005
            )
            await asyncio.sleep(0.25 if near_sl_trigger else 0.35)

        # ── EXTRACT LATEST DYNAMIC PARAMS BEFORE REMOVING FROM ACTIVE_SOFTWARE_SL ──
        curr_entry_id = (sl_meta.get('entry_order_id') if sl_meta else None) or entry_order_id
        if sl_meta and sl_meta.get('entry_price'):
            entry_price = float(sl_meta['entry_price'])
        curr_disaster_id = (sl_meta.get('disaster_sl_order_id') if sl_meta else None) or disaster_sl_order_id
        curr_tp_id = (sl_meta.get('tp_order_id') if sl_meta else None) or tp_order_id
        curr_sl_price = float(sl_meta.get('trigger_price') if (sl_meta and sl_meta.get('trigger_price') is not None) else sl_price)
        curr_amount = float(sl_meta.get('amount') if (sl_meta and sl_meta.get('amount') is not None) else amount)

        # ── IMMEDIATELY REMOVE FROM ACTIVE_SOFTWARE_SL ──
        # Whether triggered or position closed, the trigger monitor is DONE.
        # Removing now ensures the chart clears the trigger line instantly!
        if sl_id in BracketOrderService.ACTIVE_SOFTWARE_SL:
            del BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]

        BracketOrderService._mark_entry_bracket_closed(entry_order_id=curr_entry_id, tp_order_id=curr_tp_id)

        if not sl_triggered:
            try:
                from app.services.manual_trade_persistence import schedule_mark_terminal
                schedule_mark_terminal(sl_id, status='completed', reason='smart_chase_tp_or_closed')
            except Exception:
                pass
            return

        try:
            from app.services.manual_smart_chase_executor import execute_manual_smart_chase
            await execute_manual_smart_chase(
                exchange=exchange,
                symbol=symbol,
                exit_side=opposite_side,
                sell_amount_raw=curr_amount,
                entry_price=entry_price,
                original_sl=curr_sl_price,
                max_deviation_pct=max_deviation_pct,
                chase_delay_ms=chase_delay_ms,
                max_attempts=max_attempts,
                is_futures=is_futures,
                user_id=user_id,
                api_key_record=api_key_record,
                tp_order_id=curr_tp_id,
                disaster_sl_order_id=curr_disaster_id,
                chase_id=sl_id,
                chase_mode=chase_mode,
                trigger_source=trigger_source,
                peg_strategy=peg_strategy,
                wall_multiplier=wall_multiplier,
                entry_order_id=curr_entry_id
            )
        except Exception as exec_err:
            logger.error(f"❌ Error invoking execute_manual_smart_chase: {exec_err}")
            try:
                from app.services.manual_trade_persistence import schedule_mark_terminal
                schedule_mark_terminal(sl_id, status='failed', reason=str(exec_err)[:200])
            except Exception:
                pass
        finally:
            BracketOrderService._mark_entry_bracket_closed(entry_order_id=curr_entry_id, tp_order_id=curr_tp_id)
            if sl_id in BracketOrderService.ACTIVE_SOFTWARE_SL:
                del BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]

bracket_order_service = BracketOrderService()
