import atexit
from collections import deque
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
import queue
import re
import sys
import threading
import time
import traceback
from typing import Any, Deque, Dict, List, Optional, Tuple
import redis
from app.core.config import settings

# Process-wide singleton sync Redis clients (one ConnectionPool per URL)
# Prevents opening & leaking a brand-new TCP connection/pool on every HTTP request.
_SYNC_REDIS_LOCK = threading.Lock()
_SYNC_REDIS_CLIENTS: Dict[str, redis.Redis] = {}

LIVE_CONTAINER_LOGS_KEY_PREFIX = "live_container_logs:latest:"
LIVE_CONTAINER_LOGS_LIST_PREFIX = "live_container_logs:list:"
LIVE_CONTAINER_LOGS_TTL_SEC = 86400  # 24h so quiet services stay visible in Live Logs

_SINGLETON_HANDLERS_LOCK = threading.Lock()
_SINGLETON_HANDLERS: Dict[str, "RedisLogHandler"] = {}
_HOOKS_INSTALLED_LOCK = threading.Lock()
_HOOKS_INSTALLED: bool = False
_REDIS_LOG_TLS = threading.local()

_HTTP_5XX_RE = re.compile(r'(?:HTTP/\d\.\d"\s+5\d{2}\b|\bHTTP\s+5\d{2}\b|\s50[0234](?:\s|$))')
_STDERR_ERROR_RE = re.compile(
    r'(?:Traceback \(most recent call last\)|❌|🚨|\bCRITICAL\b|\bFATAL\b|\bERROR\b|\b[A-Za-z_]*Error:|Exception in ASGI application|Task exception was never retrieved)',
)


def get_redis_client() -> redis.Redis:
    """Return a shared, connection-pooled synchronous Redis client (fork-safe per PID)."""
    redis_url = os.getenv("CELERY_RESULT_BACKEND", settings.REDIS_URL or "redis://redis:6379/0")
    cache_key = f"{os.getpid()}:{redis_url}"
    client = _SYNC_REDIS_CLIENTS.get(cache_key)
    if client is not None:
        return client
    with _SYNC_REDIS_LOCK:
        client = _SYNC_REDIS_CLIENTS.get(cache_key)
        if client is None:
            pool = redis.ConnectionPool.from_url(
                redis_url,
                max_connections=64,
                socket_connect_timeout=2.0,
                socket_timeout=2.0,
                health_check_interval=30,
            )
            client = redis.Redis(connection_pool=pool)
            _SYNC_REDIS_CLIENTS[cache_key] = client
    return client


def detect_service_container_name() -> str:
    """Detect the logical container/service name for Docker-socket-free live log streaming."""
    explicit = os.getenv("SERVICE_CONTAINER_NAME") or os.getenv("CONTAINER_NAME")
    if explicit:
        return explicit.strip()
    cmdline = " ".join(sys.argv).lower()
    if "telegram_master_bot" in cmdline:
        return "cosmo_telegram_bot"
    if "celery" in cmdline:
        if "beat" in cmdline:
            return "cosmo_celery_beat"
        if "heavy" in cmdline:
            return "cosmo_celery_worker_heavy"
        return "cosmo_celery_worker_default"
    return "cosmoquant_backend"


def _format_display_name(container_name: str) -> str:
    return (
        container_name
        .replace("cosmoquant_", "")
        .replace("cosmo_", "")
        .replace("_", " ")
        .upper()
    )


def _normalize_log_level(record: logging.LogRecord, message: str) -> str:
    if record.levelno >= logging.CRITICAL:
        return "CRITICAL"
    if record.levelno >= logging.ERROR:
        return "ERROR"
    if record.levelno >= logging.WARNING:
        # Escalate traceback / critical / explicit printed errors logged via Celery LoggingProxy (WARNING)
        if "Traceback (most recent call last)" in message or "CRITICAL" in message:
            return "CRITICAL"
        if "❌" in message or "🚨" in message:
            return "ERROR"
        return "WARNING"
    # Highlight 5xx access logs (even with no trailing space after 500) or tracebacks emitted at INFO
    if "Traceback (most recent call last)" in message:
        return "CRITICAL"
    if _HTTP_5XX_RE.search(message):
        return "ERROR"
    return "INFO"


