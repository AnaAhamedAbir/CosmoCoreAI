import pandas as pd
import gc
from typing import List
from app.services.ml.forex_plp_liquidity_cluster import generate_plp_liquidity_cluster_features
from app.services.ml.forex_plp_cascade_dynamics import generate_plp_cascade_features
from app.services.ml.forex_plp_stop_hunt import generate_plp_stop_hunt_features

def inject_plp_features(df: pd.DataFrame, selected_features: List[str]) -> pd.DataFrame:
    """Main entry point for all 51 PLP features (Modular)."""
    df = df.copy()
    
    # Delegate to the 3 separate files for true modularity
    df = generate_plp_liquidity_cluster_features(df, selected_features)
    gc.collect()
    df = generate_plp_cascade_features(df, selected_features)
    gc.collect()
    df = generate_plp_stop_hunt_features(df, selected_features)
    gc.collect()
    
    return df
