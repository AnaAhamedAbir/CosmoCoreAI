import pandas as pd
import numpy as np
import pandas_ta as ta

def add_volume_flow_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Applies Advanced Volume and Flow indicators to the dataset.
    Uses pandas-ta and vectorized operations for RAM efficiency.
    """
    try:
        # 1. Accumulation/Distribution (A/D)
        df['AD'] = ta.ad(df['high'], df['low'], df['close'], df['volume']).astype(np.float32)
        
        # 2. Volume Profile (Basic Rolling POC/HVN Approximation)
        # For ML, a rolling VWAP or price-volume distribution is more useful than a static session profile
        # We approximate the HVN (High Volume Node) using a rolling Volume-Weighted Price
        df['VP_Rolling_HVN_Proxy_50'] = ta.vwap(df['high'], df['low'], df['close'], df['volume'], anchor="D").astype(np.float32) 
        
        # 3. Ease of Movement (EOM)
        eom = ta.eom(df['high'], df['low'], df['close'], df['volume'], length=14)
        if eom is not None:
            df = pd.concat([df, eom.astype(np.float32)], axis=1)
            
        # 4. Force Index
        df['Force_Index_13'] = (df['close'].diff(1) * df['volume']).ewm(span=13, adjust=False).mean().astype(np.float32)
        
        # 5. Volume Oscillator
        fast_vol_ema = df['volume'].ewm(span=14, adjust=False).mean()
        slow_vol_ema = df['volume'].ewm(span=28, adjust=False).mean()
        df['Vol_Osc_14_28'] = (((fast_vol_ema - slow_vol_ema) / slow_vol_ema) * 100).astype(np.float32)
        
        # 6. Negative Volume Index (NVI)
        nvi = ta.nvi(df['close'], df['volume'], length=255)
        if nvi is not None:
            df = pd.concat([df, nvi.astype(np.float32)], axis=1)
            
        # 7. Positive Volume Index (PVI)
        pvi = ta.pvi(df['close'], df['volume'], length=255)
        if pvi is not None:
            df = pd.concat([df, pvi.astype(np.float32)], axis=1)
            
        # 8. Klinger Oscillator
        kvo = ta.kvo(df['high'], df['low'], df['close'], df['volume'], fast=34, slow=55, signal=13)
        if kvo is not None:
            df = pd.concat([df, kvo.astype(np.float32)], axis=1)
            
        # 9. Price Volume Trend (PVT)
        pvt = ta.pvt(df['close'], df['volume'])
        if pvt is not None:
            df = pd.concat([df, pvt.astype(np.float32)], axis=1)
            
        # 10. Elder-Ray Index
        ema13 = ta.ema(df['close'], length=13)
        df['Elder_Bull_Power_13'] = (df['high'] - ema13).astype(np.float32)
        df['Elder_Bear_Power_13'] = (df['low'] - ema13).astype(np.float32)
        
        # 11. Market Facilitation Index (BW MFI)
        # Formula: (High - Low) / Volume
        bw_mfi = (df['high'] - df['low']) / df['volume'].replace(0, 1) # prevent div by zero
        df['BW_MFI'] = bw_mfi.astype(np.float32)

    except Exception as e:
        print(f"Error in volume_flow feature engineering: {e}")
        
    return df
