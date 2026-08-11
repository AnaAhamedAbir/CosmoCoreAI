import time
import argparse
import sys
import os
import requests
import pandas as pd
from datetime import datetime

# Ensure we can import app modules if running as a standalone script
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.db.session import SessionLocal
from app.models.model_training import ModelTrainingJob, TrainingStatus

def run_forex_collector(symbol: str, target_rows: int, job_id: str, mode: str = "ticks", start_date: str = None, end_date: str = None, timeframe: str = "15m"):
    db = SessionLocal()
    job = db.query(ModelTrainingJob).filter_by(id=job_id).first()
    
    if not job:
        print(f"Job {job_id} not found.")
        return

    def _log(msg: str):
        timestamp = time.strftime("%H:%M:%S")
        logs = list(job.logs) if job.logs else []
        logs.append(f"[{timestamp}] [ForexCollector] {msg}")
        job.logs = logs
        db.commit()

    account_id = os.getenv("OANDA_ACCOUNT_ID")
    api_key = os.getenv("OANDA_API_KEY")
    
    if not account_id or not api_key:
        _log("ERROR: OANDA API credentials are not set in the environment.")
        job.status = TrainingStatus.FAILED
        db.commit()
        return

    # Create data directory if it doesn't exist
    data_dir = os.path.join(os.getcwd(), "data", "raw", "forex_snapshots")
    os.makedirs(data_dir, exist_ok=True)
    
    clean_symbol = symbol.replace("/", "_")
    timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    output_file = os.path.join(data_dir, f"{clean_symbol}_{timestamp_str}.parquet")

    try:
        _log(f"Starting OANDA Collector for {symbol} (Target: {target_rows} rows)...")
        
        headers = {
            "Authorization": f"Bearer {api_key}"
        }
        
        # OANDA v20 API uses EUR_USD format
        instrument = symbol.replace("/", "_")
        
        # Map common timeframes to OANDA granularity
        tf_map = {
            "5s": "S5",
            "10s": "S10",
            "30s": "S30",
            "1m": "M1",
            "5m": "M5",
            "15m": "M15",
            "30m": "M30",
            "1h": "H1",
            "4h": "H4",
            "1d": "D",
        }
        granularity = tf_map.get(timeframe.lower(), "M15")
        
        all_records = []
        session = requests.Session()
        session.headers.update(headers)
        
        if mode == "date" and start_date and end_date:
            _log(f"Fetching {timeframe} data from OANDA API for range {start_date} to {end_date}...")
            current_from = f"{start_date}T00:00:00Z"
            end_time = f"{end_date}T23:59:59Z"
            
            while True:
                url = f"https://api-fxpractice.oanda.com/v3/instruments/{instrument}/candles?from={current_from}&count=5000&granularity={granularity}&price=M"
                response = session.get(url)
                if response.status_code != 200:
                    _log(f"OANDA API error: {response.text}")
                    break
                    
                data = response.json()
                candles = data.get("candles", [])
                if not candles:
                    break
                    
                _log(f"Fetched {len(candles)} candles starting from {current_from}...")
                
                for c in candles:
                    if not c["complete"]:
                        continue
                    if c["time"] > end_time:
                        continue
                    all_records.append({
                        "time": c["time"],
                        "open": float(c["mid"]["o"]),
                        "high": float(c["mid"]["h"]),
                        "low": float(c["mid"]["l"]),
                        "close": float(c["mid"]["c"]),
                        "volume": int(c["volume"])
                    })
                
                if candles[-1]["time"] >= end_time:
                    break
                    
                next_from = candles[-1]["time"]
                if next_from == current_from:
                    break
                current_from = next_from
                
                try:
                    start_ts = pd.to_datetime(f"{start_date}T00:00:00Z").timestamp()
                    end_ts = pd.to_datetime(f"{end_date}T23:59:59Z").timestamp()
                    curr_ts = pd.to_datetime(current_from).timestamp()
                    if end_ts > start_ts:
                        job.progress = min(99.0, max(0.0, ((curr_ts - start_ts) / (end_ts - start_ts)) * 100))
                        db.commit()
                except Exception:
                    pass
                
                time.sleep(0.2)
                
        else:
            _log(f"Fetching recent {target_rows} candles ({timeframe}) from OANDA API...")
            remaining = target_rows
            current_to = None
            
            while remaining > 0:
                fetch_count = min(remaining, 5000)
                url = f"https://api-fxpractice.oanda.com/v3/instruments/{instrument}/candles?count={fetch_count}&granularity={granularity}&price=M"
                if current_to:
                    url += f"&to={current_to}"
                    
                response = session.get(url)
                if response.status_code != 200:
                    _log(f"OANDA API error: {response.text}")
                    break
                    
                data = response.json()
                candles = data.get("candles", [])
                if not candles:
                    break
                    
                _log(f"Fetched {len(candles)} candles ending at {current_to or 'now'}... ({remaining} remaining)")
                
                batch_records = []
                for c in candles:
                    if not c["complete"]:
                        continue
                    batch_records.append({
                        "time": c["time"],
                        "open": float(c["mid"]["o"]),
                        "high": float(c["mid"]["h"]),
                        "low": float(c["mid"]["l"]),
                        "close": float(c["mid"]["c"]),
                        "volume": int(c["volume"])
                    })
                
                all_records = batch_records + all_records
                remaining -= len(candles)
                
                if target_rows > 0:
                    job.progress = min(99.0, max(0.0, ((target_rows - remaining) / target_rows) * 100))
                    db.commit()
                
                if len(candles) < fetch_count:
                    _log("No more historical data available from OANDA.")
                    break
                    
                current_to = candles[0]["time"]
                time.sleep(0.2)
                
        if not all_records:
            _log("No candles returned from OANDA.")
            job.status = TrainingStatus.FAILED
            db.commit()
            return
            
        _log(f"Finished downloading. Total records collected: {len(all_records)}. Parsing data...")
        
        df = pd.DataFrame(all_records)
        df.drop_duplicates(subset=["time"], inplace=True)
        # Convert time to standard datetime
        df["time"] = pd.to_datetime(df["time"]).dt.tz_localize(None)
        df.sort_values("time", inplace=True)
        
        df.to_parquet(output_file, index=False)
        _log(f"Successfully saved {len(df)} rows to {output_file}")
            
        if job.status == TrainingStatus.RUNNING:
            job.status = TrainingStatus.COMPLETED
            job.progress = 100.0
            db.commit()
            
    except Exception as e:
        job.status = TrainingStatus.FAILED
        job.error_message = str(e)
        _log(f"ERROR: {str(e)}")
        db.commit()
    finally:
        db.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", type=str, required=True)
    parser.add_argument("--target", type=int, required=True)
    parser.add_argument("--job_id", type=str, required=True)
    parser.add_argument("--mode", type=str, default="ticks")
    parser.add_argument("--start_date", type=str, default=None)
    parser.add_argument("--end_date", type=str, default=None)
    parser.add_argument("--timeframe", type=str, default="15m")
    args = parser.parse_args()
    
    run_forex_collector(args.symbol, args.target, args.job_id, args.mode, args.start_date, args.end_date, args.timeframe)
