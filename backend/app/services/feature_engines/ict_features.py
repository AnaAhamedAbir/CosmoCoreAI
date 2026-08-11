import pandas as pd
import numpy as np
from numba import njit
from typing import List

@njit
def compute_pdh_pdl_proxies_numba(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, window: int = 1440):
    """
    Computes a synthetic PDH (Previous Daily High) and PDL (Previous Daily Low)
    by scanning the previous `window` ticks/candles. 1440 is used as a proxy for a day (if 1-min data).
    Returns the proxy features.
    """
    n = len(closes)
    pdh_sweep = np.zeros(n, dtype=np.float64)
    turtle_soup = np.zeros(n, dtype=np.float64)
    
    for i in range(window, n):
        past_high = np.max(highs[i-window:i])
        past_low = np.min(lows[i-window:i])
        
        # PDH/PDL Sweep Proxy: How close is the current price to sweeping the 24h high/low
        dist_to_high = past_high - closes[i]
        dist_to_low = closes[i] - past_low
        
        if dist_to_high > 0 and past_high > 0:
            pdh_sweep[i] = (past_high - dist_to_high) / past_high
        elif dist_to_high <= 0:
            pdh_sweep[i] = 1.0 # Swept
            
        # Turtle Soup Fakeout: Swept the high but closed back below it (or vice versa for low)
        if highs[i] > past_high and closes[i] < past_high:
            turtle_soup[i] = 1.0 # Bearish Turtle Soup
        elif lows[i] < past_low and closes[i] > past_low:
            turtle_soup[i] = -1.0 # Bullish Turtle Soup
            
    return pdh_sweep, turtle_soup

