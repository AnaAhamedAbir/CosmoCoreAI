import pandas as pd
import numpy as np
from typing import List

def generate_l2_price_spread_features(df: pd.DataFrame, selected_features: List[str]) -> pd.DataFrame:
    """Generate features for Price & Spread (L2)"""
    if 'l1_best_bid' in selected_features and 'bid1' in df.columns: df['l1_best_bid'] = df['bid1']
    if 'l1_best_ask' in selected_features and 'ask1' in df.columns: df['l1_best_ask'] = df['ask1']
        
    if 'l2_mid_price' in selected_features and 'bid1' in df.columns and 'ask1' in df.columns:
        df['l2_mid_price'] = (df['bid1'] + df['ask1']) / 2
        
    if 'spread_absolute' in selected_features and 'bid1' in df.columns and 'ask1' in df.columns:
        df['spread_absolute'] = df['ask1'] - df['bid1']
        
    if 'spread_bps' in selected_features and 'spread_absolute' in df.columns and 'l2_mid_price' in df.columns:
        df['spread_bps'] = (df['spread_absolute'] / df['l2_mid_price']) * 10000
        
    if 'weighted_mid_price' in selected_features or 'micro_price' in selected_features:
        if all(c in df.columns for c in ['bid1', 'ask1', 'bid_vol1', 'ask_vol1']):
            total_vol = df['bid_vol1'] + df['ask_vol1']
            w_mid = np.where(total_vol > 0, 
                             (df['bid1'] * df['ask_vol1'] + df['ask1'] * df['bid_vol1']) / total_vol, 
                             (df['bid1'] + df['ask1']) / 2)
            if 'weighted_mid_price' in selected_features: df['weighted_mid_price'] = w_mid
            if 'micro_price' in selected_features: df['micro_price'] = w_mid
            
    if 'spread_sma' in selected_features and 'spread_absolute' in df.columns:
        df['spread_sma'] = df['spread_absolute'].rolling(window=10, min_periods=1).mean()
        
    if 'spread_volatility' in selected_features and 'spread_absolute' in df.columns:
        df['spread_volatility'] = df['spread_absolute'].rolling(window=10, min_periods=1).std().ffill().fillna(0)
        
    if 'spread_roc' in selected_features and 'spread_absolute' in df.columns:
        df['spread_roc'] = df['spread_absolute'].pct_change().fillna(0) # Pct change of missing should be 0

    return df

def generate_l2_imbalance_features(df: pd.DataFrame, selected_features: List[str]) -> pd.DataFrame:
    """Generate features for Order Book Imbalance (L2)"""
    if 'l1_imbalance' in selected_features and all(c in df.columns for c in ['bid_vol1', 'ask_vol1']):
        total = df['bid_vol1'] + df['ask_vol1']
        df['l1_imbalance'] = np.where(total > 0, (df['bid_vol1'] - df['ask_vol1']) / total, 0)
        
    bid_cols = [c for c in df.columns if c.startswith('bid_vol') and c != 'bid_volume']
    ask_cols = [c for c in df.columns if c.startswith('ask_vol') and c != 'ask_volume']
    
    if 'top5_imbalance' in selected_features:
        b5 = [c for c in bid_cols if c in [f'bid_vol{i}' for i in range(1,6)]]
        a5 = [c for c in ask_cols if c in [f'ask_vol{i}' for i in range(1,6)]]
        if b5 and a5:
            sb, sa = df[b5].sum(axis=1), df[a5].sum(axis=1)
            df['top5_imbalance'] = np.where((sb + sa) > 0, (sb - sa) / (sb + sa), 0)
            
    if 'top10_imbalance' in selected_features:
        b10 = [c for c in bid_cols if c in [f'bid_vol{i}' for i in range(1,11)]]
        a10 = [c for c in ask_cols if c in [f'ask_vol{i}' for i in range(1,11)]]
        if b10 and a10:
            sb, sa = df[b10].sum(axis=1), df[a10].sum(axis=1)
            df['top10_imbalance'] = np.where((sb + sa) > 0, (sb - sa) / (sb + sa), 0)

    if 'cumulative_imbalance' in selected_features and bid_cols and ask_cols:
        sb, sa = df[bid_cols].sum(axis=1), df[ask_cols].sum(axis=1)
        df['cumulative_imbalance'] = np.where((sb + sa) > 0, (sb - sa) / (sb + sa), 0)

    if 'imbalance_sma' in selected_features and 'l1_imbalance' in df.columns:
        df['imbalance_sma'] = df['l1_imbalance'].rolling(window=10, min_periods=1).mean()
        
    if 'imbalance_roc' in selected_features and 'l1_imbalance' in df.columns:
        df['imbalance_roc'] = df['l1_imbalance'].diff().fillna(0)
        
    if 'price_weighted_imbalance' in selected_features and bid_cols and ask_cols:
        pw_bid = sum(df[c] / i for i, c in enumerate(bid_cols, 1))
        pw_ask = sum(df[c] / i for i, c in enumerate(ask_cols, 1))
        df['price_weighted_imbalance'] = np.where((pw_bid + pw_ask) > 0, (pw_bid - pw_ask) / (pw_bid + pw_ask), 0)

    if 'volume_weighted_imbalance' in selected_features and bid_cols and ask_cols:
        vw_bid = sum(df[c] * df[c] for c in bid_cols)
        vw_ask = sum(df[c] * df[c] for c in ask_cols)
        df['volume_weighted_imbalance'] = np.where((vw_bid + vw_ask) > 0, (vw_bid - vw_ask) / (vw_bid + vw_ask), 0)

    if 'order_book_skewness' in selected_features and bid_cols and ask_cols:
        df['order_book_skewness'] = df[bid_cols + ask_cols].skew(axis=1).fillna(0)
        
    if 'order_book_kurtosis' in selected_features and bid_cols and ask_cols:
        df['order_book_kurtosis'] = df[bid_cols + ask_cols].kurtosis(axis=1).fillna(0)

    return df

