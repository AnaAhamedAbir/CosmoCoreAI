import json
import logging
import math
import time
from collections import OrderedDict
from typing import Any, Dict, List, Optional

from app.core.redis import redis_manager

logger = logging.getLogger(__name__)


def compute_adaptive_bucket_size(price: float) -> float:
    """
    Computes a clean, human-friendly orderbook heatmap price bucket (~0.08% of price)
    snapped to 1 / 2 / 2.5 / 5 * 10^n so BTC ($95k -> $50), ETH ($3k -> $2.5),
    SOL ($150 -> $0.10), DOGE ($0.15 -> $0.0001), PEPE ($0.00001 -> $0.00000001),
    and Forex EUR/USD ($1.085 -> $0.0005) all render crisp, legible heatmap bands.
    """
    if not price or not math.isfinite(price) or price <= 0:
        return 1.0
    target = price * 0.0008
    exp = math.floor(math.log10(target))
    base = 10.0 ** exp
    ratio = target / base
    if ratio < 1.4:
        step = 1.0 * base
    elif ratio < 2.2:
        step = 2.0 * base
    elif ratio < 3.5:
        step = 2.5 * base
    elif ratio < 7.0:
        step = 5.0 * base
    else:
        step = 10.0 * base
    return round(step, max(0, -exp + 2))


