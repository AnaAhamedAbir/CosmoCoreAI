import pandas as pd
import numpy as np

def generate_stat_arb_features(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Category 13: Statistical Arbitrage & Mean Reversion (Features 121-130)
    """
    if df.empty:
        return df
        
    df.columns = [str(c).lower() for c in df.columns]
    close = df['close']
    returns = close.pct_change().fillna(0)
    
    # 121. Cointegration Z-Score (vs Synthetic Basket)
    if 'cointegration_z_score' in selected_features:
        # Proxy: Z-Score of the closing price against a 200-period SMA (acting as synthetic basket)
        sma200 = close.rolling(200).mean()
        std200 = close.rolling(200).std()
        df['cointegration_z_score'] = (close - sma200) / (std200 + 1e-8)
        
    # 122. Half-Life of Mean Reversion
    if 'half_life_mean_reversion' in selected_features:
        # Proxy: How fast autocorrelation decays
        df['half_life_mean_reversion'] = returns.rolling(50).apply(lambda x: -np.log(2) / np.log(abs(pd.Series(x).autocorr(1)) + 1e-8) if len(x)>2 else 0, raw=False).fillna(0)
        
    # 123. Bollinger Bandwidth 2nd Derivative
    if 'bb_bandwidth_2nd_deriv' in selected_features:
        bb_width = (close.rolling(20).std() * 4) / (close.rolling(20).mean() + 1e-8)
        df['bb_bandwidth_2nd_deriv'] = bb_width.diff().diff()
        
    # 124. Kalman Filter Residual
    if 'kalman_filter_residual' in selected_features:
        # Proxy: EMA(5) as observed state, EMA(20) as true state
        df['kalman_filter_residual'] = close.ewm(span=5).mean() - close.ewm(span=20).mean()
        
    # 125. Kalman Filter Covariance Matrix Trace
    if 'kalman_covariance_trace' in selected_features:
        # Proxy: Sum of variances of returns and volatility
        var_ret = returns.rolling(20).var()
        var_vol = returns.rolling(20).std().rolling(20).var()
        df['kalman_covariance_trace'] = var_ret + var_vol
        
    # 126. Pairs Trading Spread Velocity
    if 'pairs_spread_velocity' in selected_features:
        # Proxy: Velocity of the distance from the 200 SMA
        spread = close - close.rolling(200).mean()
        df['pairs_spread_velocity'] = spread.diff()
        
    # 127. Statistical Arbitrage Mispricing Index
    if 'stat_arb_mispricing_index' in selected_features:
        # Proxy: Absolute Z-Score deviation scaled by volume
        z_score = (close - close.rolling(50).mean()) / (close.rolling(50).std() + 1e-8)
        tick_vol = df.get('tick_net_volume', pd.Series(1, index=df.index)).abs()
        df['stat_arb_mispricing_index'] = abs(z_score) * tick_vol
        
    # 128. Johansen Test Eigenvalue Proxy
    if 'johansen_eigenvalue' in selected_features:
        # Proxy: Strength of mean reversion (negative autocorrelation)
        df['johansen_eigenvalue'] = returns.rolling(50).apply(lambda x: abs(pd.Series(x).autocorr(1)) if len(x)>1 else 0, raw=False).fillna(0)
        
    # 129. Copula Dependence (Tail)
    if 'copula_tail_dependence' in selected_features:
        # Proxy: Correlation of extreme negative returns
        is_extreme = returns < returns.rolling(100).quantile(0.05)
        df['copula_tail_dependence'] = returns.where(is_extreme, 0).rolling(50).corr(returns.shift(1)).fillna(0)
        
    # 130. Student-t Copula Degrees of Freedom
    if 'student_t_degrees_of_freedom' in selected_features:
        # Proxy: Kurtosis of returns (lower DOF = higher kurtosis/fatter tails)
        df['student_t_degrees_of_freedom'] = 6 / (returns.rolling(100).kurt() + 1e-8)
        
    return df
