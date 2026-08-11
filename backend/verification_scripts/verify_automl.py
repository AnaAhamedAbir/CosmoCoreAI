import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import numpy as np
import pandas as pd
from app.services.ml_automl import run_optuna_study

def test_optuna():
    print("Testing Optuna AutoML...")
    
    # Create dummy data
    np.random.seed(42)
    num_samples = 200
    num_features = 5
    
    X_train = pd.DataFrame(np.random.randn(num_samples, num_features), columns=[f"F{i}" for i in range(num_features)])
    y_train = np.random.randint(0, 2, size=num_samples)
    
    X_val = pd.DataFrame(np.random.randn(50, num_features), columns=[f"F{i}" for i in range(num_features)])
    y_val = np.random.randint(0, 2, size=50)

    def dummy_logger(msg):
        print(f"[LOG] {msg}")

    try:
        # Run 2 trials to keep it fast
        best_params = run_optuna_study(
            algorithm="Random Forest",
            X_train=X_train,
            y_train=y_train,
            X_val=X_val,
            y_val=y_val,
            is_classification=True,
            n_trials=2,
            add_log=dummy_logger
        )
        print("Best params found:", best_params)
        assert len(best_params) > 0, "Should return hyperparameters"
        print("Verification PASSED.")
    except Exception as e:
        print(f"Verification FAILED: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_optuna()