def generate_l2_liquidity_features(df: pd.DataFrame, selected_features: List[str]) -> pd.DataFrame:
    """Generate features for Liquidity & Depth (L2)"""
    bid_vol_cols = [c for c in df.columns if c.startswith('bid_vol') and c != 'bid_volume']
    ask_vol_cols = [c for c in df.columns if c.startswith('ask_vol') and c != 'ask_volume']
    
    if 'total_bid_depth' in selected_features and bid_vol_cols: df['total_bid_depth'] = df[bid_vol_cols].sum(axis=1)
    if 'total_ask_depth' in selected_features and ask_vol_cols: df['total_ask_depth'] = df[ask_vol_cols].sum(axis=1)
        
    if 'market_depth_ratio' in selected_features and bid_vol_cols and ask_vol_cols:
        tb = df[bid_vol_cols].sum(axis=1)
        ta = df[ask_vol_cols].sum(axis=1)
        df['market_depth_ratio'] = np.where(ta > 0, tb / ta, 1)
        
    if 'near_touch_liquidity' in selected_features:
        nb = [c for c in bid_vol_cols if c in ['bid_vol1', 'bid_vol2', 'bid_vol3']]
        na = [c for c in ask_vol_cols if c in ['ask_vol1', 'ask_vol2', 'ask_vol3']]
        if nb and na: df['near_touch_liquidity'] = df[nb].sum(axis=1) + df[na].sum(axis=1)

    if 'far_touch_liquidity' in selected_features:
        fb = [c for c in bid_vol_cols if c not in ['bid_vol1', 'bid_vol2', 'bid_vol3']]
        fa = [c for c in ask_vol_cols if c not in ['ask_vol1', 'ask_vol2', 'ask_vol3']]
        if fb and fa: df['far_touch_liquidity'] = df[fb].sum(axis=1) + df[fa].sum(axis=1)

    if 'bid_depletion_rate' in selected_features and bid_vol_cols:
        df['bid_depletion_rate'] = df[bid_vol_cols].sum(axis=1).pct_change().fillna(0)
        
    if 'ask_depletion_rate' in selected_features and ask_vol_cols:
        df['ask_depletion_rate'] = df[ask_vol_cols].sum(axis=1).pct_change().fillna(0)
        
    # VWAP logic independent of whether VWAP was selected
    vwap_bid, vwap_ask = None, None
    if bid_vol_cols:
        bid_price_cols = [c for c in df.columns if c.startswith('bid') and not c.startswith('bid_vol') and c != 'bid_volume']
        if bid_price_cols:
            vol_sum = df[bid_vol_cols].sum(axis=1)
            vwap_num = sum(df[p] * df[v] for p, v in zip(bid_price_cols, bid_vol_cols) if p in df.columns and v in df.columns)
            vwap_bid = np.where(vol_sum > 0, vwap_num / vol_sum, df['bid1'])
            if 'orderbook_vwap_bid' in selected_features: df['orderbook_vwap_bid'] = vwap_bid

    if ask_vol_cols:
        ask_price_cols = [c for c in df.columns if c.startswith('ask') and not c.startswith('ask_vol') and c != 'ask_volume']
        if ask_price_cols:
            vol_sum = df[ask_vol_cols].sum(axis=1)
            vwap_num = sum(df[p] * df[v] for p, v in zip(ask_price_cols, ask_vol_cols) if p in df.columns and v in df.columns)
            vwap_ask = np.where(vol_sum > 0, vwap_num / vol_sum, df['ask1'])
            if 'orderbook_vwap_ask' in selected_features: df['orderbook_vwap_ask'] = vwap_ask

    if 'cost_of_execution' in selected_features and vwap_bid is not None and vwap_ask is not None:
        df['cost_of_execution'] = pd.Series(vwap_ask - vwap_bid)

    return df

