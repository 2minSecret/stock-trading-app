import React, { useState } from 'react';
import { liquidAuth } from '../services/liquidChartsClient';

const LIQUID_DOMAIN_STORAGE_KEY = 'liquid_api_domain_v1';
const DEFAULT_LIQUID_DOMAIN = 'default';

function loadSavedDomain() {
  try {
    const saved = localStorage.getItem(LIQUID_DOMAIN_STORAGE_KEY);
    return (saved && saved.trim()) || DEFAULT_LIQUID_DOMAIN;
  } catch {
    return DEFAULT_LIQUID_DOMAIN;
  }
}

export default function LoginScreen({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [domain, setDomain] = useState(() => loadSavedDomain());
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDomainChange = (value) => {
    setDomain(value);
    try {
      localStorage.setItem(LIQUID_DOMAIN_STORAGE_KEY, value || DEFAULT_LIQUID_DOMAIN);
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

    try {
      await liquidAuth.basicLogin(email, domain || DEFAULT_LIQUID_DOMAIN, password);
    } catch (err) {
      setError('Liquid API login failed. Check username/domain/password.');
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
