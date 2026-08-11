import sys
import os

# Ensure backend root is in Python path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

from app.services.ml.forex_model_factory import get_forex_model

ALGORITHMS = [
    'ARIMA', 'VAR', 'GARCH', 'EGARCH', 'NeuralProphet',
    'HMM', 'Markov-Switching', 'Bayesian NN',
    'Random Forest', 'XGBoost', 'LightGBM', 'CatBoost', 'TabNet',
    'LSTM', 'GRU', 'TCN',
    '1D-CNN', 'DeepLOB', 'Transformer',
    'PPO-RL', 'SAC-RL', 'A2C-RL', 'DDPG-RL', 'TD3-RL', 'DQN-RL',
    'QR-DQN', 'CQL', 'GAIL',
    'Decision-Transformer', 'Liquid-NN',
    'Auto-Encoder'
]

def verify():
    print(f"--- Starting Forex ML Factory Verification ---")
    print(f"Total Algorithms to test: {len(ALGORITHMS)}\n")
    
    success_count = 0
    fail_count = 0
    
    for algo in ALGORITHMS:
        try:
            model = get_forex_model(algo, config={'epochs': 10})
            model_class = model.__class__.__name__
            print(f"[OK] {algo:25} -> Instantiated as: {model_class}")
            success_count += 1
        except Exception as e:
            print(f"[ERROR] {algo:25} -> Failed: {e}")
            fail_count += 1
            
    print(f"\n--- Verification Complete ---")
    print(f"Success: {success_count}/{len(ALGORITHMS)}")
    if fail_count > 0:
        print(f"Failed: {fail_count}/{len(ALGORITHMS)}")
        sys.exit(1)
    else:
        print("All algorithms routed successfully!")
        
if __name__ == "__main__":
    verify()
