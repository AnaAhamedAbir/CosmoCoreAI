"""
Docker Log Monitor Service
===========================
A background service that continuously scans all Docker container logs
for ERROR, CRITICAL, EXCEPTION, and TRACEBACK patterns.

WARNINGs are intentionally suppressed from the system monitor and Telegram
alerts because they are mostly harmless operational noise (retries, successful
news fetches logged at WARNING level, rate-limit pauses that resolve on their
own, etc.).  Only genuine errors that need human intervention are surfaced.

When a real problem is detected, it:
1. Deduplicates using Redis (5-minute cooldown per unique error)
2. Sends a beautifully formatted Telegram alert to ALL users
   who have notifications enabled in their settings

Architecture:
  Celery Task (every 60s) → fetch last 60s of logs from each container
                           → regex pattern match  (WARNING suppressed)
                           → Redis dedup check
                           → Telegram notify (ERROR / CRITICAL only)
"""

import os
import re
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_docker_unavailable_logged = False


def is_docker_daemon_configured() -> bool:
    """Return True if DOCKER_HOST is set or the local Docker socket is mounted."""
    if os.environ.get("DOCKER_HOST"):
        return True
    return os.path.exists("/var/run/docker.sock")


def _log_docker_unavailable_once() -> None:
    global _docker_unavailable_logged
    if not _docker_unavailable_logged:
        _docker_unavailable_logged = True
        logger.info(
            "[LogMonitor] Docker socket is not mounted and DOCKER_HOST is not set; "
            "skipping Docker container log monitoring/streaming."
        )

# ============================================================
# PATTERN DEFINITIONS
# ============================================================

# Patterns that indicate a CRITICAL error (red alert 🔴)
CRITICAL_PATTERNS = [
    re.compile(r'\bCRITICAL\b', re.IGNORECASE),
    re.compile(r'\bFATAL\b', re.IGNORECASE),
    re.compile(r'\bPANIC\b'),
    re.compile(r'Traceback \(most recent call last\)', re.IGNORECASE),
    re.compile(r'\bSystemExit\b', re.IGNORECASE),
    re.compile(r'\bSegmentation fault\b', re.IGNORECASE),
    re.compile(r'\bMemoryError\b'),
    re.compile(r'\bOOM\b'),  # Out of Memory
    re.compile(r'Out of memory', re.IGNORECASE),
    re.compile(r'killed by signal', re.IGNORECASE),
    re.compile(r'Exception in ASGI application', re.IGNORECASE),
    re.compile(r'Task exception was never retrieved', re.IGNORECASE),
    re.compile(r'Unhandled exception', re.IGNORECASE),
]

# Patterns that indicate an ERROR (orange alert 🟠)
ERROR_PATTERNS = [
    re.compile(r'\bERROR\b'),  # Case-sensitive to avoid matching variables like `error`
    re.compile(r'\[error\]', re.IGNORECASE),  # Nginx / gunicorn bracketed error level
    re.compile(r'\bException\b'),
    re.compile(r'\b[A-Za-z_]*Error(?::|\s|$)'),  # Matches ValueError:, TypeError:, RuntimeError:, Error: ...
    re.compile(r'sqlalchemy\.exc\.', re.IGNORECASE),
    re.compile(r'ConnectionRefusedError', re.IGNORECASE),
    re.compile(r'OperationalError', re.IGNORECASE),
    re.compile(r'IntegrityError', re.IGNORECASE),
    re.compile(r'ProgrammingError', re.IGNORECASE),
    re.compile(r'InterfaceError', re.IGNORECASE),
    re.compile(r'DataError', re.IGNORECASE),
    re.compile(r'DeadlockDetected', re.IGNORECASE),
    re.compile(r'UndefinedColumn', re.IGNORECASE),
    re.compile(r'500 Internal Server Error', re.IGNORECASE),
    re.compile(r'502 Bad Gateway', re.IGNORECASE),
    re.compile(r'503 Service Unavailable', re.IGNORECASE),
    re.compile(r'504 Gateway Timeout', re.IGNORECASE),
    re.compile(r'\bHTTP 5\d{2}\b'),  # Any 5xx error
    re.compile(r'HTTP/\d\.\d"\s+5\d{2}\b'),  # Uvicorn / Nginx access log 5xx (no trailing space needed)
    re.compile(r'celery\.exceptions', re.IGNORECASE),
    re.compile(r'Worker exited', re.IGNORECASE),
    re.compile(r'WorkerLostError', re.IGNORECASE),
    re.compile(r'Connection refused', re.IGNORECASE),
    re.compile(r'\bFailed\b', re.IGNORECASE),
    re.compile(r'API Error', re.IGNORECASE),
    re.compile(r'❌'),
]

