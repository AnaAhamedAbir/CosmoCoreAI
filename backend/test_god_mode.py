import asyncio
from app.services.god_mode_liquidation_service import GodModeService

async def main():
    service = GodModeService()
    
    async def cb(state):
        print("Received state!")
        print(state)
        
    service.register_callback(cb)
    print("Starting service...")
    await service.start("BTC/USDT")
    print("Started. Waiting 3 seconds...")
    await asyncio.sleep(3)
    print("Done.")

asyncio.run(main())
