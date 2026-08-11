import pandas as pd
import numpy as np
import pandas_ta as ta

def add_volatility_risk_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Applies Volatility and Risk indicators to the dataset.
    Uses pandas-ta and vectorized operations for RAM efficiency.
    """
    try:
        # 1. Standard Deviation
        df['STD_DEV_20'] = ta.stdev(df['close'], length=20).astype(np.float32)
        
        # 2. Chaikin Volatility (CV)
        # CV = EMA(High-Low, 10) - EMA(High-Low, 10) 10 days ago / ...
        high_low = df['high'] - df['low']
        hl_ema = high_low.ewm(span=10, adjust=False).mean()
        df['Chaikin_Vol_10'] = ((hl_ema - hl_ema.shift(10)) / hl_ema.shift(10).replace(0, np.nan) * 100).astype(np.float32)
        
        # 3. Ulcer Index
        ui = ta.ui(df['close'], length=14)
        if ui is not None:
            df = pd.concat([df, ui.astype(np.float32)], axis=1)
            
        # 4. Historical Volatility (Annualized proxy based on daily/interval returns)
        # Standard calculation: stdev of log returns * sqrt(trading periods in year)
        # We will provide a raw rolling log return stdev
        log_ret = np.log(df['close'] / df['close'].shift(1))
        df['Hist_Vol_20'] = (log_ret.rolling(window=20).std() * np.sqrt(365)).astype(np.float32) # Assuming daily, scale factor can be adjusted
        
        # 5. Acceleration Bands
        accbands = ta.accbands(df['high'], df['low'], df['close'], length=20, c=4)
        if accbands is not None:
            df = pd.concat([df, accbands.astype(np.float32)], axis=1)
            
        # 6. Mass Index
        massi = ta.massi(df['high'], df['low'], fast=9, slow=25)
        if massi is not None:
            df = pd.concat([df, massi.astype(np.float32)], axis=1)
            
        # 7. Choppiness Index
        chop = ta.chop(df['high'], df['low'], df['close'], length=14)
        if chop is not None:
            df = pd.concat([df, chop.astype(np.float32)], axis=1)

        # 8. Options Greeks Proxies
        # Since we don't have option chain data, we proxy Gamma/Delta from realized volatility
        # Delta Proxy: rate of change of price / standard deviation
        df['Options_Delta_Proxy'] = (df['close'].diff() / df['STD_DEV_20'].replace(0, np.nan)).astype(np.float32)
        # Gamma Proxy: rate of change of Delta
        df['Options_Gamma_Proxy'] = (df['Options_Delta_Proxy'].diff()).astype(np.float32)

    except Exception as e:
        print(f"Error in volatility_risk feature engineering: {e}")
        
    return df
