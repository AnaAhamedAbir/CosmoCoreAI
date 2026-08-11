import pandas as pd
import numpy as np

def generate_information_theory_features(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Category 4: Information Theory & Entropy (Features 31-40)
    """
    if df.empty:
        return df
        
    df.columns = [str(c).lower() for c in df.columns]
    close = df['close']
    returns = close.pct_change().fillna(0)
    
    # 31. Shannon Entropy of Tick Returns
    if 'shannon_entropy_returns' in selected_features:
        # Proxy: rolling standard deviation of absolute returns (a measure of spread/entropy)
        df['shannon_entropy_returns'] = returns.rolling(20).apply(
            lambda x: -np.sum((np.histogram(x, bins=10, density=True)[0] + 1e-8) * np.log(np.histogram(x, bins=10, density=True)[0] + 1e-8)) if len(x)>1 else 0,
            raw=True
        )
        
    # 32. Tsallis Entropy
    if 'tsallis_entropy' in selected_features:
        q = 1.5
        df['tsallis_entropy'] = returns.rolling(20).apply(
            lambda x: (1 - np.sum((np.histogram(x, bins=10, density=True)[0] + 1e-8)**q)) / (q - 1) if len(x)>1 else 0,
            raw=True
        )
        
    # 33. Transfer Entropy (Lead-Lag) Proxy
    if 'transfer_entropy_proxy' in selected_features:
        # Proxy: Correlation of current return with lagged volatility
        df['transfer_entropy_proxy'] = returns.rolling(20).corr(returns.abs().shift(1)).fillna(0)
        
    # 34. Kolmogorov Complexity Proxy
    if 'kolmogorov_complexity_proxy' in selected_features:
        # Proxy: Compression ratio using LZW-like logic (approximated by number of zero crossings)
        signs = np.sign(returns)
        df['kolmogorov_complexity_proxy'] = signs.diff().abs().rolling(20).sum() / 20.0
        
    # 35. Approximate Entropy (ApEn) Proxy
    if 'approximate_entropy_proxy' in selected_features:
        # Proxy: Difference between standard deviations of consecutive rolling windows
        df['approximate_entropy_proxy'] = returns.rolling(10).std().diff().abs()
        
    # 36. Sample Entropy (SampEn) Proxy
    if 'sample_entropy_proxy' in selected_features:
        # Proxy: Autocorrelation decay
        df['sample_entropy_proxy'] = returns.rolling(20).apply(lambda x: pd.Series(x).autocorr(lag=1) if len(x)>1 else 0, raw=False).fillna(0)
        
    # 37. Multiscale Entropy
    if 'multiscale_entropy' in selected_features:
        # Proxy: Entropy calculated across multiple time scales (sum of rolling std dev over 5, 10, 20)
        df['multiscale_entropy'] = returns.rolling(5).std() + returns.rolling(10).std() + returns.rolling(20).std()
        
    # 38. Permutation Entropy
    if 'permutation_entropy' in selected_features:
        # Proxy: How many times does a sequence of 3 returns monotonically increase/decrease?
        r1 = returns
        r2 = returns.shift(1)
        r3 = returns.shift(2)
        monotonic = ((r1 > r2) & (r2 > r3)) | ((r1 < r2) & (r2 < r3))
        df['permutation_entropy'] = monotonic.rolling(20).mean()
        
    # 39. Kullback-Leibler (KL) Divergence
    if 'kl_divergence' in selected_features:
        # Divergence between recent distribution (20 bars) and historical distribution (100 bars)
        # Proxy: Distance between short term variance and long term variance
        var20 = returns.rolling(20).var()
        var100 = returns.rolling(100).var()
        df['kl_divergence'] = abs(var20 - var100) / (var100 + 1e-8)
        
    # 40. Jensen-Shannon Divergence
    if 'jensen_shannon_divergence' in selected_features:
        # Smoothed KL Divergence
        var20 = returns.rolling(20).var()
        var100 = returns.rolling(100).var()
        m = (var20 + var100) / 2
        df['jensen_shannon_divergence'] = 0.5 * (abs(var20 - m) + abs(var100 - m)) / (m + 1e-8)
        
    return df
