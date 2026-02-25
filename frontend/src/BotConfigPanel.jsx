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
  const fetchBotStatus = async () => {
    if (!selectedAccount?.accountId) return;
    
    try {
      setIsLoading(true);
      const response = await axios.post(`${API_BASE_URL}/api/trading/bot/status`, {
        accountId: selectedAccount.accountId
      });
      
      if (response.data.success) {
        setBotStatus(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching bot status:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Start bot with current configuration
  const handleStartBot = async () => {
    if (!selectedAccount?.accountId || !currentUser) {
      setError('Missing account or user information');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const customConfig = {
        TRADING_WINDOW: { START: startTime, END: endTime },
        ACTIVE_DAYS: activeDays,
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

      const response = await axios.post(`${API_BASE_URL}/api/trading/bot/start`, {
        accountId: selectedAccount.accountId,
        username: currentUser.credentials?.username,
        password: currentUser.credentials?.password,
        customConfig
      });

      if (response.data.success) {
        setBotStatus(response.data.data);
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

  // Toggle day selection
  const toggleDay = (dayIndex) => {
    if (activeDays.includes(dayIndex)) {
      setActiveDays(activeDays.filter(d => d !== dayIndex));
    } else {
      setActiveDays([...activeDays, dayIndex].sort((a, b) => a - b));
    }
  };

  // Render state badge
  const renderStateBadge = () => {
    if (!botStatus) return null;

    const stateColors = {
      'idle': 'gray',
      'waiting_for_window': 'orange',
      'monitoring_entry': 'blue',
      'in_position': 'green',
      'cooldown': 'purple',
      'stopped': 'red'
    };

    const stateLabels = {
      'idle': 'Idle',
      'waiting_for_window': '⏰ Waiting for Window',
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
                className={`day-button ${activeDays.includes(idx) ? 'active' : ''}`}
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
            <button
              onClick={handleStopBot}
              disabled={isLoading}
              className="btn btn-stop"
            >
              <Square size={16} />
              {isLoading ? 'Stopping...' : 'Stop Bot'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
