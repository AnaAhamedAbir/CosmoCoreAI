import pandas as pd
import numpy as np

def generate_chaos_theory_features(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Category 5: Chaos Theory & Non-linear Dynamics (Features 41-50)
    """
    if df.empty:
        return df
        
    df.columns = [str(c).lower() for c in df.columns]
    close = df['close']
    returns = close.pct_change().fillna(0)
    
    # 41. Maximum Lyapunov Exponent (MLE) Proxy
    if 'mle_proxy' in selected_features:
        # Proxy: Divergence of nearby price paths over time
        df['mle_proxy'] = np.log(abs(returns) + 1e-8).rolling(20).mean()
        
    # 42. Correlation Dimension Proxy
    if 'correlation_dimension_proxy' in selected_features:
        # Proxy: Fractal dimension of price path (high volatility = higher dimension)
        df['correlation_dimension_proxy'] = returns.rolling(20).std() / (abs(close.diff(20)) + 1e-8)
        
    # 43. Hurst Exponent (Local)
    if 'hurst_exponent' in selected_features:
        # Proxy: Variance ratio test over 2 intervals (e.g. 5 and 20)
        var5 = returns.rolling(5).var()
        var20 = returns.rolling(20).var()
        df['hurst_exponent'] = np.log(var20 / (var5 + 1e-8)) / np.log(20/5)
        
    # 44. Multifractal Spectrum Width Proxy
    if 'multifractal_spectrum_width' in selected_features:
        # Proxy: Difference between high-volatility dimension and low-volatility dimension
        vol_high = returns.rolling(10).quantile(0.9)
        vol_low = returns.rolling(10).quantile(0.1)
        df['multifractal_spectrum_width'] = vol_high - vol_low
        
    # 45. Detrended Fluctuation Analysis (DFA) Proxy
    if 'dfa_proxy' in selected_features:
        # Proxy: Root Mean Square of detrended price series
        sma20 = close.rolling(20).mean()
        detrended = close - sma20
        df['dfa_proxy'] = np.sqrt((detrended**2).rolling(20).mean())
        
    # 46. Recurrence Quantification Analysis (RQA) Proxy
    if 'rqa_proxy' in selected_features:
        # Proxy: Percentage of times price returns to within a threshold of previous prices
        threshold = close * 0.001
        is_recurrent = abs(close - close.shift(10)) < threshold
        df['rqa_proxy'] = is_recurrent.rolling(20).mean()
        
    # 47. Determinism (DET) in RQA Proxy
    if 'rqa_determinism' in selected_features:
        # Proxy: Autocorrelation at lag 2
        df['rqa_determinism'] = returns.rolling(20).apply(lambda x: pd.Series(x).autocorr(lag=2) if len(x)>2 else 0, raw=False).fillna(0)
        
    # 48. Laminarity (LAM) in RQA Proxy
    if 'rqa_laminarity' in selected_features:
        # Proxy: Time spent within Bollinger Bands
        bb_upper = close.rolling(20).mean() + 2 * close.rolling(20).std()
        bb_lower = close.rolling(20).mean() - 2 * close.rolling(20).std()
        in_band = (close < bb_upper) & (close > bb_lower)
        df['rqa_laminarity'] = in_band.rolling(20).mean()
        
    # 49. Trapping Time (TT) Proxy
    if 'trapping_time' in selected_features:
        # Proxy: How many bars before price breaks the 20-bar high/low range
        high20 = df['high'].rolling(20).max()
        low20 = df['low'].rolling(20).min()
        broken = (close > high20.shift(1)) | (close < low20.shift(1))
        df['trapping_time'] = broken.groupby(broken.cumsum()).cumcount()
        
    # 50. Phase Space Embedding Dimension Proxy
    if 'phase_space_embedding' in selected_features:
        # Proxy: Number of PCA components needed to explain 90% variance
        # Simplified: ratio of 5-day variance to 20-day variance
        var5 = returns.rolling(5).var()
        var20 = returns.rolling(20).var()
        df['phase_space_embedding'] = var20 / (var5 + 1e-8)
        
    return df