# Patterns that indicate a WARNING (yellow alert 🟡)
# NOTE: WARNINGs are classified internally for colour-coding in the live log
# terminal, but they are NOT sent to Telegram and NOT published to the
# system-monitor alert widget.  Only ERROR / CRITICAL go there.
WARNING_PATTERNS = [
    re.compile(r'\bWARNING\b', re.IGNORECASE),
    re.compile(r'\bWARN\b'),
    re.compile(r'\bDeprecation\b', re.IGNORECASE),
    re.compile(r'\bRetrying\b', re.IGNORECASE),
    re.compile(r'\bTimeout\b', re.IGNORECASE),
    re.compile(r'\bretry\b', re.IGNORECASE),
    re.compile(r'rate.?limit', re.IGNORECASE),
    re.compile(r'\bSlow query\b', re.IGNORECASE),
    re.compile(r'404 Not Found', re.IGNORECASE),
    re.compile(r'403 Forbidden', re.IGNORECASE),
    re.compile(r'401 Unauthorized', re.IGNORECASE),
    re.compile(r'\bHTTP 4\d{2}\b'), # Any 4xx error (as warning)
]

# ── Harmless WARNING-level noise to demote to INFO ──────────────────────────
# These are messages that Python/Celery logs at WARNING level but are actually
# successful or routine operations — they must NOT appear in the system monitor
# or trigger Telegram alerts.
NOISE_WARNING_PATTERNS = [
    # Successful market data / news fetches reported at WARNING by some tasks.
    # ⚠ Bug #6 fix: patterns were too broad — "Fetch Completed" / "executed successfully"
    # could silently suppress real error messages that happened to contain those words.
    # Now anchored to specific known-benign prefixes only.
    re.compile(r'Market(?:\s+News)?\s+Fetch\s+Completed', re.IGNORECASE),
    re.compile(r'News\s+fetch\s+executed\s+successfully', re.IGNORECASE),
    re.compile(r'\bFetch\s+Completed\.?\s*\d*\s*new\s+items', re.IGNORECASE),  # "Fetch Completed. N new items."
    re.compile(r'items fetched', re.IGNORECASE),
    # Celery task success noise
    re.compile(r'Task succeeded in', re.IGNORECASE),
    re.compile(r'new items\.?\s*$', re.IGNORECASE),   # "3 new items."
    # Routine rate-limit pauses that self-heal
    re.compile(r'sleeping for \d+ second', re.IGNORECASE),
    re.compile(r'backing off', re.IGNORECASE),
    # Scheduled-task heartbeat noise
    re.compile(r'beat: Waking up', re.IGNORECASE),
    re.compile(r'Scheduler: Sending due task', re.IGNORECASE),
]

