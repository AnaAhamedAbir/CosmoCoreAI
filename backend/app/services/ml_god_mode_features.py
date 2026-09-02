import pandas as pd
import numpy as np

def calculate_god_mode_ml_features(bids: list, asks: list, current_price: float) -> dict:
    """
    Calculates God Mode ML features from raw L2 depth arrays.
    bids/asks format: [[price, size], [price, size], ...]
    Returns a dictionary of features.
    """
    features = {
        "magnet_intensity_above": 0.0,
        "magnet_distance_above": 0.0,
        "magnet_intensity_below": 0.0,
        "magnet_distance_below": 0.0,
        "cascade_prob_above": 0.0,
        "cascade_prob_below": 0.0,
        "cvd_spoof_state": 0.0,
    }

    if not bids or not asks or current_price <= 0:
        return features

    try:
        # Global max volume for spoof comparison
        top_asks = asks[:50]
        top_bids = bids[:50]
        
        max_ask_vol = max(top_asks, key=lambda x: float(x[1]))[1] if top_asks else 1
        max_ask_vol = float(max_ask_vol)
        
        max_bid_vol = max(top_bids, key=lambda x: float(x[1]))[1] if top_bids else 1
        max_bid_vol = float(max_bid_vol)
        
        global_max_vol = max(max_ask_vol, max_bid_vol, 1.0)
        
        # Process Asks (Above Price - Short Liquidations)
        
        strongest_ask_intensity = 0.0
        strongest_ask_dist = 0.0
        strongest_ask_cascade = 0.0

        for ask in top_asks:
            price, vol = float(ask[0]), float(ask[1])
            intensity = min(100.0, (vol / max_ask_vol) * 100.0)
            if intensity > 30:
                dist = abs(price - current_price) / current_price
                prob = min(99.0, max(10.0, (1 - (dist * 20)) * intensity))
                
                if intensity > strongest_ask_intensity:
                    strongest_ask_intensity = intensity
                    strongest_ask_dist = dist * 100 # In percentage
                
                if prob > strongest_ask_cascade:
                    strongest_ask_cascade = prob

        features["magnet_intensity_above"] = strongest_ask_intensity
        features["magnet_distance_above"] = strongest_ask_dist
        features["cascade_prob_above"] = strongest_ask_cascade

        # Process Bids (Below Price - Long Liquidations)
        top_bids = bids[:50]
        max_bid_vol = max(top_bids, key=lambda x: float(x[1]))[1] if top_bids else 1
        max_bid_vol = float(max_bid_vol)

        strongest_bid_intensity = 0.0
        strongest_bid_dist = 0.0
        strongest_bid_cascade = 0.0

        for bid in top_bids:
            price, vol = float(bid[0]), float(bid[1])
            intensity = min(100.0, (vol / max_bid_vol) * 100.0)
            if intensity > 30:
                dist = abs(price - current_price) / current_price
                prob = min(99.0, max(10.0, (1 - (dist * 20)) * intensity))
                
                if intensity > strongest_bid_intensity:
                    strongest_bid_intensity = intensity
                    strongest_bid_dist = dist * 100 # In percentage
                
                if prob > strongest_bid_cascade:
                    strongest_bid_cascade = prob

        features["magnet_intensity_below"] = strongest_bid_intensity
        features["magnet_distance_below"] = strongest_bid_dist
        features["cascade_prob_below"] = strongest_bid_cascade

        # Simple CVD Spoof Logic (Delta of intensities based on global volume)
        # Re-calculate absolute intensity vs global max to compare them fairly
        abs_intensity_above = (max_ask_vol / global_max_vol) * 100.0
        abs_intensity_below = (max_bid_vol / global_max_vol) * 100.0
        
        intensity_delta = abs_intensity_above - abs_intensity_below
        if intensity_delta > 40:
            features["cvd_spoof_state"] = -1.0 # Negative spoof (fake wall above)
        elif intensity_delta < -40:
            features["cvd_spoof_state"] = 1.0 # Positive spoof (fake wall below)
        else:
            features["cvd_spoof_state"] = 0.0

    except Exception as e:
        # Failsafe if payload is malformed
        pass

    return features

def apply_god_mode_features_to_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """
    Given a DataFrame of L2 rows (with 'bids' and 'asks' columns), 
    calculates God Mode features and appends them to the dataframe.
    """
    if 'bids' not in df.columns or 'asks' not in df.columns:
        return df
        
    features_list = []
    
    for idx, row in df.iterrows():
        bids = row.get('bids', [])
        asks = row.get('asks', [])
        
        current_price = row.get('Close')
        if pd.isna(current_price) and 'microprice' in row:
            current_price = row['microprice']
        if pd.isna(current_price):
            current_price = 0.0
            
        feat = calculate_god_mode_ml_features(bids, asks, current_price)
        features_list.append(feat)
        
    features_df = pd.DataFrame(features_list, index=df.index)
    
    for col in features_df.columns:
        df[col] = features_df[col]
        
    return df
