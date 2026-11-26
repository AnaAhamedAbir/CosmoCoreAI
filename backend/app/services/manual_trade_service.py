"""
Manual Trade Service
====================
ManualTradeModal এর জন্য ব্যাকএন্ড সার্ভিস।
Exchange Connection Pool ব্যবহার করে ultra-low latency order execution নিশ্চিত করে।
"""

import logging
import time
import asyncio
from datetime import datetime, timezone
from typing import Optional, Dict, Any, Tuple
from sqlalchemy.orm import Session
from app import models
from app.core.security import decrypt_key
from app.services.exchange_pool import get_or_create_exchange
try:
    from app.services.exchange_pool import is_ws_api_ready, prewarm_exchange_connections, schedule_ws_api_prewarm
except ImportError:
    def is_ws_api_ready(exchange, is_futures: bool = False, is_inverse: bool = False) -> bool:
        return True
    async def prewarm_exchange_connections(exchange, is_futures: bool = False):
        pass
    def schedule_ws_api_prewarm(exchange, is_futures: bool = False, is_inverse: bool = False) -> None:
        pass
from app.services.notification import NotificationService
from app.services.bracket_order_service import bracket_order_service
from app.db.session import SessionLocal
from fastapi import HTTPException
try:
    import ccxt.pro as ccxt
except ImportError:
    import ccxt.async_support as ccxt

logger = logging.getLogger(__name__)


async def _send_trade_fired_notification(
    user_id: int,
    exchange_name: str,
    symbol: str,
    side: str,
    order_type: str,
    amount: float,
    fill_price: float = 0.0,
    latency_ms: int = 0,
    attached_tp = None,
    attached_sl = None,
    leverage: int = None,
    margin_mode: str = None,
    is_futures: bool = False,
    max_dev: float = None,
    contract_size: float = 1.0,
    is_inverse: bool = False,
    ai_filter_info: str = None,
    anchor_price: float = None,
    iceberg_qty: float = None,
    execution_mode_label: str = None
):
    """Sends formatted Trade Fired alert to Telegram using its own dedicated DB session."""
    db = SessionLocal()
    try:
        side_upper = side.upper()
        side_icon = "🟢" if side_upper in ("BUY", "LONG") else "🔴"
        order_type_upper = order_type.upper()

        notional_str = ""
        if is_inverse and contract_size > 0 and amount:
            notional = float(amount) * float(contract_size)
            base_coin = symbol.split('/')[0] if '/' in symbol else symbol
            if fill_price and fill_price > 0:
                base_eq = notional / float(fill_price)
                notional_str = f" Contracts (~{base_eq:,.2f} {base_coin} / ${notional:,.2f})"
            else:
                notional_str = f" Contracts (~${notional:,.2f})"
        elif fill_price and fill_price > 0 and amount:
            notional = float(amount) * float(fill_price)
            notional_str = f" (~${notional:,.2f})"

        if is_futures:
            action_text = f"{side_upper} / {'LONG' if side_upper == 'BUY' else 'SHORT'} {side_icon}"
        else:
            action_text = f"{side_upper} {side_icon}"

        lev_text = ""
        if is_futures and leverage:
            lev_text = f"• Leverage: `{leverage}x` ({margin_mode.capitalize() if margin_mode else 'Isolated'})\n"

        if order_type_upper == 'MARKET':
            header = "🚀 *MANUAL TRADE FIRED (MARKET)*"
            price_line = f"• Entry Price: `${fill_price:,.4f}`\n" if fill_price else "• Entry Price: `Market Price`\n"
        elif order_type_upper in ('SMART_PEG', 'SMARTPEG'):
            header = "⚡ *MANUAL SMART PEG ENTRY INITIATED*"
            anchor_line = f"• Peg Anchor Limit: `${float(anchor_price):,.4f}`\n" if (anchor_price and float(anchor_price) > 0) else ""
            bench_line = f"• Benchmark Price: `${fill_price:,.4f}`\n" if fill_price else ""
            dev_line = f"• Max Drift: `±{max_dev}%`\n" if max_dev else ""
            price_line = f"{anchor_line}{bench_line}{dev_line}• Order Type: `Dynamic BBO Peg`\n"
        else:
            header = "📝 *MANUAL LIMIT ORDER PLACED*"
            price_line = f"• Limit Price: `${fill_price:,.4f}`\n• Status: `Pending in Orderbook ⏳`\n" if fill_price else "• Status: `Pending in Orderbook ⏳`\n"

        tp_text = ""
        if attached_tp:
            is_tp_enabled = getattr(attached_tp, 'enabled', None)
            if is_tp_enabled is None and isinstance(attached_tp, dict):
                is_tp_enabled = attached_tp.get('enabled', False)
            if is_tp_enabled:
                val = getattr(attached_tp, 'value', None) if not isinstance(attached_tp, dict) else attached_tp.get('value', '')
                mode = getattr(attached_tp, 'mode', None) if not isinstance(attached_tp, dict) else attached_tp.get('mode', '')
                unit = "%" if mode == "percentage" else "$"
                tp_text = f"🎯 Attached TP: `{val}{unit}`\n"

        sl_text = ""
        if attached_sl:
            is_sl_enabled = getattr(attached_sl, 'enabled', None)
            if is_sl_enabled is None and isinstance(attached_sl, dict):
                is_sl_enabled = attached_sl.get('enabled', False)
            if is_sl_enabled:
                val = getattr(attached_sl, 'value', None) if not isinstance(attached_sl, dict) else attached_sl.get('value', '')
                sl_type = (getattr(attached_sl, 'type', 'fixed') if not isinstance(attached_sl, dict) else attached_sl.get('type', 'fixed')) or 'fixed'
                mode = getattr(attached_sl, 'mode', None) if not isinstance(attached_sl, dict) else attached_sl.get('mode', '')
                unit = "%" if mode == "percentage" else "$"
                sl_text = f"🛡️ Attached SL: `{val}{unit}` ({str(sl_type).replace('_', ' ').capitalize()})\n"

        iceberg_text = f"🧊 Iceberg Visible Slice: `{iceberg_qty}`\n" if (iceberg_qty and float(iceberg_qty) > 0) else ""
        exec_mode_text = f"⚙️ Execution Engine: `{execution_mode_label}`\n" if execution_mode_label else ""
        ai_text = f"🤖 AI Filter: `{ai_filter_info}` ✅\n" if ai_filter_info else ""
        speed_text = f"⏱ Execution Speed: `{latency_ms} ms` ⚡\n" if latency_ms > 0 else ""

        msg = (
            f"{header}\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"• Exchange: `{exchange_name.capitalize()}`\n"
            f"• Pair: `{symbol}`\n"
            f"• Action: *{action_text}*\n"
            f"• Amount: `{amount}`{notional_str}\n"
            f"{price_line}"
            f"{exec_mode_text}"
            f"{iceberg_text}"
            f"{lev_text}"
            f"{tp_text}"
            f"{sl_text}"
            f"{ai_text}"
            f"{speed_text}"
        )
        await NotificationService.send_message(db, user_id, msg, parse_mode="Markdown", alert_type="alert_manual_trade")
    except Exception as e:
        logger.warning(f"Failed to send trade fired notification: {e}")
    finally:
        db.close()


async def _send_order_modified_notification(
    user_id: int,
    exchange_name: str,
    symbol: str,
    side: str,
    amount: float,
    new_price: float,
    latency_ms: int = 0
):
    """Sends high-performance formatted Order Modified alert to Telegram using its own dedicated DB session."""
    if not user_id:
        return
    db = SessionLocal()
    try:
        now_utc = datetime.now(timezone.utc)
        time_str = now_utc.strftime("%Y-%m-%d %H:%M:%S UTC")
        action_text = "BUY 🟢" if str(side).lower() == 'buy' else "SELL 🔴"
        speed_text = f"⏱ Execution Speed: `{latency_ms} ms` ⚡\n" if latency_ms > 0 else ""
        msg = (
            f"🔄 *MANUAL ORDER MODIFIED*\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"• Exchange: `{exchange_name.capitalize()}`\n"
            f"• Pair: `{symbol}`\n"
            f"• Action: *{action_text}*\n"
            f"• Amount: `{amount}`\n"
            f"• New Price: `${new_price:,.4f}`\n"
            f"• Status: `Pending in Orderbook ⏳`\n"
            f"• Time: `{time_str}`\n"
            f"{speed_text}"
        )
        await NotificationService.send_message(db, user_id, msg, parse_mode="Markdown", alert_type="alert_manual_trade")
    except Exception as e:
        logger.warning(f"Failed to send order modified telegram notification: {e}")
    finally:
        db.close()


async def _emit_manual_trade_in_app(
    user_id: Optional[int],
    title: str,
    message: str,
    event_type: str,
    severity: str = "info",
    meta: Optional[Dict[str, Any]] = None,
):
    """Safely emits a manual_trade in-app notification without affecting order execution."""
    if not user_id:
        return
    try:
        from app.services.system_notification_service import SystemNotificationService
        await SystemNotificationService.emit(
            user_id=user_id,
            category="manual_trade",
            title=title,
            message=message,
            event_type=event_type,
            severity=severity,
            meta=meta or {},
        )
    except Exception as notify_err:
        logger.debug(f"In-app manual_trade emit skipped (non-fatal): {notify_err}")


async def _maybe_emit_api_health_alert(
    user_id: Optional[int],
    exchange_name: Optional[str],
    exc: Exception,
):
    """Emit a market_alerts api_health notification when an exchange auth/API-key failure occurs."""
    if not user_id:
        return
    try:
        from app.services.system_notification_service import (
            SystemNotificationService,
            is_exchange_auth_error,
        )

        if not is_exchange_auth_error(exc):
            return
        ex_label = str(exchange_name or "exchange")
        await SystemNotificationService.emit(
            user_id=user_id,
            category="market_alerts",
            title="Exchange API Key Issue",
            message=f"{ex_label.upper()} API authentication/permission error: {str(exc)[:250]}",
            event_type="api_health",
            severity="critical",
            meta={"exchange": ex_label, "error": str(exc)[:250]},
            dedup_key=f"api_health:{user_id}:{ex_label}:{int(time.time() // 300)}",
        )
    except Exception as notify_err:
        logger.debug(f"API health emit skipped (non-fatal): {notify_err}")


