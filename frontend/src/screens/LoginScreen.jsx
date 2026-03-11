import React, { useState } from 'react';
import { getLiquidApiBase, liquidAuth, setLiquidApiBase } from '../services/liquidChartsClient';

const LIQUID_DOMAIN_STORAGE_KEY = 'liquid_api_domain_v1';
const DEFAULT_LIQUID_DOMAIN = '';
const envServiceBase = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const DEFAULT_API_URL_PLACEHOLDER =
  import.meta.env.VITE_LIQUID_API_URL
  || (envServiceBase ? `${envServiceBase}/api/trading` : 'https://stock-trading-backend.onrender.com/api/trading');

function isLikelyAndroidPhoneRuntime() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const isCapacitor = !!window.Capacitor;
  if (!isCapacitor) return false;
  const ua = String(navigator.userAgent || '').toLowerCase();
  const looksLikeEmulator = ua.includes('emulator') || ua.includes('sdk_gphone') || ua.includes('google_sdk') || ua.includes('android sdk built for x86');
  return !looksLikeEmulator;
}

function isDeviceUnsafeApiBase(url) {
  const value = String(url || '');
  return /:\/\/(10\.0\.2\.2|localhost|127\.0\.0\.1)(?::|\/|$)/i.test(value);
}

function formatErrorDetail(detail) {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return '';
  }
}

function loadSavedDomain() {
  try {
    const saved = localStorage.getItem(LIQUID_DOMAIN_STORAGE_KEY);
    const normalized = (saved && saved.trim()) || DEFAULT_LIQUID_DOMAIN;
    return normalized.toLowerCase() === 'default' ? DEFAULT_LIQUID_DOMAIN : normalized;
  } catch {
    return DEFAULT_LIQUID_DOMAIN;
  }
}

export default function LoginScreen({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [domain, setDomain] = useState(() => loadSavedDomain());
  // Always use Render backend URL unless already set
  const RENDER_API_URL = 'https://stock-trading-backend-u6lk.onrender.com/api/trading';
  const [apiBaseUrl, setApiBaseUrl] = useState(() => {
    const current = getLiquidApiBase();
    return current && current !== '' ? current : RENDER_API_URL;
  });
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDomainChange = (value) => {
    const normalized = (value || '').trim();
    setDomain(normalized.toLowerCase() === 'default' ? DEFAULT_LIQUID_DOMAIN : normalized);
    try {
      localStorage.setItem(LIQUID_DOMAIN_STORAGE_KEY, normalized);
    } catch {
      // Ignore localStorage errors in restricted environments
    }
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!email || !password) {
      setError('Email and password are required');
      setLoading(false);
      return;
    }

    if (!email.includes('@')) {
      setError('Invalid email format');
      setLoading(false);
      return;
    }

    if (!domain) {
      handleDomainChange(DEFAULT_LIQUID_DOMAIN);
    }

    if (!apiBaseUrl?.trim()) {
      setError('Backend API URL is required');
      setLoading(false);
      return;
    }

    if (isLikelyAndroidPhoneRuntime() && isDeviceUnsafeApiBase(apiBaseUrl.trim())) {
      setError('Use your PC LAN IP in Backend API URL on a real Android device (example: http://192.168.1.100:8001/api/trading).');
      setLoading(false);
      return;
    }

    setLiquidApiBase(apiBaseUrl.trim());

    try {
      await liquidAuth.basicLogin(email.trim(), domain || DEFAULT_LIQUID_DOMAIN, password);
    } catch (err) {
      const responseStatus = err?.response?.status;
      const responseDetail = formatErrorDetail(err?.response?.data?.detail);
      if (!responseStatus) {
        const currentBase = getLiquidApiBase();
        const isEmulatorAlias = String(currentBase).includes('10.0.2.2');
        const extraHint = isEmulatorAlias
          ? `On a real Android device, use the deployed backend URL (e.g. ${DEFAULT_API_URL_PLACEHOLDER}) or your PC LAN IP. 10.0.2.2 works only in emulator.`
          : 'Check that the Backend API URL points to the deployed server or that your phone and backend PC are on the same Wi-Fi network.';
        const devHint = import.meta.env.DEV
          ? ' Backend start command: python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload.'
          : '';
        setError(`Cannot connect to server at ${currentBase}. ${extraHint}${devHint}`.trim());
      } else if (responseStatus === 404) {
        setError(`Backend API URL is reachable but route is missing (404): ${apiBaseUrl.trim()}. Use a server that exposes /api/trading/auth/basic/login (for local: http://10.100.102.10:8001/api/trading).`);
      } else {
        const suffix = responseDetail ? ` (${responseDetail})` : '';
        setError(`Liquid API login failed. Check email/password or domain.${suffix}`);
      }
      setLoading(false);
      return;
    }

    // For demo, accept any valid email/password combo
    const userData = { 
      email, 
      name: email.split('@')[0],
      credentials: {
        username: email,
        password: password
      }
    };
    localStorage.setItem('user', JSON.stringify(userData));
    onLoginSuccess(userData);
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-black text-white">
      {/* Header */}
      <div className="pt-16 px-6 text-center">
        <h1 className="text-4xl font-bold mb-2">Stock Trader</h1>
        <p className="text-gray-400">Trade with confidence</p>
      </div>

      {/* Form Container */}
      <div className="flex-1 flex items-center justify-center px-6 pb-10">
        <div className="w-full max-w-md">
          {/* Login Form */}
          <div className="bg-gray-900/50 rounded-2xl p-6 border border-gray-800 backdrop-blur-sm">
            <h2 className="text-2xl font-bold mb-6 text-center">Login</h2>

            {error && (
              <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">
                {error}
              </div>
            )}
            {/* Email Login Form */}
            <form onSubmit={handleEmailLogin} className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              {/* Hide Backend API URL input, always use Render backend */}
              <div style={{ display: 'none' }}>
                <input type="text" value={apiBaseUrl} readOnly />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <p className="text-xs text-gray-500">Liquid API login is enabled by default.</p>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 rounded-lg font-semibold transition"
              >
                {loading ? 'Logging in...' : 'Login'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
