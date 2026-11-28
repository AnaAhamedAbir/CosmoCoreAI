"""
Modular Trading Fee Resolution Service.

Fetches live per-account, per-symbol Maker/Taker fee rates for Spot, USD-M Futures,
and COIN-M Inverse Futures via the hot Exchange Pool, with 10-minute in-memory caching
and deterministic multi-tier fallbacks so the SaaS UI always renders instant, accurate
fee estimates without adding order-execution latency.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# Fallback schedules (decimal ratios, e.g. 0.001 = 0.10%)
_EXCHANGE_DEFAULT_FEES: Dict[str, Dict[str, Tuple[float, float]]] = {
    "binance": {
        "spot": (0.0010, 0.0010),
        "usdm_futures": (0.0002, 0.0005),
        "coinm_futures": (0.0002, 0.0005),
    },
    "bybit": {
        "spot": (0.0010, 0.0010),
        "usdm_futures": (0.0002, 0.00055),
        "coinm_futures": (0.0002, 0.00055),
    },
    "okx": {
        "spot": (0.0008, 0.0010),
        "usdm_futures": (0.0002, 0.0005),
        "coinm_futures": (0.0002, 0.0005),
    },
    "bitget": {
        "spot": (0.0010, 0.0010),
        "usdm_futures": (0.0002, 0.0006),
        "coinm_futures": (0.0002, 0.0006),
    },
    "mexc": {
        "spot": (0.0000, 0.0005),
        "usdm_futures": (0.0000, 0.0002),
        "coinm_futures": (0.0000, 0.0002),
    },
    "kucoin": {
        "spot": (0.0010, 0.0010),
        "usdm_futures": (0.0002, 0.0006),
        "coinm_futures": (0.0002, 0.0006),
    },
}

_BINANCE_ZERO_MAKER_SPOT_QUOTES = {"FDUSD", "TUSD"}


def _normalize_exchange_family(exchange_id: Optional[str]) -> str:
    raw = (exchange_id or "binance").strip().lower()
    for family in ("binance", "bybit", "okx", "bitget", "mexc", "kucoin"):
        if raw.startswith(family):
            return family
    return raw or "binance"


def _parse_symbol_parts(symbol: str) -> Dict[str, Any]:
    sym = (symbol or "").strip().upper()
    is_futures = ":" in sym
    base = sym
    quote = "USDT"
    settle = "USDT"

    if "/" in sym:
        left, right = sym.split("/", 1)
        base = left
        if ":" in right:
            quote, settle = right.split(":", 1)
        else:
            quote = right
            settle = right

    is_inverse = bool(is_futures and settle and base and settle == base)
    market_type = (
        "coinm_futures"
        if is_inverse
        else ("usdm_futures" if is_futures else "spot")
    )
    return {
        "symbol": sym,
        "base": base,
        "quote": quote,
        "settle": settle,
        "is_futures": is_futures,
        "is_inverse": is_inverse,
        "market_type": market_type,
    }


def _safe_rate(val: Any) -> Optional[float]:
    if val is None:
        return None
    try:
        num = float(val)
        if 0.0 <= num <= 0.05:  # sanity bound: 0% to 5%
            return num
    except (TypeError, ValueError):
        return None
    return None


class TradingFeeService:
    """
    Cached trading fee resolver for Manual Trade & Bracket TP/SL Fee Estimator.
    """

    _FEE_CACHE: Dict[Tuple[int, str], Tuple[float, Dict[str, Any]]] = {}
    _BNB_BURN_CACHE: Dict[int, Tuple[float, Dict[str, Optional[bool]]]] = {}
    _CACHE_TTL_SECONDS: float = 600.0  # 10 minutes
    _MAX_CACHE_ENTRIES: int = 512

    @classmethod
    def invalidate_cache(cls, api_key_id: Optional[int] = None) -> None:
        if api_key_id is None:
            cls._FEE_CACHE.clear()
            cls._BNB_BURN_CACHE.clear()
            return
        for key in list(cls._FEE_CACHE.keys()):
            if key[0] == api_key_id:
                cls._FEE_CACHE.pop(key, None)
        cls._BNB_BURN_CACHE.pop(api_key_id, None)

    @classmethod
    def get_default_symbol_fees(
        cls,
        symbol: str,
        exchange_id: str = "binance",
    ) -> Dict[str, Any]:
        """Deterministic instant fee profile without touching external APIs."""
        parsed = _parse_symbol_parts(symbol)
        family = _normalize_exchange_family(exchange_id)
        market_type = parsed["market_type"]

        ex_table = _EXCHANGE_DEFAULT_FEES.get(family, _EXCHANGE_DEFAULT_FEES["binance"])
        maker_rate, taker_rate = ex_table.get(market_type, (0.0010, 0.0010))
        tier_label = f"{family.capitalize()} Standard"

        if (
            family == "binance"
            and market_type == "spot"
            and parsed["quote"] in _BINANCE_ZERO_MAKER_SPOT_QUOTES
        ):
            maker_rate = 0.0
            tier_label = f"Binance {parsed['quote']} 0% Maker"
        elif family == "binance" and market_type == "usdm_futures" and parsed["quote"] == "USDC":
            maker_rate = 0.0
            taker_rate = 0.0004
            tier_label = "Binance USDC Futures (0% Maker)"
        elif family == "binance" and market_type == "usdm_futures":
            tier_label = "Binance USD-M Standard"
        elif family == "binance" and market_type == "coinm_futures":
            tier_label = "Binance COIN-M Standard"

        bnb_discount_supported = family == "binance"
        bnb_discount_rate = (
            0.25
            if (bnb_discount_supported and market_type == "spot")
            else (0.10 if (bnb_discount_supported and market_type == "usdm_futures") else 0.0)
        )

        return {
            "symbol": parsed["symbol"],
            "exchange": family,
            "market_type": market_type,
            "is_futures": parsed["is_futures"],
            "is_inverse": parsed["is_inverse"],
            "base": parsed["base"],
            "quote": parsed["quote"],
            "settle": parsed["settle"],
            "maker_rate": float(maker_rate),
            "taker_rate": float(taker_rate),
            "bnb_discount_supported": bnb_discount_supported and bnb_discount_rate > 0,
            "bnb_discount_rate": float(bnb_discount_rate),
            "bnb_burn_active": None,
            "source": "estimated_default",
            "tier_label": tier_label,
            "cached": False,
            "updated_at": time.time(),
        }

    @classmethod
    async def _fetch_binance_bnb_burn_status(
        cls, exchange: Any, api_key_id: int, force_refresh: bool = False
    ) -> Dict[str, Optional[bool]]:
        now = time.time()
        if not force_refresh:
            cached = cls._BNB_BURN_CACHE.get(api_key_id)
            if cached and (now - cached[0]) < cls._CACHE_TTL_SECONDS:
                return cached[1]

        result: Dict[str, Optional[bool]] = {"spot": None, "futures": None}
        try:
            if hasattr(exchange, "sapi_get_bnb_burn"):
                resp = await exchange.sapi_get_bnb_burn()
            elif hasattr(exchange, "sapiGetBnbBurn"):
                resp = await exchange.sapiGetBnbBurn()
            else:
                resp = None

            if isinstance(resp, dict):
                if "spotBNBBurn" in resp:
                    result["spot"] = bool(resp.get("spotBNBBurn"))
                if "interestBNBBurn" in resp:
                    # Margin interest burn is separate; keep futures None unless explicitly known
                    pass
        except Exception as err:
            logger.debug(f"[FeeService] BNB burn lookup skipped (non-fatal): {err}")

        cls._BNB_BURN_CACHE[api_key_id] = (now, result)
        return result

    @classmethod
    async def _extract_live_exchange_rates(
        cls,
        exchange: Any,
        symbol: str,
        family: str,
        market_type: str,
    ) -> Tuple[Optional[float], Optional[float], str, str]:
        """
        Attempts to fetch live account-specific commission rates, then falls back
        to CCXT market metadata.
        Returns: (maker_rate, taker_rate, source, tier_label)
        """
        maker_rate: Optional[float] = None
        taker_rate: Optional[float] = None
        source = "estimated_default"
        tier_label = f"{family.capitalize()} Standard"

        market = None
        market_id = None
        try:
            if not getattr(exchange, "markets", None):
                await exchange.load_markets()
            if getattr(exchange, "markets", None) and symbol in exchange.markets:
                market = exchange.markets[symbol]
                market_id = market.get("id")
        except Exception as m_err:
            logger.debug(f"[FeeService] load_markets failed for {symbol}: {m_err}")

        # 1. Exchange-specific direct commission endpoints for Binance (most accurate & lowest overhead)
        if family == "binance" and market_id:
            try:
                if market_type == "spot":
                    raw_fn = getattr(exchange, "sapi_get_asset_tradefee", None) or getattr(
                        exchange, "sapiGetAssetTradeFee", None
                    )
                    if raw_fn:
                        resp = await raw_fn({"symbol": market_id})
                        item = resp[0] if isinstance(resp, list) and resp else (resp if isinstance(resp, dict) else None)
                        if isinstance(item, dict):
                            maker_rate = _safe_rate(item.get("makerCommission"))
                            taker_rate = _safe_rate(item.get("takerCommission"))
                            if maker_rate is not None and taker_rate is not None:
                                source = "live_api"
                                tier_label = (
                                    "Binance Spot Live (0% Maker)"
                                    if maker_rate == 0.0
                                    else "Binance Spot Live"
                                )
                elif market_type == "usdm_futures":
                    raw_fn = getattr(exchange, "fapiPrivateGetCommissionRate", None) or getattr(
                        exchange, "fapiPrivate_get_commissionrate", None
                    )
                    if raw_fn:
                        resp = await raw_fn({"symbol": market_id})
                        if isinstance(resp, dict):
                            maker_rate = _safe_rate(resp.get("makerCommissionRate"))
                            taker_rate = _safe_rate(resp.get("takerCommissionRate"))
                            if maker_rate is not None and taker_rate is not None:
                                source = "live_api"
                                tier_label = "Binance USD-M Live"
                elif market_type == "coinm_futures":
                    raw_fn = getattr(exchange, "dapiPrivateGetCommissionRate", None) or getattr(
                        exchange, "dapiPrivate_get_commissionrate", None
                    )
                    if raw_fn:
                        resp = await raw_fn({"symbol": market_id})
                        if isinstance(resp, dict):
                            maker_rate = _safe_rate(resp.get("makerCommissionRate"))
                            taker_rate = _safe_rate(resp.get("takerCommissionRate"))
                            if maker_rate is not None and taker_rate is not None:
                                source = "live_api"
                                tier_label = "Binance COIN-M Live"
            except Exception as direct_err:
                logger.debug(f"[FeeService] Direct Binance fee endpoint skipped for {symbol}: {direct_err}")

        # 2. Unified CCXT fetch_trading_fee(symbol) for non-Binance or if direct call didn't return
        if (maker_rate is None or taker_rate is None) and getattr(exchange, "has", {}).get("fetchTradingFee"):
            try:
                fee_resp = await exchange.fetch_trading_fee(symbol)
                if isinstance(fee_resp, dict):
                    m_val = _safe_rate(fee_resp.get("maker"))
                    t_val = _safe_rate(fee_resp.get("taker"))
                    if m_val is not None and t_val is not None:
                        maker_rate = m_val
                        taker_rate = t_val
                        source = "live_api"
                        tier_label = f"{family.capitalize()} Account Live"
            except Exception as ccxt_err:
                logger.debug(f"[FeeService] CCXT fetch_trading_fee skipped for {symbol}: {ccxt_err}")

        # 3. CCXT Market metadata fallback (exchange.markets[symbol])
        if (maker_rate is None or taker_rate is None) and isinstance(market, dict):
            m_val = _safe_rate(market.get("maker"))
            t_val = _safe_rate(market.get("taker"))
            if m_val is not None and t_val is not None:
                maker_rate = m_val
                taker_rate = t_val
                source = "market_meta"
                tier_label = f"{family.capitalize()} Market Tier"

        return maker_rate, taker_rate, source, tier_label

    @classmethod
    async def get_symbol_trading_fees(
        cls,
        db: Session,
        user_id: int,
        api_key_id: int,
        symbol: str,
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        """
        Resolves Maker/Taker fee rates for the user's connected API key & symbol.
        Uses 10-minute RAM cache for sub-millisecond repeat calls.
        """
        from app.services.manual_trade_service import ManualTradeService

        norm_symbol = (symbol or "").strip().upper()
        if not norm_symbol:
            raise HTTPException(status_code=400, detail="Symbol is required")

        cache_key = (int(api_key_id), norm_symbol)
        now = time.time()
        if not force_refresh:
            cached_entry = cls._FEE_CACHE.get(cache_key)
            if cached_entry and (now - cached_entry[0]) < cls._CACHE_TTL_SECONDS:
                return {**cached_entry[1], "cached": True}

        api_key_record = ManualTradeService._lookup_api_key_record(db, user_id, api_key_id)
        if not api_key_record:
            raise HTTPException(status_code=404, detail="API Key not found or inactive")

        family = _normalize_exchange_family(api_key_record.exchange)
        fallback = cls.get_default_symbol_fees(norm_symbol, family)
        is_futures = bool(fallback["is_futures"])

        try:
            exchange = await ManualTradeService._get_exchange(
                api_key_record, is_futures, purpose="general"
            )
            meta = ManualTradeService._get_contract_meta(exchange, norm_symbol)
            is_inverse = bool(meta.get("is_inverse"))
            market_type = (
                "coinm_futures"
                if is_inverse
                else ("usdm_futures" if is_futures else "spot")
            )

            maker_rate, taker_rate, source, tier_label = await cls._extract_live_exchange_rates(
                exchange=exchange,
                symbol=norm_symbol,
                family=family,
                market_type=market_type,
            )

            bnb_burn_active: Optional[bool] = None
            if family == "binance" and market_type == "spot":
                burn_map = await cls._fetch_binance_bnb_burn_status(
                    exchange, int(api_key_id), force_refresh=force_refresh
                )
                bnb_burn_active = burn_map.get("spot")

            # Respect Binance Spot zero-maker promotional quotes (e.g. FDUSD/TUSD) if generic metadata returned 0.1%
            if (
                family == "binance"
                and market_type == "spot"
                and meta["quote"].upper() in _BINANCE_ZERO_MAKER_SPOT_QUOTES
                and source != "live_api"
            ):
                maker_rate = 0.0
                tier_label = f"Binance {meta['quote'].upper()} 0% Maker"
            elif (
                family == "mexc"
                and market_type == "spot"
                and meta["quote"].upper() == "USDC"
                and source != "live_api"
            ):
                maker_rate = 0.0
                taker_rate = 0.0
                tier_label = "MEXC USDC 0% Fee"

            bnb_discount_rate = (
                0.25
                if (family == "binance" and market_type == "spot")
                else (0.10 if (family == "binance" and market_type == "usdm_futures") else 0.0)
            )

            result: Dict[str, Any] = {
                "symbol": norm_symbol,
                "exchange": family,
                "market_type": market_type,
                "is_futures": is_futures,
                "is_inverse": is_inverse,
                "base": meta["base"],
                "quote": meta["quote"],
                "settle": meta["settle"],
                "maker_rate": float(maker_rate if maker_rate is not None else fallback["maker_rate"]),
                "taker_rate": float(taker_rate if taker_rate is not None else fallback["taker_rate"]),
                "bnb_discount_supported": bnb_discount_rate > 0,
                "bnb_discount_rate": float(bnb_discount_rate),
                "bnb_burn_active": bnb_burn_active,
                "source": source if (maker_rate is not None and taker_rate is not None) else "estimated_default",
                "tier_label": tier_label if (maker_rate is not None and taker_rate is not None) else fallback["tier_label"],
                "cached": False,
                "updated_at": now,
            }
        except HTTPException:
            raise
        except Exception as err:
            logger.warning(
                f"[FeeService] Falling back to estimated fee profile for {family} {norm_symbol}: {err}"
            )
            result = fallback

        if len(cls._FEE_CACHE) >= cls._MAX_CACHE_ENTRIES:
            cls._FEE_CACHE.clear()
        cls._FEE_CACHE[cache_key] = (now, result)
        return result


trading_fee_service = TradingFeeService()
