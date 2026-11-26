"""Regression tests for MarketDataStreamer CPU/Redis flood prevention and event-loop non-blocking fixes."""

import asyncio
import importlib.util
import json
import os
import sys
import time
import types
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)


def _install_missing_stubs() -> None:
    """Install lightweight stubs only when third-party deps are unavailable (host dev env)."""
    if importlib.util.find_spec("redis") is None and "redis" not in sys.modules:
        redis_mod = types.ModuleType("redis")
        redis_exc = types.ModuleType("redis.exceptions")
        redis_async = types.ModuleType("redis.asyncio")

        class FakeConnectionPool:
            @classmethod
            def from_url(cls, url, **kwargs):
                inst = cls()
                inst.url = url
                inst.kwargs = kwargs
                return inst

        class FakeRedis:
            def __init__(self, connection_pool=None, **kwargs):
                self.connection_pool = connection_pool
                self.published = []
                self.kv = {}

            def publish(self, ch, msg):
                self.published.append((ch, msg))

            def setex(self, key, ttl, val):
                self.kv[key] = val

            def set(self, key, val, nx=False, ex=None):
                if nx and key in self.kv:
                    return False
                self.kv[key] = val
                return True

            def get(self, key):
                return self.kv.get(key)

            def pipeline(self, transaction=False):
                parent = self
                class _Pipe:
                    def setex(self, k, ttl, v):
                        parent.setex(k, ttl, v)
                    def publish(self, ch, msg):
                        parent.publish(ch, msg)
                    def execute(self):
                        return []
                return _Pipe()

        redis_mod.ConnectionPool = FakeConnectionPool
        redis_mod.Redis = FakeRedis
        redis_mod.from_url = lambda url, **kw: FakeRedis(FakeConnectionPool.from_url(url, **kw))
        redis_exc.ConnectionError = Exception
        redis_async.Redis = object
        redis_async.from_url = MagicMock()
        redis_mod.asyncio = redis_async
        redis_mod.exceptions = redis_exc
        sys.modules["redis"] = redis_mod
        sys.modules["redis.exceptions"] = redis_exc
        sys.modules["redis.asyncio"] = redis_async

    if importlib.util.find_spec("ccxt") is None and "ccxt" not in sys.modules:
        ccxt_mod = types.ModuleType("ccxt")
        ccxt_pro = types.ModuleType("ccxt.pro")
        ccxt_async = types.ModuleType("ccxt.async_support")
        ccxt_pro.Exchange = object
        ccxt_mod.pro = ccxt_pro
        ccxt_mod.async_support = ccxt_async
        sys.modules["ccxt"] = ccxt_mod
        sys.modules["ccxt.pro"] = ccxt_pro
        sys.modules["ccxt.async_support"] = ccxt_async

    if importlib.util.find_spec("fastapi") is None and "fastapi" not in sys.modules:
        fa = types.ModuleType("fastapi")
        fa_resp = types.ModuleType("fastapi.responses")
        fa.Request = object
        fa.HTTPException = Exception
        fa.status = SimpleNamespace(HTTP_403_FORBIDDEN=403, HTTP_503_SERVICE_UNAVAILABLE=503)
        fa_resp.JSONResponse = lambda status_code=200, content=None: SimpleNamespace(status_code=status_code, content=content)
        sys.modules["fastapi"] = fa
        sys.modules["fastapi.responses"] = fa_resp

    if importlib.util.find_spec("starlette") is None and "starlette" not in sys.modules:
        st = types.ModuleType("starlette")
        st_mw = types.ModuleType("starlette.middleware")
        st_base = types.ModuleType("starlette.middleware.base")

        class BaseHTTPMiddleware:
            def __init__(self, app=None):
                self.app = app

        st_base.BaseHTTPMiddleware = BaseHTTPMiddleware
        sys.modules["starlette"] = st
        sys.modules["starlette.middleware"] = st_mw
        sys.modules["starlette.middleware.base"] = st_base

    if importlib.util.find_spec("sqlalchemy") is None and "sqlalchemy" not in sys.modules:
        sa = types.ModuleType("sqlalchemy")
        sa_sql = types.ModuleType("sqlalchemy.sql")
        sa_orm = types.ModuleType("sqlalchemy.orm")
        sa_exc = types.ModuleType("sqlalchemy.exc")
        sa_sql.text = lambda s: s
        sa_orm.Session = object
        sa_exc.OperationalError = Exception
        sa.sql = sa_sql
        sa.orm = sa_orm
        sa.exc = sa_exc
        sys.modules["sqlalchemy"] = sa
        sys.modules["sqlalchemy.sql"] = sa_sql
        sys.modules["sqlalchemy.orm"] = sa_orm
        sys.modules["sqlalchemy.exc"] = sa_exc

    if importlib.util.find_spec("celery") is None and "app.core.celery_app" not in sys.modules:
        ca = types.ModuleType("app.core.celery_app")
        ca.celery_app = SimpleNamespace(control=SimpleNamespace(inspect=MagicMock()))
        sys.modules["app.core.celery_app"] = ca

    if "app.core.config" not in sys.modules:
        cfg = types.ModuleType("app.core.config")
        cfg.settings = SimpleNamespace(
            API_V1_STR="/api/v1",
            REDIS_URL="redis://localhost:6379/0",
            TRUST_PROXY_HEADERS=True,
        )
        sys.modules["app.core.config"] = cfg

    if "app.core.security" not in sys.modules:
        sec = types.ModuleType("app.core.security")
        sec.verify_token = MagicMock(return_value=None)
        sec.decrypt_key = lambda k: f"dec_{k}"
        sys.modules["app.core.security"] = sec

    if "app.db.session" not in sys.modules:
        dbs = types.ModuleType("app.db.session")
        dbs.SessionLocal = MagicMock()
        sys.modules["app.db.session"] = dbs

    if "app.models" not in sys.modules:
        m = types.ModuleType("app.models")
        m.User = type("User", (), {"email": None})
        m.ApiKey = type("ApiKey", (), {"id": None, "user_id": None, "is_enabled": True})
        sys.modules["app.models"] = m

    if "app.services.notification" not in sys.modules:
        notif = types.ModuleType("app.services.notification")
        notif.NotificationService = MagicMock()
        sys.modules["app.services.notification"] = notif

    if "app.services.bracket_order_service" not in sys.modules:
        bos = types.ModuleType("app.services.bracket_order_service")
        bos.bracket_order_service = MagicMock()
        bos.BracketOrderService = MagicMock()
        sys.modules["app.services.bracket_order_service"] = bos

    if "app.models.orderbook_snapshot" not in sys.modules:
        obs = types.ModuleType("app.models.orderbook_snapshot")
        obs.OrderBookSnapshot = lambda **kw: SimpleNamespace(**kw)
        sys.modules["app.models.orderbook_snapshot"] = obs

    if importlib.util.find_spec("websockets") is None and "websockets" not in sys.modules:
        sys.modules["websockets"] = types.ModuleType("websockets")


