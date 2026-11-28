import os
from celery import Celery
from celery.schedules import crontab
from app.core.config import settings
import warnings

warnings.filterwarnings("ignore", category=UserWarning, module="gym")
warnings.filterwarnings("ignore", category=DeprecationWarning, module="gym")
warnings.filterwarnings("ignore", message=".*Gym has been unmaintained.*")

import sys
import types
# Mock gym_notices to completely silence the terminal print from gym.__init__
dummy_gym_notices = types.ModuleType("gym_notices")
dummy_gym_notices.notices = types.ModuleType("gym_notices.notices")
dummy_gym_notices.notices.notices = ""
sys.modules["gym_notices"] = dummy_gym_notices
sys.modules["gym_notices.notices"] = dummy_gym_notices.notices
celery_app = Celery(
    "cosmoquant",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL
)

_ENABLE_DOCKER_LOG_MONITOR = (
    os.environ.get("ENABLE_DOCKER_LOG_MONITOR", "").strip().lower() in ("1", "true", "yes")
    or bool(os.environ.get("DOCKER_HOST"))
    or os.path.exists("/var/run/docker.sock")
)

_beat_schedule = {
    "fetch-news-every-10-mins": {
        "task": "app.tasks.fetch_market_news",
        "schedule": 600.0,  # 10 minutes in seconds
    },
    "prune-db-daily-midnight": {
        "task": "app.tasks.prune_database",
        "schedule": crontab(minute=0, hour=0),
    },
    "prune-l2-data-hourly": {
        "task": "app.tasks.prune_l2_data",
        "schedule": crontab(minute=0), # Run every hour
    },
    "auto-retrain-models-hourly": {
        "task": "app.tasks.auto_retrain_models",
        "schedule": crontab(minute=30), # Run every hour at minute 30
    },
}

if _ENABLE_DOCKER_LOG_MONITOR:
    _beat_schedule["docker-log-monitor"] = {
        "task": "app.tasks.monitor_docker_logs",
        "schedule": 60.0,
    }
    _beat_schedule["broadcast-container-logs"] = {
        "task": "app.tasks.broadcast_container_logs",
        "schedule": 2.0,  # FAST polling (every 2 seconds) for near real-time!
    }

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    beat_schedule=_beat_schedule,
    task_routes={
        'app.tasks.run_backtest_task': {'queue': 'heavy'},
        'app.tasks.run_optimization_task': {'queue': 'heavy'},
        'app.tasks.run_walk_forward_task': {'queue': 'heavy'},
        'app.tasks.run_batch_backtest_task': {'queue': 'heavy'},
        'app.tasks.celery_train_model_task': {'queue': 'heavy'},
        'app.tasks.celery_forex_train_model_task': {'queue': 'heavy'},
        'app.tasks.fetch_market_news': {'queue': 'heavy'},
        'app.tasks.task_fetch_latest_news': {'queue': 'heavy'},
        'app.tasks.fetch_and_store_sentiment': {'queue': 'heavy'},
        'app.tasks.evaluate_model_drift_task': {'queue': 'heavy'},
        'app.tasks.sync_fetch_news_heavy': {'queue': 'heavy'},
        'app.tasks.sync_sentiment_analysis_heavy': {'queue': 'heavy'},
        'app.tasks.auto_retrain_models': {'queue': 'heavy'},
        'app.tasks.prune_l2_data': {'queue': 'heavy'},
        'app.tasks.parse_tickstory_csv_task': {'queue': 'heavy'},
        'app.tasks.merge_hybrid_dataset_task': {'queue': 'heavy'},
        'merge_hybrid_dataset_task': {'queue': 'heavy'},
    },
    result_expires=3600,
    broker_connection_retry_on_startup=True,
    broker_transport_options={'visibility_timeout': 86400},  # 24 hours to prevent duplicate long tasks
)

# Auto-discover tasks in packages
celery_app.autodiscover_tasks(["app.tasks", "app.forex"])