class ICTFeatureEngine:
    @staticmethod
    def compute_ict_features(df: pd.DataFrame, requested_features: List[str]) -> pd.DataFrame:
        """
        Computes ICT Purist Macro concepts.
        Assumes df index is a pandas DatetimeIndex in UTC.
        """
        if df.empty or not isinstance(df.index, pd.DatetimeIndex):
            return df
            
        # Time processing
        hour = df.index.hour
        minute = df.index.minute
        decimal_hour = hour + minute / 60.0
        
        # 1. London Killzone Momentum (07:00 - 10:00 London Time -> UTC: 06:00 - 09:00 approx, handling base)
        # We will use UTC 07:00 to 10:00 as a standard proxy for European open volatility
        if "london_killzone_momentum" in requested_features:
            is_london = ((decimal_hour >= 7.0) & (decimal_hour <= 10.0)).astype(float)
            if 'Volume' in df.columns and 'Close' in df.columns:
                df['london_killzone_momentum'] = is_london * df['Close'].pct_change().fillna(0) * df['Volume']
            else:
                df['london_killzone_momentum'] = is_london

        # 2. New York Killzone Momentum (07:00 - 10:00 EST -> UTC: 12:00 - 15:00 approx)
        if "ny_killzone_momentum" in requested_features:
            is_ny = ((decimal_hour >= 12.0) & (decimal_hour <= 15.0)).astype(float)
            if 'Volume' in df.columns and 'Close' in df.columns:
                df['ny_killzone_momentum'] = is_ny * df['Close'].pct_change().fillna(0) * df['Volume']
            else:
                df['ny_killzone_momentum'] = is_ny

        # 3. Asian Consolidation Breakout (00:00 - 06:00 UTC roughly)
        if "asian_consolidation_breakout" in requested_features:
            is_asian = ((decimal_hour >= 0.0) & (decimal_hour <= 6.0))
            if 'Close' in df.columns:
                # Rolling range during Asian session
                asian_high = df['Close'].where(is_asian).rolling(window=60, min_periods=1).max().ffill()
                asian_low = df['Close'].where(is_asian).rolling(window=60, min_periods=1).min().ffill()
                range_size = asian_high - asian_low
                
                # Breakout magnitude outside the Asian range
                df['asian_consolidation_breakout'] = np.where(
                    ~is_asian & (range_size > 0),
                    (df['Close'] - asian_high) / range_size + (df['Close'] - asian_low) / range_size,
                    0.0
                )
            else:
                df['asian_consolidation_breakout'] = 0.0

        # 4. True Day Open Deviation (00:00 EST -> 05:00 UTC)
        if "true_day_open_deviation" in requested_features:
            if 'Close' in df.columns:
                # Find the close price at or just after 05:00 UTC
                is_midnight_ny = (hour == 5) & (minute == 0)
                midnight_open_price = df['Close'].where(is_midnight_ny).ffill()
                df['true_day_open_deviation'] = np.where(
                    midnight_open_price > 0,
                    (df['Close'] - midnight_open_price) / midnight_open_price,
                    0.0
                )
            else:
                df['true_day_open_deviation'] = 0.0

        # 5. PDH/PDL Sweep & Turtle Soup
        if "pdh_pdl_sweep_proxy" in requested_features or "turtle_soup_fakeout" in requested_features:
            highs = df['High'].values if 'High' in df.columns else df['Close'].values
            lows = df['Low'].values if 'Low' in df.columns else df['Close'].values
            closes = df['Close'].values
            
            # Use 1440 ticks for daily proxy (assuming 1m data roughly)
            pdh_sweep, turtle_soup = compute_pdh_pdl_proxies_numba(highs, lows, closes, window=1440)
            
            if "pdh_pdl_sweep_proxy" in requested_features:
                df['pdh_pdl_sweep_proxy'] = pdh_sweep
            if "turtle_soup_fakeout" in requested_features:
                df['turtle_soup_fakeout'] = turtle_soup

        # 6. SMT Divergence (Synthetic)
        if "smt_divergence_synthetic" in requested_features:
            if 'Close' in df.columns and 'Volume' in df.columns:
                # We create a synthetic correlated asset proxy using Volume Weighted Price
                vwp = (df['Close'] * df['Volume']).rolling(20).sum() / (df['Volume'].rolling(20).sum() + 1e-9)
                price_roc = df['Close'].pct_change(10)
                vwp_roc = vwp.pct_change(10)
                # Divergence happens when Price makes a higher high but VWP does not (or vice versa)
                df['smt_divergence_synthetic'] = price_roc - vwp_roc
                df['smt_divergence_synthetic'] = df['smt_divergence_synthetic'].fillna(0.0)
            else:
                df['smt_divergence_synthetic'] = 0.0

        # 7. Institutional Pricing Magnet (00 and 50 levels)
        if "institutional_pricing_magnet" in requested_features:
            if 'Close' in df.columns:
                # Find the distance to the nearest 50 or 100 level
                # Scaling depends on the asset. We use modulo 50.
                mod_price = df['Close'] % 50.0
                dist_to_50 = np.minimum(mod_price, 50.0 - mod_price)
                # Normalize (0 means exactly on a 00 or 50 level, 25 means exactly in middle)
                df['institutional_pricing_magnet'] = 1.0 - (dist_to_50 / 25.0)
            else:
                df['institutional_pricing_magnet'] = 0.0

        # 8. Judas Swing Probability
        if "judas_swing_probability" in requested_features:
            if 'Close' in df.columns:
                # Judas swing is a fakeout right after True Day Open (05:00 UTC)
                # Measure rapid opposite momentum between 05:00 and 07:00 UTC
                is_judas_window = ((decimal_hour >= 5.0) & (decimal_hour <= 7.0)).astype(float)
                accel = df['Close'].pct_change(5) - df['Close'].pct_change(10)
                df['judas_swing_probability'] = is_judas_window * np.abs(accel).fillna(0)
            else:
                df['judas_swing_probability'] = 0.0

        # 9. Silver Bullet Proximity (10 AM EST -> 15:00 UTC)
        if "silver_bullet_time_proximity" in requested_features:
            # Distance in hours to 15:00 UTC
            dist_to_sb = np.abs(decimal_hour - 15.0)
            # Max score of 1.0 when exactly at 15:00
            df['silver_bullet_time_proximity'] = np.maximum(0, 1.0 - dist_to_sb)

        return df