def _extract_snippet_lines(raw_message: str, max_lines: int = 12) -> List[str]:
    """Split a possibly multi-line message/traceback into clean snippet lines preserving root cause."""
    raw_lines = [l.rstrip() for l in raw_message.splitlines() if l.strip()]
    if not raw_lines:
        return []
    if len(raw_lines) <= max_lines:
        return [l[:380] for l in raw_lines]
    # Keep first 3 lines (context/header) + last (max_lines - 3) lines (actual exception & root frame)
    head = raw_lines[:3]
    tail = raw_lines[-(max_lines - 3):]
    return [l[:380] for l in head + ["... (stack frames truncated) ..."] + tail]


def _dispatch_telegram_alert_async_thread(
    container_name: str,
    severity: str,
    snippet: List[str],
    now_utc: datetime,
) -> None:
    """
    Send Telegram server-error alerts in Docker-socket-free mode on a short-lived daemon thread
    so RedisLogHandler's drain loop is NEVER blocked by slow Telegram network calls.
    """
    def _runner():
        import asyncio as _asyncio
        try:
            from app.services.log_monitor_service import _get_log_monitor_users, format_alert_message
            from app.services.notification import NotificationService
            from app.db.session import SessionLocal

            active_users, _ = _get_log_monitor_users()
            if not active_users:
                return

            msg = format_alert_message(
                container=container_name,
                severity=severity,
                log_lines=snippet[:6],
                now_utc=now_utc,
            )

            async def _send_all():
                db = SessionLocal()
                try:
                    for user_settings in active_users:
                        try:
                            await NotificationService.send_message(
                                db=db,
                                user_id=user_settings.user_id,
                                message=msg,
                            )
                        except Exception:
                            pass
                finally:
                    db.close()

            loop = _asyncio.new_event_loop()
            try:
                loop.run_until_complete(_send_all())
            finally:
                loop.close()
        except Exception:
            pass

    threading.Thread(
        target=_runner,
        name=f"sys-alert-tg-{container_name}",
        daemon=True,
    ).start()


