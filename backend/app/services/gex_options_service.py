import asyncio
import logging
import aiohttp
from typing import Dict, Any, Callable, Awaitable, List

logger = logging.getLogger(__name__)

class GEXOptionsService:
    def __init__(self):
        self._running = False
        self._task = None
        self._callbacks: List[Callable[[Dict[str, Any]], Awaitable[None]]] = []
        self._current_symbol = None
        self._base_currency = "BTC"

    def register_callback(self, callback: Callable[[Dict[str, Any]], Awaitable[None]]):
        if callback not in self._callbacks:
            self._callbacks.append(callback)

    def remove_callback(self, callback: Callable[[Dict[str, Any]], Awaitable[None]]):
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    async def start(self, symbol: str):
        if self._running:
            if self._current_symbol == symbol:
                return
            await self.stop()
            
        self._running = True
        self._current_symbol = symbol
        # Parse base currency (e.g., BTC/USDT -> BTC)
        self._base_currency = symbol.split("/")[0] if "/" in symbol else "BTC"
        
        # Deribit mainly supports BTC, ETH, and SOL for options
        supported_currencies = ["BTC", "ETH", "SOL"]
        if self._base_currency not in supported_currencies:
            logger.info(f"GEX Options Service: {self._base_currency} is not supported by Deribit options. Skipping fetch.")
            self._running = False
            return
            
        logger.info(f"GEX Options Service initializing for {self._base_currency}")
        self._task = asyncio.create_task(self._fetch_loop())

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("GEX Options Service stopped.")

    async def _fetch_loop(self):
        """Fetches Deribit Options Chain every 60 seconds."""
        url = f"https://deribit.com/api/v2/public/get_book_summary_by_currency?currency={self._base_currency}&kind=option"
        
        async with aiohttp.ClientSession() as session:
            while self._running:
                try:
                    async with session.get(url, timeout=10.0) as response:
                        response.raise_for_status()
                        data = await response.json()
                    
                    result = data.get("result", [])
                    if not result:
                        await asyncio.sleep(60)
                        continue

                    call_oi_by_strike = {}
                    put_oi_by_strike = {}

                    # instrument_name example: BTC-24NOV23-40000-C
                    for item in result:
                        instrument_name = item.get("instrument_name", "")
                        open_interest = item.get("open_interest", 0.0)
                        
                        if open_interest <= 0:
                            continue
                            
                        parts = instrument_name.split("-")
                        if len(parts) >= 4:
                            try:
                                strike = float(parts[2])
                                option_type = parts[3]
                                
                                if option_type == "C":
                                    call_oi_by_strike[strike] = call_oi_by_strike.get(strike, 0) + open_interest
                                elif option_type == "P":
                                    put_oi_by_strike[strike] = put_oi_by_strike.get(strike, 0) + open_interest
                            except ValueError:
                                continue

                    call_wall_strike = max(call_oi_by_strike, key=call_oi_by_strike.get) if call_oi_by_strike else None
                    put_wall_strike = max(put_oi_by_strike, key=put_oi_by_strike.get) if put_oi_by_strike else None
                    
                    gex_payload = {}
                    if call_wall_strike and put_wall_strike:
                        gex_payload = {
                            "gex_data": {
                                "call_wall": call_wall_strike,
                                "call_oi": call_oi_by_strike[call_wall_strike],
                                "put_wall": put_wall_strike,
                                "put_oi": put_oi_by_strike[put_wall_strike]
                            }
                        }
                        logger.info(f"GEX Data updated: Call Wall ${call_wall_strike} ({call_oi_by_strike[call_wall_strike]:.1f} BTC), Put Wall ${put_wall_strike} ({put_oi_by_strike[put_wall_strike]:.1f} BTC)")
                    
                    if gex_payload and self._callbacks:
                        for cb in self._callbacks:
                            try:
                                await cb(gex_payload)
                            except Exception as e:
                                logger.error(f"GEX callback err: {e}")
                                
                except Exception as e:
                    logger.warning(f"GEX Deribit fetch err: {e}")

                await asyncio.sleep(60)  # Wait 60 seconds before next poll

gex_options_service = GEXOptionsService()
