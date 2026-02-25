"""
Trading Bot - Automated NAS100 Trading Engine
Executes trades during defined time windows with intelligent profit management.
"""

import asyncio
import logging
from datetime import datetime, time, timedelta
from enum import Enum
from typing import Optional, Dict, Any
from dataclasses import dataclass
import httpx

from profit_analyzer import ProfitAnalyzer

logger = logging.getLogger(__name__)


class BotState(str, Enum):
    IDLE = "idle"
    WAITING_FOR_WINDOW = "waiting_for_window"
    MONITORING_ENTRY = "monitoring_entry"
    IN_POSITION = "in_position"
    COOLDOWN = "cooldown"
    STOPPED = "stopped"


@dataclass
class TradingConfig:
    """Trading bot configuration"""
    symbol: str = "NAS100"
    purchase_amount: float = 100.0
    stop_loss_pct: float = 0.20  # 20%
    trade_window_start: time = time(9, 25)  # 09:25
    trade_window_end: time = time(10, 0)    # 10:00
    check_interval: int = 5  # seconds
    cooldown_minutes: int = 32
    profit_patience_min: int = 60   # 1 minute
    profit_patience_max: int = 180  # 3 minutes
    profit_decline_threshold: float = 0.02  # 2%
    movement_check_interval: int = 10  # seconds