# Lines to IGNORE (avoid spam from known-harmless patterns)
IGNORE_PATTERNS = [
    # ── Benign Exchange Errors (Race conditions during exit) ──────────────────
    re.compile(r'ReduceOnly Order is rejected', re.IGNORECASE),
    re.compile(r'SL Limit Maker order rejected', re.IGNORECASE),
    # ── Benign Exchange Maker Rejections & OTOCO Fallbacks (Self-healing) ────
    re.compile(r'Order would immediately match and take', re.IGNORECASE),
    re.compile(r'spread crossed / -5022', re.IGNORECASE),
    re.compile(r'postOnly.*rejected.*spread crossed', re.IGNORECASE),
    re.compile(r'Maker retry:', re.IGNORECASE),
    re.compile(r'\[Native OTOCO\].*Falling back to standard entry', re.IGNORECASE),
    re.compile(r'\[Native OTOCO\].*Failed', re.IGNORECASE),
    re.compile(r'\[Native OTOCO\].*Fallback', re.IGNORECASE),
    # ── Benign Exchange Order Placement Rejections (Manual Trade / CCXT) ────
    re.compile(r'manual_trade_service\.py.*create_limit_order', re.IGNORECASE),
    re.compile(r'manual_trade_service\.py.*create_market_order', re.IGNORECASE),
    re.compile(r'manual_trade_service\.py.*place_manual_trade', re.IGNORECASE),
    re.compile(r'Order placement failed:', re.IGNORECASE),
    re.compile(r'Manual order rejected by exchange', re.IGNORECASE),
    re.compile(r'Manual trade rejected by exchange', re.IGNORECASE),
    re.compile(r'Order edit rejected by exchange', re.IGNORECASE),
    re.compile(r'Due to the order could not be executed as maker', re.IGNORECASE),
    re.compile(r'Account has insufficient balance', re.IGNORECASE),
    re.compile(r'insufficient margin', re.IGNORECASE),
    re.compile(r'Filter failure: MIN_NOTIONAL', re.IGNORECASE),
    re.compile(r'Filter failure: LOT_SIZE', re.IGNORECASE),
    re.compile(r'Filter failure: PRICE_FILTER', re.IGNORECASE),
    re.compile(r'GET /api/v1/health', re.IGNORECASE),
    re.compile(r'HTTP/\d\.\d"\s+200\b'),
    re.compile(r'^\s*$'),
    # ── Gym Deprecation / NumPy 2.0 Warning ───────────────────────────────
    re.compile(r'Gym has been unmaintained since 2022', re.IGNORECASE),
    re.compile(r'Please upgrade to Gymnasium', re.IGNORECASE),
    re.compile(r'Users of this version of Gym should be able to', re.IGNORECASE),
    re.compile(r'See the migration guide at https://gymnasium', re.IGNORECASE),
    re.compile(r'Celery beat v'),  # startup messages
    re.compile(r'ready\. Loaded'),
    re.compile(r'mingle: searching'),
    re.compile(r'mingle: all alone'),
    re.compile(r'celery@.* ready'),
    re.compile(r'Scheduler: Sending due task'),
    re.compile(r'Task .* succeeded'),
    re.compile(r'Task .* received'),
    re.compile(r'\[LogMonitor\]'),   # prevent infinite loops from our own logging!
    re.compile(r'Listening to System Alert Stream', re.IGNORECASE),  # benign startup banner in main.py
    # ── Telegram / notification failures ─────────────────────────────────────
    # These are WARNING-level in notification.py, not real server errors.
    # Without these, a Telegram timeout creates an alert → which logs → which
    # creates another alert → infinite loop.
    re.compile(r'\[TelegramNotify\]', re.IGNORECASE),
    re.compile(r'api\.telegram\.org', re.IGNORECASE),
    re.compile(r'Timed out sending to user', re.IGNORECASE),
    re.compile(r'Network error for user', re.IGNORECASE),
    re.compile(r'Failed to send notification to user', re.IGNORECASE),
    # ── Proxy connection issues (benign/transient/startup) ───────────────────
    re.compile(r'ended by the other party', re.IGNORECASE),
    re.compile(r'writeAfterFIN', re.IGNORECASE),
    # ── PostgreSQL / TimescaleDB controlled shutdown ──────────────────────────
    # These appear whenever the DB container is restarted via docker-compose
    # (docker stop / restart / down). They are NOT crashes — "administrator
    # command" means Postgres received a SIGTERM from Docker and shut down
    # gracefully.  The container auto-restarts via restart: always, so no
    # action is required and these must never trigger a Telegram alert.
    re.compile(r'due to administrator command', re.IGNORECASE),
    re.compile(r'terminating background worker.*TimescaleDB', re.IGNORECASE),
    re.compile(r'background worker.*exited with exit code 1', re.IGNORECASE),
    re.compile(r'logical replication launcher.*exited', re.IGNORECASE),
    re.compile(r'TimescaleDB Background Worker', re.IGNORECASE),
    re.compile(r'database system is shut down', re.IGNORECASE),
    re.compile(r'received fast shutdown request', re.IGNORECASE),
    re.compile(r'aborting any active transactions', re.IGNORECASE),
    # ⚠ Bug #4 fix: bare r'shutting down' was dangerously broad — it would silence
    # real critical alerts like "Service shutting down due to OOM" or
    # "Worker shutting down unexpectedly".  Replaced with PostgreSQL-specific
    # patterns that only match known-safe controlled-shutdown log lines.
    re.compile(r'database system is shutting down', re.IGNORECASE),
    re.compile(r'PostgreSQL.*shutting down', re.IGNORECASE),
    # ── PostgreSQL WAL crash-recovery (self-healing, no action needed) ────────
    # These 5 lines appear together whenever Postgres recovers from an unclean
    # shutdown (e.g. host reboot, OOM kill, docker kill).  PostgreSQL handles
    # this automatically via WAL replay — "redo done" confirms success.
    # The FATAL line is transient: another process tried to connect while the
    # DB was mid-recovery.  All of these are safe to ignore completely.
    re.compile(r'the database system is starting up', re.IGNORECASE),
    re.compile(r'database system was not properly shut down', re.IGNORECASE),
    re.compile(r'automatic recovery in progress', re.IGNORECASE),
    re.compile(r'redo starts at', re.IGNORECASE),
    re.compile(r'redo done at', re.IGNORECASE),
    re.compile(r'invalid record length at.*expected at least.*got 0', re.IGNORECASE),
    # ── Frontend / Node.js Dev Server Noise (EPIPE / Broken Pipe / HMR WS) ──
    # These happen when a browser tab is closed, refreshed, or has a network
    # hiccup. The Vite dev server recovers automatically — no action needed.
    re.compile(r'Error: write EPIPE', re.IGNORECASE),
    re.compile(r'Error: read ECONNRESET', re.IGNORECASE),
    re.compile(r'Broken pipe', re.IGNORECASE),
    re.compile(r'node:internal/stream_base_commons', re.IGNORECASE),
    re.compile(r'\[vite\].*ws proxy.*error', re.IGNORECASE),   # Vite HMR WebSocket disconnect
    re.compile(r'ws proxy socket error', re.IGNORECASE),
    re.compile(r'TCP\.onStreamRead', re.IGNORECASE),
    # ── Gemini API / Fallback Noise ──────────────────────────────────────────
    # These are handled gracefully by the fallback system
    re.compile(r'Quota\s+error:.*?trying\s+next', re.IGNORECASE),
    re.compile(r'Gemini\s+success:', re.IGNORECASE),
    re.compile(r'Failed to parse JSON:.*using heuristics', re.IGNORECASE),
    re.compile(r'AI JSON Parse issue', re.IGNORECASE),
    re.compile(r'Invalid control character at: line \d+ column \d+', re.IGNORECASE),
    # ── asyncio / aiohttp graceful-shutdown artifacts ─────────────────────────
    # These two messages appear ONLY when the uvicorn process is shutting down
    # (SIGTERM from Docker).  They are produced by Python's asyncio finalizer
    # warning that open aiohttp sessions/connectors were garbage-collected
    # rather than explicitly closed.  The app is already stopping — no action
    # is possible or required.  Without these ignores they produce a spurious
    # ERROR alert every time the backend container restarts.
    re.compile(r'Unclosed\s+client\s+session', re.IGNORECASE),
    re.compile(r'Unclosed\s+connector', re.IGNORECASE),
    re.compile(r'aiohttp\.client\.ClientSession', re.IGNORECASE),
    re.compile(r'aiohttp\.connector\.TCPConnector', re.IGNORECASE),
    # ── Nginx upstream WebSocket / proxy transient connection errors ──────────
    # These fire when the backend briefly restarts and Nginx retries the /ws or
    # /api proxy connection.  The upstream auto-reconnects in seconds — no human
    # action is needed and these must NOT trigger Telegram alerts.
    re.compile(r'connect\(\) failed \(111', re.IGNORECASE),                     # Linux ECONNREFUSED code
    re.compile(r'connect\(\) failed.*connecting to upstream', re.IGNORECASE),   # Nginx generic upstream error
    re.compile(r'upstream:.*:8000/ws', re.IGNORECASE),                          # WS proxy destination
    re.compile(r'while connecting to upstream.*8000', re.IGNORECASE),
    re.compile(r'\[error\].*connect\(\) failed', re.IGNORECASE),               # Nginx [error] level prefix
    re.compile(r'recv\(\) failed \(104', re.IGNORECASE),                        # Nginx ECONNRESET code (WebSocket drop)
    re.compile(r'Connection reset by peer.*proxying upgraded connection', re.IGNORECASE), # WebSocket proxy drop
    re.compile(r'\[error\].*recv\(\) failed', re.IGNORECASE),                  # Nginx [error] level prefix for recv
    # ── Client WebSocket Disconnection / Broadcast Drop Noise ───────────────
    # These fire when a user closes a browser tab, refreshes a page, or navigates
    # away while real-time WebSocket streams (God Mode, Liquidation Stream, etc.)
    # are pushing data. This is completely standard client disconnect behavior.
    re.compile(r'God Mode Callback err', re.IGNORECASE),
    re.compile(r'Error sending to client in God Mode', re.IGNORECASE),
    re.compile(r'Error sending to client', re.IGNORECASE),
    re.compile(r'Cannot call ["\']send["\'] once a close message has been sent', re.IGNORECASE),
    re.compile(r'God Mode WebSocket (?:Error|connection closed)', re.IGNORECASE),
]

