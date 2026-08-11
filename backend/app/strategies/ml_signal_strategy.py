"""
ml_signal_strategy.py
─────────────────────────────────────────────────────────────
A Backtrader Strategy that replays pre-computed ML signals
on OHLCV data. Used for automated Post-Training Backtesting.

Design:
  - Signals (0 = Sell/Hold, 1 = Buy) are pre-computed by the
    ML predictor before the Backtrader run starts.
  - stop_loss and take_profit are configurable percentages.
  - The strategy simply reads the pre-attached signal array.
─────────────────────────────────────────────────────────────
"""

import backtrader as bt
import numpy as np


class MLSignalStrategy(bt.Strategy):
    """Backtrader strategy driven by pre-computed ML signals."""

    params = (
        ('signals', []),       # List[int] — 0 or 1, same length as data
        ('stop_loss', 2.0),    # Percent (e.g. 2.0 = 2%)
        ('take_profit', 4.0),  # Percent (e.g. 4.0 = 4%)
    )

    def __init__(self):
        self.signal_idx = 0
        self.entry_price = None
        self.order = None

    def next(self):
        # Guard against index overflow
        if self.signal_idx >= len(self.params.signals):
            return

        signal = self.params.signals[self.signal_idx]
        self.signal_idx += 1

        # ── Exit Logic (SL/TP) ─────────────────────────────────────
        if self.position:
            current_price = self.data.close[0]
            if self.entry_price and self.entry_price > 0:
                pct_change = (current_price - self.entry_price) / self.entry_price * 100

                if pct_change >= self.params.take_profit:
                    self.close()
                    self.entry_price = None
                    return

                if pct_change <= -self.params.stop_loss:
                    self.close()
                    self.entry_price = None
                    return

        # ── Entry Logic ────────────────────────────────────────────
        if signal == 1 and not self.position:
            self.buy()
            self.entry_price = self.data.close[0]

        elif signal == 0 and self.position:
            self.close()
            self.entry_price = None
