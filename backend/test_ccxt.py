import ccxt.async_support as ccxt
import asyncio

async def run():
    ex = ccxt.binance({'options': {'defaultType': 'future'}})
    await ex.load_markets()
    print([m for m in ex.markets.keys() if 'BTC/USDT' in m])
    await ex.close()

asyncio.run(run())
