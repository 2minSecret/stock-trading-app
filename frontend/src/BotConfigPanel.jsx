/**
 * Bot Configuration Panel - Settings for automated trading bot
 * 
 * Features:
 * - Configure trading hours (start/end time)
 * - Select active days of week
 * - View bot status and controls
 */

import { useState, useEffect } from 'react';
import axios from 'axios';
import './BotConfigPanel.css';
import { Play, Square, Clock, Calendar, AlertCircle } from 'lucide-react';

const frontendHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `http://${frontendHost}:8001`;
const BOT_CUSTOM_CONFIG_STORAGE_KEY = 'bot_custom_config_v1';

const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');
const withTradingPrefix = (baseUrl, path) => {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedBase.endsWith('/api/trading')) {
    return `${normalizedBase}${normalizedPath}`;
  }
  return `${normalizedBase}/api/trading${normalizedPath}`;
};

const normalizeActiveDays = (days) => {
  if (!Array.isArray(days)) return [1, 2, 3, 4, 5];

  const hasZeroBasedValue = days.some((value) => Number(value) === 0);
  const normalized = days
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value))
    .map((value) => (hasZeroBasedValue ? value + 1 : value))
    .filter((value) => value >= 1 && value <= 7);

  return normalized.length > 0 ? Array.from(new Set(normalized)).sort((a, b) => a - b) : [1, 2, 3, 4, 5];
};

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function BotConfigPanel({ selectedAccount, currentUser, onClose }) {
  const [botStatus, setBotStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Configuration state
  const [startTime, setStartTime] = useState('09:25');
  const [endTime, setEndTime] = useState('10:05');
  const [activeDays, setActiveDays] = useState([1, 2, 3, 4, 5]); // Mon-Fri
  const [purchaseAmount, setPurchaseAmount] = useState(100);
  const [riskPercent, setRiskPercent] = useState(20);
  const [stopLossValue, setStopLossValue] = useState(20);
  const [cooldownMinutes, setCooldownMinutes] = useState(32);
  const [checkIntervalSec, setCheckIntervalSec] = useState(5);
  const [profitPatienceMin, setProfitPatienceMin] = useState(60);
  const [profitPatienceMax, setProfitPatienceMax] = useState(180);
  const [profitDeclineThreshold, setProfitDeclineThreshold] = useState(2);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BOT_CUSTOM_CONFIG_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const windowCfg = saved?.TRADING_WINDOW;

      if (windowCfg?.START) setStartTime(windowCfg.START);
      if (windowCfg?.END) setEndTime(windowCfg.END);
      if (Array.isArray(saved?.ACTIVE_DAYS) && saved.ACTIVE_DAYS.length > 0) {
        setActiveDays(normalizeActiveDays(saved.ACTIVE_DAYS));
      }
      if (typeof saved?.PURCHASE_AMOUNT === 'number') setPurchaseAmount(saved.PURCHASE_AMOUNT);
      if (typeof saved?.RISK_PERCENT === 'number') setRiskPercent(saved.RISK_PERCENT * 100);
      if (typeof saved?.STOP_LOSS_VALUE === 'number') setStopLossValue(saved.STOP_LOSS_VALUE);
      if (typeof saved?.COOLDOWN_MINUTES === 'number') setCooldownMinutes(saved.COOLDOWN_MINUTES);
      if (typeof saved?.CHECK_INTERVAL_SEC === 'number') setCheckIntervalSec(saved.CHECK_INTERVAL_SEC);
      if (typeof saved?.PROFIT_PATIENCE_MIN === 'number') setProfitPatienceMin(saved.PROFIT_PATIENCE_MIN);
      if (typeof saved?.PROFIT_PATIENCE_MAX === 'number') setProfitPatienceMax(saved.PROFIT_PATIENCE_MAX);
      if (typeof saved?.PROFIT_DECLINE_THRESHOLD === 'number') setProfitDeclineThreshold(saved.PROFIT_DECLINE_THRESHOLD * 100);
    } catch (_error) {
      // Ignore malformed local storage values
    }
  }, []);

  const getDirectionLabel = (direction) => {
    const map = {
      up: 'Up',
      down: 'Down',
      flat: 'Flat'
    };
    return map[direction] || 'Unknown';
  };

  const getMovementLabel = (movement) => {
    const map = {
      equal: 'Equal',
      bigger: 'Bigger',
      lower: 'Lower'
    };
    return map[movement] || 'Unknown';
  };

  const getConfidencePercent = (value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '0.0';
    return (value * 100).toFixed(1);
  };

  const getConfidenceClass = (value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return 'confidence-low';
    if (value >= 0.75) return 'confidence-high';
    if (value >= 0.55) return 'confidence-medium';
    return 'confidence-low';
  };
  
  // Fetch bot status on mount or account change
  useEffect(() => {
    if (selectedAccount?.accountId) {
      fetchBotStatus();
    }
  }, [selectedAccount?.accountId]);

  useEffect(() => {
    if (!selectedAccount?.accountId || !botStatus?.is_running) return undefined;

    const timer = setInterval(() => {
      fetchBotStatus();
    }, 5000);

    return () => clearInterval(timer);
  }, [selectedAccount?.accountId, botStatus?.is_running]);

  // Fetch current bot status
  const fetchBotStatus = async (showLoading = true) => {
    if (!selectedAccount?.accountId) return;
    
    try {
      if (showLoading) setIsLoading(true);
      const response = await axios.post(withTradingPrefix(API_BASE_URL, '/bot/status'), {
        accountId: selectedAccount.accountId
      });
      
      if (response.data.success) {
        setBotStatus(response.data.data);
        return response.data.data;
      }
      setBotStatus(null);
      return null;
    } catch (err) {
      console.error('Error fetching bot status:', err);
      return null;
    } finally {
      if (showLoading) setIsLoading(false);
    }
  };

  // Start bot with current configuration
  const handleStartBot = async () => {
    const sessionToken = localStorage.getItem('liquid_session_token') || undefined;
    const hasCredentials = !!(currentUser?.credentials?.username && currentUser?.credentials?.password);
    if (!selectedAccount?.accountId || (!hasCredentials && !sessionToken)) {
      setError('Missing account or authentication (session or credentials)');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const customConfig = {
        TRADING_WINDOW: { START: startTime, END: endTime },
        ACTIVE_DAYS: normalizeActiveDays(activeDays),
        PURCHASE_AMOUNT: parseFloat(purchaseAmount),
        RISK_PERCENT: riskPercent / 100,
        STOP_LOSS_VALUE: parseFloat(stopLossValue),
        COOLDOWN_MINUTES: parseInt(cooldownMinutes),
        CHECK_INTERVAL_SEC: parseInt(checkIntervalSec),
        PROFIT_PATIENCE_MIN: parseInt(profitPatienceMin),
        PROFIT_PATIENCE_MAX: parseInt(profitPatienceMax),
        PROFIT_DECLINE_THRESHOLD: profitDeclineThreshold / 100,
        TIMEZONE: browserTimezone,
      };

      try {
        localStorage.setItem(BOT_CUSTOM_CONFIG_STORAGE_KEY, JSON.stringify(customConfig));
      } catch (_error) {
        // Ignore local storage write errors
      }

      const response = await axios.post(withTradingPrefix(API_BASE_URL, '/bot/start'), {
        accountId: selectedAccount.accountId,
        username: currentUser.credentials?.username,
        password: currentUser.credentials?.password,
        sessionToken,
        customConfig
      });

      if (response.data.success) {
        await fetchBotStatus(false);
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

      const response = await axios.post(withTradingPrefix(API_BASE_URL, '/bot/stop'), {
        accountId: selectedAccount.accountId
      });

      if (response.data.success) {
        await fetchBotStatus(false);
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

  const handleForceStopBot = async () => {
    if (!selectedAccount?.accountId) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await axios.post(withTradingPrefix(API_BASE_URL, '/bot/force-stop'), {
        accountId: selectedAccount.accountId
      });

      if (response.data.success) {
        setBotStatus(null);
        await fetchBotStatus(false);
        setError(null);
      } else {
        setError(response.data.message || 'Failed to force stop bot');
      }
    } catch (err) {
      console.error('Error force-stopping bot:', err);
      setError(err.response?.data?.detail || err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle day selection
  const toggleDay = (dayIndex) => {
    const isoDay = dayIndex + 1;
    if (activeDays.includes(isoDay)) {
      setActiveDays(activeDays.filter(d => d !== isoDay));
    } else {
      setActiveDays([...activeDays, isoDay].sort((a, b) => a - b));
    }
  };

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
      <div className="bot-config-panel">
        <div className="bot-config-header">
          <h3>🤖 Bot Configuration</h3>
          <button onClick={onClose} className="close-btn">✕</button>
        </div>
        <p className="info-text">Select an account to configure bot</p>
      </div>
    );
  }

  return (
    <div className="bot-config-modal-overlay" onClick={onClose}>
      <div className="bot-config-panel" onClick={(e) => e.stopPropagation()}>
        
        <div className="bot-config-header">
          <div>
            <h3>🤖 Bot Configuration</h3>
            <p className="text-xs text-gray-400 mt-1">Account: {selectedAccount.accountId}</p>
          </div>
          <button onClick={onClose} className="close-btn">✕</button>
        </div>

        {/* Bot Status */}
        {botStatus && (
          <div className="bot-status-section">
            <h4>Current Status</h4>
            <div className="status-display">
              {renderStateBadge()}
              {botStatus.current_price && (
                <p className="text-sm">Price: ${botStatus.current_price.toFixed(2)}</p>
              )}
            </div>

            <div className="movement-insight-grid">
              <div className="movement-insight-item">
                <span className="movement-label">Last movement</span>
                <span className="movement-value">
                  {getMovementLabel(botStatus.movement_signal?.movement_vs_last)}
                </span>
              </div>

              <div className="movement-insight-item">
                <span className="movement-label">Predicted direction</span>
                <span className="movement-value">
                  {getDirectionLabel(botStatus.movement_signal?.predicted_direction)}
                </span>
              </div>

              <div className="movement-insight-item">
                <span className="movement-label">Confidence</span>
                <span className={`movement-value ${getConfidenceClass(botStatus.movement_signal?.confidence)}`}>
                  {getConfidencePercent(botStatus.movement_signal?.confidence)}%
                </span>
              </div>
            </div>

            {botStatus.movement_signal?.reason && (
              <p className="movement-reason">{botStatus.movement_signal.reason}</p>
            )}
          </div>
        )}

        {/* Trading Hours Configuration */}
        <div className="config-section">
          <div className="config-title">
            <Clock size={16} />
            <span>Trading Hours</span>
          </div>
          
          <div className="time-input-group">
            <div className="time-input">
              <label>Start Time</label>
              <input 
                type="time" 
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={botStatus?.is_running}
              />
            </div>
            <div className="time-input">
              <label>End Time</label>
              <input 
                type="time" 
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={botStatus?.is_running}
              />
            </div>
          </div>
        </div>

        {/* Days of Week Configuration */}
        <div className="config-section">
          <div className="config-title">
            <Calendar size={16} />
            <span>Active Days</span>
          </div>
          
          <div className="days-grid">
            {DAYS_OF_WEEK.map((day, idx) => (
              <button
                key={idx}
                onClick={() => toggleDay(idx)}
                disabled={botStatus?.is_running}
                className={`day-button ${activeDays.includes(idx + 1) ? 'active' : ''}`}
              >
                {day.slice(0, 3)}
              </button>
            ))}
          </div>
        </div>

        {/* Risk Configuration */}
        <div className="config-section">
          <h4>Risk Parameters</h4>
          
          <div className="input-group">
            <label>Purchase Amount ($)</label>
            <input 
              type="number" 
              value={purchaseAmount}
              onChange={(e) => setPurchaseAmount(e.target.value)}
              disabled={botStatus?.is_running}
              step="10"
              min="10"
              max="1000"
            />
          </div>

          <div className="input-group">
            <label>Risk Tolerance (%)</label>
            <input 
              type="number" 
              value={riskPercent}
              onChange={(e) => setRiskPercent(e.target.value)}
              disabled={botStatus?.is_running}
              step="1"
              min="5"
              max="50"
            />
          </div>

          <div className="input-group">
            <label>Stop Loss Value ($)</label>
            <input 
              type="number" 
              value={stopLossValue}
              onChange={(e) => setStopLossValue(e.target.value)}
              disabled={botStatus?.is_running}
              step="1"
              min="1"
              max="500"
            />
          </div>
        </div>

        {/* Timing Configuration */}
        <div className="config-section">
          <h4>Timing Parameters</h4>
          
          <div className="input-group">
            <label>Cooldown After Exit (minutes)</label>
            <input 
              type="number" 
              value={cooldownMinutes}
              onChange={(e) => setCooldownMinutes(e.target.value)}
              disabled={botStatus?.is_running}
              step="1"
              min="1"
              max="120"
            />
          </div>

          <div className="input-group">
            <label>Check Interval (seconds)</label>
            <input 
              type="number" 
              value={checkIntervalSec}
              onChange={(e) => setCheckIntervalSec(e.target.value)}
              disabled={botStatus?.is_running}
              step="1"
              min="1"
              max="60"
            />
          </div>
        </div>

        {/* Profit Strategy Configuration */}
        <div className="config-section">
          <h4>Profit Exit Strategy</h4>
          
          <div className="input-group">
            <label>Min Patience (seconds)</label>
            <input 
              type="number" 
              value={profitPatienceMin}
              onChange={(e) => setProfitPatienceMin(e.target.value)}
              disabled={botStatus?.is_running}
              step="10"
              min="10"
              max="300"
            />
          </div>

          <div className="input-group">
            <label>Max Patience (seconds)</label>
            <input 
              type="number" 
              value={profitPatienceMax}
              onChange={(e) => setProfitPatienceMax(e.target.value)}
              disabled={botStatus?.is_running}
              step="10"
              min="30"
              max="600"
            />
          </div>

          <div className="input-group">
            <label>Decline Threshold (%)</label>
            <input 
              type="number" 
              value={profitDeclineThreshold}
              onChange={(e) => setProfitDeclineThreshold(e.target.value)}
              disabled={botStatus?.is_running}
              step="0.1"
              min="0.1"
              max="10"
            />
          </div>
        </div>

        {/* Error Messages */}
        {error && (
          <div className="error-message">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* Control Buttons */}
        <div className="config-actions">
          {!botStatus?.is_running ? (
            <button
              onClick={handleStartBot}
              disabled={isLoading}
              className="btn btn-start"
            >
              <Play size={16} />
              {isLoading ? 'Starting...' : 'Start Bot'}
            </button>
          ) : (
            <>
              <button
                onClick={handleStopBot}
                disabled={isLoading}
                className="btn btn-stop"
              >
                <Square size={16} />
                {isLoading ? 'Stopping...' : 'Stop Bot'}
              </button>
              <button
                onClick={handleForceStopBot}
                disabled={isLoading}
                className="btn btn-stop"
              >
                <Square size={16} />
                {isLoading ? 'Force stopping...' : 'Force Stop'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