def generate_l2_order_flow_features(df: pd.DataFrame, selected_features: List[str]) -> pd.DataFrame:
    """Generate features for Order Flow & Microstructure (L2)"""
    ofi = None
    if all(c in df.columns for c in ['bid1', 'ask1', 'bid_vol1', 'ask_vol1']):
        delta_bid = df['bid1'].diff()
        delta_ask = df['ask1'].diff()
        delta_bid_vol = df['bid_vol1'].diff()
        delta_ask_vol = df['ask_vol1'].diff()
        
        e_bid = np.where(delta_bid > 0, df['bid_vol1'], np.where(delta_bid == 0, delta_bid_vol, -df['bid_vol1'].shift(1).fillna(0)))
        e_ask = np.where(delta_ask < 0, df['ask_vol1'], np.where(delta_ask == 0, delta_ask_vol, -df['ask_vol1'].shift(1).fillna(0)))
        ofi = pd.Series(e_bid - e_ask).fillna(0)
        if 'ofi' in selected_features: df['ofi'] = ofi

    if 'multi_level_ofi' in selected_features and ofi is not None:
        df['multi_level_ofi'] = ofi.ewm(span=5).mean()

    bid_rep, ask_rep, bid_can, ask_can = None, None, None, None
    if 'bid_vol1' in df.columns:
        delta_vol = df['bid_vol1'].diff()
        bid_rep = np.where(delta_vol > 0, delta_vol, 0)
        bid_can = np.where(delta_vol < 0, abs(delta_vol), 0)
        if 'bid_replenishment' in selected_features: df['bid_replenishment'] = bid_rep
        if 'bid_cancellation' in selected_features: df['bid_cancellation'] = bid_can
        
    if 'ask_vol1' in df.columns:
        delta_vol = df['ask_vol1'].diff()
        ask_rep = np.where(delta_vol > 0, delta_vol, 0)
        ask_can = np.where(delta_vol < 0, abs(delta_vol), 0)
        if 'ask_replenishment' in selected_features: df['ask_replenishment'] = ask_rep
        if 'ask_cancellation' in selected_features: df['ask_cancellation'] = ask_can

    if 'quote_stuffing_ratio' in selected_features and all(x is not None for x in [bid_rep, bid_can, ask_rep, ask_can]):
        activity = bid_rep + bid_can + ask_rep + ask_can
        df['quote_stuffing_ratio'] = activity / (df['bid_vol1'] + df['ask_vol1'] + 1e-9)

    if 'vpin_proxy' in selected_features and ofi is not None:
        df['vpin_proxy'] = ofi.abs().rolling(window=10).sum() / (df['bid_vol1'] + df['ask_vol1']).rolling(window=10).sum().replace(0, np.nan)
        df['vpin_proxy'] = df['vpin_proxy'].fillna(0)

    if 'trade_sign_proxy' in selected_features and 'l2_mid_price' in df.columns:
        df['trade_sign_proxy'] = np.sign(df['l2_mid_price'].diff()).fillna(0)

    if 'market_vs_limit' in selected_features and ofi is not None:
        df['market_vs_limit'] = ofi.rolling(window=5).std().fillna(0)

    return df

