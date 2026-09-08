import asyncio
import logging
import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.services.gex_options_service import gex_options_service

logging.basicConfig(level=logging.INFO)

async def test_gex():
    async def cb(payload):
        print("Received payload:", payload)
        
    gex_options_service.register_callback(cb)
    await gex_options_service.start("BTC/USDT")
    
    await asyncio.sleep(5)
    await gex_options_service.stop()

if __name__ == "__main__":
    asyncio.run(test_gex())
