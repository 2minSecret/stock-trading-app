import axios from 'axios';

/**
 * Liquid Charts REST API Client
 * Documentation: https://liquid-charts.gitbook.io/liquid-charts-api-docs
 */

const frontendHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const LIQUID_API_BASE = import.meta.env.VITE_LIQUID_API_URL || `http://${frontendHost}:8001/api/trading`;

function normalizeDxscaSymbol(symbol) {
  const map = {
    '^IXIC': 'NAS100',
  };
  return map[symbol] || symbol;
}

function extractSessionToken(payload) {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return null;
  return (
    payload.token
    || payload.accessToken
    || payload.sessionToken
    || payload.sessionID
    || payload.sessionId
    || payload.sid
    || payload.id
    || payload.authToken
    || payload.session?.token
    || payload.session?.id
    || payload.session?.sessionId
    || payload.data?.token
    || payload.data?.accessToken
    || payload.data?.sessionToken
    || payload.data?.sessionID
    || payload.data?.sessionId
    || payload.data?.sid
    || payload.data?.id
    || null
  );
}

function applySessionHeader(token) {
  if (token) {
    liquidClient.defaults.headers.common['X-Liquid-Token'] = token;
  } else {
    delete liquidClient.defaults.headers.common['X-Liquid-Token'];
  }
}

// Create axios instance with base config
const liquidClient = axios.create({
  baseURL: LIQUID_API_BASE,
  headers: {
    'Content-Type': 'application/json',
  }
});

// Add auth interceptor for bearer token
liquidClient.interceptors.request.use((config) => {
  const sessionToken = localStorage.getItem('liquid_session_token');
  if (sessionToken) {
    config.headers['X-Liquid-Token'] = sessionToken;
    delete config.headers['Authorization'];
  } else {
    delete config.headers['X-Liquid-Token'];
    delete config.headers['Authorization'];
  }
  return config;
});

// Initialize default session header from persisted token (if present)
try {
  const persistedSessionToken = localStorage.getItem('liquid_session_token');
  if (persistedSessionToken) {
    applySessionHeader(persistedSessionToken);
  }
} catch {
  // Ignore storage access errors
}

/**
 * Authentication Methods
 */
export const liquidAuth = {
  // Login with credentials
  async login(email, password) {
    try {
      const response = await liquidClient.post('/auth/login', { email, password });
      if (response.data.token) {
        localStorage.setItem('liquid_token', response.data.token);
      }
      return response.data;
    } catch (error) {
      console.error('Liquid auth login error:', error);
      throw error;
    }
  },

  // Logout
  async logout() {
    try {
      await liquidClient.post('/auth/logout');
      localStorage.removeItem('liquid_token');
    } catch (error) {
      console.error('Liquid auth logout error:', error);
    }
  },

  // Check if token exists
  hasToken() {
    return !!localStorage.getItem('liquid_token');
  },

  // Basic Auth login for dxsca-web
  async basicLogin(username, domain, password) {
    try {
      const response = await liquidClient.post('/auth/basic/login', { username, domain, password });
      const token = extractSessionToken(response.data);
      if (token) {
        localStorage.setItem('liquid_session_token', token);
        applySessionHeader(token);
      } else {
        throw new Error('Liquid API login response did not include a session token');
      }
      return response.data;
    } catch (error) {
      console.error('Basic auth login error:', error);
      throw error;
    }
  },

  async basicLogout() {
    try {
      const token = localStorage.getItem('liquid_session_token');
      if (!token) return;
      await liquidClient.post('/auth/basic/logout');
      localStorage.removeItem('liquid_session_token');
      applySessionHeader(null);
    } catch (error) {
      console.error('Basic auth logout error:', error);
      throw error;
    }
  },

  async basicPing() {
    try {
      const token = localStorage.getItem('liquid_session_token');
      if (!token) return null;
      const response = await liquidClient.post('/auth/basic/ping');
      const renewedToken = extractSessionToken(response.data);
      if (renewedToken) {
        localStorage.setItem('liquid_session_token', renewedToken);
        applySessionHeader(renewedToken);
      }
      return response.data;
    } catch (error) {
      const status = error?.response?.status;
      if (status !== 401 && status !== 403) {
        console.error('Basic auth ping error:', error);
      }
      throw error;
    }
  }
};

