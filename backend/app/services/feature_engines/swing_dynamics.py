import numpy as np
import pandas as pd
from numba import njit
import logging

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────
# NUMBA OPTIMIZED CORE FUNCTIONS (NO LOOKAHEAD BIAS)
# ─────────────────────────────────────────────────────────────────────────

@njit(cache=True)
def _find_swings(highs, lows, window):
    """
    Finds Swing Highs and Swing Lows with NO lookahead bias.
    A swing high is confirmed at index i if the high at i-window 
    was the highest in the range [i - 2*window : i].
    Returns arrays of last_swing_high, last_swing_low, and their indices.
    """
    n = len(highs)
    last_sh = np.full(n, np.nan)
    last_sl = np.full(n, np.nan)
    last_sh_idx = np.full(n, -1.0)
    last_sl_idx = np.full(n, -1.0)
    
    current_sh = np.nan
    current_sl = np.nan
    curr_sh_idx = -1.0
    curr_sl_idx = -1.0
    
    for i in range(2 * window, n):
        # Check for Swing High at index (i - window)
        window_highs = highs[i - 2*window : i+1]
        mid_idx = window
        if highs[i - window] == np.max(window_highs):
            # To ensure it's a strict peak, we can check if it's strictly > previous/next
            # but standard fractal just needs it to be max
            current_sh = highs[i - window]
            curr_sh_idx = i - window
            
        # Check for Swing Low at index (i - window)
        window_lows = lows[i - 2*window : i+1]
        if lows[i - window] == np.min(window_lows):
            current_sl = lows[i - window]
            curr_sl_idx = i - window
            
        last_sh[i] = current_sh
        last_sh_idx[i] = curr_sh_idx
        last_sl[i] = current_sl
        last_sl_idx[i] = curr_sl_idx
        
    return last_sh, last_sl, last_sh_idx, last_sl_idx

@njit(cache=True)
def _calculate_sfp_and_bos(highs, lows, closes, volumes, last_sh, last_sl):
    n = len(closes)
    sfp_proxy = np.zeros(n)
    bos_velocity = np.zeros(n)
    
    for i in range(1, n):
        if np.isnan(last_sh[i-1]) or np.isnan(last_sl[i-1]):
            continue
            
        prev_sh = last_sh[i-1]
        prev_sl = last_sl[i-1]
        
        # Swing Failure Pattern (SFP) Proxy
        # Price sweeps above previous Swing High, but closes below it
        if highs[i] > prev_sh and closes[i] < prev_sh:
            sfp_proxy[i] = (highs[i] - prev_sh) / prev_sh
        elif lows[i] < prev_sl and closes[i] > prev_sl:
            sfp_proxy[i] = - (prev_sl - lows[i]) / prev_sl
            
        # Break of Structure (BOS) Velocity
        # Price closes above previous Swing High
        if closes[i] > prev_sh and closes[i-1] <= prev_sh:
            bos_velocity[i] = volumes[i] * ((closes[i] - prev_sh) / prev_sh)
        elif closes[i] < prev_sl and closes[i-1] >= prev_sl:
            bos_velocity[i] = - volumes[i] * ((prev_sl - closes[i]) / prev_sl)
            
    return sfp_proxy, bos_velocity

# ─────────────────────────────────────────────────────────────────────────
# ENGINE CLASS
# ─────────────────────────────────────────────────────────────────────────

