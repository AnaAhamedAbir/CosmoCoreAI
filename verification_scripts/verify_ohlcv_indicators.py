"""
=====================================================================
OHLCV Feature Engineering — Indicator Verification Script
Checks every indicator in the INDICATOR_REGISTRY to ensure they
all calculate correctly without crashing.
=====================================================================
"""

import pandas as pd
import numpy as np
import pandas_ta as ta
import sys

# ─────────────────────────────────────────────
# STEP 1: Generate realistic mock OHLCV data
# (same shape as Binance CCXT response)
# ─────────────────────────────────────────────
np.random.seed(42)
n = 300  # 300 candles — enough for all lookback periods

close = 40000 + np.cumsum(np.random.randn(n) * 200)
close = np.abs(close)
high  = close + np.abs(np.random.randn(n) * 150)
low   = close - np.abs(np.random.randn(n) * 150)
open_ = close + np.random.randn(n) * 80
volume = np.abs(np.random.randn(n) * 500 + 2000)

df = pd.DataFrame({
    "Open":   open_,
    "High":   high,
    "Low":    low,
    "Close":  close,
    "Volume": volume
}, index=pd.date_range("2024-01-01", periods=n, freq="1h"))

print(f"\n{'='*60}")
print(f"  OHLCV Indicator Verification Script")
print(f"{'='*60}")
print(f"  Mock Data: {n} candles | Shape: {df.shape}")
print(f"{'='*60}\n")

# ─────────────────────────────────────────────
# STEP 2: Define the SAME INDICATOR_REGISTRY
# as in ml_training_engine.py
# ─────────────────────────────────────────────
INDICATOR_REGISTRY = {
    # Momentum
    "RSI":              lambda d: d.ta.rsi(append=True),
    "Stoch":            lambda d: d.ta.stoch(append=True),
    "ROC":              lambda d: d.ta.roc(append=True),
    "CCI":              lambda d: d.ta.cci(append=True),
    "WillR":            lambda d: d.ta.willr(append=True),
    "MFI":              lambda d: d.ta.mfi(append=True),
    # Trend
    "MACD":             lambda d: d.ta.macd(append=True),
    "EMA":              lambda d: d.ta.ema(append=True),
    "SMA":              lambda d: d.ta.sma(append=True),
    "ADX":              lambda d: d.ta.adx(append=True),
    "Supertrend":       lambda d: d.ta.supertrend(append=True),
    "Parabolic SAR":    lambda d: d.ta.psar(append=True),
    # Volatility
    "BBANDS":           lambda d: d.ta.bbands(append=True),
    "ATR":              lambda d: d.ta.atr(append=True),
    "Keltner Channel":  lambda d: d.ta.kc(append=True),
    "Donchian Channel": lambda d: d.ta.donchian(append=True),
    # Volume
    "OBV":              lambda d: d.ta.obv(append=True),
    "VWAP":             lambda d: d.ta.vwap(append=True),
    "CMF":              lambda d: d.ta.cmf(append=True),
    "ADOSC":            lambda d: d.ta.adosc(append=True),
}

# ─────────────────────────────────────────────
# STEP 3: Run each indicator & report result
# ─────────────────────────────────────────────
results = []
PASS = "✅ PASS"
FAIL = "❌ FAIL"

for name, func in INDICATOR_REGISTRY.items():
    test_df = df.copy()
    cols_before = set(test_df.columns)
    try:
        func(test_df)
        cols_after = set(test_df.columns)
        new_cols = cols_after - cols_before

        if not new_cols:
            status = FAIL
            detail = "No new columns were added to DataFrame"
            sample = "N/A"
        else:
            # Check for all-NaN columns (useless output)
            all_nan = [c for c in new_cols if test_df[c].isna().all()]
            if all_nan:
                status = FAIL
                detail = f"Columns are all-NaN: {all_nan}"
                sample = "NaN"
            else:
                non_nan_cols = [c for c in new_cols if not test_df[c].isna().all()]
                last_vals = {c: round(float(test_df[c].dropna().iloc[-1]), 4) for c in non_nan_cols}
                status = PASS
                detail = f"Generated {len(new_cols)} column(s): {sorted(new_cols)}"
                sample = str(last_vals)

    except Exception as e:
        status = FAIL
        detail = f"Exception: {str(e)}"
        sample = "N/A"

    results.append((name, status, detail, sample))

# ─────────────────────────────────────────────
# STEP 4: Print Summary Table
# ─────────────────────────────────────────────
passed = [r for r in results if PASS in r[1]]
failed = [r for r in results if FAIL in r[1]]

print(f"{'Indicator':<20} {'Status':<10} {'Detail'}")
print("-" * 90)

for name, status, detail, sample in results:
    short_detail = detail[:65] + "..." if len(detail) > 65 else detail
    print(f"  {name:<18} {status:<10} {short_detail}")
    if PASS in status:
        print(f"  {'':18} {'':10} Last values → {sample[:80]}")
    print()

# ─────────────────────────────────────────────
# STEP 5: Final Summary
# ─────────────────────────────────────────────
print(f"\n{'='*60}")
print(f"  FINAL RESULT: {len(passed)}/{len(results)} Indicators Passed")
print(f"  ✅ Passed : {len(passed)}")
print(f"  ❌ Failed : {len(failed)}")
if failed:
    print(f"\n  Failed Indicators:")
    for name, _, detail, _ in failed:
        print(f"    → {name}: {detail}")
print(f"{'='*60}\n")

# Exit with error code if any failed (useful for CI)
if failed:
    sys.exit(1)
