import pandas as pd
import numpy as np

def generate_graph_network_features(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Category 11: Graph Theory & Network Analysis (Cross-Asset Proxies) (Features 101-110)
    """
    if df.empty:
        return df
        
    df.columns = [str(c).lower() for c in df.columns]
    close = df['close']
    returns = close.pct_change().fillna(0)
    tick_vol = df.get('tick_net_volume', pd.Series(1, index=df.index)).abs()
    
    # 101. Eigenvector Centrality of USD (Proxy)
    if 'eigenvector_centrality_usd' in selected_features:
        # Proxy: Volatility interaction over different timeframes (simulating network edges)
        df['eigenvector_centrality_usd'] = returns.rolling(10).std() + returns.rolling(50).std()
        
    # 102. Network Clustering Coefficient (Proxy)
    if 'network_clustering_coef' in selected_features:
        # Proxy: Do multiple lags of returns move in the same direction?
        dir1 = np.sign(returns)
        dir2 = np.sign(returns.shift(1))
        dir3 = np.sign(returns.shift(2))
        cluster = (dir1 == dir2) & (dir2 == dir3)
        df['network_clustering_coef'] = cluster.rolling(20).mean()
        
    # 103. Minimum Spanning Tree (MST) Length
    if 'mst_length' in selected_features:
        # Proxy: Path length of price vs net displacement
        path_length = abs(returns).rolling(20).sum()
        net_dist = abs(close.diff(20)) / (close.shift(20) + 1e-8)
        df['mst_length'] = path_length / (net_dist + 1e-8)
        
    # 104. PageRank of Currency Flows
    if 'pagerank_currency_flows' in selected_features:
        # Proxy: Cumulative tick volume weighted by return direction
        flow = returns * tick_vol
        df['pagerank_currency_flows'] = flow.rolling(100).sum()
        
    # 105. Granger Causality (Proxy)
    if 'granger_causality_proxy' in selected_features:
        # Proxy: Does volume lead price?
        df['granger_causality_proxy'] = returns.rolling(20).corr(tick_vol.shift(1)).fillna(0)
        
    # 106. Dynamic Conditional Correlation (DCC-GARCH Proxy)
    if 'dcc_garch_proxy' in selected_features:
        # Proxy: Rolling correlation between absolute returns and volume
        df['dcc_garch_proxy'] = abs(returns).rolling(20).corr(tick_vol).fillna(0)
        
    # 107. Cross-Correlation Asymmetry
    if 'cross_correlation_asymmetry' in selected_features:
        # Proxy: Difference in volume correlation during up-days vs down-days
        up_corr = returns[returns > 0].rolling(20).corr(tick_vol).reindex(df.index).ffill()
        down_corr = returns[returns < 0].rolling(20).corr(tick_vol).reindex(df.index).ffill()
        df['cross_correlation_asymmetry'] = (up_corr - down_corr).fillna(0)
        
    # 108. Network Density
    if 'network_density' in selected_features:
        # Proxy: How many different lags (1-5) are strongly correlated with current return
        corrs = [abs(returns.rolling(20).corr(returns.shift(i))) > 0.5 for i in range(1, 6)]
        df['network_density'] = sum(corrs) / 5.0
        
    # 109. Assortativity Coefficient
    if 'assortativity_coefficient' in selected_features:
        # Proxy: Do high volume nodes connect to high volume nodes? (Autocorrelation of volume)
        df['assortativity_coefficient'] = tick_vol.rolling(20).apply(lambda x: pd.Series(x).autocorr(lag=1) if len(x)>1 else 0, raw=False).fillna(0)
        
    # 110. Modularity Class
    if 'modularity_class' in selected_features:
        # Proxy: Volatility regime clustering (0=Low, 1=Medium, 2=High)
        vol = returns.rolling(20).std()
        q33 = vol.rolling(100).quantile(0.33)
        q66 = vol.rolling(100).quantile(0.66)
        df['modularity_class'] = np.where(vol < q33, 0, np.where(vol > q66, 2, 1))
        
    return df