class L2HeatmapRecorder:
    """
    Modular In-Memory + Redis L2 Liquidity Heatmap History Recorder.

    - Consumes live 20Hz orderbook updates from `market_data_streamer` for ALL active
      exchanges/symbols (not just Binance).
    - Buckets resting Bids & Asks using `compute_adaptive_bucket_size(mid_price)` and
      records a compact snapshot every `RECORD_INTERVAL_SEC` (5s) up to 720 snapshots
      (1 hour) in memory and Redis Hash (`l2_heatmap_hist:{exchange}:{symbol}`).
    - Serves candle-aligned heatmap slices (`(ts // interval_sec) * interval_sec`) so
      Lightweight Charts `timeToCoordinate()` matches 100% of bars cleanly.
    """

    RECORD_INTERVAL_SEC: float = 5.0
    MAX_SNAPSHOTS: int = 720          # 720 * 5s = 1 hour of resting liquidity history
    REDIS_TTL_SECONDS: int = 7200     # 2 hours TTL
    MAX_LEVELS_PER_SIDE: int = 35
    PRUNE_INTERVAL_SEC: float = 60.0

    def __init__(self) -> None:
        # key = "{internal_ex}:{SYMBOL}" -> OrderedDict[ts_sec: int, snapshot_dict]
        self._history: Dict[str, "OrderedDict[int, Dict[str, Any]]"] = {}
        self._last_record_ts: Dict[str, float] = {}
        self._last_prune_ts: Dict[str, float] = {}
        self._hydrated: set[str] = set()

    @staticmethod
    def _make_key(exchange_id: str, symbol: str) -> str:
        return f"{str(exchange_id or '').strip().lower()}:{str(symbol or '').strip().upper()}"

    @staticmethod
    def _redis_key(key: str) -> str:
        return f"l2_heatmap_hist:{key}"

    @classmethod
    def aggregate_orderbook_levels(
        cls,
        bids: List[Dict[str, Any]],
        asks: List[Dict[str, Any]],
        bucket_size: Optional[float] = None,
    ) -> tuple[List[Dict[str, Any]], float, float]:
        """
        Groups raw [{"price": p, "size": s}, ...] bids/asks into price-adaptive buckets.
        Returns (levels, bucket_size, mid_price).
        """
        if not bids and not asks:
            return [], 1.0, 0.0

        best_bid = float(bids[0]["price"]) if bids else 0.0
        best_ask = float(asks[0]["price"]) if asks else 0.0
        mid_price = (best_bid + best_ask) / 2.0 if (best_bid > 0 and best_ask > 0) else max(best_bid, best_ask)
        if mid_price <= 0:
            return [], 1.0, 0.0

        b_size = float(bucket_size) if (bucket_size and bucket_size > 0) else compute_adaptive_bucket_size(mid_price)
        decimals = max(2, min(10, -math.floor(math.log10(b_size)) + 2)) if b_size < 1 else 4

        bid_buckets: Dict[float, float] = {}
        for b in bids:
            px = float(b.get("price") or 0.0)
            sz = float(b.get("size") or 0.0)
            if px <= 0 or sz <= 0:
                continue
            bp = round(math.floor((px / b_size) + 1e-9) * b_size, decimals)
            bid_buckets[bp] = bid_buckets.get(bp, 0.0) + sz

        ask_buckets: Dict[float, float] = {}
        for a in asks:
            px = float(a.get("price") or 0.0)
            sz = float(a.get("size") or 0.0)
            if px <= 0 or sz <= 0:
                continue
            ap = round(math.ceil((px / b_size) - 1e-9) * b_size, decimals)
            ask_buckets[ap] = ask_buckets.get(ap, 0.0) + sz

        levels: List[Dict[str, Any]] = []
        for p in sorted(bid_buckets.keys(), reverse=True)[: cls.MAX_LEVELS_PER_SIDE]:
            vol = bid_buckets[p]
            levels.append({
                "price": p,
                "volume": round(vol, 6),
                "notional": round(p * vol, 2),
                "type": "bid",
            })
        for p in sorted(ask_buckets.keys())[: cls.MAX_LEVELS_PER_SIDE]:
            vol = ask_buckets[p]
            levels.append({
                "price": p,
                "volume": round(vol, 6),
                "notional": round(p * vol, 2),
                "type": "ask",
            })

        return levels, b_size, mid_price

    async def record_orderbook(
        self,
        exchange_id: str,
        symbol: str,
        bids: List[Dict[str, Any]],
        asks: List[Dict[str, Any]],
    ) -> None:
        """Throttled 5s snapshot recording called from `market_data_streamer._stream_order_book`."""
        if not bids and not asks:
            return
        key = self._make_key(exchange_id, symbol)
        now = time.time()
        if (now - self._last_record_ts.get(key, 0.0)) < self.RECORD_INTERVAL_SEC:
            return
        self._last_record_ts[key] = now

        levels, b_size, mid_price = self.aggregate_orderbook_levels(bids, asks)
        if not levels:
            return

        ts_sec = int(now // self.RECORD_INTERVAL_SEC) * int(self.RECORD_INTERVAL_SEC)
        snapshot = {
            "time": ts_sec,
            "mid_price": mid_price,
            "bucket_size": b_size,
            "levels": levels,
        }

        series = self._history.setdefault(key, OrderedDict())
        series[ts_sec] = snapshot
        while len(series) > self.MAX_SNAPSHOTS:
            series.popitem(last=False)

        redis = redis_manager.get_redis()
        if not redis:
            return

        rkey = self._redis_key(key)
        try:
            async with redis.pipeline(transaction=False) as pipe:
                pipe.hset(rkey, str(ts_sec), json.dumps(snapshot, separators=(",", ":")))
                pipe.expire(rkey, self.REDIS_TTL_SECONDS)
                await pipe.execute()

            if (now - self._last_prune_ts.get(key, 0.0)) >= self.PRUNE_INTERVAL_SEC:
                self._last_prune_ts[key] = now
                cutoff = int(now) - int(self.MAX_SNAPSHOTS * self.RECORD_INTERVAL_SEC)
                fields = await redis.hkeys(rkey)
                stale = []
                for fld in fields or []:
                    f_str = fld.decode() if isinstance(fld, (bytes, bytearray)) else str(fld)
                    try:
                        if int(f_str) < cutoff:
                            stale.append(f_str)
                    except ValueError:
                        stale.append(f_str)
                if stale:
                    await redis.hdel(rkey, *stale)
        except Exception as e:
            logger.debug(f"[L2HeatmapRecorder] Redis persist err for {key}: {e}")

    async def get_aligned_history(
        self,
        exchange_id: str,
        symbol: str,
        interval: str = "1m",
        limit: int = 200,
    ) -> Dict[str, Any]:
        """
        Returns candle-interval-aligned L2 heatmap snapshots so every snapshot timestamp
        maps directly to an exact candlestick X-coordinate on the chart.
        """
        from app.services.market_depth_service import market_depth_service

        norm_sym = str(symbol or "").strip().upper()
        base_ex, internal_ex = market_depth_service.normalize_exchange_id(exchange_id, norm_sym)
        key = self._make_key(internal_ex, norm_sym)
        interval_sec = max(1, market_depth_service._timeframe_to_seconds(interval))

        # Hydrate once from Redis Hash (survives restarts)
        if key not in self._hydrated:
            self._hydrated.add(key)
            redis = redis_manager.get_redis()
            if redis:
                try:
                    raw_map = await redis.hgetall(self._redis_key(key))
                    if raw_map:
                        series = self._history.setdefault(key, OrderedDict())
                        for raw_k, raw_v in raw_map.items():
                            try:
                                ts_k = int(raw_k.decode() if isinstance(raw_k, (bytes, bytearray)) else str(raw_k))
                                if ts_k in series:
                                    continue
                                val_s = raw_v.decode() if isinstance(raw_v, (bytes, bytearray)) else str(raw_v)
                                parsed = json.loads(val_s)
                                if isinstance(parsed, dict) and parsed.get("levels"):
                                    series[ts_k] = parsed
                            except Exception:
                                continue
                        if series:
                            ordered = OrderedDict(sorted(series.items(), key=lambda kv: kv[0]))
                            while len(ordered) > self.MAX_SNAPSHOTS:
                                ordered.popitem(last=False)
                            self._history[key] = ordered
                except Exception as e:
                    logger.debug(f"[L2HeatmapRecorder] Redis hydrate err for {key}: {e}")

        series = self._history.get(key)
        raw_snaps: List[Dict[str, Any]] = list(series.values()) if series else []

        # If no recorded snapshots exist yet, synthesize 1 instant snapshot from latest Redis orderbook
        if not raw_snaps:
            redis = redis_manager.get_redis()
            if redis:
                try:
                    ob_sym = norm_sym.replace("/", "_") if base_ex == "oanda" else norm_sym
                    live_ob = await redis.get(f"latest_orderbook:{internal_ex}:{ob_sym}")
                    if live_ob:
                        ob_data = json.loads(live_ob)
                        levels, b_size, mid_price = self.aggregate_orderbook_levels(
                            ob_data.get("bids", []),
                            ob_data.get("asks", []),
                        )
                        if levels:
                            raw_snaps.append({
                                "time": int(time.time()),
                                "mid_price": mid_price,
                                "bucket_size": b_size,
                                "levels": levels,
                            })
                except Exception:
                    pass

        # Align snapshot timestamps onto exact candlestick open boundaries
        aligned_buckets: Dict[int, Dict[str, Any]] = {}
        latest_bucket_size = 0.0
        for snap in raw_snaps:
            ts = int(snap.get("time", 0))
            if ts <= 0:
                continue
            bar_time = (ts // interval_sec) * interval_sec
            b_sz = float(snap.get("bucket_size") or 0.0)
            if b_sz > 0:
                latest_bucket_size = b_sz
            aligned_buckets[bar_time] = {
                "time": bar_time,
                "bucket_size": b_sz,
                "mid_price": float(snap.get("mid_price") or 0.0),
                "levels": snap.get("levels", []),
            }

        ordered_snaps = [aligned_buckets[k] for k in sorted(aligned_buckets.keys())][-limit:]
        return {
            "symbol": norm_sym,
            "exchange": base_ex,
            "interval": interval,
            "bucket_size": latest_bucket_size,
            "snapshots": ordered_snaps,
        }


l2_heatmap_recorder = L2HeatmapRecorder()
