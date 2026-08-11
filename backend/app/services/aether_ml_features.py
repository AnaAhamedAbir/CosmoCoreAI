import pandas as pd
import numpy as np
import logging

from app.strategies.helpers.aether_flow_analyzer import AetherFlowAnalyzer

def add_aether_smc_features(df: pd.DataFrame) -> None:
    """
    Applies the AetherFlowAnalyzer to a DataFrame and extracts safe, predictive
    numerical features (clipping where necessary to avoid non-stationarity).
    Features are added directly to the DataFrame inplace.
    """
    if df.empty:
        return
    
    # Required columns mapping
    required_cols = ['Open', 'High', 'Low', 'Close', 'Volume']
    for col in required_cols:
        if col not in df.columns:
            logging.warning(f"Missing column '{col}' for Aether SMC features.")
            return

    # Convert DataFrame to list of dicts for the analyzer
    # The analyzer expects lowercase keys for time, open, high, low, close, volume
    data_list = []
    
    # Check if index is datetime or there's a timestamp column
    time_col = None
    if 'timestamp' in df.columns:
        time_col = df['timestamp']
    elif 'datetime' in df.columns:
        time_col = df['datetime']
    elif isinstance(df.index, pd.DatetimeIndex):
        time_col = pd.Series(df.index, index=df.index)
    else:
        # Fallback to integer sequence if no time
        time_col = pd.Series(np.arange(len(df)), index=df.index)
        
    for idx, row in df.iterrows():
        # Ensure timestamp is a float (unix seconds or similar) for the analyzer
        ts = time_col[idx]
        if isinstance(ts, pd.Timestamp):
            ts = ts.timestamp()
            
        data_list.append({
            'time': ts,
            'open': float(row['Open']),
            'high': float(row['High']),
            'low': float(row['Low']),
            'close': float(row['Close']),
            'volume': float(row['Volume'])
        })
        
    analyzer = AetherFlowAnalyzer(
        # We can pass default settings, or tune them
        st_atr_period=10,
        st_multiplier=3.0,
    )
    
    # Analyze the data
    try:
        results = analyzer.analyze(data_list)
    except Exception as e:
        logging.error(f"Error analyzing Aether SMC features: {e}")
        return
        
    # --- Feature Engineering & Extraction ---
    
    n = len(df)
    
    # Initialize feature arrays with safe defaults
    st_trend = np.zeros(n)
    st_distance = np.zeros(n)
    
    ut_trend = np.zeros(n)
    ut_distance = np.zeros(n)
    
    hull_trend = np.zeros(n)
    hull_distance = np.zeros(n)
    
    bars_since_choch = np.full(n, 100) # Clipped to 100 max
    bars_since_bos = np.full(n, 100)   # Clipped to 100 max
    last_choch_dir = np.zeros(n)
    
    bull_ob_distance = np.full(n, 0.05) # Default distance (e.g., 5%)
    bear_ob_distance = np.full(n, 0.05)
    
    fvg_bull_count = np.zeros(n)
    fvg_bear_count = np.zeros(n)
    
    three_bar_rev = np.zeros(n)
    
    # To process SMC structure safely, we track the last events
    last_choch_idx = -1000
    last_bos_idx = -1000
    current_choch_dir = 0
    
    # Create maps using timestamps for O(1) alignment
    st_map = {st['time']: st for st in results.get('supertrend_data', [])}
    ut_map = {ut['time']: ut for ut in results.get('ut_bot_signals', [])}
    hull_map = {hs['time']: hs for hs in results.get('hull_suite', [])}

    for i in range(n):
        ts = data_list[i]['time']
        
        # 1. Supertrend
        if ts in st_map:
            st = st_map[ts]
            st_trend[i] = 1 if st.get('trend') == 'up' else -1
            if df['Close'].iloc[i] > 0 and st.get('value'):
                st_distance[i] = (df['Close'].iloc[i] - st['value']) / df['Close'].iloc[i]
                
        # 2. UT Bot
        if ts in ut_map:
            ut = ut_map[ts]
            ut_trend[i] = 1 if ut.get('trend') == 'up' else -1
            if df['Close'].iloc[i] > 0 and ut.get('trailing_stop'):
                ut_distance[i] = (df['Close'].iloc[i] - ut['trailing_stop']) / df['Close'].iloc[i]
                
        # 3. Hull Suite
        if ts in hull_map:
            hs = hull_map[ts]
            hull_trend[i] = 1 if hs.get('trend') == 'up' else -1
            if df['Close'].iloc[i] > 0 and hs.get('value'):
                hull_distance[i] = (df['Close'].iloc[i] - hs['value']) / df['Close'].iloc[i]

    # 4. SMC Market Structure (CHoCH / BoS)
    bos_list = results.get('smc', {}).get('bos', [])
    choch_list = results.get('smc', {}).get('choch', [])
    
    bos_map = {b['index']: b for b in bos_list}
    choch_map = {c['index']: c for c in choch_list}
    
    # 5. Order Blocks (OB) and FVGs
    ob_list = results.get('smc', {}).get('order_blocks', [])
    fvg_list = results.get('fvg', [])
    
    for i in range(n):
        # Update Structure States
        if i in bos_map:
            last_bos_idx = i
        if i in choch_map:
            last_choch_idx = i
            current_choch_dir = 1 if choch_map[i].get('type') == 'bullish' else -1
            
        b_since_choch = i - last_choch_idx
        b_since_bos = i - last_bos_idx
        
        bars_since_choch[i] = min(b_since_choch, 100) # Clip to 100 max
        bars_since_bos[i] = min(b_since_bos, 100)     # Clip to 100 max
        last_choch_dir[i] = current_choch_dir
        
        current_close = df['Close'].iloc[i]
        
        # Causal Order Block Processing
        active_bull_obs = [ob for ob in ob_list if ob['type'] == 'bullish' and ob['start_index'] < i]
        active_bear_obs = [ob for ob in ob_list if ob['type'] == 'bearish' and ob['start_index'] < i]
        
        if active_bull_obs:
            closest_bull = max([ob['top'] for ob in active_bull_obs])
            bull_ob_distance[i] = (current_close - closest_bull) / current_close
        
        if active_bear_obs:
            closest_bear = min([ob['bottom'] for ob in active_bear_obs])
            bear_ob_distance[i] = (closest_bear - current_close) / current_close
            
        # Causal FVG Processing
        active_bull_fvgs = [fvg for fvg in fvg_list if fvg['type'] == 'bullish' and fvg['start_index'] < i and (fvg['mitigated_index'] is None or fvg['mitigated_index'] > i)]
        active_bear_fvgs = [fvg for fvg in fvg_list if fvg['type'] == 'bearish' and fvg['start_index'] < i and (fvg['mitigated_index'] is None or fvg['mitigated_index'] > i)]
        
        fvg_bull_count[i] = min(len(active_bull_fvgs), 5) # Cap at 5
        fvg_bear_count[i] = min(len(active_bear_fvgs), 5) # Cap at 5
        
    # 6. Three Bar Reversal
    tbr_list = results.get('three_bar_reversals', [])
    tbr_map = {t['index']: t for t in tbr_list}
    for i in range(n):
        if i in tbr_map:
            three_bar_rev[i] = 1 if tbr_map[i].get('type') == 'bullish' else -1

    # Attach to DataFrame
    df['aether_st_trend'] = st_trend
    df['aether_st_dist'] = st_distance
    df['aether_ut_trend'] = ut_trend
    df['aether_ut_dist'] = ut_distance
    df['aether_hull_trend'] = hull_trend
    df['aether_hull_dist'] = hull_distance
    df['aether_bars_since_choch'] = bars_since_choch
    df['aether_bars_since_bos'] = bars_since_bos
    df['aether_last_choch_dir'] = last_choch_dir
    df['aether_bull_ob_dist'] = bull_ob_distance
    df['aether_bear_ob_dist'] = bear_ob_distance
    df['aether_fvg_bull_count'] = fvg_bull_count
    df['aether_fvg_bear_count'] = fvg_bear_count
    df['aether_3br_signal'] = three_bar_rev
    
    # Clip large distances to prevent crazy outliers in ML
    df['aether_st_dist'] = df['aether_st_dist'].clip(lower=-0.1, upper=0.1)
    df['aether_ut_dist'] = df['aether_ut_dist'].clip(lower=-0.1, upper=0.1)
    df['aether_hull_dist'] = df['aether_hull_dist'].clip(lower=-0.1, upper=0.1)
    df['aether_bull_ob_dist'] = df['aether_bull_ob_dist'].clip(lower=-0.1, upper=0.1)
    df['aether_bear_ob_dist'] = df['aether_bear_ob_dist'].clip(lower=-0.1, upper=0.1)
    
    logging.info("Successfully extracted 14 Aether SMC Flow features!")
