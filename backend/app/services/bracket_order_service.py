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
from app.services.exchange_pool import get_or_create_exchange
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
        Fetches a Futures order across both standard (/fapi/v1/order) and conditional/algo (/fapi/v1/algoOrder)
        endpoints so STOP_MARKET / TAKE_PROFIT_MARKET / TRAILING_STOP_MARKET orders never fail with -2013.
        """
        if not exchange or not order_id:
            return {}
        oid_str = str(order_id)
        if is_conditional:
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
                if prec_stop is not None:
                    algo_req['triggerPrice'] = str(prec_stop)
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
                if prec_stop is not None:
                    std_req['stopPrice'] = str(prec_stop)
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

    @staticmethod
    async def _apply_futures_exit_params(exchange, symbol: str, exit_side: str, base_params: dict = None) -> dict:
        """
        Futures exit orders (TP, SL, Disaster SL, Trailing SL) er jonno Binance Hedge Mode
        ebong One-Way Mode onujayi sothik params (positionSide vs reduceOnly) set kore.
        COIN-M (Inverse) er khetre dapi check kore, Linear er khetre fapi check kore.
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

            methods = (
                ['dapiPrivateGetPositionSideDual', 'fapiPrivateGetPositionSideDual']
                if is_inverse else
                ['fapiPrivateGetPositionSideDual', 'dapiPrivateGetPositionSideDual']
            )
            is_hedge_mode = False
            for m_name in methods:
                m = getattr(exchange, m_name, None)
                if m and callable(m):
                    try:
                        res = await m()
                        if res.get('dualSidePosition', False):
                            is_hedge_mode = True
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
        raw_res: dict, user_id: int
    ):
        """
        Monitors Binance Native Spot OTO/OTOCO order list.
        Sends Telegram notifications for Entry fill, TP fill, or SL fill.
        """
        if not user_id:
            return
        try:
            order_list = raw_res.get('orderReports', [])
            working_order = next((o for o in order_list if o.get('type') in ('LIMIT', 'LIMIT_MAKER')), None)
            tp_order = next((o for o in order_list if o != working_order and o.get('type') in ('LIMIT', 'LIMIT_MAKER')), None)
            sl_order = next((o for o in order_list if 'STOP' in str(o.get('type', ''))), None)

            working_id = working_order.get('orderId') if working_order else None
            tp_id = tp_order.get('orderId') if tp_order else None
            sl_id = sl_order.get('orderId') if sl_order else None
            opposite_side = 'sell' if side.lower() == 'buy' else 'buy'

            # 1. Wait for working entry order to fill
            if working_id:
                for _ in range(600):
                    await asyncio.sleep(2)
                    try:
                        chk = await exchange.fetch_order(str(working_id), symbol)
                        st = chk.get('status', '').lower()
                        if st in ('closed', 'filled'):
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
                            return
                except Exception:
                    pass
        except Exception as e:
            logger.debug(f"monitor_native_otoco notice: {e}")


    
    @staticmethod
    async def _cancel_futures_order_universal(exchange, order_id: str, symbol: str):
        """
        Safely cancels an order on Futures, attempting standard order cancellation
        and conditional/algo cancellation (params={'stop': True}) so no order is left behind.
        """
        if not order_id or not exchange:
            return
        cancelled = False
        try:
            await exchange.cancel_order(order_id, symbol)
            cancelled = True
            logger.info(f"✅ Cancelled regular order {order_id} on {symbol}")
        except Exception as e:
            logger.debug(f"Standard cancel notice for {order_id}: {e}")

        if not cancelled:
            try:
                await exchange.cancel_order(order_id, symbol, params={'stop': True})
                cancelled = True
                logger.info(f"✅ Cancelled conditional/algo order {order_id} on {symbol}")
            except Exception as e:
                logger.debug(f"Conditional cancel notice for {order_id}: {e}")

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

        # If disaster SL order exists on futures exchange, replace it with updated disaster level
        disaster_order_id = sl_meta.get('disaster_sl_order_id')
        max_dev = float(sl_meta.get('max_deviation_pct') or 1.0)
        if disaster_order_id and exchange and is_futures:
            try:
                # Cancel previous disaster stop (supports both regular and conditional/algo orders)
                await BracketOrderService._cancel_futures_order_universal(exchange, disaster_order_id, symbol)

                # Re-place disaster stop at new price (exact for pure stop, or ± max_dev for smart chase)
                mode = sl_meta.get('mode', 'SMART_CHASE')
                if mode in ['STOP', 'fixed', 'STOP_MARKET']:
                    disaster_price = prec_price
                else:
                    disaster_price = prec_price * (1 - (max_dev / 100.0)) if side == 'sell' else prec_price * (1 + (max_dev / 100.0))
                disaster_price_prec = BracketOrderService._safe_price_to_precision(exchange, symbol, disaster_price)
                disaster_params = await BracketOrderService._apply_futures_exit_params(
                    exchange, symbol, side, {'stopPrice': disaster_price_prec}
                )

                prec_amount = BracketOrderService._safe_amount_to_precision(exchange, symbol, amount)
                d_res = await BracketOrderService._place_futures_conditional_order(
                    exchange, symbol, 'STOP_MARKET', side, prec_amount,
                    stop_price=disaster_price_prec, extra_params=disaster_params
                )
                sl_meta['disaster_sl_order_id'] = d_res.get('id')
                logger.info(f"🛡️ Replaced Native Disaster SL at {disaster_price_prec} (New ID: {d_res.get('id')})")
            except Exception as d_err:
                logger.warning(f"⚠️ Failed to update native disaster SL: {d_err}")

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
    ):
        """
        Background task:
        1. Monitors the entry order status for up to `timeout_mins`.
        2. Detects full or partial fills.
        3. Fires opposite Take-Profit order based on the config.
        4. Sends a Telegram notification after TP is placed.
        """
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
                passphrase=passphrase
            )

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

            processed_amount = 0.0
            average_price = float(initial_entry_price or 0.0)
            order_closed = False
            elapsed_seconds = 0
            if entry_order_id:
                BracketOrderService.ACTIVE_ENTRY_MONITORS[str(entry_order_id)] = {
                    'entry_order_id': str(entry_order_id),
                    'symbol': symbol,
                    'api_key_id': getattr(api_key_record, 'id', None),
                    'cancelled': False,
                }

            # ── Polling Loop ───────────────────────────────────────────
            while True:
                if entry_order_id and BracketOrderService.ACTIVE_ENTRY_MONITORS.get(str(entry_order_id), {}).get('cancelled'):
                    logger.info(f"🛑 Bracket Monitor for {entry_order_id} aborted by Emergency Force Order.")
                    break
                if not is_unlimited and elapsed_seconds >= max_timeout_mins * 60:
                    break
                
                # Adaptive Polling: Ultra-fast initial check (350ms) to detect immediate fills instantly
                if elapsed_seconds == 0:
                    sleep_time = 0.35
                elif elapsed_seconds < 300: # First 5 mins
                    sleep_time = 1.5
                elif elapsed_seconds < 3600: # Next 1 hour
                    sleep_time = 10
                else: # After 1 hour
                    sleep_time = 30
                    
                await asyncio.sleep(sleep_time)
                elapsed_seconds += sleep_time

                if entry_order_id and BracketOrderService.ACTIVE_ENTRY_MONITORS.get(str(entry_order_id), {}).get('cancelled'):
                    logger.info(f"🛑 Bracket Monitor for {entry_order_id} aborted by Emergency Force Order.")
                    break

                try:
                    order_status = await exchange.fetch_order(entry_order_id, symbol)
                    status = str(order_status.get('status') or '').lower()
                    filled = float(order_status.get('filled') or 0.0)
                    if status in ('closed', 'filled') and filled <= 0 and amount > 0:
                        filled = float(amount)

                    if filled > processed_amount:
                        newly_filled = filled - processed_amount
                        average_price = float(
                            order_status.get('average') or
                            order_status.get('price') or
                            initial_entry_price or
                            0.0
                        )
                        if average_price <= 0:
                            try:
                                ticker = await exchange.fetch_ticker(symbol)
                                average_price = float(ticker.get('last') or ticker.get('close') or 0.0)
                            except Exception:
                                pass

                        # On Spot, if a partial fill chunk is below $5.00 min notional while the entry order is still open
                        # and no bracket exists yet for this entry_order_id, wait for more fills (or order close) before spawning TP
                        chunk_notional = newly_filled * average_price
                        if not is_futures and status == 'open' and processed_amount <= 0 and 0 < chunk_notional < 5.0:
                            logger.info(
                                f"⏳ [Bracket Monitor] Partial fill {newly_filled} (${chunk_notional:.2f} < $5.00 Spot Min Notional) "
                                f"for {entry_order_id}. Waiting for additional fill or order close..."
                            )
                        else:
                            logger.info(f"⚡ Partial/Full fill detected for {entry_order_id}: {newly_filled} @ {average_price} (Total: {filled}/{amount})")
                            
                            # Spawning bracket for this chunk
                            asyncio.create_task(
                                BracketOrderService._spawn_bracket_for_amount(
                                    exchange, symbol, side, newly_filled, average_price,
                                    is_futures, tp_config, sl_config, user_id, api_key_record,
                                    entry_order_id=entry_order_id
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

                    if status in ('closed', 'filled') or processed_amount >= amount * 0.99:
                        order_closed = True
                        break

                    elif status in ('canceled', 'cancelled', 'expired', 'rejected'):
                        logger.info(f"⚠️ Bracket Monitor: Entry {entry_order_id} canceled. Total processed: {processed_amount}")
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
                        break

                except Exception as poll_e:
                    logger.debug(f"Bracket Monitor poll error (non-fatal): {poll_e}")

            if not order_closed and processed_amount < amount and not is_unlimited:
                logger.warning(
                    f"⏰ Bracket Monitor: Entry {entry_order_id} timed out "
                    f"after {max_timeout_mins} mins. Processed {processed_amount}/{amount}."
                )

        except Exception as main_e:
            logger.error(f"Bracket Monitor critical failure: {main_e}", exc_info=True)
        finally:
            if entry_order_id:
                BracketOrderService.ACTIVE_ENTRY_MONITORS.pop(str(entry_order_id), None)


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
    ):
        lock_key = str(entry_order_id) if entry_order_id else (f"tp:{linked_tp_order_id}" if linked_tp_order_id else None)
        entry_lock = None
        t_spawn_start = time.perf_counter()
        if lock_key:
            entry_lock = BracketOrderService.ENTRY_BRACKET_LOCKS.setdefault(lock_key, asyncio.Lock())
            await entry_lock.acquire()
        try:
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
                    ticker = await exchange.fetch_ticker(symbol)
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
                    raw_total = prev_amt + final_amount
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
                            tp_target_amt = BracketOrderService._safe_amount_to_precision(
                                exchange, symbol, max(final_amount, raw_total - old_tp_filled)
                            )

                    tp_order_type = tp_config.get('order_type', 'Limit').lower()
                    tp_price = BracketOrderService._compute_tp_price(tp_config, weighted_entry, opposite_side)

                    final_tp_price = BracketOrderService._safe_price_to_precision(exchange, symbol, tp_price)
                    t_cons_tp_start = time.perf_counter()
                    ex_params = await BracketOrderService._apply_futures_exit_params(exchange, symbol, opposite_side) if is_futures else {}
                    try:
                        tp_res = None
                        if tp_order_type == 'limit':
                            ex_params_po = dict(ex_params)
                            ex_params_po['postOnly'] = True
                            try:
                                tp_res = await exchange.create_limit_order(symbol, opposite_side, tp_target_amt, final_tp_price, ex_params_po)
                            except Exception as po_cons_err:
                                logger.warning(f"Consolidated TP Post-Only rejected ({po_cons_err}). Retrying with standard GTC Limit...")
                                tp_res = None
                            if not tp_res or str(tp_res.get('status', '')).lower() in ('expired', 'canceled', 'cancelled', 'rejected'):
                                ex_params_gtc = dict(ex_params)
                                ex_params_gtc.pop('postOnly', None)
                                ex_params_gtc['timeInForce'] = 'GTC'
                                tp_res = await exchange.create_limit_order(symbol, opposite_side, tp_target_amt, final_tp_price, ex_params_gtc)
                        else:
                            if is_futures:
                                tp_cond_params = dict(ex_params)
                                tp_cond_params['stopPrice'] = final_tp_price
                                tp_res = await BracketOrderService._place_futures_conditional_order(
                                    exchange, symbol, 'TAKE_PROFIT_MARKET', opposite_side, tp_target_amt,
                                    stop_price=final_tp_price, extra_params=tp_cond_params
                                )
                            else:
                                ex_params_gtc = dict(ex_params)
                                ex_params_gtc.pop('postOnly', None)
                                ex_params_gtc['timeInForce'] = 'GTC'
                                tp_res = await exchange.create_limit_order(symbol, opposite_side, tp_target_amt, final_tp_price, ex_params_gtc)
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
                        for rep in (raw_res.get('orderReports') or []):
                            if str(rep.get('type', '')).upper() in ('LIMIT_MAKER', 'LIMIT') and rep.get('orderId'):
                                BracketOrderService.KNOWN_TP_ORDER_IDS.add(str(rep.get('orderId')))
                    logger.info(f"✅ Native Binance OCO placed successfully in {oco_placement_ms}ms! ID: {raw_res.get('orderListId')}")
                    
                    if user_id:
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
                    return # Exit since we placed both successfully!
                except Exception as e:
                    logger.warning(f"⚠️ Native OCO failed ({e}). Falling back to Software Bracket TP/SL.")

            # Preserve any existing/linked tp_order_id unless overridden by a new TP placement below
            # --- Execute TP ---
            if tp_config:
                tp_order_type = tp_config.get('order_type', 'Limit').lower()
                mode          = tp_config.get('mode', 'percentage')
                val           = float(tp_config.get('value', 0))
                tp_price      = BracketOrderService._compute_tp_price(tp_config, average_price, opposite_side)
                final_tp_price = BracketOrderService._safe_price_to_precision(exchange, symbol, tp_price)
    
                t_tp_start = time.perf_counter()
                ex_params = await BracketOrderService._apply_futures_exit_params(exchange, symbol, opposite_side) if is_futures else {}
                try:
                    tp_res = None
                    if tp_order_type == 'limit':
                        # 1st attempt: Post-Only Maker limit order (saves fees)
                        ex_params_po = dict(ex_params)
                        ex_params_po['postOnly'] = True
                        try:
                            tp_res = await exchange.create_limit_order(
                                symbol, opposite_side, final_amount, final_tp_price, ex_params_po
                            )
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
                            tp_res = await exchange.create_limit_order(
                                symbol, opposite_side, final_amount, final_tp_price, ex_params_gtc
                            )
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
                                exchange, symbol, 'TAKE_PROFIT_MARKET', opposite_side, final_amount,
                                stop_price=final_tp_price, extra_params=tp_cond_params
                            )
                            logger.info(f"✅ Bracket Monitor: Conditional TAKE_PROFIT_MARKET placed at {final_tp_price}! ID: {tp_res.get('id')}")
                        else:
                            ex_params_gtc = dict(ex_params)
                            ex_params_gtc.pop('postOnly', None)
                            ex_params_gtc['timeInForce'] = 'GTC'
                            tp_res = await exchange.create_limit_order(
                                symbol, opposite_side, final_amount, final_tp_price, ex_params_gtc
                            )
                            logger.info(f"✅ Bracket Monitor: Spot Limit TP placed at {final_tp_price}! ID: {tp_res.get('id')}")
    
                    tp_placement_ms = max(1, int((time.perf_counter() - t_tp_start) * 1000))
                    if tp_res:
                        tp_order_id = tp_res.get('id')
                        resolved_tp_price = float(final_tp_price)
                        if tp_order_id:
                            BracketOrderService.KNOWN_TP_ORDER_IDS.add(str(tp_order_id))

                    logger.info(f"✅ Bracket Monitor: TP placed in {tp_placement_ms}ms! ID: {tp_res.get('id') if tp_res else 'N/A'}")
    
                    if user_id and tp_res:
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
    
                except Exception as ex_e:
                    logger.error(f"❌ Bracket Monitor: Failed to place TP Order! {ex_e}")
                    if user_id:
                        asyncio.create_task(
                            BracketOrderService._send_bracket_failure_alert(
                                user_id, symbol, "Take-Profit (TP)", str(ex_e)
                            )
                        )

            # --- Execute SL ---
            if sl_config:
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

                if sl_type in ['trailing', 'trailing_chase']:
                    placed_native = False
                    if not is_trailing_chase and not auto_breakeven_enabled and is_futures and sl_mode == 'percentage':
                        # Try Native Trailing Stop Market for Futures (Taker Exit)
                        try:
                            logger.info(f"🚀 Bracket Monitor: Placing Native Trailing Stop for {symbol} (Futures)")
                            sl_params = await BracketOrderService._apply_futures_exit_params(
                                exchange, symbol, opposite_side, {'callbackRate': sl_val}
                            )
                            sl_res = await BracketOrderService._place_futures_conditional_order(
                                exchange, symbol, 'TRAILING_STOP_MARKET', opposite_side, final_amount,
                                callback_rate=sl_val, extra_params=sl_params
                            )
                            logger.info(f"✅ Native Trailing SL placed! ID: {sl_res.get('id')}")
                            placed_native = True
                            
                            if user_id:
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
                                entry_order_id=entry_order_id
                            )
                        )
                elif sl_type == 'smart_chase':
                    sl_price = BracketOrderService._compute_sl_price(sl_config, average_price, opposite_side) or average_price
                    final_sl_price = BracketOrderService._safe_price_to_precision(exchange, symbol, sl_price)

                    disaster_sl_order_id = None
                    if is_futures:
                        try:
                            disaster_price = final_sl_price * (1 - (max_dev / 100.0)) if opposite_side == 'sell' else final_sl_price * (1 + (max_dev / 100.0))
                            disaster_price_prec = BracketOrderService._safe_price_to_precision(exchange, symbol, disaster_price)
                            disaster_params = await BracketOrderService._apply_futures_exit_params(
                                exchange, symbol, opposite_side, {'stopPrice': disaster_price_prec}
                            )
                            d_res = await BracketOrderService._place_futures_conditional_order(
                                exchange, symbol, 'STOP_MARKET', opposite_side, final_amount,
                                stop_price=disaster_price_prec, extra_params=disaster_params
                            )
                            disaster_sl_order_id = d_res.get('id')
                            logger.info(f"🛡️ Bracket Monitor: Native Disaster SL placed at {disaster_price_prec} (ID: {disaster_sl_order_id})")
                        except Exception as d_err:
                            logger.warning(f"⚠️ Failed to place native disaster SL: {d_err}")

                    logger.info(f"🚀 Bracket Monitor: Starting Smart Chase Limit SL for {symbol} | Trigger: {final_sl_price} | Strategy: {peg_strategy.upper()} | Mode: {chase_mode.upper()}")
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
                        )
                    )
                else:
                    sl_price = BracketOrderService._compute_sl_price(sl_config, average_price, opposite_side) or average_price
                    final_sl_price = BracketOrderService._safe_price_to_precision(exchange, symbol, sl_price)

                    if not is_futures:
                        # On Spot (when Native OCO was not used, e.g., Auto-Breakeven is active or TP is Market),
                        # placing a Limit TP locks 100% of the base asset, so an exchange STOP_LOSS order would be rejected
                        # for insufficient balance. Instead, monitor Fixed SL in software and cancel TP before market exit!
                        logger.info(
                            f"🛡️ Bracket Monitor: Starting Software Fixed SL Monitor for Spot {symbol} at {final_sl_price} "
                            f"(Auto-Breakeven: {auto_breakeven_enabled})"
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
                                entry_order_id=entry_order_id
                            )
                        )
                    else:
                        sl_params = await BracketOrderService._apply_futures_exit_params(
                            exchange, symbol, opposite_side, {'stopPrice': final_sl_price}
                        )
                        sl_res = None
                        try:
                            sl_res = await BracketOrderService._place_futures_conditional_order(
                                exchange, symbol, 'STOP_MARKET', opposite_side, final_amount,
                                stop_price=final_sl_price, extra_params=sl_params
                            )
                            logger.info(f"✅ Bracket Monitor: SL placed! ID: {sl_res.get('id') if sl_res else 'Local'}")

                            if user_id:
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

                        # Always spawn OCO Watchdog / Software SL Fallback (and Auto-Breakeven if enabled)
                        logger.info(
                            f"🛡️ Spawning Fixed SL {'Auto-Breakeven' if auto_breakeven_enabled else 'OCO Watchdog'} loop for {symbol} "
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
                                entry_order_id=entry_order_id
                            )
                        )

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
        entry_order_id: str = None
    ):
        highest_price = entry_price
        lowest_price = entry_price
        
        sl_id = str(uuid.uuid4())
        BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id] = {
            'id': sl_id,
            'entry_order_id': str(entry_order_id) if entry_order_id else None,
            'api_key_id': getattr(api_key_record, 'id', None),
            'api_key_record': api_key_record,
            'symbol': symbol,
            'side': opposite_side,
            'amount': amount,
            'type': 'trailing_chase' if is_smart_chase_exit else 'trailing',
            'mode': 'TRAILING_CHASE' if is_smart_chase_exit else mode,
            'price': entry_price,
            'trigger_price': entry_price,
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
            'breakeven_activated': False,
            'max_deviation_pct': max_deviation_pct,
            'max_attempts': max_attempts,
            'chase_delay_ms': chase_delay_ms,
            'tp_order_id': str(tp_order_id) if tp_order_id else None
        }

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
        
        ut_bot = None
        if mode == 'atr':
            from app.strategies.helpers.ut_bot_tracker import UTBotTracker
            # We assume use_heikin_ashi=False for now since manual trade doesn't specify
            ut_bot = UTBotTracker(exchange.id, symbol, sensitivity=atr_multiplier, atr_period=atr_period, use_heikin_ashi=False, timeframe=atr_timeframe)

        while True:
            await asyncio.sleep(0.5 if is_smart_chase_exit else 1.5)  # Responsive poll interval
            loop_tick += 1
            # Check if monitor was cancelled by user
            sl_meta = BracketOrderService.ACTIVE_SOFTWARE_SL.get(sl_id)
            if not sl_meta or sl_meta.get('cancelled'):
                logger.info(f"🛑 Trailing SL monitor cancelled by user for {symbol}.")
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

            try:
                # Security Check: Ensure position is still open to prevent accidental reverse trades
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

                if is_futures and loop_tick > 5:
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

                ticker = await exchange.fetch_ticker(symbol)
                last_price = float(ticker.get('last') or 0.0)
                best_bid = float(ticker.get('bid') or last_price)
                best_ask = float(ticker.get('ask') or last_price)
                if trigger_source in ['bid_ask', 'bbo']:
                    current_price = best_bid if opposite_side == 'sell' else best_ask
                else:
                    current_price = last_price
                if not current_price:
                    continue

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

                    if current_price <= trigger_price:
                        if await BracketOrderService._check_linked_tp_filled(
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

                    if current_price >= trigger_price:
                        if await BracketOrderService._check_linked_tp_filled(
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
            BracketOrderService._mark_entry_bracket_closed(entry_order_id=curr_entry_id, tp_order_id=curr_tp_id)
            if sl_id in BracketOrderService.ACTIVE_SOFTWARE_SL:
                del BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]
            return

        try:
            curr_amount = float(sl_meta.get('amount') if (sl_meta and sl_meta.get('amount') is not None) else amount)
            if curr_tp_id:
                await BracketOrderService._cancel_futures_order_universal(exchange, curr_tp_id, symbol)
                logger.info(f"Cancelled TP order {curr_tp_id} before executing SL.")
                await asyncio.sleep(0.15)
            BracketOrderService._mark_entry_bracket_closed(entry_order_id=curr_entry_id, tp_order_id=curr_tp_id)

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

            # ── TRAILING CHASE: ZERO-FEE MAKER PEGGING EXIT ──
            if is_smart_chase_exit:
                try:
                    from app.services.manual_smart_chase_executor import execute_manual_smart_chase
                    logger.info(f"⚡ [Trailing Chase] Triggered at {trigger_price}! Launching Smart Chase Dynamic Maker Exit...")
                    await execute_manual_smart_chase(
                        exchange=exchange,
                        symbol=symbol,
                        exit_side=opposite_side,
                        sell_amount_raw=final_amount,
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
                        wall_multiplier=wall_multiplier
                    )
                    return
                except Exception as chase_err:
                    logger.error(f"❌ Trailing Chase Maker exit failed ({chase_err}). Fallback to Market sweep.")

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
        except Exception as e:
            logger.error(f"❌ Failed to execute Trailing SL: {e}")
        finally:
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
        entry_order_id: str = None
    ):
        sl_id = str(uuid.uuid4())
        BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id] = {
            'id': sl_id,
            'entry_order_id': str(entry_order_id) if entry_order_id else None,
            'api_key_id': getattr(api_key_record, 'id', None),
            'api_key_record': api_key_record,
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
            'breakeven_activated': False,
            'tp_order_id': str(tp_order_id) if tp_order_id else None
        }
        logger.info(
            f"🛡️ [Fixed SL Watchdog/Breakeven] Started for {symbol} | Initial SL: {initial_sl_price} | "
            f"Native SL ID: {disaster_sl_order_id or 'Software-Fallback'} | TP ID: {tp_order_id or 'None'} | "
            f"Auto-BE: {auto_breakeven_enabled} (+{auto_breakeven_trigger_pct}% -> +{auto_breakeven_buffer_pct}%)"
        )

        loop_tick = 0
        pos_closed_streak = 0

        try:
            while True:
                await asyncio.sleep(1.5)
                loop_tick += 1
                sl_meta = BracketOrderService.ACTIVE_SOFTWARE_SL.get(sl_id)
                if not sl_meta or sl_meta.get('cancelled'):
                    logger.info(f"🛑 Fixed SL Auto-Breakeven monitor cancelled by user for {symbol}.")
                    BracketOrderService._mark_entry_bracket_closed(
                        entry_order_id=(sl_meta.get('entry_order_id') if sl_meta else entry_order_id),
                        tp_order_id=((sl_meta.get('tp_order_id') if sl_meta else None) or tp_order_id),
                    )
                    curr_disaster = (sl_meta.get('disaster_sl_order_id') if sl_meta else None) or disaster_sl_order_id
                    if curr_disaster:
                        await BracketOrderService._cancel_futures_order_universal(exchange, curr_disaster, symbol)
                    return

                # Synchronize dynamic entry_price, amount, and order IDs
                if sl_meta.get('entry_price'):
                    entry_price = float(sl_meta['entry_price'])
                if sl_meta.get('amount') is not None:
                    amount = float(sl_meta['amount'])
                if sl_meta.get('tp_order_id'):
                    tp_order_id = sl_meta['tp_order_id']
                if sl_meta.get('disaster_sl_order_id'):
                    disaster_sl_order_id = sl_meta['disaster_sl_order_id']

                # 1. Check if TP order filled on exchange
                curr_tp_id = sl_meta.get('tp_order_id') or tp_order_id
                if curr_tp_id:
                    try:
                        tp_chk = (
                            await BracketOrderService._fetch_futures_order_universal(exchange, curr_tp_id, symbol, is_conditional=False)
                            if is_futures else await exchange.fetch_order(curr_tp_id, symbol)
                        )
                        if tp_chk and str(tp_chk.get('status', '')).lower() in ['closed', 'filled']:
                            logger.info(f"🎯 TP order {curr_tp_id} filled! Cancelling SL and closing Fixed SL monitor for {symbol}.")
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
                if curr_disaster:
                    try:
                        sl_chk = (
                            await BracketOrderService._fetch_futures_order_universal(exchange, curr_disaster, symbol, is_conditional=True)
                            if is_futures else await exchange.fetch_order(curr_disaster, symbol)
                        )
                        if sl_chk and str(sl_chk.get('status', '')).lower() in ['closed', 'filled']:
                            logger.info(f"🛡️ Native Fixed SL order {curr_disaster} filled! Cancelling TP and closing monitor for {symbol}.")
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
                if is_futures and loop_tick > 5:
                    pos_open = await BracketOrderService._check_futures_position_is_open(exchange, symbol, opposite_side)
                    if not pos_open:
                        pos_closed_streak += 1
                    else:
                        pos_closed_streak = 0
                    if pos_closed_streak >= 2:
                        logger.info(f"🚫 Position confirmed closed externally on {symbol}. Cleaning up bracket orders.")
                        if curr_disaster:
                            await BracketOrderService._cancel_futures_order_universal(exchange, curr_disaster, symbol)
                        if curr_tp_id:
                            await BracketOrderService._cancel_futures_order_universal(exchange, curr_tp_id, symbol)
                        BracketOrderService._mark_entry_bracket_closed(
                            entry_order_id=sl_meta.get('entry_order_id'),
                            tp_order_id=curr_tp_id,
                        )
                        return

                ticker = await exchange.fetch_ticker(symbol)
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

                # 5. If Spot (or Futures when native STOP_MARKET placement failed), check trigger condition for software market exit
                curr_disaster = sl_meta.get('disaster_sl_order_id') or disaster_sl_order_id
                if (not is_futures or not curr_disaster) and current_price > 0:
                    current_trig = float(sl_meta.get('trigger_price') or initial_sl_price)
                    triggered = (current_price <= current_trig) if opposite_side == 'sell' else (current_price >= current_trig)
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
                            if curr_disaster:
                                await BracketOrderService._cancel_futures_order_universal(exchange, curr_disaster, symbol)
                            return
                        logger.info(
                            f"💥 Software Fixed SL triggered on {'Futures' if is_futures else 'Spot'} {symbol}! "
                            f"Current: {current_price}, Trigger: {current_trig}. Exiting market..."
                        )
                        try:
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
        except Exception as loop_err:
            logger.error(f"Error in Fixed SL Auto-Breakeven loop: {loop_err}")
        finally:
            curr_meta = BracketOrderService.ACTIVE_SOFTWARE_SL.get(sl_id)
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
    ):
        sl_id = str(uuid.uuid4())
        BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id] = {
            'id': sl_id,
            'entry_order_id': str(entry_order_id) if entry_order_id else None,
            'api_key_id': getattr(api_key_record, 'id', None),
            'api_key_record': api_key_record,
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
            'breakeven_activated': False,
            'tp_order_id': str(tp_order_id) if tp_order_id else None,
            'tp_price': float(tp_price) if tp_price else None,
        }

        logger.info(
            f"🏁 Smart Chase Monitor started for {symbol} | Trigger: {sl_price} | Strategy: {peg_strategy.upper()} | "
            f"Mode: {chase_mode.upper()} | Source: {trigger_source.upper()} | Entry: {entry_price}"
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

            try:
                # ── PRIORITY 1: FETCH TICKER FIRST FOR ULTRA-FAST SL DETECTION ──
                ticker = await exchange.fetch_ticker(symbol)
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
                    should_trigger_sl = False
                    if opposite_side == 'sell': # Long position, sell when price drops to or below sl_price
                        if current_price <= current_sl_trigger:
                            should_trigger_sl = True
                    else: # Short position, buy when price rises to or above sl_price
                        if current_price >= current_sl_trigger:
                            should_trigger_sl = True

                    if should_trigger_sl:
                        # Pre-trigger TP & position verification (Spot + Futures):
                        # Ensure linked TP did not already fill right before SL trigger fired
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
                            context_label="Smart Chase monitor",
                        ):
                            curr_disaster = sl_meta.get('disaster_sl_order_id') or disaster_sl_order_id
                            if curr_disaster:
                                await BracketOrderService._cancel_futures_order_universal(exchange, curr_disaster, symbol)
                            sl_triggered = False
                            break

                        # Ensure futures position didn't already close externally (manual close)
                        if is_futures and loop_tick > 6:
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
                periodic_mod = 3 if active_sl_count <= 3 else (6 if active_sl_count <= 10 else 12)

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

            # Ultra-responsive 500ms sleep (safe from Binance 1200 weight/min limit)
            await asyncio.sleep(0.5)

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
                wall_multiplier=wall_multiplier
            )
        except Exception as exec_err:
            logger.error(f"❌ Error invoking execute_manual_smart_chase: {exec_err}")
        finally:
            BracketOrderService._mark_entry_bracket_closed(entry_order_id=curr_entry_id, tp_order_id=curr_tp_id)
            if sl_id in BracketOrderService.ACTIVE_SOFTWARE_SL:
                del BracketOrderService.ACTIVE_SOFTWARE_SL[sl_id]

bracket_order_service = BracketOrderService()
