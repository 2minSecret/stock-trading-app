"""
Bot Manager - Multi-User Trading Bot Orchestration
Manages multiple bot instances across different users/accounts.
"""

import asyncio
import logging
from typing import Dict, Optional
from trading_bot import TradingBot, TradingConfig

logger = logging.getLogger(__name__)


class BotManager:
    """
    Singleton manager for all trading bot instances.
    Handles lifecycle management for multiple concurrent bots.
    """
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self.bots: Dict[str, TradingBot] = {}  # account_id -> bot
        self._initialized = True
        logger.info("🎯 Bot Manager initialized")
    
    async def start_bot(
        self,
        account_id: str,
        username: str,
        password: str,
        api_base_url: str = "http://localhost:8001",
        custom_config: Optional[Dict] = None
    ) -> Dict[str, any]:
        """
        Start a trading bot for an account.
        
        Args:
            account_id: Trading account identifier
            username: Auth username
            password: Auth password
            api_base_url: Backend API base URL
            custom_config: Optional custom configuration overrides
            
        Returns:
            Result dictionary with success status and message
        """
        try:
            # Check if bot already exists
            if account_id in self.bots:
                existing_bot = self.bots[account_id]
                if existing_bot.is_running:
                    return {
                        'success': False,
                        'message': f'Bot already running for account {account_id}'
                    }
                else:
                    # Remove old stopped bot
                    await existing_bot.cleanup()
                    del self.bots[account_id]
            
            # Create config
            config = TradingConfig()
            if custom_config:
                # Convert frontend config format to backend format
                if 'TRADING_WINDOW' in custom_config and isinstance(custom_config['TRADING_WINDOW'], dict):
                    window = custom_config['TRADING_WINDOW']
                    if 'START' in window:
                        start_time = window['START'].split(':')
                        config.trade_window_start = __import__('datetime').time(int(start_time[0]), int(start_time[1]))
                    if 'END' in window:
                        end_time = window['END'].split(':')
                        config.trade_window_end = __import__('datetime').time(int(end_time[0]), int(end_time[1]))
                
                # Apply other custom overrides
                mapping = {
                    'PURCHASE_AMOUNT': 'purchase_amount',
                    'RISK_PERCENT': 'stop_loss_pct',
                    'COOLDOWN_MINUTES': 'cooldown_minutes',
                    'CHECK_INTERVAL_SEC': 'check_interval',
                    'MOVEMENT_CHECK_INTERVAL': 'movement_check_interval',
                    'PROFIT_PATIENCE_MIN': 'profit_patience_min',
                    'PROFIT_PATIENCE_MAX': 'profit_patience_max',
                    'PROFIT_DECLINE_THRESHOLD': 'profit_decline_threshold',
                }
                
                for frontend_key, backend_key in mapping.items():
                    if frontend_key in custom_config:
                        setattr(config, backend_key, custom_config[frontend_key])
            
            # Create new bot
            bot = TradingBot(
                account_id=account_id,
                auth={'username': username, 'password': password},
                api_base_url=api_base_url,
                config=config
            )
            
            # Start bot
            started = await bot.start()
            
            if started:
                self.bots[account_id] = bot
                logger.info(f"✅ Bot started for account: {account_id}")
                return {
                    'success': True,
                    'message': f'Trading bot started for {config.symbol}',
                    'account_id': account_id,
                    'config': {
                        'symbol': config.symbol,
                        'window': f"{config.trade_window_start} - {config.trade_window_end}",
                        'stop_loss': f"{config.stop_loss_pct * 100}%",
                        'cooldown': f"{config.cooldown_minutes} minutes"
                    }
                }
            else:
                return {
                    'success': False,
                    'message': 'Failed to start bot'
                }
            
        except Exception as e:
            logger.error(f"❌ Error starting bot: {e}", exc_info=True)
            return {
                'success': False,
                'message': f'Error: {str(e)}'
            }
    
    async def stop_bot(self, account_id: str) -> Dict[str, any]:
        """
        Stop a trading bot for an account.
        
        Args:
            account_id: Trading account identifier
            
        Returns:
            Result dictionary with success status
        """
        try:
            if account_id not in self.bots:
                return {
                    'success': False,
                    'message': f'No bot found for account {account_id}'
                }
            
            bot = self.bots[account_id]
            await bot.stop()
            
            # Get final stats before cleanup
            final_stats = bot.get_status()
            
            await bot.cleanup()
            del self.bots[account_id]
            
            logger.info(f"✅ Bot stopped for account: {account_id}")
            return {
                'success': True,
                'message': 'Bot stopped successfully',
                'final_stats': final_stats['statistics']
            }
            
        except Exception as e:
            logger.error(f"❌ Error stopping bot: {e}", exc_info=True)
            return {
                'success': False,
                'message': f'Error: {str(e)}'
            }
    
    def get_bot_status(self, account_id: str) -> Optional[Dict[str, any]]:
        """
        Get status of a specific bot.
        
        Args:
            account_id: Trading account identifier
            
        Returns:
            Bot status dictionary or None if not found
        """
        if account_id not in self.bots:
            return None
        
        return self.bots[account_id].get_status()
    
    def get_all_statuses(self) -> Dict[str, Dict[str, any]]:
        """Get status of all running bots"""
        return {
            account_id: bot.get_status()
            for account_id, bot in self.bots.items()
        }
    
    async def stop_all_bots(self):
        """Stop all running bots"""
        logger.info("🛑 Stopping all bots...")
        
        for account_id in list(self.bots.keys()):
            await self.stop_bot(account_id)
        
        logger.info("✅ All bots stopped")


# Global singleton instance
bot_manager = BotManager()
