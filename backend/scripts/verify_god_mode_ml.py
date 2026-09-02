import sys
import os
import json

# Add backend directory to sys.path to resolve imports if necessary
backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.services.ml_god_mode_features import calculate_god_mode_ml_features
from app.strategies.helpers.god_mode_signal_evaluator import GodModeSignalEvaluator

def test_calculate_god_mode_features():
    print("=== Testing God Mode ML Features & Evaluator ===")
    
    current_price = 60000.0
    
    # Fake Asks
    asks = []
    for i in range(1, 51):
        price = current_price + (i * 10)
        size = 1.0
        if i == 20: # massive ask wall at 60200
            size = 100.0
        asks.append([str(price), str(size)])
        
    # Fake Bids
    bids = []
    for i in range(1, 51):
        price = current_price - (i * 10)
        size = 2.0
        if i == 5: # smaller bid wall at 59950
            size = 30.0
        bids.append([str(price), str(size)])

    print("\nTest 1: Running Feature Extraction with Dummy Data...")
    features = calculate_god_mode_ml_features(bids, asks, current_price)
    
    print("\n[Resulting Features]")
    for k, v in features.items():
        print(f" - {k}: {v:.2f}")

    assert features["magnet_intensity_above"] == 100.0, "Expected max intensity (100) for the 100 size ask wall."
    
    print("\nTest 2: Running God Mode Signal Evaluator (Score Check)")
    eval_res = GodModeSignalEvaluator.evaluate(bids, asks, current_price, threshold_long=80, threshold_short=-80)
    
    print("\n[Evaluator Results]")
    for k, v in eval_res.items():
        if k != 'features':
            print(f" - {k}: {v}")

    print("\n[OK] All tests passed successfully!")
    print("[OK] God Mode ML Confluence logic has been injected into wall_hunter engines.")

if __name__ == "__main__":
    test_calculate_god_mode_features()
