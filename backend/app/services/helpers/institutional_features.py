import pandas as pd
import numpy as np

def add_smc_fvg(df: pd.DataFrame):
    """
    Adds Fair Value Gap (FVG) features (1/0).
    A Bullish FVG occurs when the Low of the current candle is higher than the High of two candles ago,
    leaving a 'gap' in price action.
    """
    if len(df) < 3:
        return
        
    bullish_fvg = df['Low'] > df['High'].shift(2)
    bearish_fvg = df['High'] < df['Low'].shift(2)
    
    # We only care if it's a valid 3-candle pattern, meaning strong directional candle at i-1
    bullish_candle = df['Close'].shift(1) > df['Open'].shift(1)
    bearish_candle = df['Close'].shift(1) < df['Open'].shift(1)
    
    df['SMC_FVG_Bullish'] = (bullish_fvg & bullish_candle).astype(int)
    df['SMC_FVG_Bearish'] = (bearish_fvg & bearish_candle).astype(int)

def add_ict_killzones(df: pd.DataFrame):
    """
    Adds ICT Killzone time features.
    Assuming the input dataframe index is UTC datetime.
    """
    if not isinstance(df.index, pd.DatetimeIndex):
        return
        
    # Convert index to EST (UTC-5) approximation for Killzones
    if df.index.tz is None:
        idx_est = df.index - pd.Timedelta(hours=5)
    else:
        idx_est = df.index.tz_convert('US/Eastern')
        
    hour = idx_est.hour
    
    # London: 02:00 - 05:00 EST
    df['ICT_London_KZ'] = ((hour >= 2) & (hour < 5)).astype(int)
    # NY: 07:00 - 10:00 EST
    df['ICT_NY_KZ'] = ((hour >= 7) & (hour < 10)).astype(int)
    # Asia: 20:00 - 00:00 EST
    df['ICT_Asia_KZ'] = ((hour >= 20) | (hour < 0)).astype(int)

def add_wick_rejection(df: pd.DataFrame):
    """
    Calculates Wick Ratios to identify rejection blocks.
    High ratio means long wick relative to the candle range.
    """
    range_val = df['High'] - df['Low']
    range_val = range_val.replace(0, np.nan)
    
    body_top = df[['Open', 'Close']].max(axis=1)
    body_bottom = df[['Open', 'Close']].min(axis=1)
    
    df['Wick_Upper_Ratio'] = (df['High'] - body_top) / range_val
    df['Wick_Lower_Ratio'] = (body_bottom - df['Low']) / range_val
    
    df['Wick_Upper_Ratio'] = df['Wick_Upper_Ratio'].fillna(0)
    df['Wick_Lower_Ratio'] = df['Wick_Lower_Ratio'].fillna(0)

def add_swing_structure(df: pd.DataFrame, window: int = 5):
    """
    Detects Swing Highs and Lows for basic Market Structure 
    (ChoCH/BOS approximations). 1 if swing point, 0 otherwise.
    """
    if len(df) < window:
        return
        
    df['Swing_High'] = (df['High'] == df['High'].rolling(window=window, center=True).max()).astype(int)
    df['Swing_Low'] = (df['Low'] == df['Low'].rolling(window=window, center=True).min()).astype(int)
    
    # Forward fill the last swing values to represent the current "State"
    df['Last_Swing_High_Px'] = df['High'].where(df['Swing_High'] == 1).ffill()
    df['Last_Swing_Low_Px'] = df['Low'].where(df['Swing_Low'] == 1).ffill()

def add_order_blocks(df: pd.DataFrame):
    """
    Approximates Order Blocks formation. 
    Bullish OB: Last bearish candle before a strong bullish move.
    """
    if len(df) < 14:
        return
        
    range_val = df['High'] - df['Low']
    avg_range = range_val.rolling(14).mean()
    
    strong_bullish = (df['Close'] - df['Open']) > (avg_range * 1.5)
    prev_bearish = df['Close'].shift(1) < df['Open'].shift(1)
    df['OB_Bullish_Formed'] = (strong_bullish & prev_bearish).astype(int)
    
    strong_bearish = (df['Open'] - df['Close']) > (avg_range * 1.5)
    prev_bullish = df['Close'].shift(1) > df['Open'].shift(1)
    df['OB_Bearish_Formed'] = (strong_bearish & prev_bullish).astype(int)
