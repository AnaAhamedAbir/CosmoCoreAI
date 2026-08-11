import asyncio
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__))))

from app.services.ml_predictor import _fetch_live_ohlcv
from app.services.market_depth_service import MarketDepthService

async def test_oanda():
    symbol = "EUR/USD"
    timeframe = "1h"
    dataset_type = "forex"
    
    print(f"Testing _fetch_live_ohlcv for {symbol} with dataset_type={dataset_type}...")
    
    try:
        df = _fetch_live_ohlcv(symbol, timeframe, dataset_type)
        if df is not None and not df.empty:
            print("Successfully fetched DataFrame!")
            print(df.head())
            print(f"Shape: {df.shape}")
        else:
            print("Failed to fetch DataFrame. Returned None or empty.")
    except Exception as e:
        print(f"Exception during fetch: {e}")

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    print("OANDA_ACCOUNT_ID:", os.getenv("OANDA_ACCOUNT_ID"))
    asyncio.run(test_oanda())

