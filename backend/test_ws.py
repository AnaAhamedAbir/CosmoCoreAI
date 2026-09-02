import asyncio
import websockets
import json

async def test_ws():
    uri = "ws://localhost:2026/api/v1/advanced_liquidation/ws/god-mode?symbol=BTC%2FUSDT"
    print(f"Connecting to {uri}")
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected!")
            for _ in range(5):
                message = await websocket.recv()
                print("Received message:")
                print(message)
    except Exception as e:
        print(f"Error: {e}")

asyncio.run(test_ws())
