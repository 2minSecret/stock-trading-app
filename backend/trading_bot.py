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
from zoneinfo import ZoneInfo

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
    take_profit_pct: float = 0.20  # 20%
    trade_window_start: time = time(9, 25)  # 09:25
    trade_window_end: time = time(10, 0)    # 10:00
    check_interval: int = 5  # seconds
    cooldown_minutes: int = 32
    profit_patience_min: int = 60   # 1 minute
    profit_patience_max: int = 180  # 3 minutes
    profit_decline_threshold: float = 0.02  # 2%
    movement_check_interval: int = 10  # seconds
    timezone: Optional[str] = None  # IANA timezone (e.g., "America/New_York")


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

        # Timezone handling (client/device timezone preferred, local machine fallback)
        self.runtime_tz, self.runtime_tz_name = self._resolve_timezone(self.config.timezone)
        
        # Bot state
        self.state = BotState.IDLE
        self.is_running = False
        self.task: Optional[asyncio.Task] = None
        
        # Position tracking
        self.current_position: Optional[Dict[str, Any]] = None
        self.entry_price: Optional[float] = None
        self.position_id: Optional[str] = None
        self.position_code: Optional[str] = None
        self.entry_side: str = "BUY"
        self.entry_quantity: float = 1.0
        self.stop_loss_price: Optional[float] = None
        self.take_profit_price: Optional[float] = None
        self.close_order_inflight: bool = False
        self.last_observed_price: Optional[float] = None
        self.last_trigger_type: Optional[str] = None
        self.last_trigger_at: Optional[str] = None
        
        # Profit analyzer
        self.profit_analyzer = ProfitAnalyzer(
            patience_min=self.config.profit_patience_min,
            patience_max=self.config.profit_patience_max,
            decline_threshold=self.config.profit_decline_threshold
        )

        # Auth/session for market data endpoints
        self.session_token: Optional[str] = None
        
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

    def _resolve_timezone(self, timezone_name: Optional[str]):
        """Resolve runtime timezone with fallback to local machine timezone."""
        if timezone_name:
            try:
                tz = ZoneInfo(timezone_name)
                return tz, timezone_name
            except Exception:
                logger.warning(f"⚠️ Invalid timezone '{timezone_name}', falling back to local timezone")

        local_tz = datetime.now().astimezone().tzinfo
        local_name = getattr(local_tz, 'key', None) or str(local_tz) or 'local'
        return local_tz, local_name

    def _now(self) -> datetime:
        """Return current timezone-aware datetime for bot scheduling decisions."""
        return datetime.now(self.runtime_tz)
        
    async def start(self):
        """Start the trading bot"""
        if self.is_running:
            logger.warning("⚠️ Bot already running")
            return False
        
        logger.info(f"🚀 Starting NAS100 Trading Bot")
        logger.info(f"   Symbol: {self.config.symbol}")
        logger.info(f"   Window: {self.config.trade_window_start} - {self.config.trade_window_end}")
        logger.info(f"   Timezone: {self.runtime_tz_name}")
        logger.info(f"   Stop Loss: {self.config.stop_loss_pct*100}%")
        logger.info(f"   Take Profit: {self.config.take_profit_pct*100}%")
        logger.info(f"   Profit Strategy: {self.config.profit_patience_min}-{self.config.profit_patience_max}s patience, {self.config.profit_decline_threshold*100}% decline threshold")
        
        self.is_running = True
        self.stats['started_at'] = self._now().isoformat()
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
                now = self._now()
                current_time = now.time().replace(tzinfo=None)
                
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
                self.position_code = self._extract_position_code_from_result(order_result)
                self.entry_side = "BUY"
                self.entry_quantity = 1.0
                self.stop_loss_price, self.take_profit_price = self._compute_exit_levels(
                    entry_price=current_price,
                    side=self.entry_side,
                )
                self.close_order_inflight = False
                self.last_observed_price = current_price
                
                # Reset profit analyzer
                self.profit_analyzer.reset()
                self.last_movement_check_at = None
                self.last_movement_signal = None
                
                self.stats['trades_executed'] += 1
                self.stats['last_trade_at'] = self._now().isoformat()
                
                logger.info(
                    f"✅ Position opened: {self.position_id} | positionCode={self.position_code or 'n/a'} | "
                    f"SL={self.stop_loss_price:.2f} TP={self.take_profit_price:.2f}"
                )
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

            observed_high = max(
                float(price_data.get('high') or current_price),
                float(self.last_observed_price or current_price),
                float(current_price),
            )
            observed_low = min(
                float(price_data.get('low') or current_price),
                float(self.last_observed_price or current_price),
                float(current_price),
            )
            self.last_observed_price = current_price

            touch_trigger = self._detect_touch_trigger(observed_high, observed_low)
            if touch_trigger:
                sl_value = f"{self.stop_loss_price:.2f}" if self.stop_loss_price is not None else "n/a"
                tp_value = f"{self.take_profit_price:.2f}" if self.take_profit_price is not None else "n/a"
                logger.warning(
                    f"🎯 {touch_trigger.upper()} TOUCH TRIGGERED: range=[{observed_low:.2f}, {observed_high:.2f}] "
                    f"SL={sl_value} TP={tp_value}"
                )
                await self._close_position(
                    f"{touch_trigger.upper()} touch trigger",
                    trigger_type=touch_trigger,
                )

                profit = current_price - self.entry_price if self.entry_price else 0.0
                if profit > 0:
                    self.stats['wins'] += 1
                else:
                    self.stats['losses'] += 1
                self.stats['total_profit'] += profit
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
            now = self._now()
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
    
    async def _close_position(self, reason: str, trigger_type: Optional[str] = None):
        """Close current position"""
        try:
            if not self.position_id:
                logger.warning("⚠️ No position to close")
                return
            if self.close_order_inflight:
                logger.warning("⚠️ Close order already in-flight; skipping duplicate close request")
                return

            self.close_order_inflight = True
            
            logger.info(f"🔴 CLOSING POSITION: {reason}")
            
            close_side = "sell" if self.entry_side == "BUY" else "buy"
            position_effect = "CLOSE" if self.position_code else "OPEN"
            if not self.position_code:
                logger.warning("⚠️ Position code missing; falling back to opposite-side market order without explicit CLOSE linkage")

            # Place close order
            close_result = await self._place_order(
                symbol=self.config.symbol,
                side=close_side,
                quantity=self.entry_quantity,
                amount=self.config.purchase_amount,
                position_effect=position_effect,
                position_code=self.position_code,
            )
            
            if close_result and close_result.get('success'):
                logger.info(f"✅ Position closed successfully")
                if trigger_type in ("take_profit", "stop_loss"):
                    self.last_trigger_type = trigger_type
                    self.last_trigger_at = self._now().isoformat()
            else:
                logger.error(f"❌ Failed to close position: {close_result}")
            
            # Clear position state
            self.current_position = None
            self.entry_price = None
            self.position_id = None
            self.position_code = None
            self.stop_loss_price = None
            self.take_profit_price = None
            self.last_observed_price = None
            
            # Start cooldown
            self.cooldown_until = self._now() + timedelta(minutes=self.config.cooldown_minutes)
            logger.info(f"💤 Entering {self.config.cooldown_minutes}-minute cooldown until {self.cooldown_until.strftime('%H:%M:%S')}")
            
        except Exception as e:
            logger.error(f"❌ Error closing position: {e}", exc_info=True)
        finally:
            self.close_order_inflight = False

    def _compute_exit_levels(self, entry_price: float, side: str) -> tuple[float, float]:
        """Compute stop-loss and take-profit absolute prices from configured percentages."""
        if entry_price <= 0:
            return 0.0, 0.0

        stop_pct = max(0.0, float(self.config.stop_loss_pct))
        tp_pct = max(0.0, float(self.config.take_profit_pct))

        if side == "BUY":
            stop_loss = entry_price * (1.0 - stop_pct)
            take_profit = entry_price * (1.0 + tp_pct)
        else:
            stop_loss = entry_price * (1.0 + stop_pct)
            take_profit = entry_price * (1.0 - tp_pct)

        return round(stop_loss, 4), round(take_profit, 4)

    def _detect_touch_trigger(self, observed_high: float, observed_low: float) -> Optional[str]:
        """Return trigger type when observed price range touches configured TP/SL."""
        if self.entry_price is None:
            return None
        if self.stop_loss_price is None or self.take_profit_price is None:
            return None

        if self.entry_side == "BUY":
            if observed_high >= self.take_profit_price:
                return "take_profit"
            if observed_low <= self.stop_loss_price:
                return "stop_loss"
            return None

        if observed_low <= self.take_profit_price:
            return "take_profit"
        if observed_high >= self.stop_loss_price:
            return "stop_loss"
        return None

    def _extract_position_code_from_result(self, order_result: Dict[str, Any]) -> Optional[str]:
        """Extract position code from varied order response payload shapes."""
        if not isinstance(order_result, dict):
            return None

        direct = order_result.get('positionCode') or order_result.get('position_code')
        if direct:
            return str(direct)

        nested = order_result.get('data')
        if isinstance(nested, dict):
            nested_direct = nested.get('positionCode') or nested.get('position_code') or nested.get('code') or nested.get('id')
            if nested_direct:
                return str(nested_direct)

            nested_order = nested.get('order')
            if isinstance(nested_order, dict):
                nested_order_code = nested_order.get('positionCode') or nested_order.get('position_code')
                if nested_order_code:
                    return str(nested_order_code)

        return None
    
    async def _get_market_price(self) -> Optional[Dict[str, Any]]:
        """Fetch current market price from API"""
        try:
            await self._ensure_session_token()

            # Call backend API endpoint
            response = await self.client.post(
                f"{self.api_base_url}/api/trading/marketdata",
                json={
                    "request": {
                        "symbols": [self.config.symbol],
                        "market": "spot",
                        "type": "quote",
                    }
                },
                headers={"X-Liquid-Token": self.session_token},
            )

            if response.status_code in (401, 403):
                self.session_token = None
                await self._ensure_session_token()
                response = await self.client.post(
                    f"{self.api_base_url}/api/trading/marketdata",
                    json={
                        "request": {
                            "symbols": [self.config.symbol],
                            "market": "spot",
                            "type": "quote",
                        }
                    },
                    headers={"X-Liquid-Token": self.session_token},
                )

            response.raise_for_status()
            data = response.json()
            
            if isinstance(data, dict) and data.get('success'):
                payload = data.get('data', {})
                quotes = payload.get('quotes') if isinstance(payload, dict) else None
                if isinstance(quotes, list) and quotes:
                    quote = quotes[0] or {}
                    price = quote.get('last') or quote.get('price') or quote.get('bid') or quote.get('ask')
                    if isinstance(price, (int, float)):
                        high = quote.get('high') or quote.get('dayHigh') or quote.get('highPrice') or price
                        low = quote.get('low') or quote.get('dayLow') or quote.get('lowPrice') or price
                        return {
                            'bid': float(price),
                            'ask': float(price),
                            'last': float(price),
                            'high': float(high) if isinstance(high, (int, float)) else float(price),
                            'low': float(low) if isinstance(low, (int, float)) else float(price),
                            'raw': quote,
                        }

            if isinstance(data, dict):
                quotes = data.get('quotes')
                if isinstance(quotes, list) and quotes:
                    quote = quotes[0] or {}
                    price = quote.get('last') or quote.get('price') or quote.get('bid') or quote.get('ask')
                    if isinstance(price, (int, float)):
                        high = quote.get('high') or quote.get('dayHigh') or quote.get('highPrice') or price
                        low = quote.get('low') or quote.get('dayLow') or quote.get('lowPrice') or price
                        return {
                            'bid': float(price),
                            'ask': float(price),
                            'last': float(price),
                            'high': float(high) if isinstance(high, (int, float)) else float(price),
                            'low': float(low) if isinstance(low, (int, float)) else float(price),
                            'raw': quote,
                        }
            
            return None
            
        except Exception as e:
            logger.error(f"❌ Error fetching market price: {e}")
            return None

    async def _ensure_session_token(self):
        """Ensure bot has a valid basic-auth session token for market data endpoints."""
        if self.session_token:
            return

        response = await self.client.post(
            f"{self.api_base_url}/api/trading/auth/basic/login",
            json={
                "username": self.auth.get('username'),
                "domain": self.auth.get('domain', ''),
                "password": self.auth.get('password'),
            },
        )
        response.raise_for_status()
        data = response.json()

        token = (
            data.get('token')
            or data.get('sessionToken')
            or data.get('sessionID')
            or data.get('sessionId')
            or data.get('id')
            or (data.get('data') or {}).get('token')
            or (data.get('data') or {}).get('sessionToken')
            or (data.get('data') or {}).get('sessionID')
            or (data.get('data') or {}).get('sessionId')
            or (data.get('data') or {}).get('id')
        )
        if not token:
            raise ValueError("No session token received from basic login")

        self.session_token = token
    
    async def _place_order(
        self,
        symbol: str,
        side: str,
        quantity: float,
        amount: float,
        position_effect: str = "OPEN",
        position_code: Optional[str] = None,
        order_type: str = "MARKET",
        price: Optional[float] = None,
    ) -> Optional[Dict[str, Any]]:
        """Place an order via bot API endpoint"""
        try:
            payload = {
                "accountId": self.account_id,
                "symbol": symbol,
                "side": side,
                "quantity": quantity,
                "amount": amount,
                "username": self.auth.get('username'),
                "password": self.auth.get('password'),
                "positionEffect": position_effect,
                "orderType": order_type,
            }
            if position_code:
                payload["positionCode"] = position_code
            if price is not None:
                payload["price"] = price

            response = await self.client.post(
                f"{self.api_base_url}/api/trading/bot/orders/place",
                json=payload
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
                'take_profit_pct': self.config.take_profit_pct * 100,
                'trade_window': f"{self.config.trade_window_start} - {self.config.trade_window_end}",
                'cooldown_minutes': self.config.cooldown_minutes,
                'movement_check_interval': self.config.movement_check_interval,
                'timezone': self.runtime_tz_name,
            },
            'current_position': None,
            'cooldown_remaining': None,
            'statistics': self.stats,
            'profit_analysis': None,
            'movement_signal': self.last_movement_signal,
            'last_trigger': {
                'type': self.last_trigger_type,
                'at': self.last_trigger_at,
            },
            'server_time': self._now().isoformat(),
        }
        
        # Add position details
        if self.current_position:
            status['current_position'] = {
                'position_id': self.position_id,
                'position_code': self.position_code,
                'entry_price': self.entry_price,
                'entry_side': self.entry_side,
                'stop_loss_price': self.stop_loss_price,
                'take_profit_price': self.take_profit_price,
                'symbol': self.config.symbol
            }
        
        # Add cooldown info
        if self.cooldown_until:
            remaining = (self.cooldown_until - self._now()).total_seconds()
            if remaining > 0:
                status['cooldown_remaining'] = int(remaining)
        
        # Add profit analysis
        if self.current_position:
            status['profit_analysis'] = self.profit_analyzer.get_statistics()
        
        return status
    
    async def cleanup(self):
        """Cleanup resources"""
        await self.client.aclose()
