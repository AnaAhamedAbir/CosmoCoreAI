import pandas as pd
import numpy as np

def generate_microstructure_features(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Calculates Phase 8: Advanced Microstructure & Point Processes.
    """
    if df.empty:
        return df
        
    df.columns = [str(c).lower() for c in df.columns]
    close = df['close']
    returns = close.pct_change().fillna(0)
    tick_vol = df.get('tick_net_volume', pd.Series(1, index=df.index)).abs()
    tick_imb = df.get('tick_volume_imbalance', pd.Series(0, index=df.index))
    
    # 81. Hawkes Process Baseline Intensity (Proxy)
    if 'hawkes_baseline_intensity' in selected_features:
        # Long-term average rate of tick volume
        df['hawkes_baseline_intensity'] = tick_vol.rolling(200).mean()
        
    # 82. Hawkes Process Excitation Parameter (Proxy)
    if 'hawkes_excitation' in selected_features:
        # How much a spike in volume triggers subsequent volume
        # Proxy: Auto-correlation of tick volume
        df['hawkes_excitation'] = tick_vol.rolling(20).apply(lambda x: pd.Series(x).autocorr(lag=1) if len(x)>1 else 0, raw=False).fillna(0)
        
    # 83. Hawkes Process Decay Rate (Proxy)
    if 'hawkes_decay' in selected_features:
        # Speed at which volume returns to baseline after a spike
        baseline = tick_vol.rolling(200).mean()
        df['hawkes_decay'] = (tick_vol - baseline) / (tick_vol.shift(1) - baseline + 1e-8)
        
    # 84. Probability of Informed Trading (PIN) Proxy
    if 'pin_proxy' in selected_features:
        # PIN approximated by absolute imbalance divided by total volume
        df['pin_proxy'] = abs(tick_imb) / (tick_vol + 1e-8)
        
    # 85. Volume-Synchronized PIN (VPIN) Proxy
    if 'vpin_proxy' in selected_features:
        # VPIN calculated over volume-buckets. Here we approximate over a rolling window.
        rolling_imb = abs(tick_imb.rolling(50).sum())
        rolling_vol = tick_vol.rolling(50).sum()
        df['vpin_proxy'] = rolling_imb / (rolling_vol + 1e-8)
        
    # 86. Glosten-Milgrom Spread Component
    if 'glosten_milgrom_spread' in selected_features:
        # Information asymmetry component of the bid-ask spread
        # Proxy: PIN * Volatility
        pin = abs(tick_imb) / (tick_vol + 1e-8)
        vol = returns.rolling(20).std()
        df['glosten_milgrom_spread'] = pin * vol
        
    # 87. Roll Model Effective Spread
    if 'roll_effective_spread' in selected_features:
        # Roll (1984) spread proxy: 2 * sqrt(-Cov(delta P_t, delta P_{t-1}))
        def calc_roll(x):
            if len(x) < 3: return 0
            cov = np.cov(x[1:], x[:-1])[0, 1]
            if cov < 0:
                return 2 * np.sqrt(-cov)
            return 0
        df['roll_effective_spread'] = close.diff().rolling(20).apply(calc_roll, raw=True)
        
    # 88. Kyle's Lambda (Market Impact)
    if 'kyles_lambda' in selected_features:
        # Price impact per unit of order flow imbalance
        df['kyles_lambda'] = abs(returns) / (abs(tick_imb) + 1e-8)
        
    # 89. Hasbrouck's Information Share (Proxy)
    if 'hasbrouck_info_share' in selected_features:
        # Proportion of price variance explained by order flow
        # Proxy: R^2 of rolling regression between returns and order imbalance
        def calc_r2(y, x):
            if len(y) < 10: return 0
            corr = np.corrcoef(x, y)[0, 1]
            return corr**2 if not np.isnan(corr) else 0
        df['hasbrouck_info_share'] = returns.rolling(50).corr(tick_imb).pow(2).fillna(0)
        
    # 90. Order Imbalance Duration
    if 'order_imbalance_duration' in selected_features:
        # Consecutive periods the imbalance has the same sign
        sign = np.sign(tick_imb)
        df['order_imbalance_duration'] = sign.groupby((sign != sign.shift(1)).cumsum()).cumcount()
        
    return df
