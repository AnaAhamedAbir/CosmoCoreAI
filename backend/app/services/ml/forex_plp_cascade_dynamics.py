import pandas as pd
import numpy as np
from typing import List

def generate_plp_cascade_features(df: pd.DataFrame, selected_features: List[str]) -> pd.DataFrame:
    """Module 2: Cascade & Trigger Dynamics Module (17 Features)"""
    
    mid = None
    if 'bid1' in df.columns and 'ask1' in df.columns:
        mid = (df['bid1'] + df['ask1']) / 2
        spread = df['ask1'] - df['bid1']
        
    bid_vols = [c for c in df.columns if c.startswith('bid_vol') and c != 'bid_volume']
    ask_vols = [c for c in df.columns if c.startswith('ask_vol') and c != 'ask_volume']
    total_vol = df[bid_vols].sum(axis=1) + df[ask_vols].sum(axis=1) if bid_vols else pd.Series(1, index=df.index)

    if 'liquidation_cascade_multiplier_proxy' in selected_features and mid is not None:
        spread_widening = (spread.diff() > 0).astype(int)
        depth_dropping = (total_vol.diff() < 0).astype(int)
        cascade = spread_widening & depth_dropping
        df['liquidation_cascade_multiplier_proxy'] = cascade.rolling(3).sum()

    if 'long_squeeze_probability_proxy' in selected_features and mid is not None:
        df['long_squeeze_probability_proxy'] = np.where((mid.diff() < 0) & (df['bid_vol1'].diff() < 0), 1, 0)

    if 'short_squeeze_probability_proxy' in selected_features and mid is not None:
        df['short_squeeze_probability_proxy'] = np.where((mid.diff() > 0) & (df['ask_vol1'].diff() < 0), 1, 0)

    if 'cascade_velocity_index_proxy' in selected_features:
        df['cascade_velocity_index_proxy'] = total_vol.pct_change().rolling(3).mean().ffill().fillna(0)

    if 'domino_effect_threshold_proxy' in selected_features:
        drop = total_vol.diff()
        df['domino_effect_threshold_proxy'] = (drop < -3 * drop.rolling(20).std()).astype(int)

    if 'cascade_decay_rate_proxy' in selected_features and mid is not None:
        df['cascade_decay_rate_proxy'] = spread.ewm(span=5).mean().pct_change().ffill().fillna(0)

    if 'forced_liquidation_trigger_pts_proxy' in selected_features and mid is not None:
        df['forced_liquidation_trigger_pts_proxy'] = np.where(total_vol.diff() < -total_vol.rolling(10).std(), mid, 0)

    if 'volatility_expansion_on_liq_proxy' in selected_features and mid is not None:
        vol = mid.pct_change().rolling(5).std()
        liq = (total_vol.diff() < -total_vol.rolling(10).std()).astype(int)
        df['volatility_expansion_on_liq_proxy'] = (vol * liq).ffill().fillna(0)

    if 'squeeze_exhaustion_metric_proxy' in selected_features and 'bid_vol1' in df.columns:
        df['squeeze_exhaustion_metric_proxy'] = (df['bid_vol1'] / total_vol).rolling(10).std().ffill().fillna(0)

    if 'liquidator_bot_activity_proxy' in selected_features and 'bid_vol1' in df.columns:
        can = abs(df['bid_vol1'].diff().clip(upper=0))
        rep = df['bid_vol1'].diff().clip(lower=0)
        df['liquidator_bot_activity_proxy'] = (can * rep).rolling(3).mean().ffill().fillna(0)

    if 'domino_trigger_threshold_alpha_proxy' in selected_features and mid is not None:
        df['domino_trigger_threshold_alpha_proxy'] = mid.pct_change().abs().rolling(20).sum().ffill().fillna(0)

    if 'contagion_effect_probability_proxy' in selected_features and 'bid_vol5' in df.columns:
        corr = df['bid_vol1'].rolling(10).corr(df['bid_vol5']).ffill().fillna(0)
        df['contagion_effect_probability_proxy'] = np.where(corr > 0.8, 1, 0)

    if 'price_volume_dislocation_liq_proxy' in selected_features and mid is not None:
        price_dir = np.sign(mid.diff()).values
        vol_dir = np.sign(df['bid_vol1'].diff() - df['ask_vol1'].diff()).values
        df['price_volume_dislocation_liq_proxy'] = np.where(price_dir != vol_dir, 1, 0)

    if 'cascade_halflife_decay_proxy' in selected_features and mid is not None:
        df['cascade_halflife_decay_proxy'] = spread.rolling(10).apply(lambda x: np.sum(x > x.mean())).ffill().fillna(0)

    if 'liquidation_wall_impact_proxy' in selected_features and 'bid_vol1' in df.columns:
        df['liquidation_wall_impact_proxy'] = df['bid_vol1'] / df['bid_vol2'].replace(0, 1e-9)

    if 'short_squeeze_velocity_factor_proxy' in selected_features and mid is not None:
        df['short_squeeze_velocity_factor_proxy'] = np.where(mid.diff() > 0, df['ask_vol1'].diff().abs(), 0)

    if 'synthetic_domino_proxy' in selected_features and mid is not None:
        df['synthetic_domino_proxy'] = (spread.pct_change().rolling(3).apply(lambda x: np.prod(1+x)) - 1).ffill().fillna(0)

    return df
