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

def calculate_mtf_structure(df: pd.DataFrame, htf_str: str) -> pd.DataFrame:
    """
    Resamples the LTF dataframe to HTF, calculates OBs and FVGs on HTF,
    and forward-fills these levels back into the LTF dataframe.
    """
    if len(df) < 50:
        return df

    # Ensure datetime exists for resampling
    if 'datetime' not in df.columns and 'timestamp' in df.columns:
        df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms')
        
    if 'datetime' not in df.columns:
        # Fallback if no time info
        return df
        
    df_ltf = df.copy()
    df_ltf.set_index('datetime', inplace=True)
    
    offset = get_pandas_offset(htf_str)
    
    # Resample to HTF
    htf_df = df_ltf.resample(offset).agg({
        'Open': 'first',
        'High': 'max',
        'Low': 'min',
        'Close': 'last',
        'Volume': 'sum'
    }).dropna()
    
    # Calculate HTF FVG
    # Bullish FVG: Low of candle i > High of candle i-2
    # Bearish FVG: High of candle i < Low of candle i-2
    htf_df['htf_bull_fvg_top'] = np.nan
    htf_df['htf_bull_fvg_bottom'] = np.nan
    htf_df['htf_bear_fvg_top'] = np.nan
    htf_df['htf_bear_fvg_bottom'] = np.nan
    
    htf_df['Low_i_2'] = htf_df['Low'].shift(2)
    htf_df['High_i_2'] = htf_df['High'].shift(2)
    
    # Bull FVG
    bull_fvg_mask = htf_df['Low'] > htf_df['High_i_2']
    htf_df.loc[bull_fvg_mask, 'htf_bull_fvg_top'] = htf_df['Low']
    htf_df.loc[bull_fvg_mask, 'htf_bull_fvg_bottom'] = htf_df['High_i_2']
    
    # Bear FVG
    bear_fvg_mask = htf_df['High'] < htf_df['Low_i_2']
    htf_df.loc[bear_fvg_mask, 'htf_bear_fvg_top'] = htf_df['Low_i_2']
    htf_df.loc[bear_fvg_mask, 'htf_bear_fvg_bottom'] = htf_df['High']
    
    # Drop temp cols
    htf_df.drop(columns=['Low_i_2', 'High_i_2'], inplace=True)
    
    # Keep only the feature columns to merge back
    htf_features = htf_df[['htf_bull_fvg_top', 'htf_bull_fvg_bottom', 'htf_bear_fvg_top', 'htf_bear_fvg_bottom']]
    
    # Merge back to LTF using forward fill to prevent lookahead bias.
    # The FVG formed at candle 'i' is only known AT THE CLOSE of candle 'i'.
    # So we must shift the HTF features forward by 1 period on the HTF timescale 
    # before mapping them to the LTF.
    htf_features_shifted = htf_features.shift(1)
    
    # Reindex to LTF index with ffill
    mapped_features = htf_features_shifted.reindex(df_ltf.index, method='ffill')
    
    # Assign back to original df
    df['htf_bull_fvg_top'] = mapped_features['htf_bull_fvg_top'].values
    df['htf_bull_fvg_bottom'] = mapped_features['htf_bull_fvg_bottom'].values
    df['htf_bear_fvg_top'] = mapped_features['htf_bear_fvg_top'].values
    df['htf_bear_fvg_bottom'] = mapped_features['htf_bear_fvg_bottom'].values
    
    # Flag if LTF is currently inside an HTF FVG
    df['in_htf_bull_fvg'] = ((df['Low'] <= df['htf_bull_fvg_top']) & (df['High'] >= df['htf_bull_fvg_bottom'])).astype(int)
    df['in_htf_bear_fvg'] = ((df['High'] >= df['htf_bear_fvg_bottom']) & (df['Low'] <= df['htf_bear_fvg_top'])).astype(int)
    
    return df