class ManualTradeService:
    _HEDGE_MODE_CACHE = {}   # { cache_key: (is_hedge, expire_timestamp) }
    _LEVERAGE_CACHE = {}     # { cache_key: (leverage, expire_timestamp) }
    _MARGIN_MODE_CACHE = {}  # { cache_key: (margin_mode_upper, expire_timestamp) }
    _ORDER_META_CACHE = {}   # { (api_key_id, order_id_str): (order_meta_dict, timestamp) }
    _ML_PREDICTOR_CACHE = {}  # { f"{model_id}_{symbol}": MLL2Predictor }
    _ML_ROUTE_CACHE = {}     # { model_id: (use_ohlcv_predictor, model_name, timestamp) }
    _OPEN_ORDERS_CACHE = {}  # { (api_key_id, symbol): (timestamp, result_dict) }
    _POSITION_CACHE = {}     # { (api_key_id, symbol): (timestamp, result_dict) }
    _WALLET_BALANCE_CACHE = {}  # { (api_key_id, is_futures[, is_inverse]): (balance_dict, timestamp) }
    _WS_BALANCE_DISABLED_UNTIL = {}  # { id(exchange): expire_timestamp }
    _PREWARM_INFLIGHT_TS = {}  # { f"{apiKey}_{symbol}": last_trigger_timestamp }
    _DECRYPTED_CRED_CACHE = {}  # { (api_key_id, enc_api, enc_sec, enc_pass): (dec_api, dec_sec, dec_pass) }
    _API_KEY_RECORD_CACHE = {}  # { (int(db_id), int(user_id), int(api_key_id)): (timestamp, record) }
    _INFLIGHT_POLLS = {}     # { poll_key: asyncio.Task }

    @staticmethod
    def _lookup_api_key_record(db: Session, user_id: int, api_key_id: int):
        """
        Fast cached API key record lookup with 15s TTL scoped by db session identity,
        eliminating redundant synchronous DB queries during burst polling while preserving
        exact unit-test mock session behavior.
        """
        cache_key = (id(db), int(user_id), int(api_key_id))
        now_ts = time.time()
        cached = ManualTradeService._API_KEY_RECORD_CACHE.get(cache_key)
        if cached is not None and (now_ts - cached[0]) < 15.0:
            return cached[1]
        rec = db.query(models.ApiKey).filter(
            models.ApiKey.id == api_key_id,
            models.ApiKey.user_id == user_id,
            models.ApiKey.is_enabled == True
        ).first()
        if rec is not None:
            if len(ManualTradeService._API_KEY_RECORD_CACHE) > 256:
                ManualTradeService._API_KEY_RECORD_CACHE.clear()
            ManualTradeService._API_KEY_RECORD_CACHE[cache_key] = (now_ts, rec)
        return rec

    @staticmethod
    def invalidate_position_cache(api_key_id: int = None, symbol: str = None):
        """Invalidate short-lived active position cache when orders/fills arrive."""
        if api_key_id is None:
            ManualTradeService._POSITION_CACHE.clear()
        elif symbol is None:
            for k in list(ManualTradeService._POSITION_CACHE.keys()):
                if k[0] == int(api_key_id):
                    ManualTradeService._POSITION_CACHE.pop(k, None)
        else:
            cache_key = (int(api_key_id), str(symbol).strip().upper())
            ManualTradeService._POSITION_CACHE.pop(cache_key, None)

    @staticmethod
    def _normalize_margin_mode_str(margin_mode: Optional[str]) -> Optional[str]:
        if not margin_mode:
            return None
        mm = str(margin_mode).strip().upper()
        if mm in ('CROSS', 'CROSSED'):
            return 'CROSSED'
        if mm == 'ISOLATED':
            return 'ISOLATED'
        return mm

    @staticmethod
    def invalidate_wallet_balance_cache(api_key_id: int = None):
        """Invalidate short-lived wallet balance and position caches when orders/fills arrive."""
        ManualTradeService.invalidate_position_cache(api_key_id)
        if api_key_id is None:
            ManualTradeService._WALLET_BALANCE_CACHE.clear()
        else:
            for k in list(ManualTradeService._WALLET_BALANCE_CACHE.keys()):
                if k[0] == int(api_key_id):
                    ManualTradeService._WALLET_BALANCE_CACHE.pop(k, None)

    @staticmethod
    def _update_wallet_balance_cache(api_key_id: int, is_futures: bool, balance: dict, is_inverse: Optional[bool] = None):
        """Caches wallet balance for ultra-fast zero-latency pre-flight order validation."""
        if api_key_id and isinstance(balance, dict):
            now_ts = time.time()
            ManualTradeService._WALLET_BALANCE_CACHE[(int(api_key_id), bool(is_futures))] = (balance, now_ts)
            if is_inverse is not None:
                ManualTradeService._WALLET_BALANCE_CACHE[(int(api_key_id), bool(is_futures), bool(is_inverse))] = (balance, now_ts)

    @staticmethod
    def _get_cached_wallet_balance(
        api_key_id: int, is_futures: bool, max_age_seconds: float = 45.0, is_inverse: Optional[bool] = None
    ) -> Optional[dict]:
        """Returns cached wallet balance if fresh (< max_age_seconds old), saving ~300-700ms on order placement."""
        now_ts = time.time()
        if is_inverse is not None:
            sub_key = (int(api_key_id), bool(is_futures), bool(is_inverse))
            cached_sub = ManualTradeService._WALLET_BALANCE_CACHE.get(sub_key)
            if cached_sub:
                bal_data, ts = cached_sub
                if now_ts - ts <= max_age_seconds:
                    return bal_data
        key = (int(api_key_id), bool(is_futures))
        cached = ManualTradeService._WALLET_BALANCE_CACHE.get(key)
        if cached:
            bal_data, ts = cached
            if now_ts - ts <= max_age_seconds:
                return bal_data
        return None

    @staticmethod
    def invalidate_open_orders_cache(api_key_id: int = None, symbol: str = None):
        """Invalidates cached open orders and position cache on order placement, cancellation or force trade."""
        ManualTradeService.invalidate_position_cache(api_key_id, symbol)
        if api_key_id is None:
            ManualTradeService._OPEN_ORDERS_CACHE.clear()
        elif symbol is None:
            for k in list(ManualTradeService._OPEN_ORDERS_CACHE.keys()):
                if k[0] == int(api_key_id):
                    ManualTradeService._OPEN_ORDERS_CACHE.pop(k, None)
        else:
            cache_key = (int(api_key_id), str(symbol).strip().upper())
            ManualTradeService._OPEN_ORDERS_CACHE.pop(cache_key, None)

    @staticmethod
    def upsert_open_order_cache(api_key_id: int, symbol: str, order_entry: dict, replace_id: str = None):
        """
        Update cached open orders in-place during rapid Smart Peg / Smart Chase re-pegs
        so frontend HTTP polls stay RAM-cached without hitting REST rate limits.
        """
        if api_key_id is None or not symbol or not isinstance(order_entry, dict):
            return
        cache_key = (int(api_key_id), str(symbol).strip().upper())
        cached = ManualTradeService._OPEN_ORDERS_CACHE.get(cache_key)
        if not cached:
            return
        cached_ts, cached_res = cached
        if not isinstance(cached_res, dict):
            return
        drop_ids = {str(order_entry.get('id') or '')}
        if replace_id:
            drop_ids.add(str(replace_id))
        existing_orders = [
            o for o in (cached_res.get('orders') or [])
            if str((o or {}).get('id') or '') not in drop_ids
        ]
        existing_orders.append(dict(order_entry))
        ManualTradeService._OPEN_ORDERS_CACHE[cache_key] = (
            cached_ts,
            {**cached_res, 'orders': existing_orders},
        )

    @staticmethod
    def _sanitize_ws_order_args(exchange, order_type: str, params: dict, is_futures: bool, is_edit: bool = False):
        """
        Translate CCXT unified params (postOnly, icebergAmount) into native Binance args before
        calling create_order_ws / edit_order_ws, since CCXT's WS helpers extend payload with raw params.
        """
        ws_params = dict(params or {})
        ws_type = order_type
        if getattr(exchange, 'id', '').lower() != 'binance':
            return ws_type, ws_params

        ws_params.pop('icebergAmount', None)
        if str(ws_params.get('timeInForce') or '').upper() == 'PO':
            ws_params.pop('timeInForce', None)
            ws_params['postOnly'] = True

        if ws_params.pop('postOnly', None):
            if str(order_type).lower() == 'limit':
                if is_futures:
                    if not is_edit:
                        ws_params['timeInForce'] = 'GTX'
                else:
                    ws_type = 'LIMIT_MAKER'
                    ws_params.pop('timeInForce', None)
        elif str(ws_type).upper() == 'LIMIT_MAKER':
            ws_params.pop('timeInForce', None)

        if is_futures and is_edit:
            ws_params.pop('timeInForce', None)

        return ws_type, ws_params

    @staticmethod
    async def _get_exchange(api_key_record: models.ApiKey, is_futures: bool, purpose: str = "general"):
        """
        Exchange Pool থেকে একটি ready Exchange instance নিয়ে আসে।
        নতুন করে init করতে হয় না — cached থাকলে তাৎক্ষণিক রিটার্ন করে।
        purpose='order' দিলে dedicated unthrottled order instance রিটার্ন করে।
        Decrypted credentials মেমোরিতে cache করে রাখে যাতে প্রতি poll-এ Fernet decrypt_key() ইভেন্ট লুপ ব্লক না করে।
        """
        raw_pass = getattr(api_key_record, 'passphrase', None) if hasattr(api_key_record, 'passphrase') else None
        cred_cache_key = (
            getattr(api_key_record, 'id', None),
            getattr(api_key_record, 'api_key', None),
            getattr(api_key_record, 'secret_key', None),
            raw_pass,
        )
        cached_creds = ManualTradeService._DECRYPTED_CRED_CACHE.get(cred_cache_key)
        if cached_creds is not None:
            decrypted_api_key, decrypted_secret, passphrase = cached_creds
        else:
            decrypted_secret = decrypt_key(api_key_record.secret_key)
            decrypted_api_key = decrypt_key(api_key_record.api_key)
            passphrase = None
            if raw_pass:
                try:
                    passphrase = decrypt_key(raw_pass)
                except Exception:
                    passphrase = raw_pass
            if len(ManualTradeService._DECRYPTED_CRED_CACHE) > 256:
                ManualTradeService._DECRYPTED_CRED_CACHE.clear()
            ManualTradeService._DECRYPTED_CRED_CACHE[cred_cache_key] = (
                decrypted_api_key,
                decrypted_secret,
                passphrase,
            )

        exchange = await get_or_create_exchange(
            api_key_id=api_key_record.id,
            exchange_name=api_key_record.exchange,
            decrypted_api_key=decrypted_api_key,
            decrypted_secret=decrypted_secret,
            is_futures=is_futures,
            passphrase=passphrase,
            purpose=purpose,
        )
        return exchange

    @staticmethod
    def _get_contract_meta(exchange, symbol: str) -> dict:
        """
        Symbol theke contract metadata (base, quote, settle, is_futures, is_inverse, contract_size) ber kore.
        COIN-M (Inverse) jemon DOGE/USD:DOGE er jonno is_inverse=True ebong contract_size (e.g. 10.0) return kore.
        """
        is_futures = ':' in symbol
        parts = symbol.split('/')
        base_part = parts[0] if len(parts) > 1 else symbol
        quote_part = parts[1].split(':')[0] if len(parts) > 1 else "USDT"
        settle_part = parts[1].split(':')[1] if (len(parts) > 1 and ':' in parts[1]) else quote_part

        is_inverse = False
        contract_size = 1.0

        try:
            if hasattr(exchange, 'markets') and exchange.markets and symbol in exchange.markets:
                m = exchange.markets[symbol]
                base_part = m.get('base') or base_part
                quote_part = m.get('quote') or quote_part
                settle_part = m.get('settle') or settle_part
                is_inverse = bool(m.get('inverse') or m.get('subType') == 'inverse')
                contract_size = float(m.get('contractSize') or 1.0)
            elif is_futures and settle_part.upper() == base_part.upper():
                is_inverse = True
                contract_size = 100.0 if base_part.upper() == 'BTC' else 10.0
        except Exception:
            if is_futures and settle_part.upper() == base_part.upper():
                is_inverse = True
                contract_size = 100.0 if base_part.upper() == 'BTC' else 10.0

        return {
            "base": base_part,
            "quote": quote_part,
            "settle": settle_part,
            "is_futures": is_futures,
            "is_inverse": is_inverse,
            "contract_size": contract_size
        }

    @staticmethod
    def _inject_zero_update_time_futures_assets(
        bal: dict, exchange=None, symbol: str = None, is_inverse: bool = False
    ) -> dict:
        """
        CCXT 4.5.76 parse_balance_custom skips Futures/COIN-M assets with updateTime == 0
        (e.g. freshly transferred DOGE in COIN-M wallet before first trade).
        This helper extracts those assets directly from bal['info'] in 0ms without extra REST calls,
        and also caches symbol leverage/marginMode/hedgeMode from bal['info']['positions'] if present.
        """
        if not isinstance(bal, dict):
            return bal
        info = bal.get('info')
        if exchange and symbol and isinstance(info, dict) and isinstance(info.get('positions'), list):
            try:
                ManualTradeService._cache_position_risk_metadata(
                    exchange, symbol, is_inverse, info['positions']
                )
            except Exception:
                pass

        raw_assets = None
        if isinstance(info, list):
            raw_assets = info
        elif isinstance(info, dict) and isinstance(info.get('assets'), list):
            raw_assets = info.get('assets')
        if not raw_assets:
            return bal

        free_map = bal.setdefault('free', {}) if isinstance(bal.get('free'), dict) else {}
        used_map = bal.setdefault('used', {}) if isinstance(bal.get('used'), dict) else {}
        total_map = bal.setdefault('total', {}) if isinstance(bal.get('total'), dict) else {}

        for item in raw_assets:
            if not isinstance(item, dict):
                continue
            asset = str(item.get('asset') or '').strip().upper()
            if not asset:
                continue
            existing = bal.get(asset) if isinstance(bal.get(asset), dict) else {}
            if float(existing.get('total') or existing.get('free') or 0.0) > 0:
                continue
            avail = float(
                item.get('availableBalance')
                or item.get('withdrawAvailable')
                or item.get('walletBalance')
                or item.get('balance')
                or 0.0
            )
            tot = float(
                item.get('walletBalance')
                or item.get('marginBalance')
                or item.get('balance')
                or avail
            )
            if avail > 0 or tot > 0:
                used = max(0.0, tot - avail)
                bal[asset] = {'free': avail, 'used': used, 'total': tot}
                free_map[asset] = avail
                used_map[asset] = used
                total_map[asset] = tot
        return bal

    @staticmethod
    def _normalize_ws_balance(exchange, bal: Any, meta: dict, symbol: str = None) -> Optional[dict]:
        """
        Fix ccxt.pro binance.handle_account_status_ws passing type=None to parse_balance_custom
        on Spot, which causes bal['free']/['used']/['total'] to be empty dicts while raw
        spot balances still live in bal['info']['balances'].
        Also injects COIN-M / Futures assets with updateTime=0 from bal['info'].
        Returns None if normalized balance still lacks populated dicts so caller falls back to REST.
        """
        if not isinstance(bal, dict):
            return None
        if meta.get('is_futures'):
            ManualTradeService._inject_zero_update_time_futures_assets(
                bal, exchange=exchange, symbol=symbol, is_inverse=bool(meta.get('is_inverse'))
            )
        has_populated_asset = any(
            isinstance(v, dict) and ("free" in v or "total" in v)
            for k, v in bal.items()
            if k not in ("info", "free", "used", "total", "timestamp", "datetime")
        )
        if not bal.get('free') and not bal.get('total') and not has_populated_asset:
            info = bal.get('info')
            if (
                not meta.get('is_futures')
                and isinstance(info, dict)
                and isinstance(info.get('balances'), list)
                and hasattr(exchange, 'parse_balance_custom')
            ):
                try:
                    bal = exchange.parse_balance_custom(info, type='spot')
                except Exception as norm_err:
                    logger.debug(f"Spot WS balance normalization fallback: {norm_err}")
        has_populated_asset = isinstance(bal, dict) and any(
            isinstance(v, dict) and ("free" in v or "total" in v)
            for k, v in bal.items()
            if k not in ("info", "free", "used", "total", "timestamp", "datetime")
        )
        if isinstance(bal, dict) and (bal.get('free') or bal.get('total') or has_populated_asset):
            return bal
        return None

    @staticmethod
    async def _fetch_wallet_balance(exchange, symbol: str, meta: dict = None, api_key_id: int = None) -> dict:
        """
        Futures subType (linear vs inverse) onujayi sothik balance API call kore.
        Binance COIN-M (inverse) er jonno dapiPrivateGetBalance / fetch_balance({'subType': 'inverse'}) call kore.
        """
        if not meta:
            meta = ManualTradeService._get_contract_meta(exchange, symbol)

        is_fut = bool(meta.get('is_futures'))
        is_inv = bool(meta.get('is_inverse'))
        params = {}
        if is_fut:
            params['subType'] = 'inverse' if is_inv else 'linear'

        try:
            ex_ptr = id(exchange)
            ws_allowed = time.time() >= ManualTradeService._WS_BALANCE_DISABLED_UNTIL.get(ex_ptr, 0.0)
            if (
                ws_allowed
                and getattr(exchange, 'has', {}).get('fetchBalanceWs')
                and hasattr(exchange, 'fetch_balance_ws')
                and is_ws_api_ready(exchange, is_futures=is_fut, is_inverse=is_inv)
            ):
                try:
                    ws_params = {'type': 'delivery'} if (is_fut and is_inv) else ({'type': 'future'} if is_fut else {})
                    ws_bal = await asyncio.wait_for(exchange.fetch_balance_ws(ws_params), timeout=0.65)
                    bal = ManualTradeService._normalize_ws_balance(exchange, ws_bal, meta, symbol=symbol)
                    if bal is not None:
                        if api_key_id is not None:
                            ManualTradeService._update_wallet_balance_cache(api_key_id, is_fut, bal, is_inverse=is_inv)
                        return bal
                    ManualTradeService._WS_BALANCE_DISABLED_UNTIL[ex_ptr] = time.time() + 60.0
                except Exception as ws_bal_err:
                    ManualTradeService._WS_BALANCE_DISABLED_UNTIL[ex_ptr] = time.time() + 60.0
                    logger.debug(f"fetch_balance_ws fallback to REST (cooldown 60s): {ws_bal_err}")
            bal = await (exchange.fetch_balance(params) if params else exchange.fetch_balance())
            if is_fut and isinstance(bal, dict):
                ManualTradeService._inject_zero_update_time_futures_assets(
                    bal, exchange=exchange, symbol=symbol, is_inverse=is_inv
                )
            if api_key_id is not None:
                ManualTradeService._update_wallet_balance_cache(api_key_id, is_fut, bal, is_inverse=is_inv)
            return bal
        except Exception as e:
            if is_inv:
                try:
                    bal = await exchange.fetch_balance({'type': 'delivery'})
                    if isinstance(bal, dict):
                        ManualTradeService._inject_zero_update_time_futures_assets(
                            bal, exchange=exchange, symbol=symbol, is_inverse=is_inv
                        )
                    if api_key_id is not None:
                        ManualTradeService._update_wallet_balance_cache(api_key_id, is_fut, bal, is_inverse=is_inv)
                    return bal
                except Exception:
                    pass
            raise e

    @staticmethod
    def _extract_asset_balance(bal: dict, asset: str) -> Tuple[float, float, float]:
        """Extract (free, used, total) for an asset from raw CCXT balance dicts."""
        if not isinstance(bal, dict) or not asset:
            return 0.0, 0.0, 0.0
        info = bal.get(asset) if isinstance(bal.get(asset), dict) else {}
        free_map = bal.get('free') if isinstance(bal.get('free'), dict) else {}
        used_map = bal.get('used') if isinstance(bal.get('used'), dict) else {}
        total_map = bal.get('total') if isinstance(bal.get('total'), dict) else {}
        free_val = float(info.get('free', 0.0) or free_map.get(asset, 0.0) or 0.0)
        used_val = float(info.get('used', 0.0) or used_map.get(asset, 0.0) or 0.0)
        total_val = float(info.get('total', 0.0) or total_map.get(asset, 0.0) or (free_val + used_val))
        return free_val, used_val, total_val

    @staticmethod
    async def _is_binance_hedge_mode(exchange, symbol: str, is_inverse: bool = False) -> bool:
        """
        Binance Futures er khetre Hedge Mode (Dual Position Side) on kina check kore.
        Inverse (COIN-M) hole dapi age check kore, Linear (USDT-M) hole fapi age check kore.
        Cache ব্যবহার করে প্রতি ক্লিকে অতিরিক্ত 200ms latency বাঁচায়।
        """
        ex_id = getattr(exchange, 'id', '').lower()
        if not ex_id.startswith('binance'):
            return False

        cache_key = f"{getattr(exchange, 'apiKey', '')}_{is_inverse}"
        now = time.time()
        if cache_key in ManualTradeService._HEDGE_MODE_CACHE:
            val, expire = ManualTradeService._HEDGE_MODE_CACHE[cache_key]
            if now < expire:
                return val

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
                    val = bool(res.get('dualSidePosition', False))
                    ManualTradeService._HEDGE_MODE_CACHE[cache_key] = (val, now + 3600)
                    return val
                except Exception:
                    pass
        return False

    @staticmethod
    def _cache_position_risk_metadata(exchange, symbol: str, is_inverse: bool, records: list):
        """Extracts leverage, marginType/isolated, and hedge mode from raw or parsed position records into RAM caches."""
        if not exchange or not symbol or not isinstance(records, list):
            return
        api_k = getattr(exchange, 'apiKey', '')
        key_sym = f"{api_k}_{symbol}"
        hedge_key = f"{api_k}_{bool(is_inverse)}"
        now_ts = time.time()
        target_clean = str(symbol).split(':')[0].replace('/', '').upper()

        for rec in records:
            if not isinstance(rec, dict):
                continue
            info = rec.get('info') if isinstance(rec.get('info'), dict) else rec
            rec_sym = str(rec.get('symbol') or info.get('symbol') or '').upper()
            rec_clean = rec_sym.split(':')[0].replace('/', '').replace('_PERP', '')
            if rec_clean and target_clean and rec_clean != target_clean and target_clean not in rec_clean:
                continue

            # 1. Leverage
            lev_raw = rec.get('leverage') or info.get('leverage')
            if lev_raw is not None:
                try:
                    lev_int = int(float(lev_raw))
                    if lev_int > 0:
                        ManualTradeService._LEVERAGE_CACHE[key_sym] = (lev_int, now_ts + 3600)
                except (ValueError, TypeError):
                    pass

            # 2. Margin Mode (isolated / cross or boolean 'isolated' from account positions)
            mm_raw = rec.get('marginMode') or rec.get('marginType') or info.get('marginType')
            if not mm_raw and 'isolated' in info and info.get('isolated') is not None:
                iso_val = info.get('isolated')
                is_iso = iso_val is True or str(iso_val).strip().lower() == 'true'
                mm_raw = 'ISOLATED' if is_iso else 'CROSSED'
            mm_norm = ManualTradeService._normalize_margin_mode_str(mm_raw)
            if mm_norm:
                ManualTradeService._MARGIN_MODE_CACHE[key_sym] = (mm_norm, now_ts + 3600)

            # 3. Hedge Mode (positionSide LONG/SHORT vs BOTH)
            pos_side = str(info.get('positionSide') or '').upper()
            if pos_side in ('LONG', 'SHORT'):
                ManualTradeService._HEDGE_MODE_CACHE[hedge_key] = (True, now_ts + 3600)
            elif pos_side == 'BOTH':
                ManualTradeService._HEDGE_MODE_CACHE[hedge_key] = (False, now_ts + 3600)

    @staticmethod
    async def _prewarm_futures_trading_state(exchange, symbol: str, is_inverse: bool = False):
        """
        Background pre-warmer triggered when ManualTradeModal fetches balance/position.
        Pre-connects WS-API (ws-fapi / ws-dapi), warms REST TCP/TLS pools (fapi / dapi),
        and populates _HEDGE_MODE_CACHE, _MARGIN_MODE_CACHE, and _LEVERAGE_CACHE so that
        subsequent BUY/SELL order clicks execute in 1 single RTT (~250ms) with 0ms pre-flight overhead.
        """
        if not exchange or not symbol:
            return
        try:
            api_k = getattr(exchange, 'apiKey', '')
            key_sym = f"{api_k}_{symbol}"
            hedge_key = f"{api_k}_{bool(is_inverse)}"
            now_ts = time.time()

            last_prewarm = ManualTradeService._PREWARM_INFLIGHT_TS.get(key_sym, 0.0)
            if (now_ts - last_prewarm) < 15.0:
                return
            ManualTradeService._PREWARM_INFLIGHT_TS[key_sym] = now_ts

            need_hedge = (
                hedge_key not in ManualTradeService._HEDGE_MODE_CACHE
                or ManualTradeService._HEDGE_MODE_CACHE[hedge_key][1] <= now_ts
            )
            need_sym_meta = (
                key_sym not in ManualTradeService._LEVERAGE_CACHE
                or ManualTradeService._LEVERAGE_CACHE[key_sym][1] <= now_ts
                or key_sym not in ManualTradeService._MARGIN_MODE_CACHE
                or ManualTradeService._MARGIN_MODE_CACHE[key_sym][1] <= now_ts
            )

            # Warm shared TCP/TLS pool (deduplicated globally across all users to 1 ping / 20s)
            await prewarm_exchange_connections(exchange, is_futures=True)
            if is_inverse:
                schedule_ws_api_prewarm(exchange, is_futures=True, is_inverse=True)

            # Fetch PositionRisk first (Weight=1 on COIN-M, Weight=5 on USDT-M) because it returns
            # leverage, marginType, AND positionSide (Hedge Mode) in a single lightweight call,
            # saving the expensive 30-weight PositionSideDual endpoint across 1,000+ users!
            if (need_sym_meta or need_hedge) and getattr(exchange, 'id', '').lower().startswith('binance'):
                clean_sym = str(symbol).split(':')[0].replace('/', '').upper()
                native_sym = bracket_order_service._resolve_native_futures_symbol(exchange, symbol, is_inverse=is_inverse)
                try:
                    raw_list = None
                    if is_inverse and hasattr(exchange, 'dapiPrivateGetPositionRisk'):
                        raw_list = await exchange.dapiPrivateGetPositionRisk({'pair': clean_sym})
                    elif not is_inverse and hasattr(exchange, 'fapiPrivateV2GetPositionRisk'):
                        raw_list = await exchange.fapiPrivateV2GetPositionRisk({'symbol': native_sym})
                    if isinstance(raw_list, list):
                        ManualTradeService._cache_position_risk_metadata(exchange, symbol, is_inverse, raw_list)
                except Exception:
                    pass

            # Only call PositionSideDual (Weight=30) as a fallback if Hedge Mode is still unknown
            if (
                hedge_key not in ManualTradeService._HEDGE_MODE_CACHE
                or ManualTradeService._HEDGE_MODE_CACHE[hedge_key][1] <= time.time()
            ):
                await ManualTradeService._is_binance_hedge_mode(exchange, symbol, is_inverse=is_inverse)
        except Exception:
            pass

    @staticmethod
    async def get_fast_balance(db: Session, user_id: int, api_key_id: int, symbol: str, force_refresh: bool = False) -> dict:
        """
        Fetches the free balance for both the base and quote assets of the given symbol.
        Uses unthrottled order exchange pool + short 2.5s hot cache for sub-5ms repeat polls.
        """
        api_key_record = ManualTradeService._lookup_api_key_record(db, user_id, api_key_id)

        if not api_key_record:
            raise HTTPException(status_code=404, detail="API Key not found or inactive")

        is_futures = ':' in symbol
        try:
            exchange = await ManualTradeService._get_exchange(api_key_record, is_futures, purpose="order")
            meta = ManualTradeService._get_contract_meta(exchange, symbol)
            is_inv = bool(meta.get('is_inverse'))
            balance = None
            if not force_refresh:
                balance = ManualTradeService._get_cached_wallet_balance(
                    api_key_id, meta.get('is_futures', is_futures), max_age_seconds=2.5, is_inverse=is_inv
                )
            if balance is None:
                balance = await ManualTradeService._fetch_wallet_balance(exchange, symbol, meta, api_key_id=api_key_id)
            if is_futures:
                pw_key = f"{api_key_id}_{symbol}"
                now_pw = time.time()
                if (now_pw - ManualTradeService._PREWARM_INFLIGHT_TS.get(pw_key, 0.0)) >= 20.0:
                    ManualTradeService._PREWARM_INFLIGHT_TS[pw_key] = now_pw
                    asyncio.create_task(ManualTradeService._prewarm_futures_trading_state(exchange, symbol, is_inverse=is_inv))

            base_part = meta["base"]
            quote_part = meta["quote"]

            base_info = balance.get(base_part, {}) if isinstance(balance.get(base_part), dict) else {}
            quote_info = balance.get(quote_part, {}) if isinstance(balance.get(quote_part), dict) else {}

            base_free = base_info.get('free') or (balance.get('free', {}).get(base_part) if isinstance(balance.get('free'), dict) else 0.0) or 0.0
            base_used = base_info.get('used') or (balance.get('used', {}).get(base_part) if isinstance(balance.get('used'), dict) else 0.0) or 0.0
            base_total = base_info.get('total') or (balance.get('total', {}).get(base_part) if isinstance(balance.get('total'), dict) else 0.0) or (float(base_free) + float(base_used))

            quote_free = quote_info.get('free') or (balance.get('free', {}).get(quote_part) if isinstance(balance.get('free'), dict) else 0.0) or 0.0
            quote_used = quote_info.get('used') or (balance.get('used', {}).get(quote_part) if isinstance(balance.get('used'), dict) else 0.0) or 0.0
            quote_total = quote_info.get('total') or (balance.get('total', {}).get(quote_part) if isinstance(balance.get('total'), dict) else 0.0) or (float(quote_free) + float(quote_used))

            # Direct fallback check for Binance COIN-M if base_free is 0.0
            # Some accounts or assets with updateTime=0 get skipped by CCXT parse_balance
            spot_doge = 0.0
            usds_doge = 0.0
            if meta.get('is_inverse') and float(base_free) == 0.0 and getattr(exchange, 'id', '').lower().startswith('binance'):
                # 1. Direct dapiPrivateGetBalance
                try:
                    if hasattr(exchange, 'dapiPrivateGetBalance'):
                        d_bals = await exchange.dapiPrivateGetBalance()
                        if isinstance(d_bals, list):
                            ManualTradeService._inject_zero_update_time_futures_assets({'info': d_bals, **balance})
                            for b in d_bals:
                                if str(b.get('asset', '')).upper() == base_part.upper():
                                    avail = float(b.get('availableBalance') or b.get('withdrawAvailable') or b.get('balance') or 0.0)
                                    tot = float(b.get('balance') or avail)
                                    base_free = avail
                                    base_used = max(0.0, tot - avail)
                                    base_total = tot
                                    balance[base_part] = {'free': base_free, 'used': base_used, 'total': base_total}
                                    ManualTradeService._update_wallet_balance_cache(api_key_id, is_futures, balance, is_inverse=True)
                                    logger.info(f"💰 Direct dapiPrivateGetBalance for {base_part}: free={base_free}, total={base_total}")
                                    break
                except Exception as d_err:
                    logger.debug(f"Direct dapiPrivateGetBalance fallback check: {d_err}")

                # 2. Direct dapiPrivateGetAccount if still 0.0
                if float(base_free) == 0.0:
                    try:
                        if hasattr(exchange, 'dapiPrivateGetAccount'):
                            acct = await exchange.dapiPrivateGetAccount()
                            for a in acct.get('assets', []):
                                if str(a.get('asset', '')).upper() == base_part.upper():
                                    avail = float(a.get('availableBalance') or a.get('walletBalance') or 0.0)
                                    tot = float(a.get('walletBalance') or a.get('marginBalance') or avail)
                                    base_free = avail
                                    base_used = max(0.0, tot - avail)
                                    base_total = tot
                                    balance[base_part] = {'free': base_free, 'used': base_used, 'total': base_total}
                                    ManualTradeService._update_wallet_balance_cache(api_key_id, is_futures, balance, is_inverse=True)
                                    logger.info(f"💰 Direct dapiPrivateGetAccount for {base_part}: free={base_free}, total={base_total}")
                                    break
                    except Exception as acct_err:
                        logger.debug(f"Direct dapiPrivateGetAccount fallback check: {acct_err}")

                # 3. Check other wallets (USDⓈ-M or Spot) to diagnose if user transferred to wrong wallet
                if float(base_free) == 0.0:
                    try:
                        if hasattr(exchange, 'fapiPrivateV2GetBalance'):
                            f_bals = await exchange.fapiPrivateV2GetBalance()
                            if isinstance(f_bals, list):
                                for b in f_bals:
                                    if str(b.get('asset', '')).upper() == base_part.upper():
                                        usds_doge = float(b.get('balance') or b.get('availableBalance') or 0.0)
                                        if usds_doge > 0:
                                            logger.info(f"ℹ️ User has {usds_doge} {base_part} in USDⓈ-M wallet instead of COIN-M")
                                        break
                    except Exception:
                        pass

                    try:
                        spot_b = await exchange.fetch_balance({'type': 'spot'})
                        spot_doge = float(spot_b.get(base_part, {}).get('free', 0.0) or (spot_b.get('free', {}).get(base_part, 0.0) if isinstance(spot_b.get('free'), dict) else 0.0))
                        if spot_doge > 0:
                            logger.info(f"ℹ️ User has {spot_doge} {base_part} in Spot wallet instead of COIN-M")
                    except Exception:
                        pass

            return {
                "base": base_part,
                "base_free": float(base_free),
                "base_used": float(base_used),
                "base_total": float(base_total),
                "quote": quote_part,
                "quote_free": float(quote_free),
                "quote_used": float(quote_used),
                "quote_total": float(quote_total),
                "settle": meta["settle"],
                "is_futures": is_futures,
                "is_inverse": meta["is_inverse"],
                "contract_size": meta["contract_size"],
                "spot_free": spot_doge,
                "usds_futures_free": usds_doge
            }

        except HTTPException:
            raise
        except Exception as e:
            await _maybe_emit_api_health_alert(user_id, api_key_record.exchange, e)
            logger.error(f"Fast balance fetch failed: {api_key_record.exchange} {e}")
            raise HTTPException(status_code=500, detail=f"Balance Error: {str(e)}")

    @staticmethod
    async def get_active_position(db: Session, user_id: int, api_key_id: int, symbol: str, force_refresh: bool = False, max_age_seconds: float = 1.5) -> dict:
        """
        Fetches the current open position for the requested symbol.
        Used for calculating 'Reduce Only' percentages reliably.
        COIN-M (Inverse) এর ক্ষেত্রে contracts এবং base currency equivalent উভয়ই রিটার্ন করে।
        Includes a 1.5s hot RAM cache to prevent concurrent component polls from spamming Binance REST.
        """
        is_futures = ':' in symbol
        if not is_futures:
            # Spot markets don't have "positions", just balances.
            return {"amount": 0.0, "side": "none", "entry_price": 0.0, "mark_price": 0.0, "unrealized_pnl": 0.0, "pnl_pct": 0.0}

        cache_key = (int(api_key_id), str(symbol).strip().upper())
        now_ts = time.time()
        if not force_refresh and cache_key in ManualTradeService._POSITION_CACHE:
            cached_ts, cached_pos = ManualTradeService._POSITION_CACHE[cache_key]
            if (now_ts - cached_ts) < max_age_seconds:
                return cached_pos

        api_key_record = ManualTradeService._lookup_api_key_record(db, user_id, api_key_id)

        if not api_key_record:
            raise HTTPException(status_code=404, detail="API Key not found or inactive")
            
        try:
            exchange = await ManualTradeService._get_exchange(api_key_record, is_futures, purpose="order")
            meta = ManualTradeService._get_contract_meta(exchange, symbol)
            is_inv = bool(meta.get('is_inverse'))
            
            pos_params = {}
            if is_inv:
                pos_params['subType'] = 'inverse'

            positions = await exchange.fetch_positions([symbol], pos_params)
            if isinstance(positions, list) and positions:
                ManualTradeService._cache_position_risk_metadata(exchange, symbol, is_inv, positions)
            pw_key = f"{api_key_id}_{symbol}"
            now_pw = time.time()
            if (now_pw - ManualTradeService._PREWARM_INFLIGHT_TS.get(pw_key, 0.0)) >= 20.0:
                ManualTradeService._PREWARM_INFLIGHT_TS[pw_key] = now_pw
                asyncio.create_task(ManualTradeService._prewarm_futures_trading_state(exchange, symbol, is_inverse=is_inv))
            
            # Find the active position for this symbol
            active_pos = None
            target_sym = str(symbol or '').strip().upper()
            target_base = target_sym.split('/')[0].split(':')[0]
            for p in positions:
                p_sym = str(p.get('symbol') or '').strip().upper()
                p_base = p_sym.split('/')[0].split(':')[0]
                sym_match = (
                    p_sym == target_sym
                    or p_sym.split(':')[0] == target_sym.split(':')[0]
                    or p_sym.replace('/', '') == target_sym.replace('/', '')
                    or (target_base and p_base == target_base and (':' in p_sym or ':' in target_sym))
                )
                if sym_match and float(p.get('contracts', 0) or p.get('info', {}).get('positionAmt', 0)) != 0:
                    active_pos = p
                    break
            
            contract_size = meta.get('contract_size', 1.0)
            if not active_pos:
                 res_empty = {
                     "amount": 0.0,
                     "contracts": 0.0,
                     "contract_size": contract_size,
                     "is_inverse": meta.get('is_inverse', False),
                     "side": "none",
                     "entry_price": 0.0,
                     "mark_price": 0.0,
                     "unrealized_pnl": 0.0,
                     "pnl_pct": 0.0,
                 }
                 ManualTradeService._POSITION_CACHE[cache_key] = (time.time(), res_empty)
                 return res_empty
                 
            # Extract position data consistently across exchanges
            raw_contracts = float(active_pos.get('contracts') or 0.0)
            if raw_contracts == 0:
                 raw_contracts = abs(float(active_pos.get('info', {}).get('positionAmt') or 0.0))
            
            side = active_pos.get('side', 'none').lower()
            if side == 'none':
                 pos_amt = float(active_pos.get('info', {}).get('positionAmt') or 0.0)
                 if pos_amt > 0: side = 'long'
                 elif pos_amt < 0: side = 'short'

            info_d = active_pos.get('info') if isinstance(active_pos.get('info'), dict) else {}
            mark_price = float(active_pos.get('markPrice') or info_d.get('markPrice') or 0.0)
            entry_price = float(active_pos.get('entryPrice') or info_d.get('entryPrice') or 0.0)
            unrealized_pnl = float(
                active_pos.get('unrealizedPnl')
                if active_pos.get('unrealizedPnl') is not None
                else (info_d.get('unRealizedProfit') or info_d.get('unrealizedProfit') or 0.0)
            )
            pnl_pct = 0.0
            if entry_price > 0 and mark_price > 0:
                pnl_pct = (
                    ((mark_price - entry_price) / entry_price) * 100.0
                    if side == 'long'
                    else (((entry_price - mark_price) / entry_price) * 100.0 if side == 'short' else 0.0)
                )
            elif active_pos.get('percentage') is not None:
                try:
                    pnl_pct = float(active_pos.get('percentage') or 0.0)
                except (TypeError, ValueError):
                    pnl_pct = 0.0
            
            # For Inverse contracts, convert contracts to base asset (DOGE) quantity
            base_amount = raw_contracts
            if meta.get('is_inverse') and contract_size > 0:
                if mark_price > 0:
                    base_amount = (raw_contracts * contract_size) / mark_price
                else:
                    base_amount = raw_contracts * contract_size
            
            res_pos = {
                 "amount": float(base_amount),
                 "contracts": float(raw_contracts),
                 "contract_size": float(contract_size),
                 "is_inverse": meta.get('is_inverse', False),
                 "side": side,
                 "entry_price": float(entry_price),
                 "mark_price": float(mark_price),
                 "unrealized_pnl": float(unrealized_pnl),
                 "pnl_pct": round(float(pnl_pct), 3),
            }
            ManualTradeService._POSITION_CACHE[cache_key] = (time.time(), res_pos)
            return res_pos

        except HTTPException:
            raise
        except Exception as e:
            await _maybe_emit_api_health_alert(user_id, api_key_record.exchange, e)
            logger.error(f"Fast position fetch failed: {api_key_record.exchange} {e}")
            raise HTTPException(status_code=500, detail=f"Position Error: {str(e)}")

    @staticmethod
    def _extract_trigger_price(order_dict: dict, info_dict: dict = None) -> float:
        """
        Safely extract a positive trigger/stop price (> 0) from CCXT order + raw exchange info.
        Prevents the Python truthiness bug where Binance returns string "0.00000000" in info['stopPrice'].
        """
        if info_dict is None:
            info_dict = order_dict.get('info') if isinstance(order_dict.get('info'), dict) else {}
        for candidate in (
            order_dict.get('stopPrice'),
            order_dict.get('triggerPrice'),
            info_dict.get('triggerPrice'),
            info_dict.get('stopPrice'),
            info_dict.get('activatePrice'),
        ):
            if candidate is not None:
                try:
                    val = float(candidate)
                    if val > 0:
                        return val
                except (ValueError, TypeError):
                    continue
        return 0.0

    @staticmethod
    async def get_open_limit_orders(db: Session, user_id: int, api_key_id: int, symbol: str, force_refresh: bool = False) -> dict:
        """
        ওই exchange এর চলমান Open Limit Orders ফেচ করে chart overlay এর জন্য।
        শুধুমাত্র 'open' status এবং 'limit' type এর orders return করে।
        Binance Rate Limit (429) থেকে সম্পূর্ণ সুরক্ষার জন্য 2.5s RAM-cache যুক্ত।
        """
        cache_key = (int(api_key_id), str(symbol).strip().upper())
        now_ts = time.time()
        if not force_refresh and cache_key in ManualTradeService._OPEN_ORDERS_CACHE:
            cached_ts, cached_res = ManualTradeService._OPEN_ORDERS_CACHE[cache_key]
            if (now_ts - cached_ts) < 2.5:
                return cached_res

        api_key_record = ManualTradeService._lookup_api_key_record(db, user_id, api_key_id)

        if not api_key_record:
            raise HTTPException(status_code=404, detail="API Key not found or inactive")

        is_futures = ':' in symbol

        try:
            try:
                from app.services.user_order_stream import ensure_user_order_stream
                uos_res = ensure_user_order_stream(user_id, api_key_record, is_futures, symbol)
                if asyncio.iscoroutine(uos_res):
                    uos_res.close()
            except Exception:
                pass

            exchange = await ManualTradeService._get_exchange(api_key_record, is_futures)
            meta = ManualTradeService._get_contract_meta(exchange, symbol)
            is_inv = bool(meta.get('is_inverse'))
            if is_futures:
                pw_key = f"{api_key_id}_{symbol}"
                now_pw = time.time()
                if (now_pw - ManualTradeService._PREWARM_INFLIGHT_TS.get(pw_key, 0.0)) >= 20.0:
                    ManualTradeService._PREWARM_INFLIGHT_TS[pw_key] = now_pw
                    asyncio.create_task(ManualTradeService._prewarm_futures_trading_state(exchange, symbol, is_inverse=is_inv))
            if is_futures and not is_inv:
                std_res, stop_res = await asyncio.gather(
                    exchange.fetch_open_orders(symbol),
                    exchange.fetch_open_orders(symbol, params={'stop': True}),
                    return_exceptions=True,
                )
                if isinstance(std_res, Exception):
                    raise std_res
                raw_orders = list(std_res or [])
                if not isinstance(stop_res, Exception) and stop_res:
                    raw_orders.extend(stop_res)
                elif isinstance(stop_res, Exception):
                    logger.debug(f'Failed to fetch conditional stop orders for {symbol}: {stop_res}')
            else:
                raw_orders = await exchange.fetch_open_orders(symbol)

            # Exclude internal disaster SL orders that belong to active software Smart Chases
            # so the chart only displays the primary Smart Chase trigger line
            active_disaster_ids = set()
            active_tp_ids = set()
            try:
                from app.services.bracket_order_service import BracketOrderService
                active_tp_ids.update(BracketOrderService.KNOWN_TP_ORDER_IDS)
                for s_data in BracketOrderService.ACTIVE_SOFTWARE_SL.values():
                    d_id = s_data.get('disaster_sl_order_id')
                    if d_id:
                        active_disaster_ids.add(str(d_id))
                    t_id = s_data.get('tp_order_id')
                    if t_id:
                        active_tp_ids.add(str(t_id))
                from app.services.manual_smart_chase_executor import ACTIVE_SMART_CHASES
                for c_data in ACTIVE_SMART_CHASES.values():
                    d_id = c_data.get('disaster_sl_order_id')
                    if d_id:
                        active_disaster_ids.add(str(d_id))
                    t_id = c_data.get('tp_order_id')
                    if t_id:
                        active_tp_ids.add(str(t_id))
            except Exception as d_chk_err:
                logger.debug(f"Disaster/TP ID check: {d_chk_err}")

            orders = []
            seen_order_ids = set()
            for o in raw_orders:
                status = str(o.get('status') or '').lower()
                if status not in ('open', 'new', 'pending_new', 'untiggered', 'untriggered'):
                    continue

                order_id_str = str(o.get('id'))
                if not order_id_str or order_id_str in active_disaster_ids or order_id_str in seen_order_ids:
                    continue

                raw_type = str(o.get('type') or '').lower()
                info_dict = o.get('info') if isinstance(o.get('info'), dict) else {}
                info_type = str(info_dict.get('orderType') or info_dict.get('type') or info_dict.get('origType') or '').lower()
                trigger_px = ManualTradeService._extract_trigger_price(o, info_dict)
                has_trigger = trigger_px > 0

                is_tp = (
                    'take_profit' in raw_type or
                    'take_profit' in info_type or
                    order_id_str in active_tp_ids
                )
                is_stop = (not is_tp) and (
                    'stop' in raw_type or 'trailing' in raw_type or
                    'stop' in info_type or 'trailing' in info_type or
                    has_trigger
                )
                is_limit = 'limit' in raw_type or 'limit' in info_type or is_stop or is_tp

                if not is_limit:
                    continue

                # Fetch price: stop orders may have 0 for price and the trigger in stopPrice/triggerPrice
                price = float(o.get('price') or 0.0)
                if price <= 0:
                    price = trigger_px

                if price > 0:
                    seen_order_ids.add(order_id_str)
                    raw_iceberg_qty = float(info_dict.get('icebergQty') or 0.0)
                    tif_upper = str(info_dict.get('timeInForce') or o.get('timeInForce') or '').upper()
                    is_post_only_order = (
                        'limit_maker' in raw_type
                        or 'limit_maker' in info_type
                        or tif_upper == 'GTX'
                        or bool(o.get('postOnly'))
                    )
                    order_entry = {
                        'id': order_id_str,
                        'side': str(o.get('side') or '').lower(),  # 'buy' or 'sell'
                        'price': price,
                        'amount': float(o.get('amount') or info_dict.get('origQty') or 0.0),
                        'filled': float(o.get('filled') or 0.0),
                        'remaining': float(o.get('remaining') or o.get('amount') or info_dict.get('origQty') or 0.0),
                        'isSoftwareSL': is_stop,
                        'mode': 'TP' if is_tp else ('STOP' if is_stop else 'LIMIT'),
                        'isPostOnly': is_post_only_order,
                        'isIceberg': raw_iceberg_qty > 0,
                        'icebergQty': raw_iceberg_qty if raw_iceberg_qty > 0 else None
                    }
                    orders.append(order_entry)
                    ManualTradeService._ORDER_META_CACHE[(int(api_key_id), order_id_str)] = (order_entry, now_ts)

            res = {"orders": orders, "symbol": symbol, "exchange": api_key_record.exchange}
            ManualTradeService._OPEN_ORDERS_CACHE[cache_key] = (now_ts, res)
            return res

        except HTTPException:
            raise
        except Exception as e:
            await _maybe_emit_api_health_alert(user_id, api_key_record.exchange, e)
            logger.error(f"Open limit orders fetch failed: {api_key_record.exchange} {e}")
            raise HTTPException(status_code=500, detail=f"Open Orders Error: {str(e)}")

    @staticmethod
    def _should_use_ohlcv_predictor(
        dataset_type: Optional[str],
        indicators: Optional[list],
        model_features: Optional[list],
        is_loaded: bool = True,
    ) -> bool:
        """Determines whether a model routes to `ml_predictor` (Route A) vs `MLL2Predictor` (Route B)."""
        if dataset_type in ('l2_orderbook', 'hybrid_deep') and is_loaded and not bool(indicators):
            return False
        if (
            not is_loaded
            or dataset_type in ('ohlcv', 'historical_trades', 'hybrid', 'forex')
            or bool(indicators)
        ):
            return True
        ohlcv_indicator_prefixes = (
            'Open', 'High', 'Low', 'Volume', 'RSI', 'MACD', 'EMA', 'SMA',
            'BB_', 'ATR', 'ADX', 'Stoch', 'CCI', 'OBV', 'MFI', 'WillR', 'ROC'
        )
        return bool(model_features) and any(
            any(str(f).startswith(pref) for pref in ohlcv_indicator_prefixes)
            for f in model_features
        )

    @staticmethod
    def _inspect_ml_filter_route(ml_model_id: str) -> Tuple[bool, Optional[str]]:
        """
        Lightweight pre-flight check reading DB record + small metadata JSON only (zero
        joblib/torch model deserialization) so OHLCV/Tick-Trade models bypass MLL2Predictor.
        """
        import os
        import json

        model_id = str(ml_model_id)
        now_ts = time.time()
        cached = ManualTradeService._ML_ROUTE_CACHE.get(model_id)
        if cached and (now_ts - cached[2]) < 30.0:
            return cached[0], cached[1]

        from app.models.ml_model import CustomMLModel, ModelVersion

        use_ohlcv = True
        model_name = None
        db = SessionLocal()
        try:
            db_model = db.query(CustomMLModel).filter(CustomMLModel.id == model_id).first()
            if not db_model or not db_model.active_version_id:
                ManualTradeService._ML_ROUTE_CACHE[model_id] = (True, None, now_ts)
                return True, None

            model_name = db_model.name
            db_version = db.query(ModelVersion).filter(ModelVersion.id == db_model.active_version_id).first()
            if not db_version or not db_version.file_path:
                ManualTradeService._ML_ROUTE_CACHE[model_id] = (True, model_name, now_ts)
                return True, model_name

            file_path = db_version.file_path
            if "scaler_train_" in file_path:
                file_path = file_path.replace("scaler_train_", "model_train_")
            if "pca_train_" in file_path:
                file_path = file_path.replace("pca_train_", "model_train_")

            model_dir_chk = os.path.dirname(file_path)
            if (
                not os.path.exists(file_path)
                or os.path.basename(file_path).lower().startswith(("pca", "scaler"))
            ) and os.path.isdir(model_dir_chk):
                for f in sorted(os.listdir(model_dir_chk)):
                    fl = f.lower()
                    if (
                        f.endswith((".pkl", ".pt", ".zip"))
                        and not fl.startswith(("pca", "scaler", "checkpoint", "replay"))
                        and "scaler" not in fl
                        and "pca" not in fl
                    ):
                        file_path = os.path.join(model_dir_chk, f)
                        if fl.startswith("model"):
                            break

            if db_model.model_type in ["PPO-RL", "SAC-RL", "A2C-RL", "DQN-RL"]:
                file_path = file_path.replace(".pkl", ".zip").replace(".pt", ".zip")

            is_loaded = os.path.exists(file_path)
            dataset_type = None
            indicators = []
            model_features = None

            if is_loaded:
                model_dir = os.path.dirname(file_path)
                candidate_meta_paths = [
                    getattr(db_version, "metadata_path", None),
                    file_path.replace(".zip", ".json").replace(".pkl", ".json").replace(".pt", ".json"),
                    os.path.join(model_dir, "metadata.json"),
                ]
                meta_path = next((p for p in candidate_meta_paths if p and os.path.exists(p)), None)
                if meta_path:
                    try:
                        with open(meta_path, "r") as f:
                            meta = json.load(f)
                        dataset_type = meta.get("dataset_type")
                        indicators = meta.get("indicators", [])
                        model_features = meta.get("features")
                    except Exception:
                        pass

            use_ohlcv = ManualTradeService._should_use_ohlcv_predictor(
                dataset_type=dataset_type,
                indicators=indicators,
                model_features=model_features,
                is_loaded=is_loaded,
            )
            ManualTradeService._ML_ROUTE_CACHE[model_id] = (use_ohlcv, model_name, now_ts)
            return use_ohlcv, model_name
        except Exception:
            return True, model_name
        finally:
            db.close()

    @staticmethod
    async def warmup_ml_filter(symbol: str, ml_model_id: str) -> dict:
        """
        Pre-warms the ML model, scalers, PCA, and live feature cache in RAM
        so that subsequent BUY/SELL clicks execute in <5ms with zero lag.
        """
        if not ml_model_id or not symbol:
            return {"status": "skipped"}
        try:
            use_ohlcv_predictor, _ = await asyncio.to_thread(
                ManualTradeService._inspect_ml_filter_route, str(ml_model_id)
            )
            if use_ohlcv_predictor:
                from app.services import ml_predictor
                await asyncio.to_thread(ml_predictor.warmup_model_and_features, str(ml_model_id), symbol)
                return {"status": "warmed", "model_id": str(ml_model_id), "symbol": symbol}

            from app.strategies.helpers.ml_l2_predictor import MLL2Predictor

            predictor_key = f"{ml_model_id}_{symbol}"
            predictor = ManualTradeService._ML_PREDICTOR_CACHE.get(predictor_key)
            if (
                predictor is None
                or not getattr(predictor, 'is_loaded', False)
                or isinstance(getattr(predictor, 'model', None), dict)
            ):
                predictor = await asyncio.to_thread(MLL2Predictor, str(ml_model_id))
                if getattr(predictor, 'is_loaded', False) and not isinstance(getattr(predictor, 'model', None), dict):
                    ManualTradeService._ML_PREDICTOR_CACHE[predictor_key] = predictor

            dataset_type = getattr(predictor, 'dataset_type', None)
            indicators = getattr(predictor, 'indicators', None) or []
            if dataset_type in ('l2_orderbook', 'hybrid_deep') and getattr(predictor, 'is_loaded', False) and not bool(indicators):
                try:
                    await predictor.start_background_engine(symbol)
                except Exception:
                    pass
            else:
                from app.services import ml_predictor
                await asyncio.to_thread(ml_predictor.warmup_model_and_features, str(ml_model_id), symbol)

            return {"status": "warmed", "model_id": str(ml_model_id), "symbol": symbol}
        except Exception as e:
            logger.debug(f"ManualTrade ML warmup non-fatal warning: {e}")
            return {"status": "warning", "detail": str(e)}

    _ML_PREVIEW_CACHE: Dict[Tuple[str, str], Tuple[float, dict]] = {}

    @staticmethod
    async def get_ml_filter_live_preview(
        symbol: str,
        ml_model_id: str,
        bullish_thresh: float = 0.50,
        bearish_thresh: float = 0.50,
        exchange_id: str = "binance",
    ) -> dict:
        """
        Lightweight Pre-Trade AI Micro-Gauge preview endpoint.
        Reuses RAM-warmed ML models/features + Redis L2 depth (~0-5ms) without blocking order flow.
        """
        if not symbol or not ml_model_id:
            return {"status": "unavailable"}

        cache_k = (str(symbol).strip().upper(), str(ml_model_id))
        now_p = time.time()
        cached_p = ManualTradeService._ML_PREVIEW_CACHE.get(cache_k)
        if cached_p and (now_p - cached_p[0]) < 1.2:
            res_copy = dict(cached_p[1])
            bull_p = float(res_copy.get("bullish_pct") or 50.0) / 100.0
            bear_p = float(res_copy.get("bearish_pct") or 50.0) / 100.0
            res_copy["buy_ready"] = bool(bull_p >= float(bullish_thresh if bullish_thresh is not None else 0.50))
            res_copy["sell_ready"] = bool(bear_p >= float(bearish_thresh if bearish_thresh is not None else 0.50))
            return res_copy

        try:
            l2_bid_share = 0.50
            has_l2 = False
            live_ob = None
            try:
                from app.services.liquidity_wall_navigator import fetch_l2_depth_fast
                live_ob = await fetch_l2_depth_fast(None, symbol, exchange_id_hint=exchange_id, limit=10)
                if live_ob and live_ob.get("bids") and live_ob.get("asks"):
                    b_vol = sum(float(b[1]) for b in live_ob["bids"][:10] if float(b[0]) > 0)
                    a_vol = sum(float(a[1]) for a in live_ob["asks"][:10] if float(a[0]) > 0)
                    if (b_vol + a_vol) > 0:
                        l2_bid_share = b_vol / (b_vol + a_vol)
                        has_l2 = True
            except Exception:
                pass

            use_ohlcv_predictor, routed_name = await asyncio.to_thread(
                ManualTradeService._inspect_ml_filter_route, str(ml_model_id)
            )
            bull_t = float(bullish_thresh if bullish_thresh is not None else 0.50)
            bear_t = float(bearish_thresh if bearish_thresh is not None else 0.50)

            if use_ohlcv_predictor:
                from app.services import ml_predictor

                def _predict_fast():
                    p_db = SessionLocal()
                    try:
                        return ml_predictor.predict(
                            model_id=str(ml_model_id),
                            symbol_override=symbol,
                            db=p_db,
                            fast_mode=True,
                        )
                    finally:
                        p_db.close()

                pred_res = await asyncio.to_thread(_predict_fast)
                sig = str(pred_res.get("signal", "HOLD")).upper()
                conf = float(pred_res.get("confidence", 0.5))
                bull_prob = pred_res.get("bullish_prob")
                bear_prob = pred_res.get("bearish_prob")
                micro = pred_res.get("microstructure") or {}
                flow_bull = float(micro.get("flow_bullish_score", 0.50))
                flow_bear = float(micro.get("flow_bearish_score", 0.50))
                if bull_prob is not None and bear_prob is not None:
                    buy_p = float(bull_prob)
                    sell_p = float(bear_prob)
                    if has_l2 and (buy_p + sell_p) > 0.5:
                        buy_p = min(0.99, max(0.01, 0.85 * buy_p + 0.15 * l2_bid_share))
                        sell_p = min(0.99, max(0.01, 0.85 * sell_p + 0.15 * (1.0 - l2_bid_share)))
                else:
                    buy_p = conf if sig in ("BUY", "PUMP RISK") else (1.0 - conf if sig in ("SELL", "CRASH RISK") else 0.50)
                    sell_p = 1.0 - buy_p

                out_res = {
                    "status": "ok",
                    "symbol": symbol,
                    "model_id": str(ml_model_id),
                    "model_name": routed_name or str(pred_res.get("algorithm", "AI Model")),
                    "signal": sig,
                    "bullish_pct": round(buy_p * 100.0, 1),
                    "bearish_pct": round(sell_p * 100.0, 1),
                    "flow_bull_pct": round(flow_bull * 100.0, 0),
                    "flow_bear_pct": round(flow_bear * 100.0, 0),
                    "l2_bid_pct": round(l2_bid_share * 100.0, 0),
                    "l2_ask_pct": round((1.0 - l2_bid_share) * 100.0, 0),
                    "buy_ready": bool(buy_p >= bull_t),
                    "sell_ready": bool(sell_p >= bear_t),
                    "updated_at": time.time(),
                }
                ManualTradeService._ML_PREVIEW_CACHE[cache_k] = (out_res["updated_at"], out_res)
                return out_res

            # Route B: L2 Predictor cached lookup
            predictor_key = f"{ml_model_id}_{symbol}"
            predictor = ManualTradeService._ML_PREDICTOR_CACHE.get(predictor_key)
            if predictor is None:
                from app.strategies.helpers.ml_l2_predictor import MLL2Predictor
                predictor = await asyncio.to_thread(MLL2Predictor, str(ml_model_id))
                if getattr(predictor, "is_loaded", False) and not isinstance(getattr(predictor, "model", None), dict):
                    ManualTradeService._ML_PREDICTOR_CACHE[predictor_key] = predictor

            raw_score = float(getattr(predictor, "last_prediction_score", 0.5) or 0.5)
            if live_ob and live_ob.get("bids") and live_ob.get("asks") and getattr(predictor, "is_loaded", False):
                try:
                    mid_p = (float(live_ob["bids"][0][0]) + float(live_ob["asks"][0][0])) / 2.0
                    if hasattr(predictor, "update_l2_memory"):
                        predictor.update_l2_memory(live_ob)
                    await predictor.predict(live_ob, mid_p, "buy")
                    raw_score = float(getattr(predictor, "last_prediction_score", raw_score) or raw_score)
                except Exception:
                    pass

            buy_p = min(0.99, max(0.01, raw_score))
            sell_p = min(0.99, max(0.01, 1.0 - buy_p))
            out_res = {
                "status": "ok",
                "symbol": symbol,
                "model_id": str(ml_model_id),
                "model_name": getattr(predictor, "model_name", None) or routed_name or "L2 AI Model",
                "signal": "BUY" if buy_p >= bull_t else ("SELL" if sell_p >= bear_t else "HOLD"),
                "bullish_pct": round(buy_p * 100.0, 1),
                "bearish_pct": round(sell_p * 100.0, 1),
                "flow_bull_pct": round(l2_bid_share * 100.0, 0) if has_l2 else None,
                "flow_bear_pct": round((1.0 - l2_bid_share) * 100.0, 0) if has_l2 else None,
                "l2_bid_pct": round(l2_bid_share * 100.0, 0) if has_l2 else None,
                "l2_ask_pct": round((1.0 - l2_bid_share) * 100.0, 0) if has_l2 else None,
                "buy_ready": bool(buy_p >= bull_t),
                "sell_ready": bool(sell_p >= bear_t),
                "updated_at": time.time(),
            }
            ManualTradeService._ML_PREVIEW_CACHE[cache_k] = (out_res["updated_at"], out_res)
            return out_res
        except Exception as e:
            logger.debug(f"ManualTrade ML preview non-fatal warning: {e}")
            return {"status": "warning", "detail": str(e)}

    @staticmethod
    def _resolve_attached_tp_sl_prices(mid_p: float, is_buy_side: bool, attached_tp=None, attached_sl=None) -> tuple:
        """
        Resolves exact target `tp_price`, `sl_price`, `tp_dist_pct`, and `sl_dist_pct`
        from the user's `attached_tp` and `attached_sl` configs relative to `mid_p`.
        """
        tp_price, sl_price = 0.0, 0.0
        tp_dist_pct, sl_dist_pct = 0.0, 0.0
        if mid_p <= 0:
            return tp_price, sl_price, tp_dist_pct, sl_dist_pct

        try:
            if attached_tp and getattr(attached_tp, 'enabled', False):
                val = float(getattr(attached_tp, 'value', 0.0) or 0.0)
                mode = str(getattr(attached_tp, 'mode', 'percentage') or 'percentage').lower()
                if val > 0:
                    if mode == 'percentage':
                        pct = val / 100.0
                        tp_price = mid_p * (1.0 + pct) if is_buy_side else mid_p * (1.0 - pct)
                    elif mode == 'absolute':
                        tp_price = val
                    else:
                        tp_price = (mid_p + val) if is_buy_side else (mid_p - val)
                    if tp_price > 0:
                        tp_dist_pct = abs(tp_price - mid_p) / mid_p * 100.0
        except Exception:
            pass

        try:
            if attached_sl and getattr(attached_sl, 'enabled', False):
                val = float(getattr(attached_sl, 'value', 0.0) or 0.0)
                mode = str(getattr(attached_sl, 'mode', 'percentage') or 'percentage').lower()
                if val > 0:
                    if mode == 'percentage':
                        pct = val / 100.0
                        sl_price = mid_p * (1.0 - pct) if is_buy_side else mid_p * (1.0 + pct)
                    elif mode == 'absolute':
                        sl_price = val
                    else:
                        sl_price = (mid_p - val) if is_buy_side else (mid_p + val)
                    if sl_price > 0:
                        sl_dist_pct = abs(sl_price - mid_p) / mid_p * 100.0
        except Exception:
            pass

        return tp_price, sl_price, tp_dist_pct, sl_dist_pct

    @staticmethod
    async def _validate_with_ml_filter(
        exchange,
        symbol: str,
        side: str,
        ml_model_id: str,
        bullish_thresh: float = 0.50,
        bearish_thresh: float = 0.50,
        execution_mode: str = "basic",
        eval_price_override: float = None,
        attached_tp=None,
        attached_sl=None
    ) -> dict:
        """
        Universal AI Entry Gatekeeper for Manual Trade & Emergency Force Orders.
        Supports:
          1) L2 Orderbook / Hybrid Deep / RL models via MLL2Predictor
          2) OHLCV / Historical Trades (Tick/Volume Bars) / Technical Indicator / Next-Gen models
             trained in Training Studio via ml_predictor.predict (fast_mode=True, <5ms RAM-cached)
        Evaluates Entry Price + Attached TP/SL + Live Tick Microstructure + Live L2 Orderbook Imbalance.
        """
        if not ml_model_id:
            raise HTTPException(
                status_code=400,
                detail="AI Filter Error: Please select a trained ML Model from Registry or turn off the L2 ML Filter."
            )

        predictor_key = f"{ml_model_id}_{symbol}"
        predictor = ManualTradeService._ML_PREDICTOR_CACHE.get(predictor_key)
        routed_model_name = None

        if (
            predictor is not None
            and getattr(predictor, 'is_loaded', False)
            and not isinstance(getattr(predictor, 'model', None), dict)
        ):
            use_ohlcv_predictor = ManualTradeService._should_use_ohlcv_predictor(
                dataset_type=getattr(predictor, 'dataset_type', None),
                indicators=getattr(predictor, 'indicators', None) or [],
                model_features=getattr(predictor, 'model_features', None) or [],
                is_loaded=True,
            )
        else:
            use_ohlcv_predictor, routed_model_name = await asyncio.to_thread(
                ManualTradeService._inspect_ml_filter_route, str(ml_model_id)
            )
            if not use_ohlcv_predictor:
                from app.strategies.helpers.ml_l2_predictor import MLL2Predictor
                predictor = await asyncio.to_thread(MLL2Predictor, str(ml_model_id))
                if getattr(predictor, 'is_loaded', False) and not isinstance(getattr(predictor, 'model', None), dict):
                    ManualTradeService._ML_PREDICTOR_CACHE[predictor_key] = predictor
                use_ohlcv_predictor = ManualTradeService._should_use_ohlcv_predictor(
                    dataset_type=getattr(predictor, 'dataset_type', None),
                    indicators=getattr(predictor, 'indicators', None) or [],
                    model_features=getattr(predictor, 'model_features', None) or [],
                    is_loaded=bool(getattr(predictor, 'is_loaded', False)),
                )
            else:
                predictor = None

        is_buy_side = str(side or 'buy').strip().lower() in ('buy', 'long')
        exec_mode_lower = str(execution_mode or 'basic').strip().lower()
        bull_t = float(bullish_thresh if bullish_thresh is not None else 0.50)
        bear_t = float(bearish_thresh if bearish_thresh is not None else 0.50)

        mid_p = float(eval_price_override) if (eval_price_override and float(eval_price_override) > 0) else 0.0

        # --- Route A: OHLCV / Tick-Trade / Indicator / Next-Gen Model from Training Studio ---
        if use_ohlcv_predictor:
            from app.services import ml_predictor
            from app.db.session import SessionLocal

            def _run_ohlcv_fast():
                t_db = SessionLocal()
                try:
                    return ml_predictor.predict(
                        model_id=str(ml_model_id),
                        symbol_override=symbol,
                        db=t_db,
                        price_point=mid_p if mid_p > 0 else None,
                        fast_mode=True
                    )
                finally:
                    t_db.close()

            async def _fetch_ob_safe():
                try:
                    return await exchange.fetch_order_book(symbol, limit=20)
                except Exception:
                    return None

            pred_res, live_ob = await asyncio.gather(
                asyncio.to_thread(_run_ohlcv_fast),
                _fetch_ob_safe(),
                return_exceptions=True
            )

            if isinstance(pred_res, Exception):
                logger.error(f"ManualTrade OHLCV ML Filter failed for {symbol}: {pred_res}")
                raise HTTPException(
                    status_code=400,
                    detail=f"AI Filter Error: Model inference failed for {symbol} ({str(pred_res)})."
                )
            if isinstance(live_ob, Exception):
                live_ob = None

            sig = str(pred_res.get("signal", "HOLD")).upper()
            conf = float(pred_res.get("confidence", 0.0))
            bull_prob = pred_res.get("bullish_prob")
            bear_prob = pred_res.get("bearish_prob")
            raw_bull = pred_res.get("raw_bullish_prob")
            raw_bear = pred_res.get("raw_bearish_prob")
            micro = pred_res.get("microstructure") or {}

            if mid_p <= 0:
                if live_ob and live_ob.get('bids') and live_ob.get('asks'):
                    mid_p = (float(live_ob['bids'][0][0]) + float(live_ob['asks'][0][0])) / 2.0
                elif pred_res.get("price"):
                    mid_p = float(pred_res["price"])

            model_label = (
                (getattr(predictor, 'model_name', None) if predictor is not None else routed_model_name)
                or str(pred_res.get("algorithm", "AI Model"))
            )
            ai_sl = pred_res.get("sl")
            ai_tp = pred_res.get("tp")

            # Compute Live L2 Orderbook Imbalance & TP Barrier Wall Metrics
            l2_bid_share = 0.50
            l2_wall_opposing_tp = False
            l2_wall_ratio = 1.0
            user_tp_p, user_sl_p, tp_dist_pct, sl_dist_pct = ManualTradeService._resolve_attached_tp_sl_prices(
                mid_p, is_buy_side, attached_tp, attached_sl
            )

            if live_ob and live_ob.get('bids') and live_ob.get('asks'):
                try:
                    bids_20 = [(float(b[0]), float(b[1])) for b in live_ob['bids'][:20] if float(b[0]) > 0]
                    asks_20 = [(float(a[0]), float(a[1])) for a in live_ob['asks'][:20] if float(a[0]) > 0]
                    bid_vol_10 = sum(q for _, q in bids_20[:10])
                    ask_vol_10 = sum(q for _, q in asks_20[:10])
                    if (bid_vol_10 + ask_vol_10) > 0:
                        l2_bid_share = bid_vol_10 / (bid_vol_10 + ask_vol_10)

                    # Check if a heavy opposing L2 wall blocks the path between Entry (mid_p) and User TP
                    if user_tp_p > 0 and tp_dist_pct <= 0.60:
                        if is_buy_side and user_tp_p > mid_p:
                            blocking_ask_vol = sum(q for p, q in asks_20 if p < user_tp_p)
                            support_bid_vol = max(1e-9, bid_vol_10)
                            l2_wall_ratio = blocking_ask_vol / support_bid_vol
                            if l2_wall_ratio >= 2.6:
                                l2_wall_opposing_tp = True
                        elif (not is_buy_side) and user_tp_p < mid_p:
                            blocking_bid_vol = sum(q for p, q in bids_20 if p > user_tp_p)
                            pressure_ask_vol = max(1e-9, ask_vol_10)
                            l2_wall_ratio = blocking_bid_vol / pressure_ask_vol
                            if l2_wall_ratio >= 2.6:
                                l2_wall_opposing_tp = True
                except Exception:
                    pass

            flow_bull = float(micro.get("flow_bullish_score", 0.50))
            flow_bear = float(micro.get("flow_bearish_score", 0.50))
            bar_vol_pct = max(0.03, float(micro.get("bar_volatility_pct", 0.08)))

            # Blend calibrated model probability (85%) with live L2 Orderbook Depth (15%)
            if bull_prob is not None and bear_prob is not None:
                buy_p = float(bull_prob)
                sell_p = float(bear_prob)
                if live_ob and (buy_p + sell_p) > 0.5:
                    buy_p = float(min(0.99, max(0.01, 0.85 * buy_p + 0.15 * l2_bid_share)))
                    sell_p = float(min(0.99, max(0.01, 0.85 * sell_p + 0.15 * (1.0 - l2_bid_share))))

                # Apply tight-scalp TP/SL counter-flow protection
                scalp_penalty_reason = None
                if is_buy_side:
                    if l2_wall_opposing_tp and flow_bear >= 0.58:
                        buy_p = max(0.01, buy_p - 0.14)
                        sell_p = min(0.99, 1.0 - buy_p)
                        scalp_penalty_reason = f"Heavy Ask Wall ({l2_wall_ratio:.1f}x) blocks TP {user_tp_p:.5f} & Seller Flow {flow_bear*100:.0f}%"
                    elif tp_dist_pct > 0 and tp_dist_pct <= 0.35 and flow_bear >= 0.64 and l2_bid_share <= 0.38:
                        buy_p = max(0.01, buy_p - 0.12)
                        sell_p = min(0.99, 1.0 - buy_p)
                        scalp_penalty_reason = f"Strong Seller Orderflow ({flow_bear*100:.0f}%) & L2 Ask Pressure ({(1-l2_bid_share)*100:.0f}%) oppose {tp_dist_pct:.2f}% BUY scalp"
                else:
                    if l2_wall_opposing_tp and flow_bull >= 0.58:
                        sell_p = max(0.01, sell_p - 0.14)
                        buy_p = min(0.99, 1.0 - sell_p)
                        scalp_penalty_reason = f"Heavy Bid Wall ({l2_wall_ratio:.1f}x) blocks TP {user_tp_p:.5f} & Buyer Flow {flow_bull*100:.0f}%"
                    elif tp_dist_pct > 0 and tp_dist_pct <= 0.35 and flow_bull >= 0.64 and l2_bid_share >= 0.62:
                        sell_p = max(0.01, sell_p - 0.12)
                        buy_p = min(0.99, 1.0 - sell_p)
                        scalp_penalty_reason = f"Strong Buyer Orderflow ({flow_bull*100:.0f}%) & L2 Bid Support ({l2_bid_share*100:.0f}%) oppose {tp_dist_pct:.2f}% SELL scalp"

                # Estimate TP-before-SL hit probability when both TP and SL are attached
                tp_hit_note = ""
                est_tp_hit_val = None
                if tp_dist_pct > 0 and sl_dist_pct > 0:
                    dir_edge = (buy_p - 0.50) if is_buy_side else (sell_p - 0.50)
                    base_rw = sl_dist_pct / (tp_dist_pct + sl_dist_pct)
                    est_tp_hit = min(0.98, max(0.02, base_rw + dir_edge * 0.85))
                    est_tp_hit_val = round(est_tp_hit * 100, 0)
                    tp_hit_note = f" | TP Hit Est: {est_tp_hit*100:.0f}%"
                    # If SL is >= 1.6x larger than TP (negative R:R scalp) AND directional probability is < 52%, block bad R:R drift!
                    if (sl_dist_pct / max(1e-6, tp_dist_pct)) >= 1.6 and ((is_buy_side and buy_p < max(bull_t, 0.52)) or ((not is_buy_side) and sell_p < max(bear_t, 0.52))):
                        if is_buy_side:
                            scalp_penalty_reason = scalp_penalty_reason or f"SL ({sl_dist_pct:.2f}%) is {sl_dist_pct/tp_dist_pct:.1f}x wider than TP ({tp_dist_pct:.2f}%), requiring ≥52% Bullish edge"
                        else:
                            scalp_penalty_reason = scalp_penalty_reason or f"SL ({sl_dist_pct:.2f}%) is {sl_dist_pct/tp_dist_pct:.1f}x wider than TP ({tp_dist_pct:.2f}%), requiring ≥52% Bearish edge"

                if is_buy_side:
                    req_t = max(bull_t, 0.52) if (tp_dist_pct > 0 and sl_dist_pct >= 1.6 * tp_dist_pct and bull_t <= 0.50) else bull_t
                    is_valid = buy_p >= req_t
                    if not is_valid:
                        raw_note = f" (Raw: {float(raw_bull)*100:.1f}%)" if (raw_bull is not None and abs(float(raw_bull) - buy_p) > 0.05) else ""
                        flow_note = f" | Flow Bull: {flow_bull*100:.0f}%, L2 Bid: {l2_bid_share*100:.0f}%"
                        reason_sfx = f" | {scalp_penalty_reason}" if scalp_penalty_reason else ""
                        conf_str = f"Calibrated Bullish: {buy_p * 100:.1f}%{raw_note} < Threshold {req_t * 100:.0f}% [Bearish: {sell_p * 100:.1f}%{flow_note}{tp_hit_note}{reason_sfx}]"
                        logger.info(f"🚫 [ManualTrade AI Filter] Denied BUY on {symbol} by {model_label} ({conf_str})")
                        return {
                            "rejected": True,
                            "rejected_by_ai": True,
                            "status": "rejected_by_ai",
                            "side": "BUY",
                            "symbol": symbol,
                            "model_name": model_label,
                            "direction_label": "Bullish",
                            "calibrated_prob": round(buy_p * 100, 1),
                            "raw_prob": round(float(raw_bull) * 100, 1) if raw_bull is not None else None,
                            "threshold": round(req_t * 100, 0),
                            "opposite_label": "Bearish",
                            "opposite_prob": round(sell_p * 100, 1),
                            "flow_label": "Flow Bull",
                            "flow_pct": round(flow_bull * 100, 0),
                            "l2_label": "L2 Bid",
                            "l2_pct": round(l2_bid_share * 100, 0),
                            "tp_hit_est": est_tp_hit_val,
                            "reason": scalp_penalty_reason or f"Bullish probability ({buy_p*100:.1f}%) is below required {req_t*100:.0f}% threshold",
                            "summary": conf_str,
                            "message": f"🛡️ AI Trade Shield blocked BUY on {symbol} ({conf_str})"
                        }
                    ai_filter_info = f"{model_label} Bullish {buy_p * 100:.1f}% (≥{req_t * 100:.0f}%) | Flow {flow_bull*100:.0f}% | L2 Bid {l2_bid_share*100:.0f}%{tp_hit_note}"
                    conf = buy_p
                else:
                    req_t = max(bear_t, 0.52) if (tp_dist_pct > 0 and sl_dist_pct >= 1.6 * tp_dist_pct and bear_t <= 0.50) else bear_t
                    is_valid = sell_p >= req_t
                    if not is_valid:
                        raw_note = f" (Raw Uncalibrated: {float(raw_bear)*100:.1f}%)" if (raw_bear is not None and abs(float(raw_bear) - sell_p) > 0.05) else ""
                        flow_note = f" | Flow Bear: {flow_bear*100:.0f}%, L2 Ask: {(1.0-l2_bid_share)*100:.0f}%"
                        reason_sfx = f" | {scalp_penalty_reason}" if scalp_penalty_reason else ""
                        conf_str = f"Calibrated Bearish: {sell_p * 100:.1f}%{raw_note} < Threshold {req_t * 100:.0f}% [Bullish: {buy_p * 100:.1f}%{flow_note}{tp_hit_note}{reason_sfx}]"
                        logger.info(f"🚫 [ManualTrade AI Filter] Denied SELL on {symbol} by {model_label} ({conf_str})")
                        return {
                            "rejected": True,
                            "rejected_by_ai": True,
                            "status": "rejected_by_ai",
                            "side": "SELL",
                            "symbol": symbol,
                            "model_name": model_label,
                            "direction_label": "Bearish",
                            "calibrated_prob": round(sell_p * 100, 1),
                            "raw_prob": round(float(raw_bear) * 100, 1) if raw_bear is not None else None,
                            "threshold": round(req_t * 100, 0),
                            "opposite_label": "Bullish",
                            "opposite_prob": round(buy_p * 100, 1),
                            "flow_label": "Flow Bear",
                            "flow_pct": round(flow_bear * 100, 0),
                            "l2_label": "L2 Ask",
                            "l2_pct": round((1.0 - l2_bid_share) * 100, 0),
                            "tp_hit_est": est_tp_hit_val,
                            "reason": scalp_penalty_reason or f"Bearish probability ({sell_p*100:.1f}%) is below required {req_t*100:.0f}% threshold",
                            "summary": conf_str,
                            "message": f"🛡️ AI Trade Shield blocked SELL on {symbol} ({conf_str})"
                        }
                    ai_filter_info = f"{model_label} Bearish {sell_p * 100:.1f}% (≥{req_t * 100:.0f}%) | Flow {flow_bear*100:.0f}% | L2 Ask {(1.0-l2_bid_share)*100:.0f}%{tp_hit_note}"
                    conf = sell_p
            else:
                if is_buy_side:
                    is_valid = sig in ("BUY", "PUMP RISK") and conf >= bull_t
                    if not is_valid:
                        conf_str = f"Signal: {sig} ({conf * 100:.1f}%) | Required BUY ≥ {bull_t * 100:.0f}%"
                        logger.info(f"🚫 [ManualTrade AI Filter] Denied BUY on {symbol} by {model_label} ({conf_str})")
                        return {
                            "rejected": True,
                            "rejected_by_ai": True,
                            "status": "rejected_by_ai",
                            "side": "BUY",
                            "symbol": symbol,
                            "model_name": model_label,
                            "direction_label": "Bullish",
                            "calibrated_prob": round(conf * 100, 1),
                            "raw_prob": None,
                            "threshold": round(bull_t * 100, 0),
                            "opposite_label": "Signal",
                            "opposite_prob": round((1.0 - conf) * 100, 1),
                            "flow_label": "Flow Bull",
                            "flow_pct": round(flow_bull * 100, 0),
                            "l2_label": "L2 Bid",
                            "l2_pct": round(l2_bid_share * 100, 0),
                            "tp_hit_est": None,
                            "reason": f"Model signal is {sig} ({conf*100:.1f}%), requiring BUY ≥ {bull_t*100:.0f}%",
                            "summary": conf_str,
                            "message": f"🛡️ AI Trade Shield blocked BUY on {symbol} ({conf_str})"
                        }
                    ai_filter_info = f"{model_label} BUY {conf * 100:.1f}% (≥{bull_t * 100:.0f}%)"
                else:
                    is_valid = sig in ("SELL", "CRASH RISK") and conf >= bear_t
                    if not is_valid:
                        conf_str = f"Signal: {sig} ({conf * 100:.1f}%) | Required SELL ≥ {bear_t * 100:.0f}%"
                        logger.info(f"🚫 [ManualTrade AI Filter] Denied SELL on {symbol} by {model_label} ({conf_str})")
                        return {
                            "rejected": True,
                            "rejected_by_ai": True,
                            "status": "rejected_by_ai",
                            "side": "SELL",
                            "symbol": symbol,
                            "model_name": model_label,
                            "direction_label": "Bearish",
                            "calibrated_prob": round(conf * 100, 1),
                            "raw_prob": None,
                            "threshold": round(bear_t * 100, 0),
                            "opposite_label": "Signal",
                            "opposite_prob": round((1.0 - conf) * 100, 1),
                            "flow_label": "Flow Bear",
                            "flow_pct": round(flow_bear * 100, 0),
                            "l2_label": "L2 Ask",
                            "l2_pct": round((1.0 - l2_bid_share) * 100, 0),
                            "tp_hit_est": None,
                            "reason": f"Model signal is {sig} ({conf*100:.1f}%), requiring SELL ≥ {bear_t*100:.0f}%",
                            "summary": conf_str,
                            "message": f"🛡️ AI Trade Shield blocked SELL on {symbol} ({conf_str})"
                        }
                    ai_filter_info = f"{model_label} SELL {conf * 100:.1f}% (≥{bear_t * 100:.0f}%)"

            out_sl = float(ai_sl) if (exec_mode_lower == 'advanced' and ai_sl and float(ai_sl) > 0) else None
            out_tp = float(ai_tp) if (exec_mode_lower == 'advanced' and ai_tp and float(ai_tp) > 0) else None
            if exec_mode_lower == 'advanced' and (out_sl is None or out_tp is None) and mid_p > 0:
                try:
                    from app.strategies.helpers.ml_advanced_setup import MLAdvancedSetupGenerator
                    from types import SimpleNamespace
                    gen = MLAdvancedSetupGenerator(SimpleNamespace(indicators={}))
                    setup = gen.generate_setup(mid_p, "long" if is_buy_side else "short", conf)
                    if setup and setup.get("sl_price") and setup.get("tp_price"):
                        out_sl = float(setup["sl_price"])
                        out_tp = float(setup["tp_price"])
                except Exception:
                    pass

            logger.info(f"🤖 ✅ [ManualTrade AI Filter] Permitted {side.upper()} on {symbol} | {ai_filter_info}")
            return {"ai_filter_info": ai_filter_info, "sl_price": out_sl, "tp_price": out_tp}

        # --- Route B: L2 Orderbook / Hybrid Deep / RL Model via MLL2Predictor ---
        ml_ob = None
        try:
            ml_ob = await exchange.fetch_order_book(symbol, limit=20)
            if ml_ob and ml_ob.get('bids') and ml_ob.get('asks'):
                best_bid_p = float(ml_ob['bids'][0][0])
                best_ask_p = float(ml_ob['asks'][0][0])
                if mid_p <= 0:
                    mid_p = (best_bid_p + best_ask_p) / 2.0
        except Exception as ob_err:
            logger.error(f"ManualTrade ML Filter failed to fetch orderbook for {symbol}: {ob_err}")
            raise HTTPException(
                status_code=400,
                detail=f"AI Filter Error: Could not fetch live L2 Orderbook for {symbol}."
            )

        try:
            await predictor.start_background_engine(symbol)
        except Exception as bg_err:
            logger.debug(f"ManualTrade ML background engine start skipped: {bg_err}")

        if not ml_ob or not ml_ob.get('bids') or not ml_ob.get('asks'):
            raise HTTPException(
                status_code=400,
                detail=f"AI Filter Error: Empty L2 Orderbook for {symbol}."
            )

        predictor.bullish_threshold = bull_t
        predictor.bearish_threshold = bear_t

        if hasattr(predictor, 'update_l2_memory'):
            try:
                predictor.update_l2_memory(ml_ob)
            except Exception as mem_err:
                logger.debug(f"ManualTrade ML update_l2_memory warning: {mem_err}")

        out_sl = None
        out_tp = None
        if exec_mode_lower == 'advanced':
            from types import SimpleNamespace
            adv_setup = await predictor.predict_advanced(ml_ob, mid_p, side, SimpleNamespace(indicators={}))
            is_ai_valid = bool(adv_setup and adv_setup.get("is_valid"))
            if is_ai_valid:
                if adv_setup.get("sl_price") and float(adv_setup.get("sl_price")) > 0:
                    out_sl = float(adv_setup["sl_price"])
                if adv_setup.get("tp_price") and float(adv_setup.get("tp_price")) > 0:
                    out_tp = float(adv_setup["tp_price"])
        else:
            is_ai_valid = await predictor.predict(ml_ob, mid_p, side)

        raw_score = float(getattr(predictor, 'last_prediction_score', 0.5))
        model_label = getattr(predictor, 'model_name', None) or getattr(predictor, 'model_type', 'AI Model')
        is_prob_model = (
            predictor.prediction_target in ["classification", "advanced_setup"]
            or predictor.model_type in ["PPO-RL", "SAC-RL", "A2C-RL", "DQN-RL"]
        )

        if not is_ai_valid:
            if is_buy_side:
                if is_prob_model:
                    conf_str = f"Bullish Score: {raw_score * 100:.1f}% < Threshold {predictor.bullish_threshold * 100:.0f}%"
                else:
                    conf_str = f"Predicted: {raw_score:.4f} <= Price: {mid_p:.4f}"
                logger.info(f"🚫 [ManualTrade AI Filter] Denied BUY on {symbol} by {model_label} ({conf_str})")
                return {
                    "rejected": True,
                    "rejected_by_ai": True,
                    "status": "rejected_by_ai",
                    "side": "BUY",
                    "symbol": symbol,
                    "model_name": model_label,
                    "direction_label": "Bullish",
                    "calibrated_prob": round(raw_score * 100, 1) if is_prob_model else 0.0,
                    "raw_prob": None,
                    "threshold": round(predictor.bullish_threshold * 100, 0),
                    "opposite_label": "Bearish",
                    "opposite_prob": round((1.0 - raw_score) * 100, 1) if is_prob_model else 0.0,
                    "flow_label": None,
                    "flow_pct": None,
                    "l2_label": None,
                    "l2_pct": None,
                    "tp_hit_est": None,
                    "reason": f"L2 AI Model predicts unfavorable/bearish condition ({conf_str})",
                    "summary": conf_str,
                    "message": f"🛡️ AI Trade Shield blocked BUY on {symbol} ({conf_str})"
                }
            else:
                bearish_pct = (1.0 - raw_score) * 100
                if is_prob_model:
                    conf_str = f"Bearish Score: {bearish_pct:.1f}% < Threshold {predictor.bearish_threshold * 100:.0f}%"
                else:
                    conf_str = f"Predicted: {raw_score:.4f} >= Price: {mid_p:.4f}"
                logger.info(f"🚫 [ManualTrade AI Filter] Denied SELL on {symbol} by {model_label} ({conf_str})")
                return {
                    "rejected": True,
                    "rejected_by_ai": True,
                    "status": "rejected_by_ai",
                    "side": "SELL",
                    "symbol": symbol,
                    "model_name": model_label,
                    "direction_label": "Bearish",
                    "calibrated_prob": round(bearish_pct, 1) if is_prob_model else 0.0,
                    "raw_prob": None,
                    "threshold": round(predictor.bearish_threshold * 100, 0),
                    "opposite_label": "Bullish",
                    "opposite_prob": round(raw_score * 100, 1) if is_prob_model else 0.0,
                    "flow_label": None,
                    "flow_pct": None,
                    "l2_label": None,
                    "l2_pct": None,
                    "tp_hit_est": None,
                    "reason": f"L2 AI Model predicts unfavorable/bullish condition ({conf_str})",
                    "summary": conf_str,
                    "message": f"🛡️ AI Trade Shield blocked SELL on {symbol} ({conf_str})"
                }
        else:
            if is_buy_side:
                ai_filter_info = (
                    f"{model_label} Bullish {raw_score * 100:.1f}% (≥{predictor.bullish_threshold * 100:.0f}%)"
                    if is_prob_model else f"{model_label} Bullish ({raw_score:.4f})"
                )
            else:
                bearish_pct = (1.0 - raw_score) * 100
                ai_filter_info = (
                    f"{model_label} Bearish {bearish_pct:.1f}% (≥{predictor.bearish_threshold * 100:.0f}%)"
                    if is_prob_model else f"{model_label} Bearish ({raw_score:.4f})"
                )
            if out_sl and out_tp:
                ai_filter_info += f" | Dynamic TP: {out_tp:.5f}, SL: {out_sl:.5f}"
            logger.info(f"🤖 ✅ [ManualTrade AI Filter] Permitted {side.upper()} on {symbol} | {ai_filter_info}")
            return {"ai_filter_info": ai_filter_info, "sl_price": out_sl, "tp_price": out_tp}

    @staticmethod
    async def place_manual_trade(db: Session, user_id: int, order_req, start_time: float = 0.0) -> dict:
        """
        Exchange Connection Pool ব্যবহার করে ultra-fast order execution।
        প্রথম অর্ডারের পরে পরবর্তী সব অর্ডার ~100-200ms এ সম্পন্ন হয়।
        """
        t_req_origin = start_time if start_time > 0 else time.perf_counter()
        t0 = time.perf_counter()

        # নির্দিষ্ট API Key খুঁজে বের করা
        query = db.query(models.ApiKey).filter(
            models.ApiKey.user_id == user_id,
            models.ApiKey.is_enabled == True
        )

        if getattr(order_req, 'api_key_id', None):
            query = query.filter(models.ApiKey.id == order_req.api_key_id)
        else:
            query = query.filter(models.ApiKey.exchange == order_req.exchange_id)

        api_key_record = query.first()

        if not api_key_record:
            raise HTTPException(status_code=404, detail="Applicable active API Key not found.")

        t_db = time.perf_counter()

        is_futures = ':' in order_req.symbol

        try:
            # Pool theke dedicated unthrottled order exchange newa
            exchange = await ManualTradeService._get_exchange(api_key_record, is_futures, purpose="order")
            t_pool = time.perf_counter()
            try:
                ex_id_str = str(getattr(exchange, 'id', '') or '').lower()
                if ex_id_str and isinstance(getattr(exchange, 'urls', None), dict):
                    from app.services.market_data_streamer import market_data_streamer
                    asyncio.create_task(market_data_streamer.start_streaming(ex_id_str, order_req.symbol))
            except Exception:
                pass
            meta = ManualTradeService._get_contract_meta(exchange, order_req.symbol)
            is_inverse = meta['is_inverse']
            contract_size = meta['contract_size']
            if is_inverse:
                schedule_ws_api_prewarm(exchange, is_futures=is_futures, is_inverse=True)

            # Leverage and Margin Mode (Futures)
            params = getattr(order_req, 'params', {}) or {}
            ex_params = {} # arguments passed to create_order

            # --- L2 Machine Learning Filter Gatekeeper ---
            ai_filter_info = None
            enable_ml_filter = bool(getattr(order_req, 'enable_ml_filter', False) or params.get('enableMlFilter', False))
            ml_model_id = getattr(order_req, 'ml_model_id', None) or params.get('mlModelId', None)
            ml_exec_mode = getattr(order_req, 'ml_execution_mode', None) or params.get('mlExecutionMode', 'basic')
            is_reduce_only_check = bool(params.get('reduceOnly', False)) if is_futures else False

            if enable_ml_filter and not is_reduce_only_check:
                bullish_thresh = getattr(order_req, 'ml_bullish_threshold', None)
                if bullish_thresh is None:
                    bullish_thresh = params.get('mlBullishThreshold', 0.50)
                bearish_thresh = getattr(order_req, 'ml_bearish_threshold', None)
                if bearish_thresh is None:
                    bearish_thresh = params.get('mlBearishThreshold', 0.50)

                eval_p = getattr(order_req, 'price', None) if str(getattr(order_req, 'type', '')).lower() == 'limit' else None
                ml_res = await ManualTradeService._validate_with_ml_filter(
                    exchange=exchange,
                    symbol=order_req.symbol,
                    side=order_req.side,
                    ml_model_id=ml_model_id,
                    bullish_thresh=bullish_thresh,
                    bearish_thresh=bearish_thresh,
                    execution_mode=ml_exec_mode,
                    eval_price_override=eval_p,
                    attached_tp=getattr(order_req, 'attached_tp', None),
                    attached_sl=getattr(order_req, 'attached_sl', None)
                )
                if ml_res.get("rejected"):
                    return ml_res
                ai_filter_info = ml_res.get("ai_filter_info")
                if str(ml_exec_mode or 'basic').lower() == 'advanced':
                    if ml_res.get("tp_price") and float(ml_res["tp_price"]) > 0:
                        safe_tp = bracket_order_service._safe_price_to_precision(exchange, order_req.symbol, float(ml_res["tp_price"]))
                        if getattr(order_req, 'attached_tp', None) is not None:
                            order_req.attached_tp.enabled = True
                            order_req.attached_tp.mode = 'absolute'
                            order_req.attached_tp.value = safe_tp
                        else:
                            from app.api.v1.endpoints.trading import AttachedTPConfig
                            order_req.attached_tp = AttachedTPConfig(enabled=True, mode='absolute', value=safe_tp)
                    if ml_res.get("sl_price") and float(ml_res["sl_price"]) > 0:
                        safe_sl = bracket_order_service._safe_price_to_precision(exchange, order_req.symbol, float(ml_res["sl_price"]))
                        if getattr(order_req, 'attached_sl', None) is not None:
                            order_req.attached_sl.enabled = True
                            order_req.attached_sl.mode = 'absolute'
                            order_req.attached_sl.value = safe_sl
                        else:
                            from app.api.v1.endpoints.trading import AttachedSLConfig
                            order_req.attached_sl = AttachedSLConfig(enabled=True, mode='absolute', value=safe_sl)

            if is_futures:
                leverage = params.get('leverage')
                margin_mode = params.get('marginMode')
                reduce_only = params.get('reduceOnly', False)

                api_k = getattr(exchange, 'apiKey', '')
                now_ts = time.time()
                hedge_cache_key = f"{api_k}_{bool(is_inverse)}"
                sym_cache_key = f"{api_k}_{order_req.symbol}"

                # Prepare concurrent pre-flight tasks for any uncached/changed futures settings (1 RTT instead of 3)
                preflight_tasks = []

                cached_hedge_entry = ManualTradeService._HEDGE_MODE_CACHE.get(hedge_cache_key)
                if cached_hedge_entry and now_ts < cached_hedge_entry[1]:
                    is_hedge_mode = cached_hedge_entry[0]
                else:
                    is_hedge_mode = None

                async def _sync_hedge():
                    return await ManualTradeService._is_binance_hedge_mode(exchange, order_req.symbol, is_inverse=is_inverse)

                if is_hedge_mode is None:
                    preflight_tasks.append(('hedge', _sync_hedge()))

                target_mm = ManualTradeService._normalize_margin_mode_str(margin_mode)
                if target_mm:
                    cached_mm, mm_exp = ManualTradeService._MARGIN_MODE_CACHE.get(sym_cache_key, (None, 0))
                    if cached_mm != target_mm or now_ts >= mm_exp:
                        async def _sync_margin_mode():
                            try:
                                await exchange.set_margin_mode(margin_mode, order_req.symbol)
                            except Exception as mm_e:
                                logger.warning(f"Margin mode set skipped (may already be set or unsupported): {mm_e}")
                            ManualTradeService._MARGIN_MODE_CACHE[sym_cache_key] = (target_mm, time.time() + 3600)

                        preflight_tasks.append(('margin_mode', _sync_margin_mode()))

                if leverage:
                    try:
                        lev_int = int(float(leverage))
                    except (ValueError, TypeError):
                        lev_int = leverage
                    cached_lev, exp_ts = ManualTradeService._LEVERAGE_CACHE.get(sym_cache_key, (None, 0))
                    if cached_lev != lev_int or now_ts >= exp_ts:
                        async def _sync_leverage():
                            try:
                                await exchange.set_leverage(leverage, order_req.symbol)
                            except Exception as lev_e:
                                logger.warning(f"Leverage set skipped (may already be set): {lev_e}")
                            ManualTradeService._LEVERAGE_CACHE[sym_cache_key] = (lev_int, time.time() + 3600)

                        preflight_tasks.append(('leverage', _sync_leverage()))

                if preflight_tasks:
                    pf_results = await asyncio.gather(*(t[1] for t in preflight_tasks), return_exceptions=True)
                    for (t_name, _), t_res in zip(preflight_tasks, pf_results):
                        if t_name == 'hedge' and not isinstance(t_res, Exception):
                            is_hedge_mode = bool(t_res)

                if is_hedge_mode:
                    # In Binance Hedge Mode, positionSide MUST be LONG or SHORT.
                    # reduceOnly is NOT supported in Hedge Mode by Binance API.
                    # To close/reduce a LONG position, side is SELL and positionSide is LONG.
                    # To close/reduce a SHORT position, side is BUY and positionSide is SHORT.
                    pos_side = params.get('positionSide')
                    if not pos_side:
                        if order_req.side.lower() == 'buy':
                            pos_side = 'SHORT' if reduce_only else 'LONG'
                        else:
                            pos_side = 'LONG' if reduce_only else 'SHORT'
                    ex_params['positionSide'] = pos_side.upper()
                else:
                    if reduce_only:
                        ex_params['reduceOnly'] = True

            # Prepare Limit Order parameters if needed (Moved before margin check)
            if order_req.type.lower() == 'limit':
                time_in_force = params.get('timeInForce', '')
                if time_in_force.lower() in ('postonly', 'post_only', 'post-only'):
                    ex_params['postOnly'] = True
                    logger.info(f"PostOnly flag set for {order_req.symbol} {order_req.side} limit order")

                if params.get('autoBestLimit'):
                    ex_params['postOnly'] = True
                elif not getattr(order_req, 'price', None) or order_req.price <= 0:
                    raise HTTPException(status_code=400, detail="Price is required for limit orders")

            # --- Amount Conversion for Inverse / COIN-M Contracts ---
            # CCXT expects amount in integer contracts for Binance COIN-M (e.g. DOGE/USD:DOGE)
            req_price = getattr(order_req, 'price', 0)
            if not req_price or req_price <= 0:
                raw_lp = params.get('lastPrice') or params.get('price')
                if raw_lp and float(raw_lp) > 0:
                    req_price = float(raw_lp)
                elif is_inverse:
                    try:
                        from app.services.smart_peg_entry_executor import _fetch_bbo_fast
                        ob_fast = await _fetch_bbo_fast(exchange, order_req.symbol)
                        if ob_fast and ob_fast.get('bids') and ob_fast.get('asks'):
                            req_price = (float(ob_fast['bids'][0][0]) + float(ob_fast['asks'][0][0])) / 2.0
                        if not req_price or req_price <= 0:
                            ticker = await exchange.fetch_ticker(order_req.symbol)
                            req_price = ticker.get('last', 0)
                    except Exception:
                        req_price = 0

            if is_inverse:
                explicit_contracts = params.get('contracts')
                if explicit_contracts and float(explicit_contracts) > 0:
                    order_req.amount = float(explicit_contracts)
                elif req_price and req_price > 0:
                    usd_val = order_req.amount * req_price
                    num_contracts = max(1.0, round(usd_val / contract_size))
                    order_req.amount = float(num_contracts)
                else:
                    order_req.amount = max(1.0, round(order_req.amount))

                order_req.amount = bracket_order_service._safe_amount_to_precision(exchange, order_req.symbol, order_req.amount)

            # --- Pre-flight Margin Check (Zero-Latency Cached with Non-Blocking Refresh on Futures & Smart Peg) ---
            is_smart_peg_req = order_req.type.lower() in ('smart_peg', 'smartpeg')
            bal = ManualTradeService._get_cached_wallet_balance(
                api_key_record.id, is_futures, max_age_seconds=300.0, is_inverse=is_inverse
            )
            if not bal:
                if is_futures or is_smart_peg_req:
                    # Warm balance cache in background so order placement / Smart Peg executes in 1 RTT (~255ms)
                    asyncio.create_task(
                        ManualTradeService._fetch_wallet_balance(exchange, order_req.symbol, meta, api_key_id=api_key_record.id)
                    )
                    bal = {}
                else:
                    try:
                        bal = await ManualTradeService._fetch_wallet_balance(exchange, order_req.symbol, meta, api_key_id=api_key_record.id)
                    except Exception as margin_e:
                        logger.debug(f"Pre-flight margin check fetch skipped: {margin_e}")
                        bal = {}

            if bal:
                try:
                    base_part = meta["base"]
                    quote_part = meta["quote"]

                    if req_price and req_price > 0 and not params.get('reduceOnly'):
                        lev = float(params.get('leverage') or 1)
                        if is_inverse:
                            # On Inverse Futures, margin asset is base_part (DOGE)
                            free_base = float(bal.get(base_part, {}).get('free', 0.0)) or (float(bal.get('free', {}).get(base_part, 0.0)) if isinstance(bal.get('free'), dict) else 0.0)
                            req_notional_usd = order_req.amount * contract_size
                            required_margin_base = (req_notional_usd / req_price) / lev
                            if required_margin_base >= (free_base * 0.99):
                                if required_margin_base <= (free_base * 1.08):
                                    max_cont = max(1.0, (free_base * 0.985 * req_price * lev) // contract_size)
                                    logger.info(f"🛠️ Pre-flight Margin: Auto-adjusting inverse contracts to {max_cont} (Free: {free_base} {base_part})")
                                    order_req.amount = float(max_cont)
                        elif is_futures or order_req.side.lower() == 'buy':
                            free_quote = float(bal.get(quote_part, {}).get('free', 0.0)) or (float(bal.get('free', {}).get(quote_part, 0.0)) if isinstance(bal.get('free'), dict) else 0.0)
                            notional_value = order_req.amount * req_price
                            required_margin = notional_value / lev if is_futures else notional_value
                            buf = 0.985 if is_futures else 0.99
                            if required_margin >= (free_quote * buf):
                                if required_margin <= (free_quote * 1.05):
                                    logger.info(f"🛠️ Pre-flight Margin: Auto-adjusting size (Req: {required_margin}, Free: {free_quote})")
                                    order_req.amount = order_req.amount * (free_quote / required_margin) * buf
                        elif order_req.side.lower() == 'sell' and not is_futures:
                            free_base = float(bal.get(base_part, {}).get('free', 0.0)) or (float(bal.get('free', {}).get(base_part, 0.0)) if isinstance(bal.get('free'), dict) else 0.0)
                            if order_req.amount >= (free_base * 0.99):
                                if order_req.amount <= (free_base * 1.05):
                                    order_req.amount = free_base * 0.999
                except Exception as margin_e:
                    logger.debug(f"Pre-flight margin calculation notice: {margin_e}")

            # --- Refresh Auto-Best-Limit Price right after Margin Check (Live @bookTicker bbo: 1ms fast-path, REST fallback) ---
            if order_req.type.lower() == 'limit' and params.get('autoBestLimit'):
                try:
                    from app.services.smart_peg_entry_executor import _get_market_tick, _fetch_bbo_fast
                    f_bid = 0.0
                    f_ask = 0.0
                    ob_fresh = await _fetch_bbo_fast(exchange, order_req.symbol, max_age_seconds=0.8)
                    if ob_fresh and ob_fresh.get('bids') and ob_fresh.get('asks'):
                        f_bid = float(ob_fresh['bids'][0][0])
                        f_ask = float(ob_fresh['asks'][0][0])

                    if f_bid > 0 and f_ask > 0:
                        f_tick = _get_market_tick(exchange, order_req.symbol, f_bid)
                        if order_req.side.lower() == 'buy':
                            target_p = f_bid if f_bid < f_ask else (f_ask - f_tick)
                        else:
                            target_p = f_ask if f_ask > f_bid else (f_bid + f_tick)
                        order_req.price = bracket_order_service._safe_price_to_precision(exchange, order_req.symbol, target_p)
                        req_price = order_req.price
                    ex_params['postOnly'] = True
                except Exception as fresh_ob_e:
                    logger.debug(f"Fresh BBO refresh notice: {fresh_ob_e}")

            t_preflight = time.perf_counter()

            # Detached-safe snapshot of api_key_record to prevent DetachedInstanceError in background tasks
            from types import SimpleNamespace
            safe_api_key_record = SimpleNamespace(
                id=api_key_record.id,
                exchange=api_key_record.exchange,
                api_key=api_key_record.api_key,
                secret_key=api_key_record.secret_key,
                passphrase=getattr(api_key_record, 'passphrase', None)
            )

            # --- SMART PEG ENTRY (DYNAMIC BBO ORDER BOOK SHADOWING) ---
            if order_req.type.lower() in ('smart_peg', 'smartpeg'):
                from app.services.smart_peg_entry_executor import execute_smart_peg_entry
                clean_sym = str(order_req.symbol).replace('/', '_').replace(':', '_')
                peg_cid = f"peg_{getattr(api_key_record, 'id', user_id)}_{clean_sym}_{int(time.time())}"

                max_dev = 2.0
                if isinstance(order_req.params, dict) and order_req.params.get('maxChaseDeviationPct') is not None:
                    max_dev = float(order_req.params.get('maxChaseDeviationPct'))

                peg_anchor_price = None
                if isinstance(order_req.params, dict) and order_req.params.get('pegAnchorPrice') is not None:
                    try:
                        peg_anchor_price = float(order_req.params.get('pegAnchorPrice'))
                    except (ValueError, TypeError):
                        peg_anchor_price = None
                elif order_req.price and float(order_req.price) > 0:
                    peg_anchor_price = float(order_req.price)

                is_reduce_only = bool(ex_params.get('reduceOnly', False))
                if isinstance(order_req.params, dict) and order_req.params.get('reduceOnly'):
                    is_reduce_only = True

                peg_strategy = 'bbo'
                wall_multiplier = 2.5
                wall_front_run_ticks = 1
                anti_spoof_guard = True
                if isinstance(order_req.params, dict):
                    peg_strategy = str(
                        order_req.params.get('pegStrategy')
                        or order_req.params.get('peg_strategy')
                        or 'bbo'
                    ).lower()
                    if order_req.params.get('wallMultiplier') is not None:
                        wall_multiplier = float(order_req.params.get('wallMultiplier'))
                    elif order_req.params.get('wall_multiplier') is not None:
                        wall_multiplier = float(order_req.params.get('wall_multiplier'))
                    if order_req.params.get('wallFrontRunTicks') is not None:
                        wall_front_run_ticks = int(order_req.params.get('wallFrontRunTicks'))
                    elif order_req.params.get('wall_front_run_ticks') is not None:
                        wall_front_run_ticks = int(order_req.params.get('wall_front_run_ticks'))
                    if order_req.params.get('antiSpoofGuard') is not None:
                        anti_spoof_guard = bool(order_req.params.get('antiSpoofGuard'))
                    elif order_req.params.get('anti_spoof_guard') is not None:
                        anti_spoof_guard = bool(order_req.params.get('anti_spoof_guard'))

                t_origin = start_time if start_time > 0 else t_req_origin
                asyncio.create_task(
                    execute_smart_peg_entry(
                        exchange=exchange,
                        symbol=order_req.symbol,
                        side=order_req.side.lower(),
                        amount=order_req.amount,
                        is_futures=is_futures,
                        user_id=user_id,
                        api_key_record=safe_api_key_record,
                        tp_config=order_req.attached_tp.dict() if (not is_reduce_only and getattr(order_req, 'attached_tp', None) and order_req.attached_tp.enabled) else None,
                        sl_config=order_req.attached_sl.dict() if (not is_reduce_only and getattr(order_req, 'attached_sl', None) and order_req.attached_sl.enabled) else None,
                        max_chase_deviation_pct=max_dev,
                        peg_id=peg_cid,
                        reduce_only=is_reduce_only,
                        start_time=t_origin,
                        leverage=params.get('leverage') if is_futures else None,
                        margin_mode=params.get('marginMode') if is_futures else None,
                        ai_filter_info=ai_filter_info,
                        contract_size=contract_size,
                        is_inverse=is_inverse,
                        anchor_price=peg_anchor_price,
                        preloaded_balance=bal if bal else None,
                        skip_exchange_upgrade=True,
                        peg_strategy=peg_strategy,
                        wall_multiplier=wall_multiplier,
                        wall_front_run_ticks=wall_front_run_ticks,
                        anti_spoof_guard=anti_spoof_guard,
                    )
                )

                ManualTradeService.invalidate_open_orders_cache(api_key_record.id, order_req.symbol)
                anchor_suffix = f" (Anchor: ${peg_anchor_price:,.4f})" if peg_anchor_price else ""
                strat_tag = " [Wall-Aware]" if peg_strategy == 'wall_aware' else (" [Inside-Spread]" if peg_strategy == 'inside_spread' else "")
                return {
                    "id": peg_cid,
                    "symbol": order_req.symbol,
                    "status": "pegging",
                    "side": order_req.side.lower(),
                    "amount": order_req.amount,
                    "type": "smart_peg",
                    "peg_strategy": peg_strategy,
                    "anchor_price": peg_anchor_price,
                    "ai_filter_info": ai_filter_info,
                    "message": f"⚡ Smart Peg Entry{strat_tag} initiated for {order_req.symbol} ({order_req.side.upper()}){anchor_suffix}"
                }

            # Execute Trade (Try WebSocket First, Fallback to REST)
            response = None
            is_ws_success = False

            # --- BINANCE SPOT NATIVE ICEBERG VALIDATION ---
            raw_iceberg = getattr(order_req, 'iceberg_qty', None)
            if not raw_iceberg and isinstance(order_req.params, dict):
                raw_iceberg = order_req.params.get('icebergQty') or order_req.params.get('iceberg_qty')

            valid_iceberg = None
            if raw_iceberg and not is_futures and order_req.type.lower() == 'limit':
                try:
                    f_iceberg = float(raw_iceberg)
                    if 0 < f_iceberg < float(order_req.amount):
                        valid_iceberg = bracket_order_service._safe_amount_to_precision(exchange, order_req.symbol, f_iceberg)
                        logger.info(f"🧊 Native Iceberg detected: visible slice {valid_iceberg} of total {order_req.amount}")
                    else:
                        logger.warning(f"⚠️ Invalid iceberg_qty {f_iceberg} (must be > 0 and < {order_req.amount}). Ignoring.")
                except Exception as ice_err:
                    logger.warning(f"Failed to process iceberg_qty: {ice_err}")

            original_tp = order_req.attached_tp
            original_sl = order_req.attached_sl
            is_native_otoco_used = False
            native_oto_tp_order_id = None
            native_oto_tp_price = None
            execution_mode_label = None

            # --- NATIVE BINANCE OTO/OTOCO + HYBRID SMART CHASE SUPPORT ---
            use_native_otoco = getattr(order_req, 'use_native_tp_sl', False)
            if params.get('autoBestLimit') or ex_params.get('postOnly'):
                # Disable Native OTO/OTOCO for Post-Only / Auto-Best-Limit so that:
                # 1) Strict Post-Only BBO Maker retry loop can guarantee 0% Taker execution
                # 2) Partial fills immediately place Attached TP/SL via BracketOrderService
                use_native_otoco = False

            has_tp_req = bool(order_req.attached_tp and order_req.attached_tp.enabled)
            has_sl_req = bool(order_req.attached_sl and order_req.attached_sl.enabled)
            tp_is_limit = has_tp_req and getattr(order_req.attached_tp, 'order_type', 'Limit').lower() != 'market'
            sl_is_software = has_sl_req and (
                order_req.attached_sl.type in ('trailing', 'smart_chase', 'trailing_chase')
                or order_req.attached_sl.mode == 'atr'
                or getattr(order_req.attached_sl, 'auto_breakeven_enabled', False)
                or str(getattr(order_req.attached_sl, 'anti_wick_mode', 'instant') or 'instant').lower() in ('dwell', 'candle_close')
            )
            native_tp_eligible = tp_is_limit
            native_sl_eligible = has_sl_req and not sl_is_software

            if use_native_otoco and not is_futures and exchange.id == 'binance' and order_req.type.lower() == 'limit' and (
                native_tp_eligible or native_sl_eligible
            ):
                has_tp = native_tp_eligible
                has_sl = native_sl_eligible
                is_hybrid_oto_smart_chase = bool(has_tp and sl_is_software)
                mode_label = (
                    "Hybrid Native OTO (Entry + TP + Iceberg) + Software Smart Chase SL"
                    if is_hybrid_oto_smart_chase
                    else ("Full Native 3-Leg OTOCO" if (has_tp and has_sl) else "Native 2-Leg OTO")
                )
                logger.info(f"⚡ Using Binance {mode_label} for {order_req.symbol}...")
                
                native_symbol = bracket_order_service._resolve_native_futures_symbol(exchange, order_req.symbol, False)

                def _fmt_px(val: float) -> str:
                    try:
                        return str(exchange.price_to_precision(order_req.symbol, val))
                    except Exception:
                        return str(bracket_order_service._safe_price_to_precision(exchange, order_req.symbol, val))

                def _fmt_qty(val: float) -> str:
                    try:
                        return str(exchange.amount_to_precision(order_req.symbol, val))
                    except Exception:
                        return str(bracket_order_service._safe_amount_to_precision(exchange, order_req.symbol, val))
                
                # Calculate absolute prices based on mode and value
                entry_price = order_req.price
                tp_price = 0.0
                sl_price = 0.0
                
                if has_tp:
                    mode = order_req.attached_tp.mode
                    val = order_req.attached_tp.value
                    if mode == 'percentage':
                        pct = val / 100.0
                        tp_price = entry_price * (1 + pct) if order_req.side.lower() == 'buy' else entry_price * (1 - pct)
                    elif mode == 'absolute':
                        tp_price = val
                    else:
                        tp_price = entry_price + val if order_req.side.lower() == 'buy' else entry_price - val
                    if tp_price <= 0:
                        raise HTTPException(status_code=400, detail=f"Invalid Take-Profit price ({tp_price:.6f}): must be > 0.")
                    if order_req.side.lower() == 'buy' and tp_price <= entry_price:
                        raise HTTPException(status_code=400, detail=f"For BUY order, TP price ({tp_price:.6f}) must be above entry price ({entry_price:.6f}).")
                    if order_req.side.lower() == 'sell' and tp_price >= entry_price:
                        raise HTTPException(status_code=400, detail=f"For SELL order, TP price ({tp_price:.6f}) must be below entry price ({entry_price:.6f}).")
                    if _fmt_px(tp_price) == _fmt_px(entry_price):
                        raise HTTPException(status_code=400, detail=f"TP gap ({val}) is smaller than 1 price tick for {order_req.symbol} at {entry_price}.")
                        
                if has_sl:
                    mode = order_req.attached_sl.mode
                    val = order_req.attached_sl.value
                    if mode == 'percentage':
                        pct = val / 100.0
                        sl_price = entry_price * (1 - pct) if order_req.side.lower() == 'buy' else entry_price * (1 + pct)
                    elif mode == 'absolute':
                        sl_price = val
                    else:
                        sl_price = entry_price - val if order_req.side.lower() == 'buy' else entry_price + val
                    if sl_price <= 0:
                        raise HTTPException(status_code=400, detail=f"Invalid Stop-Loss price ({sl_price:.6f}): must be > 0.")
                    if order_req.side.lower() == 'buy' and sl_price >= entry_price:
                        raise HTTPException(status_code=400, detail=f"For BUY order, SL price ({sl_price:.6f}) must be below entry price ({entry_price:.6f}).")
                    if order_req.side.lower() == 'sell' and sl_price <= entry_price:
                        raise HTTPException(status_code=400, detail=f"For SELL order, SL price ({sl_price:.6f}) must be above entry price ({entry_price:.6f}).")
                    if _fmt_px(sl_price) == _fmt_px(entry_price):
                        raise HTTPException(status_code=400, detail=f"SL gap ({val}) is smaller than 1 price tick for {order_req.symbol} at {entry_price}.")
                
                is_post_only = ex_params.get('postOnly', False)
                payload = {
                    "symbol": native_symbol,
                    "workingType": "LIMIT_MAKER" if is_post_only else "LIMIT",
                    "workingSide": order_req.side.upper(),
                    "workingPrice": _fmt_px(order_req.price),
                    "workingQuantity": _fmt_qty(order_req.amount),
                    "pendingSide": "SELL" if order_req.side.lower() == "buy" else "BUY",
                    "pendingQuantity": _fmt_qty(order_req.amount),
                }
                
                if not is_post_only:
                    payload["workingTimeInForce"] = "GTC"
                
                iceberg_str = _fmt_qty(valid_iceberg) if valid_iceberg is not None else None
                if iceberg_str is not None:
                    payload["workingIcebergQty"] = iceberg_str
                    logger.info(
                        f"🧊 Attaching Iceberg visible slice={iceberg_str} "
                        f"(qty={payload['workingQuantity']}) to working & pending legs of {mode_label}"
                    )
                
                t_order_start = time.perf_counter()
                try:
                    if has_tp and has_sl:
                        if order_req.side.lower() == 'buy':
                            payload['pendingAboveType'] = 'LIMIT_MAKER'
                            payload['pendingAbovePrice'] = _fmt_px(tp_price)
                            payload['pendingBelowType'] = 'STOP_LOSS_LIMIT'
                            payload['pendingBelowTimeInForce'] = 'GTC'
                            payload['pendingBelowStopPrice'] = _fmt_px(sl_price)
                            payload['pendingBelowPrice'] = _fmt_px(sl_price * 0.999)
                        else:
                            payload['pendingAboveType'] = 'STOP_LOSS_LIMIT'
                            payload['pendingAboveTimeInForce'] = 'GTC'
                            payload['pendingAboveStopPrice'] = _fmt_px(sl_price)
                            payload['pendingAbovePrice'] = _fmt_px(sl_price * 1.001)
                            payload['pendingBelowType'] = 'LIMIT_MAKER'
                            payload['pendingBelowPrice'] = _fmt_px(tp_price)
                        if iceberg_str is not None:
                            # Apply Iceberg slice to both pending OCO legs (LIMIT_MAKER TP & GTC STOP_LOSS_LIMIT SL)
                            payload['pendingAboveIcebergQty'] = iceberg_str
                            payload['pendingBelowIcebergQty'] = iceberg_str
                        raw_res = await exchange.private_post_orderlist_otoco(payload)
                    else: # OTO (2-Leg: Entry + TP, or Entry + Fixed SL)
                        if order_req.side.lower() == 'buy':
                            if has_tp:
                                payload['pendingType'] = 'LIMIT_MAKER'
                                payload['pendingPrice'] = _fmt_px(tp_price)
                            elif has_sl:
                                payload['pendingType'] = 'STOP_LOSS_LIMIT'
                                payload['pendingTimeInForce'] = 'GTC'
                                payload['pendingStopPrice'] = _fmt_px(sl_price)
                                payload['pendingPrice'] = _fmt_px(sl_price * 0.999)
                        else:
                            if has_tp:
                                payload['pendingType'] = 'LIMIT_MAKER'
                                payload['pendingPrice'] = _fmt_px(tp_price)
                            elif has_sl:
                                payload['pendingType'] = 'STOP_LOSS_LIMIT'
                                payload['pendingTimeInForce'] = 'GTC'
                                payload['pendingStopPrice'] = _fmt_px(sl_price)
                                payload['pendingPrice'] = _fmt_px(sl_price * 1.001)
                        if iceberg_str is not None:
                            # Apply Iceberg slice to pending leg (LIMIT_MAKER TP or GTC STOP_LOSS_LIMIT SL)
                            payload['pendingIcebergQty'] = iceberg_str
                        raw_res = await exchange.private_post_orderlist_oto(payload)

                    order_list = raw_res.get('orderReports', [])
                    working_order = next(
                        (
                            o for o in order_list
                            if str(o.get('side', '')).upper() == order_req.side.upper()
                            and str(o.get('status', '')).upper() != 'PENDING_NEW'
                        ),
                        None
                    )
                    if not working_order:
                        working_order = next((o for o in order_list if o.get('type') in ('LIMIT', 'LIMIT_MAKER')), None)
                    if not working_order and len(order_list) > 0:
                        working_order = order_list[0]

                    for rep in order_list:
                        if rep is not working_order and str(rep.get('type', '')).upper() in ('LIMIT', 'LIMIT_MAKER') and rep.get('orderId'):
                            tp_oid_str = str(rep.get('orderId'))
                            bracket_order_service.KNOWN_TP_ORDER_IDS.add(tp_oid_str)
                            native_oto_tp_order_id = tp_oid_str
                            native_oto_tp_price = float(bracket_order_service._safe_price_to_precision(exchange, order_req.symbol, tp_price)) if tp_price > 0 else None
                    
                    response = {
                        'id': str(working_order.get('orderId')) if working_order else str(raw_res.get('orderListId', 'otoco')),
                        'symbol': order_req.symbol,
                        'type': 'limit',
                        'side': order_req.side.lower(),
                        'price': order_req.price,
                        'amount': order_req.amount,
                        'status': 'open',
                        'info': raw_res
                    }
                    is_ws_success = True
                    execution_mode_label = mode_label
                    
                    if is_hybrid_oto_smart_chase:
                        # Hybrid Mode: Entry + TP are placed natively on Binance via OTO (+ Iceberg),
                        # while Smart Chase SL is monitored in software by BracketOrderService linked to native_oto_tp_order_id!
                        order_req.attached_tp = None
                        is_native_otoco_used = False
                        logger.info(
                            f"✅ Hybrid Native Binance OTO placed (Working Entry #{response['id']}, "
                            f"Pending Native TP #{native_oto_tp_order_id} @ {native_oto_tp_price}). "
                            f"Arming Software Smart Chase SL..."
                        )
                    else:
                        # Full Native OTO/OTOCO: All enabled legs are on Binance's matching engine
                        order_req.attached_tp = None
                        order_req.attached_sl = None
                        is_native_otoco_used = True
                        logger.info(f"✅ {mode_label} placed successfully (Working Entry #{response['id']}).")

                        # Spawn dedicated monitor for Binance Native OTO/OTOCO to dispatch Telegram completion alerts
                        if user_id:
                            asyncio.create_task(
                                bracket_order_service.monitor_native_otoco(
                                    exchange=exchange,
                                    symbol=order_req.symbol,
                                    side=order_req.side,
                                    amount=order_req.amount,
                                    entry_price=order_req.price,
                                    raw_res=raw_res,
                                    user_id=user_id,
                                    api_key_id=api_key_record.id,
                                )
                            )
                except Exception as e:
                    logger.error(f"Native OTO/OTOCO failed: {e}")
                    raise HTTPException(status_code=400, detail=f"Native TP/SL Failed: {str(e)}")
            # ----------------------------------------

            # If not executed via OTOCO and iceberg is requested for spot limit order
            if not is_ws_success and valid_iceberg is not None:
                ex_params['icebergAmount'] = valid_iceberg
                ex_params['icebergQty'] = str(bracket_order_service._safe_amount_to_precision(exchange, order_req.symbol, valid_iceberg))
                if 'timeInForce' not in ex_params and not ex_params.get('postOnly'):
                    ex_params['timeInForce'] = 'GTC'
                logger.info(f"🧊 Configured icebergQty={ex_params['icebergQty']} on Spot limit order")

            if not is_ws_success:
                t_order_start = time.perf_counter()
                if (
                    exchange.has.get('createOrderWs')
                    and not ex_params.get('icebergQty')
                    and is_ws_api_ready(exchange, is_futures=is_futures, is_inverse=is_inverse)
                ):
                    try:
                        logger.info(f"⚡ Attempting WebSocket order execution for {order_req.symbol}...")
                        order_type = order_req.type.lower()
                        price = order_req.price if order_type == 'limit' else None
                        ws_type, ws_params = ManualTradeService._sanitize_ws_order_args(
                            exchange, order_type, ex_params, is_futures, is_edit=False
                        )
                        response = await exchange.create_order_ws(
                            order_req.symbol, ws_type, order_req.side, order_req.amount, price, ws_params
                        )
                        if (
                            ex_params.get('postOnly')
                            and response
                            and str(response.get('status', '')).lower() in ('expired', 'rejected', 'canceled', 'cancelled')
                        ):
                            raise Exception(f"Post-Only GTX returned status='{response.get('status')}'")
                        is_ws_success = True
                        logger.info("✅ WebSocket Order execution successful!")
                    except Exception as ws_e:
                        ws_err_s = str(ws_e).lower()
                        is_ws_po_cross = (
                            'immediately match' in ws_err_s
                            or '-5022' in ws_err_s
                            or 'post only' in ws_err_s
                            or 'postonly' in ws_err_s
                            or 'post-only' in ws_err_s
                            or 'gtx' in ws_err_s
                            or 'expired' in ws_err_s
                        )
                        if ex_params.get('postOnly') and is_ws_po_cross:
                            if not params.get('autoBestLimit'):
                                raise HTTPException(
                                    status_code=400,
                                    detail="Exchange Error: Post-Only order would immediately match and take liquidity. Try again or use Smart Peg Entry."
                                )
                            # Re-peg price from live @bookTicker / orderbook before REST fallback so retry never repeats stale price
                            try:
                                from app.services.smart_peg_entry_executor import _get_market_tick, _fetch_bbo_fast
                                ob_re = await _fetch_bbo_fast(exchange, order_req.symbol, max_age_seconds=0.3)
                                if ob_re and ob_re.get('bids') and ob_re.get('asks'):
                                    rb = float(ob_re['bids'][0][0])
                                    ra = float(ob_re['asks'][0][0])
                                    rt = _get_market_tick(exchange, order_req.symbol, rb)
                                    prev_px = float(order_req.price or 0)
                                    cp = (rb if rb < ra else (ra - rt)) if order_req.side.lower() == 'buy' else (ra if ra > rb else (rb + rt))
                                    if order_req.side.lower() == 'buy' and prev_px > 0 and cp >= prev_px:
                                        cp = min(cp, prev_px - rt)
                                    elif order_req.side.lower() == 'sell' and prev_px > 0 and cp <= prev_px:
                                        cp = max(cp, prev_px + rt)
                                    order_req.price = bracket_order_service._safe_price_to_precision(exchange, order_req.symbol, cp)
                                    req_price = order_req.price
                            except Exception:
                                pass
                        logger.warning(f"⚠️ WebSocket Order Failed ({ws_e}). Falling back to REST API.")

            if not is_ws_success:
                t_order_start = time.perf_counter()
                logger.info(f"🌐 Using REST API order execution for {order_req.symbol}...")
                if order_req.type.lower() == 'market':
                    try:
                        response = await exchange.create_market_order(
                            order_req.symbol, order_req.side, order_req.amount, params=ex_params
                        )
                    except Exception as mkt_e:
                        err_s = str(mkt_e).lower()
                        is_insufficient = any(
                            kw in err_s for kw in ('-2010', '-2019', 'insufficient balance', 'margin is insufficient', 'insufficient margin')
                        ) and ('immediately match' not in err_s)
                        if is_insufficient:
                            try:
                                if is_futures:
                                    lev_f = float(params.get('leverage') or 1.0)
                                    fresh_bal = await ManualTradeService._fetch_wallet_balance(exchange, order_req.symbol, meta, api_key_id=api_key_record.id)
                                    m_asset = meta["base"] if is_inverse else meta["quote"]
                                    free_m = float(fresh_bal.get(m_asset, {}).get('free', 0.0)) or 0.0
                                    if is_inverse and free_m > 0 and req_price and req_price > 0:
                                        cap_amt = max(1.0, (free_m * 0.98 * req_price * lev_f) // contract_size)
                                    elif free_m > 0 and req_price and req_price > 0:
                                        cap_amt = (free_m * lev_f * 0.98) / req_price
                                    else:
                                        cap_amt = float(order_req.amount) * 0.975
                                    adj_amt = bracket_order_service._safe_amount_to_precision(exchange, order_req.symbol, min(float(order_req.amount) * 0.98, cap_amt))
                                    if 0 < float(adj_amt) < float(order_req.amount):
                                        order_req.amount = float(adj_amt)
                                        response = await exchange.create_market_order(
                                            order_req.symbol, order_req.side, order_req.amount, params=ex_params
                                        )
                                else:
                                    fresh_bal = await ManualTradeService._fetch_wallet_balance(exchange, order_req.symbol, meta, api_key_id=api_key_record.id)
                                    base_part = meta["base"]
                                    quote_part = meta["quote"]
                                    if order_req.side.lower() == 'buy':
                                        free_q = float(fresh_bal.get(quote_part, {}).get('free', 0.0)) or 0.0
                                        if free_q > 0 and req_price and req_price > 0:
                                            adj_amt = bracket_order_service._safe_amount_to_precision(exchange, order_req.symbol, (free_q / req_price) * 0.99)
                                            if float(adj_amt) < float(order_req.amount):
                                                order_req.amount = float(adj_amt)
                                                response = await exchange.create_market_order(
                                                    order_req.symbol, order_req.side, order_req.amount, params=ex_params
                                                )
                                    elif order_req.side.lower() == 'sell':
                                        free_b = float(fresh_bal.get(base_part, {}).get('free', 0.0)) or 0.0
                                        if free_b > 0:
                                            adj_amt = bracket_order_service._safe_amount_to_precision(exchange, order_req.symbol, free_b * 0.999)
                                            if float(adj_amt) < float(order_req.amount):
                                                order_req.amount = float(adj_amt)
                                                response = await exchange.create_market_order(
                                                    order_req.symbol, order_req.side, order_req.amount, params=ex_params
                                                )
                            except Exception:
                                pass
                        if not response:
                            raise mkt_e
                elif order_req.type.lower() == 'limit':
                    max_po_attempts = 4 if (params.get('autoBestLimit') and ex_params.get('postOnly')) else 1
                    for po_attempt in range(1, max_po_attempts + 1):
                        try:
                            response = await exchange.create_limit_order(
                                order_req.symbol, order_req.side, order_req.amount, order_req.price, ex_params
                            )
                            if (
                                ex_params.get('postOnly')
                                and response
                                and str(response.get('status', '')).lower() in ('expired', 'rejected', 'canceled', 'cancelled')
                            ):
                                raise Exception(f"Post-Only GTX returned status='{response.get('status')}'")
                            break
                        except Exception as lim_e:
                            err_s = str(lim_e).lower()
                            # Safe auto-clamp retry on insufficient balance/margin (e.g. 100% slider micro-deviations)
                            is_insufficient = any(
                                kw in err_s for kw in ('-2010', '-2019', 'insufficient balance', 'margin is insufficient', 'insufficient margin')
                            ) and ('immediately match' not in err_s)
                            if is_insufficient:
                                try:
                                    fresh_bal = await ManualTradeService._fetch_wallet_balance(exchange, order_req.symbol, meta, api_key_id=api_key_record.id)
                                    base_part = meta["base"]
                                    quote_part = meta["quote"]
                                    clamped = False
                                    if is_futures:
                                        lev_f = float(params.get('leverage') or 1.0)
                                        m_asset = base_part if is_inverse else quote_part
                                        free_m = float(fresh_bal.get(m_asset, {}).get('free', 0.0)) or 0.0
                                        lim_px = float(order_req.price or req_price or 0.0)
                                        if is_inverse and free_m > 0 and lim_px > 0:
                                            cap_amt = max(1.0, (free_m * 0.98 * lim_px * lev_f) // contract_size)
                                        elif free_m > 0 and lim_px > 0:
                                            cap_amt = (free_m * lev_f * 0.98) / lim_px
                                        else:
                                            cap_amt = float(order_req.amount) * 0.975
                                        adj_amt = bracket_order_service._safe_amount_to_precision(exchange, order_req.symbol, min(float(order_req.amount) * 0.98, cap_amt))
                                        if 0 < float(adj_amt) < float(order_req.amount):
                                            order_req.amount = float(adj_amt)
                                            clamped = True
                                    elif order_req.side.lower() == 'buy':
                                        free_q = float(fresh_bal.get(quote_part, {}).get('free', 0.0)) or 0.0
                                        if free_q > 0 and float(order_req.price) > 0:
                                            adj_amt = bracket_order_service._safe_amount_to_precision(exchange, order_req.symbol, (free_q / float(order_req.price)) * 0.99)
                                            if float(adj_amt) < float(order_req.amount):
                                                order_req.amount = float(adj_amt)
                                                clamped = True
                                    elif order_req.side.lower() == 'sell':
                                        free_b = float(fresh_bal.get(base_part, {}).get('free', 0.0)) or 0.0
                                        if free_b > 0:
                                            adj_amt = bracket_order_service._safe_amount_to_precision(exchange, order_req.symbol, free_b * 0.999)
                                            if float(adj_amt) < float(order_req.amount):
                                                order_req.amount = float(adj_amt)
                                                clamped = True
                                    if clamped:
                                        logger.info(f"🔄 Retrying limit order with clamped size: {order_req.amount}")
                                        response = await exchange.create_limit_order(
                                            order_req.symbol, order_req.side, order_req.amount, order_req.price, ex_params
                                        )
                                        break
                                except Exception as retry_e:
                                    logger.debug(f"Clamp retry error: {retry_e}")

                            is_po_cross = (
                                'immediately match' in err_s
                                or '-5022' in err_s
                                or 'post only' in err_s
                                or 'postonly' in err_s
                                or 'post-only' in err_s
                                or 'gtx' in err_s
                                or 'expired' in err_s
                            )
                            if params.get('autoBestLimit') and ex_params.get('postOnly') and is_po_cross and po_attempt < max_po_attempts:
                                try:
                                    from app.services.smart_peg_entry_executor import _get_market_tick, _fetch_bbo_fast
                                    # Use ultra-fresh Redis @bookTicker on attempt 1 (fallback to direct REST if >=250ms old)
                                    ob_retry = await _fetch_bbo_fast(exchange, order_req.symbol, max_age_seconds=0.25)
                                    if ob_retry and ob_retry.get('bids') and ob_retry.get('asks'):
                                        r_bid = float(ob_retry['bids'][0][0])
                                        r_ask = float(ob_retry['asks'][0][0])
                                        r_tick = _get_market_tick(exchange, order_req.symbol, r_bid)
                                        prev_p = float(order_req.price)
                                        if order_req.side.lower() == 'buy':
                                            cand_p = r_bid if r_bid < r_ask else (r_ask - r_tick)
                                            if cand_p >= prev_p:
                                                cand_p = min(cand_p, prev_p - r_tick)
                                        else:
                                            cand_p = r_ask if r_ask > r_bid else (r_bid + r_tick)
                                            if cand_p <= prev_p:
                                                cand_p = max(cand_p, prev_p + r_tick)
                                        order_req.price = bracket_order_service._safe_price_to_precision(exchange, order_req.symbol, cand_p)
                                        req_price = order_req.price
                                        logger.warning(
                                            f"⚠️ AutoBestLimit Post-Only crossed spread on attempt {po_attempt}/{max_po_attempts} ({lim_e}). "
                                            f"Re-pegged strictly as Maker at {order_req.price} (Bid={r_bid}, Ask={r_ask})..."
                                        )
                                        continue
                                except Exception as re_ob_e:
                                    logger.debug(f"AutoBestLimit BBO retry fetch failed: {re_ob_e}")
                            if ex_params.get('postOnly') and is_po_cross:
                                raise HTTPException(
                                    status_code=400,
                                    detail="Exchange Error: Post-Only order would immediately match and take liquidity. Try again or use Smart Peg Entry."
                                )
                            raise lim_e
                else:
                    raise HTTPException(status_code=400, detail="Invalid order type. Use 'market' or 'limit'.")

            t_order_end = time.perf_counter()

            # Calculate Latency (using backend perf_counter to eliminate PC-Server clock drift)
            t_origin = start_time if start_time > 0 else t_req_origin
            latency_ms = int((t_order_end - t_origin) * 1000)
            db_ms = int((t_db - t0) * 1000)
            pool_ms = int((t_pool - t_db) * 1000)
            preflight_ms = int((t_preflight - t_pool) * 1000)
            order_api_ms = int((t_order_end - t_order_start) * 1000)

            logger.info(
                f"⚡ [EXEC TIMING] Total={latency_ms}ms | "
                f"DB={db_ms}ms | Pool={pool_ms}ms | Preflight={preflight_ms}ms | BinanceAPI={order_api_ms}ms"
            )
            latency_msg = f"⏱ Execution Speed: {latency_ms} ms ⚡\n"
            
            # Send Rich Session-Safe Telegram Notification
            try:
                exec_price = 0.0
                if response:
                    exec_price = float(response.get('price') or response.get('average') or 0.0)
                if not exec_price:
                    exec_price = float(getattr(order_req, 'price', 0.0) or req_price or 0.0)

                asyncio.create_task(
                    _send_trade_fired_notification(
                        user_id=user_id,
                        exchange_name=api_key_record.exchange,
                        symbol=order_req.symbol,
                        side=order_req.side,
                        order_type=order_req.type,
                        amount=order_req.amount,
                        fill_price=exec_price,
                        latency_ms=latency_ms,
                        attached_tp=original_tp,
                        attached_sl=original_sl,
                        leverage=params.get('leverage') if is_futures else None,
                        margin_mode=params.get('marginMode') if is_futures else None,
                        is_futures=is_futures,
                        contract_size=contract_size,
                        is_inverse=is_inverse,
                        ai_filter_info=ai_filter_info,
                        iceberg_qty=valid_iceberg,
                        execution_mode_label=execution_mode_label
                    )
                )
            except Exception as notify_err:
                logger.warning(f"Failed to trigger telegram notification: {notify_err}")

            try:
                from app.services.user_order_stream import ensure_user_order_stream
                ensure_user_order_stream(user_id, api_key_record, is_futures, order_req.symbol)
            except Exception:
                pass

            # [Bracket Order Link] — spawned as a background asyncio task, non-blocking
            # Also monitors plain limit orders to ensure entry fill alert is delivered to Telegram
            has_tp = (getattr(order_req.attached_tp, 'enabled', False) if order_req.attached_tp else False)
            has_sl = (getattr(order_req.attached_sl, 'enabled', False) if order_req.attached_sl else False)
            is_limit_order = order_req.type.lower() == 'limit'

            resp_status = str(response.get('status') or '').lower() if isinstance(response, dict) else ''
            resp_filled = float(response.get('filled') or 0.0) if isinstance(response, dict) else 0.0
            is_immediately_filled = (
                order_req.type.lower() == 'market'
                or resp_status in ('closed', 'filled')
            )
            init_filled_amt = (
                (resp_filled if resp_filled > 0 else float(order_req.amount or 0.0))
                if is_immediately_filled else 0.0
            )
            initial_price = (
                (response.get('average') or response.get('price') or getattr(order_req, 'price', 0.0) or req_price or 0.0)
                if isinstance(response, dict) else (getattr(order_req, 'price', 0.0) or req_price or 0.0)
            )

            if not is_native_otoco_used and (has_tp or has_sl or is_limit_order):
                asyncio.create_task(
                    bracket_order_service.monitor_and_execute_bracket(
                        api_key_record=safe_api_key_record,
                        entry_order_id=response.get('id'),
                        symbol=order_req.symbol,
                        side=order_req.side,
                        amount=order_req.amount,
                        is_futures=is_futures,
                        tp_config=order_req.attached_tp.dict() if has_tp else None,
                        sl_config=order_req.attached_sl.dict() if has_sl else None,
                        initial_entry_price=float(initial_price) if initial_price else 0.0,
                        user_id=user_id,
                        linked_tp_order_id=native_oto_tp_order_id,
                        linked_tp_price=native_oto_tp_price,
                        initial_filled_amount=init_filled_amt,
                        initial_filled_price=float(initial_price) if initial_price else 0.0,
                    )
                )

            ManualTradeService.invalidate_open_orders_cache(api_key_record.id, order_req.symbol)

            if response and response.get('id'):
                oid_placed = str(response.get('id'))
                order_line_px = float(response.get('price') or response.get('average') or req_price or 0.0)
                order_meta = {
                    'id': oid_placed,
                    'side': str(order_req.side or '').lower(),
                    'price': order_line_px,
                    'amount': float(order_req.amount or 0.0),
                    'filled': resp_filled,
                    'remaining': max(0.0, float(order_req.amount or 0.0) - resp_filled),
                    'isSoftwareSL': False,
                    'mode': 'LIMIT',
                    'isPostOnly': bool(ex_params.get('postOnly')),
                    'isIceberg': valid_iceberg is not None and float(valid_iceberg) > 0,
                    'icebergQty': float(valid_iceberg) if (valid_iceberg is not None and float(valid_iceberg) > 0) else None,
                }
                ManualTradeService._ORDER_META_CACHE[(int(api_key_record.id), oid_placed)] = (order_meta, time.time())
                if not is_immediately_filled and order_line_px > 0 and user_id:
                    try:
                        from app.services.user_order_stream import publish_order_sync_event
                        asyncio.create_task(
                            publish_order_sync_event(
                                user_id=user_id,
                                event="order_added",
                                api_key_id=api_key_record.id,
                                symbol=order_req.symbol,
                                order_id=oid_placed,
                                status="open",
                                order=order_meta,
                            )
                        )
                    except Exception:
                        pass
            return {
                "id": response.get('id'),
                "symbol": response.get('symbol'),
                "status": response.get('status', 'open'),
                "side": response.get('side'),
                "amount": response.get('amount'),
                "price": response.get('price') or response.get('average') or req_price,
                "ai_filter_info": ai_filter_info,
                "message": "Order placed successfully"
            }

        except HTTPException:
            raise
        except Exception as e:
            err_str = str(e)
            await _maybe_emit_api_health_alert(user_id, api_key_record.exchange, e)
            await _emit_manual_trade_in_app(
                user_id=user_id,
                title=f"Order Failed: {getattr(order_req, 'symbol', '')}",
                message=(
                    f"Side: {str(getattr(order_req, 'side', '')).upper()} | Type: {str(getattr(order_req, 'type', '')).upper()}\n"
                    f"Reason: {err_str}"
                ),
                event_type="order_failed",
                severity="critical",
                meta={"symbol": getattr(order_req, "symbol", None), "side": getattr(order_req, "side", None)},
            )
            is_exchange_rejection = (
                isinstance(e, getattr(ccxt, 'BaseError', Exception)) or
                any(kw in err_str.lower() for kw in [
                    'immediately match', 'post-only', 'postonly', 'maker', '-5022',
                    'insufficient balance', 'insufficient margin', '-2010', 'account has insufficient',
                    'min_notional', 'filter failure', 'notional', '-1013',
                    'precision', 'lot_size', 'price filter', 'reduceonly',
                    'order does not exist', 'unknown order', 'exchange error'
                ])
            )
            if is_exchange_rejection:
                logger.warning(f"⚠️ Manual order rejected by exchange ({order_req.symbol}): {err_str}")
                raise HTTPException(status_code=400, detail=f"Exchange Error: {err_str}")
            
            import traceback
            logger.error(f"Internal order placement failure: {e}\n{traceback.format_exc()}")
            raise HTTPException(status_code=500, detail=f"Internal Server Error: {err_str}")

    @staticmethod
    async def edit_manual_trade(db: Session, user_id: int, api_key_id: int, order_id: str, symbol: str, side: str, amount: float, new_price: float) -> dict:
        """
        High-performance order modification for Manual Trading & Chart Drag & Drop.
        Leverages pre-warmed exchange connection pool and native single-roundtrip
        cancelReplace / edit_order APIs on Binance Spot & Futures to achieve ~200-350ms execution.
        """
        t0 = time.perf_counter()

        api_key_record = db.query(models.ApiKey).filter(
            models.ApiKey.id == api_key_id,
            models.ApiKey.user_id == user_id,
            models.ApiKey.is_enabled == True
        ).first()

        if not api_key_record:
            raise HTTPException(status_code=404, detail="API Key not found or inactive")

        is_futures = ':' in symbol

        try:
            # 1. Use unthrottled dedicated order connection pool instance
            exchange = await ManualTradeService._get_exchange(api_key_record, is_futures, purpose="order")
            meta = ManualTradeService._get_contract_meta(exchange, symbol)
            is_inverse = bool(meta.get('is_inverse'))
            if is_inverse:
                schedule_ws_api_prewarm(exchange, is_futures=is_futures, is_inverse=True)
            oid_str = str(order_id)

            # 2. Fast Parameter Lookup from RAM Cache (0ms) instead of slow fetch_order network round-trip (~230ms)
            cache_key = (int(api_key_id), str(symbol).strip().upper())
            cached_order = None
            if cache_key in ManualTradeService._OPEN_ORDERS_CACHE:
                _, cached_res = ManualTradeService._OPEN_ORDERS_CACHE[cache_key]
                for o in cached_res.get('orders', []):
                    if str(o.get('id')) == oid_str:
                        cached_order = o
                        break

            if cached_order is None:
                meta_entry = ManualTradeService._ORDER_META_CACHE.get((int(api_key_id), oid_str))
                if meta_entry and (time.time() - meta_entry[1]) < 3600:
                    cached_order = meta_entry[0]

            if cached_order is None:
                # Check known in-memory bracket / entry registries (0ms)
                if (
                    oid_str in bracket_order_service.ACTIVE_ENTRY_MONITORS
                    or oid_str in bracket_order_service.KNOWN_TP_ORDER_IDS
                    or any(
                        str(eb.get('tp_order_id') or '') == oid_str or str(eb.get('entry_order_id') or '') == oid_str
                        for eb in bracket_order_service.ACTIVE_ENTRY_BRACKETS.values()
                    )
                ):
                    cached_order = {'id': oid_str, 'isSoftwareSL': False, 'mode': 'LIMIT'}
                elif any(str(s.get('disaster_sl_order_id') or '') == oid_str for s in bracket_order_service.ACTIVE_SOFTWARE_SL.values()):
                    cached_order = {'id': oid_str, 'isSoftwareSL': True, 'mode': 'STOP_MARKET'}

            order_type = 'limit'
            is_conditional_stop = False
            ex_params = {}

            if cached_order:
                is_conditional_stop = bool(cached_order.get('isSoftwareSL'))
                if is_conditional_stop:
                    order_type = str(cached_order.get('mode') or 'STOP_MARKET')
                elif cached_order.get('isPostOnly'):
                    ex_params['postOnly'] = True
                if cached_order.get('isIceberg') and cached_order.get('icebergQty'):
                    iceberg_q = float(cached_order['icebergQty'])
                    try:
                        fmt_iceberg_q = str(exchange.amount_to_precision(symbol, iceberg_q))
                    except Exception:
                        fmt_iceberg_q = str(bracket_order_service._safe_amount_to_precision(exchange, symbol, iceberg_q))
                    if getattr(exchange, 'id', '').lower() != 'binance':
                        ex_params['icebergAmount'] = float(fmt_iceberg_q)
                    ex_params['icebergQty'] = fmt_iceberg_q
                    if 'timeInForce' not in ex_params and not ex_params.get('postOnly'):
                        ex_params['timeInForce'] = 'GTC'
                    logger.info(f"🧊 Preserved Iceberg slice {fmt_iceberg_q} from cache during order edit")
            elif is_futures and not is_inverse:
                # If order not in cache and on linear futures, check if it was a conditional stop
                try:
                    orig_o = await exchange.fetch_order(order_id, symbol, params={'stop': True})
                    if orig_o:
                        info_dict = orig_o.get('info') if isinstance(orig_o.get('info'), dict) else {}
                        info_type = str(info_dict.get('orderType') or info_dict.get('type') or '').lower()
                        if 'stop' in info_type or 'take_profit' in info_type:
                            order_type = info_type.upper()
                            is_conditional_stop = True
                except Exception:
                    pass

            if is_futures and not is_conditional_stop:
                is_hedge = await ManualTradeService._is_binance_hedge_mode(exchange, symbol, is_inverse=is_inverse)
                if is_hedge and 'positionSide' not in ex_params:
                    is_exit_tp = (
                        oid_str in bracket_order_service.KNOWN_TP_ORDER_IDS
                        or (cached_order and str(cached_order.get('mode') or '').upper() == 'TP')
                    )
                    if str(side).lower() == 'buy':
                        ex_params['positionSide'] = 'SHORT' if is_exit_tp else 'LONG'
                    else:
                        ex_params['positionSide'] = 'LONG' if is_exit_tp else 'SHORT'

            # Apply exchange precision safely to prevent precision filter rejections
            new_price = bracket_order_service._safe_price_to_precision(exchange, symbol, new_price)
            amount = bracket_order_service._safe_amount_to_precision(exchange, symbol, amount)
            price_arg = new_price

            if is_conditional_stop:
                ex_params['stopPrice'] = new_price
                price_arg = None

            response = None
            api_ms = 0
            is_native_success = False

            try:
                from app.services.user_order_stream import mark_order_replaced
                mark_order_replaced(str(order_id))
            except Exception:
                pass

            # Binance Futures PUT /order rejects GTX (postOnly=True) orders with -5026 ("Only GTC order can be modified").
            # Skip doomed editOrder roundtrip and jump directly to 1-RTT concurrent cancel + create!
            is_real_binance_futures_gtx = (
                is_futures
                and bool(ex_params.get('postOnly'))
                and not is_conditional_stop
                and isinstance(getattr(exchange, 'urls', None), dict)
                and str(getattr(exchange, 'id', '')).lower().startswith('binance')
            )

            # Priority 0: Ultra-Fast WebSocket API edit_order_ws (Spot cancelReplace / Futures GTC modify in 1 RTT)
            if (
                not is_real_binance_futures_gtx
                and exchange.has.get('editOrderWs')
                and not is_conditional_stop
                and not ex_params.get('icebergQty')
                and is_ws_api_ready(exchange, is_futures=is_futures, is_inverse=is_inverse)
            ):
                try:
                    t_ws_api = time.perf_counter()
                    ws_type, ws_params = ManualTradeService._sanitize_ws_order_args(
                        exchange, order_type, ex_params, is_futures, is_edit=True
                    )
                    response = await exchange.edit_order_ws(
                        order_id, symbol, ws_type, side, amount, price_arg, ws_params
                    )
                    api_ms = int((time.perf_counter() - t_ws_api) * 1000)
                    is_native_success = True
                    logger.info(f"⚡ [WS EDIT] Single-roundtrip editOrderWs succeeded for {order_id} in {api_ms}ms")
                except Exception as ws_edit_err:
                    logger.info(f"WS editOrderWs skipped/fallback ({ws_edit_err}), trying REST editOrder")

            # Priority 1: High-Speed Native Atomic REST edit_order (Binance Spot cancelReplace or Futures GTC PUT order)
            if not is_native_success and not is_real_binance_futures_gtx and exchange.has.get('editOrder') and not is_conditional_stop:
                try:
                    t_api = time.perf_counter()
                    rest_edit_type, rest_edit_params = (
                        ManualTradeService._sanitize_ws_order_args(
                            exchange, order_type, ex_params, is_futures, is_edit=True
                        )
                        if is_futures
                        else (order_type, ex_params)
                    )
                    response = await exchange.edit_order(
                        order_id, symbol, rest_edit_type, side, amount, price_arg, rest_edit_params
                    )
                    api_ms = int((time.perf_counter() - t_api) * 1000)
                    is_native_success = True
                    logger.info(f"⚡ [NATIVE EDIT] Single-roundtrip editOrder succeeded for {order_id} in {api_ms}ms")
                except Exception as edit_err:
                    logger.info(f"Native editOrder skipped/fallback ({edit_err}), proceeding with 1-RTT parallel cancel+create")

            # Priority 2: 1-RTT Parallel Cancel + Create (eliminates 2x-3x serial RTT delay on GTX / TP / fallback edits)
            if not is_native_success:
                t_fallback = time.perf_counter()

                async def _create_replacement_order(override_params: Optional[dict] = None):
                    p_use = dict(override_params if override_params is not None else ex_params)
                    if is_futures and is_conditional_stop:
                        if not p_use.get('positionSide') and 'reduceOnly' not in p_use:
                            p_use = await bracket_order_service._apply_futures_exit_params(exchange, symbol, side, p_use)
                        return await bracket_order_service._place_futures_conditional_order(
                            exchange, symbol, order_type, side, amount,
                            stop_price=new_price, extra_params=p_use
                        )
                    res_leg = None
                    if (
                        exchange.has.get('createOrderWs')
                        and not p_use.get('icebergQty')
                        and is_ws_api_ready(exchange, is_futures=is_futures, is_inverse=is_inverse)
                    ):
                        try:
                            ws_type, ws_params = ManualTradeService._sanitize_ws_order_args(
                                exchange, order_type, p_use, is_futures, is_edit=False
                            )
                            res_leg = await exchange.create_order_ws(
                                symbol, ws_type, side, amount, price_arg, ws_params
                            )
                        except Exception:
                            res_leg = None
                    if not res_leg:
                        res_leg = await exchange.create_order(
                            symbol, order_type, side, amount, price_arg, p_use
                        )
                    return res_leg

                async def _staggered_create_leg():
                    # Stagger reduceOnly/Spot-sell replacements by 35ms so cancel arrives first while keeping 1-RTT wall time
                    if ex_params.get('reduceOnly') or (not is_futures and str(side).lower() == 'sell') or is_conditional_stop:
                        await asyncio.sleep(0.035)
                    return await _create_replacement_order()

                c_res, p_res = await asyncio.gather(
                    bracket_order_service._cancel_futures_order_universal(
                        exchange, order_id, symbol, is_conditional=is_conditional_stop
                    ),
                    _staggered_create_leg(),
                    return_exceptions=True,
                )

                if isinstance(c_res, Exception) and not isinstance(p_res, Exception):
                    # If old order no longer existed, replacement still placed cleanly
                    logger.debug(f"Parallel edit cancel leg notice (non-fatal): {c_res}")
                if isinstance(p_res, Exception) or not p_res:
                    # Handle cancel-race (-2010/-2019/-2022) or Post-Only GTC fallback immediately without re-cancelling
                    err_s = str(p_res).lower() if isinstance(p_res, Exception) else ''
                    is_po_reject = ex_params.get('postOnly') and any(
                        kw in err_s for kw in ('immediately match', '-5022', 'post only', 'postonly', 'post-only', 'gtx', 'expired')
                    )
                    if is_po_reject:
                        ex_params_gtc = dict(ex_params)
                        ex_params_gtc.pop('postOnly', None)
                        ex_params_gtc['timeInForce'] = 'GTC'
                        response = await _create_replacement_order(ex_params_gtc)
                    elif any(kw in err_s for kw in ('-2010', '-2019', '-2022', 'insufficient', 'reduceonly')):
                        # Concurrent cancel cleared the balance/position slightly after create arrived -> 1 immediate clean retry
                        response = await _create_replacement_order()
                    elif isinstance(p_res, Exception):
                        raise p_res
                    else:
                        raise RuntimeError("Order replacement returned empty response")
                else:
                    response = p_res
                    if (
                        ex_params.get('postOnly')
                        and response
                        and str(response.get('status', '')).lower() in ('expired', 'rejected', 'canceled', 'cancelled')
                    ):
                        ex_params_gtc = dict(ex_params)
                        ex_params_gtc.pop('postOnly', None)
                        ex_params_gtc['timeInForce'] = 'GTC'
                        response = await _create_replacement_order(ex_params_gtc)
                api_ms = int((time.perf_counter() - t_fallback) * 1000)

            # Synchronize new order ID & price with any active software bracket & entry monitor
            new_order_id = str(response.get('id')) if response and response.get('id') else None
            resolved_order_id = new_order_id or str(order_id)
            if cached_order and resolved_order_id:
                updated_meta = dict(cached_order)
                updated_meta['id'] = resolved_order_id
                updated_meta['price'] = float(new_price)
                ManualTradeService._ORDER_META_CACHE[(int(api_key_id), resolved_order_id)] = (updated_meta, time.time())
            try:
                from app.services.manual_trade_persistence import (
                    schedule_replace_entry_monitor_id,
                    schedule_update_monitor,
                )
                if resolved_order_id != str(order_id):
                    old_mon = bracket_order_service.ACTIVE_ENTRY_MONITORS.get(str(order_id))
                    if isinstance(old_mon, dict):
                        old_mon['replaced_by'] = resolved_order_id
                        old_mon['entry_order_id'] = resolved_order_id
                        bracket_order_service.ACTIVE_ENTRY_MONITORS[resolved_order_id] = old_mon
                        schedule_replace_entry_monitor_id(str(order_id), resolved_order_id)
                        logger.info(f"🔄 Migrated entry bracket monitor: {order_id} -> {resolved_order_id}")

                if str(order_id) in bracket_order_service.KNOWN_TP_ORDER_IDS and resolved_order_id != str(order_id):
                    bracket_order_service.KNOWN_TP_ORDER_IDS.discard(str(order_id))
                    bracket_order_service.KNOWN_TP_ORDER_IDS.add(resolved_order_id)
                for sid, s_data in list(bracket_order_service.ACTIVE_SOFTWARE_SL.items()):
                    upd = {}
                    if str(s_data.get('entry_order_id') or '') == str(order_id):
                        s_data['entry_order_id'] = resolved_order_id
                        upd['entry_order_id'] = resolved_order_id
                    if str(s_data.get('tp_order_id') or '') == str(order_id):
                        s_data['tp_order_id'] = resolved_order_id
                        s_data['tp_price'] = float(new_price)
                        upd['tp_order_id'] = resolved_order_id
                        upd['tp_price'] = float(new_price)
                        logger.info(f"🔄 Updated active bracket tp_order_id: {order_id} -> {resolved_order_id} @ {new_price}")
                    if str(s_data.get('disaster_sl_order_id') or '') == str(order_id):
                        s_data['disaster_sl_order_id'] = resolved_order_id
                        s_data['trigger_price'] = new_price
                        s_data['price'] = new_price
                        upd['disaster_sl_order_id'] = resolved_order_id
                        upd['trigger_price'] = float(new_price)
                        logger.info(f"🔄 Updated active bracket disaster_sl_order_id: {order_id} -> {resolved_order_id} @ {new_price}")
                    if upd:
                        schedule_update_monitor(str(sid), fields=upd)
                for eb_id, eb_data in list(bracket_order_service.ACTIVE_ENTRY_BRACKETS.items()):
                    if eb_data.get('cancelled'):
                        continue
                    if str(eb_data.get('entry_order_id') or '') == str(order_id):
                        eb_data['entry_order_id'] = resolved_order_id
                    if str(eb_data.get('tp_order_id') or '') == str(order_id):
                        eb_data['tp_order_id'] = resolved_order_id
                        eb_data['tp_price'] = float(new_price)
                        logger.info(f"🔄 Updated active entry bracket {eb_id} tp_order_id: {order_id} -> {resolved_order_id} @ {new_price}")
            except Exception as sync_err:
                logger.debug(f"Bracket ID sync notice: {sync_err}")

            total_ms = int((time.perf_counter() - t0) * 1000)
            logger.info(f"⚡ [EXEC TIMING] Order Modified | Total={total_ms}ms | BinanceAPI={api_ms}ms")

            # Send Rich Session-Safe Telegram Notification with Execution Speed & Time
            try:
                asyncio.create_task(
                    _send_order_modified_notification(
                        user_id=user_id,
                        exchange_name=api_key_record.exchange,
                        symbol=symbol,
                        side=side,
                        amount=amount,
                        new_price=new_price,
                        latency_ms=total_ms
                    )
                )
            except Exception as notify_err:
                logger.warning(f"Failed to trigger telegram notification on edit: {notify_err}")

            ManualTradeService.invalidate_open_orders_cache(api_key_record.id, symbol)
            return {
                "id": response.get('id'),
                "symbol": response.get('symbol') or symbol,
                "status": response.get('status', 'open'),
                "side": response.get('side') or side,
                "amount": response.get('amount') or amount,
                "price": response.get('price') or new_price,
                "execution_speed_ms": total_ms,
                "message": f"Order edited successfully in {total_ms}ms"
            }

        except HTTPException:
            raise
        except Exception as e:
            err_str = str(e)
            await _maybe_emit_api_health_alert(user_id, api_key_record.exchange, e)
            await _emit_manual_trade_in_app(
                user_id=user_id,
                title=f"Order Modify Failed: {symbol}",
                message=(
                    f"Side: {str(side).upper()} | New Price: {new_price}\n"
                    f"Reason: {err_str}"
                ),
                event_type="order_failed",
                severity="critical",
                meta={"symbol": symbol, "side": side, "price": float(new_price)},
            )
            is_exchange_rejection = (
                isinstance(e, getattr(ccxt, 'BaseError', Exception)) or
                any(kw in err_str.lower() for kw in [
                    'immediately match', 'post-only', 'postonly', 'maker', '-5022',
                    'insufficient balance', 'insufficient margin', '-2010', 'account has insufficient',
                    'min_notional', 'filter failure', 'notional', '-1013',
                    'precision', 'lot_size', 'price filter', 'reduceonly',
                    'order does not exist', 'unknown order', 'exchange error'
                ])
            )
            if is_exchange_rejection:
                logger.warning(f"⚠️ Order edit rejected by exchange ({symbol}): {err_str}")
                raise HTTPException(status_code=400, detail=f"Order Edit Failed: {err_str}")

            logger.error(f"Internal order edit error: {e}")
            raise HTTPException(status_code=500, detail=f"Order Edit Failed: {err_str}")

    @staticmethod
    async def execute_emergency_force_order(
        db: Session,
        user_id: int,
        api_key_id: int,
        symbol: str,
        side: str,
        execution_mode: str = 'limit_maker',
        size_pct: float = 100.0,
        custom_amount: float = None,
        leverage: int = None,
        margin_mode: str = None,
        reduce_only: bool = False,
        attached_tp = None,
        attached_sl = None,
        target_order_id: str = None,
        target_order_amount: float = None,
        target_order_mode: str = None,
        enable_ml_filter: bool = False,
        ml_model_id: str = None,
        ml_execution_mode: str = 'basic',
        ml_bullish_threshold: float = 0.50,
        ml_bearish_threshold: float = 0.50,
        start_time: float = None
    ) -> dict:
        """
        Emergency Force Buy / Sell at Current Price:
        - If `target_order_id` (and != 'all') is specified:
          Cancels ONLY that specific open order / bracket (and its linked TP/SL partner) and force-executes
          that order's exact amount at current price via 'limit_maker' (0% fee Smart Peg) or 'market'.
        - If `target_order_id` is None or 'all':
          Cancels all open orders & active brackets on `symbol` to unlock 100% of locked balance/margin,
          and executes `size_pct%` of wallet balance / opposite Futures position.
        """
        import math
        from types import SimpleNamespace
        from app.services.manual_smart_chase_executor import stop_smart_chase, ACTIVE_SMART_CHASES
        from app.services.smart_peg_entry_executor import (
            stop_smart_peg,
            execute_smart_peg_entry,
            ACTIVE_SMART_PEGS,
            _fetch_bbo_fast,
        )

        t_force_enter = time.perf_counter()
        api_key_record = db.query(models.ApiKey).filter(
            models.ApiKey.id == api_key_id,
            models.ApiKey.user_id == user_id,
            models.ApiKey.is_enabled == True
        ).first()

        if not api_key_record:
            raise HTTPException(status_code=404, detail="API Key not found or inactive")

        t_force_db = time.perf_counter()
        is_futures = ':' in symbol
        side_lower = str(side or 'sell').strip().lower()
        mode_lower = str(execution_mode or 'limit_maker').strip().lower()
        specific_oid = str(target_order_id).strip() if (target_order_id and str(target_order_id).strip().lower() != 'all') else None

        try:
            try:
                from app.services.user_order_stream import ensure_user_order_stream
                uos_res = ensure_user_order_stream(user_id, api_key_record, is_futures, symbol)
                if asyncio.iscoroutine(uos_res):
                    uos_res.close()
            except Exception:
                pass

            exchange = await ManualTradeService._get_exchange(api_key_record, is_futures, purpose="order")
            t_force_pool = time.perf_counter()
            try:
                ex_id_str = str(getattr(exchange, 'id', '') or '').lower()
                if ex_id_str and isinstance(getattr(exchange, 'urls', None), dict):
                    from app.services.market_data_streamer import market_data_streamer
                    asyncio.create_task(market_data_streamer.start_streaming(ex_id_str, symbol))
            except Exception:
                pass
            meta = ManualTradeService._get_contract_meta(exchange, symbol)
            is_inverse = meta["is_inverse"]
            contract_size = meta["contract_size"]
            base_part = meta["base"]
            quote_part = meta["quote"]
            if is_inverse:
                schedule_ws_api_prewarm(exchange, is_futures=is_futures, is_inverse=True)

            def _sym_matches(sa: str, sb: str) -> bool:
                s1 = str(sa or '').strip()
                s2 = str(sb or '').strip()
                if (':' in s1) != (':' in s2):
                    return False
                return s1.split(':')[0].upper() == s2.split(':')[0].upper()

            stopped_chases = 0
            stopped_pegs = 0
            cancelled_brackets = 0
            cancelled_open_orders = 0
            resolved_specific_amt = float(target_order_amount or 0.0)
            resolved_all_base_amt = 0.0
            resolved_all_quote_amt = 0.0
            is_exit_order = str(target_order_mode or '').upper() in ('TP', 'STOP', 'SL', 'SMART_CHASE', 'TRAILING', 'TRAILING_CHASE', 'FIXED')
            ai_filter_info = None
            pos_info = None
            prewarmed_ob = None
            prewarmed_bal = None

            # --- L2 Machine Learning Filter Gatekeeper (Before cancelling open orders) ---
            if enable_ml_filter and not reduce_only and not is_exit_order:
                is_closing_opp_pos = False
                if is_futures:
                    try:
                        p_chk = await ManualTradeService.get_active_position(db, user_id, api_key_id, symbol)
                        pos_info = p_chk
                        p_amt = float((p_chk or {}).get('amount') or 0.0)
                        p_side = str((p_chk or {}).get('side') or 'none').lower()
                        if p_amt > 0 and ((p_side == 'long' and side_lower == 'sell') or (p_side == 'short' and side_lower == 'buy')):
                            is_closing_opp_pos = True
                    except Exception:
                        pass

                if not is_closing_opp_pos:
                    ml_res = await ManualTradeService._validate_with_ml_filter(
                        exchange=exchange,
                        symbol=symbol,
                        side=side_lower,
                        ml_model_id=ml_model_id,
                        bullish_thresh=ml_bullish_threshold,
                        bearish_thresh=ml_bearish_threshold,
                        execution_mode=ml_execution_mode,
                        attached_tp=attached_tp,
                        attached_sl=attached_sl
                    )
                    if ml_res.get("rejected"):
                        return ml_res
                    ai_filter_info = ml_res.get("ai_filter_info")
                    if str(ml_execution_mode or 'basic').lower() == 'advanced':
                        if ml_res.get("tp_price") and float(ml_res["tp_price"]) > 0:
                            safe_tp = bracket_order_service._safe_price_to_precision(exchange, symbol, float(ml_res["tp_price"]))
                            if attached_tp is not None:
                                attached_tp.enabled = True
                                attached_tp.mode = 'absolute'
                                attached_tp.value = safe_tp
                            else:
                                from app.api.v1.endpoints.trading import AttachedTPConfig
                                attached_tp = AttachedTPConfig(enabled=True, mode='absolute', value=safe_tp)
                        if ml_res.get("sl_price") and float(ml_res["sl_price"]) > 0:
                            safe_sl = bracket_order_service._safe_price_to_precision(exchange, symbol, float(ml_res["sl_price"]))
                            if attached_sl is not None:
                                attached_sl.enabled = True
                                attached_sl.mode = 'absolute'
                                attached_sl.value = safe_sl
                            else:
                                from app.api.v1.endpoints.trading import AttachedSLConfig
                                attached_sl = AttachedSLConfig(enabled=True, mode='absolute', value=safe_sl)

            cancel_wave_ms = 0
            bal_post_ms = 0
            if specific_oid:
                # --- TARGETED SINGLE ORDER / BRACKET CANCELLATION (CONCURRENT 1-RTT) ---
                cancel_tasks = []
                queued_cancel_oids = set()
                in_mem_handled = False

                def _queue_cancel_oid(oid_val: Optional[str], is_cond: Optional[bool] = None):
                    if not oid_val:
                        return
                    oid_key = (str(oid_val), is_cond)
                    if oid_key in queued_cancel_oids:
                        return
                    queued_cancel_oids.add(oid_key)
                    cancel_tasks.append(('ord', bracket_order_service._cancel_futures_order_universal(exchange, str(oid_val), symbol, is_conditional=is_cond)))

                if specific_oid in ACTIVE_SMART_PEGS:
                    in_mem_handled = True
                    pdata = ACTIVE_SMART_PEGS.get(specific_oid) or {}
                    if resolved_specific_amt <= 0:
                        resolved_specific_amt = float(pdata.get('amount') or 0.0)
                    cancel_tasks.append(('peg', stop_smart_peg(symbol=symbol, api_key_id=api_key_id, user_id=user_id, peg_id=specific_oid)))

                if specific_oid in ACTIVE_SMART_CHASES:
                    in_mem_handled = True
                    cdata = ACTIVE_SMART_CHASES.get(specific_oid) or {}
                    if resolved_specific_amt <= 0:
                        resolved_specific_amt = float(cdata.get('amount') or 0.0)
                    is_exit_order = True
                    tp_oid = cdata.get('tp_order_id')
                    if tp_oid:
                        _queue_cancel_oid(str(tp_oid), False if not is_futures else None)
                    cancel_tasks.append(('chase', stop_smart_chase(symbol=symbol, api_key_id=api_key_id, user_id=user_id, chase_id=specific_oid)))

                for sl_id, sdata in list(bracket_order_service.ACTIVE_SOFTWARE_SL.items()):
                    key_match = (sdata.get('api_key_id') is None or int(sdata.get('api_key_id')) == int(api_key_id))
                    if not key_match or not _sym_matches(sdata.get('symbol', ''), symbol) or sdata.get('cancelled'):
                        continue
                    if (
                        str(sl_id) == specific_oid
                        or str(sdata.get('tp_order_id') or '') == specific_oid
                        or str(sdata.get('disaster_sl_order_id') or '') == specific_oid
                        or str(sdata.get('entry_order_id') or '') == specific_oid
                    ):
                        in_mem_handled = True
                        sdata['cancelled'] = True
                        try:
                            from app.services.manual_trade_persistence import schedule_mark_terminal
                            schedule_mark_terminal(str(sl_id), status='cancelled', reason='emergency_force_order')
                        except Exception:
                            pass
                        cancelled_brackets += 1
                        is_exit_order = True
                        if resolved_specific_amt <= 0:
                            resolved_specific_amt = float(sdata.get('amount') or 0.0)
                        tp_oid = sdata.get('tp_order_id')
                        dis_oid = sdata.get('disaster_sl_order_id')
                        if tp_oid:
                            _queue_cancel_oid(str(tp_oid), False if not is_futures else None)
                        if dis_oid:
                            _queue_cancel_oid(str(dis_oid), True)

                for eb_id, eb_data in list(bracket_order_service.ACTIVE_ENTRY_BRACKETS.items()):
                    key_match = (eb_data.get('api_key_id') is None or int(eb_data.get('api_key_id')) == int(api_key_id))
                    if not key_match or not _sym_matches(eb_data.get('symbol', ''), symbol) or eb_data.get('cancelled'):
                        continue
                    if str(eb_id) == specific_oid or str(eb_data.get('tp_order_id') or '') == specific_oid:
                        in_mem_handled = True
                        eb_data['cancelled'] = True
                        is_exit_order = True
                        if resolved_specific_amt <= 0:
                            resolved_specific_amt = float(eb_data.get('amount') or 0.0)
                        tp_oid = eb_data.get('tp_order_id')
                        if tp_oid:
                            _queue_cancel_oid(str(tp_oid), False if not is_futures else None)

                if specific_oid in bracket_order_service.ACTIVE_ENTRY_MONITORS:
                    bracket_order_service.ACTIVE_ENTRY_MONITORS[specific_oid]['cancelled'] = True
                try:
                    from app.services.manual_trade_persistence import schedule_mark_terminal
                    schedule_mark_terminal(specific_oid, status='cancelled', reason='emergency_force_order')
                except Exception:
                    pass
                if specific_oid in bracket_order_service.KNOWN_TP_ORDER_IDS:
                    is_exit_order = True

                if not in_mem_handled and specific_oid not in bracket_order_service.ACTIVE_SOFTWARE_SL:
                    if resolved_specific_amt <= 0:
                        try:
                            ord_info = await exchange.fetch_order(specific_oid, symbol)
                            if ord_info:
                                resolved_specific_amt = float(ord_info.get('remaining') or ord_info.get('amount') or 0.0)
                        except Exception:
                            pass
                    _queue_cancel_oid(specific_oid, False if not is_futures else None)

                if is_futures and pos_info is None:
                    cancel_tasks.append(('pos', ManualTradeService.get_active_position(db, user_id, api_key_id, symbol)))

                if is_futures:
                    prewarmed_bal = ManualTradeService._get_cached_wallet_balance(
                        api_key_id, is_futures, max_age_seconds=15.0, is_inverse=is_inverse
                    )
                if prewarmed_bal is None and not (is_futures and (is_exit_order or bool(reduce_only))):
                    cancel_tasks.append(('bal', ManualTradeService._fetch_wallet_balance(exchange, symbol, meta, api_key_id=api_key_id)))

                cancel_tasks.append(('ob', _fetch_bbo_fast(exchange, symbol)))

                if cancel_tasks:
                    t_cw0 = time.perf_counter()
                    res_list = await asyncio.gather(*(t[1] for t in cancel_tasks), return_exceptions=True)
                    cancel_wave_ms = int((time.perf_counter() - t_cw0) * 1000)
                    for (tag, _), r_val in zip(cancel_tasks, res_list):
                        if tag == 'peg' and isinstance(r_val, int):
                            stopped_pegs += r_val
                        elif tag == 'chase' and isinstance(r_val, int):
                            stopped_chases += r_val
                        elif tag == 'ord' and not isinstance(r_val, Exception):
                            cancelled_open_orders += 1
                        elif tag == 'pos' and not isinstance(r_val, Exception):
                            pos_info = r_val
                        elif tag == 'bal' and not isinstance(r_val, Exception):
                            prewarmed_bal = r_val
                        elif tag == 'ob' and not isinstance(r_val, Exception):
                            prewarmed_ob = r_val
            else:
                # --- CANCEL ALL OPEN ORDERS & BRACKETS ON SYMBOL (CONCURRENT 1-RTT) ---
                for pid, pdata in list(ACTIVE_SMART_PEGS.items()):
                    key_match = (pdata.get('api_key_id') is None or int(pdata.get('api_key_id')) == int(api_key_id))
                    if key_match and _sym_matches(pdata.get('symbol', ''), symbol):
                        if str(pdata.get('side') or '').lower() == side_lower:
                            rem_p = max(0.0, float(pdata.get('amount') or 0.0) - float(pdata.get('filled_amount') or 0.0))
                            px_p = float(pdata.get('current_maker_price') or pdata.get('initial_price') or 0.0)
                            resolved_all_base_amt += rem_p
                            if px_p > 0:
                                resolved_all_quote_amt += rem_p * px_p

                pre_open_orders = []
                oo_cache_known = False
                oo_max_age = 10.0 if is_futures else 30.0
                try:
                    cache_key = (int(api_key_id), str(symbol).strip().upper())
                    cached_oo = ManualTradeService._OPEN_ORDERS_CACHE.get(cache_key)
                    if cached_oo and (time.time() - cached_oo[0]) < oo_max_age and isinstance(cached_oo[1], dict):
                        pre_open_orders = list(cached_oo[1].get('orders') or [])
                        oo_cache_known = True
                    for o in pre_open_orders:
                        if not isinstance(o, dict):
                            continue
                        if str(o.get('side') or '').lower() == side_lower:
                            rem_o = float(o.get('remaining') or o.get('amount') or 0.0)
                            px_o = float(o.get('price') or 0.0)
                            resolved_all_base_amt += rem_o
                            if px_o > 0:
                                resolved_all_quote_amt += rem_o * px_o
                except Exception:
                    pre_open_orders = []

                has_active_chase_or_peg = any(
                    (d.get('api_key_id') is None or int(d.get('api_key_id')) == int(api_key_id)) and _sym_matches(d.get('symbol', ''), symbol)
                    for d in list(ACTIVE_SMART_PEGS.values()) + list(ACTIVE_SMART_CHASES.values())
                )

                for em_id, em_data in list(bracket_order_service.ACTIVE_ENTRY_MONITORS.items()):
                    key_match = (em_data.get('api_key_id') is None or int(em_data.get('api_key_id')) == int(api_key_id))
                    if key_match and _sym_matches(em_data.get('symbol', ''), symbol):
                        em_data['cancelled'] = True
                try:
                    from app.services.manual_trade_persistence import schedule_mark_terminal_by_scope
                    schedule_mark_terminal_by_scope(api_key_id, symbol, status='cancelled', reason='emergency_force_order_all')
                except Exception:
                    pass

                parallel_tasks = [
                    ('chase', stop_smart_chase(symbol=symbol, api_key_id=api_key_id, user_id=user_id)),
                    ('peg', stop_smart_peg(symbol=symbol, api_key_id=api_key_id, user_id=user_id)),
                ]

                for sl_id, sdata in list(bracket_order_service.ACTIVE_SOFTWARE_SL.items()):
                    key_match = (sdata.get('api_key_id') is None or int(sdata.get('api_key_id')) == int(api_key_id))
                    if key_match and _sym_matches(sdata.get('symbol', ''), symbol) and not sdata.get('cancelled'):
                        sdata['cancelled'] = True
                        cancelled_brackets += 1
                        tp_oid = sdata.get('tp_order_id')
                        dis_oid = sdata.get('disaster_sl_order_id')
                        if tp_oid:
                            parallel_tasks.append(('ord', bracket_order_service._cancel_futures_order_universal(exchange, str(tp_oid), symbol)))
                        if dis_oid:
                            parallel_tasks.append(('ord', bracket_order_service._cancel_futures_order_universal(exchange, str(dis_oid), symbol, is_conditional=True)))

                for eb_id, eb_data in list(bracket_order_service.ACTIVE_ENTRY_BRACKETS.items()):
                    key_match = (eb_data.get('api_key_id') is None or int(eb_data.get('api_key_id')) == int(api_key_id))
                    if not key_match or not _sym_matches(eb_data.get('symbol', ''), symbol) or eb_data.get('cancelled'):
                        continue
                    eb_data['cancelled'] = True
                    tp_oid = eb_data.get('tp_order_id')
                    if tp_oid:
                        parallel_tasks.append(('ord', bracket_order_service._cancel_futures_order_universal(exchange, str(tp_oid), symbol)))

                # Skip redundant cancel_all RTT when fresh cache (<10s Futures / <30s Spot) confirms 0 open exchange orders
                # and no local SmartPeg/SmartChase/bracket orders are active for this symbol.
                skip_cancel_all = bool(
                    oo_cache_known
                    and len(pre_open_orders) == 0
                    and not has_active_chase_or_peg
                    and cancelled_brackets == 0
                )
                t_par_start = time.perf_counter()
                if not skip_cancel_all:
                    if (
                        getattr(exchange, 'has', {}).get('cancelAllOrdersWs')
                        and hasattr(exchange, 'cancel_all_orders_ws')
                        and is_ws_api_ready(exchange, is_futures=is_futures, is_inverse=is_inverse)
                    ):
                        parallel_tasks.append(('cancel_all_ws', exchange.cancel_all_orders_ws(symbol)))
                    elif hasattr(exchange, 'cancel_all_orders'):
                        parallel_tasks.append(('cancel_all_rest', exchange.cancel_all_orders(symbol)))

                has_known_stop_orders = bool(cancelled_brackets > 0) or (not oo_cache_known) or any(
                    bool(
                        isinstance(o, dict) and (
                            o.get('isSoftwareSL')
                            or str(o.get('mode') or '').upper() in ('STOP', 'SL')
                            or o.get('stopPrice')
                            or o.get('triggerPrice')
                        )
                    )
                    for o in pre_open_orders
                )
                if is_futures and not is_inverse and hasattr(exchange, 'cancel_all_orders') and not skip_cancel_all and has_known_stop_orders:
                    async def _cancel_all_stop_orders():
                        try:
                            return await exchange.cancel_all_orders(symbol, params={'stop': True})
                        except TypeError:
                            return None
                    parallel_tasks.append(('cancel_all_stop', _cancel_all_stop_orders()))

                if is_futures and pos_info is None:
                    pos_max_age = 1.5 if reduce_only else 4.0
                    parallel_tasks.append(('pos', ManualTradeService.get_active_position(db, user_id, api_key_id, symbol, max_age_seconds=pos_max_age)))

                # Fetch wallet balance in parallel with cancel_all instead of waiting a separate serial RTT afterward
                prewarmed_bal = ManualTradeService._get_cached_wallet_balance(
                    api_key_id, is_futures, max_age_seconds=10.0, is_inverse=is_inverse
                )
                if prewarmed_bal is None and not (is_futures and bool(reduce_only)):
                    parallel_tasks.append(('bal', ManualTradeService._fetch_wallet_balance(exchange, symbol, meta, api_key_id=api_key_id)))

                parallel_tasks.append(('ob', _fetch_bbo_fast(exchange, symbol)))

                par_res = await asyncio.gather(*(t[1] for t in parallel_tasks), return_exceptions=True)
                cancel_wave_ms = int((time.perf_counter() - t_par_start) * 1000)
                cancel_all_ok = skip_cancel_all
                ws_cancel_failed = False
                for (tag, _), r_val in zip(parallel_tasks, par_res):
                    if tag == 'chase' and isinstance(r_val, int):
                        stopped_chases += r_val
                    elif tag == 'peg' and isinstance(r_val, int):
                        stopped_pegs += r_val
                    elif tag == 'ord' and not isinstance(r_val, Exception):
                        cancelled_open_orders += 1
                    elif tag == 'cancel_all_ws':
                        if not isinstance(r_val, Exception):
                            cancel_all_ok = True
                            if isinstance(r_val, list) and r_val:
                                cancelled_open_orders += len(r_val)
                                if not pre_open_orders:
                                    for co in r_val:
                                        if isinstance(co, dict) and str(co.get('side') or '').lower() == side_lower:
                                            rem_c = float(co.get('remaining') or co.get('amount') or (co.get('info') or {}).get('origQty') or 0.0)
                                            px_c = float(co.get('price') or (co.get('info') or {}).get('price') or 0.0)
                                            resolved_all_base_amt += rem_c
                                            if px_c > 0:
                                                resolved_all_quote_amt += rem_c * px_c
                            elif pre_open_orders:
                                cancelled_open_orders += len(pre_open_orders)
                        else:
                            err_c_low = str(r_val).lower()
                            if '-2011' in err_c_low or 'unknown order' in err_c_low or 'no open order' in err_c_low:
                                # Exchange confirmed zero open orders exist -> done in 1 RTT without slow REST retry
                                cancel_all_ok = True
                            else:
                                ws_cancel_failed = True
                                logger.debug(f"cancel_all_orders_ws fallback to REST for {symbol}: {r_val}")
                    elif tag == 'cancel_all_rest' and not isinstance(r_val, Exception):
                        cancel_all_ok = True
                        if isinstance(r_val, list) and r_val:
                            cancelled_open_orders += len(r_val)
                            if not pre_open_orders:
                                for co in r_val:
                                    if isinstance(co, dict) and str(co.get('side') or '').lower() == side_lower:
                                        rem_c = float(co.get('remaining') or co.get('amount') or (co.get('info') or {}).get('origQty') or 0.0)
                                        px_c = float(co.get('price') or (co.get('info') or {}).get('price') or 0.0)
                                        resolved_all_base_amt += rem_c
                                        if px_c > 0:
                                            resolved_all_quote_amt += rem_c * px_c
                        elif pre_open_orders:
                            cancelled_open_orders += len(pre_open_orders)
                    elif tag == 'cancel_all_stop' and not isinstance(r_val, Exception):
                        if pre_open_orders:
                            cancelled_open_orders += 1
                    elif tag == 'pos' and not isinstance(r_val, Exception):
                        pos_info = r_val
                    elif tag == 'bal' and not isinstance(r_val, Exception):
                        prewarmed_bal = r_val
                    elif tag == 'ob' and not isinstance(r_val, Exception):
                        prewarmed_ob = r_val

                if ws_cancel_failed and not cancel_all_ok and hasattr(exchange, 'cancel_all_orders'):
                    try:
                        await exchange.cancel_all_orders(symbol)
                        if pre_open_orders:
                            cancelled_open_orders += len(pre_open_orders)
                        cancel_all_ok = True
                    except Exception:
                        pass

                if not cancel_all_ok and pre_open_orders:
                    rem_cancels = [
                        bracket_order_service._cancel_futures_order_universal(exchange, str(o.get('id')), symbol)
                        for o in pre_open_orders if isinstance(o, dict) and o.get('id')
                    ]
                    if rem_cancels:
                        rem_res = await asyncio.gather(*rem_cancels, return_exceptions=True)
                        cancelled_open_orders += sum(1 for r in rem_res if not isinstance(r, Exception))

                ManualTradeService.invalidate_open_orders_cache(api_key_id, symbol)

            # 3. Resolve Futures opposite-position check first so closing exits skip unnecessary balance RTTs!
            has_cancelled_orders = bool(
                cancelled_open_orders > 0 or stopped_pegs > 0 or stopped_chases > 0
            )
            pos_amt = float((pos_info or {}).get('amount') or 0.0) if is_futures else 0.0
            pos_contracts = float((pos_info or {}).get('contracts') or 0.0) if is_futures else 0.0
            pos_side = str((pos_info or {}).get('side') or 'none').lower() if is_futures else 'none'
            is_opp_futures_pos = bool(
                is_futures
                and (pos_amt > 0 or pos_contracts > 0)
                and ((pos_side == 'long' and side_lower == 'sell') or (pos_side == 'short' and side_lower == 'buy'))
            )
            is_closing_position = bool(reduce_only) or (is_futures and is_exit_order) or is_opp_futures_pos

            ob = prewarmed_ob
            bal = prewarmed_bal
            if is_futures and is_closing_position:
                if bal is None:
                    bal = ManualTradeService._get_cached_wallet_balance(
                        api_key_id, is_futures, max_age_seconds=30.0, is_inverse=is_inverse
                    ) or {}
                if ob is None:
                    try:
                        ob = await _fetch_bbo_fast(exchange, symbol)
                    except Exception:
                        ob = None
            else:
                # Re-fetch balance after cancellation ONLY if existing balance is missing or doesn't track the unlocked amount
                # (when total/approx_rel already reflects unlocked funds, reuse it cleanly in 0ms; -2010/-2019 auto-clamp protects execution).
                need_rebalance = False
                if has_cancelled_orders:
                    rel_amt_known = (
                        (is_futures and (resolved_all_quote_amt > 0 or resolved_all_base_amt > 0 or (specific_oid and resolved_specific_amt > 0)))
                        or (not is_futures and side_lower == 'buy' and (resolved_all_quote_amt > 0 or (specific_oid and resolved_specific_amt > 0)))
                        or (not is_futures and side_lower == 'sell' and (resolved_all_base_amt > 0 or (specific_oid and resolved_specific_amt > 0)))
                    )
                    need_rebalance = (bal is None) or (not rel_amt_known)
                cached_bal = None if need_rebalance else (
                    bal or ManualTradeService._get_cached_wallet_balance(
                        api_key_id, is_futures, max_age_seconds=(30.0 if (is_futures and not has_cancelled_orders) else 10.0), is_inverse=is_inverse
                    )
                )
                if cached_bal is not None:
                    if ob is None:
                        try:
                            ob = await _fetch_bbo_fast(exchange, symbol)
                        except Exception:
                            ob = None
                    bal = cached_bal
                else:
                    t_bp0 = time.perf_counter()
                    gather_b = [ManualTradeService._fetch_wallet_balance(exchange, symbol, meta, api_key_id=api_key_id)]
                    if ob is None:
                        gather_b.append(_fetch_bbo_fast(exchange, symbol))
                    gb_res = await asyncio.gather(*gather_b, return_exceptions=True)
                    bal_post_ms += int((time.perf_counter() - t_bp0) * 1000)
                    if isinstance(gb_res[0], Exception):
                        if cached_bal is not None:
                            bal = cached_bal
                        else:
                            raise gb_res[0]
                    else:
                        bal = gb_res[0]
                    if len(gb_res) > 1 and not isinstance(gb_res[1], Exception):
                        ob = gb_res[1]

            ref_price = 0.0
            best_bid = 0.0
            best_ask = 0.0
            if ob and ob.get('bids') and ob.get('asks'):
                best_bid = float(ob['bids'][0][0])
                best_ask = float(ob['asks'][0][0])
                ref_price = best_bid if side_lower == 'sell' else best_ask

            if ref_price <= 0:
                ticker = await exchange.fetch_ticker(symbol)
                ref_price = float(ticker.get('last') or ticker.get('close') or ticker.get('bid') or ticker.get('ask') or 0.0)

            if ref_price <= 0:
                raise HTTPException(status_code=400, detail=f"Could not determine live market price for {symbol}.")

            pct = float(size_pct) if (size_pct is not None and float(size_pct) > 0) else 100.0
            pct_ratio = min(1.0, max(0.01, pct / 100.0))
            has_custom_amount = False
            if custom_amount is not None and (size_pct is None or float(size_pct) <= 0):
                try:
                    if float(custom_amount) > 0:
                        has_custom_amount = True
                except (ValueError, TypeError):
                    has_custom_amount = False

            def _extract_bal(bal_dict: dict, asset: str, kind: str) -> float:
                val = float((bal_dict.get(asset) or {}).get(kind) or 0.0)
                if val > 0:
                    return val
                sub = bal_dict.get(kind)
                if isinstance(sub, dict):
                    return float(sub.get(asset) or 0.0)
                return 0.0

            unlock_base_amt = resolved_specific_amt if (specific_oid and resolved_specific_amt > 0) else resolved_all_base_amt
            unlock_quote_amt = (
                (resolved_specific_amt * ref_price)
                if (specific_oid and resolved_specific_amt > 0)
                else (resolved_all_quote_amt if resolved_all_quote_amt > 0 else resolved_all_base_amt * ref_price)
            )

            if has_cancelled_orders and not (is_futures and is_closing_position):
                lev_eff = float(leverage or 1.0) if is_futures else 1.0
                if is_futures:
                    # On Linear Futures, margin is ALWAYS quote_part (even on SELL!); on Inverse, it is base_part.
                    margin_asset = base_part if is_inverse else quote_part
                    needed_margin = (
                        ((unlock_base_amt * pct_ratio) / lev_eff)
                        if is_inverse
                        else ((unlock_quote_amt * pct_ratio) / lev_eff)
                    ) if (unlock_quote_amt > 0 or unlock_base_amt > 0) else 0.0
                    if needed_margin > 0:
                        fm = _extract_bal(bal, margin_asset, 'free')
                        tm = _extract_bal(bal, margin_asset, 'total')
                        if fm < needed_margin * 0.98 and tm < needed_margin * 0.98 and (fm + needed_margin) > tm * 1.005:
                            t_bp_fut = time.perf_counter()
                            await asyncio.sleep(0.04)
                            bal = await ManualTradeService._fetch_wallet_balance(exchange, symbol, meta, api_key_id=api_key_id)
                            bal_post_ms += int((time.perf_counter() - t_bp_fut) * 1000)
                else:
                    needed_val = 0.0
                    if side_lower == 'buy' and unlock_quote_amt > 0:
                        needed_val = unlock_quote_amt * pct_ratio
                    elif side_lower == 'sell' and unlock_base_amt > 0:
                        needed_val = unlock_base_amt * pct_ratio

                    if needed_val > 0:
                        free_asset = _extract_bal(bal, quote_part if side_lower == 'buy' else base_part, 'free')
                        tot_asset = _extract_bal(bal, quote_part if side_lower == 'buy' else base_part, 'total')
                        # Single brief refresh ONLY if total asset balance is below needed_val (unlocked amount unaccounted for)
                        if free_asset < needed_val * 0.98 and tot_asset < needed_val * 0.98 and (free_asset + needed_val) > tot_asset * 1.005:
                            t_bp1 = time.perf_counter()
                            await asyncio.sleep(0.04)
                            bal = await ManualTradeService._fetch_wallet_balance(exchange, symbol, meta, api_key_id=api_key_id)
                            bal_post_ms += int((time.perf_counter() - t_bp1) * 1000)

            target_amount = 0.0

            if is_futures:
                if is_opp_futures_pos:
                    is_closing_position = True
                    if specific_oid and resolved_specific_amt > 0:
                        target_amount = min(pos_amt if not is_inverse else (pos_contracts or pos_amt), resolved_specific_amt * pct_ratio)
                    elif is_inverse:
                        total_cont = float(pos_contracts or max(1, round((pos_amt * ref_price) / contract_size)))
                        if has_custom_amount:
                            target_amount = max(1.0, min(total_cont, float(round(float(custom_amount)))))
                        else:
                            target_amount = max(1.0, round(total_cont * pct_ratio))
                    else:
                        if has_custom_amount:
                            target_amount = min(pos_amt, float(custom_amount))
                        else:
                            target_amount = pos_amt * pct_ratio
                else:
                    # Opening / adding to Futures position -> sync margin mode & leverage concurrently ONLY on cache miss
                    sym_cache_key = f"{getattr(exchange, 'apiKey', '')}_{symbol}"
                    now_ts = time.time()
                    sync_tasks = []
                    target_mm = ManualTradeService._normalize_margin_mode_str(margin_mode)
                    if target_mm:
                        cached_mm, mm_exp = ManualTradeService._MARGIN_MODE_CACHE.get(sym_cache_key, (None, 0))
                        if cached_mm != target_mm or now_ts >= mm_exp:
                            async def _sync_mm():
                                try:
                                    await exchange.set_margin_mode(margin_mode, symbol)
                                except Exception:
                                    pass
                                ManualTradeService._MARGIN_MODE_CACHE[sym_cache_key] = (target_mm, time.time() + 3600)
                            sync_tasks.append(_sync_mm())
                    if leverage:
                        lev_int = int(float(leverage))
                        cached_lev, exp_ts = ManualTradeService._LEVERAGE_CACHE.get(sym_cache_key, (None, 0))
                        if cached_lev != lev_int or now_ts >= exp_ts:
                            async def _sync_lv():
                                try:
                                    await exchange.set_leverage(lev_int, symbol)
                                except Exception:
                                    pass
                                ManualTradeService._LEVERAGE_CACHE[sym_cache_key] = (lev_int, time.time() + 3600)
                            sync_tasks.append(_sync_lv())
                    if sync_tasks:
                        await asyncio.gather(*sync_tasks, return_exceptions=True)

                    lev = float(leverage or 1)
                    if is_inverse:
                        free_base = float(bal.get(base_part, {}).get('free', 0.0)) or (
                            float(bal.get('free', {}).get(base_part, 0.0)) if isinstance(bal.get('free'), dict) else 0.0
                        )
                        total_base = float(bal.get(base_part, {}).get('total', 0.0)) or (
                            float(bal.get('total', {}).get(base_part, 0.0)) if isinstance(bal.get('total'), dict) else free_base
                        )
                        approx_rel_base = (
                            (resolved_specific_amt * pct_ratio)
                            if (specific_oid and resolved_specific_amt > 0)
                            else (resolved_all_base_amt * pct_ratio)
                        )
                        effective_base = min(free_base + approx_rel_base, total_base * 0.99) if has_cancelled_orders else free_base
                        effective_base = max(effective_base, free_base)
                        if effective_base <= 0:
                            raise HTTPException(status_code=400, detail=f"No free {base_part} margin available for Emergency {side.upper()}.")
                        total_notional_usd = effective_base * 0.985 * ref_price * lev
                        max_cont = max(1.0, math.floor(total_notional_usd / contract_size))
                        if specific_oid and resolved_specific_amt > 0:
                            target_amount = min(max_cont, max(1.0, round(resolved_specific_amt * pct_ratio)))
                        elif has_custom_amount:
                            target_amount = max(1.0, min(max_cont, float(round(float(custom_amount)))))
                        else:
                            target_amount = max(1.0, math.floor((total_notional_usd * pct_ratio) / contract_size))
                    else:
                        free_quote = float(bal.get(quote_part, {}).get('free', 0.0)) or (
                            float(bal.get('free', {}).get(quote_part, 0.0)) if isinstance(bal.get('free'), dict) else 0.0
                        )
                        total_quote = float(bal.get(quote_part, {}).get('total', 0.0)) or (
                            float(bal.get('total', {}).get(quote_part, 0.0)) if isinstance(bal.get('total'), dict) else free_quote
                        )
                        approx_rel_quote = (
                            (unlock_quote_amt * pct_ratio) / lev
                            if (specific_oid and resolved_specific_amt > 0) or resolved_all_quote_amt > 0 or resolved_all_base_amt > 0
                            else 0.0
                        )
                        effective_quote = min(free_quote + approx_rel_quote, total_quote * 0.99) if has_cancelled_orders else free_quote
                        effective_quote = max(effective_quote, free_quote)
                        if effective_quote <= 0:
                            raise HTTPException(status_code=400, detail=f"No free {quote_part} margin available for Emergency {side.upper()}.")
                        safety = 0.985 if mode_lower == 'market' else 0.992
                        max_afford = (effective_quote * lev * safety) / ref_price
                        if specific_oid and resolved_specific_amt > 0:
                            target_amount = min(max_afford, resolved_specific_amt * pct_ratio)
                        elif has_custom_amount:
                            target_amount = min(float(custom_amount), max_afford)
                        else:
                            target_amount = max_afford * pct_ratio
            else:
                # Spot Market
                if side_lower == 'sell':
                    free_base = _extract_bal(bal, base_part, 'free')
                    used_base = _extract_bal(bal, base_part, 'used')
                    total_base = max(_extract_bal(bal, base_part, 'total'), free_base + used_base)
                    approx_rel_base = unlock_base_amt * pct_ratio
                    effective_base = min(free_base + approx_rel_base, total_base * 0.9995) if has_cancelled_orders else free_base
                    effective_base = max(effective_base, free_base)
                    if effective_base <= 0:
                        raise HTTPException(status_code=400, detail=f"Insufficient {base_part} balance (0 available) for Emergency Force Sell.")
                    if specific_oid and resolved_specific_amt > 0:
                        target_amount = min(effective_base, resolved_specific_amt * pct_ratio)
                    elif has_custom_amount:
                        target_amount = min(float(custom_amount), effective_base * 0.9995)
                    else:
                        target_amount = effective_base * pct_ratio * (0.9995 if (pct_ratio >= 0.99 and not has_cancelled_orders) else 1.0)
                else:
                    free_quote = _extract_bal(bal, quote_part, 'free')
                    used_quote = _extract_bal(bal, quote_part, 'used')
                    total_quote = max(_extract_bal(bal, quote_part, 'total'), free_quote + used_quote)
                    approx_rel_quote = unlock_quote_amt * pct_ratio
                    effective_quote = min(free_quote + approx_rel_quote, total_quote * 0.992) if has_cancelled_orders else free_quote
                    effective_quote = max(effective_quote, free_quote)
                    if effective_quote <= 0:
                        raise HTTPException(status_code=400, detail=f"Insufficient {quote_part} balance (0 available) for Emergency Force Buy.")
                    safety = 0.992 if mode_lower == 'market' else 0.998
                    max_afford_spot = (effective_quote * safety) / ref_price
                    if specific_oid and resolved_specific_amt > 0:
                        target_amount = min(max_afford_spot, resolved_specific_amt * pct_ratio)
                    elif has_custom_amount:
                        target_amount = min(float(custom_amount), max_afford_spot)
                    else:
                        target_amount = max_afford_spot * pct_ratio

            target_amount = bracket_order_service._safe_amount_to_precision(exchange, symbol, target_amount)
            if is_futures and is_inverse and target_amount > 0:
                target_amount = float(max(1.0, round(target_amount)))
            if target_amount <= 0:
                raise HTTPException(status_code=400, detail=f"Calculated emergency order size is 0 for {symbol}.")

            logger.info(
                f"⚡ [Emergency Force {side_lower.upper()}] {symbol} | target={target_order_id or 'all'} | "
                f"pct={pct}% | specific_amt={resolved_specific_amt} | all_rel_base={resolved_all_base_amt} -> "
                f"final_amount={target_amount}"
            )
            t_force_origin = start_time if (start_time and start_time > 0) else t_force_enter
            logger.info(
                f"⚡ [FORCE TIMING] {symbol} | Mode={mode_lower} | TotalToExec={(time.perf_counter() - t_force_origin)*1000:.0f}ms | "
                f"DB={(t_force_db - t_force_enter)*1000:.0f}ms | Pool={(t_force_pool - t_force_db)*1000:.0f}ms | "
                f"CancelWave={cancel_wave_ms}ms | BalPost={bal_post_ms}ms | "
                f"WSReady={is_ws_api_ready(exchange, is_futures=is_futures, is_inverse=is_inverse)} | "
                f"SkipCancel={locals().get('skip_cancel_all', False)} | Cancelled={has_cancelled_orders}"
            )

            safe_api_key_record = SimpleNamespace(
                id=api_key_record.id,
                exchange=api_key_record.exchange,
                api_key=api_key_record.api_key,
                secret_key=api_key_record.secret_key,
                passphrase=getattr(api_key_record, 'passphrase', None)
            )

            # Do not attach new TP/SL if we are force-executing an existing exit/TP/SL order or closing a position
            has_tp = bool(not is_closing_position and not is_exit_order and attached_tp and getattr(attached_tp, 'enabled', False))
            has_sl = bool(not is_closing_position and not is_exit_order and attached_sl and getattr(attached_sl, 'enabled', False))
            tp_cfg_dict = attached_tp.dict() if has_tp else None
            sl_cfg_dict = attached_sl.dict() if has_sl else None

            # 4A. Execute as Dynamic Smart Peg Maker (0% Maker Fee)
            if mode_lower in ('limit_maker', 'maker', 'smart_peg'):
                clean_sym = str(symbol).replace('/', '_').replace(':', '_')
                peg_cid = f"peg_{api_key_record.id}_{clean_sym}_{int(time.time())}"
                bal_unlocked = is_futures or (
                    (side_lower == 'sell' and _extract_bal(bal, base_part, 'free') >= target_amount * 0.999)
                    or (side_lower == 'buy' and _extract_bal(bal, quote_part, 'free') >= target_amount * ref_price * 0.998)
                )
                if not bal_unlocked and has_cancelled_orders:
                    # Drop stale pre-cancel RAM balance so execute_smart_peg_entry never clamps against old locked `free`
                    ManualTradeService.invalidate_wallet_balance_cache(api_key_id)
                # Reuse BBO already fetched in cancel_wave (avoid duplicate REST roundtrip if Redis was cold)
                fresh_ob = ob
                if not fresh_ob:
                    try:
                        latest_bbo = await _fetch_bbo_fast(exchange, symbol)
                        if latest_bbo and latest_bbo.get('bids') and latest_bbo.get('asks'):
                            fresh_ob = latest_bbo
                    except Exception:
                        pass
                asyncio.create_task(
                    execute_smart_peg_entry(
                        exchange=exchange,
                        symbol=symbol,
                        side=side_lower,
                        amount=target_amount,
                        is_futures=is_futures,
                        user_id=user_id,
                        api_key_record=safe_api_key_record,
                        tp_config=tp_cfg_dict,
                        sl_config=sl_cfg_dict,
                        max_chase_deviation_pct=10.0,
                        peg_id=peg_cid,
                        reduce_only=is_closing_position,
                        urgent_mode=True,
                        start_time=start_time or 0.0,
                        leverage=leverage if is_futures else None,
                        margin_mode=margin_mode if is_futures else None,
                        ai_filter_info=ai_filter_info,
                        contract_size=contract_size,
                        is_inverse=is_inverse,
                        send_initial_notify=True,
                        preloaded_ob=fresh_ob,
                        preloaded_balance=bal if bal_unlocked else None,
                        skip_exchange_upgrade=True,
                    )
                )

                ManualTradeService.invalidate_open_orders_cache(api_key_id, symbol)
                return {
                    "id": peg_cid,
                    "symbol": symbol,
                    "status": "pegging",
                    "side": side_lower,
                    "amount": target_amount,
                    "price": ref_price,
                    "execution_mode": "limit_maker",
                    "cleared_orders": cancelled_open_orders + stopped_chases + stopped_pegs + cancelled_brackets,
                    "message": f"⚡ Emergency Force {side.upper()} (0% Fee Maker Peg) active for {target_amount} {symbol}!"
                }

            # 4B. Execute as Instant Market Price Order
            ex_params = {}
            if is_futures:
                if is_closing_position:
                    ex_params = await bracket_order_service._apply_futures_exit_params(exchange, symbol, side_lower)
                else:
                    if await ManualTradeService._is_binance_hedge_mode(exchange, symbol, is_inverse=is_inverse):
                        ex_params['positionSide'] = 'LONG' if side_lower == 'buy' else 'SHORT'

            response = None
            if (
                getattr(exchange, 'has', {}).get('createOrderWs')
                and hasattr(exchange, 'create_order_ws')
                and is_ws_api_ready(exchange, is_futures=is_futures, is_inverse=is_inverse)
            ):
                try:
                    ws_type, ws_params = ManualTradeService._sanitize_ws_order_args(
                        exchange, 'market', ex_params, is_futures, is_edit=False
                    )
                    response = await exchange.create_order_ws(symbol, ws_type, side_lower, target_amount, None, ws_params)
                except Exception as ws_mkt_err:
                    logger.debug(f"Emergency market create_order_ws fallback to REST: {ws_mkt_err}")
                    response = None
            if response is None:
                response = await exchange.create_market_order(symbol, side_lower, target_amount, params=ex_params)
            exec_price = float((response or {}).get('average') or (response or {}).get('price') or ref_price)
            latency_ms = int((time.perf_counter() - start_time) * 1000) if start_time else 0

            if has_tp or has_sl:
                asyncio.create_task(
                    bracket_order_service.monitor_and_execute_bracket(
                        api_key_record=safe_api_key_record,
                        entry_order_id=(response or {}).get('id'),
                        symbol=symbol,
                        side=side_lower,
                        amount=target_amount,
                        is_futures=is_futures,
                        tp_config=tp_cfg_dict,
                        sl_config=sl_cfg_dict,
                        initial_entry_price=exec_price,
                        user_id=user_id
                    )
                )

            asyncio.create_task(
                _send_trade_fired_notification(
                    user_id=user_id,
                    exchange_name=api_key_record.exchange,
                    symbol=symbol,
                    side=side_lower,
                    order_type='EmergencyMarket',
                    amount=target_amount,
                    fill_price=exec_price,
                    latency_ms=latency_ms,
                    attached_tp=attached_tp if has_tp else None,
                    attached_sl=attached_sl if has_sl else None,
                    leverage=leverage if is_futures else None,
                    margin_mode=margin_mode if is_futures else None,
                    is_futures=is_futures,
                    contract_size=contract_size,
                    is_inverse=is_inverse,
                    ai_filter_info=ai_filter_info
                )
            )

            ManualTradeService.invalidate_open_orders_cache(api_key_id, symbol)
            return {
                "id": (response or {}).get('id'),
                "symbol": symbol,
                "status": (response or {}).get('status', 'closed'),
                "side": side_lower,
                "amount": target_amount,
                "price": exec_price,
                "execution_mode": "market",
                "cleared_orders": cancelled_open_orders + stopped_chases + stopped_pegs + cancelled_brackets,
                "message": f"🚨 Emergency Force {side.upper()} (Market) filled {target_amount} {symbol} @ {exec_price}!"
            }

        except HTTPException:
            raise
        except Exception as e:
            await _maybe_emit_api_health_alert(user_id, api_key_record.exchange, e)
            logger.error(f"Emergency force order error ({symbol}): {e}")
            raise HTTPException(status_code=400, detail=f"Emergency Force {side.upper()} Failed: {str(e)}")

    @staticmethod
    async def cancel_manual_order(
        db: Session,
        user_id: int,
        api_key_id: int,
        order_id: str,
        symbol: str
    ) -> dict:
        """
        Cancels a specific open order or active software bracket/peg/chase for the given symbol.
        """
        from app.services.manual_smart_chase_executor import stop_smart_chase, ACTIVE_SMART_CHASES
        from app.services.smart_peg_entry_executor import stop_smart_peg, ACTIVE_SMART_PEGS

        api_key_record = db.query(models.ApiKey).filter(
            models.ApiKey.id == api_key_id,
            models.ApiKey.user_id == user_id,
            models.ApiKey.is_enabled == True
        ).first()

        if not api_key_record:
            raise HTTPException(status_code=404, detail="API Key not found or inactive")

        is_futures = ':' in symbol
        specific_oid = str(order_id).strip()

        try:
            from app.services.user_order_stream import ensure_user_order_stream, publish_order_sync_event
            ensure_user_order_stream(user_id, api_key_record, is_futures, symbol)

            exchange = await ManualTradeService._get_exchange(api_key_record, is_futures, purpose="order")

            # 1. In-memory Smart Peg Check
            if specific_oid in ACTIVE_SMART_PEGS:
                ManualTradeService.invalidate_open_orders_cache(api_key_id, symbol)
                await stop_smart_peg(symbol=symbol, api_key_id=api_key_id, user_id=user_id, peg_id=specific_oid)
                asyncio.create_task(publish_order_sync_event(
                    user_id=user_id,
                    event="order_removed",
                    api_key_id=api_key_id,
                    symbol=symbol,
                    order_id=specific_oid,
                    order_ids=[specific_oid],
                    status="canceled",
                ))
                asyncio.create_task(_emit_manual_trade_in_app(
                    user_id=user_id,
                    title="Smart Peg Entry Cancelled",
                    message=f"Exchange: {api_key_record.exchange.capitalize()}\nPair: {symbol}\nOrder ID: {specific_oid}\nSmart Peg Entry stopped.",
                    event_type="order_cancelled",
                    severity="warning",
                    meta={"symbol": symbol, "order_id": specific_oid, "exchange": api_key_record.exchange, "order_type": "smart_peg"},
                ))
                return {
                    "success": True,
                    "order_id": specific_oid,
                    "cancelled_ids": [specific_oid],
                    "type": "smart_peg",
                    "message": f"Smart Peg Entry {specific_oid} stopped."
                }

            # 2. In-memory Smart Chase Check
            if specific_oid in ACTIVE_SMART_CHASES:
                ManualTradeService.invalidate_open_orders_cache(api_key_id, symbol)
                cdata = ACTIVE_SMART_CHASES.get(specific_oid) or {}
                tp_oid = cdata.get('tp_order_id')
                dis_oid = cdata.get('disaster_sl_order_id')
                tasks = [stop_smart_chase(symbol=symbol, api_key_id=api_key_id, user_id=user_id, chase_id=specific_oid)]
                cancelled_ids = [specific_oid]
                if tp_oid:
                    cancelled_ids.append(str(tp_oid))
                    tasks.append(bracket_order_service._cancel_futures_order_universal(exchange, str(tp_oid), symbol))
                if dis_oid:
                    cancelled_ids.append(str(dis_oid))
                    tasks.append(bracket_order_service._cancel_futures_order_universal(exchange, str(dis_oid), symbol))
                await asyncio.gather(*tasks, return_exceptions=True)
                asyncio.create_task(publish_order_sync_event(
                    user_id=user_id,
                    event="order_removed",
                    api_key_id=api_key_id,
                    symbol=symbol,
                    order_id=specific_oid,
                    order_ids=cancelled_ids,
                    status="canceled",
                ))
                asyncio.create_task(_emit_manual_trade_in_app(
                    user_id=user_id,
                    title="Smart Chase SL Cancelled",
                    message=f"Exchange: {api_key_record.exchange.capitalize()}\nPair: {symbol}\nOrder ID: {specific_oid}\nSmart Chase SL stopped.",
                    event_type="order_cancelled",
                    severity="warning",
                    meta={"symbol": symbol, "order_id": specific_oid, "exchange": api_key_record.exchange, "order_type": "smart_chase"},
                ))
                return {
                    "success": True,
                    "order_id": specific_oid,
                    "cancelled_ids": cancelled_ids,
                    "type": "smart_chase",
                    "message": f"Smart Chase SL {specific_oid} stopped."
                }

            # Collect all linked exchange order IDs & mark in-memory brackets cancelled immediately
            exchange_cancel_ids = {specific_oid}
            cancelled_ids = {specific_oid}

            # 3. Check Software SL Brackets
            for sl_id, sdata in list(bracket_order_service.ACTIVE_SOFTWARE_SL.items()):
                key_match = (sdata.get('api_key_id') is None or int(sdata.get('api_key_id')) == int(api_key_id))
                if not key_match:
                    continue
                if (
                    str(sl_id) == specific_oid
                    or str(sdata.get('tp_order_id') or '') == specific_oid
                    or str(sdata.get('disaster_sl_order_id') or '') == specific_oid
                    or str(sdata.get('entry_order_id') or '') == specific_oid
                ):
                    sdata['cancelled'] = True
                    try:
                        from app.services.manual_trade_persistence import schedule_mark_terminal
                        schedule_mark_terminal(str(sl_id), status='cancelled', reason='cancel_manual_order')
                    except Exception:
                        pass
                    cancelled_ids.add(str(sl_id))
                    for linked_key in ('tp_order_id', 'disaster_sl_order_id', 'entry_order_id'):
                        val = sdata.get(linked_key)
                        if val:
                            val_s = str(val)
                            cancelled_ids.add(val_s)
                            if linked_key in ('tp_order_id', 'disaster_sl_order_id'):
                                exchange_cancel_ids.add(val_s)

            # 4. Check Entry Brackets
            for eb_id, eb_data in list(bracket_order_service.ACTIVE_ENTRY_BRACKETS.items()):
                key_match = (eb_data.get('api_key_id') is None or int(eb_data.get('api_key_id')) == int(api_key_id))
                if not key_match:
                    continue
                if str(eb_id) == specific_oid or str(eb_data.get('tp_order_id') or '') == specific_oid:
                    eb_data['cancelled'] = True
                    cancelled_ids.add(str(eb_id))
                    tp_oid = eb_data.get('tp_order_id')
                    if tp_oid:
                        cancelled_ids.add(str(tp_oid))
                        exchange_cancel_ids.add(str(tp_oid))

            # 5. Check Entry Monitors
            if specific_oid in bracket_order_service.ACTIVE_ENTRY_MONITORS:
                bracket_order_service.ACTIVE_ENTRY_MONITORS[specific_oid]['cancelled'] = True
            try:
                from app.services.manual_trade_persistence import schedule_mark_terminal
                schedule_mark_terminal(specific_oid, status='cancelled', reason='cancel_manual_order')
            except Exception:
                pass

            # Invalidate cache before/during exchange calls so concurrent polls never serve stale data
            ManualTradeService.invalidate_open_orders_cache(api_key_id, symbol)

            # 6. Cancel order(s) on exchange concurrently (1 RTT instead of sequential loop)
            cancel_tasks = [
                bracket_order_service._cancel_futures_order_universal(exchange, oid_to_cancel, symbol)
                for oid_to_cancel in exchange_cancel_ids
            ]
            if cancel_tasks:
                await asyncio.gather(*cancel_tasks, return_exceptions=True)

            ManualTradeService.invalidate_open_orders_cache(api_key_id, symbol)
            cancelled_list = list(cancelled_ids)
            asyncio.create_task(publish_order_sync_event(
                user_id=user_id,
                event="order_removed",
                api_key_id=api_key_id,
                symbol=symbol,
                order_id=specific_oid,
                order_ids=cancelled_list,
                status="canceled",
            ))
            asyncio.create_task(_emit_manual_trade_in_app(
                user_id=user_id,
                title="Manual Order Cancelled",
                message=f"Exchange: {api_key_record.exchange.capitalize()}\nPair: {symbol}\nOrder ID: {specific_oid}\nOrder cancelled successfully.",
                event_type="order_cancelled",
                severity="warning",
                meta={"symbol": symbol, "order_id": specific_oid, "exchange": api_key_record.exchange},
            ))
            return {
                "success": True,
                "order_id": specific_oid,
                "cancelled_ids": cancelled_list,
                "symbol": symbol,
                "message": f"Order {specific_oid} cancelled successfully."
            }

        except HTTPException:
            raise
        except Exception as e:
            await _maybe_emit_api_health_alert(user_id, api_key_record.exchange, e)
            logger.error(f"Error cancelling order {specific_oid} ({symbol}): {e}")
            raise HTTPException(status_code=400, detail=f"Failed to cancel order: {str(e)}")

    @staticmethod
    async def cancel_all_manual_orders(
        db: Session,
        user_id: int,
        api_key_id: int,
        symbol: str
    ) -> dict:
        """
        Cancels ALL open limit orders and active software brackets/pegs/chases for the symbol.
        """
        from app.services.manual_smart_chase_executor import stop_smart_chase
        from app.services.smart_peg_entry_executor import stop_smart_peg

        api_key_record = db.query(models.ApiKey).filter(
            models.ApiKey.id == api_key_id,
            models.ApiKey.user_id == user_id,
            models.ApiKey.is_enabled == True
        ).first()

        if not api_key_record:
            raise HTTPException(status_code=404, detail="API Key not found or inactive")

        is_futures = ':' in symbol

        def _sym_matches(sa: str, sb: str) -> bool:
            s1 = str(sa or '').strip()
            s2 = str(sb or '').strip()
            if (':' in s1) != (':' in s2):
                return False
            return s1.split(':')[0].upper() == s2.split(':')[0].upper()

        try:
            from app.services.user_order_stream import ensure_user_order_stream, publish_order_sync_event
            ensure_user_order_stream(user_id, api_key_record, is_futures, symbol)

            exchange = await ManualTradeService._get_exchange(api_key_record, is_futures, purpose="order")

            # Immediately mark in-memory monitors & brackets cancelled and collect linked exchange IDs
            try:
                from app.services.manual_trade_persistence import schedule_mark_terminal_by_scope
                schedule_mark_terminal_by_scope(api_key_id, symbol, status='cancelled', reason='cancel_all_manual_orders')
            except Exception:
                pass
            for em_id, em_data in list(bracket_order_service.ACTIVE_ENTRY_MONITORS.items()):
                key_match = (em_data.get('api_key_id') is None or int(em_data.get('api_key_id')) == int(api_key_id))
                if key_match and _sym_matches(em_data.get('symbol', ''), symbol):
                    em_data['cancelled'] = True

            cancelled_brackets = 0
            exchange_cancel_ids = set()
            for sl_id, sdata in list(bracket_order_service.ACTIVE_SOFTWARE_SL.items()):
                key_match = (sdata.get('api_key_id') is None or int(sdata.get('api_key_id')) == int(api_key_id))
                if key_match and _sym_matches(sdata.get('symbol', ''), symbol) and not sdata.get('cancelled'):
                    sdata['cancelled'] = True
                    cancelled_brackets += 1
                    for linked_key in ('tp_order_id', 'disaster_sl_order_id'):
                        val = sdata.get(linked_key)
                        if val:
                            exchange_cancel_ids.add(str(val))

            for eb_id, eb_data in list(bracket_order_service.ACTIVE_ENTRY_BRACKETS.items()):
                key_match = (eb_data.get('api_key_id') is None or int(eb_data.get('api_key_id')) == int(api_key_id))
                if key_match and _sym_matches(eb_data.get('symbol', ''), symbol) and not eb_data.get('cancelled'):
                    eb_data['cancelled'] = True
                    tp_oid = eb_data.get('tp_order_id')
                    if tp_oid:
                        exchange_cancel_ids.add(str(tp_oid))

            ManualTradeService.invalidate_open_orders_cache(api_key_id, symbol)

            # 1-3. Run Smart Pegs, Smart Chases, bracket legs & exchange cancel_all concurrently
            async_tasks = [
                stop_smart_peg(symbol=symbol, api_key_id=api_key_id, user_id=user_id),
                stop_smart_chase(symbol=symbol, api_key_id=api_key_id, user_id=user_id),
            ]
            if hasattr(exchange, 'cancel_all_orders'):
                async_tasks.append(exchange.cancel_all_orders(symbol))
                if is_futures:
                    async_tasks.append(exchange.cancel_all_orders(symbol, params={'stop': True}))
            for oid_to_cancel in exchange_cancel_ids:
                async_tasks.append(
                    bracket_order_service._cancel_futures_order_universal(exchange, oid_to_cancel, symbol)
                )

            results = await asyncio.gather(*async_tasks, return_exceptions=True)
            stopped_pegs = results[0] if isinstance(results[0], int) else 0
            stopped_chases = results[1] if isinstance(results[1], int) else 0
            cancelled_open_orders = 1 if (len(results) > 2 and not isinstance(results[2], Exception)) else 0

            ManualTradeService.invalidate_open_orders_cache(api_key_id, symbol)
            total = cancelled_open_orders + stopped_pegs + stopped_chases + cancelled_brackets
            asyncio.create_task(publish_order_sync_event(
                user_id=user_id,
                event="orders_cleared",
                api_key_id=api_key_id,
                symbol=symbol,
                status="canceled",
            ))
            asyncio.create_task(_emit_manual_trade_in_app(
                user_id=user_id,
                title="All Manual Orders Cancelled",
                message=f"Exchange: {api_key_record.exchange.capitalize()}\nPair: {symbol}\nCleared Count: {total}\nAll open orders & brackets cancelled.",
                event_type="orders_cancelled_all",
                severity="warning",
                meta={"symbol": symbol, "exchange": api_key_record.exchange, "cleared_count": total},
            ))
            return {
                "success": True,
                "symbol": symbol,
                "cleared_count": total,
                "message": f"Successfully cancelled all open orders & brackets on {symbol}."
            }

        except HTTPException:
            raise
        except Exception as e:
            await _maybe_emit_api_health_alert(user_id, api_key_record.exchange, e)
            logger.error(f"Error cancelling all orders ({symbol}): {e}")
            raise HTTPException(status_code=400, detail=f"Failed to cancel all orders: {str(e)}")

    @staticmethod
    async def close_active_position(
        db: Session,
        user_id: int,
        api_key_id: int,
        symbol: str
    ) -> dict:
        """
        Immediately closes an active position (Market Flatten):
        - Futures: Cancels open bracket orders on the symbol and sends a Market reduceOnly order
          matching the exact open position size and opposite side.
        - Spot: Cancels open sell orders and market sells 100% of free base token balance back to quote.
        """
        from app.services.manual_smart_chase_executor import stop_smart_chase
        from app.services.smart_peg_entry_executor import stop_smart_peg

        api_key_record = db.query(models.ApiKey).filter(
            models.ApiKey.id == api_key_id,
            models.ApiKey.user_id == user_id,
            models.ApiKey.is_enabled == True
        ).first()

        if not api_key_record:
            raise HTTPException(status_code=404, detail="API Key not found or inactive")

        is_futures = ':' in symbol

        try:
            exchange = await ManualTradeService._get_exchange(api_key_record, is_futures, purpose="order")
            meta = ManualTradeService._get_contract_meta(exchange, symbol)
            is_inverse = meta["is_inverse"]
            contract_size = meta["contract_size"]
            ws_ready = is_ws_api_ready(exchange, is_futures=is_futures, is_inverse=is_inverse)

            def _sym_matches_close(sa: str, sb: str) -> bool:
                s1 = str(sa or '').strip()
                s2 = str(sb or '').strip()
                if (':' in s1) != (':' in s2):
                    return False
                return s1.split(':')[0].upper() == s2.split(':')[0].upper()

            try:
                from app.services.manual_trade_persistence import schedule_mark_terminal_by_scope
                schedule_mark_terminal_by_scope(api_key_id, symbol, status='completed', reason='close_active_position')
            except Exception:
                pass

            for em_id, em_data in list(bracket_order_service.ACTIVE_ENTRY_MONITORS.items()):
                key_match = (em_data.get('api_key_id') is None or int(em_data.get('api_key_id')) == int(api_key_id))
                if key_match and _sym_matches_close(em_data.get('symbol', ''), symbol):
                    em_data['cancelled'] = True

            bracket_cancel_ids = set()
            for sl_id, sdata in list(bracket_order_service.ACTIVE_SOFTWARE_SL.items()):
                if (sdata.get('api_key_id') is None or int(sdata.get('api_key_id')) == int(api_key_id)) and not sdata.get('cancelled'):
                    if _sym_matches_close(sdata.get('symbol', ''), symbol):
                        sdata['cancelled'] = True
                        for k_id in ('tp_order_id', 'disaster_sl_order_id'):
                            v_id = sdata.get(k_id)
                            if v_id:
                                bracket_cancel_ids.add(str(v_id))
            for eb_id, eb_data in list(bracket_order_service.ACTIVE_ENTRY_BRACKETS.items()):
                if (eb_data.get('api_key_id') is None or int(eb_data.get('api_key_id')) == int(api_key_id)) and not eb_data.get('cancelled'):
                    if _sym_matches_close(eb_data.get('symbol', ''), symbol):
                        eb_data['cancelled'] = True
                        if eb_data.get('tp_order_id'):
                            bracket_cancel_ids.add(str(eb_data.get('tp_order_id')))

            ManualTradeService.invalidate_open_orders_cache(api_key_id, symbol)

            if is_futures:
                # 1-2. Run Position check, Hedge mode check, Smart Chase/Peg stops, and ALL TP/SL cancels concurrently (1 RTT)
                cleanup_tasks = [
                    ManualTradeService.get_active_position(db, user_id, api_key_id, symbol),
                    ManualTradeService._is_binance_hedge_mode(exchange, symbol, is_inverse),
                    stop_smart_chase(symbol=symbol, api_key_id=api_key_id, user_id=user_id),
                    stop_smart_peg(symbol=symbol, api_key_id=api_key_id, user_id=user_id),
                ]
                for oid_to_cancel in bracket_cancel_ids:
                    cleanup_tasks.append(
                        bracket_order_service._cancel_futures_order_universal(exchange, oid_to_cancel, symbol)
                    )
                cleanup_res = await asyncio.gather(*cleanup_tasks, return_exceptions=True)

                pos_info = cleanup_res[0] if not isinstance(cleanup_res[0], Exception) else {}
                is_hedge = bool(cleanup_res[1]) if not isinstance(cleanup_res[1], Exception) else False

                pos_amt = float((pos_info or {}).get('amount') or 0.0)
                pos_side = str((pos_info or {}).get('side') or 'none').lower()
                pos_contracts = int((pos_info or {}).get('contracts') or 0)

                if pos_amt <= 0 or pos_side not in ('long', 'short'):
                    raise HTTPException(status_code=400, detail=f"No active position to close on {symbol}.")

                # 3. Determine market order params & execute via WS-API first (1 RTT)
                exit_side = 'sell' if pos_side == 'long' else 'buy'
                ex_params = {'reduceOnly': True}
                if is_hedge:
                    ex_params['positionSide'] = 'LONG' if pos_side == 'long' else 'SHORT'

                order_amount = pos_contracts if (is_inverse and pos_contracts > 0) else bracket_order_service._safe_amount_to_precision(exchange, symbol, pos_amt)

                logger.info(f"🚨 Quick Market Close Position for {symbol}: side={exit_side}, amount={order_amount}, params={ex_params}")
                res = None
                if (
                    getattr(exchange, 'has', {}).get('createOrderWs')
                    and hasattr(exchange, 'create_order_ws')
                    and ws_ready
                ):
                    try:
                        ws_type, ws_params = ManualTradeService._sanitize_ws_order_args(
                            exchange, 'market', ex_params, is_futures, is_edit=False
                        )
                        res = await exchange.create_order_ws(symbol, ws_type, exit_side, order_amount, None, ws_params)
                    except Exception as ws_cls_err:
                        logger.debug(f"Close position create_order_ws fallback to REST: {ws_cls_err}")
                        res = None
                if res is None:
                    res = await exchange.create_market_order(symbol, exit_side, order_amount, params=ex_params)

                # Send Telegram notification
                asyncio.create_task(
                    _send_trade_fired_notification(
                        user_id=user_id,
                        exchange_name=api_key_record.exchange,
                        symbol=symbol,
                        side=exit_side,
                        order_type='MarketClose',
                        amount=pos_amt,
                        is_futures=True,
                        contract_size=contract_size,
                        is_inverse=is_inverse
                    )
                )

                ManualTradeService.invalidate_open_orders_cache(api_key_id, symbol)
                return {
                    "success": True,
                    "symbol": symbol,
                    "side": exit_side,
                    "closed_amount": pos_amt,
                    "order_id": (res or {}).get('id'),
                    "message": f"Successfully closed {pos_side.upper()} position ({pos_amt} {symbol}) at Market price."
                }
            else:
                # Spot market position exit: concurrently stop pegs/chases/brackets + fetch initial balance
                base_part = meta.get('base')
                spot_tasks = [
                    ManualTradeService._fetch_wallet_balance(exchange, symbol, meta),
                    stop_smart_chase(symbol=symbol, api_key_id=api_key_id, user_id=user_id),
                    stop_smart_peg(symbol=symbol, api_key_id=api_key_id, user_id=user_id),
                ]
                for oid_to_cancel in bracket_cancel_ids:
                    spot_tasks.append(
                        bracket_order_service._cancel_futures_order_universal(exchange, oid_to_cancel, symbol)
                    )
                spot_res = await asyncio.gather(*spot_tasks, return_exceptions=True)

                bal = spot_res[0] if not isinstance(spot_res[0], Exception) else {}
                stopped_chases = spot_res[1] if isinstance(spot_res[1], int) else 0
                stopped_pegs = spot_res[2] if isinstance(spot_res[2], int) else 0
                base_free, base_used, _ = ManualTradeService._extract_asset_balance(bal, base_part)

                unlocked_any = bool(bracket_cancel_ids or stopped_chases or stopped_pegs)
                if base_used > 0:
                    try:
                        if hasattr(exchange, 'cancel_all_orders'):
                            await exchange.cancel_all_orders(symbol)
                            unlocked_any = True
                    except Exception:
                        pass
                if unlocked_any:
                    bal = await ManualTradeService._fetch_wallet_balance(exchange, symbol, meta)
                    base_free, base_used, _ = ManualTradeService._extract_asset_balance(bal, base_part)

                if base_free <= 0:
                    raise HTTPException(status_code=400, detail=f"No {base_part or 'base coin'} balance available to close on {symbol}.")

                safe_amt = bracket_order_service._safe_amount_to_precision(exchange, symbol, base_free)
                res = None
                if (
                    getattr(exchange, 'has', {}).get('createOrderWs')
                    and hasattr(exchange, 'create_order_ws')
                    and ws_ready
                ):
                    try:
                        ws_type, ws_params = ManualTradeService._sanitize_ws_order_args(
                            exchange, 'market', {}, is_futures, is_edit=False
                        )
                        res = await exchange.create_order_ws(symbol, ws_type, 'sell', safe_amt, None, ws_params)
                    except Exception as ws_spot_cls_err:
                        logger.debug(f"Spot close position create_order_ws fallback to REST: {ws_spot_cls_err}")
                        res = None
                if res is None:
                    res = await exchange.create_market_order(symbol, 'sell', safe_amt)

                ManualTradeService.invalidate_open_orders_cache(api_key_id, symbol)
                asyncio.create_task(
                    _emit_manual_trade_in_app(
                        user_id=user_id,
                        title="Spot Position Closed (Market)",
                        message=f"Exchange: {api_key_record.exchange.capitalize()}\nPair: {symbol}\nSide: SELL\nClosed Amount: {safe_amt} {meta.get('base') or ''}".strip(),
                        event_type="position_closed",
                        severity="info",
                        meta={"symbol": symbol, "exchange": api_key_record.exchange, "side": "sell", "amount": safe_amt, "order_id": (res or {}).get('id')},
                    )
                )
                return {
                    "success": True,
                    "symbol": symbol,
                    "side": "sell",
                    "closed_amount": safe_amt,
                    "order_id": (res or {}).get('id'),
                    "message": f"Successfully sold {safe_amt} {meta.get('base')} at Market price."
                }

        except HTTPException:
            raise
        except Exception as e:
            await _maybe_emit_api_health_alert(user_id, api_key_record.exchange, e)
            logger.error(f"Error closing position ({symbol}): {e}")
            raise HTTPException(status_code=400, detail=f"Failed to close position: {str(e)}")

manual_trade_service = ManualTradeService()