def generate_l2_volatility_features(df: pd.DataFrame, selected_features: List[str]) -> pd.DataFrame:
    """Generate features for Volatility & Price Pressure (L2)"""
    if 'micro_rsi' in selected_features and 'l2_mid_price' in df.columns:
        delta = df['l2_mid_price'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14, min_periods=1).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14, min_periods=1).mean()
        rs = gain / loss
        df['micro_rsi'] = 100 - (100 / (1 + rs)).fillna(50)

    if 'hf_realized_volatility' in selected_features and 'l2_mid_price' in df.columns:
        df['hf_realized_volatility'] = np.log(df['l2_mid_price'] / df['l2_mid_price'].shift(1)).rolling(window=10).std().ffill().fillna(0) * np.sqrt(10)

    if 'bid_ask_bounce' in selected_features and 'l1_best_bid' in df.columns and 'l1_best_ask' in df.columns:
        df['bid_ask_bounce'] = np.where(df['l1_best_bid'].diff() > 0, 1, np.where(df['l1_best_ask'].diff() < 0, -1, 0))

    if 'buying_pressure_tick' in selected_features and 'bid_vol1' in df.columns:
        df['buying_pressure_tick'] = (df['bid_vol1'] * (df['bid1'] - df['bid1'].shift(1).fillna(df['bid1']))).clip(lower=0)

    if 'selling_pressure_tick' in selected_features and 'ask_vol1' in df.columns:
        df['selling_pressure_tick'] = (df['ask_vol1'] * (df['ask1'].shift(1).fillna(df['ask1']) - df['ask1'])).clip(lower=0)

    if 'lob_slope_bid' in selected_features and 'bid1' in df.columns and 'bid5' in df.columns:
        df['lob_slope_bid'] = (df['bid_vol5'] - df['bid_vol1']) / (df['bid1'] - df['bid5']).replace(0, np.nan)
        df['lob_slope_bid'] = df['lob_slope_bid'].fillna(0)

    if 'lob_slope_ask' in selected_features and 'ask1' in df.columns and 'ask5' in df.columns:
        df['lob_slope_ask'] = (df['ask_vol5'] - df['ask_vol1']) / (df['ask5'] - df['ask1']).replace(0, np.nan)
        df['lob_slope_ask'] = df['lob_slope_ask'].fillna(0)

    if 'amihud_illiquidity' in selected_features and 'l2_mid_price' in df.columns:
        ret = np.abs(df['l2_mid_price'].pct_change())
        vol = df['bid_vol1'] + df['ask_vol1']
        df['amihud_illiquidity'] = (ret / vol.replace(0, np.nan)).fillna(0)

    if 'depth_to_spread' in selected_features and 'spread_absolute' in df.columns:
        depth = df['bid_vol1'] + df['ask_vol1']
        df['depth_to_spread'] = (depth / df['spread_absolute'].replace(0, np.nan)).fillna(0)

    if 'toxic_order_flow' in selected_features and 'ofi' in df.columns:
        vpin = df['ofi'].abs().rolling(window=10).sum() / (df['bid_vol1'] + df['ask_vol1']).rolling(window=10).sum().replace(0, np.nan)
        df['toxic_order_flow'] = (vpin > vpin.rolling(20).mean() + 2 * vpin.rolling(20).std()).astype(int)

    return df

