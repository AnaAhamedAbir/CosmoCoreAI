import pandas as pd
import numpy as np

def generate_stochastic_jump_features(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Category 10: Stochastic Calculus & Jump Diffusion (Features 91-100)
    """
    if df.empty:
        return df
        
    df.columns = [str(c).lower() for c in df.columns]
    close = df['close']
    returns = close.pct_change().fillna(0)
    
    # 91. Merton Jump-Diffusion Jump Intensity
    if 'merton_jump_intensity' in selected_features:
        # Proxy: Number of returns exceeding 3 standard deviations
        vol = returns.rolling(50).std()
        is_jump = abs(returns) > (3 * vol)
        df['merton_jump_intensity'] = is_jump.rolling(50).sum()
        
    # 92. Merton Jump Mean
    if 'merton_jump_mean' in selected_features:
        # Proxy: Average return when a jump occurs
        vol = returns.rolling(50).std()
        is_jump = abs(returns) > (3 * vol)
        df['merton_jump_mean'] = returns.where(is_jump, 0).rolling(50).mean()
        
    # 93. Merton Jump Variance
    if 'merton_jump_variance' in selected_features:
        vol = returns.rolling(50).std()
        is_jump = abs(returns) > (3 * vol)
        df['merton_jump_variance'] = returns.where(is_jump, 0).rolling(50).var().fillna(0)
        
    # 94. Heston Model Stochastic Variance
    if 'heston_stochastic_variance' in selected_features:
        # Proxy: Variance of the 20-period variance
        var20 = returns.rolling(20).var()
        df['heston_stochastic_variance'] = var20.rolling(20).var()
        
    # 95. Heston Correlation (Spot-Vol)
    if 'heston_spot_vol_correlation' in selected_features:
        # Leverage effect: Correlation between returns and changes in volatility
        vol = returns.rolling(20).std()
        vol_change = vol.diff()
        df['heston_spot_vol_correlation'] = returns.rolling(20).corr(vol_change).fillna(0)
        
    # 96. Ornstein-Uhlenbeck Mean Reversion Level
    if 'ou_mean_reversion_level' in selected_features:
        # Proxy: Long term moving average
        df['ou_mean_reversion_level'] = close.rolling(100).mean()
        
    # 97. OU Mean Reversion Speed
    if 'ou_mean_reversion_speed' in selected_features:
        # Proxy: Rate of change of the distance to the mean reversion level
        level = close.rolling(100).mean()
        dist = abs(close - level)
        df['ou_mean_reversion_speed'] = dist.diff() * -1
        
    # 98. Cox-Ingersoll-Ross (CIR) Volatility Drift
    if 'cir_volatility_drift' in selected_features:
        # Volatility drift proportional to sqrt of volatility
        vol = returns.rolling(20).std()
        df['cir_volatility_drift'] = vol.diff() / (np.sqrt(vol) + 1e-8)
        
    # 99. Geometric Brownian Motion (GBM) Drift Parameter
    if 'gbm_drift_parameter' in selected_features:
        # Proxy: mu - (sigma^2)/2
        mu = returns.rolling(20).mean()
        sigma = returns.rolling(20).std()
        df['gbm_drift_parameter'] = mu - (sigma**2) / 2
        
    # 100. Local Volatility Surface Proxy
    if 'local_volatility_surface' in selected_features:
        # Proxy: Volatility scaled by price level (simulating strike dependence)
        vol = returns.rolling(20).std()
        df['local_volatility_surface'] = vol * (close / close.rolling(100).mean())
        
    return df
