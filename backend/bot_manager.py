"""
Bot Manager - Multi-User Trading Bot Orchestration
Manages multiple bot instances across different users/accounts.
"""

import asyncio
import logging
from typing import Dict, Optional
from datetime import time
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

    @staticmethod
    def _normalize_active_days(value):
        """Normalize active day config to ISO weekday ints (1=Mon .. 7=Sun)."""
        if value is None:
            return None

        day_name_map = {
            'monday': 1,
            'tuesday': 2,
            'wednesday': 3,
            'thursday': 4,
            'friday': 5,
            'saturday': 6,
            'sunday': 7,
        }

        normalized = []
        for item in value:
            if isinstance(item, int):
                if 1 <= item <= 7:
                    normalized.append(item)
                continue

            if isinstance(item, str):
                raw = item.strip()
                if raw.isdigit():
                    num = int(raw)
                    if 1 <= num <= 7:
                        normalized.append(num)
                    continue

                mapped = day_name_map.get(raw.lower())
                if mapped:
                    normalized.append(mapped)

        if not normalized:
            return None

        return sorted(set(normalized))

    @staticmethod
    def _parse_time_value(value):
        """Parse supported time shapes into datetime.time (HH:MM or HH:MM:SS)."""
        if value is None:
            return None

        raw = str(value).strip()
        if not raw:
            return None

        parts = raw.split(':')
        if len(parts) < 2:
            return None

        try:
            hour = int(parts[0])
            minute = int(parts[1])
            second = int(parts[2]) if len(parts) >= 3 else 0
        except ValueError:
            return None

        if not (0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59):
            return None

        return time(hour, minute, second)

    def _apply_trading_window_config(self, config: TradingConfig, custom_config: Dict):
        """Apply trading window from multiple compatible payload shapes."""
        start_value = None
        end_value = None

        # Preferred shape from frontend BotConfigPanel
        window = custom_config.get('TRADING_WINDOW')
        if isinstance(window, dict):
            start_value = window.get('START')
            end_value = window.get('END')

        # Backward-compatible aliases used by older clients/scripts
        if start_value is None:
            start_value = custom_config.get('TRADING_START')
        if end_value is None:
            end_value = custom_config.get('TRADING_END')

        if start_value is None:
            start_value = custom_config.get('START_TIME')
        if end_value is None:
            end_value = custom_config.get('END_TIME')

        parsed_start = self._parse_time_value(start_value)
        parsed_end = self._parse_time_value(end_value)

        if parsed_start is not None:
            config.trade_window_start = parsed_start
        if parsed_end is not None:
            config.trade_window_end = parsed_end
    
    async def start_bot(
        self,
        account_id: str,
        username: Optional[str],
        password: Optional[str],
        session_token: Optional[str] = None,
        api_base_url: str = "http://localhost:8001",
        custom_config: Optional[Dict] = None
    ) -> Dict[str, any]:
        """
        Start a trading bot for an account.
        
        Args:
            account_id: Trading account identifier
            username: Auth username
            password: Auth password
            session_token: Existing valid session token (optional)
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
                self._apply_trading_window_config(config, custom_config)
                
                # Apply other custom overrides
                mapping = {
                    'PURCHASE_AMOUNT': 'purchase_amount',
                    'RISK_PERCENT': 'stop_loss_pct',
                    'TAKE_PROFIT_PERCENT': 'take_profit_pct',
                    'TAKE_PROFIT_PCT': 'take_profit_pct',
                    'COOLDOWN_MINUTES': 'cooldown_minutes',
                    'CHECK_INTERVAL_SEC': 'check_interval',
                    'MOVEMENT_CHECK_INTERVAL': 'movement_check_interval',
                    'PROFIT_PATIENCE_MIN': 'profit_patience_min',
                    'PROFIT_PATIENCE_MAX': 'profit_patience_max',
                    'PROFIT_DECLINE_THRESHOLD': 'profit_decline_threshold',
                    'TIMEZONE': 'timezone',
                    'ACTIVE_DAYS': 'active_days',
                    'ENTRY_TIMEFRAME': 'entry_timeframe',
                    'ENTRY_CANDLES_LIMIT': 'entry_candles_limit',
                    'ENTRY_FAST_MA': 'entry_fast_ma',
                    'ENTRY_SLOW_MA': 'entry_slow_ma',
                    'ENTRY_MIN_TREND_PCT': 'entry_min_trend_pct',
                    'ENTRY_MIN_MOMENTUM_PCT': 'entry_min_momentum_pct',
                    'ENTRY_REQUIRED_SIGNALS': 'entry_required_signals',
                }
                
                for frontend_key, backend_key in mapping.items():
                    if frontend_key in custom_config:
                        value = custom_config[frontend_key]
                        if frontend_key == 'ACTIVE_DAYS':
                            value = self._normalize_active_days(value)
                        setattr(config, backend_key, value)
            
            # Create new bot
            auth_payload = {
                'username': username,
                'password': password,
                'session_token': session_token,
            }
            bot = TradingBot(
                account_id=account_id,
                auth=auth_payload,
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

    async def force_stop_bot(self, account_id: str) -> Dict[str, any]:
        """Force stop a bot instance without graceful position handling."""
        try:
            if account_id not in self.bots:
                return {
                    'success': False,
                    'message': f'No bot found for account {account_id}'
                }

            bot = self.bots[account_id]
            bot.is_running = False

            if bot.task:
                bot.task.cancel()
                try:
                    await asyncio.wait_for(bot.task, timeout=2.0)
                except asyncio.CancelledError:
                    pass
                except Exception:
                    pass

            await bot.cleanup()
            del self.bots[account_id]

            logger.warning(f"⚠️ Bot force-stopped for account: {account_id}")
            return {
                'success': True,
                'message': 'Bot force-stopped successfully'
            }
        except Exception as e:
            logger.error(f"❌ Error force-stopping bot: {e}", exc_info=True)
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
