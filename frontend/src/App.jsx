import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Home, Bell, Settings, PieChart, LogOut, BarChart3 } from 'lucide-react';
import { MarketFeedProvider } from './hooks/MarketFeedProvider';
import LiveChart from './components/LiveChart';
import MarketsPanel from './components/MarketsPanel';
import PortfolioBar from './components/PortfolioBar';
import PortfolioDetailsScreen from './screens/PortfolioDetailsScreen';
import MarketsDetailsScreen from './screens/MarketsDetailsScreen';
import ChartsViewScreen from './screens/ChartsViewScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import LoginScreen from './screens/LoginScreen';
import SettingsPanel from './components/SettingsPanel';
import { liquidAccount, liquidAuth, liquidTrading, liquidMarketData } from './services/liquidChartsClient';
import { useMarketFeed } from './hooks/MarketFeedProvider';

const DEFAULT_TRADE_ACCOUNTS = [
  { code: 'DEMO-ACCOUNT', label: 'Demo Account', mode: 'demo' },
  { code: 'LIVE-ACCOUNT', label: 'Live Account', mode: 'live' },
];

function loadTradeAccounts() {
  try {
    const raw = localStorage.getItem('trade_accounts_v1');
    if (!raw) return DEFAULT_TRADE_ACCOUNTS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_TRADE_ACCOUNTS;
    return parsed;
  } catch {
    return DEFAULT_TRADE_ACCOUNTS;
  }
}

function isPlaceholderAccountCode(code) {
  return code === 'DEMO-ACCOUNT' || code === 'LIVE-ACCOUNT';
}

function normalizeCurrencyCode(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const lettersOnly = raw.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (lettersOnly.length >= 3) return lettersOnly.slice(0, 3);
  return raw.toUpperCase();
}

function pickNumber(source, keys) {
  if (!source || typeof source !== 'object') return null;
  for (const key of keys) {
    const raw = source[key];
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isNaN(value) && Number.isFinite(value)) return value;
  }
  return null;
}

function pickValue(source, keys) {
  if (!source || typeof source !== 'object') return null;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function toArray(data, preferredKeys = []) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];

  for (const key of preferredKeys) {
    if (Array.isArray(data[key])) return data[key];
  }

  for (const value of Object.values(data)) {
    if (Array.isArray(value)) return value;
  }

  return [];
}

function formatEventTime(raw) {
  if (!raw) return '—';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(raw);
  return date.toLocaleString();
}

function getEventId(row, idx = 0) {
  const direct = pickValue(row, ['id', 'eventId', 'code']);
  if (direct !== null && direct !== undefined && direct !== '') return String(direct);
  const eventType = pickValue(row, ['type', 'eventType', 'reason']) || 'event';
  const eventTime = pickValue(row, ['time', 'timestamp', 'eventTime', 'createdAt']) || idx;
  return `${eventType}-${eventTime}`;
}

function extractFirstRecord(payload, preferredKeys = []) {
  if (Array.isArray(payload)) return payload[0] || null;
  if (!payload || typeof payload !== 'object') return null;

  for (const key of preferredKeys) {
    if (Array.isArray(payload[key])) return payload[key][0] || null;
  }

  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) return value[0] || null;
  }

  return payload;
}

