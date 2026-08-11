import os
import sys
import time
import argparse
import requests
import lzma
import struct
import pandas as pd
from datetime import datetime, timedelta

# Ensure we can import app modules if running as a standalone script
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app.db.session import SessionLocal
from app.models.model_training import ModelTrainingJob, TrainingStatus

def get_point_multiplier(symbol: str) -> float:
    """Returns the point multiplier for Dukascopy prices."""
    if "JPY" in symbol.upper():
        return 1000.0
    if "XAU" in symbol.upper():
        return 1000.0
    if "XAG" in symbol.upper():
        return 1000.0
    return 100000.0

def fetch_dukascopy_hour(symbol: str, date: datetime) -> pd.DataFrame:
    """Fetches and parses one hour of tick data from Dukascopy."""
    # Dukascopy format: datafeed.dukascopy.com/datafeed/EURUSD/2023/00/01/01h_ticks.bi5
    # Note: Month is 0-indexed! (Jan=00, Dec=11)
    clean_symbol = symbol.replace("/", "").replace("_", "").upper()
    year = date.year
    month = f"{date.month - 1:02d}"
    day = f"{date.day:02d}"
    hour = f"{date.hour:02d}h"
    
    # Dukascopy forces HTTPS
    url = f"https://datafeed.dukascopy.com/datafeed/{clean_symbol}/{year}/{month}/{day}/{hour}_ticks.bi5"
    
    # Do NOT use a Chrome User-Agent here! If Dukascopy sees a browser UA on HTTP, 
    # it forces a 301 redirect to HTTPS for Cloudflare Turnstile!
    # A standard bot UA bypasses the redirect.
    headers = {
        "User-Agent": "python-requests/2.31.0"
    }
    
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return pd.DataFrame()
            
        data = lzma.decompress(resp.content)
        
        # 20 bytes per tick: >3I2f
        # time_delta (ms), ask, bid, ask_vol, bid_vol
        ticks = []
        multiplier = get_point_multiplier(symbol)
        
        chunk_size = 20
        base_time = date.replace(minute=0, second=0, microsecond=0)
        
        for i in range(0, len(data), chunk_size):
            chunk = data[i:i+chunk_size]
            if len(chunk) < chunk_size:
                break
                
            unpacked = struct.unpack(">3I2f", chunk)
            time_delta_ms = unpacked[0]
            ask = unpacked[1] / multiplier
            bid = unpacked[2] / multiplier
            ask_vol = unpacked[3]
            bid_vol = unpacked[4]
            
            tick_time = base_time + timedelta(milliseconds=time_delta_ms)
            
            ticks.append({
                "time": tick_time,
                "ask": ask,
                "bid": bid,
                "ask_volume": ask_vol,
                "bid_volume": bid_vol
            })
            
        return pd.DataFrame(ticks)
    except Exception as e:
        print(f"Error fetching Dukascopy ({url}): {str(e)}")
        return pd.DataFrame()

def run_dukascopy_collector(symbol: str, target_rows: int, job_id: str, mode: str = "ticks", start_date: str = None, end_date: str = None):
    db = SessionLocal()
    job = db.query(ModelTrainingJob).filter_by(id=job_id).first()
    
    if not job:
        print(f"Job {job_id} not found.")
        return

    def _log(msg: str):
        timestamp = time.strftime("%H:%M:%S")
        logs = list(job.logs) if job.logs else []
        logs.append(f"[{timestamp}] [Dukascopy] {msg}")
        job.logs = logs
        db.commit()

    data_dir = os.path.join(os.getcwd(), "data", "raw", "forex_snapshots")
    os.makedirs(data_dir, exist_ok=True)
    
    clean_symbol = symbol.replace("/", "_")
    timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    output_file = os.path.join(data_dir, f"{clean_symbol}_TICK_{timestamp_str}.parquet")

    try:
        _log(f"Starting Dukascopy Tick Collector for {symbol}...")
        
        start_dt = None
        end_dt = None
        
        if mode == "date" and start_date and end_date:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
            end_dt = end_dt.replace(hour=23, minute=59, second=59)
        else:
            # If target rows mode, just fetch the last few days (since ticks are dense, 1 day can be 100k ticks)
            end_dt = datetime.utcnow()
            start_dt = end_dt - timedelta(days=7) # Fetch up to 7 days back to get target rows
            
        current_dt = start_dt
        all_dfs = []
        total_rows = 0
        current_progress = 0
        consecutive_fails = 0
        
        # Calculate total hours for progress bar if mode is date
        total_hours = max(1, int((end_dt - start_dt).total_seconds() / 3600))
        hours_processed = 0
        
        _log(f"Fetching tick data from {start_dt.strftime('%Y-%m-%d')} to {end_dt.strftime('%Y-%m-%d')}")
        
        # Loop hour by hour
        while current_dt <= end_dt:
            # Check if job was cancelled from UI
            db.refresh(job)
            if job.status == TrainingStatus.FAILED:
                _log("Collection stopped by user.")
                return
                
            if total_rows >= target_rows and mode == "ticks":
                break
                
            # Don't fetch weekends (Saturday and Sunday)
            if current_dt.weekday() >= 5:
                current_dt += timedelta(hours=1)
                continue
                
            df_hour = fetch_dukascopy_hour(symbol, current_dt)
            if not df_hour.empty:
                all_dfs.append(df_hour)
                total_rows += len(df_hour)
                consecutive_fails = 0
                
                # Progress logging every 12 hours of data to avoid log spam
                if current_dt.hour % 12 == 0:
                    _log(f"Fetched {current_dt.strftime('%Y-%m-%d %H:00')} -> Total {total_rows} ticks")
            else:
                consecutive_fails += 1
                if consecutive_fails == 1:
                    _log(f"Warning: Missing data for {current_dt.strftime('%Y-%m-%d %H:00')}")
                if consecutive_fails > 72: # 72 consecutive missing hours (3 days - covers weekends)
                    _log("No data for 72 consecutive hours (Likely hit current time or long weekend). Finishing collection.")
                    break
            
            # Be nice to Dukascopy to avoid IP bans
            time.sleep(1.0)
            
            current_dt += timedelta(hours=1)
            hours_processed += 1
            
            # Calculate and update progress (allow decimals up to 1 place)
            if mode == "ticks":
                new_progress = min(99.9, round((total_rows / target_rows) * 100, 1))
            else:
                new_progress = min(99.9, round((hours_processed / total_hours) * 100, 1))
                
            if new_progress >= current_progress + 0.1:
                current_progress = new_progress
                job.progress = current_progress
                db.commit()
            
        if not all_dfs:
            _log("No tick data returned from Dukascopy for the given range.")
            job.status = TrainingStatus.FAILED
            db.commit()
            return
            
        final_df = pd.concat(all_dfs, ignore_index=True)
        
        if mode == "ticks" and len(final_df) > target_rows:
            final_df = final_df.tail(target_rows)
            
        _log(f"Saving {len(final_df)} ticks to {output_file}...")
        final_df.to_parquet(output_file, index=False)
        _log(f"Successfully saved {len(final_df)} rows.")
            
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
    parser.add_argument("--timeframe", type=str, default="15m") # Ignored for dukascopy
    args = parser.parse_args()
    
    run_dukascopy_collector(args.symbol, args.target, args.job_id, args.mode, args.start_date, args.end_date)
