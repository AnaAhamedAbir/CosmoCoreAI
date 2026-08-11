import os
import sys
import time
import argparse
import pandas as pd
import uuid
from datetime import datetime

# Ensure we can import app modules if running as a standalone script
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app.db.session import SessionLocal
from app.models.model_training import ModelTrainingJob, TrainingStatus

def run_tickstory_parser(symbol: str, input_csv_path: str, job_id: str):
    db = SessionLocal()
    job = db.query(ModelTrainingJob).filter_by(id=job_id).first()
    
    if not job:
        print(f"Job {job_id} not found.")
        return

    def _log(msg: str):
        print(msg)
        timestamp = time.strftime("%H:%M:%S")
        logs = list(job.logs) if job.logs else []
        logs.append(f"[{timestamp}] [Tickstory] {msg}")
        job.logs = logs
        db.commit()

    data_dir = os.path.join(os.getcwd(), "data", "raw", "forex_snapshots")
    os.makedirs(data_dir, exist_ok=True)
    
    clean_symbol = symbol.replace("/", "_").upper()
    timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    output_file = os.path.join(data_dir, f"{clean_symbol}_TICKSTORY_{timestamp_str}.parquet")

    try:
        _log(f"Starting Tickstory CSV Parser for {symbol}...")
        _log(f"File size: {os.path.getsize(input_csv_path) / (1024*1024):.2f} MB")
        
        # Read the first few lines to determine format
        sample_df = pd.read_csv(input_csv_path, nrows=5)
        has_headers = False
        
        # Check if columns look like strings/headers or data
        first_col = str(sample_df.columns[0]).lower()
        if 'sym' in first_col or 'time' in first_col or 'date' in first_col or 'ask' in first_col:
            has_headers = True
            
        _log(f"Detected headers: {has_headers}")
        
        chunk_size = 1000000 # Read in chunks of 1 million rows
        total_rows = 0
        all_dfs = []
        
        # Use pandas to read in chunks
        if has_headers:
            chunk_iterator = pd.read_csv(input_csv_path, chunksize=chunk_size, low_memory=False)
        else:
            # Assume standard Tickstory format without headers: Symbol, Date, Time, Bid, Ask, BidVol, AskVol
            col_names = ['Symbol', 'Date', 'Time', 'Bid', 'Ask', 'BidVolume', 'AskVolume']
            # Sometimes it's Date, Time, Bid, Ask, BidVol, AskVol (6 cols)
            if len(sample_df.columns) == 6:
                col_names = ['Date', 'Time', 'Bid', 'Ask', 'BidVolume', 'AskVolume']
                
            chunk_iterator = pd.read_csv(input_csv_path, chunksize=chunk_size, names=col_names, low_memory=False)
            
        _log("Processing chunks...")
        
        for idx, chunk in enumerate(chunk_iterator):
            # Normalize column names
            chunk.columns = [str(c).lower().strip() for c in chunk.columns]
            
            # Find the required columns
            # We need: time, bid, ask, bid_volume, ask_volume
            
            # Process Time
            if 'time' not in chunk.columns and 'date' in chunk.columns:
                # If only date is present, rename it to time
                chunk.rename(columns={'date': 'time'}, inplace=True)
            elif 'date' in chunk.columns and 'time' in chunk.columns:
                # Combine Date and Time
                # Format is usually YYYYMMDD and HH:MM:SS.mmm
                chunk['time'] = pd.to_datetime(chunk['date'].astype(str) + ' ' + chunk['time'].astype(str), format='mixed', errors='coerce')
                chunk.drop(columns=['date'], inplace=True)
            elif 'timestamp' in chunk.columns:
                chunk.rename(columns={'timestamp': 'time'}, inplace=True)
                
            if 'time' in chunk.columns and not pd.api.types.is_datetime64_any_dtype(chunk['time']):
                # Tickstory sometimes uses ':' for milliseconds (e.g. 20260708 00:00:00:185)
                # Replace the last ':' with '.' using regex so pd.to_datetime can parse it
                chunk['time'] = chunk['time'].astype(str).str.replace(r':(\d{3})$', r'.\1', regex=True)
                chunk['time'] = pd.to_datetime(chunk['time'], format='mixed', errors='coerce')
                
            # Rename Bid/Ask
            rename_map = {}
            for col in chunk.columns:
                if 'bidvolume' in col or 'bid_volume' in col or 'bid vol' in col:
                    rename_map[col] = 'bid_volume'
                elif 'askvolume' in col or 'ask_volume' in col or 'ask vol' in col:
                    rename_map[col] = 'ask_volume'
                elif 'bid' in col and 'volume' not in col:
                    rename_map[col] = 'bid'
                elif 'ask' in col and 'volume' not in col:
                    rename_map[col] = 'ask'
                    
            chunk.rename(columns=rename_map, inplace=True)
            
            # Keep only necessary columns
            keep_cols = ['time', 'bid', 'ask']
            if 'bid_volume' in chunk.columns: keep_cols.append('bid_volume')
            if 'ask_volume' in chunk.columns: keep_cols.append('ask_volume')
            
            available_cols = [c for c in keep_cols if c in chunk.columns]
            chunk = chunk[available_cols]
            
            # Drop rows with missing time or bid/ask
            chunk = chunk.dropna(subset=['time', 'bid', 'ask'])
            
            all_dfs.append(chunk)
            total_rows += len(chunk)
            
            job.progress = min(99.0, (total_rows / 5000000) * 100) # Arbitrary estimate progress
            db.commit()
            
            _log(f"Processed chunk {idx+1} ({total_rows} rows total)")

        if not all_dfs:
            raise ValueError("No valid data found in CSV file.")
            
        _log("Concatenating and saving to Parquet (This might take a moment)...")
        final_df = pd.concat(all_dfs, ignore_index=True)
        
        # Sort by time just in case
        if 'time' in final_df.columns:
            final_df.sort_values('time', inplace=True)
            
        final_df.to_parquet(output_file, index=False)
        
        _log(f"Successfully saved {len(final_df)} rows to Parquet.")
        
        # Cleanup temp file
        try:
            if os.path.exists(input_csv_path):
                os.remove(input_csv_path)
        except Exception as e:
            print(f"Failed to delete temp file: {e}")

        if job.status == TrainingStatus.RUNNING:
            job.status = TrainingStatus.COMPLETED
            job.progress = 100.0
            db.commit()
            
    except Exception as e:
        job.status = TrainingStatus.FAILED
        job.error_message = f"CSV Parsing Error: {str(e)}"
        _log(f"ERROR: {str(e)}")
        db.commit()
    finally:
        db.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", type=str, required=True)
    parser.add_argument("--input", type=str, required=True)
    parser.add_argument("--job_id", type=str, required=True)
    args = parser.parse_args()
    
    run_tickstory_parser(args.symbol, args.input, args.job_id)
