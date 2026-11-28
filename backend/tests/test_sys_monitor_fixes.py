import io
import json
import logging
import os
import sys
import time
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class FakeRedis:
    """In-memory Redis double supporting lists, keys, set-nx, and pub/sub."""

    def __init__(self):
        self.kv = {}
        self.lists = {}
        self.published = []

    def set(self, key, val, nx=False, ex=None):
        if nx and key in self.kv:
            return False
        self.kv[key] = val
        return True

    def setex(self, key, ttl, val):
        self.kv[key] = val
        return True

    def get(self, key):
        return self.kv.get(key)

    def delete(self, key):
        self.kv.pop(key, None)
        self.lists.pop(key, None)
        return 1

    def lpush(self, key, *vals):
        lst = self.lists.setdefault(key, [])
        for v in vals:
            lst.insert(0, v)
        return len(lst)

    def rpush(self, key, *vals):
        lst = self.lists.setdefault(key, [])
        lst.extend(vals)
        return len(lst)

    def ltrim(self, key, start, end):
        lst = self.lists.get(key, [])
        n = len(lst)
        s = start if start >= 0 else max(0, n + start)
        e = end if end >= 0 else n + end
        self.lists[key] = lst[s : e + 1] if e >= s else []
        return True

    def lrange(self, key, start, end):
        lst = self.lists.get(key, [])
        n = len(lst)
        s = start if start >= 0 else max(0, n + start)
        e = end if end >= 0 else n + end
        return lst[s : e + 1] if e >= s else []

    def lset(self, key, idx, val):
        self.lists[key][idx] = val
        return True

    def expire(self, key, ttl):
        return True

    def publish(self, channel, payload):
        self.published.append((channel, payload))
        return 1

    def pipeline(self, transaction=False):
        return _FakePipeline(self)


class _FakePipeline:
    def __init__(self, r: FakeRedis):
        self._r = r
        self._ops = []

    def __getattr__(self, name):
        def _record(*args, **kwargs):
            self._ops.append((name, args, kwargs))
            return self
        return _record

    def execute(self):
        results = []
        for name, args, kwargs in self._ops:
            results.append(getattr(self._r, name)(*args, **kwargs))
        self._ops.clear()
        return results


