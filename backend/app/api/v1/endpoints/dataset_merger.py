import os
import shutil
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.orm import Session
from app.api import deps
from app.services.dataset_merger import DatasetMergerService

router = APIRouter()

UPLOAD_DIR = os.path.join(os.getcwd(), "uploads", "datasets", "temp")
os.makedirs(UPLOAD_DIR, exist_ok=True)

from typing import Optional

@router.post("/merge")
async def merge_historical_dataset(
    symbol: str = Form(...),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_active_user)
):
    """
    Merge archived Parquet files and the live database to create a continuous dataset.
    Optionally merge with an uploaded historical DVC dataset (CSV).
    """
    temp_file_path = None
    
    if file and file.filename:
        if not file.filename.endswith('.csv'):
            raise HTTPException(status_code=400, detail="Only CSV files are supported for historical DVC datasets.")
        
        # Save the uploaded file temporarily
        temp_file_path = os.path.join(UPLOAD_DIR, f"temp_{current_user.id}_{file.filename}")
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

    try:
        # Call the merger service
        result = DatasetMergerService.merge_datasets(symbol, temp_file_path, db, current_user.id)
        try:
            from app.services.system_notification_service import SystemNotificationService

            total_rows = result.get("total_rows") if isinstance(result, dict) else None
            merged_file = result.get("merged_filename") if isinstance(result, dict) else None
            rows_str = f"{int(total_rows):,}" if total_rows is not None else "N/A"
            SystemNotificationService.emit_sync(
                user_id=current_user.id,
                category="ml_training",
                title=f"Dataset Merged: {symbol}",
                message=f"Rows: {rows_str}" + (f" | File: {merged_file}" if merged_file else ""),
                event_type="dataset_merged",
                severity="success",
                meta={
                    "symbol": symbol,
                    "total_rows": total_rows,
                    "merged_filename": merged_file,
                },
            )
        except Exception:
            pass
        
        return result

    except HTTPException as he:
        raise he
    except Exception as e:
        from app.services.notification import NotificationService
        NotificationService.broadcast_admin_alert_sync(db, f"❌ *Dataset Merger Failed*\nSymbol: {symbol}\nError: {e}", parse_mode="Markdown")
        try:
            from app.services.system_notification_service import SystemNotificationService

            SystemNotificationService.emit_sync(
                user_id=current_user.id,
                category="ml_training",
                title="Dataset Merge Failed",
                message=f"Symbol: {symbol} | Error: {str(e)[:250]}",
                event_type="dataset_merge_failed",
                severity="critical",
                meta={"symbol": symbol, "error": str(e)[:250]},
            )
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Merge failed: {str(e)}")
