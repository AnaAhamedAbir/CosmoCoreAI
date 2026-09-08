import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class BookmapHeatmapService:
    def process_orderbook(self, bids: List[List[float]], asks: List[List[float]], current_price: float, bucket_count: int = 50, spread_percentage: float = 0.05) -> List[Dict[str, Any]]:
        """
        Converts raw orderbook bids/asks into a bucketed heatmap depth array.
        
        Args:
            bids: Raw bids from CCXT [[price, volume], ...]
            asks: Raw asks from CCXT [[price, volume], ...]
            current_price: Current market price
            bucket_count: Number of buckets for each side (50 bids, 50 asks)
            spread_percentage: The price range to cover (e.g. 0.05 means +/- 5%)
            
        Returns:
            List of dictionaries containing price, volume, and type ('bid' or 'ask')
        """
        if current_price <= 0 or not bids or not asks:
            return []

        depth_heatmap = []
        
        # Calculate dynamic bucket size based on current price and desired range
        price_range = current_price * spread_percentage
        bucket_size = price_range / bucket_count
        
        if bucket_size <= 0:
            return []

        # --- Process Asks (Resistance) ---
        max_ask_price = current_price + price_range
        ask_buckets = {}
        for ask in asks:
            p, v = float(ask[0]), float(ask[1])
            if p > max_ask_price:
                continue
            if p < current_price:
                continue
                
            bucket_idx = int((p - current_price) / bucket_size)
            bucket_price = current_price + (bucket_idx * bucket_size)
            ask_buckets[bucket_idx] = ask_buckets.get(bucket_idx, {"price": bucket_price, "volume": 0, "type": "ask"})
            ask_buckets[bucket_idx]["volume"] += v
            
        # --- Process Bids (Support) ---
        min_bid_price = current_price - price_range
        bid_buckets = {}
        for bid in bids:
            p, v = float(bid[0]), float(bid[1])
            if p < min_bid_price:
                continue
            if p > current_price:
                continue
                
            bucket_idx = int((current_price - p) / bucket_size)
            bucket_price = current_price - (bucket_idx * bucket_size)
            bid_buckets[bucket_idx] = bid_buckets.get(bucket_idx, {"price": bucket_price, "volume": 0, "type": "bid"})
            bid_buckets[bucket_idx]["volume"] += v

        # Combine and sort (highest price to lowest price)
        depth_heatmap.extend(list(ask_buckets.values()))
        depth_heatmap.extend(list(bid_buckets.values()))
        
        # Normalize volumes if needed? The frontend can normalize based on local max.
        # But we can also pass the absolute volumes.
        
        return depth_heatmap

bookmap_heatmap_service = BookmapHeatmapService()