_install_missing_stubs()


class TestMarketDataStreamerPerformance(unittest.IsolatedAsyncioTestCase):
    async def test_exchange_instance_enables_new_updates(self):
        """MarketDataStreamer must pass newUpdates=True to CCXT Pro exchanges."""
        from app.services.market_data_streamer import MarketDataStreamer
        import ccxt.pro as ccxtpro

        captured_opts = {}

        class FakeBinance:
            def __init__(self, opts):
                captured_opts.update(opts)
                self.markets = {"BTC/USDT": {"spot": True}}

            async def close(self):
                pass

        streamer = MarketDataStreamer()
        await streamer.stop_all()
        try:
            with patch.object(ccxtpro, "binance", FakeBinance, create=True):
                ex = await streamer._get_exchange_instance("binance", "BTC/USDT")
                self.assertIsInstance(ex, FakeBinance)
                self.assertTrue(captured_opts.get("newUpdates"))
        finally:
            await streamer.stop_all()

    async def test_stream_trades_deduplicates_full_cache_and_compacts_payload(self):
        """Even if an exchange ignores newUpdates=True and returns 500 trades every tick,
        only genuinely new trades should be serialized, pushed to Redis, and fed to absorption."""
        from app.services.market_data_streamer import MarketDataStreamer, _compact_trade_dict

        raw_trade = {
            "id": "101",
            "timestamp": 1700000000000,
            "datetime": "2026-01-01T00:00:00Z",
            "symbol": "BTC/USDT",
            "side": "buy",
            "price": 90000.0,
            "amount": 0.5,
            "cost": 45000.0,
            "info": {"huge": "x" * 2000},
        }
        compact = _compact_trade_dict(raw_trade)
        self.assertNotIn("info", compact)
        self.assertEqual(compact["id"], "101")
        self.assertEqual(compact["price"], 90000.0)

        streamer = MarketDataStreamer()
        orig_flush = streamer.TRADES_FLUSH_INTERVAL_SEC
        streamer.TRADES_FLUSH_INTERVAL_SEC = 0.0

        initial_500 = [
            {
                "id": str(i),
                "timestamp": 1700000000000 + i,
                "symbol": "BTC/USDT",
                "side": "buy",
                "price": 90000.0 + i * 0.01,
                "amount": 0.1,
                "info": {"blob": "y" * 500},
            }
            for i in range(1, 501)
        ]
        second_501 = initial_500[1:] + [
            {
                "id": "501",
                "timestamp": 1700000000501,
                "symbol": "BTC/USDT",
                "side": "sell",
                "price": 90010.0,
                "amount": 0.2,
                "info": {"blob": "y" * 500},
            }
        ]

        call_count = 0
        stream_key = "binance:BTC/USDT"
        streamer._active_streams.add(stream_key)

        async def fake_watch_trades(_sym):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return initial_500
            if call_count == 2:
                return second_501
            streamer._active_streams.discard(stream_key)
            raise asyncio.CancelledError()

        fake_exchange = MagicMock()
        fake_exchange.watch_trades = AsyncMock(side_effect=fake_watch_trades)

        pushed_counts = []

        class FakePipeline:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            def rpush(self, key, *vals):
                pushed_counts.append(len(vals))
                for v in vals:
                    parsed = json.loads(v)
                    assert "info" not in parsed

            def ltrim(self, *args):
                pass

            def expire(self, *args):
                pass

            def publish(self, *args):
                pass

            async def execute(self):
                pass

        fake_redis = MagicMock()
        fake_redis.setex = AsyncMock()
        fake_redis.pipeline = MagicMock(return_value=FakePipeline())

        absorption_counts = []

        async def fake_process_trades(exchange_id, symbol, trades):
            absorption_counts.append(len(trades))

        try:
            with patch.object(streamer, "_get_exchange_instance", new=AsyncMock(return_value=fake_exchange)), \
                 patch("app.services.market_data_streamer.redis_manager.get_redis", return_value=fake_redis), \
                 patch("app.services.market_data_streamer.liquidity_absorption_service.process_trades", side_effect=fake_process_trades):
                await streamer._stream_trades("binance", "BTC/USDT", stream_key)
        finally:
            streamer.TRADES_FLUSH_INTERVAL_SEC = orig_flush
            streamer._active_streams.discard(stream_key)

        # First tick capped at 100 (not 500!), second tick pushed ONLY the 1 new trade (not 500!)
        self.assertEqual(pushed_counts, [100, 1])
        self.assertEqual(absorption_counts, [100, 1])

    async def test_stream_bbo_deduplicates_unchanged_quotes(self):
        """Unchanged @bookTicker ticks should NOT flood Redis setex."""
        from app.services.market_data_streamer import MarketDataStreamer

        streamer = MarketDataStreamer()
        orig_min = streamer.BBO_MIN_INTERVAL_SEC
        streamer.BBO_MIN_INTERVAL_SEC = 0.0
        stream_key = "binance:BTC/USDT"
        streamer._active_streams.add(stream_key)

        ticks = [
            {"BTC/USDT": {"bid": 90000.0, "ask": 90001.0}},
            {"BTC/USDT": {"bid": 90000.0, "ask": 90001.0}},  # duplicate
            {"BTC/USDT": {"bid": 90000.0, "ask": 90001.0}},  # duplicate
            {"BTC/USDT": {"bid": 90002.0, "ask": 90003.0}},  # changed!
        ]
        idx = 0

        async def fake_watch_bbo(_syms):
            nonlocal idx
            if idx < len(ticks):
                out = ticks[idx]
                idx += 1
                return out
            streamer._active_streams.discard(stream_key)
            raise asyncio.CancelledError()

        fake_exchange = MagicMock()
        fake_exchange.has = {"watchBidsAsks": True}
        fake_exchange.watch_bids_asks = AsyncMock(side_effect=fake_watch_bbo)

        fake_redis = MagicMock()
        fake_redis.setex = AsyncMock()

        try:
            with patch.object(streamer, "_get_exchange_instance", new=AsyncMock(return_value=fake_exchange)), \
                 patch("app.services.market_data_streamer.redis_manager.get_redis", return_value=fake_redis):
                await streamer._stream_bbo("binance", "BTC/USDT", stream_key)
        finally:
            streamer.BBO_MIN_INTERVAL_SEC = orig_min
            streamer._active_streams.discard(stream_key)

        # Only 2 Redis writes for 4 ticks (initial + changed), skipping 2 identical ticks
        self.assertEqual(fake_redis.setex.await_count, 2)

    async def test_acquire_release_and_idle_reaping(self):
        from app.services.market_data_streamer import MarketDataStreamer

        streamer = MarketDataStreamer()
        await streamer.stop_all()

        async def idle_coro(*args, **kwargs):
            await asyncio.sleep(60)

        with patch.object(streamer, "_stream_order_book", side_effect=idle_coro), \
             patch.object(streamer, "_stream_trades", side_effect=idle_coro), \
             patch.object(streamer, "_stream_bbo", side_effect=idle_coro):
            sk = await streamer.acquire_stream("binance", "ETH/USDT")
            self.assertIn(sk, streamer._active_streams)
            self.assertEqual(streamer._subscriber_counts.get(sk), 1)

            streamer.release_stream(sk)
            self.assertNotIn(sk, streamer._subscriber_counts)
            self.assertEqual(streamer._stream_idle_ttl.get(sk), streamer.WS_RELEASE_GRACE_SECONDS)

            await streamer.stop_streaming(sk)
            self.assertNotIn(sk, streamer._active_streams)
            await streamer.stop_all()


