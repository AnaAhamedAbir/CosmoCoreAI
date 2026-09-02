from typing import Dict, Any, List
from app.services.ml_god_mode_features import calculate_god_mode_ml_features

class GodModeSignalEvaluator:
    """
    Evaluates the God Mode L2 score in real-time and checks if it passes 
    the given thresholds for Long or Short entries.
    """
    @staticmethod
    def evaluate(bids: List[List[float]], asks: List[List[float]], current_price: float, threshold_long: int = 80, threshold_short: int = -80) -> Dict[str, Any]:
        """
        Calculates God Mode score (-100 to +100) based on L2 Orderbook.
        
        Returns:
            dict containing:
            - score (int): The calculated score
            - signal (str): 'LONG', 'SHORT', or 'NEUTRAL'
            - passed (bool): True if score >= threshold_long OR score <= threshold_short
            - features (dict): Raw God Mode ML features
        """
        if not bids or not asks or current_price <= 0:
            return {"score": 0, "signal": "NEUTRAL", "passed": False, "features": None}
            
        features = calculate_god_mode_ml_features(bids, asks, current_price)
        
        score = 0
        
        # 1. Magnet Zones Analysis
        # Determine strongest magnet (intensity)
        mag_above_intensity = features.get("magnet_intensity_above", 0)
        mag_below_intensity = features.get("magnet_intensity_below", 0)
        
        if mag_above_intensity > mag_below_intensity:
            score += 40
        elif mag_below_intensity > mag_above_intensity:
            score -= 40
            
        # 2. Cascade Probabilities Analysis
        cascade_above = features.get("cascade_prob_above", 0)
        cascade_below = features.get("cascade_prob_below", 0)
        
        if cascade_above > cascade_below:
            score += 30
        elif cascade_below > cascade_above:
            score -= 30
            
        # 3. CVD Spoof Analysis
        cvd_spoof = features.get("cvd_spoof_state", 0)
        if cvd_spoof > 0:
            score += 30
        elif cvd_spoof < 0:
            score -= 30
            
        # Evaluate Signal
        signal = "NEUTRAL"
        passed = False
        
        if score >= threshold_long:
            signal = "LONG"
            passed = True
        elif score <= threshold_short:
            signal = "SHORT"
            passed = True
            
        return {
            "score": score,
            "signal": signal,
            "passed": passed,
            "features": features
        }
