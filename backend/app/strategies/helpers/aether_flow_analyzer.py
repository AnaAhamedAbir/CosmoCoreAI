import math
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class AetherFlowAnalyzer:
    """
    A unified analyzer combining UT Bot Alerts, Supertrend, SMC (Swing Points, CHoCH, BoS), FVGs, Hull Suite, and Order Blocks.
    Designed to process OHLCV data and output structured data for both the Trading Engine and Frontend Renderer.
    """
    def __init__(self, 
                 ut_sensitivity: float = 2.0, 
                 ut_atr_period: int = 6,
                 st_multiplier: float = 3.0,
                 st_atr_period: int = 10,
                 smc_length: int = 5,
                 ob_length: int = 5,
                 hull_length: int = 55,
                 hull_mode: str = "Hma"):
        self.ut_sensitivity = ut_sensitivity
        self.ut_atr_period = ut_atr_period
        self.st_multiplier = st_multiplier
        self.st_atr_period = st_atr_period
        self.smc_length = smc_length
        self.ob_length = ob_length
        self.hull_length = hull_length
        self.hull_mode = hull_mode

    def analyze(self, data: List[Dict[str, float]]) -> Dict[str, Any]:
        n = len(data)
        if n == 0:
            return {}

        result = {
            "ut_bot": [],
            "supertrend": [],
            "smc": {"swing_highs": [], "swing_lows": [], "bos_choch": []},
            "fvgs": [],
            "order_blocks": {"bullish": [], "bearish": []},
            "three_bar_reversal": [],
            "hull_suite": [],
            "auto_fibo": {}
        }

        # 1. Supertrend Calculation
        result["supertrend"] = self._calc_supertrend(data)
        
        # 2. UT Bot Calculation
        result["ut_bot"] = self._calc_ut_bot(data)

        # 3. SMC Swing Points & Market Structure (BOS/CHoCH)
        result["smc"] = self._calc_smc(data)

        # 4. FVGs with Mitigation
        result["fvgs"] = self._calc_fvg(data)

        # 5. Order Blocks (LuxAlgo Style)
        result["order_blocks"] = self._calc_order_blocks(data)

        # 6. Three-Bar Reversal Patterns
        result["three_bar_reversal"] = self._calc_three_bar_reversal(data)

        # 7. Hull Suite
        result["hull_suite"] = self._calc_hull_suite(data)

        # 8. Auto Fibonacci (Based on latest SMC Swing Points)
        result["auto_fibo"] = self._calc_auto_fibo(result["smc"])

        # Optional Signal Filtering Logic
        self._apply_double_confirmation(result)

        return result

    # --- MATH HELPERS ---
    def _sma(self, values: List[float], period: int) -> List[float]:
        n = len(values)
        res = [0.0] * n
        for i in range(period - 1, n):
            res[i] = sum(values[i-period+1:i+1]) / period
        return res

    def _wma(self, values: List[float], period: int) -> List[float]:
        n = len(values)
        res = [0.0] * n
        norm = period * (period + 1) / 2.0
        for i in range(period - 1, n):
            wsum = 0.0
            for j in range(period):
                wsum += values[i - j] * (period - j)
            res[i] = wsum / norm
        return res

    def _ema(self, values: List[float], period: int) -> List[float]:
        n = len(values)
        res = [0.0] * n
        if n == 0: return res
        alpha = 2.0 / (period + 1)
        res[0] = values[0]
        for i in range(1, n):
            res[i] = alpha * values[i] + (1 - alpha) * res[i-1]
        return res

    # --- INDICATORS ---
    def _calc_hull_suite(self, data: List[Dict[str, float]]) -> List[Dict[str, Any]]:
        n = len(data)
        length = self.hull_length
        src = [d['close'] for d in data]

        if n <= length:
            return []

        hull_vals = [0.0] * n

        if self.hull_mode == "Hma":
            # wma(2 * wma(src, len/2) - wma(src, len), sqrt(len))
            len_half = int(length / 2)
            wma_half = self._wma(src, len_half)
            wma_full = self._wma(src, length)
            diff = [2 * wma_half[i] - wma_full[i] for i in range(n)]
            hull_vals = self._wma(diff, int(math.sqrt(length)))
        elif self.hull_mode == "Ehma":
            # ema(2 * ema(src, len/2) - ema(src, len), sqrt(len))
            len_half = int(length / 2)
            ema_half = self._ema(src, len_half)
            ema_full = self._ema(src, length)
            diff = [2 * ema_half[i] - ema_full[i] for i in range(n)]
            hull_vals = self._ema(diff, int(math.sqrt(length)))
        elif self.hull_mode == "Thma":
            # wma(wma(src, len/3)*3 - wma(src, len/2) - wma(src, len), len)
            len_third = int(length / 3)
            len_half = int(length / 2)
            wma_third = self._wma(src, len_third)
            wma_half = self._wma(src, len_half)
            wma_full = self._wma(src, length)
            diff = [3 * wma_third[i] - wma_half[i] - wma_full[i] for i in range(n)]
            hull_vals = self._wma(diff, length)

        res = []
        for i in range(n):
            if hull_vals[i] != 0.0:
                trend = "bullish"
                if i >= 2 and hull_vals[i] < hull_vals[i-2]:
                    trend = "bearish"
                res.append({
                    "time": data[i]['time'],
                    "value": hull_vals[i],
                    "trend": trend
                })
        return res

    def _calc_three_bar_reversal(self, data: List[Dict[str, float]]) -> List[Dict[str, Any]]:
        n = len(data)
        res = []
        for i in range(2, n):
            # Bullish Reversal
            # (close[2] < open[2]) and (low[1] < low[2]) and (high[1] < high[2]) and (close[1] < open[1]) and (close > open) and (high > high[2])
            is_bull = (data[i-2]['close'] < data[i-2]['open'] and 
                       data[i-1]['low'] < data[i-2]['low'] and 
                       data[i-1]['high'] < data[i-2]['high'] and 
                       data[i-1]['close'] < data[i-1]['open'] and 
                       data[i]['close'] > data[i]['open'] and 
                       data[i]['high'] > data[i-2]['high'])
            
            # Bearish Reversal
            # (close[2] > open[2]) and (high[1] > high[2]) and (low[1] > low[2]) and (close[1] > open[1]) and (close < open) and (low < low[2])
            is_bear = (data[i-2]['close'] > data[i-2]['open'] and 
                       data[i-1]['high'] > data[i-2]['high'] and 
                       data[i-1]['low'] > data[i-2]['low'] and 
                       data[i-1]['close'] > data[i-1]['open'] and 
                       data[i]['close'] < data[i]['open'] and 
                       data[i]['low'] < data[i-2]['low'])

            if is_bull:
                res.append({"time": data[i]['time'], "type": "bullish", "price": data[i]['low']})
            elif is_bear:
                res.append({"time": data[i]['time'], "type": "bearish", "price": data[i]['high']})
        return res

    def _calc_order_blocks(self, data: List[Dict[str, float]]) -> Dict[str, List]:
        # Simple volume pivot OB logic
        length = self.ob_length
        n = len(data)
        bullish_obs = []
        bearish_obs = []

        if n <= length * 2:
            return {"bullish": [], "bearish": []}

        for i in range(length, n - length):
            # Check for swing low (Bullish OB candidate)
            is_swing_low = True
            is_swing_high = True
            for j in range(1, length + 1):
                if data[i - j]['low'] < data[i]['low'] or data[i + j]['low'] < data[i]['low']:
                    is_swing_low = False
                if data[i - j]['high'] > data[i]['high'] or data[i + j]['high'] > data[i]['high']:
                    is_swing_high = False

            # Bearish down-close candle before a strong up move
            if is_swing_low and data[i]['close'] < data[i]['open']:
                bullish_obs.append({
                    "time": data[i]['time'],
                    "top": data[i]['high'],
                    "bottom": data[i]['low'],
                    "avg": (data[i]['high'] + data[i]['low']) / 2,
                    "mitigated": False
                })
            
            # Bullish up-close candle before a strong down move
            if is_swing_high and data[i]['close'] > data[i]['open']:
                bearish_obs.append({
                    "time": data[i]['time'],
                    "top": data[i]['high'],
                    "bottom": data[i]['low'],
                    "avg": (data[i]['high'] + data[i]['low']) / 2,
                    "mitigated": False
                })

        # Mitigation pass
        for i in range(n):
            c_low = data[i]['low']
            c_high = data[i]['high']
            c_time = data[i]['time']
            
            for ob in bullish_obs:
                if not ob['mitigated'] and c_time > ob['time'] and c_low < ob['bottom']:
                    ob['mitigated'] = True
            
            for ob in bearish_obs:
                if not ob['mitigated'] and c_time > ob['time'] and c_high > ob['top']:
                    ob['mitigated'] = True

        return {
            "bullish": [ob for ob in bullish_obs if not ob['mitigated']][-5:], # Keep last 5 valid
            "bearish": [ob for ob in bearish_obs if not ob['mitigated']][-5:]
        }

    def _calc_supertrend(self, data: List[Dict[str, float]]) -> List[Dict[str, Any]]:
        n = len(data)
        period = self.st_atr_period
        multiplier = self.st_multiplier
        if n <= period: return []

        trs = [0.0] * n
        for i in range(1, n):
            h, l, pc = data[i]['high'], data[i]['low'], data[i-1]['close']
            trs[i] = max(h - l, abs(h - pc), abs(l - pc))

        atrs = [0.0] * n
        for i in range(period, n):
            atrs[i] = sum(trs[i-period+1:i+1]) / period

        st_result = []
        basic_ub = [0.0] * n
        basic_lb = [0.0] * n
        final_ub = [0.0] * n
        final_lb = [0.0] * n
        supertrend = [0.0] * n
        trend = [1] * n

        for i in range(period, n):
            hl2 = (data[i]['high'] + data[i]['low']) / 2
            basic_ub[i] = hl2 + (multiplier * atrs[i])
            basic_lb[i] = hl2 - (multiplier * atrs[i])

            if i == period:
                final_ub[i] = basic_ub[i]
                final_lb[i] = basic_lb[i]
            else:
                final_ub[i] = basic_ub[i] if basic_ub[i] < final_ub[i-1] or data[i-1]['close'] > final_ub[i-1] else final_ub[i-1]
                final_lb[i] = basic_lb[i] if basic_lb[i] > final_lb[i-1] or data[i-1]['close'] < final_lb[i-1] else final_lb[i-1]

            if i == period:
                supertrend[i] = final_ub[i]
                trend[i] = 1
            else:
                if supertrend[i-1] == final_ub[i-1] and data[i]['close'] < final_ub[i]:
                    supertrend[i] = final_ub[i]
                    trend[i] = -1
                elif supertrend[i-1] == final_ub[i-1] and data[i]['close'] > final_ub[i]:
                    supertrend[i] = final_lb[i]
                    trend[i] = 1
                elif supertrend[i-1] == final_lb[i-1] and data[i]['close'] > final_lb[i]:
                    supertrend[i] = final_lb[i]
                    trend[i] = 1
                elif supertrend[i-1] == final_lb[i-1] and data[i]['close'] < final_lb[i]:
                    supertrend[i] = final_ub[i]
                    trend[i] = -1
                else:
                    supertrend[i] = supertrend[i-1]
                    trend[i] = trend[i-1]

            st_result.append({
                "time": data[i]['time'],
                "value": supertrend[i],
                "trend": "bullish" if trend[i] == 1 else "bearish"
            })
            
        return st_result

    def _calc_ut_bot(self, data: List[Dict[str, float]]) -> List[Dict[str, Any]]:
        c = self.ut_atr_period
        a = self.ut_sensitivity
        n = len(data)
        if n <= c: return []

        trs = [0.0] * n
        for i in range(1, n):
            h, l, pc = data[i]['high'], data[i]['low'], data[i - 1]['close']
            trs[i] = max(h - l, abs(h - pc), abs(l - pc))

        atrs = [0.0] * n
        tr_sum = sum(trs[1:c+1])
        atrs[c] = tr_sum / c
        alpha = 1.0 / c
        for i in range(c + 1, n):
            atrs[i] = alpha * trs[i] + (1 - alpha) * atrs[i - 1]

        x_atr_trailing_stop = 0.0
        pos = 0
        ut_result = []

        for i in range(1, n):
            src = data[i]['close']
            src1 = data[i - 1]['close']
            n_loss = a * atrs[i]
            
            new_x_atr_trailing_stop = x_atr_trailing_stop
            if src > x_atr_trailing_stop and src1 > x_atr_trailing_stop:
                new_x_atr_trailing_stop = max(x_atr_trailing_stop, src - n_loss)
            elif src < x_atr_trailing_stop and src1 < x_atr_trailing_stop:
                new_x_atr_trailing_stop = min(x_atr_trailing_stop, src + n_loss)
            elif src > x_atr_trailing_stop:
                new_x_atr_trailing_stop = src - n_loss
            else:
                new_x_atr_trailing_stop = src + n_loss

            new_pos = pos
            if src1 < x_atr_trailing_stop and src > x_atr_trailing_stop:
                new_pos = 1
            elif src1 > x_atr_trailing_stop and src < x_atr_trailing_stop:
                new_pos = -1
                
            above = (src > new_x_atr_trailing_stop) and (src1 <= x_atr_trailing_stop)
            below = (src < new_x_atr_trailing_stop) and (src1 >= x_atr_trailing_stop)
            
            buy = (src > new_x_atr_trailing_stop) and above
            sell = (src < new_x_atr_trailing_stop) and below
            
            x_atr_trailing_stop = new_x_atr_trailing_stop
            pos = new_pos

            if i >= c:
                ut_result.append({
                    "time": data[i]['time'],
                    "trailing_stop": x_atr_trailing_stop,
                    "trend": "bullish" if pos == 1 else "bearish",
                    "buy_signal": buy,
                    "sell_signal": sell
                })

        return ut_result

    def _calc_smc(self, data: List[Dict[str, float]]) -> Dict[str, List]:
        length = self.smc_length
        n = len(data)
        swing_highs = []
        swing_lows = []
        bos_choch = []

        if n <= length * 2:
            return {"swing_highs": [], "swing_lows": [], "bos_choch": []}

        # Track state for BoS/CHoCH
        upaxis = 0.0
        dnaxis = 0.0
        moving = 0
        upside = 1
        downside = 1

        for i in range(length, n - length):
            is_swing_high = True
            is_swing_low = True
            current_high = data[i]['high']
            current_low = data[i]['low']

            for j in range(1, length + 1):
                if data[i - j]['high'] > current_high or data[i + j]['high'] > current_high:
                    is_swing_high = False
                if data[i - j]['low'] < current_low or data[i + j]['low'] < current_low:
                    is_swing_low = False

            if is_swing_high:
                swing_type = "HH" if current_high > upaxis else "LH"
                swing_highs.append({"time": data[i]['time'], "price": current_high, "index": i, "type": swing_type})
                upaxis = current_high
                upside = 1
                
            if is_swing_low:
                swing_type = "LL" if current_low < (dnaxis if dnaxis != 0 else 1e9) else "HL"
                swing_lows.append({"time": data[i]['time'], "price": current_low, "index": i, "type": swing_type})
                dnaxis = current_low
                downside = 1

            # Check for BoS / CHoCH crossover
            close = data[i]['close']
            if upaxis != 0 and close > upaxis and upside != 0:
                label = "CHoCH" if moving < 0 else "BoS"
                bos_choch.append({"time": data[i]['time'], "price": upaxis, "type": "bullish", "label": label})
                upside = 0
                moving = 1

            if dnaxis != 0 and close < dnaxis and downside != 0:
                label = "CHoCH" if moving > 0 else "BoS"
                bos_choch.append({"time": data[i]['time'], "price": dnaxis, "type": "bearish", "label": label})
                downside = 0
                moving = -1

        return {"swing_highs": swing_highs, "swing_lows": swing_lows, "bos_choch": bos_choch}

    def _calc_auto_fibo(self, smc_data: Dict[str, List]) -> Dict[str, Any]:
        highs = smc_data.get("swing_highs", [])
        lows = smc_data.get("swing_lows", [])
        
        if not highs or not lows:
            return {}
            
        last_high = highs[-1]
        last_low = lows[-1]
        
        is_bullish = last_high['time'] > last_low['time']
        
        highest = last_high['price']
        lowest = last_low['price']
        diff = highest - lowest
        
        if diff <= 0:
            return {}
            
        # Standard fibonacci levels
        fib_levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.618]
        
        levels_data = []
        for level in fib_levels:
            if is_bullish:
                # Retracement from high to low
                price = highest - (diff * level)
            else:
                # Retracement from low to high
                price = lowest + (diff * level)
                
            levels_data.append({
                "level": level,
                "price": price
            })
            
        return {
            "start_time": min(last_high['time'], last_low['time']),
            "end_time": max(last_high['time'], last_low['time']),
            "highest": highest,
            "lowest": lowest,
            "is_bullish": is_bullish,
            "levels": levels_data
        }

    def _calc_fvg(self, data: List[Dict[str, float]]) -> List[Dict[str, Any]]:
        n = len(data)
        fvgs = []
        for i in range(2, n):
            # Bullish FVG
            if data[i]['low'] > data[i-2]['high']:
                fvgs.append({
                    "time": data[i-1]['time'],
                    "type": "bullish",
                    "top": data[i]['low'],
                    "bottom": data[i-2]['high'],
                    "mitigated": False
                })
            # Bearish FVG
            elif data[i]['high'] < data[i-2]['low']:
                fvgs.append({
                    "time": data[i-1]['time'],
                    "type": "bearish",
                    "top": data[i-2]['low'],
                    "bottom": data[i]['high'],
                    "mitigated": False
                })
                
        # Mitigation pass
        for i in range(n):
            c_low = data[i]['low']
            c_high = data[i]['high']
            c_time = data[i]['time']
            for fvg in fvgs:
                if not fvg['mitigated'] and c_time > fvg['time']:
                    if fvg['type'] == 'bullish' and c_low < fvg['top']:
                        fvg['mitigated'] = True
                    elif fvg['type'] == 'bearish' and c_high > fvg['bottom']:
                        fvg['mitigated'] = True

        return [fvg for fvg in fvgs if not fvg['mitigated']]

    def _apply_double_confirmation(self, result: Dict[str, Any]):
        st_map = {item['time']: item['trend'] for item in result['supertrend']}
        for ut in result['ut_bot']:
            t = ut['time']
            st_trend = st_map.get(t)
            ut['filtered_buy'] = ut['buy_signal'] and st_trend == 'bullish'
            ut['filtered_sell'] = ut['sell_signal'] and st_trend == 'bearish'
