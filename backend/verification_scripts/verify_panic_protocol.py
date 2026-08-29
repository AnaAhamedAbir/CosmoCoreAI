import asyncio
import sys
import os

# Add backend dir to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from unittest.mock import AsyncMock, MagicMock
from app.services.bot_manager import BotManager

async def test_panic_protocol():
    print("🚀 Starting Panic Protocol Verification...")
    
    manager = BotManager()
    manager.active_bots = {}
    
    # Mock Bot Instance
    mock_bot = MagicMock()
    mock_bot.bot = MagicMock()
    mock_bot.bot.market = "BTC/USDT"
    mock_bot.symbol = "BTC/USDT"
    
    # Mock Exchange
    mock_exchange = AsyncMock()
    mock_exchange.cancel_all_orders = AsyncMock()
    mock_bot.exchange = mock_exchange
    
    # Mock Emergency Sell
    mock_bot.emergency_sell = AsyncMock()
    
    # Mock Stop
    mock_bot.stop = AsyncMock()
    
    # Register mock bot
    manager.active_bots[1] = mock_bot
    
    print("\n--- Test 1: Stop Bot without liquidation ---")
    # Need to mock the local_db query inside stop_bot
    mock_db = MagicMock()
    mock_db.query().filter().first.return_value = mock_bot.bot
    
    await manager.stop_bot(1, db=mock_db, liquidate_positions=False)
    
    # Verify cancel_all_orders was called
    mock_exchange.cancel_all_orders.assert_called_once_with("BTC/USDT")
    print("✅ cancel_all_orders was called successfully.")
    
    # Verify emergency_sell was NOT called
    mock_bot.emergency_sell.assert_not_called()
    print("✅ emergency_sell was NOT called (as expected).")
    
    # Verify stop was called
    mock_bot.stop.assert_called_once()
    print("✅ bot.stop() was called.")
    
    print("\n--- Test 2: Stop Bot WITH liquidation ---")
    # Reset mocks and register again
    mock_exchange.cancel_all_orders.reset_mock()
    mock_bot.emergency_sell.reset_mock()
    mock_bot.stop.reset_mock()
    manager.active_bots[2] = mock_bot
    
    await manager.stop_bot(2, db=mock_db, liquidate_positions=True)
    
    # Verify cancel_all_orders was called
    mock_exchange.cancel_all_orders.assert_called_once_with("BTC/USDT")
    print("✅ cancel_all_orders was called successfully.")
    
    # Verify emergency_sell WAS called
    mock_bot.emergency_sell.assert_called_once_with("market")
    print("✅ emergency_sell('market') was called successfully.")
    
    # Verify stop was called
    mock_bot.stop.assert_called_once()
    print("✅ bot.stop() was called.")
    
    print("\n🎉 All tests passed! Panic Protocol is robust.")

if __name__ == "__main__":
    asyncio.run(test_panic_protocol())
