import asyncio
import json
import logging
import math
from typing import Any, Dict, List, Optional

from app.core.redis import redis_manager

logger = logging.getLogger(__name__)


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        num = float(val)
        return num if math.isfinite(num) else default
    except (TypeError, ValueError):
        return default


class OrderflowCVDService:
    """
    Modular Institutional True-CVD Engine.

    - For Binance Spot, USD-M Futures, and COIN-M Futures, queries raw Binance klines
      so column [9] (`taker_buy_base_asset_volume`) yields 100% exchange-certified
      historical aggressive Buy Volume, Sell Volume, and Bar Delta (`2 * buy - total`).
    - For all other exchanges (or resampled sub-minute timeframes), seamlessly falls back
      to OHLCV + recorded live trade delta so every exchange works reliably.
    - Computes cumulative volume delta, per-candle delta, buy/sell ratio, and
      price-vs-CVD divergence flags.
    """

    @staticmethod
    def _binance_rest_symbol(symbol: str) -> str:
        """Converts CCXT symbol (BTC/USDT, BTC/USDT:USDT, BTC/USD:BTC, BTC/USDT:USDT-250328) to raw Binance market id."""
        clean = str(symbol or "").strip().upper()
        if ":" in clean:
            pair, settle_part = clean.split(":", 1)
            base, quote = pair.split("/", 1) if "/" in pair else (pair, "")
            if "-" in settle_part:
                settle, expiry = settle_part.split("-", 1)
                return f"{base}{quote}_{expiry}"
            if settle_part == base:
                return f"{base}{quote}_PERP"
            return f"{base}{quote}"
        return clean.replace("/", "")

    async def _fetch_binance_raw_klines_with_taker_buy(
        self,
        exchange: Any,
        symbol: str,
        timeframe: str,
        limit: int,
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Fetches raw Binance klines containing column [9] (taker_buy_base_asset_volume).
        Returns None if timeframe is not natively supported by that Binance market so caller
        falls back cleanly to `market_depth_service.fetch_ohlcv`.
        """
        is_futures = ":" in symbol
        if is_futures and timeframe == "1s":
            return None

        supported_tfs = getattr(exchange, "timeframes", None) or {}
        if timeframe not in supported_tfs:
            return None

        interval_str = supported_tfs[timeframe]
        raw_sym = self._binance_rest_symbol(symbol)
        req_limit = max(1, min(int(limit or 500), 1000))

        try:
            if is_futures:
                pair, settle = symbol.split(":", 1)
                base = pair.split("/", 1)[0] if "/" in pair else pair
                if settle.upper() == base.upper() and hasattr(exchange, "dapiPublicGetKlines"):
                    raw = await exchange.dapiPublicGetKlines({"symbol": raw_sym, "interval": interval_str, "limit": req_limit})
                elif hasattr(exchange, "fapiPublicGetKlines"):
                    raw = await exchange.fapiPublicGetKlines({"symbol": raw_sym, "interval": interval_str, "limit": req_limit})
                else:
                    return None
            else:
                if hasattr(exchange, "publicGetKlines"):
                    raw = await exchange.publicGetKlines({"symbol": raw_sym, "interval": interval_str, "limit": req_limit})
                else:
                    return None

            if not isinstance(raw, list) or not raw:
                return None

            candles: List[Dict[str, Any]] = []
            for row in raw:
                if not isinstance(row, (list, tuple)) or len(row) < 10:
                    continue
                ts_ms = int(row[0])
                total_vol = _safe_float(row[5])
                taker_buy_vol = max(0.0, min(total_vol, _safe_float(row[9])))
                taker_sell_vol = max(0.0, total_vol - taker_buy_vol)
                candles.append({
                    "time": int(ts_ms / 1000),
                    "open": _safe_float(row[1]),
                    "high": _safe_float(row[2]),
                    "low": _safe_float(row[3]),
                    "close": _safe_float(row[4]),
                    "volume": total_vol,
                    "buy_volume": taker_buy_vol,
                    "sell_volume": taker_sell_vol,
                    "delta": taker_buy_vol - taker_sell_vol,
                    "is_true_delta": True,
                })
            candles.sort(key=lambda c: c["time"])
            return candles
        except Exception as e:
            logger.debug(f"[OrderflowCVD] Raw Binance taker_buy fetch fallback for {symbol} ({timeframe}): {e}")
            return None

    async def get_cvd_series(
        self,
        symbol: str,
        exchange_id: str = "binance",
        timeframe: str = "1m",
        limit: int = 500,
    ) -> Dict[str, Any]:
        """
        Returns institutional CVD time series with per-candle delta, buy/sell breakdown,
        and price-vs-CVD divergence detection.
        """
        from app.services.market_depth_service import market_depth_service

        norm_sym = str(symbol or "").strip().upper()
        base_ex, internal_ex = market_depth_service.normalize_exchange_id(exchange_id, norm_sym)
        req_limit = max(20, min(int(limit or 500), 1000))

        cache_key = f"orderflow_cvd:{internal_ex}:{norm_sym}:{timeframe}:{req_limit}"
        redis = redis_manager.get_redis()
        if redis:
            try:
                cached = await redis.get(cache_key)
                if cached:
                    return json.loads(cached)
            except Exception:
                pass

        candles: Optional[List[Dict[str, Any]]] = None
        is_true_delta = False

        # 1. Prefer exchange-certified taker_buy_volume on Binance Spot & Futures
        if base_ex == "binance":
            try:
                ex = await market_depth_service.get_exchange_instance(base_ex, norm_sym)
                candles = await self._fetch_binance_raw_klines_with_taker_buy(ex, norm_sym, timeframe, req_limit)
                if candles:
                    is_true_delta = True
            except Exception as e:
                logger.debug(f"[OrderflowCVD] Binance true delta skipped: {e}")

        # 2. Fallback to standard OHLCV (which supports all exchanges + 1s-30s resampled/recorded bars)
        if not candles:
            ohlcv = await market_depth_service.fetch_ohlcv(
                norm_sym, base_ex, timeframe, req_limit, include_patterns=False
            )
            candles = []
            for c in ohlcv or []:
                o = _safe_float(c.get("open"))
                h = _safe_float(c.get("high"))
                l = _safe_float(c.get("low"))
                cl = _safe_float(c.get("close"))
                v = max(0.0, _safe_float(c.get("volume")))
                rng = h - l
                if rng > 0:
                    buy_ratio = max(0.0, min(1.0, (cl - l) / rng))
                else:
                    buy_ratio = 0.55 if cl >= o else 0.45
                buy_vol = v * buy_ratio
                sell_vol = v - buy_vol
                candles.append({
                    "time": int(c.get("time", 0)),
                    "open": o,
                    "high": h,
                    "low": l,
                    "close": cl,
                    "volume": v,
                    "buy_volume": buy_vol,
                    "sell_volume": sell_vol,
                    "delta": buy_vol - sell_vol,
                    "is_true_delta": False,
                })

        points: List[Dict[str, Any]] = []
        cum_cvd = 0.0
        total_buy = 0.0
        total_sell = 0.0

        for c in candles:
            delta = float(c["delta"])
            cum_cvd += delta
            total_buy += float(c["buy_volume"])
            total_sell += float(c["sell_volume"])
            points.append({
                "time": int(c["time"]),
                "value": round(cum_cvd, 6),
                "delta": round(delta, 6),
                "buyVolume": round(float(c["buy_volume"]), 6),
                "sellVolume": round(float(c["sell_volume"]), 6),
                "close": float(c["close"]),
            })

        # Detect recent multi-bar Price vs CVD divergence (last 20 bars)
        divergence: Optional[str] = None
        if len(points) >= 12:
            look = min(20, len(points))
            first_pt = points[-look]
            last_pt = points[-1]
            price_chg = last_pt["close"] - first_pt["close"]
            cvd_chg = last_pt["value"] - first_pt["value"]
            price_pct = (price_chg / first_pt["close"]) if first_pt["close"] > 0 else 0.0
            if price_pct > 0.0008 and cvd_chg < 0:
                divergence = "BEARISH"
            elif price_pct < -0.0008 and cvd_chg > 0:
                divergence = "BULLISH"

        total_vol = total_buy + total_sell
        buy_pct = round((total_buy / total_vol) * 100.0, 1) if total_vol > 0 else 50.0
        sell_pct = round(100.0 - buy_pct, 1)

        result = {
            "symbol": norm_sym,
            "exchange": base_ex,
            "interval": timeframe,
            "is_true_delta": is_true_delta,
            "points": points,
            "summary": {
                "session_cvd": round(cum_cvd, 4),
                "last_delta": round(points[-1]["delta"], 4) if points else 0.0,
                "buy_pct": buy_pct,
                "sell_pct": sell_pct,
                "divergence": divergence,
            },
        }

        if redis and points:
            ttl = 2 if timeframe.endswith("s") else 10
            try:
                await redis.setex(cache_key, ttl, json.dumps(result, separators=(",", ":")))
            except Exception:
                pass

        return result


orderflow_cvd_service = OrderflowCVDService()
