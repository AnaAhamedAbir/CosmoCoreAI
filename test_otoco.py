import asyncio
import ccxt.async_support as ccxt

async def test():
    exchange = ccxt.binance()
    
    try:
        res = await exchange.private_post_orderlist_otoco({})
        print(res)
    except Exception as e:
        print("Expected error:", e)
    
    await exchange.close()

asyncio.run(test())
