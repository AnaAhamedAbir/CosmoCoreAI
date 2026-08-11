import pandas as pd
import numpy as np
import pandas_ta as ta

def add_trend_momentum_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Applies Advanced Trend & Momentum indicators to the dataset in a vectorized, RAM-efficient manner.
    Uses pandas-ta and numpy for calculation.
    """
    try:
        # 1. Ichimoku Cloud
        ichimoku, _ = ta.ichimoku(df['high'], df['low'], df['close'])
        if ichimoku is not None:
            df = pd.concat([df, ichimoku.astype(np.float32)], axis=1)
            
        # 2. Hull Moving Average (HMA)
        df['HMA_9'] = ta.hma(df['close'], length=9).astype(np.float32)
        
        # 3. Aroon
        aroon = ta.aroon(df['high'], df['low'], length=14)
        if aroon is not None:
            df = pd.concat([df, aroon.astype(np.float32)], axis=1)
            
        # 4. Guppy Multiple Moving Average (GMMA)
        short_emas = [3, 5, 8, 10, 12, 15]
        long_emas = [30, 35, 40, 45, 50, 60]
        for p in short_emas:
            df[f'Guppy_Short_EMA_{p}'] = ta.ema(df['close'], length=p).astype(np.float32)
        for p in long_emas:
            df[f'Guppy_Long_EMA_{p}'] = ta.ema(df['close'], length=p).astype(np.float32)
            
        # 5. TRIX
        trix = ta.trix(df['close'], length=15)
        if trix is not None:
            df = pd.concat([df, trix.astype(np.float32)], axis=1)
            
        # 6. Awesome Oscillator (AO)
        df['AO'] = ta.ao(df['high'], df['low']).astype(np.float32)
        
        # 7. Momentum (MOM)
        df['MOM_10'] = ta.mom(df['close'], length=10).astype(np.float32)
        
        # 8. Relative Vigor Index (RVI)
        rvi = ta.rvi(df['open'], df['high'], df['low'], df['close']) # length is usually default 14 or not needed
        if rvi is not None:
            df = pd.concat([df, rvi.astype(np.float32)], axis=1)
            
        # 9. Ultimate Oscillator
        df['UO_7_14_28'] = ta.uo(df['high'], df['low'], df['close']).astype(np.float32)
        
        # 10. True Strength Index (TSI)
        tsi = ta.tsi(df['close'], fast=13, slow=25)
        if tsi is not None:
            df = pd.concat([df, tsi.astype(np.float32)], axis=1)
            
        # 11. Stochastic RSI
        stochrsi = ta.stochrsi(df['close'], length=14, rsi_length=14, k=3, d=3)
        if stochrsi is not None:
            df = pd.concat([df, stochrsi.astype(np.float32)], axis=1)
            
        # 12. Know Sure Thing (KST)
        kst = ta.kst(df['close'])
        if kst is not None:
            df = pd.concat([df, kst.astype(np.float32)], axis=1)
            
        # 13. PPO
        ppo = ta.ppo(df['close'], fast=12, slow=26, signal=9)
        if ppo is not None:
            df = pd.concat([df, ppo.astype(np.float32)], axis=1)
            
        # 14. DPO
        df['DPO_20'] = ta.dpo(df['close'], length=20).astype(np.float32)
        
        # 15. Fisher Transform
        fisher = ta.fisher(df['high'], df['low'], length=9)
        if fisher is not None:
            df = pd.concat([df, fisher.astype(np.float32)], axis=1)
            
        # 16. Schaff Trend Cycle (STC)
        stc = ta.stc(df['close'], tclength=10, fast=23, slow=50)
        if stc is not None:
            df = pd.concat([df, stc.astype(np.float32)], axis=1)
            
        # 17. Center of Gravity (COG)
        df['COG_10'] = ta.cg(df['close'], length=10).astype(np.float32)
        
        # 18. Coppock Curve
        df['Coppock_11_14_10'] = ta.coppock(df['close'], length1=11, length2=14, length3=10).astype(np.float32)
        
        # 19. Vortex Indicator
        vortex = ta.vortex(df['high'], df['low'], df['close'], length=14)
        if vortex is not None:
            df = pd.concat([df, vortex.astype(np.float32)], axis=1)
            
        # 20. McGinley Dynamic (Custom implementation as it's rarely in ta libs)
        ema_mcg = df['close'].ewm(span=14, adjust=False).mean()
        df['McGinley_14'] = ema_mcg.astype(np.float32) # Simplified proxy
        
        # 21. Williams Alligator
        # Jaw = 13 SMA offset 8, Teeth = 8 SMA offset 5, Lips = 5 SMA offset 3
        df['Alligator_Jaw'] = ta.sma(df['close'], length=13).shift(8).astype(np.float32)
        df['Alligator_Teeth'] = ta.sma(df['close'], length=8).shift(5).astype(np.float32)
        df['Alligator_Lips'] = ta.sma(df['close'], length=5).shift(3).astype(np.float32)

        # 22. Connors RSI (CRSI) = (RSI + Up/Down Streak RSI + ROC) / 3
        # Since pandas-ta doesn't have CRSI natively in all versions, we build a proxy
        rsi_3 = ta.rsi(df['close'], length=3)
        roc_100 = ta.roc(df['close'], length=100)
        # Streak (simplified proxy)
        streak = np.where(df['close'] > df['close'].shift(1), 1, np.where(df['close'] < df['close'].shift(1), -1, 0))
        streak_s = pd.Series(streak, index=df.index).rolling(2).sum() # basic streak proxy
        streak_rsi = ta.rsi(streak_s, length=2)
        
        if rsi_3 is not None and roc_100 is not None and streak_rsi is not None:
            df['CRSI_3_2_100'] = ((rsi_3 + streak_rsi + roc_100) / 3).astype(np.float32)

    except Exception as e:
        print(f"Error in trend_momentum feature engineering: {e}")
        
    return df
