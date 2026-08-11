import pandas as pd
import numpy as np
from typing import List

def generate_plp_stop_hunt_features(df: pd.DataFrame, selected_features: List[str]) -> pd.DataFrame:
    """Module 3: Stop-Hunt & Sweep Mechanism Module (15 Features)"""
    
    mid = None
    if 'bid1' in df.columns and 'ask1' in df.columns:
        mid = (df['bid1'] + df['ask1']) / 2
        spread = df['ask1'] - df['bid1']
        
    bid_vols = [c for c in df.columns if c.startswith('bid_vol') and c != 'bid_volume']
    ask_vols = [c for c in df.columns if c.startswith('ask_vol') and c != 'ask_volume']
    total_vol = df[bid_vols].sum(axis=1) + df[ask_vols].sum(axis=1) if bid_vols else pd.Series(1, index=df.index)

    if 'stop_hunt_probability_proxy' in selected_features and mid is not None:
        vol_spike = total_vol > total_vol.rolling(10).mean() + 2 * total_vol.rolling(10).std()
        price_spike = abs(mid.diff()) > abs(mid.diff()).rolling(10).mean() * 3
        df['stop_hunt_probability_proxy'] = (vol_spike & price_spike).astype(int)

    if 'liquidity_sweep_velocity_proxy' in selected_features:
        df['liquidity_sweep_velocity_proxy'] = total_vol.diff().abs() / spread.replace(0, 1e-9)

    if 'fakeout_prob_model_proxy' in selected_features and mid is not None:
        mom = mid.diff(3)
        rev = mid.diff().shift(-1) # Fakeout predicts next tick, but wait! NO SHIFT(-1)!
        # Fix: historical fakeout
        rev_hist = np.sign(mid.diff()) != np.sign(mid.diff().shift(1))
        df['fakeout_prob_model_proxy'] = np.where(rev_hist & (abs(mom.shift(1)) > 0.0001), 1, 0)

    if 'sweep_and_reversal_ratio_proxy' in selected_features and mid is not None:
        df['sweep_and_reversal_ratio_proxy'] = abs(mid.diff()) / abs(mid.diff(3)).replace(0, 1e-9)

    if 'stop_loss_trigger_density_proxy' in selected_features and 'bid1' in df.columns:
        # Proxy: round numbers
        dist_to_round = abs(df['bid1'] % 0.0010 - 0.0005)
        df['stop_loss_trigger_density_proxy'] = np.where(dist_to_round < 0.0001, total_vol, 0)

    if 'predatory_algo_footprint_proxy' in selected_features and 'bid_vol1' in df.columns:
        df['predatory_algo_footprint_proxy'] = (df['bid_vol1'].diff().abs() > df['bid_vol1'].rolling(20).std() * 3).astype(int)

    if 'institutional_sweep_divergence_proxy' in selected_features and 'bid_vol1' in df.columns:
        ofi = df['bid_vol1'].diff() - df['ask_vol1'].diff()
        df['institutional_sweep_divergence_proxy'] = np.where((np.sign(ofi) != np.sign(mid.diff())), 1, 0)

    if 'retail_trap_indicator_proxy' in selected_features and 'bid_vol1' in df.columns:
        df['retail_trap_indicator_proxy'] = (spread > spread.rolling(20).mean()).astype(int) * (df['bid_vol1'] < df['bid_vol2']).astype(int)

    if 'high_frequency_hunt_ratio_proxy' in selected_features and mid is not None:
        df['high_frequency_hunt_ratio_proxy'] = mid.rolling(10).apply(lambda x: sum(np.diff(np.sign(np.diff(x))) != 0)).ffill().fillna(0)

    if 'sweep_efficiency_score_proxy' in selected_features and mid is not None:
        df['sweep_efficiency_score_proxy'] = (abs(mid.diff()) / total_vol.diff().abs().replace(0, 1e-9)).ffill().fillna(0)

    if 'low_latency_sweep_detection_proxy' in selected_features and 'bid_vol3' in df.columns:
        df['low_latency_sweep_detection_proxy'] = ((df['bid_vol1'] == 0) & (df['bid_vol2'] == 0)).astype(int)

    if 'wash_trade_sweep_detection_proxy' in selected_features and 'bid_vol1' in df.columns:
        df['wash_trade_sweep_detection_proxy'] = ((df['bid_vol1'].diff() > 0) & (mid.diff() == 0)).astype(int)

    if 'institutional_footprint_masking_proxy' in selected_features and 'bid_vol1' in df.columns:
        df['institutional_footprint_masking_proxy'] = df['bid_vol1'].rolling(10).var().ffill().fillna(0) / (total_vol.rolling(10).var() + 1e-9)

    if 'fakeout_velocity_acceleration_proxy' in selected_features and mid is not None:
        df['fakeout_velocity_acceleration_proxy'] = mid.diff().diff().abs().ffill().fillna(0)

    if 'stop_hunt_asymmetry_proxy' in selected_features and 'bid_vol1' in df.columns:
        df['stop_hunt_asymmetry_proxy'] = (df['bid_vol1'].diff().abs() - df['ask_vol1'].diff().abs()).ffill().fillna(0)

    if 'retail_panic_sweep_proxy' in selected_features and 'bid1' in df.columns:
        df['retail_panic_sweep_proxy'] = ((spread > spread.rolling(20).mean() * 2) & (total_vol < total_vol.rolling(20).mean() * 0.5)).astype(int)

    if 'algo_hunt_intensity_proxy' in selected_features and 'bid_vol1' in df.columns:
        df['algo_hunt_intensity_proxy'] = (df['bid_vol1'].diff().abs() + df['ask_vol1'].diff().abs()).rolling(5).mean().ffill().fillna(0)

    return df