# Patterns that look like errors but should be downgraded to WARNING
# These are transient network events that do NOT require human intervention.
WARNING_OVERRIDE_PATTERNS = [
    # ── Benign Binance Data Fetch / Transient WS Stream Resync Errors ─────────
    re.compile(r'Error fetching OHLCV for', re.IGNORECASE),
    re.compile(
        r'(?<!Persistent )Error watching (?:orderbook|trades)\b.*?(?:reconnecting|checksum|timed?\s*out|connection\s+closed|network|1006|\s=\s*False)',
        re.IGNORECASE,
    ),
    re.compile(r'Error calculating Anchored VWAP', re.IGNORECASE),
    re.compile(r'Error calculating TPO', re.IGNORECASE),
    re.compile(r'Error calculating Footprint', re.IGNORECASE),
    
    # ── Benign Trading Logic Failures (Fallback automatically handled) ──
    re.compile(r'postOnly placement failed', re.IGNORECASE),
    re.compile(r'Exit order execution failed', re.IGNORECASE),
    re.compile(r'Order execution failed', re.IGNORECASE),
    re.compile(r'Margin is insufficient', re.IGNORECASE),
    re.compile(r'Futures Hunter Loop Error.*NoneType', re.IGNORECASE),
    re.compile(r'Order would immediately match and take', re.IGNORECASE),
    re.compile(r'spread crossed', re.IGNORECASE),
    re.compile(r'Native OTOCO.*Falling back', re.IGNORECASE),
    re.compile(r'Native OTOCO.*Failed', re.IGNORECASE),
    re.compile(r'Manual order rejected by exchange', re.IGNORECASE),
    re.compile(r'Manual trade rejected by exchange', re.IGNORECASE),
    re.compile(r'Order edit rejected by exchange', re.IGNORECASE),
    re.compile(r'Order placement rejected', re.IGNORECASE),
    re.compile(r'Order edit rejected', re.IGNORECASE),

    re.compile(r'Streamer failed to load markets', re.IGNORECASE),
    re.compile(r'Failed to load markets for.*during initialization', re.IGNORECASE),
    re.compile(r'\[vite\].*proxy error', re.IGNORECASE),
    re.compile(r'TCPConnectWrap\.afterConnect', re.IGNORECASE),
    re.compile(r'\[proxy\] Backend connection issue', re.IGNORECASE),
    re.compile(r'ECONNREFUSED', re.IGNORECASE),
    # ── Frontend / Node.js transient network resets ───────────────────────────
    # ECONNRESET = client (browser/tab) closed the connection abruptly.
    # This is normal behaviour — page refresh, tab close, network hiccup.
    # The frontend server recovers automatically; no action needed.
    re.compile(r'ECONNRESET', re.IGNORECASE),
    re.compile(r'read ECONNRESET', re.IGNORECASE),
    re.compile(r'TCP\.onStreamRead', re.IGNORECASE),
    # ── Celery/Redis transient connection resets ───────────────────────────
    # These happen when Redis container restarts. Celery auto-reconnects.
    re.compile(r'Cannot connect to redis', re.IGNORECASE),
    re.compile(r'Error while reading from redis', re.IGNORECASE),
    re.compile(r'redis\.exceptions\.ConnectionError', re.IGNORECASE),
    re.compile(r'Temporary failure in name resolution', re.IGNORECASE),
    re.compile(r'Name or service not known', re.IGNORECASE),
    re.compile(r'Connection reset by peer', re.IGNORECASE),
    # ── WebSocket transient connection errors ─────────────────────────────
    re.compile(r'\[Errno 111\] Connect call failed', re.IGNORECASE),
    # ── AI Key Rotation Fallbacks (handled automatically by next key) ─────
    re.compile(r'Groq\s+Error\s+on\s+Key\s+\d+,\s*trying\s+next', re.IGNORECASE),
    re.compile(r'Batch\s+translation\s+skipped', re.IGNORECASE),
]

