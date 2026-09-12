import pandas as pd
import pandas_ta as ta
import numpy as np

class ICTPowerOfThree:
    """
    ICT Power Of Three (PO3) Tracker
    Translates the Flux Charts Pine Script logic into a modular Python class.
    """
    def __init__(
        self,
        algorithm_mode="Small Manipulation",  # "Small Manipulation", "Short Accumulation", "Big Manipulation"
        breakout_method="Wick",               # "Close", "Wick"
        tpsl_method="Dynamic",                # "Dynamic", "Fixed"
        risk_amount="Normal",                 # "Highest", "High", "Normal", "Low", "Lowest"
        tp_percent=0.3,
        sl_percent=0.4,
        rr_ratio=0.86,
        atr_len=50
    ):
        self.algorithm_mode = algorithm_mode
        self.breakout_method = breakout_method
        self.tpsl_method = tpsl_method
        self.risk_amount = risk_amount
        self.tp_percent = tp_percent
        self.sl_percent = sl_percent
        self.rr_ratio = rr_ratio
        self.atr_len = atr_len
        self.accumulation_expand_mult = 0.5

        # Determine settings based on Algorithm Mode
        if self.algorithm_mode == "Small Manipulation":
            self.accumulation_length = 40
            self.accumulation_atr_mult = 5.0
            self.manipulation_atr_mult = 0.6
        elif self.algorithm_mode == "Short Accumulation":
            self.accumulation_length = 11
            self.accumulation_atr_mult = 2.0
            self.manipulation_atr_mult = 1.0
        else: # Big Manipulation
            self.accumulation_length = 11
            self.accumulation_atr_mult = 5.0
            self.manipulation_atr_mult = 1.0

        if self.risk_amount == "Highest":
            self.sl_atr_mult = 9.5
        elif self.risk_amount == "High":
            self.sl_atr_mult = 6.0
        elif self.risk_amount == "Normal":
            self.sl_atr_mult = 5.0
        elif self.risk_amount == "Low":
            self.sl_atr_mult = 4.0
        elif self.risk_amount == "Lowest":
            self.sl_atr_mult = 1.5
        else:
            self.sl_atr_mult = 6.5 # Custom default

        self.reset_state()

    def reset_state(self):
        # Current PO3 Object State
        self.state = "Waiting For Accumulation"
        self.accumulation_start_index = None
        self.accumulation_end_index = None
        self.accumulation_top = None
        self.accumulation_bottom = None
        self.accumulation_end_top = None
        self.accumulation_end_bottom = None

        self.manipulation_start_index = None
        self.manipulation_end_index = None
        self.manipulation_top = None
        self.manipulation_bottom = None
        self.manipulation_direction = None

        self.entry_time = None
        self.entry_price = None
        self.entry_type = None
        self.sl_target = None
        self.tp_target = None
        
        self.exit_price = None
        self.exit_time = None

        # To track multiple historical PO3s for chart drawing (if needed)
        self.po3_history = []

    def save_current_po3_and_reset(self, current_time=None):
        if self.accumulation_start_index is not None:
            # We convert timestamps to strings/iso format if they are datetimes for JSON serialization
            def format_ts(ts):
                if pd.isna(ts) or ts is None:
                    return None
                if isinstance(ts, (pd.Timestamp, pd.DatetimeIndex)):
                    return ts.isoformat()
                return str(ts)

            self.po3_history.append({
                "state": self.state,
                "acc_start": format_ts(self.accumulation_start_index),
                "acc_end": format_ts(self.accumulation_end_index),
                "acc_top": float(self.accumulation_top) if self.accumulation_top is not None else None,
                "acc_bottom": float(self.accumulation_bottom) if self.accumulation_bottom is not None else None,
                "man_start": format_ts(self.manipulation_start_index),
                "man_end": format_ts(self.manipulation_end_index),
                "man_top": float(self.manipulation_top) if self.manipulation_top is not None else None,
                "man_bottom": float(self.manipulation_bottom) if self.manipulation_bottom is not None else None,
                "entry_type": self.entry_type,
                "entry_price": float(self.entry_price) if self.entry_price is not None else None,
                "entry_time": format_ts(self.entry_time),
                "tp_target": float(self.tp_target) if self.tp_target is not None else None,
                "sl_target": float(self.sl_target) if self.sl_target is not None else None,
                "exit_price": float(self.exit_price) if self.exit_price is not None else None,
                "exit_time": format_ts(self.exit_time)
            })
        
        # Reset state logic
        self.state = "Waiting For Accumulation"
        self.accumulation_start_index = None
        self.accumulation_end_index = None
        self.accumulation_top = None
        self.accumulation_bottom = None
        self.accumulation_end_top = None
        self.accumulation_end_bottom = None

        self.manipulation_start_index = None
        self.manipulation_end_index = None
        self.manipulation_top = None
        self.manipulation_bottom = None
        self.manipulation_direction = None

        self.entry_time = None
        self.entry_price = None
        self.entry_type = None
        self.sl_target = None
        self.tp_target = None
        
        self.exit_price = None
        self.exit_time = None

    def calculate(self, df: pd.DataFrame):
        """
        Process a DataFrame of OHLCV data sequentially to find PO3 patterns.
        Expected columns: open, high, low, close.
        Returns the last state and a list of all identified PO3 zones.
        """
        if len(df) < self.atr_len:
            return {"state": "Not enough data", "signal": "NEUTRAL", "zones": []}
            
        atr_col = f"ATRr_{self.atr_len}"
        if atr_col not in df.columns:
            df.ta.atr(length=self.atr_len, append=True)
            atr_cols = [c for c in df.columns if str(c).startswith('ATR')]
            if atr_cols:
                atr_col = atr_cols[0]

        # Calculate Rolling Highest/Lowest for Accumulation
        highest_acc_col = df['high'].rolling(self.accumulation_length).max()
        lowest_acc_col = df['low'].rolling(self.accumulation_length).min()

        self.reset_state()
        
        last_signal = "NEUTRAL"

        for i in range(len(df)):
            row = df.iloc[i]
            current_time = df.index[i] if isinstance(df.index, pd.DatetimeIndex) else i
            
            high = row['high']
            low = row['low']
            close = row['close']
            atr = row.get(atr_col, 0)
            
            if pd.isna(atr) or atr == 0:
                continue

            highest_acc = highest_acc_col.iloc[i]
            lowest_acc = lowest_acc_col.iloc[i]

            high_breakout = high if self.breakout_method == "Wick" else close
            low_breakout = low if self.breakout_method == "Wick" else close

            if self.state == "Waiting For Accumulation":
                if not pd.isna(highest_acc) and not pd.isna(lowest_acc):
                    if (highest_acc - lowest_acc) <= (atr * self.accumulation_atr_mult):
                        self.state = "Waiting For Accumulation End"
                        self.accumulation_start_index = current_time
                        self.accumulation_end_index = current_time
                        self.accumulation_top = highest_acc + (atr * self.accumulation_expand_mult)
                        self.accumulation_bottom = lowest_acc - (atr * self.accumulation_expand_mult)
            
            elif self.state == "Waiting For Accumulation End":
                if high_breakout > self.accumulation_top or low_breakout < self.accumulation_bottom:
                    self.state = "Waiting For Manipulation"
                    self.accumulation_end_top = high_breakout
                    self.accumulation_end_bottom = low_breakout
                else:
                    self.accumulation_end_index = current_time
                    
            elif self.state == "Waiting For Manipulation":
                if current_time > self.accumulation_end_index:
                    if high_breakout > self.accumulation_top + (atr * self.manipulation_atr_mult):
                        self.state = "Waiting For Distribution"
                        self.manipulation_direction = "Bullish"
                        self.manipulation_start_index = self.accumulation_end_index
                        self.manipulation_end_index = current_time
                        self.manipulation_top = high_breakout
                        self.manipulation_bottom = self.accumulation_end_bottom
                    elif low_breakout < self.accumulation_bottom - (atr * self.manipulation_atr_mult):
                        self.state = "Waiting For Distribution"
                        self.manipulation_direction = "Bearish"
                        self.manipulation_start_index = self.accumulation_end_index
                        self.manipulation_end_index = current_time
                        self.manipulation_top = self.accumulation_end_top
                        self.manipulation_bottom = low_breakout

            elif self.state == "Waiting For Distribution":
                self.state = "Entry Taken"
                self.entry_time = current_time
                self.entry_price = close
                
                if self.manipulation_direction == "Bearish":
                    self.entry_type = "Long"
                    last_signal = "BUY"
                    if self.tpsl_method == "Fixed":
                        self.sl_target = self.entry_price * (1 - self.sl_percent / 100.0)
                        self.tp_target = self.entry_price * (1 + self.tp_percent / 100.0)
                    else:
                        self.sl_target = self.entry_price - atr * self.sl_atr_mult
                        self.tp_target = self.entry_price + (abs(self.entry_price - self.sl_target) * self.rr_ratio)
                else:
                    self.entry_type = "Short"
                    last_signal = "SELL"
                    if self.tpsl_method == "Fixed":
                        self.sl_target = self.entry_price * (1 + self.sl_percent / 100.0)
                        self.tp_target = self.entry_price * (1 - self.tp_percent / 100.0)
                    else:
                        self.sl_target = self.entry_price + atr * self.sl_atr_mult
                        self.tp_target = self.entry_price - (abs(self.entry_price - self.sl_target) * self.rr_ratio)

            elif self.state == "Entry Taken":
                if self.tpsl_method == "Fixed":
                    if self.entry_type == "Long" and ((high / self.entry_price) - 1) * 100 >= self.tp_percent:
                        self.exit_price = self.entry_price * (1 + self.tp_percent / 100.0)
                        self.exit_time = current_time
                        self.state = "Take Profit"
                    elif self.entry_type == "Short" and ((low / self.entry_price) - 1) * 100 <= -self.tp_percent:
                        self.exit_price = self.entry_price * (1 - self.tp_percent / 100.0)
                        self.exit_time = current_time
                        self.state = "Take Profit"
                        
                    if self.entry_type == "Long" and ((low / self.entry_price) - 1) * 100 <= -self.sl_percent:
                        self.exit_price = self.entry_price * (1 - self.sl_percent / 100.0)
                        self.exit_time = current_time
                        self.state = "Stop Loss"
                    elif self.entry_type == "Short" and ((high / self.entry_price) - 1) * 100 >= self.sl_percent:
                        self.exit_price = self.entry_price * (1 + self.sl_percent / 100.0)
                        self.exit_time = current_time
                        self.state = "Stop Loss"
                else:
                    if self.entry_type == "Long" and high >= self.tp_target:
                        self.exit_price = self.tp_target
                        self.exit_time = current_time
                        self.state = "Take Profit"
                    elif self.entry_type == "Short" and low <= self.tp_target:
                        self.exit_price = self.tp_target
                        self.exit_time = current_time
                        self.state = "Take Profit"
                        
                    if self.entry_type == "Long" and low <= self.sl_target:
                        self.exit_price = self.sl_target
                        self.exit_time = current_time
                        self.state = "Stop Loss"
                    elif self.entry_type == "Short" and high >= self.sl_target:
                        self.exit_price = self.sl_target
                        self.exit_time = current_time
                        self.state = "Stop Loss"
                
                if self.state in ["Take Profit", "Stop Loss"]:
                    self.save_current_po3_and_reset(current_time)
                    last_signal = "NEUTRAL"
                    
        # Add the ongoing PO3 to history as well to return current drawing state
        if self.state != "Waiting For Accumulation":
            # Save it temporarily to get the latest zone info
            temp_state = self.state
            self.save_current_po3_and_reset()
            # If we want to restore we can, but since the df is processed entirely, it's fine.

        # If currently Entry Taken, determine signal
        current_signal = "NEUTRAL"
        if len(self.po3_history) > 0:
            last_po3 = self.po3_history[-1]
            if last_po3['state'] == "Entry Taken":
                current_signal = "BUY" if last_po3['entry_type'] == "Long" else "SELL"
            else:
                current_signal = "NEUTRAL"

        return {
            "state": self.state if len(self.po3_history) == 0 else self.po3_history[-1]['state'],
            "signal": current_signal,
            "zones": self.po3_history
        }
