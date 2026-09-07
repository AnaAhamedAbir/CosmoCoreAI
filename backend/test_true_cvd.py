import asyncio
import logging
import sys
import os

# Ensure app module is in path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.services.true_cvd_service import TrueCVDService

logging.basicConfig(level=logging.INFO)

async def main():
    print("Testing TrueCVDService...")
    
    # Create an instance with a very low threshold so it triggers easily during the test
    # e.g., $10 absorbed
    test_service = TrueCVDService(absorption_threshold_usd=10.0, time_window_sec=10)
    
    # Mock the callback
    async def mock_callback(payload):
        print("\n[CALLBACK TRIGGERED]")
        print(f"CVD: {payload['true_cvd']}")
        if payload.get("iceberg_event"):
            print("ICEBERG EVENT: ", payload["iceberg_event"])
            
    test_service.register_callback(mock_callback)
    
    # We will inject some fake trades to simulate an iceberg
    async def inject_fake_trades():
        await asyncio.sleep(2)
        print("Injecting fake trades...")
        import time
        now = time.time()
        # Price doesn't move much (0.01%), but large buy volume
        test_service._trade_history.extend([
            {"time": now, "side": "buy", "value": 5.0, "price": 60000.0},
            {"time": now+0.1, "side": "buy", "value": 6.0, "price": 60001.0},
        ])
        test_service._last_price = 60001.0
        test_service.current_cvd += 11.0
        
    print("Starting service logic loops...")
    test_service._running = True
    test_service.symbol = 'BTC/USDT'
    asyncio.create_task(test_service._analyze_absorption_loop())
    asyncio.create_task(inject_fake_trades())
    
    await asyncio.sleep(5)
    print("Stopping service...")
    await test_service.stop()
    print("Test finished.")

if __name__ == "__main__":
    asyncio.run(main())