# Patterns that ONLY apply to single-line informational noise (never used to
# suppress an already-detected ERROR/CRITICAL context block when interleaved).
INFO_ONLY_IGNORE_PATTERNS = [
    re.compile(r'^\s*(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*\s+)?INFO:'),
    re.compile(r'HTTP/\d\.\d"\s+200\b'),
    re.compile(r'\b200 OK\b'),
]

# Container names to monitor (must match docker-compose container_name)
CONTAINERS_TO_MONITOR = [
    "cosmoquant_backend",
    "cosmo_celery_worker_default",
    "cosmo_celery_worker_heavy",
    "cosmo_celery_worker",  # Legacy fallback alias
    "cosmo_celery_beat",
    "cosmo_telegram_bot",
    "cosmoquant_redis",
    "cosmoquant_db",
    "cosmoquant_frontend",
    "cosmoquant_nginx",
]

# Redis cooldown: same error won't trigger alert for N seconds
ALERT_COOLDOWN_SECONDS = 300  # 5 minutes

# How many lines of logs to fetch per container per run
LOG_TAIL_LINES = 100

# Redis key that stores the last scan timestamp per container (to use with docker logs --since)
LAST_SCAN_KEY = "log_monitor:last_scan_ts"

# Persistent alert history key (shared across Docker monitor, RedisLogHandler, and Latency Guard)
SYS_ALERTS_HISTORY_KEY = "sys_monitor:alerts:history"
SYS_ALERTS_HISTORY_MAX = 200
SYS_ALERTS_HISTORY_TTL_SEC = 7 * 86400  # 7 days


def record_and_publish_system_alert(
    redis_client,
    alert_dict: dict,
    *,
    publish: bool = True,
) -> dict:
    """
    Persist a system alert to Redis history (bounded list) and optionally broadcast
    it to the `system_alerts` Pub/Sub channel so alerts are never lost on page
    reload, WS disconnect, or container restart.
    """
    import json as _json
    import time as _time

    payload = dict(alert_dict)
    payload.setdefault("type", "system_alert")
    payload.setdefault("id", f"alert-{int(_time.time() * 1000)}-{abs(hash(payload.get('message', ''))) % 100000}")
    payload.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
    payload.setdefault("acknowledged", False)
    payload.setdefault("snippet", [])

    raw = _json.dumps(payload)
    try:
        pipe = redis_client.pipeline(transaction=False)
        pipe.lpush(SYS_ALERTS_HISTORY_KEY, raw)
        pipe.ltrim(SYS_ALERTS_HISTORY_KEY, 0, SYS_ALERTS_HISTORY_MAX - 1)
        pipe.expire(SYS_ALERTS_HISTORY_KEY, SYS_ALERTS_HISTORY_TTL_SEC)
        if publish:
            pipe.publish("system_alerts", raw)
        pipe.execute()
    except Exception:
        # Fallback to direct publish if pipeline fails (e.g. unit test mocks)
        if publish:
            try:
                redis_client.publish("system_alerts", raw)
            except Exception:
                pass
    return payload


def is_benign_ignored_line(line: str) -> bool:
    """Return True if line matches a known-benign operational ignore pattern."""
    for pattern in IGNORE_PATTERNS:
        if pattern.search(line):
            return True
    return False


# ============================================================
# SEVERITY CLASSIFICATION
# ============================================================

