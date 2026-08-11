import asyncio
import websockets
import json

async def verify_websocket():
    uri = "ws://localhost:8000/api/v1/forex/ws/market-data?broker=Exness"
    print(f"Connecting to {uri}...")
    
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected successfully!")
            print("Waiting for tick data...")
            
            for i in range(3):
                message = await websocket.recv()
                data = json.loads(message)
                
                print(f"\n--- Message {i+1} received ---")
                print(f"Type: {data.get('type')}")
                print(f"Broker: {data.get('broker')}")
                
                ticks = data.get('data', [])
                print(f"Number of pairs received: {len(ticks)}")
                
                if len(ticks) > 0:
                    first_tick = ticks[0]
                    print("Sample Tick Data:")
                    print(f"  Symbol: {first_tick.get('symbol')}")
                    print(f"  Bid:    {first_tick.get('bid')}")
                    print(f"  Ask:    {first_tick.get('ask')}")
                    print(f"  Spread: {first_tick.get('spread')}")
                    
            print("\nVerification successful! WebSocket is streaming correctly.")
            
    except Exception as e:
        print(f"Verification failed: {e}")

if __name__ == "__main__":
    asyncio.run(verify_websocket())
