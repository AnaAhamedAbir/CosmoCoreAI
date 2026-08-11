import pandas as pd
import numpy as np

def apply_triple_barrier(df: pd.DataFrame, pt_sl_ratio: float, timeout_bars: int) -> pd.Series:
    """
    Applies the Triple Barrier Method to create target labels.
    Upper Barrier (Profit Take) = Current Close + (Volatility * pt_sl_ratio)
    Lower Barrier (Stop Loss) = Current Close - Volatility
    Vertical Barrier (Timeout) = Current Index + timeout_bars
    
    Returns:
        pd.Series: target labels where 1 = PT hit, -1 = SL hit, 0 = Timeout hit
    """
    # 1. Calculate a simple rolling volatility (standard deviation of log returns)
    returns = df['close'].pct_change()
    volatility = returns.rolling(window=20).std().fillna(returns.std()) * df['close']
    # Ensure minimum volatility to avoid zero division/zero barriers
    volatility = volatility.replace(0, volatility.mean())

    events = pd.DataFrame(index=df.index)
    events['t1'] = events.index.to_series().shift(-timeout_bars)
    events['target'] = 0

    # Convert to numpy for faster iteration (vectorized barrier search is complex)
    closes = df['close'].values
    vols = volatility.values
    
    targets = np.zeros(len(df))
    
    # We use a relatively simple loop. For production with millions of rows, Numba is recommended.
    for i in range(len(df)):
        if i + 1 >= len(df):
            break
            
        current_close = closes[i]
        vol = vols[i]
        
        # Calculate barrier prices
        upper_barrier = current_close + (vol * pt_sl_ratio)
        lower_barrier = current_close - vol
        
        # Look ahead up to timeout_bars
        end_idx = min(i + timeout_bars + 1, len(df))
        path = closes[i+1:end_idx]
        
        hit = 0 # Default to timeout
        for price in path:
            if price >= upper_barrier:
                hit = 1
                break
            elif price <= lower_barrier:
                hit = -1
                break
                
        targets[i] = hit
        
    return pd.Series(targets, index=df.index)