# Stream Celery worker & beat logs + task failures into Sys Monitor (no docker.sock needed)
try:
    from celery.signals import (
        after_setup_logger,
        after_setup_task_logger,
        task_failure,
        worker_process_init,
        worker_process_shutdown,
    )

    def _attach_celery_live_feed(logger=None, **kwargs):
        try:
            from app.utils import (
                attach_live_log_handler,
                detect_service_container_name,
                get_singleton_redis_log_handler,
                install_error_capture_hooks,
            )
            cname = detect_service_container_name()
            # Use singleton handler per process so worker & task loggers share one queue/pool
            # and never overwrite each other's Redis snapshots.
            # Preserve Celery's configured --loglevel=warning (min_level=None) to avoid INFO spam.
            import logging as _logging
            _logging.getLogger("sqlalchemy.engine").setLevel(_logging.WARNING)
            attach_live_log_handler(
                logger_names=("", "app", "celery", "celery.task", "celery.redirected"),
                container_name=cname,
                publish_bot_logs=False,
                min_level=None,
            )
            if logger is not None:
                h = get_singleton_redis_log_handler(container_name=cname, publish_bot_logs=False)
                if not any(isinstance(existing, type(h)) for existing in logger.handlers):
                    logger.addHandler(h)
            install_error_capture_hooks(container_name=cname)
        except Exception:
            pass

    def _on_worker_process_init(**kwargs):
        """Re-initialize RedisLogHandler pool & drain thread inside newly forked Celery child processes."""
        try:
            from app.utils import get_singleton_redis_log_handler, detect_service_container_name
            h = get_singleton_redis_log_handler(
                container_name=detect_service_container_name(),
                publish_bot_logs=False,
            )
            h.ensure_worker_alive()
        except Exception:
            pass

    def _on_worker_process_shutdown(**kwargs):
        """Flush queued logs/alerts before --max-tasks-per-child=1 worker exits."""
        try:
            from app.utils import get_singleton_redis_log_handler, detect_service_container_name
            h = get_singleton_redis_log_handler(
                container_name=detect_service_container_name(),
                publish_bot_logs=False,
            )
            h.flush(timeout=2.0)
        except Exception:
            pass

    def _on_celery_task_failure(sender=None, task_id=None, exception=None, traceback=None, einfo=None, **kwargs):
        """Ensure every unhandled Celery task exception is captured as a CRITICAL/ERROR Sys Monitor alert."""
        try:
            import traceback as _tb
            from app.utils import get_singleton_redis_log_handler, detect_service_container_name

            cname = detect_service_container_name()
            h = get_singleton_redis_log_handler(container_name=cname, publish_bot_logs=False)
            task_name = getattr(sender, "name", None) or str(sender or "unknown_task")
            tb_text = ""
            if einfo is not None and getattr(einfo, "traceback", None):
                tb_text = str(einfo.traceback)
            elif exception is not None:
                tb_text = "".join(_tb.format_exception(type(exception), exception, getattr(exception, "__traceback__", None)))
            summary = f"Celery Task Failed [{task_name}] (id={task_id}): {type(exception).__name__ if exception else 'Error'}: {exception}"
            full_msg = f"{summary}\n{tb_text}".strip() if tb_text else summary
            h.enqueue_raw_event(
                message=full_msg,
                level="CRITICAL" if isinstance(exception, (MemoryError, SystemExit, RuntimeError)) else "ERROR",
                logger_name=f"celery.task.{task_name}",
                source="celery_task_failure",
            )
            h.flush(timeout=1.0)
        except Exception:
            pass

    after_setup_logger.connect(_attach_celery_live_feed, weak=False)
    after_setup_task_logger.connect(_attach_celery_live_feed, weak=False)
    worker_process_init.connect(_on_worker_process_init, weak=False)
    worker_process_shutdown.connect(_on_worker_process_shutdown, weak=False)
    task_failure.connect(_on_celery_task_failure, weak=False)
except Exception:
    pass
