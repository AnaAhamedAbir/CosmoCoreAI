from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api import deps
from app.db.session import get_db
from app.models import User
from app.schemas.training_studio_tools import (
    CloneJobConfigOut,
    ModelCompareItem,
    OptunaTrialsOut,
    PreFlightRequest,
    PreFlightResponse,
    PresetDeleteOut,
    TrainingPresetCreate,
    TrainingPresetOut,
    WorkerQueueStatusOut,
)
from app.services import training_studio_analytics as svc

router = APIRouter()


@router.post("/preflight", response_model=PreFlightResponse)
def run_preflight_health_check(
    payload: PreFlightRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
) -> PreFlightResponse:
    """Run pre-flight dataset quality, leakage, and class balance inspection."""
    return svc.run_preflight_check(db=db, payload=payload)


@router.get("/compare", response_model=List[ModelCompareItem])
def compare_models(
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
) -> List[ModelCompareItem]:
    """Compare all non-forex custom ML models owned by the authenticated user."""
    return svc.compare_user_models(db=db, user_id=current_user.id)


@router.get("/queue-status", response_model=WorkerQueueStatusOut)
def get_queue_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
) -> WorkerQueueStatusOut:
    """Return active/queued training jobs, ETA estimates, and online Celery worker count."""
    return svc.get_worker_queue_status(db=db, user_id=current_user.id)


@router.get("/optuna-trials/{model_id}", response_model=OptunaTrialsOut)
def get_optuna_trials(
    model_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
) -> OptunaTrialsOut:
    """Return Optuna AutoML trial history and best hyperparameters for a model."""
    return svc.get_model_optuna_trials(db=db, model_id=model_id, user_id=current_user.id)


@router.get("/presets", response_model=List[TrainingPresetOut])
def get_presets(
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
) -> List[TrainingPresetOut]:
    """List saved Training Studio presets for the authenticated user."""
    return svc.list_presets(db=db, user_id=current_user.id)


@router.post("/presets", response_model=TrainingPresetOut)
def create_preset(
    payload: TrainingPresetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
) -> TrainingPresetOut:
    """Save a new Training Studio configuration preset."""
    return svc.create_preset(db=db, user_id=current_user.id, payload=payload)


@router.delete("/presets/{preset_id}", response_model=PresetDeleteOut)
def delete_preset(
    preset_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
) -> PresetDeleteOut:
    """Delete a user-owned Training Studio preset."""
    deleted_id = svc.delete_preset(db=db, user_id=current_user.id, preset_id=preset_id)
    return PresetDeleteOut(status="success", deleted_id=deleted_id)


@router.get("/jobs/{job_id}/clone-config", response_model=CloneJobConfigOut)
def clone_job_config(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
) -> CloneJobConfigOut:
    """Return the training configuration of an existing job so it can be cloned."""
    return svc.get_clone_job_config(db=db, user_id=current_user.id, job_id=job_id)
