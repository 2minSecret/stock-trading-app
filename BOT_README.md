# 🤖 NAS100 Automated Trading Bot

## Overview
Intelligent automated trading system for NAS100 with adaptive profit-taking strategy.

## Features

### ✅ Smart Trading
- **Symbol**: NAS100 (Nasdaq 100 Index) only
- **Window**: 09:25 - 10:00 (35-minute daily trading window)
- **Purchase**: $100 per trade
- **Auto Stop-Loss**: Triggers at 20% loss ($20)

### 💰 Intelligent Profit Management
Uses pandas-based profit analyzer with adaptive exit strategy:
- **Observation Period**: 1-3 minutes in profitable state
- **Peak Tracking**: Continuously monitors highest profit achieved
- **Exit Trigger**: Sells on 2% decline from peak profit
- **Maximum Patience**: Auto-exit after 3 minutes of profit observation

### 🔄 Risk Management
- **Cooldown**: 32-minute mandatory rest period between trades
- **Real-time Monitoring**: Position checked every 5 seconds
- **Safe Execution**: Async background tasks don't block API

## Architecture

### Backend (Python/FastAPI)
```
backend/
├── profit_analyzer.py    # Pandas-based profit trend analyzer
├── trading_bot.py        # Core bot engine with asyncio loop
├── bot_manager.py        # Multi-user bot orchestration
└── bot_routes.py         # FastAPI REST endpoints
```

### Frontend (React)
```
frontend/src/
├── BotControlPanel.jsx   # UI control panel
└── BotControlPanel.css   # Styling
```

## API Endpoints

### `POST /api/trading/bot/start`
Start automated bot for an account.

**Request:**
```json
{
  "accountId": "account-123",
  "username": "trader@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Trading bot started for NAS100",
  "data": {
    "account_id": "account-123",
    "config": {
      "symbol": "NAS100",
      "window": "09:25:00 - 10:00:00",
      "stop_loss": "20%",
      "cooldown": "32 minutes"
    }
  }
}
```

### `POST /api/trading/bot/stop`
Stop running bot for an account.

**Request:**
```json
{
  "accountId": "account-123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Bot stopped successfully",
  "final_stats": {
    "trades_executed": 5,
    "wins": 3,
    "losses": 2,
    "total_profit": 15.50
  }
}
```

### `POST /api/trading/bot/status`
Get real-time bot status.

**Request:**
```json
{
  "accountId": "account-123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "is_running": true,
    "state": "in_position",
    "current_position": {
      "position_id": "order-789",
      "entry_price": 15250.50,
      "symbol": "NAS100"
    },
    "profit_analysis": {
      "current_profit": 12.30,
      "peak_profit": 15.80,
      "time_in_profit": 125,
      "samples": 25
    },
    "statistics": {
      "trades_executed": 8,
      "wins": 5,
      "losses": 3,
      "total_profit": 47.50,
      "last_trade_at": "2025-01-14T09:42:15"
    }
  }
}
```

### `GET /api/trading/bot/all`
Get status of all active bots across all accounts.

## Bot State Machine

```
IDLE
  ↓
WAITING_FOR_WINDOW (outside 09:25-10:00)
  ↓
MONITORING_ENTRY (inside window, looking for entry)
  ↓
IN_POSITION (trade active, monitoring for exit)
  ↓
COOLDOWN (32-min rest after exit)
  ↓
WAITING_FOR_WINDOW
```

## Trading Logic

### Entry Conditions
1. Current time between 09:25 and 10:00
2. Not in cooldown period
3. No existing position open

### Exit Conditions (Priority Order)
1. **Stop-Loss**: Loss ≥ 20% → Immediate exit
2. **Profit Decline**: In profit for ≥1 min AND declined ≥2% from peak → Exit
3. **Patience Timeout**: In profit for ≥3 min → Exit
4. **Window Close**: After 10:00 → Exit (safety)

### Profit Analysis Algorithm
```python
1. Record profit snapshots every 5 seconds (pandas DataFrame)
2. Track peak profit achieved
3. When profit first appears:
   - Start observation timer
   - Record peak
4. Every check:
   - Update peak if profit increased
   - Calculate decline% from peak
   - If decline ≥ 2% AND observation ≥ 60s → SELL
   - If observation ≥ 180s → SELL
   - Otherwise → HOLD
```

## Usage

### 1. Start Backend
```bash
cd backend
uvicorn main:app --reload --port 8001
```

### 2. Start Frontend
```bash
cd frontend
npm run dev
```

### 3. Using the Bot
1. Login to the application
2. Select a trading account
3. Scroll to "🤖 NAS100 Trading Bot" panel
4. Click "▶️ Start Bot"
5. Monitor real-time status updates

## Safety Features

### 🛡️ Built-in Protections
- **Hard Stop-Loss**: Guaranteed exit at 20% loss
- **Window Enforcement**: Only trades during safe hours
- **Cooldown**: Prevents overtrading
- **State Isolation**: Each account has independent bot
- **Graceful Shutdown**: Closes positions when stopped

### 🔍 Monitoring
- Position checked every 5 seconds
- Real-time profit tracking
- Continuous peak profit monitoring
- Automatic cooldown enforcement

## Configuration

Edit `TradingConfig` in [trading_bot.py](backend/trading_bot.py) to customize:

```python
@dataclass
class TradingConfig:
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
```

## Statistics Dashboard

The bot tracks and displays:
- **Total Trades**: Number of trades executed
- **Win/Loss Count**: Successful vs stopped-out trades
- **Total P/L**: Cumulative profit/loss
- **Win Rate**: Percentage of profitable trades
- **Last Trade Time**: Most recent execution

## Example Trading Session

```
09:24:50 - Bot: Waiting for trading window
09:25:00 - Bot: Window opened, monitoring entry
09:25:05 - Bot: Entering position @ $15,250.50
09:25:10 - Bot: In position, P/L: -$2.30 (monitoring)
09:26:15 - Bot: First profit detected: $8.50
09:27:30 - Bot: New peak profit: $18.70
09:28:05 - Bot: Profit declined 2.3% from peak, SELLING
09:28:10 - Bot: Position closed, P/L: +$16.20
09:28:11 - Bot: Entering 32-minute cooldown
10:00:11 - Bot: Cooldown ended, waiting for next window
```

## Troubleshooting

### Bot Won't Start
- Verify account credentials are correct
- Check trading window time (must be 09:25-10:00)
- Ensure no other bot running for same account

### Bot Not Trading
- Confirm current time is within trading window
- Check if in cooldown period (visible in UI)
- Verify market data is accessible

### Position Not Closing
- Check logs for API errors
- Verify stop-loss threshold (20%)
- Ensure profit decline logic is working (check profit_analysis)

## Dependencies

### Backend
- `fastapi` - Web framework
- `uvicorn` - ASGI server
- `pandas` - Time-series profit analysis
- `httpx` - Async HTTP client
- `pydantic` - Data validation

### Frontend
- `react` - UI framework
- `axios` - HTTP client

## Future Enhancements

Potential improvements:
- [ ] Multiple symbols support
- [ ] Dynamic position sizing based on account balance
- [ ] Machine learning for entry timing optimization
- [ ] Advanced technical indicators integration
- [ ] Historical performance analytics
- [ ] Backtesting framework
- [ ] Email/SMS notifications on trades
- [ ] Risk-adjusted position sizing

---

**⚠️ Disclaimer**: This is an automated trading system. Use at your own risk. Always test with demo accounts first before using real funds. Past performance does not guarantee future results.
