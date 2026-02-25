"""
Test script for NAS100 Trading Bot
Tests bot initialization and basic functionality.
"""

import asyncio
import sys
from datetime import datetime, time, timedelta

# Test imports
try:
    from profit_analyzer import ProfitAnalyzer
    from trading_bot import TradingBot, TradingConfig
    from bot_manager import bot_manager
    print("✅ All modules imported successfully")
except Exception as e:
    print(f"❌ Import error: {e}")
    sys.exit(1)


async def test_profit_analyzer():
    """Test profit analyzer logic"""
    print("\n" + "="*50)
    print("Testing Profit Analyzer")
    print("="*50)
    
    analyzer = ProfitAnalyzer(
        patience_min=60,
        patience_max=180,
        decline_threshold=0.02
    )
    
    # Test 1: No profit yet
    result = analyzer.record_profit(profit=-5.0, price=15245.0)
    print(f"\n1. Loss scenario: {result['action']} - {result['reason']}")
    assert result['action'] == 'HOLD', "Should hold during loss"
    
    # Test 2: First profit
    result = analyzer.record_profit(profit=10.0, price=15260.0)
    print(f"2. First profit: {result['action']} - {result['reason']}")
    assert result['action'] == 'HOLD', "Should hold on first profit"
    
    # Simulate 65 seconds passing (beyond min patience)
    import time
    analyzer.first_profit_at = datetime.now() - timedelta(seconds=65)
    
    # Test 3: Profit increased
    result = analyzer.record_profit(profit=15.0, price=15265.0)
    print(f"3. Profit increase: {result['action']} - Peak: ${result['peak_profit']:.2f}")
    assert result['action'] == 'HOLD', "Should hold when profit increasing"
    
    # Test 4: Profit declined 2.5% from peak
    result = analyzer.record_profit(profit=10.0, price=15260.0)
    print(f"4. Profit decline: {result['action']} - Decline: {result.get('decline_pct', 0)*100:.1f}%")
    assert result['action'] == 'SELL_IMMEDIATE', "Should sell on 2% decline"
    
    print("\n✅ Profit Analyzer tests passed!")
    
    # Show statistics
    stats = analyzer.get_statistics()
    print(f"\nStatistics: {stats['samples']} samples, Peak: ${stats['peak_profit']:.2f}")


async def test_bot_configuration():
    """Test bot configuration"""
    print("\n" + "="*50)
    print("Testing Bot Configuration")
    print("="*50)
    
    config = TradingConfig()
    
    print(f"\nBot Configuration:")
    print(f"  Symbol: {config.symbol}")
    print(f"  Purchase Amount: ${config.purchase_amount}")
    print(f"  Stop Loss: {config.stop_loss_pct * 100}%")
    print(f"  Trading Window: {config.trade_window_start} - {config.trade_window_end}")
    print(f"  Check Interval: {config.check_interval}s")
    print(f"  Cooldown: {config.cooldown_minutes} minutes")
    print(f"  Profit Patience: {config.profit_patience_min}-{config.profit_patience_max}s")
    print(f"  Decline Threshold: {config.profit_decline_threshold * 100}%")
    
    assert config.symbol == "NAS100", "Should trade NAS100"
    assert config.trade_window_start == time(9, 25), "Should start at 09:25"
    assert config.trade_window_end == time(10, 0), "Should end at 10:00"
    
    print("\n✅ Configuration tests passed!")


async def test_bot_manager():
    """Test bot manager"""
    print("\n" + "="*50)
    print("Testing Bot Manager")
    print("="*50)
    
    # Test singleton
    manager1 = bot_manager
    from bot_manager import BotManager
    manager2 = BotManager()
    
    assert manager1 is manager2, "Should be singleton"
    print("✅ Singleton pattern working")
    
    # Check initial state
    all_bots = manager1.get_all_statuses()
    print(f"Active bots: {len(all_bots)}")
    
    print("\n✅ Bot Manager tests passed!")


async def main():
    """Run all tests"""
    print("\n" + "="*60)
    print("🤖 NAS100 TRADING BOT - TEST SUITE")
    print("="*60)
    
    try:
        await test_profit_analyzer()
        await test_bot_configuration()
        await test_bot_manager()
        
        print("\n" + "="*60)
        print("✅ ALL TESTS PASSED!")
        print("="*60)
        print("\n🚀 Bot is ready for deployment!")
        print("\nNext steps:")
        print("  1. Start backend: uvicorn main:app --reload --port 8001")
        print("  2. Start frontend: cd frontend && npm run dev")
        print("  3. Login and select account")
        print("  4. Click 'Start Bot' in the bot control panel")
        print("  5. Monitor trading during 09:25-10:00 window")
        
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    # Fix for event loop on Windows
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    
    asyncio.run(main())
