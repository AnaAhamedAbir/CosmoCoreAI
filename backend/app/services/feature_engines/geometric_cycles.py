import pandas as pd
import numpy as np
import pandas_ta as ta

def add_geometric_cycle_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Applies Geometric and Cycle overlays to the dataset.
    Uses strict non-repainting logic for ML compatibility.
    """
    try:
        # 1. Linear Regression Channel (Rolling to prevent lookahead bias)
        # We calculate the linear regression over a rolling window (e.g., 20) and project the endpoints
        linreg = ta.linreg(df['close'], length=20)
        if linreg is not None:
            df = pd.concat([df, linreg.astype(np.float32)], axis=1)
            
        # Calculate upper/lower channels based on rolling std dev of price relative to linreg
        rolling_std = df['close'].rolling(20).std()
        df['LinReg_Upper'] = (linreg + (2 * rolling_std)).astype(np.float32)
        df['LinReg_Lower'] = (linreg - (2 * rolling_std)).astype(np.float32)
        
        # 2. Pivot Points (Rolling Window Approximation for continuous ML data)
        # Standard pivots are usually daily, but for ML a rolling max/min over past N periods is more stable
        # P = (H + L + C) / 3
        df['Pivot_Point'] = ((df['high'].shift(1) + df['low'].shift(1) + df['close'].shift(1)) / 3).astype(np.float32)
        df['Pivot_R1'] = (2 * df['Pivot_Point'] - df['low'].shift(1)).astype(np.float32)
        df['Pivot_S1'] = (2 * df['Pivot_Point'] - df['high'].shift(1)).astype(np.float32)
        
        # 3. Non-Repainting Fractals (Williams)
        # A bullish fractal occurs when Low(t) < Low(t-1) & Low(t-2) and Low(t) < Low(t+1) & Low(t+2)
        # To avoid lookahead, we record the fractal at t+2 (when it's confirmed) but map it to current row as a signal
        bullish_fractal_cond = (df['low'].shift(2) < df['low'].shift(4)) & \
                               (df['low'].shift(2) < df['low'].shift(3)) & \
                               (df['low'].shift(2) < df['low'].shift(1)) & \
                               (df['low'].shift(2) < df['low'])
        
        bearish_fractal_cond = (df['high'].shift(2) > df['high'].shift(4)) & \
                               (df['high'].shift(2) > df['high'].shift(3)) & \
                               (df['high'].shift(2) > df['high'].shift(1)) & \
                               (df['high'].shift(2) > df['high'])
                               
        df['Fractal_Bull'] = bullish_fractal_cond.astype(np.float32)
        df['Fractal_Bear'] = bearish_fractal_cond.astype(np.float32)
        
        # 4. ZigZag & Fibonacci (Dynamic Lagged Rolling Implementation)
        # Standard ZigZag repaints. For ML, we use a rolling max/min approach to simulate established anchor points.
        rolling_max = df['high'].rolling(window=20).max()
        rolling_min = df['low'].rolling(window=20).min()
        
        # Fibonacci Retracement Levels based on rolling 20-period swing high/low
        diff = rolling_max - rolling_min
        df['Fib_0_236'] = (rolling_max - 0.236 * diff).astype(np.float32)
        df['Fib_0_382'] = (rolling_max - 0.382 * diff).astype(np.float32)
        df['Fib_0_618'] = (rolling_max - 0.618 * diff).astype(np.float32) # Golden Pocket
        df['Fib_0_786'] = (rolling_max - 0.786 * diff).astype(np.float32)
        
        # 5. Elliott Wave Oscillator (EWO)
        # EWO = SMA(Close, 5) - SMA(Close, 35)
        df['EWO'] = (ta.sma(df['close'], length=5) - ta.sma(df['close'], length=35)).astype(np.float32)
        
        # 6. Hurst Exponent (Simplified proxy for continuous ML feeding)
        # Actual Hurst requires long series R/S analysis. 
        # For ML, rolling standard deviation over mean proxy or variance ratio is used.
        # We'll use a variance ratio proxy: Var(20) / Var(10)
        var_10 = df['close'].rolling(10).var()
        var_20 = df['close'].rolling(20).var()
        df['Hurst_Proxy'] = (var_20 / (2 * var_10.replace(0, np.nan))).astype(np.float32)
        
        # 7. Gann Fan / Pitchfork (Proxies)
        # ML models don't "see" lines, they see rates of change. 
        # Gann angles correlate to 1x1, 2x1 time/price units. We proxy this via rolling momentum angles.
        df['Gann_Angle_Proxy'] = (np.arctan(df['close'].diff(1) / 1) * (180 / np.pi)).astype(np.float32)

        # 8. Candlestick Patterns (using ta.cdl_pattern)
        # We will add 3 of the most predictive ones: Doji, Engulfing, Hammer
        cdl = ta.cdl_pattern(df['open'], df['high'], df['low'], df['close'], name=["doji", "engulfing", "hammer"])
        if cdl is not None:
            df = pd.concat([df, cdl.astype(np.float32)], axis=1)
        
        # 9. Head & Shoulders Proxy
        # Complex to code accurately in vector; we proxy via 3 rolling peaks where middle is highest
        rolling_max_5 = df['high'].rolling(5).max()
        peak_1 = rolling_max_5.shift(15)
        peak_2 = rolling_max_5.shift(10)
        peak_3 = rolling_max_5.shift(5)
        # Condition: Peak 2 > Peak 1 and Peak 2 > Peak 3 (Head > Left and Right Shoulders)
        df['Head_Shoulders_Proxy'] = ((peak_2 > peak_1) & (peak_2 > peak_3) & (peak_1 > 0)).astype(np.float32)
        
        # 10. Harmonic Pattern Proxy (Gartley / Bat Ratio)
        # Proxy checking if recent retracements match 0.618 or 0.886
        swing_high = df['high'].rolling(10).max()
        swing_low = df['low'].rolling(10).min()
        retracement = (df['close'] - swing_low) / (swing_high - swing_low).replace(0, np.nan)
        df['Harmonic_0618_Proxy'] = (abs(retracement - 0.618) < 0.05).astype(np.float32)
        df['Harmonic_0886_Proxy'] = (abs(retracement - 0.886) < 0.05).astype(np.float32)

    except Exception as e:
        print(f"Error in geometric_cycles feature engineering: {e}")
        
    return df
