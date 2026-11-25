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
