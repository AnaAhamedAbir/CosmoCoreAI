import asyncio
import sys
import os

# Ensure backend directory is in python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.strategies.helpers.ml_l2_predictor import MLL2Predictor

async def main():
    print("🚀 Initializing MLL2Predictor...")
    model_id = "job_train_1780830859932"
    predictor = MLL2Predictor(model_id)
    
    if not predictor.is_loaded:
        print("❌ Failed to load model. Is the ID correct and model exists in DB/uploads?")
        return
        
    print(f"✅ Model loaded successfully. Feature count: {len(predictor.model_features)}")
    
    # Mock an orderbook
    dummy_ob = {
        'bids': [[65000.0, 1.5], [64999.0, 2.0], [64998.0, 5.0]],
        'asks': [[65001.0, 1.0], [65002.0, 3.0], [65003.0, 2.5]]
    }
    
    # First prediction (Without background engine, should zero pad)
    print("\n--- Test 1: Prediction WITHOUT Background Engine ---")
    pred1 = predictor.predict(dummy_ob, 65000.0, "buy")
    print(f"Result 1 (Zero-padded): {pred1}")
    
    # Now start background engine
    print("\n--- Test 2: Starting Background Engine ---")
    await predictor.start_background_engine("BTC/USDT")
    
    if not predictor.bg_engine:
        print("❌ Background engine failed to start or was skipped.")
        return
        
    print("⏳ Waiting 4 seconds for Background Engine to fetch trades and calculate 72 features...")
    await asyncio.sleep(4.0)
    
    bg_features = predictor.bg_engine.get_latest_features()
    print(f"✅ Background Engine produced {len(bg_features)} features.")
    
    # Check a few specific complex features to prove it works
    sample_feats = {k: bg_features[k] for k in list(bg_features.keys())[:5]}
    print(f"Sample Features: {sample_feats}")
    if 'cvd' in bg_features:
        print(f"CVD: {bg_features.get('cvd')}")
        
    # Second prediction (With background engine)
    print("\n--- Test 3: Prediction WITH Background Engine ---")
    pred2 = predictor.predict(dummy_ob, 65000.0, "buy")
    print(f"Result 2 (Full Features): {pred2}")
    
    await predictor.stop_background_engine()
    print("🛑 Background Engine stopped.")

if __name__ == "__main__":
    asyncio.run(main())
