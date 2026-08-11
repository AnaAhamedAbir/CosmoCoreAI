import pandas as pd
import numpy as np
import time
import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))
from app.services.feature_engines.swing_dynamics import SwingDynamicsEngine

def generate_mock_data():
    # 50,000 rows representing 1-second HFT data
    dates = pd.date_range(start="2026-06-25 00:00:00", periods=50000, freq="s", tz="UTC")
    np.random.seed(42)
    closes = np.cumsum(np.random.randn(50000)) + 50000
    opens = closes - np.random.randn(50000) * 5
    highs = np.maximum(opens, closes) + np.random.rand(50000) * 10
    lows = np.minimum(opens, closes) - np.random.rand(50000) * 10
    volumes = np.random.rand(50000) * 10
    
    df = pd.DataFrame({
        'Open': opens,
        'High': highs,
        'Low': lows,
        'Close': closes,
        'Volume': volumes
    }, index=dates)
    return df

def test_engine():
    df = generate_mock_data()
    print(f"Mock Data Generated: {len(df)} rows")
    
    requested_features = [
        'swing_failure_pattern_proxy', 
        'break_of_structure_velocity', 
        'change_of_character_trigger', 
        'equal_highs_lows_pool', 
        'distance_to_liquidity_pool', 
        'swing_leg_amplitude', 
        'time_since_last_swing', 
        'swing_leg_velocity', 
        'premium_discount_matrix', 
        'fractal_density_index'
    ]
    
    engine = SwingDynamicsEngine()
    print("\n--- Running SwingDynamicsEngine ---")
    start_t = time.time()
    result_df = engine.generate_features(df, requested_features)
    end_t = time.time()
    
    print(f"Computation took {end_t - start_t:.4f} seconds for {len(df)} rows.")
    
    print("\n--- Verification Results ---")
    all_passed = True
    for f in requested_features:
        if f in result_df.columns:
            non_zeros = (result_df[f] != 0).sum()
            print(f"[OK] {f:30s} | Non-Zeros: {non_zeros}")
        else:
            print(f"[FAIL] {f:30s} | MISSING!")
            all_passed = False
            
    if all_passed:
        print("\n[SUCCESS] All 10 Swing Dynamics metrics calculated successfully!")

if __name__ == "__main__":
    test_engine()
