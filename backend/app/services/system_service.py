
import asyncio
import logging
import os
import platform
import shutil
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
    @staticmethod
    async def check_health(db: Session):
        """
        Check the health of critical system components: Database, Redis, Celery.
        """
        services_status = {
            "database": "unknown",
            "redis": "unknown",
            "celery_worker": "unknown"
        }
        
        # 1. Database Check
        try:
            db.execute(text("SELECT 1"))
            services_status["database"] = "online"
        except Exception as e:
            logger.error(f"Health Check - Database Error: {e}")
            services_status["database"] = "offline"

        # 2. Redis Check
        try:
            redis_client = redis_manager.get_redis()
            if redis_client:
                await redis_client.ping()
                services_status["redis"] = "online"
            else:
                # If client is None, it might not be initialized. 
                # In a real app getting a request, it should be initialized.
                services_status["redis"] = "offline"
        except Exception as e:
            logger.error(f"Health Check - Redis Error: {e}")
            services_status["redis"] = "offline"

        # 3. Celery Worker Check
        try:
            # inspect() defaults to a small timeout if not specified, 
            # but we should be explicit if possible. 
            # However, standard Celery inspect() init accepts timeout.
            inspector = celery_app.control.inspect(timeout=2.0)
            stats = inspector.active()
            
            # stats is None if no workers replied.
            # stats is a dict if workers replied (even if empty list of active tasks).
            if stats is not None:
                services_status["celery_worker"] = "online"
            else:
                services_status["celery_worker"] = "offline"
        except Exception as e:
            logger.error(f"Health Check - Celery Error: {e}")
            services_status["celery_worker"] = "error"

        # Determine overall status
        # Critical services that cause UNHEALTHY state
        if services_status["database"] != "online" or services_status["redis"] != "online":
             overall_status = "unhealthy"
        elif services_status["celery_worker"] != "online":
             # Non-critical but important
             overall_status = "degraded"
        else:
             overall_status = "healthy"

        return {
            "status": overall_status,
            "services": services_status,
            # Timestamp can be added by the caller or here. 
            # Using ISO format usually.
            "timestamp": "now" # Placeholder, will be replaced or formatted in Pydantic schema if needed
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

    @classmethod
    async def measure_binance_latency(cls, force: bool = False) -> Dict[str, Any]:
        """Measure VPS-to-Binance REST & WebSocket edge latency with short TTL cache."""
        now = time.monotonic()
        if (
            not force
            and cls._binance_latency_cache is not None
            and (now - cls._binance_latency_cached_at) < cls._BINANCE_CACHE_TTL_SEC
        ):
            return {**cls._binance_latency_cache, "cached": True}

        async def _probe_http(session: Any, url: str) -> Optional[float]:
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

        async def _probe_tcp(host: str, port: int) -> Optional[float]:
            t0 = time.perf_counter()
            writer = None
            try:
                _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=2.5)
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

        spot_ms: Optional[float] = None
        futures_ms: Optional[float] = None
        ws_ms: Optional[float] = None

        if aiohttp is not None:
            async with aiohttp.ClientSession() as session:
                spot_ms, futures_ms, ws_ms = await asyncio.gather(
                    _probe_http(session, "https://api.binance.com/api/v3/ping"),
                    _probe_http(session, "https://fapi.binance.com/fapi/v1/ping"),
                    _probe_tcp("stream.binance.com", 9443),
                )
        else:
            spot_ms, futures_ms, ws_ms = await asyncio.gather(
                _probe_http(None, "https://api.binance.com/api/v3/ping"),
                _probe_http(None, "https://fapi.binance.com/fapi/v1/ping"),
                _probe_tcp("stream.binance.com", 9443),
            )

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
