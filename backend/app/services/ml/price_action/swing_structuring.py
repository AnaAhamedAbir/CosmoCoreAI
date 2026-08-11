import pandas as pd
import numpy as np

def generate_swing_structuring_features(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Calculates Phase 7: Advanced Price Action & Swing Structuring.
    """
    if df.empty:
        return df
        
    df.columns = [str(c).lower() for c in df.columns]
    close = df['close']
    high = df['high']
    low = df['low']
    tick_vol = df.get('tick_net_volume', pd.Series(1, index=df.index)).abs()
    
    # Helper for rolling swings
    rolling_max = high.rolling(20).max()
    rolling_min = low.rolling(20).min()
    
    # 21. Fractal Swing Confirmation Time
    if 'fractal_swing_confirmation_time' in selected_features:
        # Proxy: Time since last 20-period high/low was broken
        is_new_high = (high >= rolling_max.shift(1)).astype(int)
        is_new_low = (low <= rolling_min.shift(1)).astype(int)
        # Cumulative bars since last break
        df['fractal_swing_confirmation_time'] = (is_new_high | is_new_low).groupby((is_new_high | is_new_low).cumsum()).cumcount()
        
    # 22. Multi-Timeframe Trend Alignment
    if 'mtf_trend_alignment' in selected_features:
        # Proxy: Short, Medium, Long term SMAs aligned
        sma10 = close.rolling(10).mean()
        sma50 = close.rolling(50).mean()
        sma200 = close.rolling(200).mean()
        bull_align = (close > sma10) & (sma10 > sma50) & (sma50 > sma200)
        bear_align = (close < sma10) & (sma10 < sma50) & (sma50 < sma200)
        df['mtf_trend_alignment'] = np.where(bull_align, 1, np.where(bear_align, -1, 0))
        
    # 23. Trendline Touch Reaction
    if 'trendline_touch_reaction' in selected_features:
        # Reaction (tick volume) when price touches a moving average proxy for trendline
        sma50 = close.rolling(50).mean()
        touching = (low <= sma50) & (high >= sma50)
        df['trendline_touch_reaction'] = np.where(touching, tick_vol, 0)
        
    # 24. Support/Resistance Penetration Depth
    if 'sr_penetration_depth' in selected_features:
        # How far price pierces previous 50-period high/low
        prev_high = high.shift(1).rolling(50).max()
        prev_low = low.shift(1).rolling(50).min()
        depth_high = np.maximum(0, high - prev_high)
        depth_low = np.maximum(0, prev_low - low)
        df['sr_penetration_depth'] = depth_high + depth_low
        
    # 25. Wyckoff Spring Validation
    if 'wyckoff_spring_validation' in selected_features:
        # Price drops below recent support but tick volume is low (no supply)
        prev_low = low.shift(1).rolling(20).min()
        spring_setup = low < prev_low
        # Validation: low volume during the sweep
        avg_vol = tick_vol.rolling(20).mean()
        df['wyckoff_spring_validation'] = np.where(spring_setup & (tick_vol < avg_vol * 0.8), 1, 0)
        
    # 26. Wyckoff Sign of Strength (SOS) Pulse
    if 'wyckoff_sos_pulse' in selected_features:
        # Huge bullish bar with high volume after consolidation
        bull_bar = (close - df['open']) > ((high - low) * 0.8)
        high_vol = tick_vol > tick_vol.rolling(20).mean() * 1.5
        df['wyckoff_sos_pulse'] = np.where(bull_bar & high_vol, tick_vol, 0)
        
    # 27. Volume Spread Analysis (VSA) Climax
    if 'vsa_climax' in selected_features:
        # Extremely high volume with a very wide spread (range)
        range_sma = (high - low).rolling(20).mean()
        wide_spread = (high - low) > range_sma * 2
        ultra_vol = tick_vol > tick_vol.rolling(20).mean() * 3
        df['vsa_climax'] = np.where(wide_spread & ultra_vol, 1, 0)
        
    # 28. VSA No Demand / No Supply Bar
    if 'vsa_no_demand_supply' in selected_features:
        # Narrow spread, volume less than previous 2 bars
        narrow_spread = (high - low) < (high - low).rolling(20).mean() * 0.8
        vol_drop = (tick_vol < tick_vol.shift(1)) & (tick_vol < tick_vol.shift(2))
        bull_candle = close > df['open']
        bear_candle = close < df['open']
        # No Demand (Bullish candle with low volume), No Supply (Bearish with low volume)
        df['vsa_no_demand_supply'] = np.where(narrow_spread & vol_drop & bull_candle, -1, np.where(narrow_spread & vol_drop & bear_candle, 1, 0))
        
    # 29. Three Drives Pattern Symmetry
    if 'three_drives_symmetry' in selected_features:
        # Proxy: Consistently making new highs but with decreasing momentum
        roc1 = close.diff(5)
        roc2 = roc1.shift(5)
        roc3 = roc2.shift(5)
        divergence = (roc1 < roc2) & (roc2 < roc3) & (close > close.shift(5))
        df['three_drives_symmetry'] = np.where(divergence, 1, 0)
        
    # 30. Harmonic Pattern Completion (PRZ) Reaction
    if 'harmonic_prz_reaction' in selected_features:
        # Potential Reversal Zone reaction proxy (high tick volume + pin bar inside 200 SMA zone)
        pin_bar = ((df['open'] - low) > (high - low) * 0.6) | ((high - close) > (high - low) * 0.6)
        sma200 = close.rolling(200).mean()
        near_sma = abs(close - sma200) < (close * 0.005) # Within 0.5%
        high_vol = tick_vol > tick_vol.rolling(20).mean() * 1.5
        df['harmonic_prz_reaction'] = np.where(pin_bar & near_sma & high_vol, tick_vol, 0)
        
    return df
