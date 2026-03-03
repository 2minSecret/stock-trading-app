/**
 * Yahoo Finance API client for historical market data
 */

import { getLiquidApiBase } from './liquidChartsClient';

const API_BASE = getLiquidApiBase();

/**
 * Map common timeframe formats to Yahoo Finance periods and intervals
 */
const timeframeToYahoo = (timeframe, limit = 100) => {
  const tf = timeframe.toLowerCase();
  
  // For intraday data (minutes/hours)
  if (tf === '1m' || tf === '2m' || tf === '5m') {
    return { period: '1d', interval: tf };
  }
  if (tf === '15m' || tf === '30m') {
    return { period: '5d', interval: tf };
  }
  if (tf === '1h' || tf === '60m') {
    return { period: '1mo', interval: '1h' };
  }
  
  // For daily and longer
  if (tf === '1d') {
    if (limit <= 30) return { period: '1mo', interval: '1d' };
    if (limit <= 90) return { period: '3mo', interval: '1d' };
    if (limit <= 180) return { period: '6mo', interval: '1d' };
    return { period: '1y', interval: '1d' };
  }
  
  // Default
  return { period: '1mo', interval: '1d' };
};

/**
 * Map symbol format (NAS100 -> ^IXIC, etc.)
 */
const mapSymbol = (symbol) => {
  const symbolMap = {
    'NAS100': '^IXIC',
    'NASDAQ': '^IXIC',
    'SPX': '^GSPC',
    'SP500': '^GSPC',
    'DOW': '^DJI',
    'DJI': '^DJI',
  };
  
  return symbolMap[symbol.toUpperCase()] || symbol;
};

export const yahooFinanceClient = {
  /**
   * Get historical OHLC data
   * @param {string} symbol - Stock symbol (e.g., 'AAPL', 'NAS100')
   * @param {string} timeframe - Timeframe (e.g., '1m', '5m', '1h', '1d')
   * @param {number} limit - Number of candles to fetch
   * @returns {Promise<Object>} Historical data response
   */
  async getHistory(symbol, timeframe = '1h', limit = 100) {
    try {
      const mappedSymbol = mapSymbol(symbol);
      const { period, interval } = timeframeToYahoo(timeframe, limit);
      
      const url = `${API_BASE}/yahoo/history?symbol=${encodeURIComponent(mappedSymbol)}&period=${period}&interval=${interval}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Yahoo Finance API error: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
      
    } catch (error) {
      console.error('Error fetching Yahoo Finance history:', error);
      throw error;
    }
  },

  /**
   * Get current quote (uses the last candle from 1d period)
   * @param {string} symbol - Stock symbol
   * @returns {Promise<Object>} Current quote data
   */
  async getQuote(symbol) {
    try {
      const mappedSymbol = mapSymbol(symbol);
      const url = `${API_BASE}/yahoo/history?symbol=${encodeURIComponent(mappedSymbol)}&period=1d&interval=1m`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Yahoo Finance API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Return the most recent candle as quote
      if (data.candles && data.candles.length > 0) {
        const lastCandle = data.candles[data.candles.length - 1];
        return {
          symbol: data.symbol,
          price: lastCandle.close,
          open: lastCandle.open,
          high: lastCandle.high,
          low: lastCandle.low,
          volume: lastCandle.volume,
          timestamp: lastCandle.ts,
        };
      }
      
      return null;
      
    } catch (error) {
      console.error('Error fetching Yahoo Finance quote:', error);
      throw error;
    }
  },
};

export default yahooFinanceClient;
