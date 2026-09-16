import logging
import math
from typing import List, Dict, Any, Tuple

logger = logging.getLogger(__name__)

class SmartMoneyTrajectoryService:
    def __init__(self):
        self._ema_alpha = 0.15
        self._smoothed_ask_force = 0.0
        self._smoothed_bid_force = 0.0
        self._current_direction = "NEUTRAL"
    def reset(self):
        self._smoothed_ask_force = 0.0
        self._smoothed_bid_force = 0.0
        self._current_direction = "NEUTRAL"

    def calculate_smart_trajectory(self, bids: List[Tuple[float, float]], asks: List[Tuple[float, float]], current_price: float, funding_rate: float) -> Dict[str, Any]:
        """
        Calculates the Smart Money AI Trajectory with Advanced Logics:
        1. Noise Filter (Exclude 0.5% range)
        2. 0.2% Price-Bin Clustering
        3. Force Calculation (Intensity / Distance)
        4. Funding Rate Sentiment Bias
        5. EMA Smoothing
        6. 52% Hysteresis Locking
        """
        if current_price <= 0:
            return {"target_price": 0, "strength": 0, "direction": "NEUTRAL"}
            
        cp = current_price
        
        # 1. Noise Filter: Exclude orders within 0.5% of current price
        filtered_bids = [b for b in bids if (cp - float(b[0])) / cp >= 0.005]
        filtered_asks = [a for a in asks if (float(a[0]) - cp) / cp >= 0.005]
        
        # 2. 0.2% Price-Bin Clustering
        bin_size = cp * 0.002
        bid_bins = {}
        for b in filtered_bids:
            price = float(b[0])
            vol = float(b[1]) * price # Convert base volume to quote volume (USD)
            # Round down to nearest bin
            bin_price = math.floor(price / bin_size) * bin_size
            bid_bins[bin_price] = bid_bins.get(bin_price, 0) + vol
            
        ask_bins = {}
        for a in filtered_asks:
            price = float(a[0])
            vol = float(a[1]) * price # Convert base volume to quote volume (USD)
            # Round up to nearest bin
            bin_price = math.ceil(price / bin_size) * bin_size
            ask_bins[bin_price] = ask_bins.get(bin_price, 0) + vol
            
        # Get top 5 clusters on both sides
        top_bid_clusters = sorted([{"price": p, "volume": v} for p, v in bid_bins.items()], key=lambda x: x["volume"], reverse=True)[:5]
        top_ask_clusters = sorted([{"price": p, "volume": v} for p, v in ask_bins.items()], key=lambda x: x["volume"], reverse=True)[:5]
        
        total_bids_liquidity = sum(c["volume"] for c in top_bid_clusters)
        total_asks_liquidity = sum(c["volume"] for c in top_ask_clusters)
        
        max_bid_vol = top_bid_clusters[0]["volume"] if top_bid_clusters else 1
        max_ask_vol = top_ask_clusters[0]["volume"] if top_ask_clusters else 1
        
        # Calculate raw force for each cluster (Intensity / Distance)
        raw_ask_force = 0.0
        best_ask_target = None
        highest_ask_vol = -1
        
        for cluster in top_ask_clusters:
            intensity = (cluster["volume"] / max_ask_vol) * 100
            if intensity > 30: # Only significant clusters
                distance_pct = abs(cluster["price"] - cp) / cp
                # Avoid division by zero, min distance is technically 0.005 due to filter
                cluster_force = cluster["volume"] / max(0.005, distance_pct)
                raw_ask_force += cluster_force
                
                # Keep track of highest volume cluster for target
                if cluster["volume"] > highest_ask_vol:
                    highest_ask_vol = cluster["volume"]
                    best_ask_target = cluster["price"]

        raw_bid_force = 0.0
        best_bid_target = None
        highest_bid_vol = -1
        
        for cluster in top_bid_clusters:
            intensity = (cluster["volume"] / max_bid_vol) * 100
            if intensity > 30:
                distance_pct = abs(cluster["price"] - cp) / cp
                cluster_force = cluster["volume"] / max(0.005, distance_pct)
                raw_bid_force += cluster_force
                
                if cluster["volume"] > highest_bid_vol:
                    highest_bid_vol = cluster["volume"]
                    best_bid_target = cluster["price"]

        # 3. Funding Rate Sentiment Bias
        # If funding is positive (Retail Longing), smart money might dump (Boost Bid Force / Shorts target)
        # If funding is negative (Retail Shorting), smart money might pump (Boost Ask Force / Longs target)
        if funding_rate > 0.0001: # 0.01%
            raw_bid_force *= 1.5
        elif funding_rate < -0.0001:
            raw_ask_force *= 1.5
            
        # 4. EMA Smoothing
        if self._smoothed_ask_force == 0.0 and self._smoothed_bid_force == 0.0:
            self._smoothed_ask_force = raw_ask_force
            self._smoothed_bid_force = raw_bid_force
        else:
            self._smoothed_ask_force = (raw_ask_force * self._ema_alpha) + (self._smoothed_ask_force * (1 - self._ema_alpha))
            self._smoothed_bid_force = (raw_bid_force * self._ema_alpha) + (self._smoothed_bid_force * (1 - self._ema_alpha))

        # 5. Hysteresis Locking (52% threshold)
        total_force = self._smoothed_ask_force + self._smoothed_bid_force
        if total_force == 0:
            self._current_direction = "NEUTRAL"
            return {
                "target_price": cp, "strength": 0, "direction": "NEUTRAL",
                "raw_bid_force": raw_bid_force, "raw_ask_force": raw_ask_force,
                "smoothed_bid_force": self._smoothed_bid_force, "smoothed_ask_force": self._smoothed_ask_force,
                "bid_dominance": 0.5, "ask_dominance": 0.5,
                "funding_rate": funding_rate,
                "total_bids_liquidity": total_bids_liquidity,
                "total_asks_liquidity": total_asks_liquidity
            }
            
        ask_dominance = self._smoothed_ask_force / total_force
        bid_dominance = self._smoothed_bid_force / total_force
        
        UP_THRESHOLD = 0.52
        DOWN_THRESHOLD = 0.52
        NEUTRAL_THRESHOLD = 0.48
        
        if self._current_direction == "NEUTRAL":
            if ask_dominance >= UP_THRESHOLD:
                self._current_direction = "UP"
            elif bid_dominance >= DOWN_THRESHOLD:
                self._current_direction = "DOWN"
        elif self._current_direction == "UP":
            if bid_dominance >= DOWN_THRESHOLD:
                self._current_direction = "DOWN"
            elif ask_dominance <= NEUTRAL_THRESHOLD:
                self._current_direction = "NEUTRAL"
        elif self._current_direction == "DOWN":
            if ask_dominance >= UP_THRESHOLD:
                self._current_direction = "UP"
            elif bid_dominance <= NEUTRAL_THRESHOLD:
                self._current_direction = "NEUTRAL"
                
        # 6. Final Target Selection
        trajectory = {
            "target_price": cp, "strength": 0, "direction": self._current_direction,
            "raw_bid_force": raw_bid_force, "raw_ask_force": raw_ask_force,
            "smoothed_bid_force": self._smoothed_bid_force, "smoothed_ask_force": self._smoothed_ask_force,
            "bid_dominance": bid_dominance, "ask_dominance": ask_dominance,
            "funding_rate": funding_rate,
            "total_bids_liquidity": total_bids_liquidity,
            "total_asks_liquidity": total_asks_liquidity
        }
        
        if self._current_direction == "UP":
            strength_val = min(100, int((ask_dominance - 0.5) * 200)) if ask_dominance > 0.5 else 10
            trajectory["strength"] = strength_val
            trajectory["target_price"] = best_ask_target if best_ask_target else cp
        elif self._current_direction == "DOWN":
            strength_val = min(100, int((bid_dominance - 0.5) * 200)) if bid_dominance > 0.5 else 10
            trajectory["strength"] = strength_val
            trajectory["target_price"] = best_bid_target if best_bid_target else cp
            
        return trajectory

smart_money_trajectory_service = SmartMoneyTrajectoryService()
