import pandas as pd
import numpy as np

def generate_candlestick_anatomy(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Calculates Phase 2: Candlestick Psychology & Micro-Anatomy features, verified by high-frequency tick data.
    
    Expected tick columns in df: 
    - tick_count, tick_net_volume, tick_volume_imbalance, tick_buy_sell_ratio, tick_realized_vol
    """
    if df.empty:
        return df
        
    df.columns = [str(c).lower() for c in df.columns]
    
    # Helper series
    tick_vol = df['tick_net_volume'] if 'tick_net_volume' in df.columns else df.get('tick_count', pd.Series(1, index=df.index))
    tick_imbalance = df['tick_volume_imbalance'] if 'tick_volume_imbalance' in df.columns else pd.Series(0, index=df.index)
    tick_realized_vol = df['tick_realized_vol'] if 'tick_realized_vol' in df.columns else pd.Series(0, index=df.index)
    tick_buy_sell = df['tick_buy_sell_ratio'] if 'tick_buy_sell_ratio' in df.columns else pd.Series(1, index=df.index)
    
    high_low_range = df['high'] - df['low']
    body_size = abs(df['close'] - df['open'])
    
    # 1. Wick Rejection Intensity
    if 'wick_rejection_intensity' in selected_features:
        # Intensity = total tick volume * (upper wick or lower wick size / total range)
        upper_wick = df['high'] - df[['open', 'close']].max(axis=1)
        lower_wick = df[['open', 'close']].min(axis=1) - df['low']
        
        # Determine dominant wick
        max_wick = np.maximum(upper_wick, lower_wick)
        wick_ratio = max_wick / (high_low_range + 1e-8)
        
        df['wick_rejection_intensity'] = wick_ratio * tick_vol.abs()
        
    # 2. Body Effort vs Result (Wyckoff)
    if 'body_effort_result' in selected_features:
        # High tick volume (effort) but very small body (result) indicates hidden resistance/support
        df['body_effort_result'] = tick_vol.abs() / (body_size + 1e-8)
        
    # 3. Doji Indecision Entropy
    if 'doji_indecision_entropy' in selected_features:
        # If it's a Doji (body is very small), how high is the realized tick volatility?
        # High volatility Doji = huge fight between buyers and sellers
        is_doji = body_size < (high_low_range * 0.1)
        df['doji_indecision_entropy'] = np.where(is_doji, tick_realized_vol, 0)
        
    # 4. Engulfing Imbalance Ratio
    if 'engulfing_imbalance_ratio' in selected_features:
        # Bullish Engulfing
        bull_engulf = (df['close'] > df['open'].shift(1)) & (df['open'] < df['close'].shift(1)) & (df['close'].shift(1) < df['open'].shift(1))
        # Bearish Engulfing
        bear_engulf = (df['close'] < df['open'].shift(1)) & (df['open'] > df['close'].shift(1)) & (df['close'].shift(1) > df['open'].shift(1))
        
        # Verify with tick imbalance
        df['engulfing_imbalance_ratio'] = np.where(bull_engulf, tick_imbalance, np.where(bear_engulf, -tick_imbalance, 0))
        
    # 5. Pin Bar Trapping Volume
    if 'pin_bar_trapping_volume' in selected_features:
        # Pin bar with a long tail rejecting support/resistance
        is_bull_pin = (df['close'] > df['open']) & ((df['open'] - df['low']) > (high_low_range * 0.6))
        is_bear_pin = (df['close'] < df['open']) & ((df['high'] - df['open']) > (high_low_range * 0.6))
        
        # Trapping volume = tick volume * tick buy/sell imbalance during the pin bar
        df['pin_bar_trapping_volume'] = np.where(is_bull_pin | is_bear_pin, tick_vol.abs() * abs(tick_buy_sell - 1), 0)
        
    # 6. Hammer/Shooting Star Tick Acceleration
    if 'hammer_tick_acceleration' in selected_features:
        # Tick price acceleration proxy during hammer
        df['hammer_tick_acceleration'] = df.get('pin_bar_trapping_volume', pd.Series(0, index=df.index)) * tick_realized_vol
        
    # 7. Morning/Evening Star Validation
    if 'star_validation_shift' in selected_features:
        # Three candle pattern: large candle, small star, large reversal
        star = (body_size.shift(1) < high_low_range.shift(1) * 0.2)
        reversal = (abs(df['close'] - df['open']) > high_low_range * 0.5)
        # Validation by tick volume surge in candle 3
        df['star_validation_shift'] = np.where(star & reversal, tick_vol.abs() / (tick_vol.abs().shift(1) + 1e-8), 0)
        
    # 8. Consecutive Bear/Bull Pressure
    if 'consecutive_pressure' in selected_features:
        # Measure if tick imbalance has been consecutively positive/negative for 3 bars
        bull_p = (tick_imbalance > 0) & (tick_imbalance.shift(1) > 0) & (tick_imbalance.shift(2) > 0)
        bear_p = (tick_imbalance < 0) & (tick_imbalance.shift(1) < 0) & (tick_imbalance.shift(2) < 0)
        df['consecutive_pressure'] = np.where(bull_p, 1, np.where(bear_p, -1, 0)) * tick_vol.rolling(3).sum().abs()
        
    # 9. Gap Fill Tick Velocity
    if 'gap_fill_velocity' in selected_features:
        # Velocity when filling a gap
        has_gap = (df['open'] > df['high'].shift(1)) | (df['open'] < df['low'].shift(1))
        gap_size = abs(df['open'] - df['close'].shift(1))
        df['gap_fill_velocity'] = np.where(has_gap, tick_realized_vol * gap_size, 0)
        
    # 10. Candle Close Tick Surge
    if 'candle_close_surge' in selected_features:
        # We approximate the end-of-candle surge by checking if the tick volatility 
        # is disproportionately higher than the candle body size.
        df['candle_close_surge'] = tick_realized_vol / (body_size + 1e-8)

    return df
