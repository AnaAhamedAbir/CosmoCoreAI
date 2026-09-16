import asyncio
import sys
import os

# Add backend to path so we can import app modules
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))

from app.services.smart_money_trajectory_service import SmartMoneyTrajectoryService

def run_tests():
    print("Initializing SmartMoneyTrajectoryService...")
    service = SmartMoneyTrajectoryService()
    
    current_price = 100000
    # Simulate Bids (Support) - heavy cluster at 98000
    bids = [
        [99900, 100], # Too close (noise, < 0.5% away from 100k, threshold is 99500)
        [98000, 50000], # Strong cluster
        [97500, 20000]
    ]
    # Simulate Asks (Resistance) - moderate cluster at 102000
    asks = [
        [100100, 100], # Too close (noise)
        [102000, 30000], # Moderate cluster
        [103000, 10000]
    ]
    
    print("\n--- Test 1: Noise Filter & Base Force Calculation (Neutral Funding) ---")
    trajectory = service.calculate_smart_trajectory(bids, asks, current_price, funding_rate=0.0)
    print(f"Result: Direction={trajectory['direction']}, Strength={trajectory['strength']}, Target={trajectory['target_price']}")
    
    # We expect DOWN because Bid Volume (50k+20k) is larger than Ask Volume (30k+10k) 
    # and they are roughly at similar distances. Wait, distance for 98k is 2%. For 102k is 2%.
    # Bid Force > Ask Force, so it should point DOWN.
    if trajectory['direction'] == 'DOWN':
        print("✅ Test 1 Passed (Downwards Magnetic Pull detected)")
    else:
        print("❌ Test 1 Failed")

    print("\n--- Test 2: Funding Rate Bias (Positive Funding / Long Bias) ---")
    # Positive funding means Retail is Long. Smart Money will dump (boost Bid force).
    # Since it was already DOWN, it should be STRONGER DOWN.
    trajectory = service.calculate_smart_trajectory(bids, asks, current_price, funding_rate=0.05)
    print(f"Result: Direction={trajectory['direction']}, Strength={trajectory['strength']}, Target={trajectory['target_price']}")
    if trajectory['direction'] == 'DOWN' and trajectory['strength'] > 0:
        print("✅ Test 2 Passed (Retail Long -> Smart Money Dump)")

    print("\n--- Test 3: Funding Rate Bias (Negative Funding / Short Bias) ---")
    service.reset()
    # Negative funding means Retail is Short. Smart Money will pump (boost Ask force).
    # Bid force was originally higher, but a 1.5x boost to Ask force might flip it or make it neutral.
    # Ask Force = 30k/0.02 = 1.5M * 1.5 = 2.25M. Bid Force = 50k/0.02 = 2.5M.
    # Let's make Asks stronger to see if it flips.
    strong_asks = [[102000, 45000]] # 45k at 2% = 2.25M Force * 1.5 = 3.375M Force
    trajectory = service.calculate_smart_trajectory(bids, strong_asks, current_price, funding_rate=-0.05)
    print(f"Result: Direction={trajectory['direction']}, Strength={trajectory['strength']}, Target={trajectory['target_price']}")
    if trajectory['direction'] == 'UP':
        print("✅ Test 3 Passed (Retail Short -> Smart Money Pump)")
        
    print("\n--- Test 4: Hysteresis Locking ---")
    # It is currently UP. Let's make it 50/50 exactly. It should STAY UP because of the 52% threshold!
    equal_bids = [[98000, 45000]]
    trajectory = service.calculate_smart_trajectory(equal_bids, strong_asks, current_price, funding_rate=0.0)
    print(f"Result: Direction={trajectory['direction']}, Strength={trajectory['strength']}, Target={trajectory['target_price']}")
    if trajectory['direction'] == 'UP':
        print("✅ Test 4 Passed (Hysteresis kept it UP despite 50/50 raw power)")
        
if __name__ == "__main__":
    run_tests()
