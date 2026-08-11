import pandas as pd
import pandas_ta as ta
import numpy as np
import logging

logger = logging.getLogger(__name__)

def generate_smc_and_pattern_features(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Dynamically generates SMC, Swings, Supertrend, Candlestick Patterns, and Psychology features.
    
    Args:
        df (pd.DataFrame): DataFrame with 'open', 'high', 'low', 'close', and optionally 'volume'.
        selected_features (list[str]): List of feature IDs requested by the user.
        
    Returns:
        pd.DataFrame: The DataFrame with appended feature columns.
    """
    if df.empty or not selected_features:
        return df

    try:
        # ---------------------------------------------------------
        # PHASE 1: Foundation (Supertrend & Swings)
        # ---------------------------------------------------------
        if 'supertrend' in selected_features:
            # supertrend usually returns 4 columns: SUPERT_7_3.0, SUPERTd_7_3.0, SUPERTl_7_3.0, SUPERTs_7_3.0
            st = df.ta.supertrend(append=False)
            if st is not None:
                # We care about the continuous trend direction (1 for up, -1 for down) 
                # which is SUPERTd, or the actual price line SUPERT
                col_d = [c for c in st.columns if 'SUPERTd' in c]
                if col_d:
                    df['supertrend_dir'] = st[col_d[0]]
                    
                col_val = [c for c in st.columns if c.startswith('SUPERT_')]
                if col_val:
                    df['supertrend_val'] = st[col_val[0]]

        # Swings (Local Highs and Lows) using a simple rolling window approach (Fractals)
        # A swing high is the highest point in a 5-candle window (2 left, center, 2 right).
        # To avoid data leak, we must identify a swing high 2 periods AFTER it happens.
        # But for ML feature calculation, we map it to the row where we KNOW it's a swing.
        if any(f in selected_features for f in ['swing_high_low', 'bos_choch', 'order_blocks']):
            # Left 2, Right 2 fractal
            window = 5
            df['is_swing_high'] = (df['high'] == df['high'].rolling(window, center=True).max()).astype(int)
            df['is_swing_low'] = (df['low'] == df['low'].rolling(window, center=True).min()).astype(int)
            
            # Shift the flags forward to avoid look-ahead bias! 
            # If center=True, the flag is at T. But we only know it at T+2.
            # So the actionable signal that a swing was formed is at T+2.
            df['swing_high_signal'] = df['is_swing_high'].shift(2)
            df['swing_low_signal'] = df['is_swing_low'].shift(2)
            
            # Forward fill the actual swing price levels
            df['last_swing_high'] = np.where(df['is_swing_high'] == 1, df['high'], np.nan)
            df['last_swing_low'] = np.where(df['is_swing_low'] == 1, df['low'], np.nan)
            
            df['last_swing_high'] = df['last_swing_high'].ffill()
            df['last_swing_low'] = df['last_swing_low'].ffill()

        # ---------------------------------------------------------
        # PHASE 2: Advanced SMC (BOS, CHoCH, FVG, Order Blocks)
        # ---------------------------------------------------------
        if 'bos_choch' in selected_features:
            # BOS (Break of Structure): Current close > last_swing_high for bullish BOS.
            # Current close < last_swing_low for bearish BOS.
            if 'last_swing_high' in df.columns:
                df['bullish_bos'] = ((df['close'] > df['last_swing_high']) & (df['close'].shift(1) <= df['last_swing_high'].shift(1))).astype(int)
                df['bearish_bos'] = ((df['close'] < df['last_swing_low']) & (df['close'].shift(1) >= df['last_swing_low'].shift(1))).astype(int)
                
                # CHoCH (Change of Character) is essentially a BOS in the opposite direction of the primary trend.
                # For simplicity in feature space, we provide the raw bullish/bearish breaks.
                df['structure_break'] = df['bullish_bos'] - df['bearish_bos']

        if any(f in selected_features for f in ['fvg', 'order_blocks']):
            # Bullish FVG: Low of candle 3 > High of candle 1
            df['fvg_bullish'] = (df['low'] > df['high'].shift(2)).astype(int)
            # Bearish FVG: High of candle 3 < Low of candle 1
            df['fvg_bearish'] = (df['high'] < df['low'].shift(2)).astype(int)
            
            if 'fvg' in selected_features:
                df['fvg_signal'] = df['fvg_bullish'] - df['fvg_bearish']

        if 'order_blocks' in selected_features:
            # Order Block proxy: If a bullish BOS happens, the lowest down-candle before it is an OB.
            # For ML, we can flag strong momentum candles following a reversal.
            df['is_down_candle'] = (df['close'] < df['open']).astype(int)
            df['is_up_candle'] = (df['close'] > df['open']).astype(int)
            
            # Simple OB heuristic: A down candle immediately preceding a 3-candle strong up move (or FVG).
            df['bullish_ob_proxy'] = ((df['is_down_candle'] == 1) & (df['fvg_bullish'].shift(-2) == 1)).astype(int)
            df['bearish_ob_proxy'] = ((df['is_up_candle'] == 1) & (df['fvg_bearish'].shift(-2) == 1)).astype(int)
            # No look-ahead bias: Shift it back to action time
            df['bullish_ob_signal'] = df['bullish_ob_proxy'].shift(2)
            df['bearish_ob_signal'] = df['bearish_ob_proxy'].shift(2)

        # ---------------------------------------------------------
        # PHASE 3: Candlestick Patterns
        # ---------------------------------------------------------
        # pandas_ta has a unified cdl_pattern method
        pattern_mapping = {
            'cdl_doji': 'doji',
            'cdl_engulfing': 'engulfing',
            'cdl_hammer': 'hammer',
            'cdl_shooting_star': 'shootingstar',
            'cdl_morning_star': 'morningstar',
            'cdl_evening_star': 'eveningstar'
        }
        
        patterns_to_run = [pattern_mapping[f] for f in selected_features if f in pattern_mapping]
        if patterns_to_run:
            # We can run specific patterns
            try:
                cdl = df.ta.cdl_pattern(name=patterns_to_run, append=False)
                if cdl is not None:
                    # Rename columns to match our feature names (CDL_DOJI_10_0.1 -> cdl_doji)
                    for f in selected_features:
                        if f in pattern_mapping:
                            ptype = pattern_mapping[f]
                            # Find matching column
                            match_cols = [c for c in cdl.columns if ptype.lower() in c.lower()]
                            if match_cols:
                                df[f] = cdl[match_cols[0]]
            except Exception as e:
                logger.warning(f"Failed to calculate candlestick patterns: {e}")

        # ---------------------------------------------------------
        # PHASE 4: Market Psychology
        # ---------------------------------------------------------
        if 'consecutive_candles' in selected_features:
            # Track consecutive green or red candles
            df['is_green'] = (df['close'] > df['open']).astype(int)
            df['is_red'] = (df['close'] < df['open']).astype(int)
            
            # Cumulative sum resetting on zero
            # Bullish streak
            bull_streak = df['is_green'].groupby((df['is_green'] != df['is_green'].shift()).cumsum()).cumsum()
            bear_streak = df['is_red'].groupby((df['is_red'] != df['is_red'].shift()).cumsum()).cumsum()
            
            df['consecutive_bull'] = bull_streak
            df['consecutive_bear'] = bear_streak

        if 'buying_selling_pressure' in selected_features:
            # Buying pressure = Lower shadow / Total Range
            # Selling pressure = Upper shadow / Total Range
            total_range = df['high'] - df['low']
            lower_shadow = df[['open', 'close']].min(axis=1) - df['low']
            upper_shadow = df['high'] - df[['open', 'close']].max(axis=1)
            
            df['buying_pressure'] = np.where(total_range == 0, 0, lower_shadow / total_range)
            df['selling_pressure'] = np.where(total_range == 0, 0, upper_shadow / total_range)

        if 'gap_analysis' in selected_features:
            # Gap between current open and previous close
            df['gap_size'] = df['open'] - df['close'].shift(1)
            # Gap ratio (gap size relative to previous close)
            df['gap_ratio'] = df['gap_size'] / df['close'].shift(1)

        # Cleanup internal flags used for calculation
        cols_to_drop = ['is_swing_high', 'is_swing_low', 'is_down_candle', 'is_up_candle', 'fvg_bullish', 'fvg_bearish', 'bullish_ob_proxy', 'bearish_ob_proxy', 'is_green', 'is_red']
        for c in cols_to_drop:
            if c in df.columns:
                df.drop(columns=[c], inplace=True)

    except Exception as e:
        logger.error(f"Error calculating SMC/Pattern features: {e}")
        
    return df
