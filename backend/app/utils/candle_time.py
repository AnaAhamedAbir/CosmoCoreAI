"""Calendar-aware candle bucket alignment and precision-safe timestamp utilities."""

from datetime import datetime, timezone
import re
from typing import Any

WEEK_SEC = 7 * 86400
# Unix epoch 0 (1970-01-01) was Thursday 00:00 UTC. Monday 00:00 UTC is +4 days.
MONDAY_OFFSET_SEC = 4 * 86400

_TF_RE = re.compile(r"^(\d+)([a-zA-Z]+)$")


def parse_timestamp_ms(raw_ts: Any) -> int:
    """
    Convert a raw timestamp (int/float seconds or milliseconds) to int milliseconds
    WITHOUT truncating fractional seconds first.
    """
    if raw_ts is None:
        return 0
    try:
        val = float(raw_ts)
    except (TypeError, ValueError):
        return 0
    if val <= 0:
        return 0
    if val < 10_000_000_000:
        return int(round(val * 1000.0))
    return int(round(val))


def timeframe_to_seconds(interval: str) -> int:
    """Case-sensitive interval string to seconds ('1M' = 30d, '1m' = 60s)."""
    raw = str(interval or "1m").strip()
    m = _TF_RE.match(raw)
    if not m:
        return 60
    value = max(1, int(m.group(1)))
    unit = m.group(2)
    if unit == "s":
        return value
    if unit == "m":
        return value * 60
    if unit in ("h", "H"):
        return value * 3600
    if unit in ("d", "D"):
        return value * 86400
    if unit in ("w", "W"):
        return value * WEEK_SEC
    if unit == "M":
        return value * 30 * 86400
    return value * 60


def align_candle_bucket_sec(ts_sec: float, interval: str) -> int:
    """
    Align a Unix timestamp (seconds or ms) to exchange-native candle bucket boundaries:
    - '1w': Monday 00:00 UTC
    - '1M': 1st of calendar month 00:00 UTC
    - other intervals: exact epoch modulo
    """
    if ts_sec <= 0:
        return 0
    sec = int(ts_sec // 1000) if ts_sec > 10_000_000_000 else int(ts_sec)

    raw = str(interval or "1m").strip()
    m = _TF_RE.match(raw)
    value = max(1, int(m.group(1))) if m else 1
    unit = m.group(2) if m else "m"

    if unit in ("w", "W"):
        span = value * WEEK_SEC
        return ((sec - MONDAY_OFFSET_SEC) // span) * span + MONDAY_OFFSET_SEC

    if unit == "M":
        dt = datetime.fromtimestamp(sec, tz=timezone.utc)
        aligned_month = ((dt.month - 1) // value) * value + 1
        aligned_dt = datetime(dt.year, aligned_month, 1, 0, 0, 0, tzinfo=timezone.utc)
        return int(aligned_dt.timestamp())

    step = timeframe_to_seconds(raw)
    return (sec // step) * step