def classify_log_line(line: str) -> Optional[str]:
    """
    Classify a log line by severity.
    Returns: 'CRITICAL', 'ERROR', 'WARNING', or None (if not an alert)

    'WARNING' is returned for the live-terminal colour-coding only.
    The alert pipeline (system monitor widget + Telegram) skips WARNING entirely
    — see scan_docker_logs_and_notify().
    """
    # Skip boring / harmless lines first (fast path)
    if is_benign_ignored_line(line):
        return None

    # Demote known-harmless WARNING-level noise to INFO (return None)
    # e.g. "Market News Fetch Completed. 3 new items." logged at WARNING level
    for pattern in NOISE_WARNING_PATTERNS:
        if pattern.search(line):
            return None

    # Downgrade known benign errors to warnings immediately
    for pattern in WARNING_OVERRIDE_PATTERNS:
        if pattern.search(line):
            return 'WARNING'

    # Check CRITICAL before INFO-only ignores so embedded tracebacks / 500s are never masked
    for pattern in CRITICAL_PATTERNS:
        if pattern.search(line):
            return 'CRITICAL'

    # Skip pure INFO / 200 OK access lines that don't contain CRITICAL markers or 5xx errors
    for pattern in INFO_ONLY_IGNORE_PATTERNS:
        if pattern.search(line):
            # Still allow explicit 5xx or Python exception lines embedded in INFO logs
            if not re.search(r'(?:HTTP/\d\.\d"\s+5\d{2}\b|Traceback \(most recent call last\)|\bCRITICAL\b|\bFATAL\b)', line):
                return None

    for pattern in ERROR_PATTERNS:
        if pattern.search(line):
            return 'ERROR'

    for pattern in WARNING_PATTERNS:
        if pattern.search(line):
            return 'WARNING'

    return None


