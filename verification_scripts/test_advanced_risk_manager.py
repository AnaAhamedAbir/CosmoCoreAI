import asyncio
import sys
import os

# Add backend directory to sys.path so we can import app modules
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), 'backend')))

from app.strategies.helpers.advanced_risk_manager import AdvancedRiskManager
import time

def test_break_even():
    print("--- Testing Break-even Logic ---")
    config = {
        "enable_breakeven_stop": True,
        "breakeven_activation_pct": 2.0,
        "breakeven_fee_buffer_pct": 0.5,
        "enable_trailing_breakeven": False,
        "breakeven_cooldown_mins": 0
    }
    
    manager = AdvancedRiskManager(config)
    
    # Not hit yet (1.5% < 2.0%)
    res = manager.update_pnl(current_pnl_pct=1.5, current_pnl_usd=15)
    print("At +1.5% PNL:", res)
    assert res['action'] == 'none'
    
    # Hit trigger (2.5% > 2.0%)
    res = manager.update_pnl(current_pnl_pct=2.5, current_pnl_usd=25)
    print("At +2.5% PNL:", res)
    assert res['action'] == 'none'
    
    # Drops to buffer (0.4% < 0.5%)
    res = manager.update_pnl(current_pnl_pct=0.4, current_pnl_usd=4)
    print("Drops to +0.4% PNL:", res)
    assert res['action'] in ['pause_bot', 'stop_bot']
    assert 'Break-Even' in res['reason']
    
    print("Break-even logic works!\n")

def test_global_tp():
    print("--- Testing Global TP Logic ---")
    config = {
        "enable_global_tp": True,
        "global_tp_target": 50.0,  # $50 target
        "global_tp_type": "total",
        "global_tp_action": "stop"
        
    }
    
    manager = AdvancedRiskManager(config)
    
    # Initial PNL = 0
    res = manager.update_pnl(current_pnl_pct=1.0, current_pnl_usd=10)
    print("At +10 USD PNL:", res)
    assert res['action'] == 'none'
    
    # Reach global TP
    res = manager.update_pnl(current_pnl_pct=0.0, current_pnl_usd=55)
    print("At +55 USD PNL:", res)
    assert res['action'] == 'stop'
    assert 'Global TP Target Hit' in res['reason']
    
    print("Global TP logic works!\n")

def test_daily_tp():
    print("--- Testing Daily Global TP Reset Logic ---")
    config = {
        "enable_global_tp": True,
        "global_tp_target": 100.0,
        "global_tp_type": "daily",
        "global_tp_close_mode": "hard",
        "global_tp_action": "pause_bot"
    }
    manager = AdvancedRiskManager(config)
    
    manager.add_to_daily_pnl(80.0)
    print("Daily PNL after closing trade: $80")
    
    # Live position reaches $25 (Total daily = 80 + 25 = 105)
    res = manager.update_pnl(current_pnl_pct=1.0, current_pnl_usd=25)
    print("At +25 USD live PNL:", res)
    assert res['action'] == 'pause_bot'
    assert 'Daily Global TP' in res['reason'] or 'Global TP Target Hit' in res['reason']
    
    print("Daily Global TP logic works!\n")

def test_usd_break_even():
    print("--- Testing USD Break-even Logic ---")
    config = {
        "enable_breakeven_stop": True,
        "breakeven_type": "usd",
        "breakeven_activation_pct": 20.0,
        "breakeven_fee_buffer_pct": 5.0,
        "enable_trailing_breakeven": False
    }
    manager = AdvancedRiskManager(config)
    
    # 1. Start profit
    res = manager.update_pnl(current_pnl_pct=0.0, current_pnl_usd=15)
    print("At +15 USD PNL:", res)
    assert res['action'] == 'none'
    
    # 2. Hits activation
    res = manager.update_pnl(current_pnl_pct=0.0, current_pnl_usd=25)
    print("At +25 USD PNL:", res)
    assert res['action'] == 'none'
    
    # 3. Drops back
    res = manager.update_pnl(current_pnl_pct=0.0, current_pnl_usd=10)
    print("Drops to +10 USD PNL:", res)
    assert res['action'] == 'none'
    
    # 4. Hits stop level
    res = manager.update_pnl(current_pnl_pct=0.0, current_pnl_usd=4)
    print("Drops to +4 USD PNL:", res)
    assert res['action'] == 'pause_bot'
    assert 'Break-Even' in res['reason']
    
    print("USD Break-even logic works!\n")

def test_manual_trailing():
    print("--- Testing Manual Trailing Logic ---")
    config = {
        "enable_breakeven_stop": True,
        "breakeven_type": "pct",
        "breakeven_activation_pct": 2.0,
        "breakeven_fee_buffer_pct": 0.5,
        "enable_trailing_breakeven": True,
        "trailing_breakeven_mode": "manual",
        "trailing_breakeven_type": "pct",
        "trailing_breakeven_distance": 1.0,
        
        "enable_global_tp": True,
        "global_tp_target": 100.0,
        "global_tp_type": "daily",
        "global_tp_close_mode": "hard",
        "global_tp_action": "stop_bot",
        "enable_trailing_global_tp": True,
        "trailing_global_tp_mode": "manual",
        "trailing_global_tp_type": "usd",
        "trailing_global_tp_distance": 10.0
    }
    manager = AdvancedRiskManager(config)
    
    # 1. Test Manual Trailing Break-even (Trails by 1.0%)
    res = manager.update_pnl(current_pnl_pct=5.0, current_pnl_usd=50) # Peak 5.0%, Stop = 4.0%
    assert res['action'] == 'none'
    res = manager.update_pnl(current_pnl_pct=4.1, current_pnl_usd=40)
    assert res['action'] == 'none'
    res = manager.update_pnl(current_pnl_pct=3.9, current_pnl_usd=39) # Drops to 3.9% <= 4.0%
    assert res['action'] == 'pause_bot'
    assert 'Stop Level: 4.00%' in res['reason']
    print("Manual Trailing Break-even works!")

    # Fast forward cooldown
    manager.cooldown_until = 0

    # 2. Test Manual Trailing Global TP (Trails by 10 USD)
    # Reaches 120 USD (Target was 100), Stop = 110 USD
    res = manager.update_pnl(current_pnl_pct=10.0, current_pnl_usd=120)
    assert res['action'] == 'none'
    res = manager.update_pnl(current_pnl_pct=9.0, current_pnl_usd=111)
    assert res['action'] == 'none'
    res = manager.update_pnl(current_pnl_pct=8.0, current_pnl_usd=109) # Drops to 109 <= 110
    assert res['action'] == 'stop_bot'
    assert 'Trailing Global TP Hit' in res['reason']
    print("Manual Trailing Global TP works!\n")

if __name__ == "__main__":
    try:
        test_break_even()
        test_global_tp()
        test_daily_tp()
        test_usd_break_even()
        test_manual_trailing()
        print("ALL TESTS PASSED SUCCESSFULLY!")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"TEST FAILED: {e}")
