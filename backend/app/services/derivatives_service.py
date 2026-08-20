import random
import asyncio
from typing import Dict, Any

class DerivativesService:
    """
    Service for fetching Derivatives Data (Funding Rate, Open Interest).
    Currently uses robust placeholders simulating real API connections (e.g., Binance Futures).
    TODO: Replace these mock methods with real HTTP/WebSocket calls to CCXT or Binance Futures API.
    """
    
    async def get_funding_rate(self, symbol: str = "BTC/USDT") -> Dict[str, Any]:
        """
        Fetch the live Funding Rate for a given perpetual symbol.
        """
        # Simulate API latency
        await asyncio.sleep(0.2)
        
        # MOCK LOGIC: Simulate a realistic funding rate based on typical crypto market conditions.
        # Usually ranges from -0.05% to 0.05%
        mock_rate = random.uniform(-0.01, 0.03) 
        
        return {
            "symbol": symbol,
            "funding_rate": round(mock_rate, 4),
            "next_funding_time": "in 4 hours", # Placeholder
            "is_mocked": True
        }

    async def get_open_interest(self, symbol: str = "BTC/USDT") -> Dict[str, Any]:
        """
        Fetch the live Open Interest (OI) for a given perpetual symbol.
        """
        # Simulate API latency
        await asyncio.sleep(0.2)
        
        # MOCK LOGIC: Simulate Open Interest value
        base_oi = 500_000_000 if "BTC" in symbol else 100_000_000
        mock_oi = base_oi + random.uniform(-5000000, 15000000)
        
        return {
            "symbol": symbol,
            "open_interest_usd": round(mock_oi, 2),
            "is_mocked": True
        }

derivatives_service = DerivativesService()
