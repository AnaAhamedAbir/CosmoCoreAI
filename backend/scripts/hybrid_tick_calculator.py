import pandas as pd
import numpy as np

def calculate_tick_micro_features(df_tick: pd.DataFrame) -> pd.DataFrame:
    """
    Calculates advanced micro-structure features directly on the high-frequency tick data.
    This must be run BEFORE aggregating the ticks into OHLCV bars.
    
    Expected columns in df_tick: 'time', 'Mid', 'Spread' 
    (and optionally 'bid_volume', 'ask_volume')
    """
    
    # Ensure time is sorted
    if 'time' in df_tick.columns:
        df_tick = df_tick.sort_values('time')
        
    bid_vol_col = None
    ask_vol_col = None
    for col in df_tick.columns:
        c_lower = col.lower()
        if c_lower in ['bid_volume', 'bidvolume', 'bid_vol']:
            bid_vol_col = col
        elif c_lower in ['ask_volume', 'askvolume', 'ask_vol']:
            ask_vol_col = col
            
    has_vol = bid_vol_col is not None and ask_vol_col is not None
    
    # 1. Order Flow Imbalance & Toxicity (Volume Based)
    if has_vol:
        bid_vol = df_tick[bid_vol_col]
        ask_vol = df_tick[ask_vol_col]
        total_vol = bid_vol + ask_vol + 1e-8
        
        df_tick['buy_sell_ratio'] = bid_vol / (ask_vol + 1e-8)
        df_tick['vol_imbalance'] = (bid_vol - ask_vol) / total_vol
        df_tick['net_tick_volume'] = bid_vol - ask_vol
        df_tick['order_flow_toxicity'] = np.abs(bid_vol - ask_vol) / total_vol # VPIN proxy
    else:
        df_tick['buy_sell_ratio'] = 1.0
        df_tick['vol_imbalance'] = 0.0
        df_tick['net_tick_volume'] = 0.0
        df_tick['order_flow_toxicity'] = 0.0
        
    # 2. Tick Price Dynamics & Returns
    df_tick['returns'] = df_tick['Mid'].pct_change().fillna(0)
    df_tick['trade_sign'] = np.sign(df_tick['Mid'].diff().fillna(0))
    df_tick['price_accel'] = df_tick['returns'].diff().fillna(0)
    df_tick['realized_vol'] = df_tick['returns'] ** 2
    
    # 3. Path Variation & Microstructure Noise
    df_tick['path_variation'] = np.abs(df_tick['Mid'].diff().fillna(0))
    # Bid-Ask Bounce (Roll measure proxy): auto-covariance of returns
    df_tick['bid_ask_bounce'] = df_tick['returns'] * df_tick['returns'].shift(1).fillna(0)
    
    # 4. Tick Jump Intensity
    # Find returns that are > 3 standard deviations in a rolling window of 100 ticks
    rolling_std = df_tick['returns'].rolling(window=100, min_periods=1).std().fillna(0)
    df_tick['jump_intensity'] = np.where(np.abs(df_tick['returns']) > (3 * rolling_std + 1e-6), 1, 0)
    
    # 5. Micro RSI (Wilder's Smoothing on Tick Level)
    delta = df_tick['Mid'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=14, min_periods=1).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=14, min_periods=1).mean()
    rs = gain / (loss + 1e-8)
    df_tick['micro_rsi'] = 100 - (100 / (1 + rs))
    df_tick['micro_rsi'] = df_tick['micro_rsi'].fillna(50)
    
    return df_tick
