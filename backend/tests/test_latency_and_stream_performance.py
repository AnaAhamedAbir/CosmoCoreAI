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


if __name__ == "__main__":
    unittest.main()