class SwingDynamicsEngine:
    """
    Market Structure & Swing Dynamics Engine
    Extracts advanced structural features (BOS, SFP, ChoCh) avoiding Lookahead Bias.
    Designed for HFT (1-second) logic using dynamic multi-timeframe windows.
    """
    
    def __init__(self):
        # Default Windows for HFT (1-second data)
        self.MICRO_WINDOW = 60    # 1-minute structure
        self.MACRO_WINDOW = 300   # 5-minute structure
        
    def generate_features(self, df: pd.DataFrame, requested_features: list) -> pd.DataFrame:
        features_to_calc = [
            'swing_failure_pattern_proxy', 'break_of_structure_velocity', 
            'change_of_character_trigger', 'equal_highs_lows_pool', 
            'distance_to_liquidity_pool', 'swing_leg_amplitude', 
            'time_since_last_swing', 'swing_leg_velocity', 
            'premium_discount_matrix', 'fractal_density_index'
        ]
        
        # Check if any swing features are requested
        if not any(f in requested_features for f in features_to_calc):
            return df
            
        try:
            highs = df['High'].values
            lows = df['Low'].values
            closes = df['Close'].values
            volumes = df.get('Volume', pd.Series(1.0, index=df.index)).values
            
            # --- NUMBA VECTORIZATION ---
            # 1. Extract Swings (Macro & Micro)
            mac_sh, mac_sl, mac_sh_idx, mac_sl_idx = _find_swings(highs, lows, self.MACRO_WINDOW)
            mic_sh, mic_sl, mic_sh_idx, mic_sl_idx = _find_swings(highs, lows, self.MICRO_WINDOW)
            
            # 2. SFP & BOS
            sfp, bos = _calculate_sfp_and_bos(highs, lows, closes, volumes, mac_sh, mac_sl)
            
            # --- PANDAS VECTORIZATION ---
            # Create temporary series for alignment
            mac_sh_s = pd.Series(mac_sh, index=df.index)
            mac_sl_s = pd.Series(mac_sl, index=df.index)
            mac_sh_idx_s = pd.Series(mac_sh_idx, index=df.index)
            mac_sl_idx_s = pd.Series(mac_sl_idx, index=df.index)
            
            mic_sh_s = pd.Series(mic_sh, index=df.index)
            mic_sl_s = pd.Series(mic_sl, index=df.index)
            
            close_s = df['Close']
            
            # --- 1. SFP Proxy ---
            if 'swing_failure_pattern_proxy' in requested_features:
                df['swing_failure_pattern_proxy'] = sfp
                
            # --- 2. BOS Velocity ---
            if 'break_of_structure_velocity' in requested_features:
                df['break_of_structure_velocity'] = bos
                
            # --- 3. Change of Character (ChoCh) ---
            if 'change_of_character_trigger' in requested_features:
                # ChoCh: Micro swing breaks in opposite direction of Macro trend
                # E.g., Close > Micro Swing High, but Close < Macro Swing High (Downtrend)
                choch = np.zeros(len(df))
                bullish_choch = (close_s > mic_sh_s) & (close_s < mac_sh_s)
                bearish_choch = (close_s < mic_sl_s) & (close_s > mac_sl_s)
                choch[bullish_choch] = 1.0
                choch[bearish_choch] = -1.0
                df['change_of_character_trigger'] = choch
                
            # --- 4. Equal Highs/Lows Pool (EQH/EQL) ---
            if 'equal_highs_lows_pool' in requested_features:
                # Check if Macro SH and Micro SH are extremely close (<0.05%)
                diff = np.abs(mac_sh_s - mic_sh_s) / mac_sh_s
                eqh = (diff < 0.0005).astype(float)
                
                diff_l = np.abs(mac_sl_s - mic_sl_s) / mac_sl_s
                eql = (diff_l < 0.0005).astype(float)
                
                df['equal_highs_lows_pool'] = eqh - eql # +1 for EQH, -1 for EQL
                
            # --- 5. Distance to Nearest Liquidity Pool ---
            if 'distance_to_liquidity_pool' in requested_features:
                dist_sh = (mac_sh_s - close_s) / close_s
                dist_sl = (close_s - mac_sl_s) / close_s
                # Return minimum absolute distance
                df['distance_to_liquidity_pool'] = np.where(dist_sh < dist_sl, dist_sh, -dist_sl)
                df['distance_to_liquidity_pool'] = df['distance_to_liquidity_pool'].fillna(0)
                
            # --- 6. Swing Leg Amplitude ---
            if 'swing_leg_amplitude' in requested_features:
                amplitude = (mac_sh_s - mac_sl_s) / mac_sl_s
                df['swing_leg_amplitude'] = amplitude.fillna(0)
                
            # --- 7. Time Since Last Major Swing ---
            if 'time_since_last_swing' in requested_features:
                # Current index position minus the saved index position
                curr_idx_arr = np.arange(len(df))
                time_sh = curr_idx_arr - mac_sh_idx_s.values
                time_sl = curr_idx_arr - mac_sl_idx_s.values
                
                time_sh = np.where(mac_sh_idx_s.values < 0, 0, time_sh)
                time_sl = np.where(mac_sl_idx_s.values < 0, 0, time_sl)
                
                # Combine (Take min time)
                df['time_since_last_swing'] = np.minimum(time_sh, time_sl)
                
            # --- 8. Swing Leg Velocity ---
            if 'swing_leg_velocity' in requested_features:
                # Amplitude / Time
                amp = df['swing_leg_amplitude'] if 'swing_leg_amplitude' in df.columns else (mac_sh_s - mac_sl_s) / mac_sl_s
                t_swing = df['time_since_last_swing'] if 'time_since_last_swing' in df.columns else np.minimum(curr_idx_arr - mac_sh_idx_s.values, curr_idx_arr - mac_sl_idx_s.values)
                
                # Avoid div by zero
                t_safe = np.where(t_swing == 0, 1e-9, t_swing)
                df['swing_leg_velocity'] = (amp / t_safe).fillna(0)
                
            # --- 9. Premium vs Discount Matrix ---
            if 'premium_discount_matrix' in requested_features:
                # Fibonacci 0.5 level. 1 = Premium (at Swing High), 0 = Discount (at Swing Low)
                rng = mac_sh_s - mac_sl_s
                safe_rng = np.where(rng == 0, 1e-9, rng)
                pd_matrix = (close_s - mac_sl_s) / safe_rng
                # Clip between 0 and 1
                df['premium_discount_matrix'] = pd_matrix.clip(0, 1).fillna(0.5)
                
            # --- 10. Fractal Density Index ---
            if 'fractal_density_index' in requested_features:
                # Number of micro swing changes in the last 100 bars
                sh_changes = mic_sh_s.diff().fillna(0) != 0
                sl_changes = mic_sl_s.diff().fillna(0) != 0
                total_changes = (sh_changes | sl_changes).astype(float)
                
                df['fractal_density_index'] = total_changes.rolling(window=100, min_periods=1).sum().fillna(0)
                
        except Exception as e:
            logger.error(f"Error in SwingDynamicsEngine: {e}")
            # Ensure columns exist even on failure
            for f in features_to_calc:
                if f in requested_features and f not in df.columns:
                    df[f] = 0.0
                    
        return df
