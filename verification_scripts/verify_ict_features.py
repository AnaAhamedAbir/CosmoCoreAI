import pandas as pd
import numpy as np
import time
import sys
import os

# Ensure backend modules can be imported
sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))
from app.services.feature_engines.ict_features import ICTFeatureEngine

def generate_mock_data():
    # Generate 1440 minutes (1 day) of mock 1-minute data in UTC
    dates = pd.date_range(start="2026-06-25 00:00:00", periods=1440, freq="min", tz="UTC")
    
    np.random.seed(42)
    closes = np.cumsum(np.random.randn(1440) * 10) + 50000
    highs = closes + np.random.rand(1440) * 20
    lows = closes - np.random.rand(1440) * 20
    volumes = np.random.rand(1440) * 100
    
    df = pd.DataFrame({
        'Close': closes,
        'High': highs,
        'Low': lows,
        'Volume': volumes
    }, index=dates)
    
    return df

def test_ict_features():
    df = generate_mock_data()
    print(f"Mock Data Generated: {len(df)} rows")
    
    requested_features = [
        'london_killzone_momentum',
        'ny_killzone_momentum',
        'asian_consolidation_breakout',
        'true_day_open_deviation',
        'pdh_pdl_sweep_proxy',
        'turtle_soup_fakeout',
        'smt_divergence_synthetic',
        'institutional_pricing_magnet',
        'judas_swing_probability',
        'silver_bullet_time_proximity'
    ]
    
    print("\n--- Running ICTFeatureEngine ---")
    start_t = time.time()
    result_df = ICTFeatureEngine.compute_ict_features(df, requested_features)
    end_t = time.time()
    
    print(f"Computation took {end_t - start_t:.4f} seconds.")
    
    print("\n--- Verification Results ---")
    for f in requested_features:
        if f in result_df.columns:
            null_count = result_df[f].isnull().sum()
            non_zero_count = (result_df[f] != 0).sum()
            print(f"[OK] {f}: Calculated successfully | Nulls: {null_count} | Non-Zeros: {non_zero_count}")
        else:
            print(f"[FAIL] {f}: MISSING from DataFrame!")

if __name__ == "__main__":
    test_ict_features()
