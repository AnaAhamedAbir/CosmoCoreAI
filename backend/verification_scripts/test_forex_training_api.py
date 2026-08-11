import requests
import json
import time

# API Endpoint for Forex Model Training
API_URL = "http://localhost:8000/api/v1/forex/model-training/train"

# Combined Payload with all Forex Features
payload = {
    # 1. Base Configuration
    "symbol": "EUR_USD",               # The Forex pair
    "timeframe": "1h",                 # Timeframe (1m, 5m, 1h, 1d)
    "prediction_target": "classification", # classification (Up/Down) or regression (Price)
    "algorithm": "LSTM",               # Try: 'LSTM', 'GARCH', 'HMM', 'PPO-RL', 'Random Forest'
    "epochs": 10,                      # Low epochs for quick testing
    "learning_rate": 0.001,            # Standard learning rate
    
    # 2. Data Selection
    "data_source": "historical",       # 'historical' or 'live'
    "start_date": "2023-01-01",
    "end_date": "2023-06-01",
    "days_of_data": 0,                 # Used if start/end date are empty
    "limit": 1000,                     # Max rows to fetch from OANDA
    "purge_existing_data": True,       # Clean up old data before training
    
    # 3. Features (The Combine Input Settings)
    "features": [
        "close", "volume",             # Base Price/Volume
        "rsi", "macd", "bollinger",    # Technical Indicators
        "atr", "stoch"                 # Momentum & Volatility
    ],
    
    # 4. Advanced Settings (Class Imbalance & Sliding Window)
    "imbalance_strategy": "SMOTE",     # SMOTE, ADASYN, Undersampling, ClassWeights
    "sliding_window": 10,              # Essential for LSTM/TCN/CNN (Lookback period)
    
    # 5. Ensemble & Deep Learning Hyperparams
    "is_ensemble": False,              # Set to True to test ensemble builder
    "ensemble_method": "Voting",       # Voting, Stacking, Boosting
    "base_models": [],                 # e.g., ["ARIMA", "GARCH", "LSTM"]
    "meta_model": "Random Forest",
    "voting_strategy": "soft",
    
    # 6. Feature Selection & Post-Processing
    "use_clustered_importance": True,  # MDA Feature Selection
    "auto_optimize_weights": False,
    "feature_subspacing": False
}

def test_training():
    print("🚀 Sending Training Request to Forex Engine...")
    print(f"URL: {API_URL}")
    print(f"Algorithm: {payload['algorithm']}")
    print(f"Pair: {payload['symbol']}")
    print("-" * 50)
    
    try:
        response = requests.post(API_URL, json=payload)
        
        if response.status_code == 200:
            data = response.json()
            job_id = data.get("job_id")
            print("✅ Training Job Started Successfully!")
            print(f"📌 Job ID: {job_id}")
            print(f"📌 Status: {data.get('status')}")
            print(f"📌 Message: {data.get('message')}")
            print("\n💡 You can now check the Docker logs to see the training progress!")
        else:
            print(f"❌ Failed to start training.")
            print(f"Status Code: {response.status_code}")
            print(f"Error: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print("❌ Connection Error: Backend is not running.")
        print("Make sure you run `docker compose up` first!")

if __name__ == "__main__":
    test_training()
