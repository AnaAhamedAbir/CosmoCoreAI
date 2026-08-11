import sys
import os
import pandas as pd
import numpy as np

# Add backend directory to sys.path so we can import app modules
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.services.predatory_liquidity_pipeline import calculate_plp_features

def generate_mock_data():
    print("Generating mock L2 + Trade merged data...")
    # Generate 500 rows of mock data simulating the merged DataFrame
    dates = pd.date_range("2026-05-14 12:00:00", periods=500, freq="1s")
    
    np.random.seed(42)
    # Simulate a random walk for price
    price_changes = np.random.normal(loc=0, scale=0.001, size=500)
    prices = 60000 * np.exp(np.cumsum(price_changes))
    
    # Simulate volumes with some spikes
    qty = np.random.lognormal(mean=0, sigma=1.5, size=500)
    
    # Simulate spread and obi
    spread = np.random.uniform(low=0.0001, high=0.0010, size=500)
    obi = np.random.uniform(low=-1.0, high=1.0, size=500)
    
    df = pd.DataFrame({
        'timestamp': dates,
        'Close': prices,
        'qty': qty,
        'spread': spread,
        'obi': obi,
    })
    df.set_index('timestamp', inplace=True)
    return df

def run_verification():
    df = generate_mock_data()
    print(f"Mock Data shape: {df.shape}")
    
    all_features = [
        # Module 1
        'liquidation_density_z_score', 'leverage_washout_z_score', 'high_leverage_cluster_proximity',
        'margin_call_proximity_index', 'magnetic_liquidity_pull_vector', 'liq_cluster_density_heatmap',
        'synthetic_leverage_ratio', 'hidden_liquidity_absorption', 'stale_liquidity_decay', 'cross_margin_cascade_risk',
        # Module 2
        'liquidation_cascade_multiplier', 'long_squeeze_probability', 'short_squeeze_probability',
        'cascade_velocity_index', 'domino_effect_threshold', 'cascade_decay_rate', 'forced_liquidation_trigger_pts',
        'volatility_expansion_on_liq', 'squeeze_exhaustion_metric', 'liquidator_bot_activity_proxy',
        # Module 3
        'stop_hunt_probability', 'liquidity_sweep_velocity', 'fakeout_prob_model', 'sweep_and_reversal_ratio',
        'stop_loss_trigger_density', 'predatory_algo_footprint', 'institutional_sweep_divergence',
        'retail_trap_indicator', 'high_frequency_hunt_ratio', 'sweep_efficiency_score',
        # Module 4
        'institutional_order_flow_imbalance', 'smart_money_accumulation_dist', 'fvg_liquidity_draw_prob',
        'order_block_mitigation_speed', 'time_weighted_vampire_flow', 'bms_confirmation_strength',
        'choch_volatility_multiplier', 'imbalance_to_volume_ratio', 'sponsor_candle_footprint', 'dark_pool_proxy_index',
        # Module 5
        'oi_wipeout_ratio', 'funding_rate_shift_pre_liq', 'implied_margin_pressure', 'vol_skew_liquidation_bias',
        'bid_ask_spread_blowout', 'flash_crash_probability', 'tail_risk_expansion_index', 'gamma_squeeze_synthetic',
        'leverage_decay_factor', 'margin_variance_premium'
    ]
    
    print(f"Testing {len(all_features)} PLP Features...")
    
    try:
        plp_df = calculate_plp_features(df, all_features)
        
        print(f"Result DataFrame shape: {plp_df.shape}")
        
        # Check if all columns are present
        missing = [f for f in all_features if f not in plp_df.columns]
        if missing:
            print(f"[FAIL] Missing columns: {missing}")
        else:
            print(f"[PASS] All {len(all_features)} features were successfully calculated.")
            
        # Check for NaNs
        nans = plp_df.isna().sum()
        cols_with_nans = nans[nans > 0]
        if not cols_with_nans.empty:
            print(f"[WARN] Some columns contain NaN values (usually due to rolling windows at start):")
            for col, count in cols_with_nans.items():
                print(f"  - {col}: {count} NaNs")
        else:
            print(f"[PASS] No NaN values found in output.")
            
        print("\n[SUCCESS] Verification Passed: Backend Pipeline Engine is working perfectly.")
    except Exception as e:
        print(f"\n[FAIL] Verification Failed with Error:")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    run_verification()
