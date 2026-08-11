import pandas as pd
import numpy as np

def generate_tick_verified_smc(df: pd.DataFrame, selected_features: list[str]) -> pd.DataFrame:
    """
    Calculates Phase 1: SMC & ICT features, verified by high-frequency tick data.
    These features require both OHLCV price action structure and aggregated tick columns.
    
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
    
    # 1. Tick-Verified Fair Value Gap (FVG)
    if 'tick_verified_fvg' in selected_features:
        # Bullish FVG: Low of candle 3 > High of candle 1
        bull_fvg = (df['low'] > df['high'].shift(2)) & (df['close'].shift(1) > df['open'].shift(1))
        # Bearish FVG: High of candle 3 < Low of candle 1
        bear_fvg = (df['high'] < df['low'].shift(2)) & (df['close'].shift(1) < df['open'].shift(1))
        
        # Verify with tick data: A true institutional FVG should have high net volume/imbalance in the direction of the gap
        # We look at the tick_imbalance of candle 2 (the gap creator)
        gap_imbalance = tick_imbalance.shift(1) 
        
        df['bullish_fvg_verified'] = np.where(bull_fvg & (gap_imbalance > 0.1), 1, 0)
        df['bearish_fvg_verified'] = np.where(bear_fvg & (gap_imbalance < -0.1), 1, 0)
        df['tick_verified_fvg'] = df['bullish_fvg_verified'] - df['bearish_fvg_verified']
        
    # 2. Order Block (OB) Tick Density
    if 'ob_tick_density' in selected_features:
        # Simple OB detection: A down candle before a strong up move (Bullish OB)
        down_candle = df['close'] < df['open']
        strong_up = (df['close'].shift(-1) > df['high']) & (tick_vol.shift(-1) > tick_vol.rolling(10).mean())
        bull_ob = down_candle & strong_up
        
        up_candle = df['close'] > df['open']
        strong_down = (df['close'].shift(-1) < df['low']) & (tick_vol.shift(-1) < -tick_vol.abs().rolling(10).mean())
        bear_ob = up_candle & strong_down
        
        # Tick Density = Abs(Tick Net Volume) during the OB candle
        df['ob_tick_density'] = np.where(bull_ob | bear_ob, tick_vol.abs(), 0)
        
    # 3. Liquidity Sweep Velocity
    if 'liquidity_sweep_velocity' in selected_features:
        # Sweep: Price breaks previous X bars high/low, but closes back inside, accompanied by high tick volatility
        rolling_high = df['high'].shift(1).rolling(20).max()
        rolling_low = df['low'].shift(1).rolling(20).min()
        
        bull_sweep = (df['low'] < rolling_low) & (df['close'] > rolling_low)
        bear_sweep = (df['high'] > rolling_high) & (df['close'] < rolling_high)
        
        # Velocity during the sweep candle
        df['liquidity_sweep_velocity'] = np.where(bull_sweep | bear_sweep, tick_realized_vol * tick_vol.abs(), 0)
        
    # 4. Mitigation Block Reaction Speed
    if 'mitigation_block_reaction' in selected_features:
        # Proxy: Sharp reversal after a recent failed swing
        df['mitigation_block_reaction'] = tick_realized_vol * tick_imbalance
        
    # 5. Judas Swing Tick Imbalance
    if 'judas_swing_imbalance' in selected_features:
        # Judas Swing usually happens at session opens (e.g. London 07:00 UTC, NY 12:00 UTC)
        # We proxy this by looking for high tick imbalance in the opposite direction of the 4-hour trend
        if 'time' in df.columns:
            hour = df['time'].dt.hour
            is_open = hour.isin([7, 8, 12, 13])
            df['judas_swing_imbalance'] = np.where(is_open, tick_imbalance.abs(), 0)
            
    # 6. Breaker Block Absorption Ratio
    if 'breaker_block_absorption' in selected_features:
        # Absorption: High tick count but low price movement (small body)
        hl_range = df['high'] - df['low']
        body = abs(df['close'] - df['open'])
        absorption = df.get('tick_count', pd.Series(1, index=df.index)) / (body + 1e-8)
        df['breaker_block_absorption'] = np.where(body < hl_range * 0.3, absorption, 0)
        
    # 7. Change of Character (CHoCH) Momentum
    if 'choch_momentum' in selected_features:
        # Fast momentum shift verified by order flow imbalance change
        df['choch_momentum'] = tick_imbalance.diff(3) * df['close'].pct_change(3)
        
    # 8. Break of Structure (BOS) Effort vs Result
    if 'bos_effort_result' in selected_features:
        # Effort (Tick Volume) / Result (Price Change) during trend continuation
        ret = abs(df['close'].pct_change())
        df['bos_effort_result'] = tick_vol.abs() / (ret + 1e-8)
        
    # 9. Inducement Sweep Volume
    if 'inducement_sweep_volume' in selected_features:
        # Fakeout volume proxy
        is_pin_bar = abs(df['open'] - df['close']) < ((df['high'] - df['low']) * 0.3)
        df['inducement_sweep_volume'] = np.where(is_pin_bar, tick_vol.abs(), 0)
        
    # 10. ICT Killzone Volatility
    if 'ict_killzone_volatility' in selected_features:
        if 'time' in df.columns:
            hour = df['time'].dt.hour
            # London (7-10) and NY (12-15) UTC
            is_killzone = hour.isin([7, 8, 9, 10, 12, 13, 14, 15])
            df['ict_killzone_volatility'] = np.where(is_killzone, tick_realized_vol, 0)
            
    return df
