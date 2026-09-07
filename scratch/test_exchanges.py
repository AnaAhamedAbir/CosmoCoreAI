import asyncio
import ccxt.pro as ccxtpro

async def test_exchange(ex_id):
    print(f"Testing {ex_id}...")
    exchange = None
    try:
        exchange_class = getattr(ccxtpro, ex_id)
        exchange = exchange_class({
            'enableRateLimit': True,
            'options': {'defaultType': 'swap'}
        })
        await exchange.load_markets()
        ticker = await exchange.watch_ticker('BTC/USDT')
        print(f"SUCCESS {ex_id}: BTC/USDT price = {ticker.get('last')}")
    except Exception as e:
        print(f"FAILED {ex_id}: {type(e).__name__} - {e}")
    finally:
        if exchange:
            await exchange.close()

async def main():
    await test_exchange('binance')
    await test_exchange('okx')
    await test_exchange('bitget')

asyncio.run(main())
