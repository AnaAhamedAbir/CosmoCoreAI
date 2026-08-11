import pandas as pd
import numpy as np

def test_parser(input_csv_path):
    sample_df = pd.read_csv(input_csv_path, nrows=5)
    has_headers = False
    
    first_col = str(sample_df.columns[0]).lower()
    if 'sym' in first_col or 'time' in first_col or 'date' in first_col or 'ask' in first_col:
        has_headers = True
        
    chunk_size = 1000000 
    all_dfs = []
    
    if has_headers:
        chunk_iterator = pd.read_csv(input_csv_path, chunksize=chunk_size, low_memory=False)
    else:
        col_names = ['Symbol', 'Date', 'Time', 'Bid', 'Ask', 'BidVolume', 'AskVolume']
        if len(sample_df.columns) == 6:
            col_names = ['Date', 'Time', 'Bid', 'Ask', 'BidVolume', 'AskVolume']
            
        chunk_iterator = pd.read_csv(input_csv_path, chunksize=chunk_size, names=col_names, low_memory=False)
        
    for idx, chunk in enumerate(chunk_iterator):
        chunk.columns = [str(c).lower().strip() for c in chunk.columns]
        
        print("Columns after lower:", chunk.columns)
        
        if 'time' not in chunk.columns and 'date' in chunk.columns:
            chunk.rename(columns={'date': 'time'}, inplace=True)
        elif 'date' in chunk.columns and 'time' in chunk.columns:
            print("Before datetime parsing:", chunk[['date', 'time']].head())
            chunk['time'] = pd.to_datetime(chunk['date'].astype(str) + ' ' + chunk['time'].astype(str), format='mixed', errors='coerce')
            print("After datetime parsing:", chunk['time'].head())
            chunk.drop(columns=['date'], inplace=True)
        elif 'timestamp' in chunk.columns:
            chunk.rename(columns={'timestamp': 'time'}, inplace=True)
            
        if 'time' in chunk.columns and not pd.api.types.is_datetime64_any_dtype(chunk['time']):
            chunk['time'] = pd.to_datetime(chunk['time'], format='mixed', errors='coerce')
            
        rename_map = {}
        for col in chunk.columns:
            if 'bidvolume' in col or 'bid_volume' in col or 'bid vol' in col:
                rename_map[col] = 'bid_volume'
            elif 'askvolume' in col or 'ask_volume' in col or 'ask vol' in col:
                rename_map[col] = 'ask_volume'
            elif 'bid' in col and 'volume' not in col:
                rename_map[col] = 'bid'
            elif 'ask' in col and 'volume' not in col:
                rename_map[col] = 'ask'
                
        chunk.rename(columns=rename_map, inplace=True)
        print("After rename map:", chunk.columns)
        
        keep_cols = ['time', 'bid', 'ask']
        if 'bid_volume' in chunk.columns: keep_cols.append('bid_volume')
        if 'ask_volume' in chunk.columns: keep_cols.append('ask_volume')
        
        available_cols = [c for c in keep_cols if c in chunk.columns]
        chunk = chunk[available_cols]
        
        print("Before dropna length:", len(chunk))
        chunk = chunk.dropna(subset=['time', 'bid', 'ask'])
        print("After dropna length:", len(chunk))
        print(chunk.head())
        
        all_dfs.append(chunk)
        
    final_df = pd.concat(all_dfs, ignore_index=True)
    print("Final DataFrame length:", len(final_df))

test_parser("mock_tickstory.csv")
