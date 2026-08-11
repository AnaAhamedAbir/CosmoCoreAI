import pandas as pd
import numpy as np
import logging

def detect_forex_cisd(df: pd.DataFrame) -> pd.DataFrame:
    """
    Detects Change in State of Delivery (CISD) and advanced Tick+SMC mechanics.
    Expects both OHLCV and Hybrid Tick Data columns to be present.
    """
    n = len(df)
    
    # Pre-allocate output arrays
    ltf_choch_state = np.zeros(n)
    ltf_bos_state = np.zeros(n)
    ltf_bars_since_choch = np.full(n, 100)
    
    ltf_liq_sweep_bull = np.zeros(n)
    ltf_liq_sweep_bear = np.zeros(n)
    
    cisd_bull_trigger = np.zeros(n)
    cisd_bear_trigger = np.zeros(n)
    
    poi_absorption_bull = np.zeros(n)
    poi_absorption_bear = np.zeros(n)
    
    smart_money_divergence = np.zeros(n)
    
    # Safely get tick columns or use defaults
    has_tick = 'tick_vol_imbalance' in df.columns or 'tick_buy_sell_ratio' in df.columns
    
    # Create simple rolling proxies if true tick data is missing
    vol_imbalance = df.get('tick_vol_imbalance', pd.Series(np.zeros(n), index=df.index))
    toxicity = df.get('tick_order_flow_toxicity', pd.Series(np.zeros(n), index=df.index))
    net_vol = df.get('tick_net_volume', pd.Series(np.zeros(n), index=df.index))
    
    # Basic Price Action arrays
    close_arr = df['close'].values
    high_arr = df['high'].values
    low_arr = df['low'].values
    
    # Flags for HTF POIs
    in_bull_fvg = df.get('in_htf_bull_fvg', pd.Series(np.zeros(n), index=df.index)).values
    in_bear_fvg = df.get('in_htf_bear_fvg', pd.Series(np.zeros(n), index=df.index)).values
    in_bull_ob = df.get('in_htf_bull_ob', pd.Series(np.zeros(n), index=df.index)).values
    in_bear_ob = df.get('in_htf_bear_ob', pd.Series(np.zeros(n), index=df.index)).values
    
    last_choch_idx = -100
    
    for i in range(2, n):
        # 1. Micro-Structure CHoCH (Fractal Break)
        # Bullish CHoCH: Current close breaks above previous local swing high
        is_bull_choch = close_arr[i] > high_arr[i-1] and close_arr[i-1] < high_arr[i-2]
        # Bearish CHoCH: Current close breaks below previous local swing low
        is_bear_choch = close_arr[i] < low_arr[i-1] and close_arr[i-1] > low_arr[i-2]
        
        if is_bull_choch:
            ltf_choch_state[i] = 1
            last_choch_idx = i
        elif is_bear_choch:
            ltf_choch_state[i] = -1
            last_choch_idx = i
        else:
            ltf_choch_state[i] = ltf_choch_state[i-1]
            
        ltf_bars_since_choch[i] = min(i - last_choch_idx, 100)
        
        # 2. CISD Triggers (HTF POI + CHoCH + Tick Volume Imbalance > 0.3)
        # Inside any Bull POI
        is_in_bull_poi = in_bull_fvg[i] == 1 or in_bull_ob[i] == 1
        is_in_bear_poi = in_bear_fvg[i] == 1 or in_bear_ob[i] == 1
        
        if is_in_bull_poi and is_bull_choch and vol_imbalance.iloc[i] > 0.3:
            cisd_bull_trigger[i] = 1
            
        if is_in_bear_poi and is_bear_choch and vol_imbalance.iloc[i] < -0.3:
            cisd_bear_trigger[i] = 1
            
        # 3. POI Absorption (Smart Money absorbing retail)
        # If in Bull POI and order flow toxicity spikes (meaning aggressive absorption)
        if is_in_bull_poi and toxicity.iloc[i] > 0.7:
            poi_absorption_bull[i] = 1
            
        if is_in_bear_poi and toxicity.iloc[i] > 0.7:
            poi_absorption_bear[i] = 1
            
        # 4. Smart Money Divergence (Price Lower Low, but Net Volume Higher High)
        if low_arr[i] < low_arr[i-1] and net_vol.iloc[i] > net_vol.iloc[i-1] and net_vol.iloc[i] > 0:
            smart_money_divergence[i] = 1
            
    # Vectorized calculations for remaining metrics
    
    # 5. Distances to POIs
    for p_type in ['bull_fvg', 'bear_fvg', 'bull_ob', 'bear_ob']:
        top_col = f'htf_{p_type}_top'
        bot_col = f'htf_{p_type}_bottom'
        if top_col in df.columns and bot_col in df.columns:
            if 'bull' in p_type:
                df[f'htf_{p_type}_dist'] = (df['close'] - df[top_col]) / df['close']
            else:
                df[f'htf_{p_type}_dist'] = (df[bot_col] - df['close']) / df['close']
                
            df[f'htf_{p_type}_dist'] = df[f'htf_{p_type}_dist'].clip(lower=-0.05, upper=0.05)
            
    # Assign arrays to DataFrame
    df['ltf_choch_state'] = ltf_choch_state
    df['ltf_bos_state'] = ltf_bos_state
    df['ltf_bars_since_choch'] = ltf_bars_since_choch
    df['ltf_liq_sweep_bull'] = ltf_liq_sweep_bull
    df['ltf_liq_sweep_bear'] = ltf_liq_sweep_bear
    
    df['cisd_bull_trigger'] = cisd_bull_trigger
    df['cisd_bear_trigger'] = cisd_bear_trigger
    df['poi_absorption_bull'] = poi_absorption_bull
    df['poi_absorption_bear'] = poi_absorption_bear
    df['smart_money_divergence'] = smart_money_divergence
    
    # Calculate Institutional Momentum Index (-100 to +100)
    # Combines CHoCH state, Volume Imbalance, and Toxicity
    imi = (df['ltf_choch_state'] * 50) + (vol_imbalance * 50)
    # If toxicity is high, momentum is stronger
    df['institutional_momentum_index'] = (imi * (1 + toxicity)).clip(lower=-100, upper=100)
    
    # ==========================================
    # 6. Advanced Tick & Micro-Structure Metrics
    # ==========================================
    
    # htf_swing_high_dist / htf_swing_low_dist (Using rolling max/min as proxy if true fractals aren't present)
    rolling_high_20 = df['high'].rolling(20).max()
    rolling_low_20 = df['low'].rolling(20).min()
    df['htf_swing_high_dist'] = (rolling_high_20 - df['close']) / df['close']
    df['htf_swing_low_dist'] = (df['close'] - rolling_low_20) / df['close']
    
    # Tick Imbalance & Volume metrics
    df['tick_vol_imbalance_spike'] = vol_imbalance.diff().fillna(0)
    
    tick_bs_ratio = df.get('tick_buy_sell_ratio', pd.Series(np.ones(n), index=df.index))
    df['tick_buy_pressure_ratio'] = tick_bs_ratio / (1 + tick_bs_ratio)
    
    # Proxy for bounce and jump
    df['tick_bid_ask_bounce'] = df['close'].diff().abs().rolling(5).mean().fillna(0)
    
    tick_vol = df.get('tick_volume', df.get('volume', pd.Series(np.zeros(n), index=df.index)))
    df['tick_jump_intensity'] = (tick_vol - tick_vol.rolling(10).mean()) / (tick_vol.rolling(10).std() + 1e-9)
    df['tick_jump_intensity'] = df['tick_jump_intensity'].fillna(0)
    
    # Path variation (Sum of abs diffs over 10 periods / high-low range)
    path_len = df['close'].diff().abs().rolling(10).sum()
    range_10 = df['high'].rolling(10).max() - df['low'].rolling(10).min()
    df['tick_path_variation'] = (path_len / (range_10 + 1e-9)).fillna(0)
    
    # Acceleration
    df['tick_net_vol_accel'] = net_vol.diff().diff().fillna(0)
    
    # Tick Micro RSI (Based on net volume instead of close price)
    gain = net_vol.where(net_vol > 0, 0)
    loss = -net_vol.where(net_vol < 0, 0)
    avg_gain = gain.rolling(7).mean()
    avg_loss = loss.rolling(7).mean()
    rs = avg_gain / (avg_loss + 1e-9)
    df['tick_micro_rsi'] = (100 - (100 / (1 + rs))).fillna(50)
    
    # FVG mitigation speed proxy (Bars since last HTF FVG touch)
    in_any_fvg = (df['in_htf_bull_fvg'] | df['in_htf_bear_fvg'])
    df['fvg_mitigation_speed'] = in_any_fvg.groupby((in_any_fvg != in_any_fvg.shift()).cumsum()).cumsum()
    
    # Liquidity Hunt Intensity (Sweeps beyond Bollinger Bands/Keltner proxy)
    df['liquidity_hunt_intensity'] = (df['high'] - df['close'].rolling(20).mean()) / (df['close'].rolling(20).std() + 1e-9)
    
    return df
