import asyncio
import sys
import os
from app.db.session import SessionLocal
from app.models.ml_model import CustomMLModel
from app.strategies.helpers.ml_l2_predictor import MLL2Predictor

async def main():
    db = SessionLocal()
    model = db.query(CustomMLModel).first()
    if not model:
        print('No models in DB')
        return
    model_id = str(model.id)
    print(f'🚀 Initializing MLL2Predictor with model {model_id}...')
    
    predictor = MLL2Predictor(model_id)
    
    if not predictor.is_loaded:
        print('❌ Failed to load model.')
        return
        
    print(f'✅ Model loaded successfully. Feature count: {len(predictor.model_features)}')
    
    dummy_ob = {
        'bids': [[65000.0, 1.5], [64999.0, 2.0], [64998.0, 5.0]],
        'asks': [[65001.0, 1.0], [65002.0, 3.0], [65003.0, 2.5]]
    }
    
    print('\n--- Test 1: Prediction WITHOUT Background Engine ---')
    pred1 = predictor.predict(dummy_ob, 65000.0, 'buy')
    print(f'Result 1: {pred1}')
    
    print('\n--- Test 2: Starting Background Engine ---')
    await predictor.start_background_engine('BTC/USDT')
    
    if not predictor.bg_engine:
        print('❌ Background engine failed to start or was skipped.')
        return
        
    print('⏳ Waiting 4 seconds for Background Engine to fetch trades and calculate features...')
    await asyncio.sleep(4.0)
    
    bg_features = predictor.bg_engine.get_latest_features()
    print(f'✅ Background Engine produced {len(bg_features)} features.')
    
    sample_feats = {k: bg_features[k] for k in list(bg_features.keys())[:5]}
    print(f'Sample Features: {sample_feats}')
        
    print('\n--- Test 3: Prediction WITH Background Engine ---')
    pred2 = predictor.predict(dummy_ob, 65000.0, 'buy')
    print(f'Result 2: {pred2}')
    
    await predictor.stop_background_engine()
    print('🛑 Background Engine stopped.')

if __name__ == '__main__':
    asyncio.run(main())
