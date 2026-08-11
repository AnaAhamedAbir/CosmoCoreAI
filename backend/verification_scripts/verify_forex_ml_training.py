import sys
import os
import pandas as pd
import numpy as np

# Ensure backend root is in Python path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

from app.services.ml.forex_model_factory import get_forex_model

ALGORITHMS = [
    # 1. Statistical
    'ARIMA', 'VAR', 'GARCH', 'EGARCH', 'NeuralProphet',
    # 2. Regime
    'HMM', 'Markov-Switching', 'Bayesian NN',
    # 3. Tabular
    'Random Forest', 'XGBoost', 'LightGBM', 'CatBoost', 'TabNet',
    # 4. Deep Learning
    'LSTM', 'GRU', 'TCN', '1D-CNN', 'DeepLOB', 'Transformer', 'Auto-Encoder', 'Liquid-NN',
    # 5. RL
    'PPO-RL', 'SAC-RL', 'A2C-RL', 'DDPG-RL', 'TD3-RL', 'DQN-RL', 'QR-DQN', 'CQL', 'GAIL', 'Decision-Transformer'
]

def verify_training():
    print(f"--- Starting Full E2E Forex ML Training Verification ---")
    
    # 1. Create Dummy Data
    np.random.seed(42)
    dates = pd.date_range(start='2025-01-01', periods=200, freq='h')
    X_data = np.random.randn(200, 10) # 200 samples, 10 features
    y_data = np.random.choice([0, 1], size=200) # Binary classification
    
    X = pd.DataFrame(X_data, index=dates, columns=[f'feature_{i}' for i in range(10)])
    y = pd.Series(y_data, index=dates)
    
    success_count = 0
    fail_count = 0
    
    for algo in ALGORITHMS:
        try:
            # We use small epochs/timesteps for quick verification
            config = {'epochs': 1, 'timesteps': 100} 
            model = get_forex_model(algo, config=config)
            
            # For RL models mapped to dummy/fallback we need to pass small timesteps if they are StableBaselines wrappers
            if hasattr(model, 'total_timesteps'):
                model.total_timesteps = 100
                
            model.fit(X, y)
            preds = model.predict(X)
            
            if len(preds) == len(y):
                print(f"[OK] {algo:25} -> Training & Prediction successful.")
                success_count += 1
            else:
                print(f"[ERROR] {algo:25} -> Prediction length mismatch: expected {len(y)}, got {len(preds)}")
                fail_count += 1
                
        except Exception as e:
            print(f"[ERROR] {algo:25} -> Failed: {e}")
            fail_count += 1
            
    print(f"\n--- Verification Complete ---")
    print(f"Success: {success_count}/{len(ALGORITHMS)}")
    if fail_count > 0:
        print(f"Failed: {fail_count}/{len(ALGORITHMS)}")
        sys.exit(1)
    else:
        print("All algorithms trained and predicted successfully!")
        
if __name__ == "__main__":
    verify_training()
