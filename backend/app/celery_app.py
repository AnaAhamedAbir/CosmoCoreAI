# Unified Celery App Instance
# Re-exports the single configured celery_app from app.core.celery_app so that
# workers, beat, and all FastAPI endpoints share the exact same task_routes and broker settings.
from app.core.celery_app import celery_app

__all__ = ["celery_app"]