class TestSysMonitorFixes(unittest.TestCase):
    def test_classify_log_line_detects_previously_missed_errors(self):
        from app.services.log_monitor_service import classify_log_line, CONTAINERS_TO_MONITOR

        # 1. All real docker-compose containers are monitored
        for expected in (
            "cosmoquant_backend",
            "cosmo_celery_worker_default",
            "cosmo_celery_worker_heavy",
            "cosmo_celery_beat",
            "cosmo_telegram_bot",
            "cosmoquant_nginx",
        ):
            self.assertIn(expected, CONTAINERS_TO_MONITOR)

        # 2. Previously broken `\bError:\b` regex now catches Python exceptions with space after colon
        self.assertEqual(classify_log_line("ValueError: invalid literal for int() with base 10"), "ERROR")
        self.assertEqual(classify_log_line("KeyError: 'entry_price'"), "ERROR")
        self.assertEqual(classify_log_line("RuntimeError: event loop is closed"), "ERROR")
        self.assertEqual(classify_log_line("psycopg2.errors.UndefinedColumn: column does not exist"), "ERROR")

        # 3. Uvicorn 500 access log with NO trailing space after 500
        self.assertEqual(
            classify_log_line('INFO: 127.0.0.1:54321 - "POST /api/v1/bots/start HTTP/1.1" 500'),
            "ERROR",
        )
        # 4. Normal 200 OK INFO access log is still ignored
        self.assertIsNone(
            classify_log_line('INFO: 127.0.0.1:54321 - "GET /api/v1/bots HTTP/1.1" 200')
        )

        # 5. ASGI / asyncio task crashes & Postgres PANIC are CRITICAL
        self.assertEqual(classify_log_line("Exception in ASGI application"), "CRITICAL")
        self.assertEqual(classify_log_line("Task exception was never retrieved"), "CRITICAL")
        self.assertEqual(classify_log_line("2026-11-28 09:00:00 UTC PANIC: could not write to WAL"), "CRITICAL")

        # 6. Printed emoji error lines are caught
        self.assertEqual(classify_log_line("❌ Backtest Error: division by zero"), "ERROR")

    def test_traceback_fingerprints_do_not_collide(self):
        from app.services.log_monitor_service import make_fingerprint

        tb1 = [
            "Traceback (most recent call last):",
            '  File "/app/app/services/a.py", line 10, in foo',
            "    return 1 / 0",
            "ZeroDivisionError: division by zero",
        ]
        tb2 = [
            "Traceback (most recent call last):",
            '  File "/app/app/services/b.py", line 42, in bar',
            "    return d['missing']",
            "KeyError: 'missing'",
        ]
        fp1 = make_fingerprint("cosmoquant_backend", tb1[0], tb1)
        fp2 = make_fingerprint("cosmoquant_backend", tb2[0], tb2)
        self.assertNotEqual(fp1, fp2)
        self.assertIn("zerodivisionerror", fp1)
        self.assertIn("keyerror", fp2)

    def test_interleaved_info_line_does_not_suppress_error_in_docker_scan(self):
        import asyncio
        from app.services.log_monitor_service import (
            scan_docker_logs_and_notify,
            SYS_ALERTS_HISTORY_KEY,
        )

        fake_redis = FakeRedis()
        sample_logs = "\n".join([
            "2026-11-28T09:00:01Z ERROR:app.services.bot: Order sync crashed with KeyError: 'status'",
            '2026-11-28T09:00:01Z INFO: 127.0.0.1:50000 - "GET /api/v1/portfolio HTTP/1.1" 200 OK',
            "2026-11-28T09:00:02Z Traceback (most recent call last):",
            '2026-11-28T09:00:02Z   File "/app/app/main.py", line 99, in run',
            "2026-11-28T09:00:02Z     raise RuntimeError('boom')",
            "2026-11-28T09:00:02Z RuntimeError: boom",
            "2026-11-28T09:00:02Z INFO: background heartbeat ok",
        ]).encode("utf-8")

        fake_container = MagicMock()
        fake_container.logs.return_value = sample_logs

        fake_docker_client = MagicMock()
        def _get_container(name):
            if name == "cosmoquant_backend":
                return fake_container
            raise Exception("not found")
        fake_docker_client.containers.get.side_effect = _get_container

        fake_docker_mod = MagicMock()
        fake_docker_mod.from_env.return_value = fake_docker_client
        fake_docker_mod.errors.NotFound = KeyError

        with patch("app.services.log_monitor_service.is_docker_daemon_configured", return_value=True), \
             patch("app.utils.get_redis_client", return_value=fake_redis), \
             patch.dict(sys.modules, {"docker": fake_docker_mod}):
            # Even with active_users=[] and wants_broadcast=None, Sys Monitor MUST still record alerts!
            asyncio.run(scan_docker_logs_and_notify(active_users=[], wants_broadcast=None))

        history = [json.loads(x) for x in fake_redis.lrange(SYS_ALERTS_HISTORY_KEY, 0, -1)]
        self.assertEqual(len(history), 2, f"Expected 2 persisted alerts, got {history}")
        severities = {h["severity"] for h in history}
        self.assertEqual(severities, {"ERROR", "CRITICAL"})

    def test_redis_log_handler_dedup_and_persistence_without_timestamp_drift(self):
        from app.utils import RedisLogHandler
        from app.services.log_monitor_service import SYS_ALERTS_HISTORY_KEY

        fake_redis = FakeRedis()
        handler = RedisLogHandler(max_queue_size=50, container_name="cosmoquant_backend", publish_bot_logs=False)
        handler.redis_client = fake_redis
        handler.setFormatter(logging.Formatter("%(message)s"))
        try:
            with patch.dict(os.environ, {"DOCKER_HOST": ""}, clear=False), \
                 patch("os.path.exists", return_value=False):
                # Same error logged twice across different times must deduplicate cleanly (1 alert, not 2)
                handler._maybe_publish_system_alert("Database pool exhausted on primary", "ERROR", logger_name="app.core.redis")
                handler._maybe_publish_system_alert("Database pool exhausted on primary", "ERROR", logger_name="app.core.redis")
                # Distinct traceback alert must NOT collide
                handler._maybe_publish_system_alert(
                    "Traceback (most recent call last):\n  File 'x.py', line 1\nValueError: bad price",
                    "CRITICAL",
                    logger_name="app.services.trading",
                )
            history = [json.loads(x) for x in fake_redis.lrange(SYS_ALERTS_HISTORY_KEY, 0, -1)]
            self.assertEqual(len(history), 2)
            self.assertEqual(history[0]["severity"], "CRITICAL")
            self.assertIn("ValueError: bad price", history[0]["snippet"][-1])
            self.assertEqual(history[1]["logger"], "app.core.redis")
        finally:
            handler.close()

    def test_error_tee_stream_captures_printed_errors_and_tracebacks(self):
        from app.utils import _ErrorTeeStream

        buf = io.StringIO()
        captured = []
        fake_handler = MagicMock()
        fake_handler.enqueue_raw_event.side_effect = lambda **kw: captured.append(kw)

        tee = _ErrorTeeStream(buf, fake_handler, "stderr")
        tee.write("Normal startup info line\n")
        tee.write("❌ Backtest Error: connection dropped\n")
        tee.write("❌ Critical Bot Error: kernel panic\n")
        tee.write("Traceback (most recent call last):\n")
        tee.write('  File "worker.py", line 12, in run\n')
        tee.write("ZeroDivisionError: division by zero\n")

        self.assertEqual(len(captured), 3)
        self.assertEqual(captured[0]["level"], "ERROR")
        self.assertIn("Backtest Error", captured[0]["message"])
        self.assertEqual(captured[1]["level"], "CRITICAL")
        self.assertIn("Critical Bot Error", captured[1]["message"])
        self.assertEqual(captured[2]["level"], "CRITICAL")
        self.assertIn("ZeroDivisionError", captured[2]["message"])

    def test_http_5xx_exception_handler_logs_error(self):
        import asyncio
        from fastapi import HTTPException
        from app.core.errors import http_exception_handler

        fake_req = MagicMock()
        fake_req.method = "POST"
        fake_req.url.path = "/api/v1/system/prune-db"

        with self.assertLogs("app.core.errors", level="ERROR") as cm:
            resp = asyncio.run(http_exception_handler(fake_req, HTTPException(status_code=500, detail="DB crashed")))
        self.assertEqual(resp.status_code, 500)
        self.assertTrue(any("HTTP 500 Server Error" in line and "DB crashed" in line for line in cm.output))

    def test_redis_log_handler_fork_recovery_and_sync_flush(self):
        from app.utils import RedisLogHandler, LIVE_CONTAINER_LOGS_KEY_PREFIX
        from app.services.log_monitor_service import SYS_ALERTS_HISTORY_KEY

        fake_redis = FakeRedis()
        handler = RedisLogHandler(max_queue_size=50, container_name="cosmo_celery_worker_heavy", publish_bot_logs=False)
        try:
            # Simulate Linux os.fork() where parent PID differs from child PID
            handler._pid = -99999
            with patch("app.utils.redis.ConnectionPool.from_url", return_value=MagicMock()), \
                 patch("app.utils.redis.Redis", return_value=fake_redis), \
                 patch.dict(os.environ, {"DOCKER_HOST": "", "DISABLE_LIVE_TELEGRAM_ALERTS": "1"}, clear=False), \
                 patch("os.path.exists", return_value=False):
                handler.ensure_worker_alive()
                self.assertEqual(handler._pid, os.getpid())
                self.assertTrue(handler._worker.is_alive())

                # Enqueue error and immediately flush() as --max-tasks-per-child=1 does on exit
                rec = logging.LogRecord(
                    "celery.redirected",
                    logging.WARNING,
                    "",
                    1,
                    "❌ Market News Fetch Failed: upstream 502",
                    (),
                    None,
                )
                handler.emit(rec)
                handler.flush(timeout=1.0)

            snap_key = f"{LIVE_CONTAINER_LOGS_KEY_PREFIX}cosmo_celery_worker_heavy"
            self.assertIn(snap_key, fake_redis.kv)
            history = [json.loads(x) for x in fake_redis.lrange(SYS_ALERTS_HISTORY_KEY, 0, -1)]
            self.assertEqual(len(history), 1)
            self.assertEqual(history[0]["severity"], "ERROR")
            self.assertEqual(history[0]["container"], "cosmo_celery_worker_heavy")
        finally:
            handler.close()

    def test_live_error_dispatches_telegram_in_dockerless_mode(self):
        from app.utils import RedisLogHandler

        fake_redis = FakeRedis()
        handler = RedisLogHandler(max_queue_size=20, container_name="cosmoquant_backend", publish_bot_logs=False)
        handler.redis_client = fake_redis
        try:
            with patch.dict(os.environ, {"DOCKER_HOST": ""}, clear=False), \
                 patch("os.path.exists", return_value=False), \
                 patch("app.utils._dispatch_telegram_alert_async_thread") as mock_tg:
                os.environ.pop("DISABLE_LIVE_TELEGRAM_ALERTS", None)
                handler._maybe_publish_system_alert(
                    "OperationalError: connection to server failed",
                    "ERROR",
                    logger_name="app.db",
                )
                self.assertEqual(mock_tg.call_count, 1)
        finally:
            handler.close()


if __name__ == "__main__":
    unittest.main()
