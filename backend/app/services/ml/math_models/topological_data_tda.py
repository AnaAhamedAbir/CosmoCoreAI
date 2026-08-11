import pandas as pd
import numpy as np

def generate_topological_data_tda_features(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Category 8: Topological Data Analysis (TDA) (Features 71-80)
    """
    if df.empty:
        return df
        
    df.columns = [str(c).lower() for c in df.columns]
    close = df['close']
    returns = close.pct_change().fillna(0)
    
    # 71. Betti Number 0 (Connected Components Proxy)
    if 'betti_number_0' in selected_features:
        # Proxy: Number of distinct price clusters (density) in a rolling window
        df['betti_number_0'] = close.rolling(20).apply(lambda x: len(np.unique(np.round(x, 2))) if len(x)>0 else 0, raw=False)
        
    # 72. Betti Number 1 (Holes/Cycles Proxy)
    if 'betti_number_1' in selected_features:
        # Proxy: Range-bound behavior vs trending
        # Higher when price crosses SMA frequently
        sma = close.rolling(20).mean()
        crosses = np.sign(close - sma).diff().abs() > 0
        df['betti_number_1'] = crosses.rolling(20).sum()
        
    # 73. Persistence Landscape Area
    if 'persistence_landscape_area' in selected_features:
        # Proxy: Area between Bollinger Bands
        upper = close.rolling(20).mean() + 2 * close.rolling(20).std()
        lower = close.rolling(20).mean() - 2 * close.rolling(20).std()
        df['persistence_landscape_area'] = upper - lower
        
    # 74. Persistence Bottleneck Distance Proxy
    if 'persistence_bottleneck_distance' in selected_features:
        # Proxy: Max deviation from the mean in a rolling window
        sma = close.rolling(20).mean()
        df['persistence_bottleneck_distance'] = abs(close - sma).rolling(20).max()
        
    # 75. Simplicial Complex Density Proxy
    if 'simplicial_complex_density' in selected_features:
        # Proxy: Ratio of ticks to price range (Liquidity density)
        tick_vol = df.get('tick_net_volume', pd.Series(1, index=df.index)).abs()
        rng = (df['high'] - df['low']) + 1e-8
        df['simplicial_complex_density'] = (tick_vol / rng).rolling(10).mean()
        
    # 76. Mapper Algorithm Graph Modularity Proxy
    if 'mapper_graph_modularity' in selected_features:
        # Proxy: Distinct volatility regimes co-occurring
        vol10 = returns.rolling(10).std()
        vol50 = returns.rolling(50).std()
        df['mapper_graph_modularity'] = abs(vol10 - vol50)
        
    # 77. Euler Characteristic Curve of Price
    if 'euler_characteristic_curve' in selected_features:
        # Proxy: Vertices - Edges + Faces (Peaks - Trends + Ranges)
        peaks = (df['high'] > df['high'].shift(1)) & (df['high'] > df['high'].shift(-1))
        df['euler_characteristic_curve'] = peaks.rolling(20).sum()
        
    # 78. Wasserstein Distance of Persistence Diagrams Proxy
    if 'wasserstein_distance_proxy' in selected_features:
        # Proxy: Earth Mover's Distance between recent returns and historical returns
        # Simplified as difference in means
        mu_recent = returns.rolling(10).mean()
        mu_hist = returns.rolling(50).mean()
        df['wasserstein_distance_proxy'] = abs(mu_recent - mu_hist)
        
    # 79. Topological Entropy Proxy
    if 'topological_entropy' in selected_features:
        # Proxy: Log of the number of unique price levels visited
        df['topological_entropy'] = df['betti_number_0'].apply(lambda x: np.log(x + 1e-8))
        
    # 80. Vietoris-Rips Complex Radius Proxy
    if 'vietoris_rips_radius' in selected_features:
        # Proxy: Minimum radius to encompass 90% of recent prices (Quantile range)
        q90 = close.rolling(20).quantile(0.95)
        q10 = close.rolling(20).quantile(0.05)
        df['vietoris_rips_radius'] = (q90 - q10) / 2
        
    return df
