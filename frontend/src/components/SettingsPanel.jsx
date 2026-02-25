/**
 * Settings Panel - User account and bot configuration
 */

import { useState } from 'react';
import { LogOut, Settings, Zap } from 'lucide-react';
import BotConfigPanel from '../BotConfigPanel';
import './SettingsPanel.css';

export default function SettingsPanel({ user, selectedAccount, onClose, onLogout }) {
  const [showBotConfig, setShowBotConfig] = useState(false);

  if (showBotConfig) {
    return (
      <BotConfigPanel 
        selectedAccount={selectedAccount}
        currentUser={user}
        onClose={() => setShowBotConfig(false)}
      />
    );
  }

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        
        <div className="settings-header">
          <div className="flex items-center gap-2">
            <Settings size={20} className="text-cyan-400" />
            <h3>Settings</h3>
          </div>
          <button onClick={onClose} className="close-btn">✕</button>
        </div>

        {/* Account Information */}
        <div className="settings-section">
          <h4>👤 Account Information</h4>
          
          <div className="account-info-card">
            <div className="info-row">
              <span className="info-label">User</span>
              <span className="info-value">{user?.name || 'Unknown'}</span>
            </div>
            
            <div className="info-row">
              <span className="info-label">Email</span>
              <span className="info-value">{user?.email || '—'}</span>
            </div>

            <div className="info-row">
              <span className="info-label">Trading Account</span>
              <span className="info-value font-mono">{selectedAccount?.accountId || 'None selected'}</span>
            </div>

            {selectedAccount && (
              <div className="info-row">
                <span className="info-label">Account Type</span>
                <span className="info-value">{selectedAccount?.code || 'Demo'}</span>
              </div>
            )}
          </div>
        </div>

        {/* Bot Configuration */}
        <div className="settings-section">
          <h4>🤖 Trading Bot</h4>
          
          <button 
            onClick={() => setShowBotConfig(true)}
            className="bot-config-btn"
          >
            <Zap size={16} />
            <div className="btn-text">
              <span className="btn-title">Configure Bot</span>
              <span className="btn-desc">Set trading hours, days & parameters</span>
            </div>
            <span className="arrow">→</span>
          </button>
        </div>

        {/* Logout */}
        <div className="settings-actions">
          <button 
            onClick={() => {
              onClose();
              onLogout();
            }}
            className="logout-btn"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
