import React, { useState, useEffect } from 'react';
import { X, Bell, TrendingUp, AlertCircle, Info } from 'lucide-react';

const NOTIFICATIONS_STORAGE_KEY = 'notifications_v1';

function getDefaultNotifications() {
  return [
    { id: 1, type: 'price_alert', title: 'AAPL Alert', message: 'AAPL crossed $180', time: 'now', read: false },
    { id: 2, type: 'price_alert', title: 'TSLA Alert', message: 'TSLA dropped 5%', time: '5m ago', read: false },
    { id: 3, type: 'order', title: 'Order Filled', message: 'Buy order for 10 AAPL @ $179.50', time: '10m ago', read: true },
    { id: 4, type: 'info', title: 'Market Open', message: 'US markets are now open', time: '30m ago', read: true },
  ];
}

function loadNotifications() {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    if (!raw) return getDefaultNotifications();
    return JSON.parse(raw);
  } catch {
    return getDefaultNotifications();
  }
}

function pickValue(source, keys) {
  if (!source || typeof source !== 'object') return null;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function normalizeEventType(rawType) {
  const type = String(rawType || '').toLowerCase();
  if (type.includes('order') || type.includes('fill') || type.includes('cancel')) return 'order';
  if (type.includes('price') || type.includes('quote')) return 'price_alert';
  return 'info';
}

function formatEventTime(raw) {
  if (!raw) return 'now';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(raw);
  return date.toLocaleString();
}

function mapEventsToNotifications(accountEvents = []) {
  return accountEvents.map((row, idx) => {
    const eventType = pickValue(row, ['type', 'eventType', 'reason']) || 'Account Event';
    const message = pickValue(row, ['message', 'description', 'details', 'text']) || 'No additional details.';
    const eventTime = pickValue(row, ['time', 'timestamp', 'eventTime', 'createdAt']);
    const eventId = pickValue(row, ['id', 'eventId', 'code']) || `${eventType}-${eventTime || idx}`;

    return {
      id: String(eventId),
      type: normalizeEventType(eventType),
      title: String(eventType),
      message: String(message),
      time: formatEventTime(eventTime),
      sortTime: eventTime ? new Date(eventTime).getTime() : 0,
      read: false,
    };
  }).sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0));
}

export default function NotificationsScreen({ onClose, accountEvents = [], onUnreadCountChange }) {
  const [notifications, setNotifications] = useState(() => loadNotifications());
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Trigger animation on mount
    setIsOpen(true);
  }, []);

  useEffect(() => {
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications));
  }, [notifications]);

  useEffect(() => {
    const mapped = mapEventsToNotifications(accountEvents);
    setNotifications((prev) => {
      const readById = new Map(prev.map((item) => [String(item.id), !!item.read]));
      return mapped.map((item) => ({
        ...item,
        read: readById.get(String(item.id)) ?? false,
      }));
    });
  }, [accountEvents]);

  const handleClose = () => {
    setIsOpen(false);
    // Wait for animation to complete before calling onClose
    setTimeout(onClose, 300);
  };

  const markAsRead = (id) => {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
  };

  const deleteNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const clearAll = () => {
    setNotifications([]);
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (typeof onUnreadCountChange === 'function') {
      onUnreadCountChange(unreadCount);
    }
  }, [unreadCount, onUnreadCountChange]);

  const getIcon = (type) => {
    switch (type) {
      case 'price_alert':
        return <TrendingUp size={16} className="text-orange-400" />;
      case 'order':
        return <AlertCircle size={16} className="text-blue-400" />;
      case 'info':
        return <Info size={16} className="text-gray-400" />;
      default:
        return <Bell size={16} className="text-gray-400" />;
    }
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

      {/* Slide-in panel from right */}
      <div
        className={`fixed top-0 right-0 h-screen w-80 bg-gray-950 border-l border-gray-900 z-50 flex flex-col transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="border-b border-gray-900 p-4 flex justify-between items-center flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-white">Notifications</h2>
            {unreadCount > 0 && (
              <p className="text-xs text-gray-400">{unreadCount} unread</p>
            )}
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition"
          >
            <X size={24} className="text-gray-300" />
          </button>
        </div>

        {/* Notifications list */}
        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Bell size={48} className="mb-3 opacity-50" />
              <p className="text-sm">No notifications</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-900">
              {notifications.map(notif => (
                <div
                  key={notif.id}
                  onClick={() => markAsRead(notif.id)}
                  className={`p-4 cursor-pointer hover:bg-gray-900/50 transition flex gap-3 ${
                    !notif.read ? 'bg-gray-900/30' : ''
                  }`}
                >
                  <div className="flex-shrink-0 mt-1">
                    {getIcon(notif.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <h4 className={`font-semibold text-sm ${notif.read ? 'text-gray-300' : 'text-white'}`}>
                        {notif.title}
                      </h4>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteNotification(notif.id);
                        }}
                        className="text-gray-500 hover:text-red-400 transition"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <p className={`text-xs mt-1 ${notif.read ? 'text-gray-500' : 'text-gray-400'}`}>
                      {notif.message}
                    </p>
                    <p className="text-xs text-gray-600 mt-2">
                      {notif.time}
                    </p>
                  </div>
                  {!notif.read && (
                    <div className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-2" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer actions */}
        {notifications.length > 0 && (
          <div className="border-t border-gray-900 p-3 flex gap-2 justify-end flex-shrink-0">
            <button
              onClick={markAllAsRead}
              className="text-xs px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded transition text-gray-300"
            >
              Mark all as read
            </button>
            <button
              onClick={clearAll}
              className="text-xs px-3 py-2 bg-red-900/20 hover:bg-red-900/40 rounded transition text-red-400"
            >
              Clear all
            </button>
          </div>
        )}
      </div>
    </>
  );
}
