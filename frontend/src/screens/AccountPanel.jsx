import React, { useState, useEffect } from 'react';
import { X, User, Settings, Lock, CreditCard } from 'lucide-react';

export default function AccountPanel({ user, onClose, onLogout }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');

  useEffect(() => {
    // Trigger animation on mount
    setIsOpen(true);
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    // Wait for animation to complete before calling onClose
    setTimeout(onClose, 300);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={handleClose}
      />

      {/* Slide-in panel from left */}
      <div
        className={`fixed top-0 left-0 h-screen w-80 bg-gray-950 border-r border-gray-900 z-50 flex flex-col transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="border-b border-gray-900 p-4 flex justify-between items-center flex-shrink-0">
          <h2 className="text-xl font-bold text-white">Account</h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition"
          >
            <X size={24} className="text-gray-300" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-900 flex-shrink-0">
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex-1 py-3 text-sm font-medium transition flex items-center justify-center gap-2 ${
              activeTab === 'profile'
                ? 'text-blue-400 border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <User size={16} />
            Profile
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 py-3 text-sm font-medium transition flex items-center justify-center gap-2 ${
              activeTab === 'settings'
                ? 'text-blue-400 border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <Settings size={16} />
            Settings
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`flex-1 py-3 text-sm font-medium transition flex items-center justify-center gap-2 ${
              activeTab === 'security'
                ? 'text-blue-400 border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <Lock size={16} />
            Security
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <div className="space-y-4">
              <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                    <User size={32} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{user?.name || 'User'}</h3>
                    <p className="text-sm text-gray-400">{user?.email}</p>
                    {user?.provider && (
                      <p className="text-xs text-blue-400 mt-1">via {user.provider}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Email</p>
                  <p className="text-sm text-white">{user?.email}</p>
                </div>

                <div className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Member Since</p>
                  <p className="text-sm text-white">
                    {new Date().toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </p>
                </div>

                <div className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Account Status</p>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <p className="text-sm text-green-400">Active</p>
                  </div>
                </div>
              </div>

              <button
                onClick={handleClose}
                className="w-full mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold transition text-sm"
              >
                Edit Profile
              </button>
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-sm">Theme</h4>
                    <span className="text-xs text-gray-400">Dark</span>
                  </div>
                  <p className="text-xs text-gray-500">Switch between light and dark themes</p>
                </div>

                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-sm">Notifications</h4>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" defaultChecked />
                      <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                  <p className="text-xs text-gray-500">Enable or disable notifications</p>
                </div>

                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-sm">Price Alerts</h4>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" defaultChecked />
                      <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                  <p className="text-xs text-gray-500">Get alerts when prices reach targets</p>
                </div>

                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-sm">Email Digests</h4>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" />
                      <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                  <p className="text-xs text-gray-500">Weekly market summaries</p>
                </div>
              </div>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      <Lock size={16} className="text-green-400" />
                      Password
                    </h4>
                    <span className="text-xs text-green-400">Secure</span>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">Last changed 30 days ago</p>
                  <button className="w-full px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm font-medium transition">
                    Change Password
                  </button>
                </div>

                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-sm">Two-Factor Auth</h4>
                    <span className="text-xs text-yellow-400">Disabled</span>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">Add an extra layer of security</p>
                  <button className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition">
                    Enable 2FA
                  </button>
                </div>

                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-sm">Active Sessions</h4>
                    <span className="text-xs text-gray-400">1 session</span>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">Manage your login sessions</p>
                  <button className="w-full px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm font-medium transition">
                    View Sessions
                  </button>
                </div>

                <div className="p-4 bg-red-900/20 rounded-lg border border-red-800/30">
                  <h4 className="font-semibold text-sm text-red-400 mb-2">Logout All Devices</h4>
                  <p className="text-xs text-gray-400 mb-3">Sign out from all devices except this one</p>
                  <button className="w-full px-3 py-2 bg-red-900/40 hover:bg-red-900/60 rounded text-sm font-medium text-red-400 transition">
                    Logout All
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-900 p-4 flex gap-2 flex-shrink-0">
          <button
            onClick={handleClose}
            className="flex-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg font-semibold transition text-sm"
          >
            Close
          </button>
          <button
            onClick={() => {
              handleClose();
              setTimeout(onLogout, 300);
            }}
            className="flex-1 px-3 py-2 bg-red-900/40 hover:bg-red-900/60 rounded-lg font-semibold text-red-400 transition text-sm"
          >
            Logout
          </button>
        </div>
      </div>
    </>
  );
}
