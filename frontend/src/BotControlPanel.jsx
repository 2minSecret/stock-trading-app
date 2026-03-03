/**
 * Bot Control Panel - Frontend UI for NAS100 Trading Bot
 * 
 * Features:
 * - Start/Stop bot controls
 * - Real-time status monitoring
 * - Performance statistics
 * - Position tracking
 */

import { useState, useEffect } from 'react';
import axios from 'axios';
import './BotControlPanel.css';

const frontendHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `http://${frontendHost}:8001`;
const BOT_CUSTOM_CONFIG_STORAGE_KEY = 'bot_custom_config_v1';

const normalizeActiveDays = (days) => {
  if (!Array.isArray(days)) return [1, 2, 3, 4, 5, 6, 7];

  const hasZeroBasedValue = days.some((value) => Number(value) === 0);
  const normalized = days
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value))
    .map((value) => (hasZeroBasedValue ? value + 1 : value))
    .filter((value) => value >= 1 && value <= 7);

  return normalized.length > 0 ? Array.from(new Set(normalized)).sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6, 7];
};

const getStoredBotConfig = () => {
  const fallback = {
    TRADING_WINDOW: { START: '00:00', END: '23:59' },
    ACTIVE_DAYS: [1, 2, 3, 4, 5, 6, 7],
  };

  try {
    const raw = localStorage.getItem(BOT_CUSTOM_CONFIG_STORAGE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;

    const start = parsed?.TRADING_WINDOW?.START;
    const end = parsed?.TRADING_WINDOW?.END;
    const hasWindow = typeof start === 'string' && start && typeof end === 'string' && end;

    return {
      ...fallback,
      ...parsed,
      TRADING_WINDOW: hasWindow ? { START: start, END: end } : fallback.TRADING_WINDOW,
      ACTIVE_DAYS: normalizeActiveDays(parsed.ACTIVE_DAYS),
    };
  } catch (_error) {
    return fallback;
  }
};

export default function BotControlPanel({ selectedAccount, authCredentials }) {
  const [botStatus, setBotStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pollingInterval, setPollingInterval] = useState(null);

  // Poll for bot status when bot is running
  useEffect(() => {
    if (botStatus?.is_running) {
      const interval = setInterval(() => {
        fetchBotStatus(false); // silent fetch (no loading state)
      }, 5000); // Poll every 5 seconds
      
      setPollingInterval(interval);
      return () => clearInterval(interval);
    } else if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
  }, [botStatus?.is_running]);

  // Fetch bot status
  const fetchBotStatus = async (showLoading = true) => {
    if (!selectedAccount?.accountId) return;

    try {
      if (showLoading) setIsLoading(true);
      setError(null);

      const response = await axios.post(`${API_BASE_URL}/api/trading/bot/status`, {
        accountId: selectedAccount.accountId
      });

      if (response.data.success) {
        setBotStatus(response.data.data);
      } else {
        setBotStatus(null);
      }
    } catch (err) {
      if (showLoading) {
        console.error('Error fetching bot status:', err);
        setError(err.response?.data?.detail || err.message);
      }
    } finally {
      if (showLoading) setIsLoading(false);
    }
  };

  // Start bot
  const handleStartBot = async () => {
    const sessionToken = localStorage.getItem('liquid_session_token') || undefined;
    const hasCredentials = !!(authCredentials?.username && authCredentials?.password);
    if (!selectedAccount?.accountId || (!hasCredentials && !sessionToken)) {
      setError('Missing account or authentication (session or credentials)');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await axios.post(`${API_BASE_URL}/api/trading/bot/start`, {
        accountId: selectedAccount.accountId,
        username: authCredentials.username,
        password: authCredentials.password,
        sessionToken,
        customConfig: getStoredBotConfig(),
      });

      if (response.data.success) {
        await fetchBotStatus();
        setError(null);
      } else {
        setError(response.data.message || 'Failed to start bot');
      }
    } catch (err) {
      console.error('Error starting bot:', err);
      setError(err.response?.data?.detail || err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Stop bot
  const handleStopBot = async () => {
    if (!selectedAccount?.accountId) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await axios.post(`${API_BASE_URL}/api/trading/bot/stop`, {
        accountId: selectedAccount.accountId
      });

      if (response.data.success) {
        setBotStatus(null);
        setError(null);
      } else {
        setError(response.data.message || 'Failed to stop bot');
      }
    } catch (err) {
      console.error('Error stopping bot:', err);
      setError(err.response?.data?.detail || err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Initial status check on mount or account change
  useEffect(() => {
    fetchBotStatus();
  }, [selectedAccount?.accountId]);

  // Render state badge
  const renderStateBadge = () => {
    if (!botStatus) return null;

    const stateColors = {
      'idle': 'gray',
      'waiting_for_window': 'orange',
      'waiting_for_day': 'orange',
      'monitoring_entry': 'blue',
      'in_position': 'green',
      'cooldown': 'purple',
      'stopped': 'red'
    };

    const stateLabels = {
      'idle': 'Idle',
      'waiting_for_window': '⏰ Waiting for Window',
      'waiting_for_day': '📅 Waiting for Active Day',
      'monitoring_entry': '👀 Monitoring Entry',
      'in_position': '📈 In Position',
      'cooldown': '💤 Cooldown',
      'stopped': '🛑 Stopped'
    };

    const color = stateColors[botStatus.state] || 'gray';
    const label = stateLabels[botStatus.state] || botStatus.state;

    return (
      <span className={`bot-state-badge state-${color}`}>
        {label}
      </span>
    );
  };

  if (!selectedAccount) {
    return (
      <div className="bot-control-panel">
        <h3>🤖 Automated Trading Bot</h3>
        <p className="info-text">Select an account to enable bot trading</p>
      </div>
    );
  }

  return (
    <div className="bot-control-panel">
      <div className="bot-header">
        <h3>🤖 NAS100 Trading Bot</h3>
        {renderStateBadge()}
      </div>

      {error && (
        <div className="bot-error">
          ⚠️ {error}
        </div>
      )}

      <div className="bot-controls">
        {!botStatus?.is_running ? (
          <button
            className="bot-button start-button"
            onClick={handleStartBot}
            disabled={isLoading}
          >
            {isLoading ? '⏳ Starting...' : '▶️ Start Bot'}
          </button>
        ) : (
          <button
            className="bot-button stop-button"
            onClick={handleStopBot}
            disabled={isLoading}
          >
            {isLoading ? '⏳ Stopping...' : '⏹️ Stop Bot'}
          </button>
        )}
        
        <button
          className="bot-button refresh-button"
          onClick={() => fetchBotStatus()}
          disabled={isLoading}
        >
          🔄 Refresh
        </button>
      </div>

      {botStatus && (
        <>
          {/* Configuration Info */}
          <div className="bot-section">
            <h4>⚙️ Configuration</h4>
            <div className="bot-info-grid">
              <div className="info-item">
                <span className="info-label">Symbol:</span>
                <span className="info-value">{botStatus.config?.symbol}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Amount:</span>
                <span className="info-value">${botStatus.config?.purchase_amount}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Stop Loss:</span>
                <span className="info-value">{botStatus.config?.stop_loss_pct}%</span>
              </div>
              <div className="info-item">
                <span className="info-label">Trading Window:</span>
                <span className="info-value">{botStatus.config?.trade_window}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Cooldown:</span>
                <span className="info-value">{botStatus.config?.cooldown_minutes} min</span>
              </div>
            </div>
          </div>

          {/* Current Position */}
          {botStatus.current_position && (
            <div className="bot-section position-active">
              <h4>📊 Current Position</h4>
              <div className="bot-info-grid">
                <div className="info-item">
                  <span className="info-label">Entry Price:</span>
                  <span className="info-value">${botStatus.current_position.entry_price?.toFixed(2)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Position ID:</span>
                  <span className="info-value">{botStatus.current_position.position_id}</span>
                </div>
              </div>

              {/* Profit Analysis */}
              {botStatus.profit_analysis && (
                <div className="profit-analysis">
                  <h5>💰 Profit Tracking</h5>
                  <div className="bot-info-grid">
                    <div className="info-item">
                      <span className="info-label">Current P/L:</span>
                      <span className={`info-value ${botStatus.profit_analysis.current_profit >= 0 ? 'profit' : 'loss'}`}>
                        ${botStatus.profit_analysis.current_profit?.toFixed(2)}
                      </span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Peak Profit:</span>
                      <span className="info-value profit">${botStatus.profit_analysis.peak_profit?.toFixed(2)}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Time in Profit:</span>
                      <span className="info-value">{Math.floor(botStatus.profit_analysis.time_in_profit)}s</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Data Points:</span>
                      <span className="info-value">{botStatus.profit_analysis.samples}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Cooldown Status */}
          {botStatus.cooldown_remaining && botStatus.cooldown_remaining > 0 && (
            <div className="bot-section cooldown-active">
              <h4>💤 Cooldown Period</h4>
              <div className="cooldown-timer">
                {Math.floor(botStatus.cooldown_remaining / 60)}m {botStatus.cooldown_remaining % 60}s remaining
              </div>
            </div>
          )}

          {/* Statistics */}
          <div className="bot-section">
            <h4>📈 Performance Statistics</h4>
            <div className="bot-info-grid">
              <div className="info-item">
                <span className="info-label">Total Trades:</span>
                <span className="info-value">{botStatus.statistics?.trades_executed || 0}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Wins:</span>
                <span className="info-value profit">{botStatus.statistics?.wins || 0}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Losses:</span>
                <span className="info-value loss">{botStatus.statistics?.losses || 0}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Total P/L:</span>
                <span className={`info-value ${(botStatus.statistics?.total_profit || 0) >= 0 ? 'profit' : 'loss'}`}>
                  ${botStatus.statistics?.total_profit?.toFixed(2) || '0.00'}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Win Rate:</span>
                <span className="info-value">
                  {botStatus.statistics?.trades_executed > 0
                    ? `${((botStatus.statistics.wins / botStatus.statistics.trades_executed) * 100).toFixed(1)}%`
                    : 'N/A'}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Last Trade:</span>
                <span className="info-value">
                  {botStatus.statistics?.last_trade_at
                    ? new Date(botStatus.statistics.last_trade_at).toLocaleTimeString()
                    : 'None'}
                </span>
              </div>
            </div>
          </div>

          {/* Strategy Info */}
          <div className="bot-section strategy-info">
            <h4>🎯 Strategy Details</h4>
            <ul className="strategy-list">
              <li>✅ Trades NAS100 exclusively</li>
              <li>⏰ Active: 09:25 - 10:00 (35-minute window)</li>
              <li>🛑 Stop-loss at 20% loss ($20)</li>
              <li>💰 Smart exit: 1-3 min profit observation</li>
              <li>📉 Exits on 2% decline from peak profit</li>
              <li>💤 32-minute cooldown between trades</li>
              <li>🔄 Monitors every 5 seconds</li>
            </ul>
          </div>
        </>
      )}

      {!botStatus && !isLoading && (
        <div className="bot-section">
          <p className="info-text">
            No bot active for this account. Click "Start Bot" to begin automated NAS100 trading.
          </p>
        </div>
      )}
    </div>
  );
}