class TestRedisPoolingAndNonBlockingHandlers(unittest.IsolatedAsyncioTestCase):
    def test_get_redis_client_reuses_singleton_pool(self):
        from app import utils

        c1 = utils.get_redis_client()
        c2 = utils.get_redis_client()
        self.assertIs(c1, c2)

    def test_redis_log_handler_is_non_blocking(self):
        import logging
        from app.utils import RedisLogHandler

        handler = RedisLogHandler(max_queue_size=10)
        try:
            # Even if Redis publish hangs for 2s in background thread, emit() returns immediately (<20ms)
            handler.redis_client.publish = lambda ch, msg: time.sleep(0.5)
            t0 = time.perf_counter()
            record = logging.LogRecord("uvicorn.access", logging.INFO, "", 1, "GET /ping 200", (), None)
            handler.emit(record)
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            self.assertLess(elapsed_ms, 50.0)
        finally:
            handler.close()

    async def test_check_health_does_not_block_event_loop(self):
        """A slow 250ms sync Celery inspect must NOT block concurrent asyncio tasks."""
        from app.services.system_service import SystemService

        SystemService._celery_health_cache = None
        SystemService._celery_health_cached_at = 0.0

        def slow_active():
            time.sleep(0.25)
            return {"worker1": []}

        fake_inspector = MagicMock()
        fake_inspector.active = slow_active

        fake_db = MagicMock()
        fake_db.execute = MagicMock(return_value=1)

        fake_redis = MagicMock()
        fake_redis.ping = AsyncMock(return_value=True)

        ticks = 0

        async def ticker():
            nonlocal ticks
            for _ in range(8):
                await asyncio.sleep(0.02)
                ticks += 1

        t0 = time.perf_counter()
        with patch("app.services.system_service.celery_app.control.inspect", return_value=fake_inspector), \
             patch("app.services.system_service.redis_manager.get_redis", return_value=fake_redis):
            res, _ = await asyncio.gather(SystemService.check_health(fake_db), ticker())
        total = time.perf_counter() - t0

        self.assertEqual(res["status"], "healthy")
        self.assertEqual(res["services"]["celery_worker"], "online")
        self.assertEqual(ticks, 8)
        # Ran concurrently (~0.25s) rather than serially blocked (~0.41s)
        self.assertLess(total, 0.36)

    def test_middleware_fast_bypass_paths(self):
        from app.core.middleware import _is_fast_bypass_path
        from app.core.config import settings

        api = settings.API_V1_STR
        self.assertTrue(_is_fast_bypass_path(f"{api}/system/ping"))
        self.assertTrue(_is_fast_bypass_path(f"{api}/system/update-status"))
        self.assertTrue(_is_fast_bypass_path(f"{api}/system/health"))
        self.assertFalse(_is_fast_bypass_path(f"{api}/trading/manual"))

    def test_l2_collector_enqueue_bounded_batch(self):
        from app.services.l2_data_collector import L2DataCollector

        col = L2DataCollector()
        col._max_pending_rows = 10
        for i in range(25):
            col._enqueue_snapshot("BTCUSDT", [[1, 1]], [[2, 1]], 0.1, 1.0, 1.5, 1, 1.0, 0.5, 1.5, "Binance Spot")
        self.assertLessEqual(len(col._pending_rows), 10)

    def test_redis_log_handler_streams_live_container_logs_and_caches_snapshot(self):
        """RedisLogHandler must publish Docker-socket-free ContainerLogBatch + cache latest snapshot."""
        import logging
        from app.utils import RedisLogHandler, LIVE_CONTAINER_LOGS_KEY_PREFIX

        handler = RedisLogHandler(max_queue_size=50, container_name="cosmoquant_backend", publish_bot_logs=True)
        handler.LIVE_FEED_FLUSH_INTERVAL_SEC = 0.05
        try:
            rec_info = logging.LogRecord("app.main", logging.INFO, "", 1, "Order engine ready", (), None)
            rec_err = logging.LogRecord("app.main", logging.ERROR, "", 2, "Exchange timeout 503", (), None)
            handler.emit(rec_info)
            handler.emit(rec_err)
            time.sleep(0.25)

            cached_key = f"{LIVE_CONTAINER_LOGS_KEY_PREFIX}cosmoquant_backend"
            self.assertIn(cached_key, handler.redis_client.kv)
            batch = json.loads(handler.redis_client.kv[cached_key])
            self.assertEqual(batch["type"], "container_logs")
            self.assertEqual(batch["container"], "cosmoquant_backend")
            self.assertEqual(batch["display_name"], "BACKEND")
            self.assertGreaterEqual(len(batch["lines"]), 2)
            self.assertTrue(any("Order engine ready" in item["line"] for item in batch["lines"]))
            # Verify published to container_logs AND system_alerts (when docker.sock absent)
            channels = [ch for ch, _ in handler.redis_client.published]
            self.assertIn("container_logs", channels)
            self.assertIn("system_alerts", channels)
        finally:
            handler.close()

    async def test_measure_binance_latency_isolated_from_main_loop_stall(self):
        """
        Even if the main FastAPI event loop is stalled by 300ms while measure_binance_latency()
        is running, the isolated background probe loop must measure true fast probe RTT (<100ms).
        """
        from app.services.system_service import SystemService

        SystemService._binance_latency_cache = None
        SystemService._binance_latency_cached_at = 0.0

        async def fast_probes():
            await asyncio.sleep(0.015)
            return (18.4, 19.2, 22.1)

        async def stall_main_loop():
            await asyncio.sleep(0.002)
            time.sleep(0.30)  # Simulate 300ms synchronous stall on main loop

        with patch.object(SystemService, "_run_probes_coro", side_effect=fast_probes):
            res, _ = await asyncio.gather(
                SystemService.measure_binance_latency(force=True),
                stall_main_loop(),
            )

        self.assertEqual(res["binance_spot_ms"], 18.4)
        self.assertEqual(res["binance_futures_ms"], 19.2)
        self.assertEqual(res["binance_ws_ms"], 22.1)
        self.assertEqual(res["status"], "optimal")

    def test_manual_trade_service_caches_decrypted_credentials_and_api_key_lookup(self):
        """
        Repeat polls to ManualTradeService._get_exchange and _lookup_api_key_record
        must reuse cached decrypted credentials and API key records without re-running
        Fernet decrypt_key() or db.query() on the event loop.
        """
        from app.services.manual_trade_service import ManualTradeService

        ManualTradeService._DECRYPTED_CRED_CACHE.clear()
        ManualTradeService._API_KEY_RECORD_CACHE.clear()

        fake_rec = SimpleNamespace(
            id=4,
            user_id=5,
            exchange="binance",
            api_key="enc_api_key_4",
            secret_key="enc_sec_key_4",
            passphrase=None,
            is_enabled=True,
        )
        fake_db = MagicMock()
        fake_db.query.return_value.filter.return_value.first.return_value = fake_rec

        r1 = ManualTradeService._lookup_api_key_record(fake_db, 5, 4)
        r2 = ManualTradeService._lookup_api_key_record(fake_db, 5, 4)
        self.assertIs(r1, fake_rec)
        self.assertIs(r2, fake_rec)
        self.assertEqual(fake_db.query.call_count, 1)

        decrypt_calls = []

        def fake_decrypt(val):
            decrypt_calls.append(val)
            return f"dec_{val}"

        with patch("app.services.manual_trade_service.decrypt_key", side_effect=fake_decrypt), \
             patch("app.services.manual_trade_service.get_or_create_exchange", new=AsyncMock(return_value="fake_ex")):
            asyncio.run(ManualTradeService._get_exchange(fake_rec, True, purpose="order"))
            asyncio.run(ManualTradeService._get_exchange(fake_rec, True, purpose="order"))
            asyncio.run(ManualTradeService._get_exchange(fake_rec, False, purpose="general"))

        # decrypt_key called only once for api_key + once for secret_key across all 3 calls
        self.assertEqual(len(decrypt_calls), 2)