# ✅ ১. Non-Blocking, Fork-Safe Redis Log Handler + Docker-Socket-Free Live Container Feed
class RedisLogHandler(logging.Handler):
    """
    Captures Python log records and asynchronously:
      1. Publishes to `bot_logs` (legacy admin log channel).
      2. Appends to a multi-worker-safe Redis list + snapshot cache (24h TTL) and flushes live
         `container_logs` batches every 2s to Redis Pub/Sub so Sys Monitor -> Live Feed
         works in real time without mounting /var/run/docker.sock.
      3. Classifies & persists deduplicated ERROR/CRITICAL alerts to `sys_monitor:alerts:history`,
         broadcasts to `system_alerts`, and dispatches Telegram alerts when Docker socket monitoring
         is disabled.
    Fork-safe: detects `os.fork()` via PID check and transparently rebuilds Redis pool + worker thread
    inside Celery ForkPoolWorker child processes, and flushes cleanly on process shutdown (`atexit`).
    """

    LIVE_FEED_FLUSH_INTERVAL_SEC: float = 2.0
    LIVE_FEED_RING_SIZE: int = 120

    def __init__(
        self,
        max_queue_size: int = 2000,
        container_name: Optional[str] = None,
        publish_bot_logs: bool = True,
    ):
        super().__init__()
        self.container_name = container_name or detect_service_container_name()
        self.display_name = _format_display_name(self.container_name)
        self._publish_bot_logs = publish_bot_logs
        self._max_queue_size = max_queue_size
        self._fork_lock = threading.Lock()
        self._ring: Deque[Dict[str, str]] = deque(maxlen=self.LIVE_FEED_RING_SIZE)
        self._pending_lines: List[Dict[str, str]] = []
        self._dirty: bool = False
        self._last_flush_mono: float = 0.0
        self._init_runtime_resources()
        atexit.register(self._atexit_flush)

    def _init_runtime_resources(self) -> None:
        """Create PID-local Redis pool, bounded queue, and background drain thread."""
        self._pid = os.getpid()
        self._pool = redis.ConnectionPool.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            max_connections=4,
            socket_connect_timeout=1.5,
            socket_timeout=1.5,
            health_check_interval=30,
        )
        self.redis_client = redis.Redis(connection_pool=self._pool)
        # Queue tuple: (bot_log_payload, formatted_line, level, raw_message, logger_name, source)
        self._queue: "queue.Queue[Tuple[str, str, str, str, str, str]]" = queue.Queue(maxsize=self._max_queue_size)
        self._stop_event = threading.Event()
        self._worker = threading.Thread(
            target=self._drain_loop,
            name=f"redis-log-publisher-{self.container_name}-{self._pid}",
            daemon=True,
        )
        self._worker.start()

    def ensure_worker_alive(self) -> None:
        """
        Detect Linux `os.fork()` (e.g., Celery prefork workers) where parent daemon threads
        do not survive in child processes, and transparently re-initialize pool + thread.
        """
        curr_pid = os.getpid()
        if self._pid == curr_pid and self._worker.is_alive():
            return
        with self._fork_lock:
            if self._pid == os.getpid() and self._worker.is_alive():
                return
            if self._stop_event.is_set() and self._pid == os.getpid():
                return  # Intentionally closed in this process
            self._pending_lines.clear()
            self._ring.clear()
            self._dirty = False
            self._last_flush_mono = 0.0
            self._init_runtime_resources()

    def _process_one_item(
        self,
        bot_log_payload: str,
        formatted_line: str,
        level: str,
        raw_message: str,
        logger_name: str,
        source: str,
    ) -> None:
        if self._publish_bot_logs and bot_log_payload:
            try:
                self.redis_client.publish("bot_logs", bot_log_payload)
            except Exception:
                pass
        item = {
            "line": formatted_line,
            "level": level,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        self._ring.append(item)
        self._pending_lines.append(item)
        self._dirty = True
        if level in ("ERROR", "CRITICAL") or _STDERR_ERROR_RE.search(raw_message):
            self._maybe_publish_system_alert(raw_message, level, logger_name=logger_name, source=source)

    def _flush_live_feed(self) -> None:
        if not self._pending_lines and not self._ring:
            return
        new_items = list(self._pending_lines)
        self._pending_lines.clear()

        list_key = f"{LIVE_CONTAINER_LOGS_LIST_PREFIX}{self.container_name}"
        snap_key = f"{LIVE_CONTAINER_LOGS_KEY_PREFIX}{self.container_name}"
        merged_lines: List[Dict[str, str]] = list(self._ring)

        try:
            # Multi-worker safe append via Redis List so forked Celery workers never overwrite each other
            if new_items:
                pipe = self.redis_client.pipeline(transaction=False)
                pipe.rpush(list_key, *[json.dumps(item) for item in new_items])
                pipe.ltrim(list_key, -self.LIVE_FEED_RING_SIZE, -1)
                pipe.expire(list_key, LIVE_CONTAINER_LOGS_TTL_SEC)
                pipe.lrange(list_key, -self.LIVE_FEED_RING_SIZE, -1)
                res = pipe.execute()
                raw_list = res[-1] if res and isinstance(res[-1], list) else None
                if raw_list:
                    parsed = []
                    for entry in raw_list:
                        try:
                            parsed.append(json.loads(entry))
                        except Exception:
                            pass
                    if parsed:
                        merged_lines = parsed
        except Exception:
            pass

        batch = {
            "type": "container_logs",
            "container": self.container_name,
            "display_name": self.display_name,
            "lines": merged_lines,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        payload_str = json.dumps(batch)
        try:
            pipe = self.redis_client.pipeline(transaction=False)
            pipe.setex(snap_key, LIVE_CONTAINER_LOGS_TTL_SEC, payload_str)
            pipe.publish("container_logs", payload_str)
            pipe.execute()
        except Exception:
            pass
        self._dirty = False
        self._last_flush_mono = time.monotonic()

    def _maybe_publish_system_alert(
        self,
        raw_message: str,
        level: str,
        logger_name: str = "",
        source: str = "live_handler",
    ) -> None:
        # Avoid duplicate alerts if Docker socket monitor is actively enabled
        if os.environ.get("DOCKER_HOST") or os.path.exists("/var/run/docker.sock"):
            return

        from app.services.log_monitor_service import (
            classify_log_line,
            is_benign_ignored_line,
            make_fingerprint,
            record_and_publish_system_alert,
            WARNING_OVERRIDE_PATTERNS,
        )

        # Evaluate full message against benign ignore / warning override rules
        first_line = raw_message.splitlines()[0] if raw_message else ""
        if is_benign_ignored_line(raw_message):
            return

        # Reconcile Python log level with pattern classifier
        effective_level = level
        if effective_level in ("ERROR", "CRITICAL"):
            if any(p.search(raw_message) for p in WARNING_OVERRIDE_PATTERNS):
                return  # Downgraded known-transient error
        else:
            classified = classify_log_line(raw_message)
            if classified in ("ERROR", "CRITICAL"):
                effective_level = classified
            else:
                return

        if effective_level not in ("ERROR", "CRITICAL"):
            return

        snippet = _extract_snippet_lines(raw_message, max_lines=12)
        if not snippet:
            return

        try:
            # Fingerprint WITHOUT timestamp prefix (fixes broken per-second dedup)
            # and anchored on traceback exception line (fixes traceback collisions)
            fp_base = make_fingerprint(self.container_name, first_line, snippet)
            sig = hashlib.md5(f"{effective_level}:{fp_base}".encode("utf-8", "ignore")).hexdigest()
            dedup_key = f"sys_alert_live_dedup:{sig}"
            claimed = self.redis_client.set(dedup_key, "1", nx=True, ex=300)
            if not claimed:
                return

            now_utc = datetime.now(timezone.utc)
            now_iso = now_utc.isoformat()
            # Build clean human-readable headline (last line of traceback if traceback, else first line)
            headline = (
                snippet[-1]
                if ("traceback (most recent call last)" in first_line.lower() and len(snippet) > 1)
                else snippet[0]
            )
            record_and_publish_system_alert(
                self.redis_client,
                {
                    "type": "system_alert",
                    "id": f"live-{sig[:12]}-{int(time.time() * 1000)}",
                    "container": self.container_name,
                    "display_name": self.display_name,
                    "severity": effective_level,
                    "logger": logger_name or self.container_name,
                    "source": source,
                    "snippet": snippet,
                    "message": f"[{self.display_name}] {headline}\n\n" + "\n".join(snippet),
                    "timestamp": now_iso,
                    "acknowledged": False,
                },
                publish=True,
            )
            # Dispatch Telegram server-error alerts asynchronously (never stalls drain loop)
            if not os.environ.get("DISABLE_LIVE_TELEGRAM_ALERTS"):
                _dispatch_telegram_alert_async_thread(
                    container_name=self.container_name,
                    severity=effective_level,
                    snippet=snippet,
                    now_utc=now_utc,
                )
        except Exception:
            pass

    def _drain_loop(self) -> None:
        while not self._stop_event.is_set():
            wait_s = min(0.5, max(0.02, self.LIVE_FEED_FLUSH_INTERVAL_SEC / 2.0))
            try:
                item = self._queue.get(timeout=wait_s)
                self._process_one_item(*item)
            except queue.Empty:
                pass

            if self._dirty and (time.monotonic() - self._last_flush_mono) >= self.LIVE_FEED_FLUSH_INTERVAL_SEC:
                self._flush_live_feed()

    def flush(self, timeout: float = 1.5) -> None:
        """Synchronously drain pending queue items & flush snapshot (critical for short-lived Celery workers)."""
        try:
            deadline = time.monotonic() + max(0.1, timeout)
            while time.monotonic() < deadline:
                try:
                    item = self._queue.get_nowait()
                    self._process_one_item(*item)
                except queue.Empty:
                    break
            if self._dirty or self._pending_lines:
                self._flush_live_feed()
        except Exception:
            pass

    def _atexit_flush(self) -> None:
        if self._pid == os.getpid():
            self.flush(timeout=1.0)

    def enqueue_raw_event(
        self,
        message: str,
        level: str = "ERROR",
        logger_name: str = "stderr",
        source: str = "stderr_hook",
    ) -> None:
        """Non-blocking direct intake for uncaught exceptions, Celery failures, or print() errors."""
        if not message or not message.strip():
            return
        self.ensure_worker_alive()
        ts_short = datetime.now(timezone.utc).strftime("%H:%M:%S")
        first_line = message.strip().splitlines()[0]
        formatted_line = f"{ts_short} | {level} | {first_line}"[:350]
        try:
            self._queue.put_nowait(("", formatted_line, level, message.strip(), logger_name, source))
        except queue.Full:
            pass

    def emit(self, record):
        if getattr(_REDIS_LOG_TLS, "in_emit", False):
            return
        _REDIS_LOG_TLS.in_emit = True
        try:
            # Prevent infinite loops ONLY from low-level redis driver loggers, NOT app.core.redis!
            rname = record.name or ""
            if rname.startswith(("redis.", "aioredis.")) or rname in ("redis", "aioredis"):
                return
            # Prevent self-recursion from log_monitor_service own info logs
            if rname.endswith("log_monitor_service") and record.levelno < logging.ERROR:
                return

            self.ensure_worker_alive()

            log_entry = self.format(record)
            if not log_entry:
                return

            # Ensure exc_info is preserved even if formatter is simple '%(message)s'
            raw_message = log_entry
            if record.exc_info and "Traceback (most recent call last)" not in raw_message:
                try:
                    tb_str = "".join(traceback.format_exception(*record.exc_info)).strip()
                    if tb_str:
                        raw_message = f"{raw_message}\n{tb_str}"
                except Exception:
                    pass

            ts_short = datetime.now(timezone.utc).strftime("%H:%M:%S")
            level = _normalize_log_level(record, raw_message)
            first_line = raw_message.splitlines()[0] if raw_message else log_entry
            formatted_line = f"{ts_short} | {level} | {first_line}"[:350]

            bot_log_payload = ""
            if self._publish_bot_logs:
                bot_log_payload = json.dumps({
                    "channel": "logs_backend",
                    "data": {
                        "time": ts_short,
                        "type": f"SYS-{record.levelname}",
                        "message": first_line[:500],
                    },
                })

            try:
                self._queue.put_nowait((bot_log_payload, formatted_line, level, raw_message, rname, "python_logging"))
            except queue.Full:
                pass
        except Exception:
            self.handleError(record)
        finally:
            _REDIS_LOG_TLS.in_emit = False

    def close(self) -> None:
        self._stop_event.set()
        super().close()


def get_singleton_redis_log_handler(
    container_name: Optional[str] = None,
    publish_bot_logs: bool = False,
) -> RedisLogHandler:
    """Return a single shared RedisLogHandler per container name in this process (fork-safe)."""
    cname = container_name or detect_service_container_name()
    with _SINGLETON_HANDLERS_LOCK:
        existing = _SINGLETON_HANDLERS.get(cname)
        if existing is not None:
            existing.ensure_worker_alive()
            if publish_bot_logs:
                existing._publish_bot_logs = True
            return existing
        handler = RedisLogHandler(container_name=cname, publish_bot_logs=publish_bot_logs)
        handler.setFormatter(logging.Formatter("%(message)s"))
        _SINGLETON_HANDLERS[cname] = handler
        return handler


def attach_live_log_handler(
    logger_names: Tuple[str, ...] = ("",),
    container_name: Optional[str] = None,
    publish_bot_logs: bool = False,
    min_level: Optional[int] = logging.INFO,
) -> RedisLogHandler:
    """
    Idempotently attach a singleton non-blocking RedisLogHandler so ALL service logs
    (including root, app.*, uvicorn.*, asyncio, sqlalchemy errors, task loggers) appear
    in Sys Monitor without duplicate emissions.

    Pass `min_level=None` to preserve each logger's configured level (e.g. Celery `--loglevel=warning`).
    """
    handler = get_singleton_redis_log_handler(
        container_name=container_name,
        publish_bot_logs=publish_bot_logs,
    )
    root_logger = logging.getLogger()
    root_has_handler = any(isinstance(h, RedisLogHandler) for h in root_logger.handlers)

    if "" in logger_names:
        if not root_has_handler:
            root_logger.addHandler(handler)
            root_has_handler = True
        if min_level is not None and (root_logger.level == logging.NOTSET or root_logger.level > min_level):
            root_logger.setLevel(min_level)

    for name in logger_names:
        if not name:
            continue
        target = logging.getLogger(name)
        # If root already has RedisLogHandler AND this child propagates to root,
        # do NOT attach a duplicate handler (avoids double log lines & double alerts).
        if root_has_handler and target.propagate:
            if min_level is not None and (target.level == logging.NOTSET or target.level > min_level):
                target.setLevel(min_level)
            continue
        if not any(isinstance(h, RedisLogHandler) for h in target.handlers):
            target.addHandler(handler)
            if min_level is not None and (target.level == logging.NOTSET or target.level > min_level):
                target.setLevel(min_level)
    return handler


class _ErrorTeeStream:
    """
    Lightweight, transparent stdout/stderr tee that preserves 100% of original
    stream behavior while forwarding error/traceback lines written via print() or
    raw stderr to RedisLogHandler so Sys Monitor never misses printed errors.
    """

    def __init__(self, wrapped_stream, handler: RedisLogHandler, stream_name: str):
        self._stream = wrapped_stream
        self._handler = handler
        self._stream_name = stream_name
        self._buf = ""
        self._tb_lines: List[str] = []
        self._in_tb = False
        self._lock = threading.Lock()

    def write(self, data: str) -> int:
        written = self._stream.write(data)
        if not data or getattr(_REDIS_LOG_TLS, "in_tee", False):
            return written
        # Celery's LoggingProxy already routes print() to Python `celery.redirected` logger
        if self._stream.__class__.__name__ == "LoggingProxy":
            return written
        _REDIS_LOG_TLS.in_tee = True
        try:
            with self._lock:
                self._buf += data
                while "\n" in self._buf:
                    line, self._buf = self._buf.split("\n", 1)
                    self._inspect_line(line)
        except Exception:
            pass
        finally:
            _REDIS_LOG_TLS.in_tee = False
        return written

    def _inspect_line(self, line: str) -> None:
        stripped = line.strip()
        if not stripped:
            if self._in_tb and self._tb_lines:
                self._flush_tb()
            return
        if "Traceback (most recent call last)" in stripped:
            self._in_tb = True
            self._tb_lines = [line]
            return
        if self._in_tb:
            self._tb_lines.append(line)
            # Non-indented line after Traceback frames is the final exception line
            if not line.startswith((" ", "\t")) or len(self._tb_lines) >= 25:
                self._flush_tb()
            return
        # Single-line printed error (e.g. print(f"❌ Backtest Error: {e}"))
        if _STDERR_ERROR_RE.search(stripped):
            # Ignore lines that came from Python's own StreamHandler (already captured by RedisLogHandler)
            if re.match(r'^(?:INFO|WARNING|ERROR|CRITICAL|DEBUG):[\w.]+:', stripped):
                return
            if re.match(r'^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}', stripped):
                return
            sev = "CRITICAL" if re.search(r'\b(?:CRITICAL|FATAL|PANIC)\b', stripped, re.IGNORECASE) else "ERROR"
            self._handler.enqueue_raw_event(
                message=stripped,
                level=sev,
                logger_name=self._stream_name,
                source=f"{self._stream_name}_print",
            )

    def _flush_tb(self) -> None:
        block = "\n".join(self._tb_lines)
        self._tb_lines.clear()
        self._in_tb = False
        if block.strip():
            self._handler.enqueue_raw_event(
                message=block,
                level="CRITICAL",
                logger_name=self._stream_name,
                source=f"{self._stream_name}_traceback",
            )

    def flush(self) -> None:
        self._stream.flush()

    def isatty(self) -> bool:
        return getattr(self._stream, "isatty", lambda: False)()

    def __getattr__(self, name: str):
        return getattr(self._stream, name)


def install_error_capture_hooks(container_name: Optional[str] = None) -> None:
    """
    Idempotently install process-wide hooks for uncaught main/thread exceptions
    and printed stderr/stdout errors so Sys Monitor never misses silent crashes.
    """
    global _HOOKS_INSTALLED
    with _HOOKS_INSTALLED_LOCK:
        if _HOOKS_INSTALLED:
            return
        _HOOKS_INSTALLED = True

    handler = get_singleton_redis_log_handler(container_name=container_name)

    # 1. Main thread uncaught exceptions
    orig_excepthook = sys.excepthook

    def _sys_excepthook(exc_type, exc_value, exc_tb):
        try:
            if not issubclass(exc_type, KeyboardInterrupt):
                tb_str = "".join(traceback.format_exception(exc_type, exc_value, exc_tb)).strip()
                handler.enqueue_raw_event(
                    message=tb_str or f"{exc_type.__name__}: {exc_value}",
                    level="CRITICAL",
                    logger_name="sys.excepthook",
                    source="uncaught_exception",
                )
                handler.flush(timeout=1.0)
        except Exception:
            pass
        orig_excepthook(exc_type, exc_value, exc_tb)

    sys.excepthook = _sys_excepthook

    # 2. Background thread uncaught exceptions
    if hasattr(threading, "excepthook"):
        orig_thread_hook = threading.excepthook

        def _thread_excepthook(args):
            try:
                if args.exc_type and not issubclass(args.exc_type, SystemExit):
                    tb_str = "".join(
                        traceback.format_exception(args.exc_type, args.exc_value, args.exc_traceback)
                    ).strip()
                    tname = getattr(args.thread, "name", "unknown-thread")
                    handler.enqueue_raw_event(
                        message=f"[Thread:{tname}] {tb_str or args.exc_value}",
                        level="CRITICAL",
                        logger_name=f"thread.{tname}",
                        source="uncaught_thread_exception",
                    )
            except Exception:
                pass
            orig_thread_hook(args)

        threading.excepthook = _thread_excepthook

    # 3. Transparent stderr & stdout error tee (captures print("❌ ...") & raw tracebacks)
    if not isinstance(sys.stderr, _ErrorTeeStream):
        sys.stderr = _ErrorTeeStream(sys.stderr, handler, "stderr")
    if not isinstance(sys.stdout, _ErrorTeeStream):
        sys.stdout = _ErrorTeeStream(sys.stdout, handler, "stdout")
