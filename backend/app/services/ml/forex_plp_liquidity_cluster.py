import pandas as pd
import numpy as np
from typing import List

def generate_plp_liquidity_cluster_features(df: pd.DataFrame, selected_features: List[str]) -> pd.DataFrame:
    """Module 1: Synthetic Liquidity Cluster & Density Module (19 Features)"""
    
    bid_vols = [c for c in df.columns if c.startswith('bid_vol') and c != 'bid_volume']
    ask_vols = [c for c in df.columns if c.startswith('ask_vol') and c != 'ask_volume']
    
    deep_bids = [c for c in bid_vols if c not in ['bid_vol1', 'bid_vol2', 'bid_vol3']]
    deep_asks = [c for c in ask_vols if c not in ['ask_vol1', 'ask_vol2', 'ask_vol3']]
    
    total_deep_bid = df[deep_bids].sum(axis=1) if deep_bids else pd.Series(0, index=df.index)
    total_deep_ask = df[deep_asks].sum(axis=1) if deep_asks else pd.Series(0, index=df.index)
    total_vol = df[bid_vols].sum(axis=1) + df[ask_vols].sum(axis=1) if bid_vols else pd.Series(1, index=df.index)

    if 'abs_long_liq_pool_proxy' in selected_features: df['abs_long_liq_pool_proxy'] = total_deep_bid
    if 'abs_short_liq_pool_proxy' in selected_features: df['abs_short_liq_pool_proxy'] = total_deep_ask
        
    if 'liquidation_density_z_score_proxy' in selected_features:
        z = (total_vol - total_vol.rolling(20).mean()) / total_vol.rolling(20).std().replace(0, np.nan)
        df['liquidation_density_z_score_proxy'] = z.ffill().fillna(0)
        
    if 'leverage_washout_z_score_proxy' in selected_features and 'bid_vol1' in df.columns:
        washout = abs(df['bid_vol1'].diff().clip(upper=0)) + abs(df['ask_vol1'].diff().clip(upper=0))
        z_wash = (washout - washout.rolling(20).mean()) / washout.rolling(20).std().replace(0, np.nan)
        df['leverage_washout_z_score_proxy'] = z_wash.ffill().fillna(0)

    if 'high_leverage_cluster_proximity_proxy' in selected_features and 'bid1' in df.columns and 'bid5' in df.columns:
        df['high_leverage_cluster_proximity_proxy'] = (df['bid1'] - df['bid5']) / df['bid1']
        
    if 'margin_call_proximity_index_proxy' in selected_features and 'ask5' in df.columns and 'ask1' in df.columns:
        df['margin_call_proximity_index_proxy'] = (df['ask5'] - df['ask1']) / df['ask1']

    if 'magnetic_liquidity_pull_vector_proxy' in selected_features:
        df['magnetic_liquidity_pull_vector_proxy'] = np.where(total_deep_bid > total_deep_ask, -1, np.where(total_deep_ask > total_deep_bid, 1, 0))

    if 'liq_cluster_density_heatmap_proxy' in selected_features:
        df['liq_cluster_density_heatmap_proxy'] = (total_deep_bid + total_deep_ask) / total_vol.replace(0, np.nan).fillna(1)

    if 'synthetic_leverage_ratio_proxy' in selected_features and 'bid_vol1' in df.columns:
        top_vol = df['bid_vol1'] + df['ask_vol1']
        df['synthetic_leverage_ratio_proxy'] = top_vol / total_vol.replace(0, np.nan).fillna(1)

    if 'hidden_liquidity_absorption_proxy' in selected_features and 'bid1' in df.columns:
        price_var = ((df['bid1'] + df['ask1']) / 2).rolling(10).var().replace(0, 1e-9)
        df['hidden_liquidity_absorption_proxy'] = (total_vol.rolling(10).mean() / price_var).ffill().fillna(0)

    if 'stale_liquidity_decay_proxy' in selected_features and deep_bids:
        decay = (df[deep_bids[0]].diff().clip(upper=0) + df[deep_asks[0]].diff().clip(upper=0)).abs()
        df['stale_liquidity_decay_proxy'] = decay.rolling(5).mean().ffill().fillna(0)

    if 'cross_margin_cascade_risk_proxy' in selected_features and 'bid1' in df.columns:
        spread = df['ask1'] - df['bid1']
        df['cross_margin_cascade_risk_proxy'] = spread.rolling(5).std().ffill().fillna(0) * total_vol

    if 'stealth_liquidation_proxies_proxy' in selected_features and 'bid_vol1' in df.columns:
        df['stealth_liquidation_proxies_proxy'] = df['bid_vol1'].diff().abs().rolling(3).sum() * (df['bid1'].diff() == 0).astype(int)

    if 'gamma_exposure_imbalance_proxy' in selected_features and 'bid_vol1' in df.columns:
        df['gamma_exposure_imbalance_proxy'] = (df['bid_vol1'].diff().diff() - df['ask_vol1'].diff().diff()).ffill().fillna(0)

    if 'zero_dte_options_proxy_pull' in selected_features and 'bid1' in df.columns:
        mid = (df['bid1'] + df['ask1']) / 2
        mom = mid.diff(3).ffill().fillna(0)
        df['zero_dte_options_proxy_pull'] = mom * total_vol

    if 'retail_pain_threshold_proxy' in selected_features and 'bid1' in df.columns:
        spread = df['ask1'] - df['bid1']
        pain = (spread > spread.rolling(50).mean()).astype(int)
        df['retail_pain_threshold_proxy'] = pain.rolling(10).sum()

    if 'liquidation_void_zones_proxy' in selected_features:
        df['liquidation_void_zones_proxy'] = np.where((total_deep_bid + total_deep_ask) < total_vol * 0.1, 1, 0)

    if 'smart_money_trap_indicator_proxy' in selected_features and 'bid1' in df.columns:
        mid = (df['bid1'] + df['ask1']) / 2
        price_trend = np.sign(mid.diff(3)).values
        vol_trend = np.sign(df['bid_vol1'].diff(3) - df['ask_vol1'].diff(3)).values
        df['smart_money_trap_indicator_proxy'] = np.where((price_trend > 0) & (vol_trend < 0), -1, np.where((price_trend < 0) & (vol_trend > 0), 1, 0))

    if 'leveraged_retail_skew_proxy' in selected_features and 'bid_vol1' in df.columns:
        df['leveraged_retail_skew_proxy'] = (df['bid_vol1'] - df['ask_vol1']) / (df['bid_vol1'] + df['ask_vol1'] + 1e-9)

    import gc
    gc.collect()

    return df