class TestLatencyWarningAndExecutionGuard(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from app.services.system_service import SystemService

        self._orig_cache = SystemService._binance_latency_cache
        self._orig_cached_at = SystemService._binance_latency_cached_at
        self._orig_guard_cache = SystemService._latency_guard_config_cache
        self._orig_guard_cached_at = SystemService._latency_guard_config_cached_at
        self._orig_alert_state = SystemService._last_published_latency_state
        self._orig_alert_ts = SystemService._last_latency_alert_ts

    async def asyncTearDown(self):
        from app.services.system_service import SystemService

        SystemService._binance_latency_cache = self._orig_cache
        SystemService._binance_latency_cached_at = self._orig_cached_at
        SystemService._latency_guard_config_cache = self._orig_guard_cache
        SystemService._latency_guard_config_cached_at = self._orig_guard_cached_at
        SystemService._last_published_latency_state = self._orig_alert_state
        SystemService._last_latency_alert_ts = self._orig_alert_ts

    async def test_evaluate_latency_health_and_enforce_guard(self):
        from fastapi import HTTPException
        from app.services.system_service import SystemService

        SystemService._latency_guard_config_cache = {
            "guard_enabled": True,
            "block_on_degraded": True,
            "binance_warn_ms": 1000,
            "binance_block_ms": 1200,
            "client_warn_ms": 1000,
            "client_block_ms": 1500,
        }
        SystemService._latency_guard_config_cached_at = time.monotonic()

        # Up to 500ms -> NORMAL (optimal), no warning, no guard block
        SystemService._binance_latency_cache = {
            "binance_spot_ms": 480.0,
            "binance_futures_ms": 490.0,
            "binance_ws_ms": 500.0,
            "status": "optimal",
        }
        SystemService._binance_latency_cached_at = time.monotonic()
        h_ok = SystemService.evaluate_latency_health(SystemService._binance_latency_cache)
        self.assertEqual(h_ok["severity"], "optimal")
        self.assertFalse(h_ok["should_warn"])
        self.assertFalse(h_ok["should_guard"])
        await SystemService.enforce_latency_guard(allow_probe=False, action_label="test order")

        # Warning threshold (>= 1000ms) -> rejects accidental new entry/bot start with HTTP 423 HIGH_LATENCY_GUARD
        SystemService._binance_latency_cache = {
            "binance_spot_ms": 1039.0,
            "binance_futures_ms": 1038.0,
            "binance_ws_ms": 1269.0,
            "status": "degraded",
        }
        SystemService._binance_latency_cached_at = time.monotonic()
        h_crit = SystemService.evaluate_latency_health(SystemService._binance_latency_cache)
        self.assertEqual(h_crit["severity"], "critical")
        self.assertTrue(h_crit["should_guard"])

        with self.assertRaises(HTTPException) as ctx:
            await SystemService.enforce_latency_guard(allow_probe=False, action_label="BTC/USDC Buy")
        self.assertEqual(ctx.exception.status_code, 423)
        self.assertIn("HIGH_LATENCY_GUARD", str(ctx.exception.detail))

        # Reduce-only / emergency exit must NEVER be blocked even under critical latency
        await SystemService.enforce_latency_guard(
            is_exit_or_reduce=True,
            allow_probe=False,
            action_label="emergency close",
        )

        # Explicit user override flag must be allowed
        await SystemService.enforce_latency_guard(
            confirm_high_latency=True,
            allow_probe=False,
            action_label="manual override",
        )

        # Paused guard must allow normal placement
        SystemService._latency_guard_config_cache["guard_enabled"] = False
        await SystemService.enforce_latency_guard(allow_probe=False, action_label="guard paused")

    async def test_latency_transition_emits_deduplicated_system_alert(self):
        from app.services.system_service import SystemService

        SystemService._latency_guard_config_cache = {
            "guard_enabled": True,
            "block_on_degraded": True,
            "binance_warn_ms": 1000,
            "binance_block_ms": 1200,
            "client_warn_ms": 1000,
            "client_block_ms": 1500,
        }
        SystemService._latency_guard_config_cached_at = time.monotonic()
        SystemService._last_published_latency_state = "optimal"
        SystemService._last_latency_alert_ts = 0.0

        published = []
        fake_redis = MagicMock()
        fake_redis.publish.side_effect = lambda ch, msg: published.append((ch, json.loads(msg)))

        with patch("app.services.system_service.get_redis_client", return_value=fake_redis):
            # 1st spike (>= 1200ms) -> emits CRITICAL NETWORK_LATENCY alert
            SystemService._maybe_publish_latency_alert({
                "binance_spot_ms": 1280.0,
                "binance_futures_ms": 1120.0,
                "binance_ws_ms": 1350.0,
                "status": "degraded",
            })
            # Repeat same critical state within 60s cooldown -> suppressed
            SystemService._maybe_publish_latency_alert({
                "binance_spot_ms": 1290.0,
                "binance_futures_ms": 1130.0,
                "binance_ws_ms": 1300.0,
                "status": "degraded",
            })
            # Recovery (<= 500ms) -> resets tracked state quietly
            SystemService._maybe_publish_latency_alert({
                "binance_spot_ms": 420.0,
                "binance_futures_ms": 440.0,
                "binance_ws_ms": 410.0,
                "status": "optimal",
            })
            # Subsequent new spike (>= 1000ms) after recovery -> emits a new WARNING alert cleanly
            SystemService._maybe_publish_latency_alert({
                "binance_spot_ms": 1020.0,
                "binance_futures_ms": 1050.0,
                "binance_ws_ms": 1010.0,
                "status": "degraded",
            })

        self.assertEqual(len(published), 2)
        self.assertEqual(published[0][0], "system_alerts")
        self.assertEqual(published[0][1]["type"], "system_alert")
        self.assertEqual(published[0][1]["container"], "network_latency")
        self.assertEqual(published[0][1]["display_name"], "Network & Exchange Latency")
        self.assertEqual(published[0][1]["severity"], "CRITICAL")
        self.assertIsInstance(published[0][1]["snippet"], list)
        self.assertEqual(published[1][1]["severity"], "WARNING")

    async def test_exchange_pool_uses_ipv4_and_edit_gtx_uses_parallel_1rtt(self):
        """
        Verify exchange_pool uses socket.AF_INET (no IPv6 fallback stalls) and
        ManualTradeService.edit_manual_trade skips doomed Futures GTX editOrder
        to execute cancel + create concurrently in 1 RTT wall-clock.
        """
        import socket
        from app.services import exchange_pool
        from app.services.manual_trade_service import ManualTradeService

        sess = exchange_pool._get_shared_http_session()
        if sess is not None:
            self.assertEqual(sess.connector._family, socket.AF_INET)

        fake_ex = MagicMock()
        fake_ex.id = "binance"
        fake_ex.urls = {"api": {"ws": {"ws-api": {"future": "wss://ws-fapi.binance.com/ws-fapi/v1"}}}}
        fake_ex.markets = {"BTC/USDC:USDC": {"id": "BTCUSDC", "symbol": "BTC/USDC:USDC", "linear": True, "inverse": False, "contractSize": 1.0}}
        fake_ex.has = {"editOrderWs": True, "editOrder": True, "createOrderWs": False}
        fake_ex.price_to_precision = lambda sym, px: str(round(float(px), 1))
        fake_ex.amount_to_precision = lambda sym, amt: str(round(float(amt), 3))
        fake_ex.edit_order_ws = AsyncMock(side_effect=AssertionError("Must skip doomed GTX edit_order_ws"))
        fake_ex.edit_order = AsyncMock(side_effect=AssertionError("Must skip doomed GTX edit_order"))

        events = []

        async def slow_cancel(*args, **kwargs):
            await asyncio.sleep(0.12)
            events.append("cancel_done")
            return {"id": "111", "status": "canceled"}

        async def slow_create(sym, otype, side, amt, px, params):
            await asyncio.sleep(0.12)
            events.append("create_done")
            return {"id": "222", "symbol": sym, "price": px, "amount": amt, "status": "open"}

        fake_ex.cancel_order = AsyncMock(side_effect=slow_cancel)
        fake_ex.create_order = AsyncMock(side_effect=slow_create)

        fake_rec = SimpleNamespace(
            id=99, user_id=5, exchange="binance", api_key="k", secret_key="s", passphrase=None, is_enabled=True
        )
        fake_db = MagicMock()
        fake_db.query.return_value.filter.return_value.first.return_value = fake_rec

        ManualTradeService._ORDER_META_CACHE[(99, "111")] = (
            {"id": "111", "side": "sell", "price": 62000.0, "amount": 0.01, "isSoftwareSL": False, "mode": "TP", "isPostOnly": True},
            time.time(),
        )
        try:
            from app.services import manual_trade_service as mts_mod

            with patch.object(ManualTradeService, "_get_exchange", new=AsyncMock(return_value=fake_ex)), \
                 patch.object(ManualTradeService, "_is_binance_hedge_mode", new=AsyncMock(return_value=False)), \
                 patch.object(mts_mod.bracket_order_service, "_cancel_futures_order_universal", new=AsyncMock(side_effect=slow_cancel)), \
                 patch.object(mts_mod.bracket_order_service, "_safe_price_to_precision", side_effect=lambda ex, sym, px: round(float(px), 1)), \
                 patch.object(mts_mod.bracket_order_service, "_safe_amount_to_precision", side_effect=lambda ex, sym, amt: round(float(amt), 3)):
                t0 = time.perf_counter()
                res = await ManualTradeService.edit_manual_trade(
                    db=fake_db,
                    user_id=5,
                    api_key_id=99,
                    order_id="111",
                    symbol="BTC/USDC:USDC",
                    side="sell",
                    amount=0.01,
                    new_price=62500.0,
                )
                elapsed_ms = (time.perf_counter() - t0) * 1000.0

            self.assertEqual(res["id"], "222")
            self.assertEqual(fake_ex.edit_order_ws.call_count, 0)
            self.assertEqual(fake_ex.edit_order.call_count, 0)
            # Both 120ms legs ran concurrently in ~120ms (not 240ms serial!)
            self.assertLess(elapsed_ms, 210.0)
        finally:
            ManualTradeService._ORDER_META_CACHE.pop((99, "111"), None)
            ManualTradeService._ORDER_META_CACHE.pop((99, "222"), None)
            await exchange_pool.close_all()

    async def test_spot_emergency_force_skips_redundant_cancel_and_unlock_loops(self):
        """
        Spot Emergency Force Buy with SmartPeg when no open order exists (-2011)
        must NOT fall back to REST cancel_all_orders and must NOT loop 6x fetch_balance
        even when other pairs hold non-zero `used` quote balance.
        """
        from app.services import manual_trade_service as mts_mod
        from app.services.manual_trade_service import ManualTradeService

        ManualTradeService._OPEN_ORDERS_CACHE.pop((77, "DOGE/FDUSD"), None)
        ManualTradeService._WALLET_BALANCE_CACHE.clear()

        fake_ex = MagicMock()
        fake_ex.id = "binance"
        fake_ex.apiKey = "k77"
        fake_ex.markets = {
            "DOGE/FDUSD": {
                "id": "DOGEFDUSD",
                "symbol": "DOGE/FDUSD",
                "base": "DOGE",
                "quote": "FDUSD",
                "spot": True,
                "linear": False,
                "inverse": False,
                "contractSize": 1.0,
            }
        }
        fake_ex.has = {"cancelAllOrdersWs": True, "createOrderWs": False}

        async def slow_ws_cancel_all(sym):
            await asyncio.sleep(0.08)
            raise Exception("binance -2011 Unknown order sent")

        async def slow_bal(*args, **kwargs):
            await asyncio.sleep(0.08)
            return {
                "FDUSD": {"free": 20.0, "used": 50.0, "total": 70.0},
                "DOGE": {"free": 0.0, "used": 0.0, "total": 0.0},
            }

        async def fast_bbo(*args, **kwargs):
            return {"bids": [[0.0567, 1000.0]], "asks": [[0.0568, 1000.0]]}

        fake_ex.cancel_all_orders_ws = AsyncMock(side_effect=slow_ws_cancel_all)
        fake_ex.cancel_all_orders = AsyncMock(side_effect=AssertionError("Must not call REST cancel_all_orders after -2011"))

        fake_rec = SimpleNamespace(
            id=77, user_id=5, exchange="binance", api_key="k", secret_key="s", passphrase=None, is_enabled=True
        )
        fake_db = MagicMock()
        fake_db.query.return_value.filter.return_value.first.return_value = fake_rec

        spawned_pegs = []

        async def fake_spawn_peg(**kwargs):
            spawned_pegs.append(kwargs)

        with patch.object(ManualTradeService, "_get_exchange", new=AsyncMock(return_value=fake_ex)), \
             patch.object(ManualTradeService, "get_open_limit_orders", new=AsyncMock(side_effect=AssertionError("Must not synchronously block on get_open_limit_orders"))), \
             patch.object(ManualTradeService, "_fetch_wallet_balance", new=AsyncMock(side_effect=slow_bal)) as m_bal, \
             patch.object(mts_mod.bracket_order_service, "_safe_amount_to_precision", side_effect=lambda ex, sym, amt: round(float(amt), 1)), \
             patch("app.services.user_order_stream.ensure_user_order_stream", return_value=None), \
             patch("app.services.smart_peg_entry_executor._fetch_bbo_fast", new=AsyncMock(side_effect=fast_bbo)), \
             patch("app.services.smart_peg_entry_executor.execute_smart_peg_entry", side_effect=fake_spawn_peg), \
             patch("app.services.smart_peg_entry_executor.stop_smart_peg", new=AsyncMock(return_value=0)):
            t0 = time.perf_counter()
            res = await ManualTradeService.execute_emergency_force_order(
                db=fake_db,
                user_id=5,
                api_key_id=77,
                symbol="DOGE/FDUSD",
                side="buy",
                execution_mode="limit_maker",
                size_pct=100.0,
            )
            await asyncio.sleep(0)
            elapsed_ms = (time.perf_counter() - t0) * 1000.0

        self.assertEqual(res["status"], "pegging")
        self.assertEqual(fake_ex.cancel_all_orders.call_count, 0)
        self.assertEqual(m_bal.call_count, 1)
        # Parallel wave completed in ~1 RTT (<160ms for two 80ms tasks)
        self.assertLess(elapsed_ms, 160.0)
        self.assertEqual(len(spawned_pegs), 1)
        self.assertIsNotNone(spawned_pegs[0]["preloaded_ob"])
        self.assertIsNotNone(spawned_pegs[0]["preloaded_balance"])

    async def test_cancel_and_close_use_order_pool_and_parallel_cleanup(self):
        from app.services.manual_trade_service import ManualTradeService
        from app.services.bracket_order_service import bracket_order_service
        import app.services.manual_smart_chase_executor as chase_mod
        import app.services.smart_peg_entry_executor as peg_mod
        import app.services.user_order_stream as stream_mod

        pool_purposes = []
        ws_orders = []
        cancelled_universal = []
        cancelled_all_calls = []

        class _CloseFakeEx:
            id = "binance"
            urls = {"api": {"fapiPrivate": "https://fapi.binance.com"}}
            has = {"createOrderWs": True, "cancelOrderWs": True}
            markets = {
                "ETH/USDT:USDT": {"id": "ETHUSDT", "base": "ETH", "quote": "USDT", "contractSize": 1.0, "inverse": False, "linear": True, "limits": {"cost": {"min": 5.0}}},
                "DOGE/FDUSD": {"id": "DOGEFDUSD", "base": "DOGE", "quote": "FDUSD", "limits": {"cost": {"min": 5.0}}},
            }

            def amount_to_precision(self, sym, amt):
                return str(round(float(amt), 4))

            async def create_order_ws(self, symbol, otype, side, amount, price=None, params=None):
                ws_orders.append((symbol, otype, side, float(amount), params))
                return {"id": "ws-close-1", "status": "closed", "filled": float(amount)}

            async def create_market_order(self, *args, **kwargs):
                raise AssertionError("Should not fall back to REST create_market_order when WS-API is ready")

            async def fetch_balance(self, params=None):
                return {"DOGE": {"free": 150.0, "used": 0.0, "total": 150.0}, "free": {"DOGE": 150.0}, "used": {"DOGE": 0.0}}

            async def cancel_all_orders(self, symbol, params=None):
                cancelled_all_calls.append((symbol, params))
                return []

        fake_ex = _CloseFakeEx()
        fake_key = SimpleNamespace(id=77, user_id=5, exchange="binance", is_enabled=True, api_key="enc", secret_key="enc")

        class _FakeQuery:
            def filter(self, *args, **kwargs):
                return self
            def first(self):
                return fake_key

        fake_db = MagicMock()
        fake_db.query.return_value = _FakeQuery()

        async def _fake_get_exchange(rec, is_fut, purpose="general"):
            pool_purposes.append((is_fut, purpose))
            return fake_ex

        async def _fake_cancel_universal(ex, oid, sym, is_conditional=False):
            cancelled_universal.append((str(oid), sym))
            return {"status": "canceled", "id": oid}

        async def _noop_async(*args, **kwargs):
            return 0

        sw_sl_dict = {
            "sl_fut_1": {
                "api_key_id": 77,
                "symbol": "ETH/USDT:USDT",
                "tp_order_id": "tp_fut_1",
                "disaster_sl_order_id": "dis_fut_1",
                "cancelled": False,
            }
        }

        with patch.object(ManualTradeService, "_get_exchange", side_effect=_fake_get_exchange), \
             patch.object(ManualTradeService, "get_active_position", new=AsyncMock(return_value={"amount": 1.25, "side": "long", "contracts": 0})), \
             patch.object(ManualTradeService, "_is_binance_hedge_mode", new=AsyncMock(return_value=False)), \
             patch("app.services.manual_trade_service.is_ws_api_ready", return_value=True), \
             patch.object(bracket_order_service, "ACTIVE_SOFTWARE_SL", sw_sl_dict), \
             patch.object(bracket_order_service, "ACTIVE_ENTRY_BRACKETS", {}), \
             patch.object(bracket_order_service, "ACTIVE_ENTRY_MONITORS", {}), \
             patch.object(bracket_order_service, "_safe_amount_to_precision", side_effect=lambda ex, sym, amt: round(float(amt), 4)), \
             patch.object(bracket_order_service, "_cancel_futures_order_universal", side_effect=_fake_cancel_universal), \
             patch.object(chase_mod, "stop_smart_chase", side_effect=_noop_async), \
             patch.object(peg_mod, "stop_smart_peg", side_effect=_noop_async), \
             patch.object(stream_mod, "ensure_user_order_stream", return_value=None), \
             patch.object(stream_mod, "publish_order_sync_event", new=AsyncMock()), \
             patch("app.services.manual_trade_persistence.schedule_mark_terminal", MagicMock()), \
             patch("app.services.manual_trade_persistence.schedule_mark_terminal_by_scope", MagicMock()), \
             patch("app.services.manual_trade_service._send_trade_fired_notification", new=AsyncMock()), \
             patch("app.services.manual_trade_service._emit_manual_trade_in_app", new=AsyncMock()):
            fut_close = await ManualTradeService.close_active_position(fake_db, 5, 77, "ETH/USDT:USDT")
            spot_close = await ManualTradeService.close_active_position(fake_db, 5, 77, "DOGE/FDUSD")
            await ManualTradeService.cancel_manual_order(fake_db, 5, 77, "ord_99", "ETH/USDT:USDT")
            await ManualTradeService.cancel_all_manual_orders(fake_db, 5, 77, "ETH/USDT:USDT")

        self.assertTrue(fut_close["success"])
        self.assertTrue(spot_close["success"])
        # All 4 calls must use purpose="order" unthrottled pool
        self.assertEqual(pool_purposes, [(True, "order"), (False, "order"), (True, "order"), (True, "order")])
        # Both Futures TP and Disaster SL cancelled before WS Market Close
        cancelled_oids = {x[0] for x in cancelled_universal}
        self.assertIn("tp_fut_1", cancelled_oids)
        self.assertIn("dis_fut_1", cancelled_oids)
        # Futures & Spot close used create_order_ws
        self.assertEqual(len(ws_orders), 2)
        self.assertEqual(ws_orders[0][0], "ETH/USDT:USDT")
        self.assertEqual(ws_orders[1][0], "DOGE/FDUSD")
        # Spot close did not waste a REST cancel_all_orders call when no open/locked orders existed (only cancel_all_manual_orders called cancel_all_orders)
        self.assertEqual([c[0] for c in cancelled_all_calls], ["ETH/USDT:USDT", "ETH/USDT:USDT"])

    async def test_smart_chase_uses_order_pool_ws_api_and_fast_bbo_polling(self):
        import app.services.manual_smart_chase_executor as chase_mod
        from app.services.manual_trade_service import ManualTradeService
        import app.services.smart_peg_entry_executor as peg_mod

        bbo_calls = {"n": 0}
        ws_actions = []

        async def _fake_bbo(exchange, symbol):
            bbo_calls["n"] += 1
            # First quote: 100.0 / 100.1; subsequent urgent shift (3+ ticks away): 99.5 / 99.6
            if bbo_calls["n"] <= 2:
                return {"bids": [[100.0, 5.0]], "asks": [[100.1, 5.0]]}
            return {"bids": [[99.5, 5.0]], "asks": [[99.6, 5.0]]}

        class _ChaseFakeEx:
            id = "binance"
            urls = {"api": {"fapiPrivate": "https://fapi.binance.com"}}
            has = {"createOrderWs": True, "editOrderWs": True, "cancelOrderWs": True, "editOrder": True}
            markets = {
                "SOL/USDT:USDT": {
                    "id": "SOLUSDT",
                    "base": "SOL",
                    "quote": "USDT",
                    "contractSize": 1.0,
                    "inverse": False,
                    "linear": True,
                    "precision": {"price": 0.1, "amount": 0.1},
                    "limits": {"cost": {"min": 5.0}},
                }
            }

            def price_to_precision(self, sym, px):
                return str(round(float(px), 1))

            def amount_to_precision(self, sym, amt):
                return str(round(float(amt), 1))

            async def create_order_ws(self, symbol, otype, side, amount, price=None, params=None):
                ws_actions.append(("create_ws", otype, side, float(price or 0.0), dict(params or {})))
                if len([a for a in ws_actions if a[0] == "create_ws"]) == 1:
                    return {"id": "chase-ws-1", "status": "open", "filled": 0.0}
                return {"id": "chase-ws-2", "status": "closed", "filled": float(amount), "average": float(price or 99.6)}

            async def cancel_order_ws(self, oid, symbol):
                ws_actions.append(("cancel_ws", str(oid)))
                return {"id": oid, "status": "canceled"}

            async def edit_order_ws(self, *args, **kwargs):
                raise AssertionError("Futures GTX must skip editOrderWs (-5026) and use PARALLEL-1RTT")

            async def edit_order(self, *args, **kwargs):
                raise AssertionError("Futures GTX must skip REST editOrder (-5026) and use PARALLEL-1RTT")

            async def fetch_order(self, oid, symbol):
                return {"id": oid, "status": "open", "filled": 0.0}

        fake_ex = _ChaseFakeEx()
        fake_key = SimpleNamespace(id=88, user_id=5, exchange="binance", is_enabled=True, api_key="enc", secret_key="enc")

        t0 = time.perf_counter()
        with patch.object(ManualTradeService, "_get_exchange", new=AsyncMock(return_value=fake_ex)) as mock_get_ex, \
             patch.object(ManualTradeService, "_is_binance_hedge_mode", new=AsyncMock(return_value=False)), \
             patch.object(chase_mod, "_get_live_position_contracts", new=AsyncMock(return_value=2.0)), \
             patch.object(peg_mod, "_fetch_bbo_fast", side_effect=_fake_bbo), \
             patch("app.services.manual_trade_persistence.schedule_update_monitor", MagicMock()), \
             patch("app.services.manual_trade_persistence.schedule_mark_terminal", MagicMock()), \
             patch("app.services.exchange_pool.is_ws_api_ready", return_value=True):
            res = await chase_mod.execute_manual_smart_chase(
                exchange=fake_ex,
                symbol="SOL/USDT:USDT",
                exit_side="sell",
                sell_amount_raw=2.0,
                entry_price=101.0,
                original_sl=100.0,
                max_deviation_pct=2.0,
                chase_delay_ms=1500,
                max_attempts=4,
                is_futures=True,
                user_id=5,
                api_key_record=fake_key,
                chase_id="test_chase_fast_bbo",
                chase_mode="dynamic_bbo",
                peg_strategy="bbo",
            )
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        self.assertEqual(res.get("status"), "closed")
        self.assertEqual(res.get("id"), "chase-ws-2")
        mock_get_ex.assert_awaited_once_with(fake_key, True, purpose="order")
        # Initial GTX create_order_ws + urgent BBO PARALLEL-1RTT (cancel_order_ws + create_order_ws)
        self.assertEqual([a[0] for a in ws_actions], ["create_ws", "cancel_ws", "create_ws"])
        # Must trigger within fast 40ms BBO sampling (not stuck on old 250ms sleep!)
        self.assertLess(elapsed_ms, 220.0)


if __name__ == "__main__":
    unittest.main()
