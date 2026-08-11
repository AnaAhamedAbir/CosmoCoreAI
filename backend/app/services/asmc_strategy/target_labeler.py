import pandas as pd
import numpy as np

def label_asmc_targets(df: pd.DataFrame, htf_str: str, ltf_str: str) -> pd.DataFrame:
    """
    Simulates the ASMC MTF Strategy execution to generate ML targets (1 or 0).
    Uses 1:2 R:R based on ATR.
    """
    df['Target'] = np.nan
    
    # Require ATR
    if 'ATRr_14' not in df.columns:
        # Calculate standard ATR if missing
        df['tr0'] = abs(df['High'] - df['Low'])
        df['tr1'] = abs(df['High'] - df['Close'].shift())
        df['tr2'] = abs(df['Low'] - df['Close'].shift())
        df['tr'] = df[['tr0', 'tr1', 'tr2']].max(axis=1)
        df['atr'] = df['tr'].rolling(14).mean()
        atr_col = 'atr'
    else:
        atr_col = 'ATRr_14'
        
    # We will iterate through signals. Not the most vectorized, but safe for TP/SL simulation
    closes = df['Close'].values
    highs = df['High'].values
    lows = df['Low'].values
    bull_signals = df['ltf_bull_cisd'].values if 'ltf_bull_cisd' in df.columns else np.zeros(len(df))
    bear_signals = df['ltf_bear_cisd'].values if 'ltf_bear_cisd' in df.columns else np.zeros(len(df))
    atrs = df[atr_col].values
    
    targets = np.full(len(df), np.nan)
    lookahead_bars = 50 # Look ahead up to 50 bars for TP/SL resolution
    
    for i in range(len(df)):
        if bull_signals[i] == 1:
            entry = closes[i]
            risk = atrs[i] * 1.5
            sl = entry - risk
            tp = entry + (risk * 2) # 1:2 R:R
            
            # Look forward to see what hits first
            hit = 0
            for j in range(i+1, min(i+lookahead_bars, len(df))):
                if lows[j] <= sl:
                    hit = 0 # SL hit
                    break
                if highs[j] >= tp:
                    hit = 1 # TP hit
                    break
            targets[i] = hit
            
        elif bear_signals[i] == 1:
            entry = closes[i]
            risk = atrs[i] * 1.5
            sl = entry + risk
            tp = entry - (risk * 2) # 1:2 R:R
            
            # Look forward
            hit = 0
            for j in range(i+1, min(i+lookahead_bars, len(df))):
                if highs[j] >= sl:
                    hit = 0 # SL hit
                    break
                if lows[j] <= tp:
                    hit = 1 # TP hit
                    break
            targets[i] = hit
            
    df['Target'] = targets
    return df
