import pandas as pd
import numpy as np
from scipy.fft import fft

def generate_spectral_analysis_features(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Category 6: Spectral & Frequency Domain Analysis (Features 51-60)
    """
    if df.empty:
        return df
        
    df.columns = [str(c).lower() for c in df.columns]
    close = df['close']
    returns = close.pct_change().fillna(0)
    
    # 51. Fast Fourier Transform (FFT) Dominant Frequency Proxy
    if 'fft_dominant_frequency' in selected_features:
        # Simplified proxy: Apply FFT on rolling window and get dominant frequency index
        def dom_freq(x):
            if len(x) < 10: return 0
            f = np.abs(fft(x))
            return np.argmax(f[1:len(f)//2]) + 1
        df['fft_dominant_frequency'] = returns.rolling(20).apply(dom_freq, raw=True)
        
    # 52. Continuous Wavelet Transform (CWT) Proxy
    if 'cwt_coefficients' in selected_features:
        # Proxy: Difference between short-term and long-term EMA
        df['cwt_coefficients'] = close.ewm(span=5).mean() - close.ewm(span=20).mean()
        
    # 53. Discrete Wavelet Transform (DWT) Proxy
    if 'dwt_coefficients' in selected_features:
        # Proxy for high-frequency detail: High-Low range relative to closing price
        df['dwt_coefficients'] = (df['high'] - df['low']) / (close + 1e-8)
        
    # 54. Hilbert-Huang Transform (HHT) Instantaneous Phase Proxy
    if 'hht_instantaneous_phase' in selected_features:
        # Phase proxy using MACD and Signal line arctan
        macd = close.ewm(span=12).mean() - close.ewm(span=26).mean()
        signal = macd.ewm(span=9).mean()
        df['hht_instantaneous_phase'] = np.arctan2(macd, signal)
        
    # 55. EMD Intrinsic Mode Function (IMF) 1 (High Frequency)
    if 'emd_imf_1' in selected_features:
        # Proxy: Price minus 5-bar SMA
        df['emd_imf_1'] = close - close.rolling(5).mean()
        
    # 56. EMD IMF 3 (Medium Frequency)
    if 'emd_imf_3' in selected_features:
        # Proxy: 5-bar SMA minus 20-bar SMA
        df['emd_imf_3'] = close.rolling(5).mean() - close.rolling(20).mean()
        
    # 57. EMD Residual (Trend)
    if 'emd_residual' in selected_features:
        # Proxy: 200-bar SMA
        df['emd_residual'] = close.rolling(200).mean()
        
    # 58. Spectral Power Density
    if 'spectral_power_density' in selected_features:
        # Proxy: Squared rolling volatility
        df['spectral_power_density'] = returns.rolling(20).var()
        
    # 59. Cepstral Coefficients Proxy
    if 'cepstral_coefficients' in selected_features:
        # Inverse FFT of log spectrum proxy -> Autocorrelation of log absolute returns
        log_ret = np.log(abs(returns) + 1e-8)
        df['cepstral_coefficients'] = log_ret.rolling(20).apply(lambda x: pd.Series(x).autocorr(lag=1) if len(x)>1 else 0, raw=False).fillna(0)
        
    # 60. Spectrogram Energy Spread
    if 'spectrogram_energy_spread' in selected_features:
        # Spread of variance across multiple timeframes
        v5 = returns.rolling(5).var()
        v20 = returns.rolling(20).var()
        df['spectrogram_energy_spread'] = abs(v5 - v20)
        
    return df