def make_fingerprint(container: str, line: str, context_lines: Optional[list[str]] = None) -> str:
    """
    Create a stable fingerprint for deduplication.
    Strips timestamps and dynamic values to group similar errors together.
    For Python tracebacks, anchors on the root-cause exception line at the bottom
    of the traceback so two different crashes never collide on 'Traceback (most recent call last):'.
    """
    anchor = line
    if context_lines and "traceback (most recent call last)" in line.lower():
        # Pick the last non-empty, non-indented line (the actual exception type + message)
        for ctx in reversed(context_lines[1:]):
            stripped = ctx.strip()
            if stripped and not ctx.startswith((" ", "\t")):
                anchor = stripped
                break
        else:
            # Fallback to last non-empty line in traceback
            for ctx in reversed(context_lines):
                if ctx.strip():
                    anchor = ctx.strip()
                    break

    # Remove ISO timestamps like [2026-04-03 12:34:56] or 2026-04-03T12:34:56.123456Z
    cleaned = re.sub(
        r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?',
        '',
        anchor,
    )
    # Remove short HH:MM:SS timestamps like "09:58:01 |"
    cleaned = re.sub(r'\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b', '', cleaned)
    # Remove task IDs / UUIDs like [abc123-def456]
    cleaned = re.sub(r'\[?[0-9a-f]{8}-[0-9a-f-]{12,}\]?', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\[[0-9a-f-]{8,}\]', '', cleaned, flags=re.IGNORECASE)
    # Remove memory addresses like 0x7f3a2b
    cleaned = re.sub(r'0x[0-9a-f]+', '', cleaned, flags=re.IGNORECASE)
    # Normalize whitespace and trim
    cleaned = re.sub(r'\s+', ' ', cleaned).strip().lower()[:140]
    return f"log_alert:{container}:{cleaned}"


# ============================================================
# TELEGRAM MESSAGE FORMATTER
# ============================================================

def format_alert_message(
    container: str,
    severity: str,
    log_lines: list[str],
    now_utc: datetime
) -> str:
    """Build a clean, readable Telegram message (plain text, no MarkdownV2 escaping needed)."""

    severity_icons = {
        'CRITICAL': '🔴 CRITICAL',
        'ERROR':    '🟠 ERROR',
        'WARNING':  '🟡 WARNING',
    }

    # Format container name nicely
    display_name = container.replace('cosmoquant_', '').replace('cosmo_', '').replace('_', ' ').upper()

    icon_label = severity_icons.get(severity, '⚪ UNKNOWN')
    time_str = now_utc.strftime('%Y-%m-%d %H:%M:%S UTC')

    # Take up to 5 most relevant lines
    snippet_lines = [l.strip() for l in log_lines if l.strip()][:5]
    snippet = '\n'.join(snippet_lines)

    message = (
        f"🚨 CosmoQuantAI — Server Alert\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📦 Container: {display_name}\n"
        f"⏰ Time: {time_str}\n"
        f"⚠️ Level: {icon_label}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📋 Log:\n"
        f"{snippet}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🔕 Cooldown: 5 min (duplicate alerts suppressed)\n"
        f"🤖 CosmoQuantAI Monitor"
    )
    return message


# ============================================================
# CORE SCAN FUNCTION
# ============================================================

def _get_log_monitor_users():
    """Sync helper: fetch notification settings from DB (must be called outside async context)."""
    from sqlalchemy import or_
    from app.db.session import SessionLocal
    from app.models.notification import NotificationSettings

    db = SessionLocal()
    try:
        # Include BOTH custom-bot users (telegram_bot_token set) AND Master Bot users (use_master_bot=True)
        active_users = db.query(NotificationSettings).filter(
            NotificationSettings.is_enabled == True,
            NotificationSettings.alert_server_errors == True,
            NotificationSettings.telegram_chat_id != None,
            or_(
                NotificationSettings.telegram_bot_token != None,
                NotificationSettings.use_master_bot == True,
            ),
        ).all()

        wants_broadcast = db.query(NotificationSettings).filter(
            NotificationSettings.broadcast_live_logs == True
        ).first()

        return active_users, wants_broadcast
    finally:
        db.close()


async def scan_docker_logs_and_notify(active_users=None, wants_broadcast=None):
    """
    Main entry point called by Celery task.
    1. Connects to Docker daemon via socket
    2. Reads recent logs from each container
    3. Detects problems and ALWAYS persists/broadcasts them to Sys Monitor (`system_alerts`)
    4. Sends Telegram alerts to users who have server-error Telegram notifications enabled

    NOTE: active_users and wants_broadcast should be pre-fetched by the
    sync caller (_get_log_monitor_users) to avoid MissingGreenlet errors
    when running sync SQLAlchemy queries inside an async context.
    """
    from app.services.notification import NotificationService
    from app.utils import get_redis_client

    if not is_docker_daemon_configured():
        _log_docker_unavailable_once()
        return

    try:
        import docker
    except ImportError:
        logger.error("docker package not installed. Install with: pip install docker")
        return

    redis = get_redis_client()
    now_utc = datetime.now(timezone.utc)

    # --- Connect to Docker ---
    try:
        docker_client = docker.from_env()
    except Exception as e:
        logger.error(f"[LogMonitor] Cannot connect to Docker daemon: {e}")
        return

    if active_users is None:
        active_users = []

    try:
        alerts_sent = 0
        alerts_recorded = 0

        # --- Scan each container ---
        for container_name in CONTAINERS_TO_MONITOR:
            try:
                container = docker_client.containers.get(container_name)
            except docker.errors.NotFound:
                logger.debug(f"[LogMonitor] Container '{container_name}' not found, skipping.")
                continue
            except Exception as e:
                logger.warning(f"[LogMonitor] Error getting container '{container_name}': {e}")
                continue

            # Fetch logs only since the last scan for THIS container (avoids cross-container skip gaps)
            per_container_ts_key = f"{LAST_SCAN_KEY}:{container_name}"
            try:
                last_ts_raw = redis.get(per_container_ts_key) or redis.get(LAST_SCAN_KEY)
                if last_ts_raw:
                    raw_str = last_ts_raw.decode() if isinstance(last_ts_raw, bytes) else str(last_ts_raw)
                    since_dt = datetime.fromisoformat(raw_str)
                else:
                    from datetime import timedelta
                    since_dt = now_utc - timedelta(seconds=70)  # slight overlap for safety

                raw_logs = container.logs(
                    since=since_dt,
                    stdout=True,
                    stderr=True,
                    timestamps=True,
                )
                log_text = raw_logs.decode('utf-8', errors='replace')
                log_lines = log_text.splitlines()
            except Exception as e:
                logger.warning(f"[LogMonitor] Error reading logs for '{container_name}': {e}")
                continue

            # --- Analyze lines ---
            i = 0
            while i < len(log_lines):
                line = log_lines[i]
                severity = classify_log_line(line)

                # WARNING-only lines are colour-coded in the live terminal, not escalated as alerts.
                if severity and severity != 'WARNING':
                    # ----------------------------------------------------------
                    # Context collection:
                    # - For Python Tracebacks: absorb up to 20 indented/frame lines
                    #   PLUS the final exception line (e.g. "ValueError: ...").
                    # - For regular errors: absorb up to 4 indented continuation lines only
                    #   (NEVER absorb unrelated interleaved INFO / 200 OK lines!).
                    # ----------------------------------------------------------
                    context_lines = [line]
                    lines_consumed = 0
                    is_traceback = "traceback (most recent call last)" in line.lower()
                    max_lookahead = 24 if is_traceback else 5

                    for j in range(1, max_lookahead):
                        if i + j >= len(log_lines):
                            break

                        next_line = log_lines[i + j]
                        # Strip optional leading Docker ISO timestamp + single separator space ONLY
                        # (preserving any leading indentation of traceback stack frames!)
                        next_body = re.sub(
                            r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ',
                            '',
                            next_line,
                        )
                        if not next_body.strip():
                            break

                        # Stop immediately if an interleaved normal INFO / HTTP 200 line appears
                        if any(p.search(next_body) for p in INFO_ONLY_IGNORE_PATTERNS):
                            break

                        # Case A — indented continuation: traceback body / stack frames
                        if next_body.startswith((' ', '\t')):
                            context_lines.append(next_line)
                            lines_consumed += 1
                            continue

                        # Case B — final exception trailer at the bottom of a traceback
                        if is_traceback and re.search(
                            r'(?:Error|Exception|Exit|Interrupt|Warning|Fault)\b',
                            next_body,
                        ):
                            context_lines.append(next_line)
                            lines_consumed += 1
                            break

                        # Otherwise, stop so unrelated subsequent lines are evaluated independently
                        break

                    # Check ONLY benign-error ignore patterns (NEVER INFO_ONLY_IGNORE_PATTERNS)
                    is_context_ignored = any(is_benign_ignored_line(ctx_line) for ctx_line in context_lines)
                    if is_context_ignored:
                        i += 1 + lines_consumed
                        continue

                    fingerprint = make_fingerprint(container_name, line, context_lines)
                    was_set = redis.set(
                        fingerprint, "1",
                        nx=True,
                        ex=ALERT_COOLDOWN_SECONDS,
                    )

                    if was_set:
                        message = format_alert_message(
                            container=container_name,
                            severity=severity,
                            log_lines=context_lines[:8],
                            now_utc=now_utc,
                        )

                        # Persist to Redis history + broadcast live to Sys Monitor WebSocket
                        try:
                            display_name = (
                                container_name
                                .replace("cosmoquant_", "")
                                .replace("cosmo_", "")
                                .replace("_", " ")
                                .upper()
                            )
                            record_and_publish_system_alert(
                                redis,
                                {
                                    "type": "system_alert",
                                    "severity": severity,
                                    "container": container_name,
                                    "display_name": display_name,
                                    "source": "docker_monitor",
                                    "message": message,
                                    "snippet": [l.strip() for l in context_lines if l.strip()][:10],
                                    "timestamp": now_utc.isoformat(),
                                },
                                publish=True,
                            )
                            alerts_recorded += 1
                        except Exception as pub_err:
                            logger.warning(f"[LogMonitor] Redis publish failed: {pub_err}")

                        # Send Telegram alert to all users with server-error alerts enabled
                        if active_users:
                            from app.db.session import SessionLocal
                            db = SessionLocal()
                            try:
                                for user_settings in active_users:
                                    try:
                                        await NotificationService.send_message(
                                            db=db,
                                            user_id=user_settings.user_id,
                                            message=message,
                                        )
                                        alerts_sent += 1
                                        logger.info(
                                            f"[LogMonitor] Alert sent to user {user_settings.user_id} "
                                            f"— {container_name} {severity}"
                                        )
                                    except Exception as e:
                                        logger.error(f"[LogMonitor] Failed to notify user {user_settings.user_id}: {e}")
                            finally:
                                db.close()

                    i += lines_consumed

                i += 1

            # Save scan timestamp for this specific container only after reading it cleanly
            try:
                redis.set(per_container_ts_key, now_utc.isoformat())
            except Exception as ts_err:
                logger.warning(f"[LogMonitor] Could not save scan timestamp for {container_name}: {ts_err}")

        # Keep legacy global key updated for compatibility
        try:
            redis.set(LAST_SCAN_KEY, now_utc.isoformat())
        except Exception:
            pass

        if alerts_recorded > 0 or alerts_sent > 0:
            logger.info(f"[LogMonitor] Scan complete. {alerts_recorded} alert(s) recorded, {alerts_sent} Telegram alert(s) sent.")
        else:
            logger.debug("[LogMonitor] Scan complete. No new alerts.")

    except Exception as e:
        logger.error(f"[LogMonitor] Unexpected error during scan: {e}", exc_info=True)
    finally:
        try:
            docker_client.close()
        except Exception:
            pass


# ============================================================
# RAW LOG STREAMING (All container logs → frontend terminal)
# ============================================================

async def publish_all_container_logs():
    """
    Streams the last N lines of ALL container logs to Redis channel
    'container_logs' for live display in the frontend terminal widget.

    Called by Celery task every 10 seconds.
    Each message: { type, container, display_name, lines: [{line, level}], timestamp }
    """
    if not is_docker_daemon_configured():
        _log_docker_unavailable_once()
        return False

    try:
        import docker
    except ImportError:
        return False

    try:
        from app.utils import get_redis_client
        import json as _json

        docker_client = docker.from_env()
        redis = get_redis_client()

        for container_name in CONTAINERS_TO_MONITOR:
            try:
                container = docker_client.containers.get(container_name)
            except Exception:
                continue

            try:
                raw_logs = container.logs(
                    tail=40,           # Last 40 lines per container
                    stdout=True,
                    stderr=True,
                    timestamps=True,
                )
                log_text = raw_logs.decode('utf-8', errors='replace')
                lines = [l.strip() for l in log_text.splitlines() if l.strip()]
            except Exception:
                continue

            if not lines:
                continue

            display_name = (
                container_name
                .replace("cosmoquant_", "")
                .replace("cosmo_", "")
                .replace("_", " ")
                .upper()
            )

            # Classify each line for color-coding on frontend
            classified = []
            for line in lines:
                sev = classify_log_line(line)
                if sev == 'CRITICAL':
                    level = 'CRITICAL'
                elif sev == 'ERROR':
                    level = 'ERROR'
                elif sev == 'WARNING':
                    level = 'WARNING'
                else:
                    level = 'INFO'

                classified.append({
                    "line": line[:350],   # Truncate very long lines
                    "level": level,
                })

            payload = _json.dumps({
                "type": "container_logs",
                "container": container_name,
                "display_name": display_name,
                "lines": classified,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            redis.publish("container_logs", payload)

        docker_client.close()
        return True

    except Exception as e:
        logger.error(f"[LogStream] Error publishing container logs: {e}")
        return False

