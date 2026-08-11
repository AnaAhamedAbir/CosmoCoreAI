import pandas as pd
import numpy as np
import logging

def get_pandas_offset(tf_str: str) -> str:
    mapping = {
        '1m': '1min',
        '5m': '5min',
        '15m': '15min',
        '1h': '1h',
        '4h': '4h',
        '1d': '1D',
        '1w': '1W'
    }
    return mapping.get(tf_str.lower(), '4h')

def calculate_forex_mtf_structure(df: pd.DataFrame, htf_str: str) -> pd.DataFrame:
    """
    Resamples the LTF dataframe to HTF, calculates OBs and FVGs on HTF,
    and forward-fills these levels back into the LTF dataframe.
    Uses lowercase column names for Forex data engine compatibility.
    """
    if len(df) < 50:
        return df

    # Ensure datetime exists for resampling
    time_col = None
    if 'time' in df.columns:
        time_col = 'time'
    elif 'datetime' in df.columns:
        time_col = 'datetime'
    elif 'timestamp' in df.columns:
        time_col = 'timestamp'
        
    if not time_col and not isinstance(df.index, pd.DatetimeIndex):
        logging.warning("Forex MTF Processor: No valid time column found.")
        return df
        
    df_ltf = df.copy()
    if time_col:
        df_ltf[time_col] = pd.to_datetime(df_ltf[time_col], utc=True).dt.tz_localize(None)
        df_ltf.set_index(time_col, inplace=True)
    
    offset = get_pandas_offset(htf_str)
    
    # Check for required columns
    req_cols = ['open', 'high', 'low', 'close']
    if not all(c in df_ltf.columns for c in req_cols):
        logging.warning("Forex MTF Processor: Missing OHLC columns.")
        return df
    
    # Resample to HTF
    agg_dict = {
        'open': 'first',
        'high': 'max',
        'low': 'min',
        'close': 'last'
    }
    if 'volume' in df_ltf.columns:
        agg_dict['volume'] = 'sum'
        
    htf_df = df_ltf.resample(offset).agg(agg_dict).dropna()
    
    # ==========================================
    # 1. Calculate HTF FVGs
    # ==========================================
    htf_df['htf_bull_fvg_top'] = np.nan
    htf_df['htf_bull_fvg_bottom'] = np.nan
    htf_df['htf_bear_fvg_top'] = np.nan
    htf_df['htf_bear_fvg_bottom'] = np.nan
    
    htf_df['low_i_2'] = htf_df['low'].shift(2)
    htf_df['high_i_2'] = htf_df['high'].shift(2)
    
    # Bull FVG
    bull_fvg_mask = htf_df['low'] > htf_df['high_i_2']
    htf_df.loc[bull_fvg_mask, 'htf_bull_fvg_top'] = htf_df['low']
    htf_df.loc[bull_fvg_mask, 'htf_bull_fvg_bottom'] = htf_df['high_i_2']
    
    # Bear FVG
    bear_fvg_mask = htf_df['high'] < htf_df['low_i_2']
    htf_df.loc[bear_fvg_mask, 'htf_bear_fvg_top'] = htf_df['low_i_2']
    htf_df.loc[bear_fvg_mask, 'htf_bear_fvg_bottom'] = htf_df['high']
    
    # ==========================================
    # 2. Calculate HTF Order Blocks (OBs)
    # ==========================================
    htf_df['htf_bull_ob_top'] = np.nan
    htf_df['htf_bull_ob_bottom'] = np.nan
    htf_df['htf_bear_ob_top'] = np.nan
    htf_df['htf_bear_ob_bottom'] = np.nan
    
    # Bullish OB: A down candle followed by a strong up candle that engulfs it or breaks structure.
    prev_bearish = htf_df['close'].shift(1) < htf_df['open'].shift(1)
    curr_bullish = htf_df['close'] > htf_df['open']
    engulfing_bull = htf_df['close'] > htf_df['high'].shift(1)
    
    bull_ob_mask = prev_bearish & curr_bullish & engulfing_bull
    htf_df.loc[bull_ob_mask, 'htf_bull_ob_top'] = htf_df['high'].shift(1)
    htf_df.loc[bull_ob_mask, 'htf_bull_ob_bottom'] = htf_df['low'].shift(1)
    
    # Bearish OB: An up candle followed by a strong down candle that engulfs it.
    prev_bullish = htf_df['close'].shift(1) > htf_df['open'].shift(1)
    curr_bearish = htf_df['close'] < htf_df['open']
    engulfing_bear = htf_df['close'] < htf_df['low'].shift(1)
    
    bear_ob_mask = prev_bullish & curr_bearish & engulfing_bear
    htf_df.loc[bear_ob_mask, 'htf_bear_ob_top'] = htf_df['high'].shift(1)
    htf_df.loc[bear_ob_mask, 'htf_bear_ob_bottom'] = htf_df['low'].shift(1)
    
    # Keep only the feature columns to merge back
    htf_features = htf_df[[
        'htf_bull_fvg_top', 'htf_bull_fvg_bottom', 'htf_bear_fvg_top', 'htf_bear_fvg_bottom',
        'htf_bull_ob_top', 'htf_bull_ob_bottom', 'htf_bear_ob_top', 'htf_bear_ob_bottom'
    ]]
    
    # Merge back to LTF using forward fill to prevent lookahead bias.
    htf_features_shifted = htf_features.shift(1)
    
    # Reindex to LTF index with ffill and then bfill for the initial rows
    mapped_features = htf_features_shifted.reindex(df_ltf.index).ffill().bfill()
    
    # Assign back to original df
    for col in mapped_features.columns:
        df[col] = mapped_features[col].values
    
    # Flags for being inside HTF POIs
    df['in_htf_bull_fvg'] = ((df['low'] <= df['htf_bull_fvg_top']) & (df['high'] >= df['htf_bull_fvg_bottom'])).astype(int)
    df['in_htf_bear_fvg'] = ((df['high'] >= df['htf_bear_fvg_bottom']) & (df['low'] <= df['htf_bear_fvg_top'])).astype(int)
    
    df['in_htf_bull_ob'] = ((df['low'] <= df['htf_bull_ob_top']) & (df['high'] >= df['htf_bull_ob_bottom'])).astype(int)
    df['in_htf_bear_ob'] = ((df['high'] >= df['htf_bear_ob_bottom']) & (df['low'] <= df['htf_bear_ob_top'])).astype(int)
    
    return df
