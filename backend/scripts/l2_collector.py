import asyncio
import websockets
import json
import pandas as pd
import os
import re
import time
from datetime import datetime
import argparse
import sys

# Add backend directory to sys.path so we can import app modules
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.append(BACKEND_DIR)

from app.db.session import SessionLocal
from app.models.model_training import ModelTrainingJob, TrainingStatus
from app.services.l2_data_collector import L2DataCollector

# Configuration
SYMBOL = "btcusdt"
DEPTH_LEVELS = 20
UPDATE_SPEED = "100ms"
CHUNK_SIZE = 20000
MAX_CONSECUTIVE_TIMEOUTS = 6
DATA_DIR = os.path.join(BACKEND_DIR, "data", "raw", "l2_snapshots")

def add_job_log(db, job_id, msg):
    print(f"[{datetime.now()}] {msg}")
    if not job_id: return
    try:
        job = db.query(ModelTrainingJob).filter(ModelTrainingJob.id == job_id).first()
        if job:
            logs = list(job.logs) if job.logs else []
            logs.append(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}")
            job.logs = logs
            db.commit()
    except Exception as e:
        print(f"Failed to update log: {e}")

async def collect_l2_data(target_rows: int, symbol: str = SYMBOL, job_id: str = None):
    symbol_ws, is_futures = L2DataCollector.parse_symbol(symbol)
    ws_base = "wss://fstream.binance.com/ws" if is_futures else "wss://stream.binance.com:9443/ws"
    url = f"{ws_base}/{symbol_ws}@depth{DEPTH_LEVELS}@{UPDATE_SPEED}"
    symbol_safe = re.sub(r"[^A-Za-z0-9_-]+", "_", symbol.upper()).strip("_")
    os.makedirs(DATA_DIR, exist_ok=True)
    session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    buffer = []
    total_collected = 0
    chunk_index = 0
    chunk_files = []
    consecutive_timeouts = 0

    db = SessionLocal()
    add_job_log(db, job_id, f"Starting L2 Collector for {symbol.upper()}")
    add_job_log(db, job_id, f"Target: {target_rows:,} rows. Saving to chunks...")

    last_logged_percent = -1

    async def handle_cancellation():
        if not job_id:
            return False
        db.expire_all()
        job = db.query(ModelTrainingJob).filter(ModelTrainingJob.id == job_id).first()
        if job and (job.status == TrainingStatus.FAILED or job.status == TrainingStatus.PAUSED or (job.error_message and "cancel" in job.error_message.lower())):
            add_job_log(db, job_id, "🛑 Collector was cancelled by user.")
            if job.user_id:
                from app.services.notification import NotificationService
                await NotificationService.send_message(db, job.user_id, f"🛑 *Collector Cancelled*\nSymbol: {symbol.upper()}\nTarget: {target_rows:,}", parse_mode="Markdown", in_app_category="ml_training")
            return True
        return False

    try:
        async with websockets.connect(url, open_timeout=10, close_timeout=1) as websocket:
            while total_collected < target_rows:
                if total_collected % 100 == 0 and await handle_cancellation():
                    break

                try:
                    msg = await asyncio.wait_for(websocket.recv(), timeout=5)
                    consecutive_timeouts = 0
                except asyncio.TimeoutError:
                    consecutive_timeouts += 1
                    if await handle_cancellation():
                        break
                    if consecutive_timeouts >= MAX_CONSECUTIVE_TIMEOUTS:
                        raise TimeoutError(
                            f"No L2 WebSocket data received for {symbol.upper()} from {url} within {MAX_CONSECUTIVE_TIMEOUTS * 5}s"
                        )
                    continue

                data = json.loads(msg)
                row = {"timestamp": pd.Timestamp.now()}
                
                bids = data.get("bids") if "bids" in data else data.get("b", [])
                asks = data.get("asks") if "asks" in data else data.get("a", [])
                
                for i in range(DEPTH_LEVELS):
                    if i < len(bids):
                        row[f"bid_price_{i+1}"] = float(bids[i][0])
                        row[f"bid_volume_{i+1}"] = float(bids[i][1])
                    else:
                        row[f"bid_price_{i+1}"] = None
                        row[f"bid_volume_{i+1}"] = None
                        
                    if i < len(asks):
                        row[f"ask_price_{i+1}"] = float(asks[i][0])
                        row[f"ask_volume_{i+1}"] = float(asks[i][1])
                    else:
                        row[f"ask_price_{i+1}"] = None
                        row[f"ask_volume_{i+1}"] = None

                buffer.append(row)
                total_collected += 1

                current_percent = int((total_collected / target_rows) * 100)
                if current_percent > last_logged_percent and job_id:
                    last_logged_percent = current_percent
                    job = db.query(ModelTrainingJob).filter(ModelTrainingJob.id == job_id).first()
                    if job:
                        job.progress = float(current_percent)
                        db.commit()
                    add_job_log(db, job_id, f"⬇️ Download Progress: {current_percent}% ({total_collected:,} / {target_rows:,} rows)")

                if len(buffer) >= CHUNK_SIZE or total_collected >= target_rows:
                    chunk_index += 1
                    df = pd.DataFrame(buffer)
                    chunk_filename = os.path.join(DATA_DIR, f"{symbol_safe}_temp_chunk_{session_id}_{chunk_index}.parquet")
                    df.to_parquet(chunk_filename, index=False)
                    chunk_files.append(chunk_filename)
                    buffer.clear()
                    
    except asyncio.CancelledError:
        add_job_log(db, job_id, "Collection task was cancelled.")
    except Exception as e:
        add_job_log(db, job_id, f"Error during WebSocket collection: {e}")
        if job_id:
            job = db.query(ModelTrainingJob).filter(ModelTrainingJob.id == job_id).first()
            if job and job.status == TrainingStatus.RUNNING:
                job.status = TrainingStatus.FAILED
                job.error_message = str(e)
                db.commit()
                if job.user_id:
                    from app.services.notification import NotificationService
                    await NotificationService.send_message(db, job.user_id, f"❌ *L2 Collector Failed*\nSymbol: {symbol.upper()}\nError: {e}", parse_mode="Markdown", in_app_category="ml_training")

    # Merge Process
    if chunk_files:
        add_job_log(db, job_id, f"Target reached or stopped. Merging {len(chunk_files)} chunks...")
        try:
            dfs = [pd.read_parquet(f) for f in chunk_files]
            final_df = pd.concat(dfs, ignore_index=True)
            
            final_filename = os.path.join(DATA_DIR, f"{symbol_safe}_L2_{target_rows}_{session_id}.parquet")
            final_df.to_parquet(final_filename, index=False)
            add_job_log(db, job_id, f"✅ Final L2 Snapshot saved successfully: {final_filename}")
            
            # Cleanup
            for f in chunk_files:
                try:
                    os.remove(f)
                except Exception:
                    pass
            
            if job_id:
                job = db.query(ModelTrainingJob).filter(ModelTrainingJob.id == job_id).first()
                if job and job.status == TrainingStatus.RUNNING:
                    job.progress = 100.0
                    job.status = TrainingStatus.COMPLETED
                    db.commit()
                    if job.user_id:
                        from app.services.notification import NotificationService
                        await NotificationService.send_message(db, job.user_id, f"✅ *L2 Collection Complete*\nSymbol: {symbol.upper()}\nRows: {target_rows:,}", parse_mode="Markdown", in_app_category="ml_training")
                    
        except Exception as e:
            add_job_log(db, job_id, f"Error during merge process: {e}")
            if job_id:
                job = db.query(ModelTrainingJob).filter(ModelTrainingJob.id == job_id).first()
                if job:
                    job.status = TrainingStatus.FAILED
                    job.error_message = str(e)
                    db.commit()
                    if job.user_id:
                        from app.services.notification import NotificationService
                        await NotificationService.send_message(db, job.user_id, f"❌ *L2 Merge Failed*\nSymbol: {symbol.upper()}\nError: {e}", parse_mode="Markdown", in_app_category="ml_training")
    else:
        msg = "No data collected to merge."
        add_job_log(db, job_id, msg)
        if job_id:
            job = db.query(ModelTrainingJob).filter(ModelTrainingJob.id == job_id).first()
            if job and job.status == TrainingStatus.RUNNING:
                job.status = TrainingStatus.FAILED
                job.error_message = msg
                db.commit()
        
    db.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="L2 Orderbook Data Collector")
    parser.add_argument("--target", type=int, default=200000, help="Total number of rows to collect")
    parser.add_argument("--symbol", type=str, default="btcusdt", help="Trading pair symbol")
    parser.add_argument("--job_id", type=str, default=None, help="Database Job ID to track progress")
    
    args = parser.parse_args()
    
    try:
        asyncio.run(collect_l2_data(args.target, args.symbol, args.job_id))
    except KeyboardInterrupt:
        print("\nCollector stopped manually.")
