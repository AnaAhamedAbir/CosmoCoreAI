import pandas as pd
import numpy as np

def generate_regime_sentiment_features(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Category 14: Regime Detection & Behavioral Sentiment (Features 131-140)
    """
    if df.empty:
        return df
        
    df.columns = [str(c).lower() for c in df.columns]
    close = df['close']
    returns = close.pct_change().fillna(0)
    tick_vol = df.get('tick_net_volume', pd.Series(1, index=df.index)).abs()
    
    # 131. Gaussian Mixture Model (GMM) Log-Likelihood
    if 'gmm_log_likelihood' in selected_features:
        # Proxy: Probability of current return belonging to the moving average distribution
        mu = returns.rolling(50).mean()
        std = returns.rolling(50).std() + 1e-8
        df['gmm_log_likelihood'] = -0.5 * ((returns - mu) / std)**2 - np.log(std)
        
    # 132. Volatility Regime Indicator
    if 'volatility_regime_indicator' in selected_features:
        vol = returns.rolling(20).std()
        med_vol = vol.rolling(100).median()
        df['volatility_regime_indicator'] = np.where(vol > med_vol * 1.5, 2, np.where(vol < med_vol * 0.5, 0, 1))
        
    # 133. Systemic Risk Indicator
    if 'systemic_risk_indicator' in selected_features:
        # Proxy: Extreme drops in price combined with extreme volatility
        vol = returns.rolling(50).std()
        df['systemic_risk_indicator'] = np.where((returns < -3 * vol), vol, 0)
        
    # 134. Change-Point Detection (CUSUM)
    if 'cusum_change_point' in selected_features:
        # Cumulative sum of deviations from the mean
        mu = returns.rolling(50).mean()
        df['cusum_change_point'] = (returns - mu).cumsum()
        
    # 135. Prospect Theory Value Function Proxy
    if 'prospect_theory_value' in selected_features:
        # Losses loom larger than gains (e.g. Lambda = 2.25)
        df['prospect_theory_value'] = np.where(returns >= 0, returns**0.88, -2.25 * (abs(returns)**0.88))
        
    # 136. Herd Behavior Index (CSSD)
    if 'herd_behavior_index' in selected_features:
        # Proxy: Cross-sectional standard deviation. Here we use short vs long term return deviation
        ret_5 = close.pct_change(5).fillna(0)
        ret_20 = close.pct_change(20).fillna(0)
        df['herd_behavior_index'] = abs(ret_5 - (ret_20/4))
        
    # 137. Retail Panic Index
    if 'retail_panic_index' in selected_features:
        # Proxy: Huge tick volume on a massive down candle
        df['retail_panic_index'] = np.where((returns < returns.rolling(50).mean() - 2 * returns.rolling(50).std()), tick_vol, 0)
        
    # 138. FOMO Momentum
    if 'fomo_momentum' in selected_features:
        # Proxy: Accelerating positive returns with accelerating volume
        mom = close.diff(5)
        mom_accel = mom.diff()
        vol_accel = tick_vol.diff()
        df['fomo_momentum'] = np.where((mom > 0) & (mom_accel > 0) & (vol_accel > 0), tick_vol, 0)
        
    # 139. Stop-Hunt Vulnerability Score
    if 'stop_hunt_vulnerability' in selected_features:
        # Proxy: Price is very close to a recent 50-bar high/low and volume is drying up
        high50 = df['high'].rolling(50).max()
        low50 = df['low'].rolling(50).min()
        dist_high = abs(close - high50) / close
        dist_low = abs(close - low50) / close
        min_dist = np.minimum(dist_high, dist_low)
        vol_drying = tick_vol < tick_vol.rolling(20).mean() * 0.5
        df['stop_hunt_vulnerability'] = np.where((min_dist < 0.002) & vol_drying, 1, 0)
        
    # 140. Anchoring Bias Indicator
    if 'anchoring_bias_indicator' in selected_features:
        # Proxy: Distance to the nearest 'round' number (e.g., modulo 0.0100)
        # Using modulo 0.01 as a generic round number proxy
        df['anchoring_bias_indicator'] = close % 0.01
        
    return df
