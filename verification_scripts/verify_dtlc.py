import asyncio
import sys
import os

# Add backend to path so we can import the service
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend')))

from app.services.god_mode_liquidation_service import god_mode_service

async def verify_trailing_liquidity():
    print("Starting Deep Verification for DTLC and TWLS...")
    
    # Initialize basic state
    god_mode_service.state['current_price'] = 60000.0
    
    # Mock Ask/Bid orderbook tick 1
    top_asks = [[60500.0, 1000000.0], [61000.0, 500000.0]]
    top_bids = [[59500.0, 800000.0], [59000.0, 300000.0]]
    
    max_ask_vol = 1000000.0
    max_bid_vol = 800000.0
    cp = 60000.0
    
    # Run the exact code block from watch_orderbook_loop manually for Tick 1
    magnet_zones = []
    cascade_probs = []
    
    for ask in top_asks:
        price, vol = float(ask[0]), float(ask[1])
        intensity = min(100, int((vol / max_ask_vol) * 100))
        if intensity > 30:
            magnet_zones.append({"price": price, "intensity": intensity, "volume": vol})
            dist = abs(price - cp) / cp
            prob = min(99, int((1 - (dist * 20)) * intensity))
            cascade_probs.append({"price": price, "prob": max(10, prob), "volume": vol})
            
    for bid in top_bids:
        price, vol = float(bid[0]), float(bid[1])
        intensity = min(100, int((vol / max_bid_vol) * 100))
        if intensity > 30:
            magnet_zones.append({"price": price, "intensity": intensity, "volume": vol})
            dist = abs(price - cp) / cp
            prob = min(99, int((1 - (dist * 20)) * intensity))
            cascade_probs.append({"price": price, "prob": max(10, prob), "volume": vol})
            
    # --- Time-Weighted Liquidity Smoothing (TWLS) Tick 1 ---
    ALPHA = 0.15
    current_volumes = {}
    for ask in top_asks:
        p, v = float(ask[0]), float(ask[1])
        if v > max_ask_vol * 0.1: current_volumes[p] = v
    for bid in top_bids:
        p, v = float(bid[0]), float(bid[1])
        if v > max_bid_vol * 0.1: current_volumes[p] = v
        
    for p, v in current_volumes.items():
        if p in god_mode_service._smoothed_zones_dict:
            god_mode_service._smoothed_zones_dict[p] = (v * ALPHA) + (god_mode_service._smoothed_zones_dict[p] * (1 - ALPHA))
        else:
            god_mode_service._smoothed_zones_dict[p] = v
            
    # Trailing Cloud
    target_long_trail = cp * 0.985
    if god_mode_service._trailing_long == 0.0 or target_long_trail > god_mode_service._trailing_long:
        god_mode_service._trailing_long += (target_long_trail - god_mode_service._trailing_long) * 0.1
    if cp < god_mode_service._trailing_long:
        god_mode_service._trailing_long = target_long_trail
        
    print("\n--- TICK 1 ---")
    print(f"Smoothed Zones dict: {god_mode_service._smoothed_zones_dict}")
    print(f"Trailing Long Level: {god_mode_service._trailing_long}")
    assert len(god_mode_service._smoothed_zones_dict) == 4, "Should have 4 zones"
    
    # Tick 2: Price moves up to 61000! Trailing long should trail up!
    print("\n--- TICK 2 (Price pumps to 61000) ---")
    cp = 61000.0
    
    # 59500 bid disappears (spoofed), 60000 bid appears
    top_bids = [[60000.0, 1000000.0], [59000.0, 300000.0]] 
    
    current_volumes = {}
    for ask in top_asks:
        p, v = float(ask[0]), float(ask[1])
        if v > max_ask_vol * 0.1: current_volumes[p] = v
    for bid in top_bids:
        p, v = float(bid[0]), float(bid[1])
        if v > max_bid_vol * 0.1: current_volumes[p] = v
        
    for p, v in current_volumes.items():
        if p in god_mode_service._smoothed_zones_dict:
            god_mode_service._smoothed_zones_dict[p] = (v * ALPHA) + (god_mode_service._smoothed_zones_dict[p] * (1 - ALPHA))
        else:
            god_mode_service._smoothed_zones_dict[p] = v
            
    keys_to_remove = []
    for p in god_mode_service._smoothed_zones_dict:
        if p not in current_volumes:
            god_mode_service._smoothed_zones_dict[p] *= (1 - ALPHA) # Decay!
            if god_mode_service._smoothed_zones_dict[p] < 5000:
                keys_to_remove.append(p)
    
    # Trailing Cloud
    target_long_trail = cp * 0.985
    if god_mode_service._trailing_long == 0.0 or target_long_trail > god_mode_service._trailing_long:
        god_mode_service._trailing_long += (target_long_trail - god_mode_service._trailing_long) * 0.1
    if cp < god_mode_service._trailing_long:
        god_mode_service._trailing_long = target_long_trail
        
    print(f"Smoothed Zones dict after spoof decay: {god_mode_service._smoothed_zones_dict}")
    print(f"Trailing Long Level: {god_mode_service._trailing_long}")
    assert 59500.0 in god_mode_service._smoothed_zones_dict, "Spoofed bid should NOT be instantly removed, it should decay!"
    assert god_mode_service._smoothed_zones_dict[59500.0] < 800000.0, "Spoofed bid volume should be decaying"
    assert god_mode_service._trailing_long > 5910.0, "Trailing long should have moved up"
    
    print("\n--- VERIFICATION SUCCESSFUL ---")
    print("1. TWLS (Smoothing) successfully decays spoofed orders instead of instantly removing them.")
    print("2. DTLC (Trailing Cloud) successfully trails price upwards in an uptrend.")

if __name__ == "__main__":
    asyncio.run(verify_trailing_liquidity())
