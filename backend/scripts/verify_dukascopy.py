import os
import sys
import pandas as pd
from datetime import datetime

# Insert backend directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from scripts.dukascopy_collector import fetch_dukascopy_hour

def test_dukascopy():
    symbol = "EURUSD"
    # Dukascopy data is available historically. Let's pick a known weekday in the past.
    # e.g., 2023-01-05 14:00 (A Thursday)
    test_date = datetime(2023, 1, 5, 14, 0, 0)
    
    print(f"Testing Dukascopy Fetch for {symbol} at {test_date.strftime('%Y-%m-%d %H:00')}...")
    
    df = fetch_dukascopy_hour(symbol, test_date)
    
    if df.empty:
        print("❌ FAILED: No data returned or failed to parse.")
        return
        
    print(f"✅ SUCCESS: Successfully fetched and parsed {len(df)} tick records for one hour.")
    print("-" * 50)
    print(df.head(10))
    print("-" * 50)
    print("Data Types:")
    print(df.dtypes)
    print("-" * 50)
    
    # Save a temporary parquet file to ensure it serializes properly
    temp_file = "test_dukascopy_snapshot.parquet"
    df.to_parquet(temp_file)
    print(f"✅ SUCCESS: Saved temporarily to {temp_file} (Size: {os.path.getsize(temp_file) / 1024:.2f} KB)")
    
    # Clean up
    if os.path.exists(temp_file):
        os.remove(temp_file)
        
if __name__ == "__main__":
    test_dukascopy()
