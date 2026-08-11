import pandas as pd
import numpy as np
import sys
import os

# Add backend directory to sys.path so we can import app modules
sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))

from app.services.ml.forex_feature_engine import generate_ohlcv_features

def generate_mock_forex_data(rows=1000):
    np.random.seed(42)
    
    # Forex uses 'tick_volume' usually
    data = {
        'open': np.random.uniform(1.0500, 1.1500, rows),
        'high': np.random.uniform(1.0500, 1.1500, rows),
        'low': np.random.uniform(1.0500, 1.1500, rows),
        'close': np.random.uniform(1.0500, 1.1500, rows),
        'tick_volume': np.random.randint(100, 5000, rows),
    }
    
    df = pd.DataFrame(data)
    
    # Ensure high is max and low is min
    df['high'] = df[['open', 'high', 'low', 'close']].max(axis=1)
    df['low'] = df[['open', 'high', 'low', 'close']].min(axis=1)
    
    # Adding some fake trends so indicators don't just output NaN
    for i in range(1, rows):
        df.loc[i, 'close'] = df.loc[i-1, 'close'] + np.random.normal(0, 0.0010)
        df.loc[i, 'high'] = max(df.loc[i, 'open'], df.loc[i, 'close']) + abs(np.random.normal(0, 0.0005))
        df.loc[i, 'low'] = min(df.loc[i, 'open'], df.loc[i, 'close']) - abs(np.random.normal(0, 0.0005))
        
    return df

if __name__ == "__main__":
    print("Generating mock Forex OHLCV tick data...")
    df = generate_mock_forex_data()
    
    print(f"Initial shape: {df.shape}")
    print(f"Initial columns: {df.columns.tolist()}")
    
    selected_features = [
        'Advanced Trend & Momentum',
        'Advanced Volume & Flow',
        'Advanced Volatility & Risk',
        'Advanced Geometric Cycles',
        'Advanced Hedge Fund Confluence'
    ]
    
    print("\nRunning Forex Feature Engine with 5 Advanced Hedge Fund Modules...")
    
    # Run the engine
    df_processed = generate_ohlcv_features(df, selected_features)
    
    print(f"\nFinal shape: {df_processed.shape}")
    
    new_cols = [c for c in df_processed.columns if c not in ['open', 'high', 'low', 'close', 'tick_volume']]
    
    print(f"\nSuccessfully Generated {len(new_cols)} Advanced Features!")
    
    # Print categories of generated features to prove they exist
    print("\n[EVIDENCE] Sample of generated features:")
    print("Trend/Momentum:", [c for c in new_cols if 'ichimoku' in c.lower() or 'alligator' in c.lower()][:3])
    print("Volume/Flow:", [c for c in new_cols if 'volume' in c.lower() or 'force' in c.lower()][:3])
    print("Volatility/Risk:", [c for c in new_cols if 'delta' in c.lower() or 'gamma' in c.lower() or 'ulcer' in c.lower()][:3])
    print("Geometric/Cycles:", [c for c in new_cols if 'doji' in c.lower() or 'engulfing' in c.lower() or 'harmonic' in c.lower()][:3])
    print("Confluence Matrix:", [c for c in new_cols if 'conf_' in c.lower()][:5])
    
    # Verify tick_volume mapped to volume safely
    print(f"\nTick volume to Volume mapping successful: {'volume' in df_processed.columns}")
    
    print("\nSUCCESS: All Forex advanced features executed without errors!")
