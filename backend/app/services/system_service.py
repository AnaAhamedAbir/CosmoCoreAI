
import asyncio
import logging
import os
import platform
import shutil
import socket
import threading
import time
import glob
from typing import Any, Dict, Optional
try:
    import psutil
except ImportError:
    psutil = None  # type: ignore[assignment]
try:
    import aiohttp
except ImportError:
    aiohttp = None  # type: ignore[assignment]
from sqlalchemy.sql import text
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError
from redis.exceptions import ConnectionError
from app.core.celery_app import celery_app
from app.core.redis import redis_manager

logger = logging.getLogger(__name__)

# Prime psutil's non-blocking CPU delta counter at module load
try:
    if psutil is not None:
        psutil.cpu_percent(interval=None)
except Exception:
    pass


def _read_proc_meminfo() -> Dict[str, float]:
    """Read Linux /proc/meminfo when psutil is unavailable."""
    gb = 1024 ** 3
    info_kb: Dict[str, int] = {}
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as mf:
            for line in mf:
                parts = line.split(":")
                if len(parts) == 2:
                    val = parts[1].strip().split()[0]
                    if val.isdigit():
                        info_kb[parts[0].strip()] = int(val)
    except Exception:
        return {"total_gb": 0.0, "used_gb": 0.0, "available_gb": 0.0, "percent": 0.0}

    total_b = info_kb.get("MemTotal", 0) * 1024
    avail_b = info_kb.get("MemAvailable", info_kb.get("MemFree", 0)) * 1024
    used_b = max(0, total_b - avail_b)
    pct = round((used_b / total_b) * 100.0, 1) if total_b > 0 else 0.0
    return {
        "total_gb": round(total_b / gb, 2),
        "used_gb": round(used_b / gb, 2),
        "available_gb": round(avail_b / gb, 2),
        "percent": pct,
    }


def _read_vps_cpu_temperature() -> Dict[str, Any]:
    """Read host/VPS CPU temperature from psutil or Linux sysfs thermal zones."""
    preferred_keys = ("coretemp", "k10temp", "zenpower", "cpu_thermal", "x86_pkg_temp", "acpitz")
    try:
        if psutil is not None and hasattr(psutil, "sensors_temperatures"):
            temps = psutil.sensors_temperatures(fahrenheit=False) or {}
            best: Optional[tuple[float, str]] = None
            for key in preferred_keys:
                entries = temps.get(key)
                if entries:
                    for entry in entries:
                        if entry.current is not None and 0 < entry.current < 150:
                            label = entry.label or key
                            if best is None or entry.current > best[0]:
                                best = (float(entry.current), label)
                    if best is not None:
                        return {"cpu_temp_c": round(best[0], 1), "sensor_label": best[1], "available": True}
            for key, entries in temps.items():
                for entry in entries or []:
                    if entry.current is not None and 0 < entry.current < 150:
                        return {
                            "cpu_temp_c": round(float(entry.current), 1),
                            "sensor_label": entry.label or key,
                            "available": True,
                        }
    except Exception:
        pass

    # Linux sysfs fallback (useful inside privileged/mounted containers)
    try:
        for zone_path in sorted(glob.glob("/sys/class/thermal/thermal_zone*")):
            temp_file = os.path.join(zone_path, "temp")
            type_file = os.path.join(zone_path, "type")
            if not os.path.isfile(temp_file):
                continue
            with open(temp_file, "r", encoding="utf-8") as tf:
                raw_val = tf.read().strip()
            celsius = float(raw_val) / (1000.0 if float(raw_val) > 1000 else 1.0)
            if 0 < celsius < 150:
                zone_type = os.path.basename(zone_path)
                if os.path.isfile(type_file):
                    with open(type_file, "r", encoding="utf-8") as zf:
                        zone_type = zf.read().strip() or zone_type
                return {"cpu_temp_c": round(celsius, 1), "sensor_label": zone_type, "available": True}
    except Exception:
        pass

    return {"cpu_temp_c": None, "sensor_label": None, "available": False}

