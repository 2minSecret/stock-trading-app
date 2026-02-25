"""
Profit Analyzer - Smart Exit Strategy Module
Tracks profit trends and determines optimal exit timing using pandas.
"""

import pandas as pd
from datetime import datetime, timedelta
from dataclasses import dataclass
from typing import Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)


@dataclass
class ProfitSnapshot:
    """Individual profit data point"""
    timestamp: datetime
    profit: float
    price: float
    
    
class ProfitAnalyzer:
    """
    Intelligent profit tracking and exit decision engine.
    
    Strategy:
    - Record profit history using pandas DataFrame
    - Track peak profit during observation period
    - Monitor for profit decline from peak
    - Trigger exit on 2% decline or after 3-minute patience
    """
    
    def __init__(self, patience_min: int, patience_max: int, decline_threshold: float):
        """
        Initialize profit analyzer.
        
        Args:
            patience_min: Minimum seconds to observe profit (e.g., 60)
            patience_max: Maximum seconds to wait for better profit (e.g., 180)
            decline_threshold: Decline percent from peak to trigger exit (e.g., 0.02 for 2%)
        """
        self.patience_min = patience_min
        self.patience_max = patience_max
        self.decline_threshold = decline_threshold
        
        # Profit history (pandas for efficient time-series analysis)
        self.history = pd.DataFrame(columns=['timestamp', 'profit', 'price'])
        self.movement_history = pd.DataFrame(columns=['timestamp', 'price', 'delta'])
        
        # Peak tracking
        self.peak_profit: Optional[float] = None
        self.peak_timestamp: Optional[datetime] = None
        self.first_profit_at: Optional[datetime] = None

    def record_movement(self, price: float, current_profit: float) -> Dict[str, Any]:
        """
        Record movement and forecast next step from momentum/trend.

        Checks whether latest movement is equal/bigger/lower than previous movement,
        determines up/down direction, and predicts the next move.
        """
        now = datetime.now()

        previous_price = None
        if not self.movement_history.empty:
            previous_price = float(self.movement_history.iloc[-1]['price'])

        delta = 0.0 if previous_price is None else (price - previous_price)

        new_row = pd.DataFrame([{
            'timestamp': now,
            'price': price,
            'delta': delta,
        }])
        self.movement_history = pd.concat([self.movement_history, new_row], ignore_index=True)

        if len(self.movement_history) < 3:
            return {
                'action': 'HOLD',
                'reason': 'Gathering movement samples',
                'direction': 'flat',
                'movement_vs_last': 'equal',
                'predicted_direction': 'flat',
                'confidence': 0.0,
            }

        current_delta = float(self.movement_history.iloc[-1]['delta'])
        previous_delta = float(self.movement_history.iloc[-2]['delta'])

        epsilon = max(abs(price) * 0.00001, 1e-6)
        current_magnitude = abs(current_delta)
        previous_magnitude = abs(previous_delta)

        if abs(current_magnitude - previous_magnitude) <= epsilon:
            movement_vs_last = 'equal'
        elif current_magnitude > previous_magnitude:
            movement_vs_last = 'bigger'
        else:
            movement_vs_last = 'lower'

        if current_delta > epsilon:
            direction = 'up'
        elif current_delta < -epsilon:
            direction = 'down'
        else:
            direction = 'flat'

        recent = self.movement_history.tail(min(6, len(self.movement_history))).copy()
        recent_prices = recent['price'].astype(float).tolist()
        x_values = list(range(len(recent_prices)))
        x_mean = sum(x_values) / len(x_values)
        y_mean = sum(recent_prices) / len(recent_prices)
        denominator = sum((x - x_mean) ** 2 for x in x_values) or 1.0
        slope = sum((x - x_mean) * (y - y_mean) for x, y in zip(x_values, recent_prices)) / denominator

        acceleration = current_delta - previous_delta
        forecast_delta = current_delta + (0.6 * acceleration) + (0.4 * slope)

        if forecast_delta > epsilon:
            predicted_direction = 'up'
        elif forecast_delta < -epsilon:
            predicted_direction = 'down'
        else:
            predicted_direction = 'flat'

        checks = [
            (current_delta > epsilon and predicted_direction == 'up') or (current_delta < -epsilon and predicted_direction == 'down'),
            (slope > epsilon and predicted_direction == 'up') or (slope < -epsilon and predicted_direction == 'down'),
            (acceleration > epsilon and predicted_direction == 'up') or (acceleration < -epsilon and predicted_direction == 'down'),
        ]
        confidence = sum(1.0 for check in checks if check) / len(checks)

        strong_bearish = (
            predicted_direction == 'down'
            and direction == 'down'
            and movement_vs_last in ['equal', 'bigger']
            and confidence >= 0.67
        )

        if strong_bearish and current_profit <= 0:
            return {
                'action': 'SELL_CUT_LOSS',
                'reason': f'Bearish momentum forecast ({movement_vs_last} down move, confidence {confidence:.2f})',
                'direction': direction,
                'movement_vs_last': movement_vs_last,
                'predicted_direction': predicted_direction,
                'confidence': confidence,
                'delta': current_delta,
                'previous_delta': previous_delta,
            }

        if strong_bearish and current_profit > 0 and confidence >= 0.8:
            return {
                'action': 'SELL_PROTECT_PROFIT',
                'reason': f'Profit protection: bearish continuation likely (confidence {confidence:.2f})',
                'direction': direction,
                'movement_vs_last': movement_vs_last,
                'predicted_direction': predicted_direction,
                'confidence': confidence,
                'delta': current_delta,
                'previous_delta': previous_delta,
            }

        return {
            'action': 'HOLD',
            'reason': f'Momentum suggests hold ({direction}, next: {predicted_direction}, confidence {confidence:.2f})',
            'direction': direction,
            'movement_vs_last': movement_vs_last,
            'predicted_direction': predicted_direction,
            'confidence': confidence,
            'delta': current_delta,
            'previous_delta': previous_delta,
        }
        
    def record_profit(self, profit: float, price: float) -> Dict[str, Any]:
        """
        Record current profit and analyze exit conditions.
        
        Args:
            profit: Current profit/loss value (positive = profit, negative = loss)
            price: Current asset price
            
        Returns:
            Dictionary with:
            - action: 'HOLD' | 'SELL_IMMEDIATE' | 'SELL_TIMEOUT'
            - reason: Human-readable explanation
            - peak_profit: Peak profit achieved
            - time_in_profit: Seconds spent in profitable state
            - decline_pct: Percentage decline from peak (if applicable)
        """
        now = datetime.now()
        
        # Add to history
        new_row = pd.DataFrame([{
            'timestamp': now,
            'profit': profit,
            'price': price
        }])
        self.history = pd.concat([self.history, new_row], ignore_index=True)
        
        # Not yet profitable
        if profit <= 0:
            return {
                'action': 'HOLD',
                'reason': 'No profit yet',
                'peak_profit': 0.0,
                'time_in_profit': 0,
                'current_profit': profit
            }
        
        # First time in profit?
        if self.first_profit_at is None:
            self.first_profit_at = now
            self.peak_profit = profit
            self.peak_timestamp = now
            logger.info(f"✅ First profit detected: ${profit:.2f}")
            return {
                'action': 'HOLD',
                'reason': 'First profit detected, starting observation period',
                'peak_profit': profit,
                'time_in_profit': 0,
                'current_profit': profit
            }
        
        # Update peak if profit increased
        if profit > self.peak_profit:
            self.peak_profit = profit
            self.peak_timestamp = now
            logger.info(f"📈 New peak profit: ${profit:.2f}")
        
        # Calculate time in profit
        time_in_profit = (now - self.first_profit_at).total_seconds()
        
        # Check minimum patience period
        if time_in_profit < self.patience_min:
            return {
                'action': 'HOLD',
                'reason': f'Within minimum patience period ({time_in_profit:.0f}s/{self.patience_min}s)',
                'peak_profit': self.peak_profit,
                'time_in_profit': time_in_profit,
                'current_profit': profit
            }
        
        # Calculate decline from peak
        decline_pct = (self.peak_profit - profit) / self.peak_profit if self.peak_profit > 0 else 0
        
        # Immediate exit if profit declining significantly
        if decline_pct >= self.decline_threshold:
            logger.warning(f"⚠️ Profit decline detected: {decline_pct*100:.1f}% from peak ${self.peak_profit:.2f}")
            return {
                'action': 'SELL_IMMEDIATE',
                'reason': f'Profit declined {decline_pct*100:.1f}% from peak ${self.peak_profit:.2f}',
                'peak_profit': self.peak_profit,
                'time_in_profit': time_in_profit,
                'decline_pct': decline_pct,
                'current_profit': profit
            }
        
        # Exit if patience exhausted
        if time_in_profit >= self.patience_max:
            logger.info(f"⏱️ Maximum patience reached: {time_in_profit:.0f}s")
            return {
                'action': 'SELL_TIMEOUT',
                'reason': f'Maximum patience period reached ({time_in_profit:.0f}s)',
                'peak_profit': self.peak_profit,
                'time_in_profit': time_in_profit,
                'current_profit': profit
            }
        
        # Continue holding - profit is stable or improving
        return {
            'action': 'HOLD',
            'reason': f'Profit trend stable, monitoring... (Peak: ${self.peak_profit:.2f}, Time: {time_in_profit:.0f}s/{self.patience_max}s)',
            'peak_profit': self.peak_profit,
            'time_in_profit': time_in_profit,
            'decline_pct': decline_pct,
            'current_profit': profit
        }
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get profit tracking statistics"""
        if self.history.empty:
            return {
                'samples': 0,
                'peak_profit': 0.0,
                'current_profit': 0.0,
                'time_in_profit': 0
            }
        
        current_profit = self.history.iloc[-1]['profit'] if not self.history.empty else 0.0
        time_in_profit = (datetime.now() - self.first_profit_at).total_seconds() if self.first_profit_at else 0
        
        return {
            'samples': len(self.history),
            'peak_profit': self.peak_profit or 0.0,
            'current_profit': current_profit,
            'time_in_profit': time_in_profit,
            'first_profit_at': self.first_profit_at.isoformat() if self.first_profit_at else None,
            'peak_at': self.peak_timestamp.isoformat() if self.peak_timestamp else None,
            'movement_samples': len(self.movement_history),
        }
    
    def reset(self):
        """Reset analyzer for new trading cycle"""
        logger.info("🔄 Resetting profit analyzer")
        self.history = pd.DataFrame(columns=['timestamp', 'profit', 'price'])
        self.movement_history = pd.DataFrame(columns=['timestamp', 'price', 'delta'])
        self.peak_profit = None
        self.peak_timestamp = None
        self.first_profit_at = None
