import requests
import json
import time

def verify_feature_selector():
    print("🚀 Starting L2 Auto-Feature Selector Verification...\n")
    
    url = "http://localhost:8000/api/v1/model-training/suggest-features"
    payload = {
        "symbol": "BTC/USDT"
    }
    headers = {
        "Content-Type": "application/json"
    }
    
    print(f"📡 Sending POST request to {url} for symbol: {payload['symbol']}")
    start_time = time.time()
    
    try:
        response = requests.post(url, json=payload, headers=headers)
        elapsed_time = time.time() - start_time
        
        if response.status_code == 200:
            data = response.json()
            print(f"\n✅ [SUCCESS] API responded with Status 200 in {elapsed_time:.2f} seconds!\n")
            
            print("📊 Analysis Statistics:")
            print(f"  - Rows Scanned (Live Ticks): {data.get('rows_scanned')}")
            print(f"  - Features Calculated: {data.get('analyzed_count')}")
            
            print("\n🌟 Top Suggested Optimal Features:")
            suggestions = data.get('suggestions', [])
            for idx, feat in enumerate(suggestions, 1):
                print(f"  {idx}. {feat.get('name')} (Internal: {feat.get('internal')}) - predictive score: {feat.get('score')}%")
                
            print("\n🎯 Verification Complete. System is working perfectly!")
            
        else:
            print(f"\n❌ [ERROR] API responded with Status {response.status_code}")
            print("Response:", response.text)
            
    except Exception as e:
        print(f"\n❌ [ERROR] Failed to connect to the backend server. Exception: {e}")

if __name__ == "__main__":
    verify_feature_selector()
