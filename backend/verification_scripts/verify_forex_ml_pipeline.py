import requests
import time
import sys

BASE_URL = "http://localhost:8000/api/v1/forex-model-training"

def verify_pipeline():
    print("🚀 Starting Forex ML Pipeline Verification...")
    
    # 1. Start Training Job
    payload = {
        "symbol": "EUR/USD",
        "timeframe": "1h",
        "algorithm": "Random Forest",
        "config": {
            "epochs": 10,
            "broker": "oanda",
            "market_session_features": True,
            "ignore_weekend_gaps": True,
            "macroeconomic_calendar": True,
            "tick_volume_profiler": False,
            "cot_data": False,
            "currency_correlation": False,
            "yield_differentials": False,
            "target_rows": 1000
        }
    }
    
    print("\n[1] Submitting Training Job...")
    try:
        response = requests.post(f"{BASE_URL}/train", json=payload)
        response.raise_for_status()
        job = response.json()
        job_id = job['id']
        print(f"✅ Job Created Successfully! Job ID: {job_id}")
    except requests.exceptions.RequestException as e:
        print(f"❌ Failed to create job: {e}")
        if e.response is not None:
            print(e.response.text)
        sys.exit(1)

    # 2. Poll Status
    print("\n[2] Polling Job Status...")
    max_retries = 30
    for i in range(max_retries):
        try:
            res = requests.get(f"{BASE_URL}/jobs/{job_id}")
            res.raise_for_status()
            job_data = res.json()
            status = job_data['status']
            progress = job_data.get('progress', 0)
            print(f"   ⏳ Status: {status} | Progress: {progress}%")
            
            # Print latest logs
            logs = job_data.get('logs', [])
            if logs:
                print(f"      [Log] {logs[-1]}")
            
            if status == 'COMPLETED':
                print(f"\n✅ Pipeline Verification Successful! Job completed.")
                sys.exit(0)
            elif status == 'FAILED':
                error_msg = job_data.get('error_message', 'Unknown Error')
                print(f"\n❌ Pipeline Failed! Error: {error_msg}")
                sys.exit(1)
                
            time.sleep(2)
        except requests.exceptions.RequestException as e:
            print(f"❌ Failed to get job status: {e}")
            time.sleep(2)

    print("\n⚠️ Verification Timed Out.")
    sys.exit(1)

if __name__ == "__main__":
    verify_pipeline()
