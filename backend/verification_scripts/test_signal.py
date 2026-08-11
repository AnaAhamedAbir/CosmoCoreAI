import sys
import os

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), 'backend')))

from app.db.session import SessionLocal
import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), 'backend')))

from app.services.ml_predictor import _fetch_live_ohlcv

def test_oanda_predict():
    try:
        print("Testing _fetch_live_ohlcv directly for EUR_USD...")
        df = _fetch_live_ohlcv("EUR_USD", "1h", "forex")
        if df is not None and not df.empty:
            print("Successfully fetched OANDA data!")
            print(df.tail(2))
        else:
            print("Failed to fetch OANDA data.")
    except Exception as e:
        print(f"Error testing prediction: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    test_oanda_predict()

if __name__ == '__main__':
    test_oanda_predict()
