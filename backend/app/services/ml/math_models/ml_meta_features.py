import pandas as pd
import numpy as np

def generate_ml_meta_features(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Category 15: Machine Learning Meta-Features (Features 141-150)
    """
    if df.empty:
        return df
        
    df.columns = [str(c).lower() for c in df.columns]
    close = df['close']
    returns = close.pct_change().fillna(0)
    
    # 141. Autoencoder Reconstruction Error Proxy
    if 'autoencoder_reconstruction_error' in selected_features:
        # Proxy: Difference between actual price and a combination of SMAs
        reconstruction = (close.rolling(10).mean() + close.rolling(50).mean()) / 2
        df['autoencoder_reconstruction_error'] = abs(close - reconstruction)
        
    # 142. PCA 1st Principal Component Proxy
    if 'pca_1st_component' in selected_features:
        # Proxy: The main market trend (Long term momentum)
        df['pca_1st_component'] = close.pct_change(100).fillna(0)
        
    # 143. UMAP Component 1 Proxy
    if 'umap_component_1' in selected_features:
        # Proxy: Non-linear embedding proxy (combination of trend and vol)
        trend = close.pct_change(20).fillna(0)
        vol = returns.rolling(20).std()
        df['umap_component_1'] = np.sin(trend * 100) * vol
        
    # 144. Transformer Attention Score (Self) Proxy
    if 'transformer_attention_score' in selected_features:
        # Proxy: Dot product of recent 5-bar returns with previous 5-bar returns (Attention to immediate past)
        ret5 = close.pct_change(5).fillna(0)
        df['transformer_attention_score'] = ret5 * ret5.shift(5)
        
    # 145. Hidden Markov Model (HMM) State 0 Prob Proxy
    if 'hmm_state_0_prob' in selected_features:
        # Proxy: Probability of being in a low-volatility (ranging) state
        vol = returns.rolling(20).std()
        med_vol = vol.rolling(100).median()
        df['hmm_state_0_prob'] = 1 / (1 + np.exp( (vol - med_vol) * 1000 ))
        
    # 146. XGBoost Base Model Output (Stacking) Proxy
    if 'xgboost_base_output' in selected_features:
        # Proxy: A simple decision tree output based on MACD and RSI
        macd = close.ewm(span=12).mean() - close.ewm(span=26).mean()
        rsi = returns.rolling(14).apply(lambda x: np.sum(x[x>0]) / (np.sum(np.abs(x))+1e-8), raw=True) * 100
        df['xgboost_base_output'] = np.where((macd > 0) & (rsi > 50), 1, np.where((macd < 0) & (rsi < 50), -1, 0))
        
    # 147. Deep Reinforcement Learning (DRL) Q-Value Proxy
    if 'drl_q_value_proxy' in selected_features:
        # Proxy: Expected future reward based on current momentum trend
        df['drl_q_value_proxy'] = close.pct_change(50).fillna(0) * (returns.rolling(20).std() + 1e-8)
        
    # 148. Epistemic Uncertainty Proxy
    if 'epistemic_uncertainty' in selected_features:
        # Uncertainty due to lack of data (e.g., volume is extremely low compared to history)
        tick_vol = df.get('tick_net_volume', pd.Series(1, index=df.index)).abs()
        df['epistemic_uncertainty'] = np.where(tick_vol < tick_vol.rolling(100).quantile(0.1), 1, 0)
        
    # 149. Aleatoric Uncertainty Proxy
    if 'aleatoric_uncertainty' in selected_features:
        # Inherent noise (high variance of returns)
        df['aleatoric_uncertainty'] = returns.rolling(20).var()
        
    # 150. Ensemble Agreement Ratio
    if 'ensemble_agreement_ratio' in selected_features:
        # Agreement between SMA, MACD, and Bollinger Bands
        sma_bull = close > close.rolling(20).mean()
        macd = close.ewm(span=12).mean() - close.ewm(span=26).mean()
        macd_bull = macd > 0
        bb_upper = close.rolling(20).mean() + 2 * close.rolling(20).std()
        bb_bull = close > bb_upper
        df['ensemble_agreement_ratio'] = (sma_bull.astype(int) + macd_bull.astype(int) + bb_bull.astype(int)) / 3.0
        
    return df
