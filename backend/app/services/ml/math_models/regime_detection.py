import pandas as pd
import numpy as np

def generate_regime_detection_features(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Calculates Phase 3: Regime Detection & Macro State features.
    """
    if df.empty:
        return df
        
    df.columns = [str(c).lower() for c in df.columns]
    close = df['close']
    returns = close.pct_change().fillna(0)
    
    # 1. Volatility Regime Indicator
    if 'volatility_regime' in selected_features:
        # 1 = High Vol, 0 = Low Vol based on 100-period average
        long_vol = returns.rolling(100).std()
        short_vol = returns.rolling(14).std()
        df['volatility_regime'] = np.where(short_vol > long_vol * 1.5, 1, np.where(short_vol < long_vol * 0.7, -1, 0))
        
    # 2. Trend Strength Index (Institutional)
    if 'institutional_tsi' in selected_features:
        # Net price change / Total absolute price change
        net_change = close.diff(20)
        total_change = abs(close.diff(1)).rolling(20).sum()
        df['institutional_tsi'] = net_change / (total_change + 1e-8)
        
    # 3. Change-Point Detection (CUSUM Proxy)
    if 'cusum_change_point' in selected_features:
        # CUSUM detects shifts in the mean
        mean_ret = returns.rolling(50).mean()
        std_ret = returns.rolling(50).std()
        
        # Cumulative sum of deviations from mean
        dev = returns - mean_ret
        df['cusum_change_point'] = dev.rolling(20).sum() / (std_ret + 1e-8)
        
    # 4. Market Turbulence Index
    if 'market_turbulence' in selected_features:
        # Combines tick volatility and return magnitude
        tick_vol = df.get('tick_realized_vol', returns.rolling(10).std())
        df['market_turbulence'] = abs(returns) * tick_vol
        
    # 5. GMM Log-Likelihood Proxy
    if 'gmm_log_likelihood' in selected_features:
        # A simple proxy without fitting sklearn GMM:
        # Assuming two normal distributions: Trend (mean!=0, low vol) and Ranging (mean=0, high vol)
        # We calculate the probability density of the current return in a standard normal vs recent normal
        recent_std = returns.rolling(20).std() + 1e-8
        z_score = returns / recent_std
        pdf = (1 / (np.sqrt(2 * np.pi) * recent_std)) * np.exp(-0.5 * z_score**2)
        df['gmm_log_likelihood'] = np.log(pdf + 1e-8)
        
    return df