class SystemService:
    _celery_health_cache: Optional[str] = None
    _celery_health_cached_at: float = 0.0
    _CELERY_HEALTH_CACHE_TTL_SEC: float = 10.0

    @classmethod
    async def check_health(cls, db: Session):
        """
        Check the health of critical system components: Database, Redis, Celery.
        All synchronous I/O (DB SELECT 1, Celery inspect) is offloaded via asyncio.to_thread
        so health checks can NEVER stall the FastAPI event loop.
        """
        services_status = {
            "database": "unknown",
            "redis": "unknown",
            "celery_worker": "unknown"
        }

        # 1. Database Check (offloaded off event loop)
        try:
            await asyncio.to_thread(db.execute, text("SELECT 1"))
            services_status["database"] = "online"
        except Exception as e:
            logger.error(f"Health Check - Database Error: {e}")
            services_status["database"] = "offline"

        # 2. Redis Check (native async)
        try:
            redis_client = redis_manager.get_redis()
            if redis_client:
                await redis_client.ping()
                services_status["redis"] = "online"
            else:
                services_status["redis"] = "offline"
        except Exception as e:
            logger.error(f"Health Check - Redis Error: {e}")
            services_status["redis"] = "offline"

        # 3. Celery Worker Check (offloaded to worker thread + 10s TTL cache)
        now = time.monotonic()
        if (
            cls._celery_health_cache is not None
            and (now - cls._celery_health_cached_at) < cls._CELERY_HEALTH_CACHE_TTL_SEC
        ):
            services_status["celery_worker"] = cls._celery_health_cache
        else:
            def _inspect_celery_sync() -> str:
                inspector = celery_app.control.inspect(timeout=1.5)
                stats = inspector.active()
                return "online" if stats is not None else "offline"

            try:
                celery_state = await asyncio.to_thread(_inspect_celery_sync)
                services_status["celery_worker"] = celery_state
                cls._celery_health_cache = celery_state
                cls._celery_health_cached_at = time.monotonic()
            except Exception as e:
                logger.error(f"Health Check - Celery Error: {e}")
                services_status["celery_worker"] = "error"

        # Determine overall status
        if services_status["database"] != "online" or services_status["redis"] != "online":
            overall_status = "unhealthy"
        elif services_status["celery_worker"] != "online":
            overall_status = "degraded"
        else:
            overall_status = "healthy"

        return {
            "status": overall_status,
            "services": services_status,
            "timestamp": "now"
        }

    @staticmethod
    def get_hardware_telemetry() -> Dict[str, Any]:
        """Collect VPS CPU, RAM, disk/ROM, uptime, and thermal telemetry safely."""
        gb = 1024 ** 3
        cores_logical = (psutil.cpu_count(logical=True) if psutil is not None else None) or os.cpu_count() or 1
        cores_physical = (psutil.cpu_count(logical=False) if psutil is not None else None) or cores_logical

        load_avg = None
        try:
            if hasattr(os, "getloadavg"):
                la = os.getloadavg()
                load_avg = [round(float(x), 2) for x in la]
        except Exception:
            load_avg = None

        if psutil is not None:
            cpu_percent = round(float(psutil.cpu_percent(interval=None)), 1)
        elif load_avg and cores_logical:
            cpu_percent = round(min(100.0, (load_avg[0] / cores_logical) * 100.0), 1)
        else:
            cpu_percent = 0.0

        freq_mhz: Optional[float] = None
        try:
            if psutil is not None:
                freq = psutil.cpu_freq()
                if freq and freq.current:
                    freq_mhz = round(float(freq.current), 0)
        except Exception:
            freq_mhz = None

        if psutil is not None:
            vm = psutil.virtual_memory()
            ram_info = {
                "total_gb": round(vm.total / gb, 2),
                "used_gb": round(vm.used / gb, 2),
                "available_gb": round(vm.available / gb, 2),
                "percent": round(float(vm.percent), 1),
            }
        else:
            ram_info = _read_proc_meminfo()

        disk_root = os.path.abspath(os.sep)
        du = psutil.disk_usage(disk_root) if psutil is not None else shutil.disk_usage(disk_root)
        disk_pct = round(float(getattr(du, "percent", (du.used / du.total) * 100.0 if du.total else 0.0)), 1)

        uptime_seconds = 0
        try:
            if psutil is not None:
                uptime_seconds = max(0, int(time.time() - psutil.boot_time()))
            elif os.path.isfile("/proc/uptime"):
                with open("/proc/uptime", "r", encoding="utf-8") as uf:
                    uptime_seconds = max(0, int(float(uf.read().split()[0])))
        except Exception:
            uptime_seconds = 0

        temp_info = _read_vps_cpu_temperature()

        return {
            "hostname": platform.node() or "vps-host",
            "os": f"{platform.system()} {platform.release()}".strip(),
            "arch": platform.machine() or "unknown",
            "uptime_seconds": uptime_seconds,
            "cpu": {
                "percent": cpu_percent,
                "cores_logical": int(cores_logical),
                "cores_physical": int(cores_physical),
                "freq_mhz": freq_mhz,
                "load_avg": load_avg,
            },
            "ram": ram_info,
            "rom": {
                "mount": disk_root,
                "total_gb": round(du.total / gb, 2),
                "used_gb": round(du.used / gb, 2),
                "free_gb": round(du.free / gb, 2),
                "percent": disk_pct,
            },
            "temperature": temp_info,
        }

    _binance_latency_cache: Optional[Dict[str, Any]] = None
    _binance_latency_cached_at: float = 0.0
    _BINANCE_CACHE_TTL_SEC: float = 8.0
    _probe_sessions: Dict[int, Any] = {}
    _probe_last_warm_ts: Dict[str, float] = {}
    _probe_thread_loop: Optional[asyncio.AbstractEventLoop] = None
    _probe_thread: Optional[threading.Thread] = None
    _probe_thread_lock = threading.Lock()

    @classmethod
    def _ensure_probe_loop(cls) -> asyncio.AbstractEventLoop:
        """
        Return a dedicated background asyncio event loop running on its own daemon thread.
        Running network RTT probes on an isolated loop ensures main FastAPI event-loop
        workload/jitter is NEVER added to measured VPS -> Binance edge latency.
        """
        with cls._probe_thread_lock:
            if cls._probe_thread_loop is not None and cls._probe_thread_loop.is_running():
                return cls._probe_thread_loop

            ready_evt = threading.Event()
            created_loop: list = []

            def _loop_runner() -> None:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                created_loop.append(loop)
                ready_evt.set()
                loop.run_forever()

            t = threading.Thread(target=_loop_runner, name="binance-latency-probe", daemon=True)
            t.start()
            ready_evt.wait(timeout=2.0)
            cls._probe_thread = t
            cls._probe_thread_loop = created_loop[0]
            return cls._probe_thread_loop

    @classmethod
    def _get_probe_session(cls) -> Optional[Any]:
        """Reuse a persistent IPv4 aiohttp ClientSession per event loop to avoid DNS/TLS/IPv6 overhead on every probe."""
        if aiohttp is None:
            return None
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return None
        loop_id = id(loop)
        sess = cls._probe_sessions.get(loop_id)
        if sess is not None and not getattr(sess, "closed", True):
            return sess
        connector = aiohttp.TCPConnector(
            limit=8,
            ttl_dns_cache=600,
            keepalive_timeout=120.0,
            enable_cleanup_closed=True,
            family=socket.AF_INET,
        )
        sess = aiohttp.ClientSession(connector=connector)
        cls._probe_sessions[loop_id] = sess
        return sess

    @classmethod
    async def close_probe_sessions(cls) -> None:
        """Close persistent probe HTTP sessions cleanly on app shutdown."""
        try:
            curr_loop = asyncio.get_running_loop()
        except RuntimeError:
            curr_loop = None
        for loop_id, sess in list(cls._probe_sessions.items()):
            try:
                if sess is not None and not getattr(sess, "closed", True):
                    sess_loop = getattr(sess, "_loop", None)
                    if sess_loop is not None and sess_loop is not curr_loop and sess_loop.is_running():
                        fut = asyncio.run_coroutine_threadsafe(sess.close(), sess_loop)
                        await asyncio.wrap_future(fut)
                    else:
                        await sess.close()
            except Exception:
                pass
        cls._probe_sessions.clear()

    @classmethod
    async def _run_probes_coro(cls) -> tuple[Optional[float], Optional[float], Optional[float]]:
        session = cls._get_probe_session()

        async def _single_http_get(url: str) -> Optional[float]:
            t0 = time.perf_counter()
            try:
                if session is not None:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=2.5)) as resp:
                        await resp.read()
                        if 200 <= resp.status < 400:
                            return round((time.perf_counter() - t0) * 1000.0, 1)
                else:
                    import urllib.request

                    def _sync_get() -> int:
                        req = urllib.request.Request(url, method="GET")
                        with urllib.request.urlopen(req, timeout=2.5) as r:
                            return getattr(r, "status", 200)

                    status = await asyncio.to_thread(_sync_get)
                    if 200 <= status < 400:
                        return round((time.perf_counter() - t0) * 1000.0, 1)
            except Exception:
                return None
            return None

        async def _probe_http(url: str) -> Optional[float]:
            now_m = time.monotonic()
            was_warm = (now_m - cls._probe_last_warm_ts.get(url, 0.0)) < 40.0
            first_ms = await _single_http_get(url)
            if first_ms is None:
                return None
            cls._probe_last_warm_ts[url] = time.monotonic()
            # If the keep-alive socket was cold (or paid a 3-RTT TCP+TLS handshake > 200ms),
            # measure 1 immediate warm ping over the established keep-alive connection.
            if (not was_warm or first_ms > 200.0) and session is not None:
                second_ms = await _single_http_get(url)
                if second_ms is not None:
                    cls._probe_last_warm_ts[url] = time.monotonic()
                    return min(first_ms, second_ms)
            return first_ms

        async def _probe_tcp(host: str, port: int) -> Optional[float]:
            # Pre-resolve IPv4 address outside the RTT timer so DNS lookup and IPv6 fallback are excluded
            target_host = host
            try:
                infos = await asyncio.get_running_loop().getaddrinfo(
                    host, port, family=socket.AF_INET, type=socket.SOCK_STREAM
                )
                if infos and infos[0][4]:
                    target_host = infos[0][4][0]
            except Exception:
                target_host = host

            async def _single_tcp() -> Optional[float]:
                t0 = time.perf_counter()
                writer = None
                try:
                    _, writer = await asyncio.wait_for(
                        asyncio.open_connection(target_host, port),
                        timeout=2.5,
                    )
                    return round((time.perf_counter() - t0) * 1000.0, 1)
                except Exception:
                    return None
                finally:
                    if writer is not None:
                        writer.close()
                        try:
                            await writer.wait_closed()
                        except Exception:
                            pass

            m1 = await _single_tcp()
            if m1 is not None and m1 > 200.0:
                m2 = await _single_tcp()
                if m2 is not None:
                    return min(m1, m2)
            return m1

        return await asyncio.gather(
            _probe_http("https://api.binance.com/api/v3/ping"),
            _probe_http("https://fapi.binance.com/fapi/v1/ping"),
            _probe_tcp("stream.binance.com", 9443),
        )

    @classmethod
    async def measure_binance_latency(cls, force: bool = False) -> Dict[str, Any]:
        """
        Measure VPS-to-Binance REST & WebSocket edge latency with short TTL cache.
        Executes on a dedicated isolated background probe loop so main event-loop activity
        never inflates the reported network RTT.
        """
        now = time.monotonic()
        if (
            not force
            and cls._binance_latency_cache is not None
            and (now - cls._binance_latency_cached_at) < cls._BINANCE_CACHE_TTL_SEC
        ):
            return {**cls._binance_latency_cache, "cached": True}

        spot_ms: Optional[float] = None
        futures_ms: Optional[float] = None
        ws_ms: Optional[float] = None

        try:
            probe_loop = cls._ensure_probe_loop()
            fut = asyncio.run_coroutine_threadsafe(cls._run_probes_coro(), probe_loop)
            spot_ms, futures_ms, ws_ms = await asyncio.wait_for(asyncio.wrap_future(fut), timeout=6.0)
        except Exception:
            spot_ms, futures_ms, ws_ms = await cls._run_probes_coro()

        samples = [v for v in (spot_ms, futures_ms, ws_ms) if v is not None]
        if not samples:
            status = "unreachable"
        else:
            avg_ms = sum(samples) / len(samples)
            status = "optimal" if avg_ms < 80 else "good" if avg_ms < 180 else "degraded"

        result = {
            "binance_spot_ms": spot_ms,
            "binance_futures_ms": futures_ms,
            "binance_ws_ms": ws_ms,
            "status": status,
            "cached": False,
        }
        cls._binance_latency_cache = result
        cls._binance_latency_cached_at = time.monotonic()
        return result
