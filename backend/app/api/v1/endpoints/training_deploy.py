from typing import List, Optional

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy.orm import Session

from app.api import deps
from app.models import User
from app.schemas.training_deploy import (
    DeleteManualTradePinResponse,
    DeployToWallHunterRequest,
    DeployToWallHunterResponse,
    ManualTradePinRequest,
    ManualTradePinResponse,
    ManualTradePinSetResponse,
    PaperReplayRequest,
    PaperReplayResponse,
    RetrainModelResponse,
    WallHunterBotItem,
)
from app.services.training_deploy_service import TrainingDeployService

router = APIRouter()


@router.post("/paper-replay/{model_id}", response_model=PaperReplayResponse)
def run_paper_replay(
    model_id: str,
    req: Optional[PaperReplayRequest] = Body(default=None),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Run out-of-sample paper replay or synthesize metrics from cached post-training backtest."""
    params = req or PaperReplayRequest()
    return TrainingDeployService.run_paper_replay(
        db=db,
        user_id=current_user.id,
        model_id=model_id,
        params=params,
    )


@router.get("/wallhunter-bots", response_model=List[WallHunterBotItem])
def list_wallhunter_bots(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """List the authenticated user's Crypto WallHunter bots and their ML filter settings."""
    return TrainingDeployService.list_wallhunter_bots(db=db, user_id=current_user.id)


@router.post("/wallhunter", response_model=DeployToWallHunterResponse)
async def deploy_model_to_wallhunter(
    payload: DeployToWallHunterRequest,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Deploy a trained crypto ML model to a WallHunter bot with live hot-reload if active."""
    return await TrainingDeployService.deploy_to_wallhunter(
        db=db,
        user_id=current_user.id,
        payload=payload,
        request=request,
    )


@router.get("/manual-trade-pin", response_model=ManualTradePinResponse)
def get_manual_trade_pin(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Return the user's currently pinned Manual Trade ML Filter model, if any."""
    return TrainingDeployService.get_manual_trade_pin(db=db, user_id=current_user.id)


@router.post("/manual-trade-pin", response_model=ManualTradePinSetResponse)
def set_manual_trade_pin(
    payload: ManualTradePinRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Pin a crypto ML model as the active Manual Trade ML Filter."""
    return TrainingDeployService.set_manual_trade_pin(
        db=db,
        user_id=current_user.id,
        payload=payload,
    )


@router.delete("/manual-trade-pin", response_model=DeleteManualTradePinResponse)
def delete_manual_trade_pin(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Unpin any Manual Trade ML Filter model for the authenticated user."""
    return TrainingDeployService.clear_manual_trade_pin(db=db, user_id=current_user.id)


@router.post("/retrain/{model_id}", response_model=RetrainModelResponse)
def retrain_model(
    model_id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Queue a 1-click incremental retrain/fine-tune Celery job for an owned crypto model."""
    return TrainingDeployService.queue_retrain(
        db=db,
        user_id=current_user.id,
        model_id=model_id,
    )