function App() {
  const { connectionStatus } = useMarketFeed();

  // Authentication state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  // Navigation state: home, portfolio, markets, charts
  const [currentScreen, setCurrentScreen] = useState('home');
  // Trading view selector - affects all sections
  const [tradingView, setTradingView] = useState('NAS100');
  // Selected ticker for chart on home screen
  const [selectedTicker, setSelectedTicker] = useState('NAS100');
  // Timeframe for chart data
  const [timeframe, setTimeframe] = useState('1h');
  // Notifications modal state
  const [showNotifications, setShowNotifications] = useState(false);
  // Settings panel state
  const [showSettings, setShowSettings] = useState(false);
  // Live account metrics
  const [accountMetrics, setAccountMetrics] = useState(null);
  // Live metrics status
  const [metricsError, setMetricsError] = useState(null);
  // Trading account selection and safety controls
  const [tradeAccounts] = useState(() => loadTradeAccounts());
  const [selectedAccountCode, setSelectedAccountCode] = useState(() => {
    const accounts = loadTradeAccounts();
    const demoAccount = accounts.find((a) => a.mode === 'demo');
    return demoAccount?.code || accounts[0]?.code || '';
  });
  const [liveTradingEnabled, setLiveTradingEnabled] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [orderStatus, setOrderStatus] = useState('');
  const [orderError, setOrderError] = useState('');
  // Users & Accounts panels (portfolio/open orders/history/events)
  const [portfolioRows, setPortfolioRows] = useState([]);
  const [openOrdersRows, setOpenOrdersRows] = useState([]);
  const [orderHistoryRows, setOrderHistoryRows] = useState([]);
  const [eventRows, setEventRows] = useState([]);
  const [accountDataLoading, setAccountDataLoading] = useState(false);
  const [accountDataError, setAccountDataError] = useState('');
  const [unreadEventCount, setUnreadEventCount] = useState(0);
  const [marketQuote, setMarketQuote] = useState(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [displayCurrency] = useState('USD');
  const [conversionRate, setConversionRate] = useState(1);
  const [conversionError, setConversionError] = useState('');

  useEffect(() => {
    if (tradingView === '^IXIC') {
      setTradingView('NAS100');
      setSelectedTicker('NAS100');
    }
    if (selectedTicker === '^IXIC') {
      setSelectedTicker('NAS100');
    }
  }, [tradingView, selectedTicker]);

  // Check for existing user session on mount
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        setCurrentUser(user);
        setIsLoggedIn(true);
        setSessionReady(!!localStorage.getItem('liquid_session_token'));
      } catch (e) {
        localStorage.removeItem('user');
      }
    }
  }, []);

  const handleLoginSuccess = (userData) => {
    setCurrentUser(userData);
    setIsLoggedIn(true);
    setSessionExpired(false);
    setSessionReady(!!localStorage.getItem('liquid_session_token'));
    setAccountDataError('');
  };

  const handleLogout = async () => {
    try {
      if (localStorage.getItem('liquid_session_token')) {
        await liquidAuth.basicLogout();
      }
      if (localStorage.getItem('liquid_token')) {
        await liquidAuth.logout();
      }
    } catch (_) {
      // Ignore logout API errors and always clear local session
    } finally {
      localStorage.removeItem('user');
      localStorage.removeItem('liquid_token');
      localStorage.removeItem('liquid_session_token');
      setCurrentUser(null);
      setIsLoggedIn(false);
      setSessionExpired(false);
      setSessionReady(false);
      setAccountMetrics(null);
      setAccountDataError('');
      setCurrentScreen('home');
    }
  };

  useEffect(() => {
    if (!isLoggedIn) return;

    let mounted = true;

    const pingSession = async () => {
      const sessionToken = localStorage.getItem('liquid_session_token');
      if (!sessionToken) {
        if (mounted) setSessionReady(false);
        return;
      }

      try {
        const pingResponse = await liquidAuth.basicPing();
        const renewedToken = pingResponse?.sessionToken || pingResponse?.token || pingResponse?.accessToken;
        if (renewedToken && mounted) {
          localStorage.setItem('liquid_session_token', renewedToken);
        }
        if (mounted) {
          setSessionReady(true);
          setSessionExpired(false);
        }
      } catch (error) {
        const status = error?.response?.status;
        if (status === 401 || status === 403) {
          localStorage.removeItem('liquid_session_token');
          if (mounted) {
            setSessionExpired(true);
            setSessionReady(false);
            setAccountDataError('Session expired. Please sign in again to load account data.');
          }
          return;
        }
        if (mounted) {
          console.warn('Basic session ping failed:', error?.message || error);
          setSessionReady(false);
        }
      }
    };

    pingSession();
    const keepAliveTimer = setInterval(pingSession, 60 * 1000);

    return () => {
      mounted = false;
      clearInterval(keepAliveTimer);
    };
  }, [isLoggedIn]);

  const refreshAccountViews = useCallback(async () => {
    const sessionToken = localStorage.getItem('liquid_session_token');
    if (!isLoggedIn || !selectedAccountCode || !sessionToken || !sessionReady) {
      setPortfolioRows([]);
      setOpenOrdersRows([]);
      setOrderHistoryRows([]);
      setEventRows([]);
      if (!sessionExpired) setAccountDataError('');
      setAccountDataLoading(false);
      return;
    }

    if (isPlaceholderAccountCode(selectedAccountCode)) {
      setPortfolioRows([]);
      setOpenOrdersRows([]);
      setOrderHistoryRows([]);
      setEventRows([]);
      setAccountDataError('Select a real Liquid account code to load account data.');
      setAccountDataLoading(false);
      return;
    }

    setAccountDataLoading(true);

    const [portfolioRes, openOrdersRes, historyRes, eventsRes] = await Promise.allSettled([
      liquidAccount.getPortfolio({ accountCode: selectedAccountCode }),
      liquidAccount.getOpenOrders({ accountCode: selectedAccountCode }),
      liquidAccount.listOrdersHistory({
        accountCode: selectedAccountCode,
        filters: {
          period: 'week',
          page: 1,
          'page-size': 10,
        },
      }),
      liquidAccount.getEvents({
        accountCode: selectedAccountCode,
        filters: {
          period: 'today',
          limit: 10,
        },
      }),
    ]);

    if (portfolioRes.status === 'fulfilled') {
      setPortfolioRows(toArray(portfolioRes.value, ['portfolio', 'positions', 'items', 'data']));
    } else {
      setPortfolioRows([]);
    }

    if (openOrdersRes.status === 'fulfilled') {
      setOpenOrdersRows(toArray(openOrdersRes.value, ['orders', 'items', 'data']));
    } else {
      setOpenOrdersRows([]);
    }

    if (historyRes.status === 'fulfilled') {
      setOrderHistoryRows(toArray(historyRes.value, ['orders', 'items', 'data']));
    } else {
      setOrderHistoryRows([]);
    }

    if (eventsRes.status === 'fulfilled') {
      setEventRows(toArray(eventsRes.value, ['events', 'items', 'data']));
    } else {
      setEventRows([]);
    }

    const hasFailure = [portfolioRes, openOrdersRes, historyRes, eventsRes].some((res) => res.status === 'rejected');
    const hasUnauthorized = [portfolioRes, openOrdersRes, historyRes, eventsRes].some(
      (res) => res.status === 'rejected' && (res.reason?.response?.status === 401 || res.reason?.response?.status === 403)
    );

    if (hasUnauthorized) {
      localStorage.removeItem('liquid_session_token');
      setSessionExpired(true);
      setAccountDataError('Session expired. Please sign in again to continue.');
    } else {
      setAccountDataError(hasFailure ? 'Some account sections could not be loaded.' : '');
    }
    setAccountDataLoading(false);
  }, [isLoggedIn, selectedAccountCode, sessionExpired, sessionReady]);

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      if (!mounted) return;
      await refreshAccountViews();
    };

    refresh();
    const timer = setInterval(refresh, 8000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [refreshAccountViews]);

  useEffect(() => {
    const hasSession = !!localStorage.getItem('liquid_session_token');
    if (!isLoggedIn || !selectedTicker || !hasSession || !sessionReady) {
      setMarketQuote(null);
      return;
    }

    let mounted = true;
    let haltPolling = false;

    const fetchQuote = async () => {
      if (haltPolling) return;

      try {
        const response = await liquidMarketData.getMarketData(selectedTicker);
        const first = extractFirstRecord(response, ['marketData', 'quotes', 'items', 'data']);
        if (mounted) {
          setMarketQuote(first);
          if (accountDataError === 'Market data unavailable for selected instrument.') {
            setAccountDataError('');
          }
        }
      } catch (error) {
        const status = error?.response?.status;
        if (status === 401 || status === 403) {
          localStorage.removeItem('liquid_session_token');
          if (mounted) {
            setSessionExpired(true);
            setAccountDataError('Session expired. Please sign in again to continue.');
          }
        } else if (status === 400) {
          haltPolling = true;
          if (mounted) {
            setAccountDataError('Market data unavailable for selected instrument.');
          }
        }
        if (mounted) {
          setMarketQuote(null);
        }
      }
    };

    fetchQuote();
    const timer = setInterval(fetchQuote, 5000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [isLoggedIn, selectedTicker, sessionReady]);

  const quotePrice = pickNumber(marketQuote, ['price', 'last', 'lastPrice', 'markPrice', 'close']);
  const quoteDelta = pickNumber(marketQuote, ['change', 'delta', 'priceChange']);
  const quoteDeltaPct = pickNumber(marketQuote, ['changePercent', 'changePct', 'percentChange']);

  const metricsCurrency = normalizeCurrencyCode(
    pickValue(accountMetrics, ['currency', 'accountCurrency', 'baseCurrency'])
  );

  useEffect(() => {
    if (!isLoggedIn || !accountMetrics || !sessionReady) {
      setConversionRate(1);
      setConversionError('');
      return;
    }

    const sessionToken = localStorage.getItem('liquid_session_token');
    if (!sessionToken) {
      setConversionRate(1);
      return;
    }

    if (!metricsCurrency || metricsCurrency === displayCurrency) {
      setConversionRate(1);
      setConversionError('');
      return;
    }

    let mounted = true;

    const fetchRate = async () => {
      try {
        const response = await liquidAccount.getConversionRates({
          fromCurrency: metricsCurrency,
          toCurrency: displayCurrency,
        });

        const rows = Array.isArray(response)
          ? response
          : Array.isArray(response?.rates)
            ? response.rates
            : [];

        const match = rows.find((row) => {
          const from = normalizeCurrencyCode(row?.fromCurrency);
          const to = normalizeCurrencyCode(row?.toCurrency);
          return from === metricsCurrency && to === displayCurrency;
        }) || rows[0];

        const parsed = Number(match?.convRate ?? match?.rate ?? match?.value);
        if (mounted) {
          setConversionRate(Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
          setConversionError('');
        }
      } catch {
        if (mounted) {
          setConversionRate(1);
          setConversionError('Conversion rate unavailable. Showing native currency.');
        }
      }
    };

    fetchRate();

    return () => {
      mounted = false;
    };
  }, [isLoggedIn, accountMetrics, metricsCurrency, displayCurrency, sessionReady]);

  useEffect(() => {
    const eventIds = eventRows.map((row, idx) => getEventId(row, idx));
    if (eventIds.length === 0) {
      setUnreadEventCount(0);
      return;
    }

    let stored = [];
    try {
      const raw = localStorage.getItem('notifications_v1');
      stored = raw ? JSON.parse(raw) : [];
    } catch {
      stored = [];
    }

    const readById = new Map(
      Array.isArray(stored)
        ? stored.map((item) => [String(item?.id), !!item?.read])
        : []
    );

    const unread = eventIds.reduce((count, id) => count + (readById.get(String(id)) ? 0 : 1), 0);
    setUnreadEventCount(unread);
  }, [eventRows]);

  useEffect(() => {
    if (!isLoggedIn) return;

    let mounted = true;

    const fetchMetrics = async () => {
      const sessionToken = localStorage.getItem('liquid_session_token');
      if (!sessionToken) {
        if (mounted) {
          setAccountMetrics(null);
          setMetricsError(null);
        }
        return;
      }

      try {
        const response = await liquidAccount.getMetrics({ includePositions: false });
        const normalized = Array.isArray(response)
          ? response
          : Array.isArray(response?.metrics)
            ? response.metrics
            : [response];

        if (mounted) {
          setAccountMetrics(normalized.find(Boolean) || null);
          setMetricsError(null);
        }
      } catch (error) {
        if (mounted) {
          setAccountMetrics(null);
          setMetricsError(error?.message || 'Failed to fetch metrics');
        }
      }
    };

    fetchMetrics();
    const timer = setInterval(fetchMetrics, 5000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [isLoggedIn]);

  const liveEquity = pickNumber(accountMetrics, [
    'equity',
    'totalEquity',
    'accountEquity',
    'netLiquidation',
    'balance',
    'totalValue',
  ]);
  const livePnl = pickNumber(accountMetrics, [
    'pnl',
    'PnL',
    'profitLoss',
    'unrealizedPnl',
    'totalPnl',
  ]);
  const livePnlPct = pickNumber(accountMetrics, [
    'pnlPercent',
    'pnlPct',
    'profitLossPercent',
    'returnPct',
  ]);
  const accountBalance = pickNumber(accountMetrics, [
    'balance',
    'accountBalance',
    'cashBalance',
    'availableBalance',
  ]);
  const convertedLiveEquity = liveEquity !== null ? liveEquity * conversionRate : null;
  const convertedLivePnl = livePnl !== null ? livePnl * conversionRate : null;
  const convertedAccountBalance = accountBalance !== null ? accountBalance * conversionRate : null;
  const hasLiquidSessionToken = !!localStorage.getItem('liquid_session_token');
  const metricsStatus = metricsError
    ? 'Error'
    : hasLiquidSessionToken && accountMetrics
      ? 'Connected'
      : 'Waiting';
  const metricsStatusClass = metricsStatus === 'Connected'
    ? 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10'
    : metricsStatus === 'Error'
      ? 'text-red-400 border-red-500/40 bg-red-500/10'
      : 'text-amber-400 border-amber-500/40 bg-amber-500/10';
  const feedStatusLabel = connectionStatus === 'connected'
    ? 'Connected'
    : connectionStatus === 'reconnecting'
      ? 'Reconnecting'
      : 'Offline';
  const feedStatusClass = connectionStatus === 'connected'
    ? 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10'
    : connectionStatus === 'reconnecting'
      ? 'text-amber-400 border-amber-500/40 bg-amber-500/10'
      : 'text-red-400 border-red-500/40 bg-red-500/10';
  const selectedTradeAccount = tradeAccounts.find((a) => a.code === selectedAccountCode) || null;
  const isLiveAccountSelected = selectedTradeAccount?.mode === 'live';
  const isSelectedAccountPlaceholder = isPlaceholderAccountCode(selectedAccountCode);
  const isLiveBlocked = isLiveAccountSelected && !liveTradingEnabled;
  // Allow placeholder demo accounts for testing, but not placeholder live accounts
  const isPlaceholderLiveAccount = isSelectedAccountPlaceholder && isLiveAccountSelected;
  const isOrderDisabled = isPlacingOrder || !selectedTradeAccount || isLiveBlocked || isPlaceholderLiveAccount;

  const handlePlaceOrder = async (side) => {
    setOrderStatus('');
    setOrderError('');

    if (!selectedTradeAccount) {
      setOrderError('Select an account before placing an order.');
      return;
    }

    // Allow demo placeholder accounts, but require real accounts for live trading
    if (isSelectedAccountPlaceholder && isLiveAccountSelected) {
      setOrderError('Live trading requires a real Liquid account code. Select a real account before placing an order.');
      return;
    }

    if (isLiveAccountSelected && !liveTradingEnabled) {
      setOrderError('Live account is blocked. Enable live trading explicitly to continue.');
      return;
    }

    const quantityInput = window.prompt('Order quantity:', '1');
    if (quantityInput === null) return;
    const quantity = Number(quantityInput);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setOrderError('Quantity must be a positive number.');
      return;
    }

    const priceInput = window.prompt('Limit price (leave empty for market order):', '');
    if (priceInput === null) return;
    const trimmedPrice = priceInput.trim();
    const hasLimitPrice = trimmedPrice.length > 0;
    const limitPrice = hasLimitPrice ? Number(trimmedPrice) : undefined;
    if (hasLimitPrice && (!Number.isFinite(limitPrice) || limitPrice <= 0)) {
      setOrderError('Limit price must be a positive number.');
      return;
    }

    setIsPlacingOrder(true);
    try {
      await liquidTrading.placeAccountOrder({
        accountCode: selectedTradeAccount.code,
        order: {
          symbol: selectedTicker,
          side: side.toUpperCase(),
          type: hasLimitPrice ? 'LIMIT' : 'MARKET',
          quantity,
          ...(hasLimitPrice ? { price: limitPrice } : {}),
          timeInForce: 'GTC',
        },
      });
      setOrderStatus(`${side.toUpperCase()} order submitted to ${selectedTradeAccount.label} (${selectedTradeAccount.code}).`);
      refreshAccountViews();
    } catch (error) {
      const detail = error?.response?.data?.detail;
      setOrderError(typeof detail === 'string' ? detail : 'Order submission failed.');
    } finally {
      setIsPlacingOrder(false);
    }
  };

  const handleModifyOrder = async () => {
    setOrderStatus('');
    setOrderError('');

    if (!selectedTradeAccount) {
      setOrderError('Select an account before modifying an order.');
      return;
    }

    // Allow demo placeholder accounts, but require real accounts for live trading
    if (isSelectedAccountPlaceholder && isLiveAccountSelected) {
      setOrderError('Live trading requires a real Liquid account code. Select a real account before modifying an order.');
      return;
    }

    if (isLiveAccountSelected && !liveTradingEnabled) {
      setOrderError('Live account is blocked. Enable live trading explicitly to continue.');
      return;
    }

    const orderCode = window.prompt('Order code to modify:', '');
    if (orderCode === null || !orderCode.trim()) {
      setOrderError('orderCode is required for modification.');
      return;
    }

    const ifMatch = window.prompt('If-Match value (ETag/version required):', '');
    if (ifMatch === null || !ifMatch.trim()) {
      setOrderError('If-Match is required for modify requests.');
      return;
    }

    const sideInput = window.prompt('Side (BUY/SELL):', 'BUY');
    if (sideInput === null) return;
    const side = sideInput.trim().toUpperCase() === 'SELL' ? 'SELL' : 'BUY';

    const quantityInput = window.prompt('New quantity:', '1');
    if (quantityInput === null) return;
    const quantity = Number(quantityInput);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setOrderError('Quantity must be a positive number.');
      return;
    }

    const limitPriceInput = window.prompt('New limit price:', '');
    if (limitPriceInput === null) return;
    const limitPrice = Number(limitPriceInput);
    if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
      setOrderError('Limit price must be a positive number for LIMIT modify requests.');
      return;
    }

    setIsPlacingOrder(true);
    try {
      await liquidTrading.modifyAccountOrder({
        accountCode: selectedTradeAccount.code,
        ifMatch: ifMatch.trim(),
        order: {
          orderCode: orderCode.trim(),
          instrument: selectedTicker,
          quantity: String(quantity),
          positionEffect: 'OPEN',
          side,
          type: 'LIMIT',
          limitPrice: String(limitPrice),
          tif: 'GTC',
        },
      });
      setOrderStatus(`Order ${orderCode.trim()} modified on ${selectedTradeAccount.label} (${selectedTradeAccount.code}).`);
      refreshAccountViews();
    } catch (error) {
      const detail = error?.response?.data?.detail;
      setOrderError(typeof detail === 'string' ? detail : 'Order modification failed.');
    } finally {
      setIsPlacingOrder(false);
    }
  };

  const handleCancelOrder = async () => {
    setOrderStatus('');
    setOrderError('');

    if (!selectedTradeAccount) {
      setOrderError('Select an account before cancelling an order.');
      return;
    }

    // Allow demo placeholder accounts, but require real accounts for live trading
    if (isSelectedAccountPlaceholder && isLiveAccountSelected) {
      setOrderError('Live trading requires a real Liquid account code. Select a real account before cancelling an order.');
      return;
    }

    if (isLiveAccountSelected && !liveTradingEnabled) {
      setOrderError('Live account is blocked. Enable live trading explicitly to continue.');
      return;
    }

    const cancelMode = window.prompt('Cancel mode: type "single" or "group"', 'single');
    if (cancelMode === null) return;
    const mode = cancelMode.trim().toLowerCase();

    const ifMatch = window.prompt('If-Match value (required):', '');
    if (ifMatch === null || !ifMatch.trim()) {
      setOrderError('If-Match is required for cancel requests.');
      return;
    }

    setIsPlacingOrder(true);
    try {
      if (mode === 'group') {
        const orderCodesInput = window.prompt('Group order codes (comma-separated, parent first):', '');
        if (orderCodesInput === null || !orderCodesInput.trim()) {
          setOrderError('order-codes are required for group cancellation.');
          setIsPlacingOrder(false);
          return;
        }
        const contingencyType = window.prompt('Contingency type (e.g., IF-THEN, OCO):', 'IF-THEN');
        if (contingencyType === null || !contingencyType.trim()) {
          setOrderError('contingency-type is required for group cancellation.');
          setIsPlacingOrder(false);
          return;
        }

        await liquidTrading.cancelAccountOrderGroup({
          accountCode: selectedTradeAccount.code,
          orderCodes: orderCodesInput.trim(),
          contingencyType: contingencyType.trim(),
          ifMatch: ifMatch.trim(),
        });
        setOrderStatus(`Order group cancelled on ${selectedTradeAccount.label} (${selectedTradeAccount.code}).`);
        refreshAccountViews();
      } else {
        const orderCode = window.prompt('Order code to cancel:', '');
        if (orderCode === null || !orderCode.trim()) {
          setOrderError('orderCode is required for single cancellation.');
          setIsPlacingOrder(false);
          return;
        }

        await liquidTrading.cancelAccountOrder({
          accountCode: selectedTradeAccount.code,
          orderCode: orderCode.trim(),
          ifMatch: ifMatch.trim(),
        });
        setOrderStatus(`Order ${orderCode.trim()} cancelled on ${selectedTradeAccount.label} (${selectedTradeAccount.code}).`);
        refreshAccountViews();
      }
    } catch (error) {
      const detail = error?.response?.data?.detail;
      setOrderError(typeof detail === 'string' ? detail : 'Order cancellation failed.');
    } finally {
      setIsPlacingOrder(false);
    }
  };

  // Show login screen if not logged in
  if (!isLoggedIn) {
    return (
      <LoginScreen onLoginSuccess={handleLoginSuccess} />
    );
  }

  return (
    // The main wrapper strictly enforces a mobile-app dimension on PCs
    <div className="flex flex-col h-screen bg-gray-950 text-white font-sans overflow-hidden max-w-md mx-auto shadow-2xl relative">
       
       {/* Top Header */}
       <header className="flex justify-between items-center px-5 py-4 pt-6 border-b border-gray-800/50 bg-gradient-to-b from-gray-900 to-gray-950">
         <button
           onClick={() => setShowSettings(true)}
           className="w-10 h-10 bg-gray-800/60 hover:bg-gray-700 rounded-lg flex items-center justify-center transition duration-200 border border-gray-700/50"
           title="Settings"
         >
           <Settings size={18} className="text-cyan-400" />
         </button>
         <div className="text-center">
            <p className="text-xs text-gray-500 font-medium tracking-wider uppercase">Welcome back</p>
            <h1 className="text-sm font-semibold text-white mt-0.5">{currentUser?.name || 'Trader'}</h1>
          <span className={`inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded border ${feedStatusClass}`}>
            Feed: {feedStatusLabel}
          </span>
         </div>
         <div className="flex items-center gap-1.5">
           <button
             onClick={() => setShowNotifications(true)}
             className="relative p-2 bg-gray-800/60 hover:bg-gray-700 rounded-lg transition duration-200 border border-gray-700/50"
           >
             <Bell size={18} className="text-gray-400" />
             {unreadEventCount > 0 && (
               <>
                 <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-cyan-500 rounded-full"></span>
                 <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-cyan-500 text-gray-950 text-[10px] font-bold leading-4 text-center">
                   {unreadEventCount > 99 ? '99+' : unreadEventCount}
                 </span>
               </>
             )}
           </button>
           <button
             onClick={handleLogout}
             className="p-2 bg-gray-800/60 hover:bg-gray-700 rounded-lg transition duration-200 border border-gray-700/50 text-red-500 hover:text-red-400"
             title="Logout"
           >
             <LogOut size={18} />
           </button>
         </div>
       </header>

       {/* Main Dashboard Area */}
       <main className="flex-1 px-5 overflow-y-auto pb-24 space-y-6 flex flex-col">
         {currentScreen === 'home' && (
           <>
             {/* Portfolio Balance */}
             <section className="mt-3 flex justify-between items-start gap-4">
               <div className="flex-1">
                 <div className="flex items-center gap-2 mb-2">
                   <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Account Balance</p>
                   <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${metricsStatusClass}`}>
                     {metricsStatus}
                   </span>
                 </div>
                 <h2 className="text-3xl font-bold tracking-tight text-white">
                   {convertedAccountBalance !== null ? `$${convertedAccountBalance.toFixed(2)} ${displayCurrency}` : '$—'}
                 </h2>
                 <p className={`text-xs font-medium mt-1 ${convertedLivePnl !== null && convertedLivePnl < 0 ? 'text-red-400' : 'text-cyan-500'}`}>
                   {convertedLivePnl !== null
                     ? `${convertedLivePnl >= 0 ? '↑' : '↓'} $${Math.abs(convertedLivePnl).toFixed(2)} ${displayCurrency}${livePnlPct !== null ? ` (${livePnlPct.toFixed(2)}%)` : ''}`
                     : 'Waiting for live metrics'}
                 </p>
                 {metricsCurrency && metricsCurrency !== displayCurrency && (
                   <p className="text-[10px] text-gray-500 mt-1">
                     Converted from {metricsCurrency} at {conversionRate.toFixed(6)}
                   </p>
                 )}
                 {conversionError && (
                   <p className="text-[10px] text-amber-400 mt-1">{conversionError}</p>
                 )}
               </div>
               {/* Trading Views Selector Combobox */}
               <div className="flex flex-col items-end">
                 <label className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-2">Instrument:</label>
                 <select
                   value={tradingView}
                   onChange={(e) => {
                     setTradingView(e.target.value);
                     setSelectedTicker(e.target.value);
                   }}
                   className="bg-gray-800/40 border border-gray-700/50 text-white text-xs rounded-lg px-3 py-2 cursor-pointer hover:border-cyan-500/50 focus:border-cyan-500 focus:outline-none transition duration-200 font-medium"
                 >
                   <option value="NAS100">NAS100 - Nasdaq 100</option>
                   <option value="AAPL">AAPL - Apple</option>
                   <option value="TSLA">TSLA - Tesla</option>
                   <option value="MSFT">MSFT - Microsoft</option>
                   <option value="GOOGL">GOOGL - Google</option>
                   <option value="AMZN">AMZN - Amazon</option>
                   <option value="NVDA">NVDA - NVIDIA</option>
                   <option value="META">META - Meta</option>
                   <option value="NFLX">NFLX - Netflix</option>
                 </select>
               </div>
             </section>

             {/* Active Asset Card */}
             <section className="bg-gradient-to-br from-gray-900 to-gray-950 rounded-2xl p-5 border border-gray-800/50 flex flex-col gap-4 shadow-xl">
                <div className="flex justify-between items-start pb-3 border-b border-gray-800/30">
                  <div>
                    <h3 className="text-lg font-bold text-white">{selectedTicker}</h3>
                    <p className="text-xs text-gray-500 font-medium mt-1">Live Market Price</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-white">{quotePrice !== null ? `$${quotePrice.toFixed(2)}` : '—'}</p>
                    <p className={`text-xs font-semibold mt-1 ${quoteDelta !== null && quoteDelta < 0 ? 'text-red-400' : 'text-cyan-400'}`}>
                      {quoteDelta !== null
                        ? `${quoteDelta >= 0 ? '+' : ''}${quoteDelta.toFixed(2)}${quoteDeltaPct !== null ? ` (${quoteDeltaPct.toFixed(2)}%)` : ''}`
                        : '—'}
                    </p>
                  </div>
                </div>

                {/* Timeframe Selector */}
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {['1m', '5m', '15m', '1h', '1d', '1w'].map(tf => (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition duration-200 ${
                        timeframe === tf
                          ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/50'
                          : 'bg-gray-800/40 text-gray-400 border border-gray-700/30 hover:border-gray-600/50'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>

                {/* Live chart */}
                <LiveChart ticker={selectedTicker} timeframe={timeframe} height={160} sessionReady={sessionReady} />

                {/* Account Selector + Safety Guard */}
                <div className="rounded-xl border border-gray-800/40 bg-gray-900/40 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Execution Account</p>
                      <p className="text-xs text-gray-400 mt-1">Choose where orders are submitted.</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${isLiveAccountSelected ? 'text-red-400 border-red-500/40 bg-red-500/10' : 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10'}`}>
                      {isLiveAccountSelected ? 'LIVE' : 'DEMO'}
                    </span>
                  </div>

                  <select
                    value={selectedAccountCode}
                    onChange={(e) => setSelectedAccountCode(e.target.value)}
                    className="w-full bg-gray-800/40 border border-gray-700/50 text-white text-xs rounded-lg px-3 py-2 cursor-pointer hover:border-cyan-500/50 focus:border-cyan-500 focus:outline-none transition duration-200 font-medium"
                  >
                    {tradeAccounts.map((account) => (
                      <option key={account.code} value={account.code}>
                        {account.label} ({account.code})
                      </option>
                    ))}
                  </select>

                  <label className="flex items-center gap-2 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={liveTradingEnabled}
                      onChange={(e) => setLiveTradingEnabled(e.target.checked)}
                      className="accent-red-500"
                    />
                    Enable LIVE trading (off by default)
                  </label>

                  {isLiveBlocked && (
                    <p className="text-xs text-amber-400">Live account selected, but safety lock is active. Turn on “Enable LIVE trading” to allow order submission.</p>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 mt-3">
                  <button
                    onClick={() => handlePlaceOrder('sell')}
                    disabled={isOrderDisabled}
                    className={`flex-1 py-3 rounded-xl font-semibold transition duration-200 text-sm border ${
                      isOrderDisabled
                        ? 'bg-red-900/10 text-red-300/40 border-red-900/20 cursor-not-allowed'
                        : 'bg-red-900/20 hover:bg-red-900/30 text-red-400 hover:text-red-300 border-red-900/30 hover:border-red-800/50'
                    }`}
                  >
                    {isPlacingOrder ? 'Submitting...' : 'Sell'}
                  </button>
                  <button
                    onClick={() => handlePlaceOrder('buy')}
                    disabled={isOrderDisabled}
                    className={`flex-1 py-3 rounded-xl font-semibold transition duration-200 text-sm border shadow-lg shadow-cyan-900/10 ${
                      isOrderDisabled
                        ? 'bg-cyan-900/10 text-cyan-300/40 border-cyan-900/20 cursor-not-allowed'
                        : 'bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 hover:text-cyan-300 border-cyan-500/30 hover:border-cyan-400/50'
                    }`}
                  >
                    {isPlacingOrder ? 'Submitting...' : 'Buy'}
                  </button>
                </div>
                <button
                  onClick={handleModifyOrder}
                  disabled={isOrderDisabled}
                  className={`w-full mt-2 py-2.5 rounded-xl font-semibold transition duration-200 text-sm border ${
                    isOrderDisabled
                      ? 'bg-gray-800/30 text-gray-500 border-gray-700/30 cursor-not-allowed'
                      : 'bg-gray-800/60 hover:bg-gray-700/70 text-gray-200 border-gray-700/50 hover:border-gray-600/70'
                  }`}
                >
                  {isPlacingOrder ? 'Submitting...' : 'Modify Order'}
                </button>
                <button
                  onClick={handleCancelOrder}
                  disabled={isOrderDisabled}
                  className={`w-full mt-2 py-2.5 rounded-xl font-semibold transition duration-200 text-sm border ${
                    isOrderDisabled
                      ? 'bg-red-900/10 text-red-300/40 border-red-900/20 cursor-not-allowed'
                      : 'bg-red-900/20 hover:bg-red-900/30 text-red-300 border-red-800/40 hover:border-red-700/60'
                  }`}
                >
                  {isPlacingOrder ? 'Submitting...' : 'Cancel Order'}
                </button>
                {orderStatus && <p className="text-xs text-cyan-400 mt-1">{orderStatus}</p>}
                {orderError && <p className="text-xs text-red-400 mt-1">{orderError}</p>}
             </section>

             {/* Markets + Portfolio sections */}
             <div className="grid grid-cols-1 gap-4">
               <MarketsPanel />
               <PortfolioBar accountMetrics={accountMetrics} />
             </div>

             {accountDataError && (
               <div className="text-xs text-amber-400 border border-amber-500/20 bg-amber-500/5 rounded-xl px-3 py-2">
                 {accountDataError}
               </div>
             )}

             {/* Portfolio panel from API */}
             <section className="bg-gradient-to-br from-gray-900 to-gray-950 rounded-2xl p-4 border border-gray-800/50">
               <div className="flex items-center justify-between mb-3">
                 <h4 className="text-sm font-semibold text-white">Portfolio Panel</h4>
                 <span className="text-[10px] uppercase tracking-wider text-gray-500">
                   {accountDataLoading ? 'Loading...' : `${portfolioRows.length} rows`}
                 </span>
               </div>
               {portfolioRows.length === 0 ? (
                 <p className="text-xs text-gray-500">No portfolio data for selected account.</p>
               ) : (
                 <div className="space-y-2 max-h-48 overflow-y-auto">
                   {portfolioRows.slice(0, 8).map((row, idx) => {
                     const instrument = pickValue(row, ['instrument', 'symbol', 'ticker', 'code']) || '—';
                     const quantity = pickValue(row, ['quantity', 'qty', 'positionQty', 'size']) || '—';
                     const marketValue = pickValue(row, ['marketValue', 'value', 'positionValue', 'notional']) || '—';
                     return (
                       <div key={`${instrument}-${idx}`} className="flex items-center justify-between text-xs bg-gray-800/40 border border-gray-700/30 rounded-lg px-3 py-2">
                         <span className="text-gray-200 font-medium">{instrument}</span>
                         <span className="text-gray-400">Qty: {quantity}</span>
                         <span className="text-cyan-400">{typeof marketValue === 'number' ? `$${marketValue.toFixed(2)}` : marketValue}</span>
                       </div>
                     );
                   })}
                 </div>
               )}
             </section>

             {/* Open orders table */}
             <section className="bg-gradient-to-br from-gray-900 to-gray-950 rounded-2xl p-4 border border-gray-800/50">
               <h4 className="text-sm font-semibold text-white mb-3">Open Orders Table</h4>
               {openOrdersRows.length === 0 ? (
                 <p className="text-xs text-gray-500">No open orders.</p>
               ) : (
                 <div className="space-y-2 max-h-56 overflow-y-auto">
                   {openOrdersRows.slice(0, 10).map((row, idx) => {
                     const orderCode = pickValue(row, ['orderCode', 'code', 'orderId', 'id']) || '—';
                     const instrument = pickValue(row, ['instrument', 'symbol', 'ticker']) || '—';
                     const side = pickValue(row, ['side', 'orderSide']) || '—';
                     const quantity = pickValue(row, ['quantity', 'qty', 'size']) || '—';
                     const status = pickValue(row, ['status', 'state']) || '—';
                     return (
                       <div key={`${orderCode}-${idx}`} className="grid grid-cols-5 gap-2 text-[11px] bg-gray-800/40 border border-gray-700/30 rounded-lg px-3 py-2">
                         <span className="text-gray-300 truncate" title={String(orderCode)}>{orderCode}</span>
                         <span className="text-gray-200 truncate">{instrument}</span>
                         <span className={`${String(side).toUpperCase() === 'BUY' ? 'text-cyan-400' : 'text-red-400'} truncate`}>{side}</span>
                         <span className="text-gray-400 truncate">{quantity}</span>
                         <span className="text-gray-500 truncate">{status}</span>
                       </div>
                     );
                   })}
                 </div>
               )}
             </section>

             {/* Order history table */}
             <section className="bg-gradient-to-br from-gray-900 to-gray-950 rounded-2xl p-4 border border-gray-800/50">
               <h4 className="text-sm font-semibold text-white mb-3">Order History</h4>
               {orderHistoryRows.length === 0 ? (
                 <p className="text-xs text-gray-500">No order history in selected period.</p>
               ) : (
                 <div className="space-y-2 max-h-56 overflow-y-auto">
                   {orderHistoryRows.slice(0, 10).map((row, idx) => {
                     const orderCode = pickValue(row, ['orderCode', 'code', 'orderId', 'id']) || '—';
                     const instrument = pickValue(row, ['instrument', 'symbol', 'ticker']) || '—';
                     const side = pickValue(row, ['side', 'orderSide']) || '—';
                     const status = pickValue(row, ['status', 'state']) || '—';
                     const issuedAt = pickValue(row, ['issuedAt', 'issued', 'timestamp', 'time']) || '—';
                     return (
                       <div key={`${orderCode}-${idx}`} className="grid grid-cols-5 gap-2 text-[11px] bg-gray-800/40 border border-gray-700/30 rounded-lg px-3 py-2">
                         <span className="text-gray-300 truncate" title={String(orderCode)}>{orderCode}</span>
                         <span className="text-gray-200 truncate">{instrument}</span>
                         <span className={`${String(side).toUpperCase() === 'BUY' ? 'text-cyan-400' : 'text-red-400'} truncate`}>{side}</span>
                         <span className="text-gray-500 truncate">{status}</span>
                         <span className="text-gray-400 truncate" title={String(issuedAt)}>{issuedAt}</span>
                       </div>
                     );
                   })}
                 </div>
               )}
             </section>

             {/* Events feed */}
             <section className="bg-gradient-to-br from-gray-900 to-gray-950 rounded-2xl p-4 border border-gray-800/50">
               <h4 className="text-sm font-semibold text-white mb-3">Events Feed</h4>
               {eventRows.length === 0 ? (
                 <p className="text-xs text-gray-500">No account events for selected period.</p>
               ) : (
                 <div className="space-y-2 max-h-56 overflow-y-auto">
                   {eventRows.slice(0, 10).map((row, idx) => {
                     const eventType = pickValue(row, ['type', 'eventType', 'reason']) || 'event';
                     const message = pickValue(row, ['message', 'description', 'details', 'text']) || 'No details';
                     const eventTime = pickValue(row, ['time', 'timestamp', 'eventTime', 'createdAt']);
                     return (
                       <div key={`${eventType}-${idx}`} className="bg-gray-800/40 border border-gray-700/30 rounded-lg px-3 py-2">
                         <div className="flex items-center justify-between gap-2">
                           <p className="text-xs font-semibold text-cyan-400 uppercase tracking-wide">{String(eventType)}</p>
                           <p className="text-[10px] text-gray-500">{formatEventTime(eventTime)}</p>
                         </div>
                         <p className="text-xs text-gray-300 mt-1">{String(message)}</p>
                       </div>
                     );
                   })}
                 </div>
               )}
             </section>
           </>
         )}

         {currentScreen === 'portfolio' && <PortfolioDetailsScreen />}
         {currentScreen === 'markets' && <MarketsDetailsScreen />}
        {currentScreen === 'charts' && (
          <ChartsViewScreen
            tradingView={tradingView}
            setTradingView={setTradingView}
            sessionReady={sessionReady}
          />
        )}
       </main>

       {/* Settings Panel */}
       {showSettings && (
         <SettingsPanel
           user={currentUser}
           selectedAccount={
             tradeAccounts.find(acc => acc.code === selectedAccountCode)
               ? { accountId: selectedAccountCode, ...tradeAccounts.find(acc => acc.code === selectedAccountCode) }
               : null
           }
           onClose={() => setShowSettings(false)}
           onLogout={handleLogout}
         />
       )}

       {/* Notifications Modal */}
       {showNotifications && (
         <NotificationsScreen
           onClose={() => setShowNotifications(false)}
           accountEvents={eventRows}
           onUnreadCountChange={setUnreadEventCount}
         />
       )}

       {/* Bottom Navigation Bar */}
       <nav className="absolute bottom-0 w-full bg-gradient-to-t from-gray-950 to-gray-950/80 backdrop-blur-md border-t border-gray-800/50 px-6 py-3 flex justify-between items-center pb-5">
         <button
           onClick={() => setCurrentScreen('home')}
           className={`flex flex-col items-center gap-1.5 transition duration-200 ${currentScreen === 'home' ? 'text-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}
         >
           <Home size={20} />
           <span className="text-[9px] font-semibold uppercase tracking-wider">Home</span>
         </button>
         <button
           onClick={() => setCurrentScreen('portfolio')}
           className={`flex flex-col items-center gap-1.5 transition duration-200 ${currentScreen === 'portfolio' ? 'text-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}
         >
           <PieChart size={20} />
           <span className="text-[9px] font-semibold uppercase tracking-wider">Portfolio</span>
         </button>
         <button
           onClick={() => setCurrentScreen('markets')}
           className={`flex flex-col items-center gap-1.5 transition duration-200 ${currentScreen === 'markets' ? 'text-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}
         >
           <TrendingUp size={20} />
           <span className="text-[9px] font-semibold uppercase tracking-wider">Markets</span>
         </button>
         <button
           onClick={() => setCurrentScreen('charts')}
           className={`flex flex-col items-center gap-1.5 transition duration-200 ${currentScreen === 'charts' ? 'text-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}
         >
           <BarChart3 size={20} />
           <span className="text-[9px] font-semibold uppercase tracking-wider">Charts</span>
         </button>
       </nav>
    </div>
  );
}

function WrappedApp() {
  return (
    <MarketFeedProvider>
      <App />
    </MarketFeedProvider>
  );
}

export default WrappedApp;