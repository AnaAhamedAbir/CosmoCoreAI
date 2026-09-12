import sys
import os
import pandas as pd
import numpy as np

# Add backend to path
sys.path.append(os.path.abspath("C:/CosmoCoreAI/backend"))

try:
    from app.strategies.helpers.ict_po3_tracker import ICTPowerOfThree
    print("Successfully imported ICTPowerOfThree")
    
    # Create dummy data
    dates = pd.date_range("2023-01-01", periods=100, freq="1H")
    df = pd.DataFrame({
        "open": np.random.randn(100).cumsum() + 100,
        "high": np.random.randn(100).cumsum() + 102,
        "low": np.random.randn(100).cumsum() + 98,
        "close": np.random.randn(100).cumsum() + 101,
        "volume": np.random.randint(100, 1000, 100)
    }, index=dates)
    
    # Ensure high >= max(open, close) and low <= min(open, close)
    df['high'] = df[['open', 'close', 'high']].max(axis=1)
    df['low'] = df[['open', 'close', 'low']].min(axis=1)
    
    tracker = ICTPowerOfThree(atr_len=14)
    res = tracker.calculate(df)
    
    print("Calculation successful.")
    print("State:", res["state"])
    print("Signal:", res["signal"])
    print("Zones found:", len(res["zones"]))
    
except Exception as e:
    import traceback
    traceback.print_exc()
    sys.exit(1)