class TradingBot:
    """
    Automated NAS100 Trading Bot with Smart Profit Management.
    
    Features:
    - Trades only during specified time window (09:25-10:00)
    - Automatic stop-loss at 20% ($20)
    - Smart profit exit: waits 1-3 min, exits on 2% decline from peak
    - 32-minute cooldown after each exit
    - Real-time position monitoring every 5 seconds
    """
    
    def __init__(
        self,
        account_id: str,
        auth: Dict[str, str],
        api_base_url: str = "https://rest.liquidcharts.com",
        config: Optional[TradingConfig] = None
    ):
        """
        Initialize trading bot.
        
        Args:
            account_id: Trading account identifier
            auth: Authentication credentials (username, password)
            api_base_url: Liquid Charts API base URL
            config: Trading configuration (uses defaults if None)
        """
        self.account_id = account_id
        self.auth = auth
        self.api_base_url = api_base_url
        self.config = config or TradingConfig()
        
        # Bot state
        self.state = BotState.IDLE
        self.is_running = False
        self.task: Optional[asyncio.Task] = None
        
        # Position tracking
        self.current_position: Optional[Dict[str, Any]] = None
        self.entry_price: Optional[float] = None
        self.position_id: Optional[str] = None
        
        # Profit analyzer
        self.profit_analyzer = ProfitAnalyzer(
            patience_min=self.config.profit_patience_min,
            patience_max=self.config.profit_patience_max,
            decline_threshold=self.config.profit_decline_threshold
        )
        
        # Cooldown tracking
        self.cooldown_until: Optional[datetime] = None
        self.last_movement_check_at: Optional[datetime] = None
        self.last_movement_signal: Optional[Dict[str, Any]] = None
        
        # Statistics
        self.stats = {
            'trades_executed': 0,
            'wins': 0,
            'losses': 0,
            'total_profit': 0.0,
            'last_trade_at': None,
            'started_at': None
        }
        
        # HTTP client
        self.client = httpx.AsyncClient(timeout=30.0)
        
    async def start(self):
        """Start the trading bot"""
        if self.is_running:
            logger.warning("⚠️ Bot already running")
            return False
        
        logger.info(f"🚀 Starting NAS100 Trading Bot")
        logger.info(f"   Symbol: {self.config.symbol}")
        logger.info(f"   Window: {self.config.trade_window_start} - {self.config.trade_window_end}")
        logger.info(f"   Stop Loss: {self.config.stop_loss_pct*100}%")
        logger.info(f"   Profit Strategy: {self.config.profit_patience_min}-{self.config.profit_patience_max}s patience, {self.config.profit_decline_threshold*100}% decline threshold")
        
        self.is_running = True
        self.stats['started_at'] = datetime.now().isoformat()
        self.state = BotState.WAITING_FOR_WINDOW
        
        # Start main loop in background task
        self.task = asyncio.create_task(self._main_loop())
        return True
    
    async def stop(self):
        """Stop the trading bot gracefully"""
        logger.info("🛑 Stopping Trading Bot...")
        self.is_running = False
        self.state = BotState.STOPPED
        
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        
        # Close any open positions
        if self.current_position and self.position_id:
            await self._close_position("Bot stopped by user")
        
        logger.info("✅ Trading Bot stopped")
        
    async def _main_loop(self):
        """Main trading loop"""
        try:
            while self.is_running:
                now = datetime.now()
                current_time = now.time()
                
                # Check if in cooldown
                if self.cooldown_until and now < self.cooldown_until:
                    self.state = BotState.COOLDOWN
                    remaining = (self.cooldown_until - now).total_seconds()
                    logger.debug(f"💤 Cooldown: {remaining:.0f}s remaining")
                    await asyncio.sleep(self.config.check_interval)
                    continue
                
                # Check trading window
                if not (self.config.trade_window_start <= current_time <= self.config.trade_window_end):
                    self.state = BotState.WAITING_FOR_WINDOW
                    logger.debug(f"⏰ Outside trading window (current: {current_time.strftime('%H:%M:%S')})")
                    await asyncio.sleep(self.config.check_interval)
                    continue
                
                # Inside trading window
                if self.current_position is None:
                    # No position - look for entry
                    self.state = BotState.MONITORING_ENTRY
                    await self._try_enter_position()
                else:
                    # Have position - monitor for exit
                    self.state = BotState.IN_POSITION
                    await self._monitor_position()
                
                await asyncio.sleep(self.config.check_interval)
                
        except asyncio.CancelledError:
            logger.info("Bot task cancelled")
            raise
        except Exception as e:
            logger.error(f"❌ Bot error: {e}", exc_info=True)
            self.state = BotState.STOPPED
            self.is_running = False
    
    async def _try_enter_position(self):
        """Attempt to enter a new position"""
        try:
            logger.info(f"📊 Checking entry conditions for {self.config.symbol}...")
            
            # Get current market price
            price_data = await self._get_market_price()
            if not price_data:
                logger.warning("⚠️ Could not fetch market price")
                return
            
            current_price = price_data.get('bid', 0)
            if current_price <= 0:
                logger.warning("⚠️ Invalid market price")
                return
            
            # Place buy order
            logger.info(f"🟢 ENTERING POSITION: {self.config.symbol} @ ${current_price:.2f}")
            order_result = await self._place_order(
                symbol=self.config.symbol,
                side="buy",
                quantity=1,  # 1 contract
                amount=self.config.purchase_amount
            )
            
            if order_result and order_result.get('success'):
                self.current_position = order_result
                self.entry_price = current_price
                self.position_id = order_result.get('orderId') or order_result.get('id')
                
                # Reset profit analyzer
                self.profit_analyzer.reset()
                self.last_movement_check_at = None
                self.last_movement_signal = None
                
                self.stats['trades_executed'] += 1
                self.stats['last_trade_at'] = datetime.now().isoformat()
                
                logger.info(f"✅ Position opened: {self.position_id}")
            else:
                logger.error(f"❌ Failed to enter position: {order_result}")
        
        except Exception as e:
            logger.error(f"❌ Error entering position: {e}", exc_info=True)
    
    async def _monitor_position(self):
        """Monitor existing position and decide when to exit"""
        try:
            # Get current market price
            price_data = await self._get_market_price()
            if not price_data:
                logger.warning("⚠️ Could not fetch market price for monitoring")
                return
            
            current_price = price_data.get('ask', 0)  # Ask price for selling
            if current_price <= 0:
                return
            
            # Calculate profit/loss
            profit = current_price - self.entry_price
            profit_pct = (profit / self.entry_price) * 100
            
            logger.debug(f"📊 Position P/L: ${profit:.2f} ({profit_pct:.2f}%)")
            
            # Check stop-loss (20% = $20 loss)
            stop_loss_amount = self.config.purchase_amount * self.config.stop_loss_pct
            if profit <= -stop_loss_amount:
                logger.warning(f"🛑 STOP LOSS TRIGGERED: ${profit:.2f}")
                await self._close_position(f"Stop loss triggered at ${profit:.2f}")
                self.stats['losses'] += 1
                self.stats['total_profit'] += profit
                return
            
            # Analyze profit with smart exit logic
            analysis = self.profit_analyzer.record_profit(profit, current_price)

            # Movement-based predictive logic (runs every configured interval)
            now = datetime.now()
            should_check_movement = (
                self.last_movement_check_at is None
                or (now - self.last_movement_check_at).total_seconds() >= self.config.movement_check_interval
            )

            if should_check_movement:
                movement_signal = self.profit_analyzer.record_movement(current_price, profit)
                self.last_movement_signal = movement_signal
                self.last_movement_check_at = now

                if movement_signal.get('action') in ['SELL_CUT_LOSS', 'SELL_PROTECT_PROFIT']:
                    logger.warning(f"📉 MOVEMENT EXIT SIGNAL: {movement_signal.get('reason')}")
                    await self._close_position(movement_signal.get('reason', 'Bearish movement forecast'))

                    if profit > 0:
                        self.stats['wins'] += 1
                    else:
                        self.stats['losses'] += 1
                    self.stats['total_profit'] += profit
                    return
            
            # Decision logic
            if analysis['action'] in ['SELL_IMMEDIATE', 'SELL_TIMEOUT']:
                logger.info(f"💰 EXIT SIGNAL: {analysis['reason']}")
                await self._close_position(analysis['reason'])
                
                if profit > 0:
                    self.stats['wins'] += 1
                else:
                    self.stats['losses'] += 1
                    
                self.stats['total_profit'] += profit
            else:
                logger.debug(f"✋ HOLD: {analysis['reason']}")
        
        except Exception as e:
            logger.error(f"❌ Error monitoring position: {e}", exc_info=True)
    
    async def _close_position(self, reason: str):
        """Close current position"""
        try:
            if not self.position_id:
                logger.warning("⚠️ No position to close")
                return
            
            logger.info(f"🔴 CLOSING POSITION: {reason}")
            
            # Place sell order
            close_result = await self._place_order(
                symbol=self.config.symbol,
                side="sell",
                quantity=1,
                amount=self.config.purchase_amount
            )
            
            if close_result and close_result.get('success'):
                logger.info(f"✅ Position closed successfully")
            else:
                logger.error(f"❌ Failed to close position: {close_result}")
            
            # Clear position state
            self.current_position = None
            self.entry_price = None
            self.position_id = None
            
            # Start cooldown
            self.cooldown_until = datetime.now() + timedelta(minutes=self.config.cooldown_minutes)
            logger.info(f"💤 Entering {self.config.cooldown_minutes}-minute cooldown until {self.cooldown_until.strftime('%H:%M:%S')}")
            
        except Exception as e:
            logger.error(f"❌ Error closing position: {e}", exc_info=True)
    
    async def _get_market_price(self) -> Optional[Dict[str, Any]]:
        """Fetch current market price from API"""
        try:
            # Call backend API endpoint
            response = await self.client.get(
                f"{self.api_base_url}/api/trading/marketdata",
                params={
                    "symbol": self.config.symbol,
                    "username": self.auth.get('username'),
                    "password": self.auth.get('password')
                }
            )
            response.raise_for_status()
            data = response.json()
            
            if data.get('success'):
                return data.get('data', {})
            
            return None
            
        except Exception as e:
            logger.error(f"❌ Error fetching market price: {e}")
            return None
    
    async def _place_order(self, symbol: str, side: str, quantity: int, amount: float) -> Optional[Dict[str, Any]]:
        """Place an order via bot API endpoint"""
        try:
            response = await self.client.post(
                f"{self.api_base_url}/api/trading/bot/orders/place",
                json={
                    "accountId": self.account_id,
                    "symbol": symbol,
                    "side": side,
                    "quantity": quantity,
                    "amount": amount,
                    "username": self.auth.get('username'),
                    "password": self.auth.get('password')
                }
            )
            response.raise_for_status()
            return response.json()
            
        except Exception as e:
            logger.error(f"❌ Error placing order: {e}")
            return None
    
    def get_status(self) -> Dict[str, Any]:
        """Get current bot status"""
        status = {
            'is_running': self.is_running,
            'state': self.state.value,
            'account_id': self.account_id,
            'config': {
                'symbol': self.config.symbol,
                'purchase_amount': self.config.purchase_amount,
                'stop_loss_pct': self.config.stop_loss_pct * 100,
                'trade_window': f"{self.config.trade_window_start} - {self.config.trade_window_end}",
                'cooldown_minutes': self.config.cooldown_minutes,
                'movement_check_interval': self.config.movement_check_interval,
            },
            'current_position': None,
            'cooldown_remaining': None,
            'statistics': self.stats,
            'profit_analysis': None,
            'movement_signal': self.last_movement_signal,
        }
        
        # Add position details
        if self.current_position:
            status['current_position'] = {
                'position_id': self.position_id,
                'entry_price': self.entry_price,
                'symbol': self.config.symbol
            }
        
        # Add cooldown info
        if self.cooldown_until:
            remaining = (self.cooldown_until - datetime.now()).total_seconds()
            if remaining > 0:
                status['cooldown_remaining'] = int(remaining)
        
        # Add profit analysis
        if self.current_position:
            status['profit_analysis'] = self.profit_analyzer.get_statistics()
        
        return status
    
    async def cleanup(self):
        """Cleanup resources"""
        await self.client.aclose()