def generate_l2_advanced_math_features(df: pd.DataFrame, selected_features: List[str]) -> pd.DataFrame:
    """Generate features for Advanced Derived ML (L2)"""
    if 'l1_imbalance_deriv1' in selected_features or 'l1_imbalance_deriv2' in selected_features:
        if 'l1_imbalance' in df.columns:
            deriv1 = df['l1_imbalance'].diff().fillna(0)
            if 'l1_imbalance_deriv1' in selected_features: df['l1_imbalance_deriv1'] = deriv1
            if 'l1_imbalance_deriv2' in selected_features: df['l1_imbalance_deriv2'] = deriv1.diff().fillna(0)

    if 'spread_imbalance_corr' in selected_features and 'spread_absolute' in df.columns and 'l1_imbalance' in df.columns:
        df['spread_imbalance_corr'] = df['spread_absolute'].rolling(window=20).corr(df['l1_imbalance']).fillna(0)

    if 'top5_imbalance_zscore' in selected_features:
        bid_cols = [c for c in df.columns if c.startswith('bid_vol') and c != 'bid_volume']
        ask_cols = [c for c in df.columns if c.startswith('ask_vol') and c != 'ask_volume']
        b5 = [c for c in bid_cols if c in [f'bid_vol{i}' for i in range(1,6)]]
        a5 = [c for c in ask_cols if c in [f'ask_vol{i}' for i in range(1,6)]]
        if b5 and a5:
            sb, sa = df[b5].sum(axis=1), df[a5].sum(axis=1)
            t5 = np.where((sb + sa) > 0, (sb - sa) / (sb + sa), 0)
            t5_series = pd.Series(t5)
            df['top5_imbalance_zscore'] = ((t5_series - t5_series.rolling(20).mean()) / t5_series.rolling(20).std().replace(0, np.nan)).fillna(0).values

    if 'entropy_order_book' in selected_features:
        bid_cols = [c for c in df.columns if c.startswith('bid_vol') and c != 'bid_volume']
        ask_cols = [c for c in df.columns if c.startswith('ask_vol') and c != 'ask_volume']
        if bid_cols and ask_cols:
            all_vols = df[bid_cols + ask_cols]
            probs = all_vols.div(all_vols.sum(axis=1), axis=0)
            df['entropy_order_book'] = - (probs * np.log2(probs + 1e-9)).sum(axis=1)

    if 'center_of_mass' in selected_features:
        bid_prices = [c for c in df.columns if c.startswith('bid') and not c.startswith('bid_vol')]
        bid_vols = [c for c in df.columns if c.startswith('bid_vol') and c != 'bid_volume']
        if bid_prices and bid_vols:
            mass = sum(df[p] * df[v] for p, v in zip(bid_prices, bid_vols) if p in df.columns and v in df.columns)
            total = df[bid_vols].sum(axis=1)
            df['center_of_mass'] = np.where(total > 0, mass / total, 0)

    if 'time_decay_imbalance' in selected_features and 'l1_imbalance' in df.columns:
        df['time_decay_imbalance'] = df['l1_imbalance'].ewm(alpha=0.1).mean()

    if 'bid_ask_volume_div' in selected_features and 'bid_vol1' in df.columns and 'ask_vol1' in df.columns:
        df['bid_ask_volume_div'] = np.log((df['bid_vol1'] + 1) / (df['ask_vol1'] + 1))

    return df

def generate_all_l2_features(df: pd.DataFrame, selected_features: List[str]) -> pd.DataFrame:
    """
    Main entry point to inject all selected L2 features into the dataframe.
    """
    df = df.copy()
    
    # Prerequisite shared columns calculated regardless of selection
    if 'bid1' in df.columns and 'ask1' in df.columns:
        if 'l2_mid_price' not in df.columns: df['l2_mid_price'] = (df['bid1'] + df['ask1']) / 2
        if 'spread_absolute' not in df.columns: df['spread_absolute'] = df['ask1'] - df['bid1']
            
    if 'bid_vol1' in df.columns and 'ask_vol1' in df.columns:
        if 'l1_imbalance' not in df.columns:
            total = df['bid_vol1'] + df['ask_vol1']
            df['l1_imbalance'] = np.where(total > 0, (df['bid_vol1'] - df['ask_vol1']) / total, 0)
    
    df = generate_l2_price_spread_features(df, selected_features)
    df = generate_l2_imbalance_features(df, selected_features)
    df = generate_l2_liquidity_features(df, selected_features)
    df = generate_l2_order_flow_features(df, selected_features)
    df = generate_l2_volatility_features(df, selected_features)
    df = generate_l2_advanced_math_features(df, selected_features)
    
    # ── Inject Predatory & Synthetic Liquidity (PLP) Features ──
    from app.services.ml.forex_l2_plp_engine import inject_plp_features
    df = inject_plp_features(df, selected_features)
    
    df = df.ffill().fillna(0)
    
    import gc
    gc.collect()
    
    return df