/**
 * Market Data Methods
 */
export const liquidMarketData = {
  async getDxscaMarketData(requestPayload) {
    try {
      const sessionToken = localStorage.getItem('liquid_session_token');
      if (!sessionToken) {
        const noSessionError = new Error('Liquid API session token is missing');
        noSessionError.code = 'NO_LIQUID_SESSION';
        throw noSessionError;
      }

      const response = await liquidClient.post('/marketdata', {
        request: requestPayload,
      });
      return response.data;
    } catch (error) {
      const status = error?.response?.status;
      const code = error?.code;
      if (code !== 'NO_LIQUID_SESSION' && status !== 400 && status !== 401 && status !== 403) {
        console.error('Error fetching dxsca market data:', error);
      }
      throw error;
    }
  },

  // Get current market data for a symbol
  async getMarketData(symbol, market = 'spot') {
    try {
      const normalizedSymbol = normalizeDxscaSymbol(symbol);
      return await this.getDxscaMarketData({
        symbols: [normalizedSymbol],
        market,
        type: 'quote',
      });
    } catch (error) {
      const status = error?.response?.status;
      if (status !== 400 && status !== 401 && status !== 403) {
        console.error('Error fetching market data:', error);
      }
      throw error;
    }
  },

  // Get historical OHLC data
  async getOHLC(symbol, timeframe = '1h', limit = 100) {
    try {
      const normalizedSymbol = normalizeDxscaSymbol(symbol);
      return await this.getDxscaMarketData({
        symbols: [normalizedSymbol],
        timeframe,
        limit,
        type: 'candles',
      });
    } catch (error) {
      const status = error?.response?.status;
      if (status !== 401 && status !== 403) {
        console.error('Error fetching OHLC:', error);
      }
      throw error;
    }
  }
};

/**
 * Trading Methods
 */
