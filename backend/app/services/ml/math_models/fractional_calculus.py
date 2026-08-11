import pandas as pd
import numpy as np

def generate_fractional_calculus_features(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Category 7: Fractional Calculus & Memory Models (Features 61-70)
    """
    if df.empty:
        return df
        
    df.columns = [str(c).lower() for c in df.columns]
    close = df['close']
    returns = close.pct_change().fillna(0)
    tick_vol = df.get('tick_net_volume', pd.Series(1, index=df.index)).abs()
    
    # Simple fractional differencing approximation using binomial expansion up to 3 lags
    def frac_diff_proxy(series, d):
        w = [1, -d, d*(d-1)/2, -d*(d-1)*(d-2)/6]
        res = series * w[0] + series.shift(1) * w[1] + series.shift(2) * w[2] + series.shift(3) * w[3]
        return res
        
    # 61. Fractional Differencing (d=0.1)
    if 'frac_diff_01' in selected_features:
        df['frac_diff_01'] = frac_diff_proxy(close, 0.1)
        
    # 62. Fractional Differencing (d=0.3)
    if 'frac_diff_03' in selected_features:
        df['frac_diff_03'] = frac_diff_proxy(close, 0.3)
        
    # 63. Fractional Differencing (d=0.5)
    if 'frac_diff_05' in selected_features:
        df['frac_diff_05'] = frac_diff_proxy(close, 0.5)
        
    # 64. ARFIMA Residuals Proxy
    if 'arfima_residuals' in selected_features:
        # Proxy: Difference between fractional diff (d=0.3) and AR(1) prediction
        fd = frac_diff_proxy(close, 0.3)
        df['arfima_residuals'] = fd - fd.shift(1) * fd.rolling(20).apply(lambda x: pd.Series(x).autocorr(1) if len(x)>1 else 0, raw=False).fillna(0)
        
    # 65. Fractional Brownian Motion (fBm) Drift
    if 'fbm_drift' in selected_features:
        # Drift scaled by volatility
        df['fbm_drift'] = close.diff(20) / (returns.rolling(20).std() * np.sqrt(20) + 1e-8)
        
    # 66. Fractional Ornstein-Uhlenbeck Process Reversion Speed
    if 'frac_ou_reversion' in selected_features:
        sma50 = close.rolling(50).mean()
        # Speed of reversion to mean
        df['frac_ou_reversion'] = abs(close - sma50).diff() * -1
        
    # 67. Long-Range Dependence (LRD) Parameter
    if 'lrd_parameter' in selected_features:
        # Proxy: Autocorrelation at lag 10
        df['lrd_parameter'] = returns.rolling(50).apply(lambda x: pd.Series(x).autocorr(lag=10) if len(x)>10 else 0, raw=False).fillna(0)
        
    # 68. Fractional Integration of Tick Volume
    if 'frac_integral_tick_vol' in selected_features:
        # Proxy: EMA of tick volume with a long span representing long memory
        df['frac_integral_tick_vol'] = tick_vol.ewm(span=100).mean()
        
    # 69. Mittag-Leffler Relaxation Time Proxy
    if 'mittag_leffler_relaxation' in selected_features:
        # Time for a volatility shock to decay
        vol = returns.rolling(10).std()
        shock = vol > vol.rolling(50).mean() + 2 * vol.rolling(50).std()
        df['mittag_leffler_relaxation'] = shock.groupby(shock.cumsum()).cumcount()
        
    # 70. Fractional Volatility Memory
    if 'frac_volatility_memory' in selected_features:
        # Fractionally differenced volatility
        vol = returns.rolling(20).std()
        df['frac_volatility_memory'] = frac_diff_proxy(vol.fillna(0), 0.4)
        
    return df
