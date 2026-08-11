import pandas as pd
import numpy as np

def add_confluence_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Applies Advanced Hedge Fund Confluence Logic.
    Safely wraps all conditions to avoid breaking the pipeline if specific features are disabled.
    """
    # Create empty columns first to ensure they exist for ML schema
    confluence_cols = [
        'Conf_SMA_RSI_Bull', 'Conf_SMA_RSI_Bear', 'Conf_EMA_MACD_Bull', 
        'Conf_MACD_BB_Bounce', 'Conf_SAR_ADX_Trend', 'Conf_Stoch_RSI_Oversold',
        'Conf_Ichimoku_RSI_Breakout', 'Conf_SuperTrend_CCI_Pullback', 'Conf_HMA_VolProfile',
        'Conf_GoldenPocket_Bounce', 'Conf_LinReg_StdDev_Squeeze', 'Conf_Aroon_EMA50',
        'Conf_Donchian_VolBreakout', 'Conf_Guppy_RSI_Trend', 'Conf_CCI_SAR',
        'Conf_ROC_VWAP', 'Conf_Vortex_Trend', 'Conf_OBV_VWAP_Trend',
        'Conf_MFI_CMF_Flow', 'Conf_EOM_Force_Spike', 'Conf_Smart_vs_Dumb_Money',
        'Conf_Keltner_Vol_Expansion', 'Conf_Fib_Wave3_Proxy', 'Conf_Fractal_ZigZag_Reversal'
    ]
    for c in confluence_cols:
        df[c] = 0.0

    try:
        if 'SMA_20' in df.columns and 'RSI_14' in df.columns:
            df['Conf_SMA_RSI_Bull'] = ((df['close'] > df['SMA_20']) & (df['RSI_14'] > 50)).astype(np.float32)
            df['Conf_SMA_RSI_Bear'] = ((df['close'] < df['SMA_20']) & (df['RSI_14'] < 50)).astype(np.float32)
    except Exception: pass

    try:
        if 'EMA_50' in df.columns and 'MACD_12_26_9' in df.columns and 'MACDs_12_26_9' in df.columns:
            df['Conf_EMA_MACD_Bull'] = ((df['close'] > df['EMA_50']) & (df['MACD_12_26_9'] > df['MACDs_12_26_9'])).astype(np.float32)
    except Exception: pass

    try:
        if 'MACD_12_26_9' in df.columns and 'BBL_20_2.0' in df.columns:
            df['Conf_MACD_BB_Bounce'] = ((df['MACD_12_26_9'] > df['MACDs_12_26_9']) & (df['close'] < df['BBL_20_2.0'])).astype(np.float32)
    except Exception: pass

    try:
        if 'ADX_14' in df.columns and 'PSARl_0.02_0.2' in df.columns:
            df['Conf_SAR_ADX_Trend'] = ((df['ADX_14'] > 25) & (df['close'] > df['PSARl_0.02_0.2'])).astype(np.float32)
    except Exception: pass

    try:
        if 'STOCHk_14_3_3' in df.columns and 'RSI_14' in df.columns:
            df['Conf_Stoch_RSI_Oversold'] = ((df['STOCHk_14_3_3'] < 20) & (df['RSI_14'] < 30)).astype(np.float32)
    except Exception: pass

    try:
        if 'ISA_9' in df.columns and 'ISB_26' in df.columns and 'RSI_14' in df.columns:
            df['Conf_Ichimoku_RSI_Breakout'] = ((df['close'] > df['ISA_9']) & (df['close'] > df['ISB_26']) & (df['RSI_14'] < 70)).astype(np.float32)
    except Exception: pass

    try:
        if 'SUPERTd_7_3.0' in df.columns and 'CCI_14_0.015' in df.columns:
            df['Conf_SuperTrend_CCI_Pullback'] = ((df['SUPERTd_7_3.0'] == 1) & (df['CCI_14_0.015'] < -100)).astype(np.float32)
    except Exception: pass

    try:
        if 'HMA_14' in df.columns and 'VP_Rolling_HVN_Proxy_50' in df.columns:
            df['Conf_HMA_VolProfile'] = ((df['close'] > df['HMA_14']) & (df['close'] > df['VP_Rolling_HVN_Proxy_50'])).astype(np.float32)
    except Exception: pass

    try:
        if 'Fib_0_618' in df.columns:
            df['Conf_GoldenPocket_Bounce'] = (abs(df['close'] - df['Fib_0_618']) / df['close'] < 0.005).astype(np.float32)
    except Exception: pass

    try:
        if 'LinReg_Lower' in df.columns and 'STD_DEV_20' in df.columns:
            df['Conf_LinReg_StdDev_Squeeze'] = ((df['close'] <= df['LinReg_Lower']) & (df['STD_DEV_20'] < df['STD_DEV_20'].rolling(20).mean())).astype(np.float32)
    except Exception: pass

    try:
        if 'AROONu_14' in df.columns and 'EMA_50' in df.columns:
            df['Conf_Aroon_EMA50'] = ((df['AROONu_14'] > 70) & (df['close'] > df['EMA_50'])).astype(np.float32)
    except Exception: pass

    try:
        if 'DCL_20_20' in df.columns and 'Vol_Osc_14_28' in df.columns:
            df['Conf_Donchian_VolBreakout'] = ((df['close'] == df['DCL_20_20']) & (df['Vol_Osc_14_28'] > 0)).astype(np.float32)
    except Exception: pass

    try:
        if 'Guppy_Short_EMA_3' in df.columns and 'RSI_14' in df.columns:
            df['Conf_Guppy_RSI_Trend'] = ((df['close'] > df['Guppy_Short_EMA_3']) & (df['RSI_14'] > 50)).astype(np.float32)
    except Exception: pass

    try:
        if 'CCI_14_0.015' in df.columns and 'PSARl_0.02_0.2' in df.columns:
            df['Conf_CCI_SAR'] = ((df['CCI_14_0.015'] > 100) & (df['close'] > df['PSARl_0.02_0.2'])).astype(np.float32)
    except Exception: pass

    try:
        if 'ROC_10' in df.columns and 'VP_Rolling_HVN_Proxy_50' in df.columns:
            df['Conf_ROC_VWAP'] = ((df['ROC_10'] > 0) & (df['close'] > df['VP_Rolling_HVN_Proxy_50'])).astype(np.float32)
    except Exception: pass

    try:
        if 'VTXP_14' in df.columns and 'VTXM_14' in df.columns:
            df['Conf_Vortex_Trend'] = (df['VTXP_14'] > df['VTXM_14']).astype(np.float32)
    except Exception: pass

    try:
        if 'OBV' in df.columns and 'VP_Rolling_HVN_Proxy_50' in df.columns:
            df['Conf_OBV_VWAP_Trend'] = ((df['OBV'] > df['OBV'].rolling(10).mean()) & (df['close'] > df['VP_Rolling_HVN_Proxy_50'])).astype(np.float32)
    except Exception: pass

    try:
        if 'MFI_14' in df.columns and 'CMF_20' in df.columns:
            df['Conf_MFI_CMF_Flow'] = ((df['MFI_14'] > 50) & (df['CMF_20'] > 0)).astype(np.float32)
    except Exception: pass

    try:
        eom_cols = [c for c in df.columns if c.startswith('EOM')]
        if len(eom_cols) > 0 and 'Force_Index_13' in df.columns:
            df['Conf_EOM_Force_Spike'] = ((df[eom_cols[0]] > 0) & (df['Force_Index_13'] > 0)).astype(np.float32)
    except Exception: pass

    try:
        if 'NVI_1' in df.columns and 'PVI_1' in df.columns:
            df['Conf_Smart_vs_Dumb_Money'] = (df['NVI_1'] > df['PVI_1']).astype(np.float32)
    except Exception: pass

    try:
        if 'KCUe_20_2' in df.columns and 'STD_DEV_20' in df.columns:
            df['Conf_Keltner_Vol_Expansion'] = ((df['close'] > df['KCUe_20_2']) & (df['STD_DEV_20'] > df['STD_DEV_20'].rolling(10).mean())).astype(np.float32)
    except Exception: pass

    try:
        if 'Fib_0_618' in df.columns and 'EWO' in df.columns:
            df['Conf_Fib_Wave3_Proxy'] = ((df['close'] > df['Fib_0_618']) & (df['EWO'] > df['EWO'].rolling(20).max() * 0.8)).astype(np.float32)
    except Exception: pass

    try:
        if 'Fractal_Bull' in df.columns and 'Fib_0_236' in df.columns:
            df['Conf_Fractal_ZigZag_Reversal'] = ((df['Fractal_Bull'] == 1) & (df['close'] < df['Fib_0_236'])).astype(np.float32)
    except Exception: pass

    # Convert all confluence columns to float32
    df[confluence_cols] = df[confluence_cols].fillna(0).astype(np.float32)
    return df
