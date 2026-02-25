import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

const MarketFeedContext = createContext(null);

function buildWsCandidates(url) {
  if (url) return [url];

  const envUrl = import.meta.env.VITE_MARKET_FEED_WS_URL;
  if (envUrl) return [envUrl];

  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return [
    `ws://${host}:8001/ws/stock-data`,
  ];
}

export function MarketFeedProvider({ children, url }) {
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const connectDelayTimerRef = useRef(null);
  const retryAttemptRef = useRef(0);
  const candidateIndexRef = useRef(0);
  const mountedRef = useRef(true);
  const connectedOnceRef = useRef(false);
  const [prices, setPrices] = useState({}); // { TICKER: { price, ts } }
  const [history, setHistory] = useState({}); // { TICKER: [{ts, price}, ...] }
  const [connectionStatus, setConnectionStatus] = useState('offline'); // offline | reconnecting | connected

  useEffect(() => {
    mountedRef.current = true;
    retryAttemptRef.current = 0;
    candidateIndexRef.current = 0;
    connectedOnceRef.current = false;

    const candidates = buildWsCandidates(url);

    const clearTimers = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (connectDelayTimerRef.current) {
        clearTimeout(connectDelayTimerRef.current);
        connectDelayTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (!mountedRef.current) return;

      setConnectionStatus('reconnecting');

      retryAttemptRef.current += 1;
      if (retryAttemptRef.current % 2 === 0) {
        candidateIndexRef.current = (candidateIndexRef.current + 1) % candidates.length;
      }

      const backoffMs = Math.min(5000, 500 * retryAttemptRef.current);
      reconnectTimerRef.current = setTimeout(connect, backoffMs);
    };

    const connect = () => {
      if (!mountedRef.current) return;

      const targetUrl = candidates[candidateIndexRef.current] || candidates[0];
      const ws = new WebSocket(targetUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        retryAttemptRef.current = 0;
        connectedOnceRef.current = true;
        setConnectionStatus('connected');
        console.log(`Market feed connected (${targetUrl})`);
      };

      ws.onclose = (event) => {
        if (!mountedRef.current) return;
        setConnectionStatus('offline');
        if (!connectedOnceRef.current) {
          scheduleReconnect();
          return;
        }
        if (!event.wasClean) {
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        // Keep this intentionally quiet; reconnect logic handles transient failures.
        if (mountedRef.current && connectionStatus !== 'connected') {
          setConnectionStatus('offline');
        }
      };

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          const ticker = data.ticker || data.sym || data.S || 'UNKNOWN';
          const aliasTicker = ticker === '^IXIC' ? 'NAS100' : null;
          const price = typeof data.price === 'number' ? data.price : Number(data.p ?? data.last ?? data.price);
          const ts = Date.now();
          if (!ticker || Number.isNaN(price)) return;

          setPrices(prev => ({ ...prev, [ticker]: { price, ts } }));
          if (aliasTicker) {
            setPrices(prev => ({ ...prev, [aliasTicker]: { price, ts } }));
          }

          setHistory(prev => {
            const arr = prev[ticker] ? prev[ticker].slice() : [];
            arr.push({ ts, price });
            if (arr.length > 300) arr.shift();
            const next = { ...prev, [ticker]: arr };
            if (aliasTicker) {
              const aliasArr = prev[aliasTicker] ? prev[aliasTicker].slice() : [];
              aliasArr.push({ ts, price });
              if (aliasArr.length > 300) aliasArr.shift();
              next[aliasTicker] = aliasArr;
            }
            return next;
          });
        } catch {
          // Ignore parse errors
        }
      };
    };

    // StrictMode-safe delayed connect to avoid connect->immediate-close noise in dev.
    connectDelayTimerRef.current = setTimeout(connect, 0);

    return () => {
      mountedRef.current = false;
      setConnectionStatus('offline');
      clearTimers();
      try {
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
          wsRef.current.close();
        }
      } catch {}
      wsRef.current = null;
    };
  }, [url]);

  const value = { prices, history, connectionStatus };
  return (
    <MarketFeedContext.Provider value={value}>
      {children}
    </MarketFeedContext.Provider>
  );
}

export function useMarketFeed() {
  const ctx = useContext(MarketFeedContext);
  if (!ctx) {
    // Return safe defaults if context is not available
    console.warn('useMarketFeed used outside MarketFeedProvider, returning empty data');
    return { prices: {}, history: {}, connectionStatus: 'offline' };
  }
  return ctx;
}

export default MarketFeedContext;