export const liquidTrading = {
  // Place a new order (BUY/SELL)
  async placeOrder(orderData) {
    try {
      const response = await liquidClient.post('/orders', {
        symbol: orderData.symbol,
        side: orderData.side, // 'buy' or 'sell'
        type: orderData.type || 'limit', // 'market', 'limit', 'stop'
        quantity: orderData.quantity,
        price: orderData.price, // For limit orders
        stopPrice: orderData.stopPrice, // For stop orders
        timeInForce: orderData.timeInForce || 'GTC' // 'GTC', 'IOC', 'FOK'
      });
      return response.data;
    } catch (error) {
      console.error('Error placing order:', error);
      throw error;
    }
  },

  // Place account-scoped order (dxsca-web/accounts/{accountCode}/orders)
  async placeAccountOrder({ accountCode, order }) {
    try {
      if (!accountCode) throw new Error('accountCode is required');
      if (!order || typeof order !== 'object') throw new Error('order payload is required');

      const payload = {
        ...order,
        clientOrderId: order.clientOrderId || `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };

      const response = await liquidClient.post('/orders/account/place', {
        account_code: accountCode,
        order: payload,
      });
      return response.data;
    } catch (error) {
      console.error('Error placing account-scoped order:', error);
      throw error;
    }
  },

  // Modify account-scoped order (dxsca-web/accounts/{accountCode}/orders)
  async modifyAccountOrder({ accountCode, order, ifMatch }) {
    try {
      if (!accountCode) throw new Error('accountCode is required');
      if (!order || typeof order !== 'object') throw new Error('order payload is required');
      if (!ifMatch) throw new Error('ifMatch is required');

      const response = await liquidClient.put('/orders/account/modify', {
        account_code: accountCode,
        order,
        if_match: ifMatch,
      });
      return response.data;
    } catch (error) {
      console.error('Error modifying account-scoped order:', error);
      throw error;
    }
  },

  // Cancel account-scoped single order (dxsca-web/accounts/{accountCode}/orders/{orderCode})
  async cancelAccountOrder({ accountCode, orderCode, ifMatch }) {
    try {
      if (!accountCode) throw new Error('accountCode is required');
      if (!orderCode) throw new Error('orderCode is required');
      if (!ifMatch) throw new Error('ifMatch is required');

      const response = await liquidClient.delete('/orders/account/cancel', {
        data: {
          account_code: accountCode,
          order_code: orderCode,
          if_match: ifMatch,
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error cancelling account-scoped order:', error);
      throw error;
    }
  },

  // Cancel account-scoped order group (dxsca-web/accounts/{accountCode}/orders/group)
  async cancelAccountOrderGroup({ accountCode, orderCodes, contingencyType, ifMatch }) {
    try {
      if (!accountCode) throw new Error('accountCode is required');
      if (!orderCodes) throw new Error('orderCodes is required');
      if (!contingencyType) throw new Error('contingencyType is required');
      if (!ifMatch) throw new Error('ifMatch is required');

      const response = await liquidClient.delete('/orders/account/cancel-group', {
        data: {
          account_code: accountCode,
          order_codes: Array.isArray(orderCodes) ? orderCodes.join(',') : orderCodes,
          contingency_type: contingencyType,
          if_match: ifMatch,
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error cancelling account-scoped order group:', error);
      throw error;
    }
  },

  // Modify an existing order
  async modifyOrder(orderId, updates) {
    try {
      const response = await liquidClient.put(`/orders/${orderId}`, updates);
      return response.data;
    } catch (error) {
      console.error('Error modifying order:', error);
      throw error;
    }
  },

  // Cancel an order
  async cancelOrder(orderId) {
    try {
      const response = await liquidClient.delete(`/orders/${orderId}`);
      return response.data;
    } catch (error) {
      console.error('Error cancelling order:', error);
      throw error;
    }
  },

  // Get order status
  async getOrder(orderId) {
    try {
      const response = await liquidClient.get(`/orders/${orderId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching order:', error);
      throw error;
    }
  },

  // Get all active orders
  async getOrders(filters = {}) {
    try {
      const response = await liquidClient.get('/orders', { params: filters });
      return response.data;
    } catch (error) {
      console.error('Error fetching orders:', error);
      throw error;
    }
  },

  // Get order history
  async getOrderHistory(filters = {}) {
    try {
      const response = await liquidClient.get('/orders/history', { params: filters });
      return response.data;
    } catch (error) {
      console.error('Error fetching order history:', error);
      throw error;
    }
  }
};

/**
 * Account Methods
 */
export const liquidAccount = {
  // Get one user or list of users (dxsca-web/users)
  async getUsers({ username, ...filters } = {}) {
    try {
      const path = username ? `/users/${encodeURIComponent(username)}` : '/users';
      const response = await liquidClient.get(path, { params: filters });
      return response.data;
    } catch (error) {
      console.error('Error fetching users:', error);
      throw error;
    }
  },

  // Get account portfolio for one or multiple accounts
  async getPortfolio({ accountCode, accounts } = {}) {
    try {
      const params = {};
      if (accountCode) params.account_code = accountCode;
      if (accounts) params.accounts = Array.isArray(accounts) ? accounts.join(',') : accounts;
      const response = await liquidClient.get('/accounts/portfolio', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching account portfolio:', error);
      throw error;
    }
  },

  // Get open positions for one or multiple accounts
  async getOpenPositions({ accountCode, accounts } = {}) {
    try {
      const params = {};
      if (accountCode) params.account_code = accountCode;
      if (accounts) params.accounts = Array.isArray(accounts) ? accounts.join(',') : accounts;
      const response = await liquidClient.get('/accounts/positions', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching open positions:', error);
      throw error;
    }
  },

  // Get open orders for one or multiple accounts
  async getOpenOrders({ accountCode, accounts } = {}) {
    try {
      const params = {};
      if (accountCode) params.account_code = accountCode;
      if (accounts) params.accounts = Array.isArray(accounts) ? accounts.join(',') : accounts;
      const response = await liquidClient.get('/accounts/open-orders', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching open orders:', error);
      throw error;
    }
  },

  // Get cash transfers for one or multiple accounts with optional filters
  async getCashTransfers({ accountCode, accounts, filters = {} } = {}) {
    try {
      const params = { ...filters };
      if (accountCode) params.account_code = accountCode;
      if (accounts) params.accounts = Array.isArray(accounts) ? accounts.join(',') : accounts;
      const response = await liquidClient.get('/accounts/transfers', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching cash transfers:', error);
      throw error;
    }
  },

  // List order history (GET) for one or multiple accounts
  async listOrdersHistory({ accountCode, accounts, filters = {} } = {}) {
    try {
      const params = { ...filters };
      if (accountCode) params.account_code = accountCode;
      if (accounts) params.accounts = Array.isArray(accounts) ? accounts.join(',') : accounts;
      const response = await liquidClient.get('/accounts/orders/history', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching orders history (GET):', error);
      throw error;
    }
  },

  // List order history (POST) for one or multiple accounts
  async listOrdersHistoryPost({ accountCode, accounts, filters = {} } = {}) {
    try {
      const response = await liquidClient.post('/accounts/orders/history', {
        account_code: accountCode || null,
        accounts: Array.isArray(accounts) ? accounts.join(',') : accounts || null,
        filters,
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching orders history (POST):', error);
      throw error;
    }
  },

  // Get account events for one or multiple accounts
  async getEvents({ accountCode, accounts, filters = {} } = {}) {
    try {
      const params = { ...filters };
      if (accountCode) params.account_code = accountCode;
      if (accounts) params.accounts = Array.isArray(accounts) ? accounts.join(',') : accounts;
      const response = await liquidClient.get('/accounts/events', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching account events:', error);
      throw error;
    }
  },

  // Get account info
  async getAccountInfo() {
    try {
      const response = await liquidClient.get('/account');
      return response.data;
    } catch (error) {
      console.error('Error fetching account info:', error);
      throw error;
    }
  },

  // Get account balance
  async getBalance() {
    try {
      const response = await liquidClient.get('/account/balance');
      return response.data;
    } catch (error) {
      console.error('Error fetching balance:', error);
      throw error;
    }
  },

  // Get positions
  async getPositions() {
    try {
      const response = await liquidClient.get('/account/positions');
      return response.data;
    } catch (error) {
      console.error('Error fetching positions:', error);
      throw error;
    }
  },

  // Get account history/events
  async getAccountEvents(filters = {}) {
    try {
      const response = await liquidClient.get('/account/events', { params: filters });
      return response.data;
    } catch (error) {
      console.error('Error fetching account events:', error);
      throw error;
    }
  },

  // Get live account metrics (equity, PnL, optional position-level metrics)
  async getMetrics({ accountCode, accounts, includePositions = false } = {}) {
    try {
      const params = {
        include_positions: includePositions,
      };

      if (accountCode) params.account_code = accountCode;
      if (accounts) params.accounts = Array.isArray(accounts) ? accounts.join(',') : accounts;

      const response = await liquidClient.get('/account/metrics', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching account metrics:', error);
      throw error;
    }
  },

  // Get conversion rates (POST /dxsca-web/conversionRates)
  async getConversionRates({ toCurrency, fromCurrency } = {}) {
    try {
      if (!toCurrency) throw new Error('toCurrency is required');
      const response = await liquidClient.post('/conversion-rates', {
        to_currency: toCurrency,
        from_currency: fromCurrency || null,
      });
      return response.data;
    } catch (error) {
      const status = error?.response?.status;
      if (status !== 400 && status !== 401 && status !== 403) {
        console.error('Error fetching conversion rates:', error);
      }
      throw error;
    }
  }
};

export default liquidClient;
