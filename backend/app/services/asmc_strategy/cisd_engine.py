import pandas as pd
import numpy as np

def detect_cisd(df: pd.DataFrame) -> pd.DataFrame:
    """
    Detects Change in State of Delivery (CISD) on the LTF dataframe.
    Requires that the dataframe has already been processed by calculate_mtf_structure
    (so it has 'in_htf_bull_fvg' and 'in_htf_bear_fvg').
    """
    df['ltf_bull_cisd'] = 0
    df['ltf_bear_cisd'] = 0
    
    if 'in_htf_bull_fvg' not in df.columns or 'in_htf_bear_fvg' not in df.columns:
        return df

    # Calculate basic LTF momentum/engulfing
    df['prev_close'] = df['Close'].shift(1)
    df['prev_open'] = df['Open'].shift(1)
    
    # Bullish engulfing or strong momentum close
    bull_momentum = (df['Close'] > df['Open']) & (df['Close'] > df['prev_open']) & (df['prev_close'] < df['prev_open'])
    
    # Bearish engulfing or strong momentum close
    bear_momentum = (df['Close'] < df['Open']) & (df['Close'] < df['prev_open']) & (df['prev_close'] > df['prev_open'])
    
    # Volume spike check (Volume > moving average of volume)
    if 'Volume' in df.columns:
        df['vol_ma'] = df['Volume'].rolling(20).mean()
        vol_spike = df['Volume'] > df['vol_ma']
    else:
        vol_spike = True # Fallback if no volume

    # A Bullish CISD occurs if we are inside a HTF Bull FVG and we get LTF Bull Momentum + Volume
    df.loc[(df['in_htf_bull_fvg'] == 1) & bull_momentum & vol_spike, 'ltf_bull_cisd'] = 1
    
    # A Bearish CISD occurs if we are inside a HTF Bear FVG and we get LTF Bear Momentum + Volume
    df.loc[(df['in_htf_bear_fvg'] == 1) & bear_momentum & vol_spike, 'ltf_bear_cisd'] = 1
    
    # Cleanup temp columns
    cols_to_drop = ['prev_close', 'prev_open', 'vol_ma']
    for c in cols_to_drop:
        if c in df.columns:
            df.drop(columns=[c], inplace=True)
            
    return df
