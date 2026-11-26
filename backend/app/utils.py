from collections import deque
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
import queue
import sys
import threading
import time
from typing import Any, Deque, Dict, Optional, Tuple
import redis
from app.core.config import settings

# Process-wide singleton sync Redis clients (one ConnectionPool per URL)
# Prevents opening & leaking a brand-new TCP connection/pool on every HTTP request.
_SYNC_REDIS_LOCK = threading.Lock()
_SYNC_REDIS_CLIENTS: Dict[str, redis.Redis] = {}

LIVE_CONTAINER_LOGS_KEY_PREFIX = "live_container_logs:latest:"


def get_redis_client() -> redis.Redis:
    """Return a shared, connection-pooled synchronous Redis client."""
    redis_url = os.getenv("CELERY_RESULT_BACKEND", "redis://redis:6379/0")
    client = _SYNC_REDIS_CLIENTS.get(redis_url)
    if client is not None:
        return client
    with _SYNC_REDIS_LOCK:
        client = _SYNC_REDIS_CLIENTS.get(redis_url)
        if client is None:
            pool = redis.ConnectionPool.from_url(
                redis_url,
                max_connections=64,
                socket_connect_timeout=2.0,
                socket_timeout=2.0,
                health_check_interval=30,
            )
            client = redis.Redis(connection_pool=pool)
            _SYNC_REDIS_CLIENTS[redis_url] = client
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
        return "WARNING"
    # Highlight 5xx access logs or tracebacks even if emitted at INFO level
    if "Traceback (most recent call last)" in message or " 500 " in message or " 502 " in message or " 503 " in message:
        return "ERROR"
    return "INFO"


# ✅ ১. Non-Blocking Redis Log Handler + Docker-Socket-Free Live Container Feed
class RedisLogHandler(logging.Handler):
    """
    Captures Python log records and asynchronously:
      1. Publishes to `bot_logs` (legacy admin log channel).
      2. Maintains a 60-line ring buffer per container/service and flushes live
         `container_logs` batches every 2s to Redis Pub/Sub + snapshot cache so
         Sys Monitor -> Live Feed works in real time without mounting /var/run/docker.sock.
      3. Emits deduplicated ERROR/CRITICAL alerts to `system_alerts` when Docker
         socket monitoring is disabled.
    Runs completely off the asyncio event loop via a bounded queue + daemon thread.
    """

    LIVE_FEED_FLUSH_INTERVAL_SEC: float = 2.0
    LIVE_FEED_RING_SIZE: int = 60

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
        self._pool = redis.ConnectionPool.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            max_connections=4,
            socket_connect_timeout=1.5,
            socket_timeout=1.5,
            health_check_interval=30,
        )
        self.redis_client = redis.Redis(connection_pool=self._pool)
        self._queue: "queue.Queue[Tuple[str, str, str]]" = queue.Queue(maxsize=max_queue_size)
        self._ring: Deque[Dict[str, str]] = deque(maxlen=self.LIVE_FEED_RING_SIZE)
        self._dirty: bool = False
        self._last_flush_mono: float = 0.0
        self._stop_event = threading.Event()
        self._worker = threading.Thread(
            target=self._drain_loop,
            name=f"redis-log-publisher-{self.container_name}",
            daemon=True,
        )
        self._worker.start()

    def _flush_live_feed(self) -> None:
        if not self._ring:
            return
        batch = {
            "type": "container_logs",
            "container": self.container_name,
            "display_name": self.display_name,
            "lines": list(self._ring),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        payload_str = json.dumps(batch)
        try:
            pipe = self.redis_client.pipeline(transaction=False)
            pipe.setex(f"{LIVE_CONTAINER_LOGS_KEY_PREFIX}{self.container_name}", 300, payload_str)
            pipe.publish("container_logs", payload_str)
            pipe.execute()
        except Exception:
            pass
        self._dirty = False
        self._last_flush_mono = time.monotonic()

    def _maybe_publish_system_alert(self, line: str, level: str) -> None:
        if level not in ("ERROR", "CRITICAL"):
            return
        # Avoid duplicate alerts if Docker socket monitor is actively enabled
        if os.environ.get("DOCKER_HOST") or os.path.exists("/var/run/docker.sock"):
            return
        try:
            sig = hashlib.md5(f"{self.container_name}:{level}:{line[:160]}".encode("utf-8", "ignore")).hexdigest()
            dedup_key = f"sys_alert_live_dedup:{sig}"
            claimed = self.redis_client.set(dedup_key, "1", nx=True, ex=300)
            if not claimed:
                return
            alert_payload = json.dumps({
                "type": "system_alert",
                "id": f"live-{sig[:12]}-{int(time.time())}",
                "container": self.container_name,
                "display_name": self.display_name,
                "severity": level,
                "snippet": [line[:350]],
                "message": f"[{self.display_name}] {line[:600]}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            self.redis_client.publish("system_alerts", alert_payload)
        except Exception:
            pass

    def _drain_loop(self) -> None:
        while not self._stop_event.is_set():
            wait_s = min(0.5, max(0.02, self.LIVE_FEED_FLUSH_INTERVAL_SEC / 2.0))
            try:
                bot_log_payload, formatted_line, level = self._queue.get(timeout=wait_s)
                if self._publish_bot_logs and bot_log_payload:
                    try:
                        self.redis_client.publish("bot_logs", bot_log_payload)
                    except Exception:
                        pass
                self._ring.append({"line": formatted_line, "level": level})
                self._dirty = True
                if level in ("ERROR", "CRITICAL"):
                    self._maybe_publish_system_alert(formatted_line, level)
            except queue.Empty:
                pass

            if self._dirty and (time.monotonic() - self._last_flush_mono) >= self.LIVE_FEED_FLUSH_INTERVAL_SEC:
                self._flush_live_feed()

    def emit(self, record):
        try:
            # 🛑 Infinite Loop Prevention: ignore Redis client logs
            if "redis" in record.name or "aioredis" in record.name:
                return

            log_entry = self.format(record)
            if not log_entry:
                return

            ts_short = datetime.now(timezone.utc).strftime("%H:%M:%S")
            level = _normalize_log_level(record, log_entry)
            formatted_line = f"{ts_short} | {level} | {log_entry}"[:350]

            bot_log_payload = ""
            if self._publish_bot_logs:
                bot_log_payload = json.dumps({
                    "channel": "logs_backend",
                    "data": {
                        "time": ts_short,
                        "type": f"SYS-{record.levelname}",
                        "message": log_entry,
                    },
                })

            try:
                self._queue.put_nowait((bot_log_payload, formatted_line, level))
            except queue.Full:
                pass
        except Exception:
            self.handleError(record)

    def close(self) -> None:
        self._stop_event.set()
        super().close()


def attach_live_log_handler(
    logger_names: Tuple[str, ...] = ("app",),
    container_name: Optional[str] = None,
    publish_bot_logs: bool = False,
) -> RedisLogHandler:
    """Idempotently attach a non-blocking RedisLogHandler so service logs appear in Sys Monitor Live Feed."""
    handler = RedisLogHandler(container_name=container_name, publish_bot_logs=publish_bot_logs)
    handler.setFormatter(logging.Formatter("%(message)s"))
    for name in logger_names:
        target = logging.getLogger(name) if name else logging.getLogger()
        if not any(isinstance(h, RedisLogHandler) for h in target.handlers):
            target.addHandler(handler)
            if target.level == logging.NOTSET or target.level > logging.INFO:
                target.setLevel(logging.INFO)
    return handler
