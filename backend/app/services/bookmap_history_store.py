import asyncio
import json
import logging
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.services.bookmap_heatmap_service import bookmap_heatmap_service

logger = logging.getLogger(__name__)


def _get_redis_client():
    """Safely fetches the shared async Redis client, returning None if Redis is unavailable."""
    try:
        from app.core.redis import redis_manager
        return redis_manager.get_redis()
    except Exception:
        return None


class BookmapHistoryStore:
    """
    Modular 2-Hour Persistent Bookmap Depth History Engine (Priority #2 Upgrade).

    Architecture:
    - Tier 1 (Live RAM Ring Buffer): 2s resolution for the most recent ~10 minutes (300 pts)
      for ultra-crisp 1m scalping without Redis round-trips.
    - Tier 2 (Persistent Redis ZSET): 10s resolution covering the full last 2 hours (720 pts),
      automatically pruned via ZREMRANGEBYSCORE and surviving page reloads, 5s idle stops,
      and backend restarts.
    - Tier 3 (PostgreSQL Fallback): If Redis is empty on cold start, opportunistically seeds
      from existing OrderBookSnapshot rows (60s resolution) off the event loop so the chart
      still hydrates historical liquidity walls immediately.
    """

    RETENTION_SEC = 7200  # 2 hours
    REDIS_TTL_SEC = 7800  # 2h 10m
    RAM_INTERVAL_SEC = 2.0
    PERSIST_INTERVAL_SEC = 10.0
    MAX_RAM_POINTS = 320
    MAX_ARCHIVE_POINTS = 760
    MIN_LEVEL_VOL_RATIO = 0.03  # Drop dust < 3% of snapshot max volume to keep Redis compact (~1 KB/snap)
    MAX_LEVELS_PER_SNAP = 64

    def __init__(self, symbol: str, exchange: str = "binance"):
        self.symbol = (symbol or "BTC/USDT").upper()
        self.exchange = (exchange or "binance").lower().strip()
        self._redis_key = f"godmode:bookmap:v1:{self.exchange}:{self.symbol}"

        # Tier 1: High-res recent RAM ring buffer (every 2s, ~10m)
        self._recent: deque = deque(maxlen=self.MAX_RAM_POINTS)
        # Tier 2: In-memory mirror of 2-hour archive (every 10s, ~120m)
        self._archive: deque = deque(maxlen=self.MAX_ARCHIVE_POINTS)

        self._last_ram_ts = 0.0
        self._last_persist_ts = 0.0
        self._last_hydrate_attempt_ts = 0.0
        self._hydrated = False
        self._hydrate_lock = asyncio.Lock()
        self._pending_tasks: set = set()

    @classmethod
    def compress_depth(cls, orderbook_depth: List[Dict[str, Any]]) -> List[Dict[str, float]]:
        """
        Compresses raw bucketed Bookmap depth levels by discarding invisible dust (<3% of peak)
        and capping to the strongest MAX_LEVELS_PER_SNAP price levels.
        """
        if not orderbook_depth:
            return []
        max_vol = 0.0
        parsed = []
        for d in orderbook_depth:
            try:
                p = float(d["price"])
                v = float(d["volume"])
            except (KeyError, TypeError, ValueError):
                continue
            if p > 0 and v > 0:
                if v > max_vol:
                    max_vol = v
                parsed.append((p, v))

        if max_vol <= 0 or not parsed:
            return []

        threshold = max_vol * cls.MIN_LEVEL_VOL_RATIO
        filtered = [(p, v) for p, v in parsed if v >= threshold]
        if len(filtered) > cls.MAX_LEVELS_PER_SNAP:
            filtered.sort(key=lambda x: x[1], reverse=True)
            filtered = filtered[: cls.MAX_LEVELS_PER_SNAP]
            filtered.sort(key=lambda x: x[0])

        return [{"price": round(p, 8), "volume": round(v, 4)} for p, v in filtered]

    @staticmethod
    def _encode_snapshot(ts_ms: int, depth: List[Dict[str, float]]) -> str:
        # Compact positional JSON saves ~55% Redis RAM vs repeated dict keys
        compact_levels = [[d["price"], d["volume"]] for d in depth]
        return json.dumps([ts_ms, compact_levels], separators=(",", ":"))

    @staticmethod
    def _decode_snapshot(raw: str) -> Optional[Dict[str, Any]]:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list) and len(parsed) == 2:
                ts_ms = int(parsed[0])
                levels = parsed[1]
                if ts_ms > 0 and isinstance(levels, list) and levels:
                    return {
                        "time": ts_ms,
                        "depth": [
                            {"price": float(lvl[0]), "volume": float(lvl[1])}
                            for lvl in levels
                            if isinstance(lvl, (list, tuple)) and len(lvl) >= 2
                        ],
                    }
            elif isinstance(parsed, dict) and parsed.get("time") and parsed.get("depth"):
                return {
                    "time": int(parsed["time"]),
                    "depth": [
                        {"price": float(d["price"]), "volume": float(d["volume"])}
                        for d in parsed["depth"]
                    ],
                }
        except Exception:
            return None
        return None

    def _prune_memory(self, now_ms: int) -> None:
        cutoff_ms = now_ms - (self.RETENTION_SEC * 1000)
        while self._archive and self._archive[0]["time"] < cutoff_ms:
            self._archive.popleft()
        recent_cutoff = now_ms - 660_000  # Keep ~11 minutes in high-res recent buffer
        while self._recent and self._recent[0]["time"] < recent_cutoff:
            self._recent.popleft()

    def record_snapshot(self, orderbook_depth: List[Dict[str, Any]], now_ts: Optional[float] = None) -> None:
        """
        Non-blocking hot-path recorder called from GodModeRunner._watch_orderbook_loop.
        Captures 2s RAM ticks and schedules 10s Redis persistence tasks cleanly.
        """
        if not orderbook_depth:
            return
        now = float(now_ts if now_ts is not None else time.time())
        if now - self._last_ram_ts < self.RAM_INTERVAL_SEC:
            return

        compact = self.compress_depth(orderbook_depth)
        if not compact:
            return

        ts_ms = int(now * 1000)
        snap = {"time": ts_ms, "depth": compact}
        self._last_ram_ts = now
        self._recent.append(snap)
        self._prune_memory(ts_ms)

        if now - self._last_persist_ts >= self.PERSIST_INTERVAL_SEC:
            self._last_persist_ts = now
            self._archive.append(snap)
            self._schedule_redis_write(ts_ms, compact)

    def _schedule_redis_write(self, ts_ms: int, depth: List[Dict[str, float]]) -> None:
        try:
            loop = asyncio.get_running_loop()
            task = loop.create_task(self._write_to_redis(ts_ms, depth))
            self._pending_tasks.add(task)
            task.add_done_callback(self._pending_tasks.discard)
        except RuntimeError:
            # No running event loop (e.g. synchronous unit test)
            pass

    async def _write_to_redis(self, ts_ms: int, depth: List[Dict[str, float]]) -> None:
        redis = _get_redis_client()
        if redis is None:
            return
        try:
            member = self._encode_snapshot(ts_ms, depth)
            cutoff_ms = ts_ms - (self.RETENTION_SEC * 1000)
            pipe = redis.pipeline(transaction=False)
            pipe.zadd(self._redis_key, {member: ts_ms})
            pipe.zremrangebyscore(self._redis_key, "-inf", cutoff_ms)
            pipe.expire(self._redis_key, self.REDIS_TTL_SEC)
            await pipe.execute()
        except Exception as e:
            logger.debug(f"BookmapHistoryStore Redis write skipped ({self._redis_key}): {e}")

    async def flush_latest(self) -> None:
        """Flushes the most recent RAM snapshot to Redis on graceful runner shutdown."""
        if self._recent:
            latest = self._recent[-1]
            await self._write_to_redis(latest["time"], latest["depth"])
        if self._pending_tasks:
            await asyncio.gather(*list(self._pending_tasks), return_exceptions=True)

    async def hydrate_from_persistence(self) -> int:
        """
        Loads up to 2 hours of persisted Bookmap depth history from Redis (with PostgreSQL
        OrderBookSnapshot fallback if Redis is empty). Safe, idempotent, cooldown-protected,
        and timeout-guarded. Returns number of hydrated archive points.
        """
        now_sec = time.time()
        if self._hydrated and (self._archive or (now_sec - self._last_hydrate_attempt_ts) < 30.0):
            return len(self._archive)

        async with self._hydrate_lock:
            now_sec = time.time()
            if self._hydrated and (self._archive or (now_sec - self._last_hydrate_attempt_ts) < 30.0):
                return len(self._archive)
            self._last_hydrate_attempt_ts = now_sec

            now_ms = int(time.time() * 1000)
            cutoff_ms = now_ms - (self.RETENTION_SEC * 1000)
            loaded: List[Dict[str, Any]] = []

            # 1. Try Redis ZSET first (fast path: <5ms)
            redis = _get_redis_client()
            if redis is not None:
                try:
                    raw_items = await asyncio.wait_for(
                        redis.zrangebyscore(self._redis_key, cutoff_ms, "+inf"),
                        timeout=1.2,
                    )
                    for item in raw_items or []:
                        decoded = self._decode_snapshot(item)
                        if decoded:
                            loaded.append(decoded)
                except Exception as e:
                    logger.debug(f"BookmapHistoryStore Redis hydrate skipped ({self._redis_key}): {e}")

            # 2. Fallback to PostgreSQL OrderBookSnapshot table if Redis had < 3 snapshots
            if len(loaded) < 3:
                db_snaps = await self._load_from_db_fallback(cutoff_ms)
                if db_snaps:
                    existing_ts = {s["time"] for s in loaded}
                    for s in db_snaps:
                        if s["time"] not in existing_ts:
                            loaded.append(s)
                    loaded.sort(key=lambda x: x["time"])

            if loaded:
                # Merge with any live snapshots that arrived while hydrating
                merged_by_ts = {s["time"]: s for s in loaded}
                for s in self._archive:
                    merged_by_ts[s["time"]] = s
                ordered = sorted(merged_by_ts.values(), key=lambda x: x["time"])[-self.MAX_ARCHIVE_POINTS :]
                self._archive.clear()
                self._archive.extend(ordered)
                self._last_persist_ts = max(self._last_persist_ts, ordered[-1]["time"] / 1000.0)

            self._hydrated = True
            return len(self._archive)

    async def _load_from_db_fallback(self, cutoff_ms: int) -> List[Dict[str, Any]]:
        """Opportunistically seeds 2-hour Bookmap history from OrderBookSnapshot DB rows."""
        try:
            from app.services.orderbook_snapshot_service import orderbook_snapshot_service

            end_dt = datetime.utcnow()
            start_dt = end_dt - timedelta(seconds=self.RETENTION_SEC)
            # Match either 'BTC/USDT' or 'BTC/USDT:USDT' cleanly
            base_sym = self.symbol.split(":")[0]
            rows = await asyncio.wait_for(
                orderbook_snapshot_service.get_historical_snapshots(
                    symbol=base_sym,
                    exchange=self.exchange,
                    start_time=start_dt,
                    end_time=end_dt,
                ),
                timeout=1.5,
            )
            if not rows:
                return []

            out: List[Dict[str, Any]] = []
            for row in rows:
                bids_raw = row.get("bids") or []
                asks_raw = row.get("asks") or []
                if not bids_raw or not asks_raw:
                    continue
                bids = self._normalize_ob_levels(bids_raw)
                asks = self._normalize_ob_levels(asks_raw)
                if not bids or not asks:
                    continue
                cp = (bids[0][0] + asks[0][0]) / 2.0
                if cp <= 0:
                    continue
                depth = bookmap_heatmap_service.process_orderbook(bids, asks, cp)
                compact = self.compress_depth(depth)
                if not compact:
                    continue
                ts_str = row.get("timestamp")
                try:
                    dt = datetime.fromisoformat(str(ts_str).replace("Z", "+00:00"))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    ts_ms = int(dt.timestamp() * 1000)
                except Exception:
                    continue
                if ts_ms >= cutoff_ms:
                    out.append({"time": ts_ms, "depth": compact})
            return out
        except Exception as e:
            logger.debug(f"BookmapHistoryStore DB fallback skipped ({self.symbol}): {e}")
            return []

    @staticmethod
    def _normalize_ob_levels(levels: List[Any]) -> List[List[float]]:
        out: List[List[float]] = []
        for item in levels:
            try:
                if isinstance(item, dict):
                    p = float(item.get("price", 0))
                    s = float(item.get("size", item.get("volume", 0)))
                else:
                    p = float(item[0])
                    s = float(item[1])
                if p > 0 and s > 0:
                    out.append([p, s])
            except (IndexError, TypeError, ValueError):
                continue
        return out

    def get_hydrated_history(
        self,
        window_minutes: int = 120,
        max_points: int = 420,
    ) -> List[Dict[str, Any]]:
        """
        Returns a cleanly merged, chronologically sorted Bookmap history covering up to
        `window_minutes` (max 120m = 2 hours), preserving full 2s density for the recent
        10 minutes while smoothly downsampling older archive points to keep payload fast.
        """
        safe_window_min = max(5, min(120, int(window_minutes or 120)))
        now_ms = int(time.time() * 1000)
        cutoff_ms = now_ms - (safe_window_min * 60 * 1000)
        recent_split_ms = now_ms - (10 * 60 * 1000)

        merged_by_ts: Dict[int, Dict[str, Any]] = {}
        for snap in self._archive:
            t = int(snap["time"])
            if t >= cutoff_ms:
                merged_by_ts[t] = snap
        for snap in self._recent:
            t = int(snap["time"])
            if t >= cutoff_ms:
                merged_by_ts[t] = snap

        if not merged_by_ts:
            return []

        ordered = [merged_by_ts[t] for t in sorted(merged_by_ts.keys())]
        if len(ordered) <= max_points:
            return ordered

        # Split into older history (>10m ago) and crisp recent live tail (<=10m ago)
        older = [s for s in ordered if s["time"] < recent_split_ms]
        recent = [s for s in ordered if s["time"] >= recent_split_ms]

        recent_budget = min(len(recent), max(120, int(max_points * 0.45)))
        older_budget = max(40, max_points - recent_budget)

        sampled_older = self._uniform_downsample(older, older_budget)
        sampled_recent = self._uniform_downsample(recent, recent_budget)
        return sampled_older + sampled_recent

    @staticmethod
    def _uniform_downsample(items: List[Dict[str, Any]], target_count: int) -> List[Dict[str, Any]]:
        n = len(items)
        if n <= target_count or target_count <= 0:
            return items
        if target_count == 1:
            return [items[-1]]
        step = (n - 1) / float(target_count - 1)
        out: List[Dict[str, Any]] = []
        last_idx = -1
        for k in range(target_count):
            idx = min(n - 1, int(round(k * step)))
            if idx != last_idx:
                out.append(items[idx])
                last_idx = idx
        return out

    def get_coverage_minutes(self) -> float:
        """Returns how many minutes of Bookmap history are currently available."""
        earliest_ts = None
        if self._archive:
            earliest_ts = self._archive[0]["time"]
        if self._recent:
            r0 = self._recent[0]["time"]
            earliest_ts = r0 if earliest_ts is None else min(earliest_ts, r0)
        if earliest_ts is None:
            return 0.0
        latest_ts = self._recent[-1]["time"] if self._recent else self._archive[-1]["time"]
        return round(max(0.0, (latest_ts - earliest_ts) / 60_000.0), 1)
