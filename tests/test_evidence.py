import pandas as pd
import numpy as np
import sys
sys.path.append(r'e:\CosmoQuantAI\backend')

from app.services.feature_engines.trend_momentum import add_trend_momentum_features
from app.services.feature_engines.volume_flow import add_volume_flow_features
from app.services.feature_engines.volatility_risk import add_volatility_risk_features
from app.services.feature_engines.geometric_cycles import add_geometric_cycle_features
from app.services.feature_engines.confluence_matrix import add_confluence_features

def run_test():
    print("Generating Mock OHLCV Data (500 rows)...")
    np.random.seed(42)
    dates = pd.date_range("2026-01-01", periods=500, freq="1min")
    df = pd.DataFrame({
        'open': np.random.uniform(50000, 51000, 500),
        'high': np.random.uniform(51000, 51500, 500),
        'low': np.random.uniform(49500, 50000, 500),
        'close': np.random.uniform(50000, 51000, 500),
        'volume': np.random.uniform(1, 100, 500)
    }, index=dates)

    # Mock baseline indicator columns so confluence logic triggers
    df['SMA_20'] = df['close'].rolling(20).mean()
    df['RSI_14'] = df['close'].rolling(14).mean()
    df['EMA_50'] = df['close'].rolling(50).mean()
    df['MACD_12_26_9'] = df['close'].rolling(12).mean() - df['close'].rolling(26).mean()
    df['MACDs_12_26_9'] = df['MACD_12_26_9'].rolling(9).mean()
    df['BBL_20_2.0'] = df['close'].rolling(20).mean() - df['close'].rolling(20).std()
    df['ADX_14'] = 30.0
    df['PSARl_0.02_0.2'] = df['close'] - 100
    df['STOCHk_14_3_3'] = 15.0
    df['SUPERTd_7_3.0'] = 1.0
    df['CCI_14_0.015'] = -150.0
    df['VP_Rolling_HVN_Proxy_50'] = df['close'] - 5
    df['Fib_0_618'] = 50500.0
    df['Fib_0_236'] = 50200.0
    df['LinReg_Lower'] = df['close'] - 50
    df['STD_DEV_20'] = df['close'].rolling(20).std()
    df['DCL_20_20'] = df['close']
    df['Vol_Osc_14_28'] = 10.0
    df['ROC_10'] = 5.0
    df['VTXP_14'] = 1.0
    df['VTXM_14'] = 0.8
    df['OBV'] = df['volume'].cumsum()
    df['MFI_14'] = 60.0
    df['CMF_20'] = 0.5
    df['EOM_14_100000000'] = 5.0
    df['Force_Index_13'] = 1000.0
    df['NVI_1'] = 100.0
    df['PVI_1'] = 50.0
    df['KCUe_20_2'] = df['close'] - 20
    df['EWO'] = 5.0
    df['Fractal_Bull'] = 1.0

    print("Running Trend & Momentum Engine...")
    df = add_trend_momentum_features(df)
    
    print("Running Volume & Flow Engine...")
    df = add_volume_flow_features(df)
    
    print("Running Volatility & Risk Engine...")
    df = add_volatility_risk_features(df)
    
    print("Running Geometric Cycles Engine...")
    df = add_geometric_cycle_features(df)
    
    print("Running Confluence Matrix Engine...")
    df = add_confluence_features(df)

    print("\n" + "="*40)
    print("            EVIDENCE REPORT")
    print("="*40)
    print(f"Total Rows Processed: {len(df)}")
    print(f"Total Columns Generated: {len(df.columns)}")
    
    print("\n[+] Trend & Momentum Check (Alligator & CRSI included):")
    print([c for c in df.columns if 'Alligator' in c or 'CRSI' in c])
    
    print("\n[+] Geometric Check (Candles, H&S, Harmonic):")
    print([c for c in df.columns if 'CDL' in c or 'Harmonic' in c or 'Head_Shoulders' in c])
    
    print("\n[+] Volatility Check (Options Greeks):")
    print([c for c in df.columns if 'Options' in c])
    
    confluence_cols = [c for c in df.columns if c.startswith('Conf_')]
    print(f"\n[+] Confluence Matrix Check (Found {len(confluence_cols)} rules):")
    for c in confluence_cols:
        print(f"   - {c}")

    print("\n[+] RAM Efficiency Check:")
    float32_count = sum(df.dtypes == np.float32)
    print(f"   - Number of float32 columns: {float32_count} / {len(df.columns)}")
    print("="*40)

if __name__ == '__main__':
    run_test()
