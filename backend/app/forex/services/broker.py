import httpx
import os
import logging
import asyncio
import json
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

class OandaBrokerService:
    """
    Generic execution interface for OANDA v20 API.
    Designed for 100% automated algorithmic trading in Forex.
    """
    def __init__(self):
        # In a real environment, these come from environment variables.
        self.api_key = os.getenv("OANDA_API_KEY", "mock_oanda_key")
        self.account_id = os.getenv("OANDA_ACCOUNT_ID", "mock_account_id")
        self.base_url = os.getenv("OANDA_BASE_URL", "https://api-fxpractice.oanda.com/v3")
        self.stream_url = os.getenv("OANDA_STREAM_URL", "https://stream-fxpractice.oanda.com/v3")
        
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept-Datetime-Format": "RFC3339"
        }
        
        # In-memory cache for ultra-fast price lookups without API rate limits
        self.live_prices: Dict[str, Dict[str, Any]] = {}
        self._streaming_task: Optional[asyncio.Task] = None

    async def start_price_stream(self, instruments: List[str]):
        """
        Starts an asynchronous HTTP Chunked Stream (OANDA's equivalent of WebSocket)
        to receive real-time price updates.
        """
        if self.api_key == "mock_oanda_key":
            logger.info("Running in MOCK mode. Streaming simulated prices.")
            async def mock_stream():
                while True:
                    for inst in instruments:
                        self.live_prices[inst] = {
                            "instrument": inst,
                            "bid": 1.09245,
                            "ask": 1.09247,
                            "spread_pips": 0.2
                        }
                    await asyncio.sleep(1) # Simulate real-time tick
            self._streaming_task = asyncio.create_task(mock_stream())
            return

        url = f"{self.stream_url}/accounts/{self.account_id}/pricing/stream"
        params = {"instruments": ",".join(instruments)}
        
        async def stream_worker():
            logger.info(f"Connecting to OANDA Live Stream for {instruments}...")
            try:
                async with httpx.AsyncClient(timeout=None) as client:
                    async with client.stream("GET", url, headers=self.headers, params=params) as response:
                        response.raise_for_status()
                        async for line in response.aiter_lines():
                            if line:
                                data = json.loads(line)
                                if data.get("type") == "PRICE":
                                    inst = data["instrument"]
                                    bid = float(data["bids"][0]["price"])
                                    ask = float(data["asks"][0]["price"])
                                    spread_pips = (ask - bid) * 10000
                                    
                                    self.live_prices[inst] = {
                                        "instrument": inst,
                                        "bid": bid,
                                        "ask": ask,
                                        "spread_pips": round(spread_pips, 2)
                                    }
                                    # logger.debug(f"Live Tick - {inst}: Bid={bid} Ask={ask} Spread={spread_pips:.1f}")
                                elif data.get("type") == "HEARTBEAT":
                                    pass # Ignore heartbeats
            except asyncio.CancelledError:
                logger.info("OANDA Stream Disconnected gracefully.")
            except Exception as e:
                logger.error(f"OANDA Stream Error: {str(e)}")
                # In a robust system, you'd implement exponential backoff reconnection here.

        if self._streaming_task and not self._streaming_task.done():
            self._streaming_task.cancel()
        self._streaming_task = asyncio.create_task(stream_worker())

    def stop_price_stream(self):
        if self._streaming_task:
            self._streaming_task.cancel()

    def get_live_pricing(self, instrument: str) -> Optional[Dict[str, Any]]:
        """
        Ultra-fast lookup from memory. NO API calls made here.
        """
        return self.live_prices.get(instrument)
        
    async def get_pricing_fallback(self, instrument: str) -> Optional[Dict[str, Any]]:
        """
        Fallback method using REST API if stream fails or hasn't ticked yet.
        """
        if self.api_key == "mock_oanda_key":
            return {"instrument": instrument, "bid": 1.09245, "ask": 1.09247, "spread_pips": 0.2}
            
        url = f"{self.base_url}/accounts/{self.account_id}/pricing"
        params = {"instruments": instrument}
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=self.headers, params=params)
                response.raise_for_status()
                data = response.json()
                price = data.get("prices", [])[0]
                bid = float(price["bids"][0]["price"])
                ask = float(price["asks"][0]["price"])
                spread_pips = (ask - bid) * 10000
                return {"instrument": instrument, "bid": bid, "ask": ask, "spread_pips": round(spread_pips, 2)}
        except Exception as e:
            logger.error(f"Failed to fetch REST pricing: {str(e)}")
            return None

    async def create_market_order(self, instrument: str, units: int) -> Optional[Dict[str, Any]]:
        """
        Execute a market order via REST API.
        """
        if self.api_key == "mock_oanda_key":
            return {"status": "MOCK_SUCCESS", "instrument": instrument, "units": units, "fill_price": 1.09250}
            
        url = f"{self.base_url}/accounts/{self.account_id}/orders"
        payload = {
            "order": {
                "units": str(units),
                "instrument": instrument,
                "timeInForce": "FOK",
                "type": "MARKET",
                "positionFill": "DEFAULT"
            }
        }
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, headers=self.headers, json=payload)
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Failed to execute order: {str(e)}")
            return None

    async def get_candles(self, instrument: str, granularity: str = "M15", count: int = 100) -> Optional[List[Dict[str, Any]]]:
        """
        Fetch historical OHLCV candles via REST API.
        """
        if self.api_key == "mock_oanda_key":
            # Return dummy candles for testing without real API credentials
            import time
            now = int(time.time())
            candles = []
            for i in range(count):
                candles.append({
                    "time": now - (i * 900), # 15m intervals
                    "open": 1.09200,
                    "high": 1.09300,
                    "low": 1.09100,
                    "close": 1.09245,
                    "volume": 1500
                })
            return candles[::-1]

        url = f"{self.base_url}/instruments/{instrument}/candles"
        params = {
            "granularity": granularity,
            "count": count,
            "price": "M" # Midpoint candles
        }
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=self.headers, params=params)
                response.raise_for_status()
                data = response.json()
                
                formatted_candles = []
                for candle in data.get("candles", []):
                    if candle.get("complete", False):
                        formatted_candles.append({
                            "time": candle["time"],
                            "open": float(candle["mid"]["o"]),
                            "high": float(candle["mid"]["h"]),
                            "low": float(candle["mid"]["l"]),
                            "close": float(candle["mid"]["c"]),
                            "volume": candle["volume"]
                        })
                return formatted_candles
        except Exception as e:
            logger.error(f"Failed to fetch candles for {instrument}: {str(e)}")
            return None
