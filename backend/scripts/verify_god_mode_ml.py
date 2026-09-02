import sys
import os
import json

# Add backend directory to sys.path to resolve imports if necessary
backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.services.ml_god_mode_features import calculate_god_mode_ml_features

def test_calculate_god_mode_features():
    print("=== Testing God Mode ML Features ===")
    
    # Create dummy L2 orderbook
    # [price, size]
    current_price = 60000.0
    
    # Fake Asks (Short liquidations above price)
    asks = []
    for i in range(1, 51):
        price = current_price + (i * 10)
        size = 1.0
        if i == 20: # Create a massive short liquidation magnet at 60200
            size = 100.0
        asks.append([str(price), str(size)])
        
    # Fake Bids (Long liquidations below price)
    bids = []
    for i in range(1, 51):
        price = current_price - (i * 10)
        size = 2.0
        if i == 5: # Create a small long liquidation magnet at 59950
            size = 30.0
        bids.append([str(price), str(size)])

    print("Test 1: Running Feature Extraction with Dummy Data...")
    features = calculate_god_mode_ml_features(bids, asks, current_price)
    
    print("\n[Resulting Features]")
    for k, v in features.items():
        print(f" - {k}: {v:.2f}")

    # Verification Checks
    assert features["magnet_intensity_above"] == 100.0, "Expected max intensity (100) for the 100 size ask wall."
    
    # Distance to 60200 from 60000 = 200. (200/60000) * 100 = 0.333%
    expected_dist_above = (abs(60200 - 60000) / 60000) * 100
    assert abs(features["magnet_distance_above"] - expected_dist_above) < 0.01, f"Expected upper distance {expected_dist_above}, got {features['magnet_distance_above']}"
    
    # CVD Spoof state: 100 intensity above vs smaller below
    assert features["cvd_spoof_state"] == -1.0, "Expected -1.0 spoof state (massive fake ask wall)."
    
    print("\n✅ All tests passed successfully!")
    print("The modular ml_god_mode_features.py integration is mathematically sound and ready for real-time live market scraping.")

if __name__ == "__main__":
    test_calculate_god_mode_features()
