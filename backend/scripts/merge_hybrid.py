import os
import pandas as pd
import numpy as np
from datetime import datetime
import time

def merge_hybrid_dataset(job_id: str, symbol: str, ohlcv_file: str, tick_file: str, strategy: str):
    import sys
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
    from app.db.session import SessionLocal
    from app.models.model_training import ModelTrainingJob
    
    db = SessionLocal()
    job = db.query(ModelTrainingJob).filter_by(id=job_id).first()
    
    if not job:
        print(f"Job {job_id} not found.")
        return

    def _log(msg: str):
        print(msg)
        ts = time.strftime("%H:%M:%S")
        logs = list(job.logs) if job.logs else []
        logs.append(f"[{ts}] [Hybrid Merge] {msg}")
        job.logs = logs
        db.commit()

    try:
        _log(f"Starting Hybrid Merge for {symbol}")
        _log(f"Strategy: {strategy}")
        _log(f"OHLCV File: {ohlcv_file}")
        _log(f"Tick File: {tick_file}")
        
        base_dir = os.path.join(os.getcwd(), "data", "raw", "forex_snapshots")
        ohlcv_path = os.path.join(base_dir, ohlcv_file)
        tick_path = os.path.join(base_dir, tick_file)
        
        if not os.path.exists(ohlcv_path) or not os.path.exists(tick_path):
            raise FileNotFoundError("One or both dataset files not found in forex_snapshots directory.")
            
        _log("Loading OHLCV Parquet file...")
        df_ohlcv = pd.read_parquet(ohlcv_path)
        
        _log("Loading Tick Parquet file (This might take a while)...")
        df_tick = pd.read_parquet(tick_path)
        
        # Ensure 'time' columns are datetime
        if 'time' in df_ohlcv.columns:
            df_ohlcv['time'] = pd.to_datetime(df_ohlcv['time'])
        elif df_ohlcv.index.name == 'time' or isinstance(df_ohlcv.index, pd.DatetimeIndex):
            df_ohlcv = df_ohlcv.reset_index()
            if 'time' not in df_ohlcv.columns and 'index' in df_ohlcv.columns:
                df_ohlcv = df_ohlcv.rename(columns={'index': 'time'})
                
        if 'time' in df_tick.columns:
            df_tick['time'] = pd.to_datetime(df_tick['time'])
        elif df_tick.index.name == 'time' or isinstance(df_tick.index, pd.DatetimeIndex):
            df_tick = df_tick.reset_index()
            if 'time' not in df_tick.columns and 'index' in df_tick.columns:
                df_tick = df_tick.rename(columns={'index': 'time'})
                
        df_ohlcv = df_ohlcv.sort_values('time')
        df_tick = df_tick.sort_values('time')
        
        _log(f"Loaded {len(df_ohlcv)} OHLCV rows and {len(df_tick)} Tick rows.")
        _log("Applying Binning Strategy...")
        
        # Add basic tick features if not present
        # tickstory_parser outputs lowercase columns: 'bid', 'ask'
        if 'bid' in df_tick.columns and 'ask' in df_tick.columns:
            df_tick['Mid'] = (df_tick['bid'] + df_tick['ask']) / 2
            df_tick['Spread'] = df_tick['ask'] - df_tick['bid']
        elif 'Bid' in df_tick.columns and 'Ask' in df_tick.columns:
            df_tick['Mid'] = (df_tick['Bid'] + df_tick['Ask']) / 2
            df_tick['Spread'] = df_tick['Ask'] - df_tick['Bid']
        elif 'mid' in df_tick.columns:
            df_tick['Mid'] = df_tick['mid']
        elif 'close' in df_tick.columns:
            df_tick['Mid'] = df_tick['close']
            
        # Clean Timezones
        if df_ohlcv['time'].dt.tz is not None:
            df_ohlcv['time'] = df_ohlcv['time'].dt.tz_localize(None)
        if df_tick['time'].dt.tz is not None:
            df_tick['time'] = df_tick['time'].dt.tz_localize(None)
            
        # --- Calculate Universal Tick Features for the ML Engine ---
        _log("Calculating Universal Tick Features (Order Flow & Volatility)...")
        from hybrid_tick_calculator import calculate_tick_micro_features
        df_tick = calculate_tick_micro_features(df_tick)
        
        # Resample all these universal features to 5s so they can be merged to OHLCV regardless of the chosen core binning strategy
        df_tick.set_index('time', inplace=True)
        universal_agg = df_tick.resample('5s').agg({
            'buy_sell_ratio': 'mean',
            'vol_imbalance': 'mean',
            'trade_sign': 'sum',
            'order_flow_toxicity': 'mean',
            'realized_vol': 'sum',
            'price_accel': 'mean',
            'micro_rsi': 'mean',
            'jump_intensity': 'sum',
            'path_variation': 'sum',
            'bid_ask_bounce': 'mean',
            'net_tick_volume': 'sum',
            'Mid': 'count'
        })
        universal_agg.columns = [
            'tick_buy_sell_ratio',
            'tick_volume_imbalance',
            'tick_trade_sign',
            'tick_order_flow_toxicity',
            'tick_realized_vol',
            'tick_price_acceleration',
            'tick_micro_rsi',
            'tick_jump_intensity',
            'tick_path_variation',
            'tick_bid_ask_bounce',
            'tick_net_volume',
            'tick_count'
        ]
        universal_agg = universal_agg.reset_index()
        
        df_tick = df_tick.reset_index() # Reset index before strategy specific stuff
        
        if strategy == "time_based_5s":
            df_tick.set_index('time', inplace=True)
            agg_funcs = {
                'Mid': ['count', 'std'],
                'Spread': 'mean' if 'Spread' in df_tick.columns else lambda x: np.nan
            }
            if 'bid_volume' in df_tick.columns and 'ask_volume' in df_tick.columns:
                df_tick['ofi'] = df_tick['bid_volume'] - df_tick['ask_volume']
                agg_funcs['ofi'] = 'sum'
                
            tick_agg = df_tick.resample('5s').agg(agg_funcs)
            # Flatten columns
            if 'ofi' in agg_funcs:
                tick_agg.columns = ['strategy_tick_count', 'tick_volatility', 'tick_spread', 'tick_ofi_sum']
            else:
                tick_agg.columns = ['strategy_tick_count', 'tick_volatility', 'tick_spread']
            
            tick_agg = tick_agg.reset_index()
            _log("Merging Time-based features with OHLCV...")
            df_merged = pd.merge_asof(df_ohlcv, tick_agg, on='time', direction='backward')
            
        elif strategy == "volume_based":
            # True Volume-based grouping (using cumulative volume if available, else count)
            if 'bid_volume' in df_tick.columns and 'ask_volume' in df_tick.columns:
                df_tick['total_vol'] = df_tick['bid_volume'] + df_tick['ask_volume']
            else:
                df_tick['total_vol'] = 1  # Fallback to count
                
            # Group by every N volume units
            N_VOL = 1000
            df_tick['cum_vol'] = df_tick['total_vol'].cumsum()
            df_tick['tick_group'] = (df_tick['cum_vol'] // N_VOL).astype(int)
            
            grp = df_tick.groupby('tick_group')
            vol_agg = pd.DataFrame({
                'time': grp['time'].last(),
                'tick_volume_block_duration': (grp['time'].last() - grp['time'].first()).dt.total_seconds(),
                'tick_block_volatility': grp['Mid'].std(),
                'tick_block_spread': grp['Spread'].mean() if 'Spread' in df_tick.columns else np.nan
            })
            
            _log("Merging Volume-based features with OHLCV...")
            df_merged = pd.merge_asof(df_ohlcv, vol_agg.dropna(subset=['time']), on='time', direction='backward')
            
        elif strategy == "event_based":
            # Order flow imbalance proxy: large OFI or large price jumps
            if 'bid_volume' in df_tick.columns and 'ask_volume' in df_tick.columns:
                df_tick['ofi'] = df_tick['bid_volume'] - df_tick['ask_volume']
                threshold = df_tick['ofi'].std() * 2
                events = df_tick[df_tick['ofi'].abs() > threshold].copy()
            else:
                df_tick['price_change'] = df_tick['Mid'].diff()
                threshold = df_tick['price_change'].std() * 3
                events = df_tick[df_tick['price_change'].abs() > threshold].copy()
                
            events.set_index('time', inplace=True)
            # Count events in 5s windows
            event_agg = events.resample('5s').size().reset_index(name='tick_imbalance_events')
            
            _log("Merging Event-based features with OHLCV...")
            df_merged = pd.merge_asof(df_ohlcv, event_agg, on='time', direction='backward')
            
        elif strategy == "microstructure":
            # Jump intensity and bid-ask bounce
            df_tick.set_index('time', inplace=True)
            
            def path_variation(x):
                return np.sum(np.abs(np.diff(x))) if len(x) > 1 else 0
                
            agg_dict = {
                'Mid': [path_variation, 'std'],
                'Spread': ['min', 'max'] if 'Spread' in df_tick.columns else [lambda x: np.nan, lambda x: np.nan]
            }
            if 'bid_volume' in df_tick.columns and 'ask_volume' in df_tick.columns:
                df_tick['vol_imbalance'] = (df_tick['bid_volume'] - df_tick['ask_volume']) / (df_tick['bid_volume'] + df_tick['ask_volume'] + 1e-8)
                agg_dict['vol_imbalance'] = 'mean'
                
            micro_agg = df_tick.resample('5s').agg(agg_dict)
            
            # Flatten columns
            cols = ['tick_path_variation', 'tick_mid_std', 'tick_min_spread', 'tick_max_spread']
            if 'vol_imbalance' in agg_dict:
                cols.append('tick_vol_imbalance')
            micro_agg.columns = cols
            micro_agg = micro_agg.reset_index()
            
            _log("Merging Microstructure features with OHLCV...")
            df_merged = pd.merge_asof(df_ohlcv, micro_agg, on='time', direction='backward')
            
        else:
            _log(f"Unknown strategy {strategy}, defaulting to simple time-based merge.")
            df_merged = pd.merge_asof(df_ohlcv, df_tick[['time', 'Mid']], on='time', direction='backward')
            
        # Finally, append the universal features
        _log("Appending Universal Tick Features to merged dataset...")
        df_merged = pd.merge_asof(df_merged.sort_values('time'), universal_agg.sort_values('time'), on='time', direction='backward')
        
        # Fill NAs
        _log("Cleaning up merged data...")
        # fillna(method='ffill') is deprecated in newer pandas, using ffill()
        df_merged = df_merged.ffill()
        df_merged.fillna(0, inplace=True)
        
        clean_symbol = symbol.replace("/", "_").upper()
        timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        output_filename = f"HYBRID_{clean_symbol}_{strategy.upper()}_{timestamp_str}.parquet"
        output_path = os.path.join(base_dir, output_filename)
        
        _log(f"Saving merged dataset to {output_filename} ...")
        df_merged.to_parquet(output_path, index=False)
        
        job.status = "COMPLETED"
        _log("✅ Dataset merge completed successfully!")
        return {"status": "success", "file": output_filename}
        
    except Exception as e:
        job.status = "FAILED"
        _log(f"❌ Error during merge: {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        db.commit()
        db.close()

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--job_id", required=True)
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--ohlcv_file", required=True)
    parser.add_argument("--tick_file", required=True)
    parser.add_argument("--strategy", required=True)
    args = parser.parse_args()
    
    merge_hybrid_dataset(args.job_id, args.symbol, args.ohlcv_file, args.tick_file, args.strategy)
