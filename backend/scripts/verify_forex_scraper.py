import os
import sys
import uuid
import glob
import pandas as pd
from datetime import datetime

# Setup paths
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app.db.session import SessionLocal
from app.models.model_training import ModelTrainingJob

def test_forex_scraper():
    print("=== Testing Forex Scraper & Parquet Pipeline ===")
    
    # 1. Create a mock job for the collector
    job_id = f"test_forex_job_{uuid.uuid4().hex[:8]}"
    db = SessionLocal()
    try:
        new_job = ModelTrainingJob(
            id=job_id,
            user_id=1,
            symbol="EUR_USD",
            timeframe="Tick",
            algorithm="Forex Data Collector",
            status="RUNNING",
            market_type="forex",
            progress=0.0,
            config={"target_rows": 50, "dataset_type": "forex_collector"},
            logs=["Test job started"]
        )
        db.add(new_job)
        db.commit()
    except Exception as e:
        print(f"Failed to create mock job (this is fine if user_id FK constraint fails): {e}")
        db.rollback()
        print("Aborting test due to DB error.")
        return

    # 2. Run the collector
    print(f"\n1. Running forex_collector.py for job {job_id}...")
    import sys
    
    # Mocking environment and requests for testing
    os.environ["OANDA_API_KEY"] = "mock_key"
    os.environ["OANDA_ACCOUNT_ID"] = "mock_account"
    
    from unittest.mock import patch
    
    mock_json = {
        "candles": [
            {"complete": True, "time": "2023-10-01T00:00:00Z", "mid": {"o": "1.0", "h": "1.1", "l": "0.9", "c": "1.05"}, "volume": 100},
            {"complete": True, "time": "2023-10-01T00:15:00Z", "mid": {"o": "1.05", "h": "1.15", "l": "1.0", "c": "1.1"}, "volume": 120}
        ]
    }
    
    with patch('requests.get') as mock_get:
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = mock_json
        
        from scripts.forex_collector import run_forex_collector
        run_forex_collector("EUR_USD", 50, job_id)

    
    # 3. Check for the generated parquet file
    print("\n2. Checking for generated .parquet files...")
    data_dir = os.path.join(os.getcwd(), "data", "raw", "forex_snapshots")
    pattern = os.path.join(data_dir, "EUR_USD_*.parquet")
    files = glob.glob(pattern)
    
    if not files:
        print("❌ FAIL: No parquet files found.")
        return
        
    files.sort(key=os.path.getmtime, reverse=True)
    latest_file = files[0]
    print(f"✅ SUCCESS: Found parquet file: {latest_file}")
    
    # 4. Read the file
    print("\n3. Testing file readability...")
    try:
        df = pd.read_parquet(latest_file)
        print(f"✅ SUCCESS: Read {len(df)} rows from {os.path.basename(latest_file)}.")
        print(df.head(2))
    except Exception as e:
        print(f"❌ FAIL: Could not read parquet file. {e}")
        return
        
    # 5. Test the engine logic
    print("\n4. Testing Engine data loading logic...")
    try:
        # Replicate the logic from forex_ml_training_engine.py
        snapshot_file = os.path.basename(latest_file)
        data_file = os.path.join(data_dir, snapshot_file)
        
        df_engine = pd.read_parquet(data_file)
        df_engine['time'] = pd.to_datetime(df_engine['time'], utc=True).dt.tz_localize(None)
        df_engine.set_index('time', inplace=True)
        print(f"✅ SUCCESS: Engine logic successfully prepared {len(df_engine)} rows.")
    except Exception as e:
        print(f"❌ FAIL: Engine logic failed. {e}")
        return
        
    print("\n=== All Tests Passed! ===")
    
    # Cleanup mock job
    try:
        db.delete(new_job)
        db.commit()
    except:
        pass
    db.close()

if __name__ == "__main__":
    test_forex_scraper()
