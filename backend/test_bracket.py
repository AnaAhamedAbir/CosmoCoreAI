import asyncio
import os
import sys

# Minimal mock to test the logic path
class MockExchange:
    def __init__(self):
        self.fetch_order_calls = 0
        self.create_order_calls = 0
        self.cancel_order_calls = 0
    
    async def fetch_order(self, id, symbol):
        self.fetch_order_calls += 1
        # Simulate partial fill on 2nd call
        if self.fetch_order_calls == 1:
            return {'status': 'open', 'filled': 0.0, 'amount': 100}
        elif self.fetch_order_calls == 2:
            return {'status': 'open', 'filled': 50.0, 'amount': 100, 'average': 50000}
        elif self.fetch_order_calls == 3:
            return {'status': 'closed', 'filled': 100.0, 'amount': 100, 'average': 50000}
        return {'status': 'closed', 'filled': 100.0, 'amount': 100, 'average': 50000}

    async def create_order_ws(self, symbol, type, side, amount, price, params):
        print(f"[Mock WS] Creating {type} {side} order for {amount} @ {price}")
        self.create_order_calls += 1
        return {'id': 'ws_order_123', 'status': 'open'}

class MockAPIKey:
    exchange = 'binance'

# Test partial fill logic locally
async def test_bracket_logic():
    print("Testing Bracket Order Service Logic...")
    from app.services.bracket_order_service import BracketOrderService
    
    mock_ex = MockExchange()
    mock_key = MockAPIKey()
    
    tp_config = {'order_type': 'Limit', 'mode': 'percentage', 'value': 2, 'timeout_mins': 1}
    
    # We will invoke the polling loop directly without full get_or_create_exchange
    # We have to patch get_or_create_exchange just for this test
    import app.services.bracket_order_service as bos
    bos.get_or_create_exchange = lambda *args, **kwargs: _return_mock(mock_ex)
    bos.decrypt_key = lambda x: x
    
    async def _return_mock(ex): return ex
    
    await BracketOrderService.monitor_and_execute_bracket(
        api_key_record=mock_key,
        entry_order_id='entry_123',
        symbol='BTC/USDT',
        side='buy',
        amount=100.0,
        is_futures=False,
        tp_config=tp_config,
        sl_config=None,
        initial_entry_price=50000.0,
        user_id=1
    )
    
    # Wait for background spawn bracket task to finish
    await asyncio.sleep(1)
    print(f"Total Create Order WS calls: {mock_ex.create_order_calls}")
    if mock_ex.create_order_calls == 2:
        print("✅ SUCCESS: 2 Bracket Orders spawned (one for partial 50, one for remaining 50)!")
    else:
        print("❌ FAILED: Did not spawn expected bracket orders.")

if __name__ == '__main__':
    # Fix import paths
    sys.path.insert(0, r'C:\CosmoCoreAI\backend')
    asyncio.run(test_bracket_logic())
