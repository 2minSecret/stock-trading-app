import React, { useMemo, useEffect, useState, useRef } from 'react';
import { Bar } from 'react-chartjs-2';
import { TrendingUp, TrendingDown, ChevronDown, ZoomIn, ZoomOut, Move, RotateCcw, Calendar, Maximize2, Minimize2 } from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { useMarketFeed } from '../hooks/MarketFeedProvider';
import { yahooFinanceClient } from '../services/yahooFinanceClient';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend, Filler, zoomPlugin);

const AVAILABLE_CHARTS = [
  { value: 'NAS100', label: 'Nasdaq 100' },
  { value: 'AAPL', label: 'Apple Inc.' },
  { value: 'TSLA', label: 'Tesla Inc.' },
  { value: 'MSFT', label: 'Microsoft' },
  { value: 'GOOGL', label: 'Google/Alphabet' },
  { value: 'AMZN', label: 'Amazon' },
  { value: 'NVDA', label: 'NVIDIA' },
  { value: 'META', label: 'Meta' },
  { value: 'NFLX', label: 'Netflix' },
];

export default function ChartsViewScreen({
  tradingView,
  setTradingView,
  sessionReady = false,
  selectedTradeAccount = null,
  isLiveBlocked = false,
  onPlaceBracketOrder,
  onPlaceTouchCloseOrder,
  onModifyOrder,
  onCancelOrder,
  isOrderActionSubmitting = false,
  isOrderActionDisabled = false,
  orderHistoryRows = [],
  accountEventRows = [],
}) {
  const { prices, history } = useMarketFeed();
  const chartRef = useRef(null);
  const timelineRef = useRef(null);
  const chartContainerRef = useRef(null);
  
  // Use tradingView if passed as prop, otherwise default to NAS100
  const selectedTicker = tradingView || 'NAS100';
  const [timeframe, setTimeframe] = useState('1h');
  const [showDropdown, setShowDropdown] = useState(false);
  const [apiHistory, setApiHistory] = useState([]);
  const [apiQuote, setApiQuote] = useState(null);
  const [dataLimit, setDataLimit] = useState(200);
  const [isPanning, setIsPanning] = useState(false);
  const [selectedTimeIndex, setSelectedTimeIndex] = useState(0);
  const [isDraggingTimeline, setIsDraggingTimeline] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFullscreenPanelVisible, setIsFullscreenPanelVisible] = useState(true);
  const [tradeSide, setTradeSide] = useState('BUY');
  const [entryType, setEntryType] = useState('MARKET');
  const [entryPrice, setEntryPrice] = useState('');
  const [tradeQuantity, setTradeQuantity] = useState('1');
  const [stopLossPrice, setStopLossPrice] = useState(null);
  const [takeProfitPrice, setTakeProfitPrice] = useState(null);
  const [showTradeLines, setShowTradeLines] = useState(false);
  const [draggingLine, setDraggingLine] = useState(null);
  const [isSubmittingBracket, setIsSubmittingBracket] = useState(false);
  const [bracketStatus, setBracketStatus] = useState('');
  const [bracketError, setBracketError] = useState('');
  const [activePositionCode, setActivePositionCode] = useState('');
  const [autoTouchTriggerEnabled, setAutoTouchTriggerEnabled] = useState(true);
  const [isTouchTriggerSubmitting, setIsTouchTriggerSubmitting] = useState(false);
  const [xViewRange, setXViewRange] = useState({ min: null, max: null });
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const lastTouchTriggerKeyRef = useRef('');
  const autoReturnTimerRef = useRef(null);

  const ZOOM_WHEEL_SPEED = 0.08;
  const ZOOM_DRAG_THRESHOLD = 6;
  const PAN_THRESHOLD = 2;
  const AUTO_RETURN_DELAY_MS = 5000;
  const CHART_RIGHT_PADDING_BARS = 40;
  const fullscreenPanelWidth = 'min(clamp(220px, 35vw, 360px), calc(100vw - 96px))';

  // Helper to get display name for ticker
  const getDisplayName = (ticker) => {
    const chart = AVAILABLE_CHARTS.find(c => c.value === ticker);
    return chart ? chart.label : ticker;
  };

  // Get ticker data
  const tickerData = prices[selectedTicker] || { price: 0 };
  const tickerHistory = history[selectedTicker] || [];

  useEffect(() => {
    const sessionToken = localStorage.getItem('liquid_session_token');
    if (!sessionReady || !sessionToken) {
      setApiHistory([]);
      setApiQuote(null);
      return;
    }

    let mounted = true;

    const normalizeCandles = (payload) => {
      const extractArray = (value) => {
        if (Array.isArray(value)) return value;
        if (!value || typeof value !== 'object') return [];
        const keys = ['candles', 'items', 'data', 'marketData', 'quotes'];
        for (const key of keys) {
          if (Array.isArray(value[key])) return value[key];
        }
        for (const v of Object.values(value)) {
          if (Array.isArray(v)) return v;
        }
        return [];
      };

      const rows = extractArray(payload);
      return rows
        .map((row) => {
          const timestamp = row?.time ?? row?.timestamp ?? row?.ts ?? row?.dateTime ?? row?.date;
          const openRaw = row?.open ?? row?.o ?? row?.bidOpen ?? row?.openPrice;
          const highRaw = row?.high ?? row?.h ?? row?.bidHigh ?? row?.highPrice;
          const lowRaw = row?.low ?? row?.l ?? row?.bidLow ?? row?.lowPrice;
          const closeRaw = row?.close ?? row?.c ?? row?.price ?? row?.last ?? row?.bidClose ?? row?.closePrice;
          const ts = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
          const open = typeof openRaw === 'number' ? openRaw : Number(openRaw);
          const high = typeof highRaw === 'number' ? highRaw : Number(highRaw);
          const low = typeof lowRaw === 'number' ? lowRaw : Number(lowRaw);
          const close = typeof closeRaw === 'number' ? closeRaw : Number(closeRaw);
          if (!Number.isFinite(ts) || !Number.isFinite(close)) return null;
          return {
            ts,
            price: close,
            open: Number.isFinite(open) ? open : close,
            high: Number.isFinite(high) ? high : Math.max(Number.isFinite(open) ? open : close, close),
            low: Number.isFinite(low) ? low : Math.min(Number.isFinite(open) ? open : close, close),
            close,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.ts - b.ts);
    };

    const fetchCandles = async () => {
      try {
        const response = await yahooFinanceClient.getHistory(selectedTicker, timeframe, dataLimit);
        const normalized = normalizeCandles(response);
        if (mounted) {
          setApiHistory(normalized);
        }
      } catch (error) {
        console.error('Error fetching Yahoo Finance history:', error);
        if (mounted) setApiHistory([]);
      }
    };

    const fetchQuote = async () => {
      try {
        const response = await yahooFinanceClient.getQuote(selectedTicker);
        if (mounted) {
          setApiQuote(response);
        }
      } catch (error) {
        console.error('Error fetching Yahoo Finance quote:', error);
        if (mounted) setApiQuote(null);
      }
    };

    fetchCandles();
    fetchQuote();
    const timer = setInterval(() => {
      fetchCandles();
      fetchQuote();
    }, 10000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [selectedTicker, timeframe, sessionReady, dataLimit]);

  // Use full fetched history for the selected timeframe
  const baseHistory = apiHistory.length > 0 ? apiHistory : tickerHistory;

  const filteredHistory = useMemo(() => {
    if (baseHistory.length === 0) return [];
    return baseHistory;
  }, [baseHistory]);

  const formatTimestampByTimeframe = (ts, includeDate = false) => {
    if (!ts) return '';
    const date = new Date(ts);
    if (timeframe === '1m' || timeframe === '2m' || timeframe === '5m') {
      return includeDate
        ? date.toLocaleString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    if (timeframe === '1h') {
      return includeDate
        ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (timeframe === '1d') {
      return includeDate
        ? date.toLocaleDateString([], { month: 'short', day: 'numeric' })
        : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    return includeDate
      ? date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
      : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const pickValue = (source, keys) => {
    if (!source || typeof source !== 'object') return null;
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
  };

  const normalizeSide = (raw) => {
    const value = String(raw || '').toUpperCase();
    if (value === 'BUY' || value === 'SELL') return value;
    return null;
  };

  const normalizeTime = (raw) => {
    if (!raw) return { sortTime: 0, label: '—' };
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return { sortTime: 0, label: String(raw) };
    return { sortTime: date.getTime(), label: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) };
  };

  // Calculate price change
  const derivedPrice = apiQuote?.price ?? apiQuote?.last ?? tickerData.price;
  const prev = filteredHistory.length > 1
    ? filteredHistory[0].price
    : derivedPrice;
  const change = derivedPrice - prev;
  const pct = prev ? (change / prev) * 100 : 0;
  const isPositive = change >= 0;

  const candleSeries = useMemo(() => {
    return filteredHistory.map((point, index) => {
      const close = Number.isFinite(point.close) ? point.close : point.price;
      const prevClose = index > 0
        ? (Number.isFinite(filteredHistory[index - 1].close) ? filteredHistory[index - 1].close : filteredHistory[index - 1].price)
        : close;
      const open = Number.isFinite(point.open) ? point.open : prevClose;
      const high = Number.isFinite(point.high) ? point.high : Math.max(open, close);
      const low = Number.isFinite(point.low) ? point.low : Math.min(open, close);
      return { ts: point.ts, open, high, low, close };
    });
  }, [filteredHistory]);

  const paddedCandleSeries = useMemo(() => {
    if (candleSeries.length === 0) return [];
    const lastPoint = candleSeries[candleSeries.length - 1];
    const prevPoint = candleSeries.length > 1 ? candleSeries[candleSeries.length - 2] : null;
    const stepMsRaw = prevPoint ? (lastPoint.ts - prevPoint.ts) : 60_000;
    const stepMs = Number.isFinite(stepMsRaw) && stepMsRaw > 0 ? stepMsRaw : 60_000;
    const padding = Array.from({ length: CHART_RIGHT_PADDING_BARS }, (_, index) => ({
      ts: lastPoint.ts + stepMs * (index + 1),
      price: lastPoint.close,
      open: lastPoint.close,
      high: lastPoint.close,
      low: lastPoint.close,
      close: lastPoint.close,
      isPadding: true,
    }));
    return [...candleSeries, ...padding];
  }, [candleSeries]);

  // Calculate high/low
  const prices_arr = candleSeries.map(p => p.close).filter((value) => Number.isFinite(value));
  const high = prices_arr.length > 0 ? Math.max(...prices_arr) : derivedPrice;
  const low = prices_arr.length > 0 ? Math.min(...prices_arr) : derivedPrice;
  const chartTop = high * 1.002;
  const chartBottom = low * 0.998;
  const chartSpan = Math.max(0.000001, chartTop - chartBottom);
  const isBuySide = tradeSide === 'BUY';
  const currentEntryPrice = entryType === 'LIMIT' && Number(entryPrice) > 0 ? Number(entryPrice) : Number(derivedPrice || 0);
  const linePriceToPct = (price) => {
    if (!Number.isFinite(price)) return 50;
    const pct = ((chartTop - price) / chartSpan) * 100;
    return Math.max(0, Math.min(100, pct));
  };
  const pctToLinePrice = (pct) => {
    const clamped = Math.max(0, Math.min(100, pct));
    const raw = chartTop - (clamped / 100) * chartSpan;
    return Number(raw.toFixed(2));
  };
  const avgPrice = prices_arr.length > 0
    ? prices_arr.reduce((sum, value) => sum + value, 0) / prices_arr.length
    : derivedPrice;
  const periodStart = filteredHistory.length > 0 ? filteredHistory[0].ts : null;
  const periodEnd = filteredHistory.length > 0 ? filteredHistory[filteredHistory.length - 1].ts : null;
  const periodMinutes = periodStart && periodEnd
    ? Math.max(0, Math.round((periodEnd - periodStart) / 60000))
    : 0;
  const periodLabel = periodMinutes >= 60
    ? `${Math.floor(periodMinutes / 60)}h ${periodMinutes % 60}m`
    : `${periodMinutes}m`;
  const placeBracketDisabledReason = isSubmittingBracket
    ? 'Submitting order...'
    : !sessionReady
      ? 'Session is not ready yet.'
      : !showTradeLines
        ? 'Use Buy or Sell to arm TP/SL lines.'
        : '';
  const isPlaceBracketDisabled = Boolean(placeBracketDisabledReason);

  const initializeTradeLines = (nextSide) => {
    if (!Number.isFinite(currentEntryPrice) || currentEntryPrice <= 0) return;
    const sideForDefaults = nextSide || tradeSide;
    const isBuy = sideForDefaults === 'BUY';
    const tpDefault = isBuy
      ? Number((currentEntryPrice * 1.01).toFixed(2))
      : Number((currentEntryPrice * 0.99).toFixed(2));
    const slDefault = isBuy
      ? Number((currentEntryPrice * 0.99).toFixed(2))
      : Number((currentEntryPrice * 1.01).toFixed(2));
    setTakeProfitPrice(tpDefault);
    setStopLossPrice(slDefault);
  };

  const handleArmTrade = (nextSide) => {
    setTradeSide(nextSide);
    setShowTradeLines(true);
    setBracketStatus('');
    setBracketError('');
    setActivePositionCode('');
    lastTouchTriggerKeyRef.current = '';
    initializeTradeLines(nextSide);
  };

  const toggleTradeLines = () => {
    if (showTradeLines) {
      setShowTradeLines(false);
      setActivePositionCode('');
      setIsTouchTriggerSubmitting(false);
      lastTouchTriggerKeyRef.current = '';
      return;
    }

    setShowTradeLines(true);
    if (!Number.isFinite(stopLossPrice) || !Number.isFinite(takeProfitPrice)) {
      initializeTradeLines(tradeSide);
    }
  };

  const extractPositionCode = (payload) => {
    if (!payload || typeof payload !== 'object') return '';
    const direct = payload.position_code || payload.positionCode;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();

    const candidates = [
      payload.entry_response,
      payload.entry,
      payload.tp_response,
      payload.sl_response,
      payload.response,
      payload.data,
    ];

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue;
      const nested = candidate.position_code || candidate.positionCode;
      if (typeof nested === 'string' && nested.trim()) return nested.trim();
      const order = candidate.order;
      const orderPos = order?.position_code || order?.positionCode;
      if (typeof orderPos === 'string' && orderPos.trim()) return orderPos.trim();
    }

    return '';
  };

  const updateDraggedLine = (clientY) => {
    if (!draggingLine || !chartContainerRef.current || !Number.isFinite(currentEntryPrice) || currentEntryPrice <= 0) return;
    const rect = chartContainerRef.current.getBoundingClientRect();
    const pct = ((clientY - rect.top) / rect.height) * 100;
    const nextPrice = pctToLinePrice(pct);
    if (draggingLine === 'tp') {
      setTakeProfitPrice(nextPrice);
      return;
    }
    setStopLossPrice(nextPrice);
  };

  useEffect(() => {
    if (!draggingLine) return;
    const onMove = (event) => {
      const clientY = event.touches?.[0]?.clientY ?? event.clientY;
      if (typeof clientY !== 'number') return;
      updateDraggedLine(clientY);
    };
    const onEnd = () => setDraggingLine(null);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [draggingLine, currentEntryPrice, isBuySide, chartTop, chartSpan]);

  const handlePlaceBracket = async () => {
    setBracketStatus('');
    setBracketError('');

    if (!selectedTradeAccount) {
      setBracketError('Select an account before placing an order.');
      return;
    }
    if (isLiveBlocked) {
      setBracketError('Live account is blocked. Enable live trading to continue.');
      return;
    }
    if (typeof onPlaceBracketOrder !== 'function') {
      setBracketError('Trading handler is unavailable.');
      return;
    }

    const quantity = Number(tradeQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setBracketError('Quantity must be a positive number.');
      return;
    }
    if (entryType === 'LIMIT') {
      const value = Number(entryPrice);
      if (!Number.isFinite(value) || value <= 0) {
        setBracketError('Limit entry requires a positive entry price.');
        return;
      }
    }
    if (!showTradeLines || !Number.isFinite(stopLossPrice) || !Number.isFinite(takeProfitPrice)) {
      setBracketError('Set both SL and TP lines before placing the order.');
      return;
    }

    if (tradeSide === 'BUY' && !(stopLossPrice < currentEntryPrice && takeProfitPrice > currentEntryPrice)) {
      setBracketError('For BUY: SL must be below entry and TP above entry.');
      return;
    }
    if (tradeSide === 'SELL' && !(takeProfitPrice < currentEntryPrice && stopLossPrice > currentEntryPrice)) {
      setBracketError('For SELL: TP must be below entry and SL above entry.');
      return;
    }

    setIsSubmittingBracket(true);
    try {
      const result = await onPlaceBracketOrder({
        side: tradeSide,
        quantity,
        entryType,
        entryPrice: entryType === 'LIMIT' ? Number(entryPrice) : undefined,
        stopLossPrice,
        takeProfitPrice,
        instrument: selectedTicker,
      });
      const resolvedPositionCode = extractPositionCode(result);
      setActivePositionCode(resolvedPositionCode);
      lastTouchTriggerKeyRef.current = '';
      const status = result?.status;
      if (status === 'entry_tp_sl_placed') {
        setBracketStatus(`${tradeSide} bracket submitted on ${selectedTradeAccount.label} (${selectedTradeAccount.code}). TP/SL attached.${resolvedPositionCode ? ' Touch trigger armed.' : ''}`);
      } else if (status === 'entry_placed_tp_sl_partial' || status === 'entry_placed_tp_sl_failed' || status === 'entry_placed_position_pending') {
        setBracketStatus(`${tradeSide} entry submitted on ${selectedTradeAccount.label} (${selectedTradeAccount.code}).`);
        const tpErr = result?.errors?.take_profit;
        const slErr = result?.errors?.stop_loss;
        const pendingMsg = status === 'entry_placed_position_pending' ? 'Position code not ready yet for TP/SL attach.' : '';
        const tpMsg = tpErr ? `TP error: ${typeof tpErr === 'string' ? tpErr : (tpErr.description || JSON.stringify(tpErr))}` : '';
        const slMsg = slErr ? `SL error: ${typeof slErr === 'string' ? slErr : (slErr.description || JSON.stringify(slErr))}` : '';
        const joined = [pendingMsg, tpMsg, slMsg].filter(Boolean).join(' ');
        if (joined) setBracketError(joined);
      } else {
        setBracketStatus(`${tradeSide} bracket submitted on ${selectedTradeAccount.label} (${selectedTradeAccount.code}).`);
      }
    } catch (error) {
      const detail = error?.response?.data?.detail;
      if (typeof detail === 'string') {
        setBracketError(detail);
      } else if (detail && typeof detail === 'object') {
        setBracketError(detail.description || detail.message || 'Bracket order failed.');
      } else {
        setBracketError(error?.message || 'Bracket order failed.');
      }
    } finally {
      setIsSubmittingBracket(false);
    }
  };

  useEffect(() => {
    const latestCandle = candleSeries[candleSeries.length - 1];
    if (!latestCandle) return;
    if (!showTradeLines || !autoTouchTriggerEnabled) return;
    if (!activePositionCode || isSubmittingBracket || isTouchTriggerSubmitting) return;
    if (!Number.isFinite(stopLossPrice) || !Number.isFinite(takeProfitPrice)) return;
    if (typeof onPlaceTouchCloseOrder !== 'function') return;

    const highPrice = Number(latestCandle.high);
    const lowPrice = Number(latestCandle.low);
    if (!Number.isFinite(highPrice) || !Number.isFinite(lowPrice)) return;

    const tpTouched = tradeSide === 'BUY'
      ? highPrice >= takeProfitPrice
      : lowPrice <= takeProfitPrice;
    const slTouched = tradeSide === 'BUY'
      ? lowPrice <= stopLossPrice
      : highPrice >= stopLossPrice;

    let triggerType = '';
    if (tpTouched) triggerType = 'TP';
    else if (slTouched) triggerType = 'SL';
    if (!triggerType) return;

    const triggerKey = `${activePositionCode}-${latestCandle.ts}-${triggerType}`;
    if (lastTouchTriggerKeyRef.current === triggerKey) return;
    lastTouchTriggerKeyRef.current = triggerKey;

    const quantity = Number(tradeQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setBracketError('Touch trigger requires a valid quantity.');
      return;
    }

    let canceled = false;
    const submitTouchClose = async () => {
      setIsTouchTriggerSubmitting(true);
      try {
        await onPlaceTouchCloseOrder({
          positionCode: activePositionCode,
          side: tradeSide,
          quantity,
          instrument: selectedTicker,
          reason: triggerType,
        });
        if (canceled) return;
        setBracketStatus(`${triggerType} touched on candle ${formatTimestampByTimeframe(latestCandle.ts, true)}. Close order sent.`);
        setBracketError('');
        setActivePositionCode('');
      } catch (error) {
        if (canceled) return;
        const detail = error?.response?.data?.detail;
        if (typeof detail === 'string') {
          setBracketError(detail);
        } else if (detail && typeof detail === 'object') {
          setBracketError(detail.description || detail.message || `${triggerType} touch close failed.`);
        } else {
          setBracketError(error?.message || `${triggerType} touch close failed.`);
        }
      } finally {
        if (!canceled) {
          setIsTouchTriggerSubmitting(false);
        }
      }
    };

    submitTouchClose();
    return () => {
      canceled = true;
    };
  }, [
    candleSeries,
    showTradeLines,
    autoTouchTriggerEnabled,
    activePositionCode,
    isSubmittingBracket,
    isTouchTriggerSubmitting,
    stopLossPrice,
    takeProfitPrice,
    tradeSide,
    tradeQuantity,
    selectedTicker,
    onPlaceTouchCloseOrder,
  ]);
  const navigatorWindowSize = Math.max(20, Math.round(filteredHistory.length * 0.28));
  const navigatorStartIndex = Math.max(0, Math.min(
    selectedTimeIndex - Math.floor(navigatorWindowSize / 2),
    Math.max(0, filteredHistory.length - navigatorWindowSize)
  ));
  const navigatorEndIndex = Math.min(filteredHistory.length - 1, navigatorStartIndex + navigatorWindowSize - 1);
  const navigatorStartPct = filteredHistory.length > 0 ? (navigatorStartIndex / filteredHistory.length) * 100 : 0;
  const navigatorWidthPct = filteredHistory.length > 0 ? ((navigatorEndIndex - navigatorStartIndex + 1) / filteredHistory.length) * 100 : 0;

  // Chart data
  const chartData = useMemo(() => {
    const labels = paddedCandleSeries.map(p => formatTimestampByTimeframe(p.ts));
    const wickData = paddedCandleSeries.map((point, index) => ({ x: labels[index], y: [point.low, point.high] }));
    const bodyData = paddedCandleSeries.map((point, index) => ({ x: labels[index], y: [point.open, point.close] }));
    const candleColors = paddedCandleSeries.map((point) => {
      if (point.isPadding) return 'rgba(0,0,0,0)';
      return point.close >= point.open ? '#3b82f6' : '#ef4444';
    });
    const candleFills = paddedCandleSeries.map((point) => {
      if (point.isPadding) return 'rgba(0,0,0,0)';
      return point.close >= point.open ? 'rgba(59, 130, 246, 0.75)' : 'rgba(239, 68, 68, 0.75)';
    });
    
    return {
      labels,
      datasets: [
        {
          label: `${selectedTicker}-wick`,
          data: wickData,
          backgroundColor: candleColors,
          borderColor: candleColors,
          borderWidth: 1,
          borderRadius: 1,
          barThickness: 1,
          maxBarThickness: 1,
          grouped: false,
          order: 1,
        },
        {
          label: selectedTicker,
          data: bodyData,
          backgroundColor: candleFills,
          borderColor: candleColors,
          borderWidth: 1,
          borderRadius: 2,
          barThickness: 7,
          maxBarThickness: 9,
          grouped: false,
          order: 2,
        },
      ]
    };
  }, [paddedCandleSeries, selectedTicker, timeframe]);

  const followWindowSize = Math.max(30, Math.round(candleSeries.length * 0.35));
  const followLatestRange = useMemo(() => {
    if (candleSeries.length === 0) return { min: null, max: null };
    const latestIndex = candleSeries.length - 1;
    const halfWindow = Math.max(10, Math.floor(followWindowSize / 2));
    const min = latestIndex - halfWindow;
    const max = latestIndex + halfWindow;
    return { min, max };
  }, [candleSeries.length, followWindowSize]);

  const isNearFollowRange = (min, max) => {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return false;
    if (!Number.isFinite(followLatestRange.min) || !Number.isFinite(followLatestRange.max)) return false;
    return Math.abs(min - followLatestRange.min) <= 1 && Math.abs(max - followLatestRange.max) <= 1;
  };

  const clearAutoReturnTimer = () => {
    if (!autoReturnTimerRef.current) return;
    clearTimeout(autoReturnTimerRef.current);
    autoReturnTimerRef.current = null;
  };

  const scheduleAutoReturnToLatest = () => {
    clearAutoReturnTimer();
    autoReturnTimerRef.current = setTimeout(() => {
      setIsFollowingLatest(true);
      if (Number.isFinite(followLatestRange.min) && Number.isFinite(followLatestRange.max)) {
        setXViewRange({ min: followLatestRange.min, max: followLatestRange.max });
      }
    }, AUTO_RETURN_DELAY_MS);
  };

  useEffect(() => {
    if (!isFollowingLatest) return;
    clearAutoReturnTimer();
    if (!Number.isFinite(followLatestRange.min) || !Number.isFinite(followLatestRange.max)) return;
    setXViewRange({ min: followLatestRange.min, max: followLatestRange.max });
  }, [isFollowingLatest, followLatestRange.min, followLatestRange.max]);

  useEffect(() => {
    return () => {
      clearAutoReturnTimer();
    };
  }, []);

  useEffect(() => {
    setIsFollowingLatest(true);
  }, [selectedTicker, timeframe]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'nearest',
      intersect: true,
    },
    events: ['mousemove', 'mouseout', 'click', 'mousedown', 'mouseup', 'touchstart', 'touchmove', 'touchend'],
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        titleColor: '#fff',
        bodyColor: '#06b6d4',
        borderColor: '#06b6d4',
        borderWidth: 1,
        padding: 10,
        displayColors: false,
        titleFont: { size: 12, weight: 'bold' },
        bodyFont: { size: 11 },
        callbacks: {
          title: (items) => items?.[0]?.label ? `Time: ${items[0].label}` : 'Candle',
          label: (context) => {
            const idx = context.dataIndex;
            const candle = candleSeries[idx];
            if (!candle) return '';
            const prevClose = idx > 0 ? candleSeries[idx - 1].close : candle.open;
            const move = candle.close - prevClose;
            const moveText = `${move >= 0 ? '+' : ''}${move.toFixed(2)}`;
            const directionText = move >= 0 ? 'Up' : 'Down';
            return [
              `Open: $${candle.open.toFixed(2)}`,
              `High: $${candle.high.toFixed(2)}`,
              `Low: $${candle.low.toFixed(2)}`,
              `Close: $${candle.close.toFixed(2)}`,
              `${directionText} vs prev close: ${moveText}`,
            ];
          },
        }
      },
      zoom: {
        zoom: {
          wheel: {
            enabled: true,
            speed: ZOOM_WHEEL_SPEED,
          },
          pinch: {
            enabled: true,
          },
          drag: {
            enabled: !isPanning,
            backgroundColor: 'rgba(6, 182, 212, 0.15)',
            borderColor: 'rgba(6, 182, 212, 0.6)',
            borderWidth: 1,
            threshold: ZOOM_DRAG_THRESHOLD,
          },
          mode: 'x',
        },
        pan: {
          enabled: isPanning,
          mode: 'x',
          modifierKey: null,
          threshold: PAN_THRESHOLD,
        },
        onZoomComplete: ({ chart }) => {
          const scaleX = chart?.scales?.x;
          if (!scaleX) return;
          if (Number.isFinite(scaleX.min) && Number.isFinite(scaleX.max)) {
            if (isNearFollowRange(scaleX.min, scaleX.max)) {
              setIsFollowingLatest(true);
              setXViewRange({ min: followLatestRange.min, max: followLatestRange.max });
              return;
            }
            setIsFollowingLatest(false);
            setXViewRange({ min: scaleX.min, max: scaleX.max });
            scheduleAutoReturnToLatest();
          }
        },
        onPanComplete: ({ chart }) => {
          const scaleX = chart?.scales?.x;
          if (!scaleX) return;
          if (Number.isFinite(scaleX.min) && Number.isFinite(scaleX.max)) {
            if (isNearFollowRange(scaleX.min, scaleX.max)) {
              setIsFollowingLatest(true);
              setXViewRange({ min: followLatestRange.min, max: followLatestRange.max });
              return;
            }
            setIsFollowingLatest(false);
            setXViewRange({ min: scaleX.min, max: scaleX.max });
            scheduleAutoReturnToLatest();
          }
        },
      }
    },
    scales: {
      x: {
        display: true,
        ...(Number.isFinite(xViewRange.min) ? { min: xViewRange.min } : {}),
        ...(Number.isFinite(xViewRange.max) ? { max: xViewRange.max } : {}),
        grid: { 
          display: true,
          color: 'rgba(75, 85, 99, 0.1)',
          drawBorder: false,
        },
        ticks: {
          color: '#919ba4',
          font: { size: 9 },
          maxRotation: 45,
          minRotation: 0,
          maxTicksLimit: 6,
        }
      },
      y: {
        display: true,
        beginAtZero: false,
        suggestedMin: low * 0.998,
        suggestedMax: high * 1.002,
        grid: { 
          display: true,
          color: 'rgba(75, 85, 99, 0.1)',
          drawBorder: false,
        },
        ticks: {
          color: '#919ba4',
          font: { size: 10 },
          callback: (value) => `$${value.toFixed(0)}`,
          maxTicksLimit: 6,
        }
      }
    }
  }), [
    isPanning,
    candleSeries,
    low,
    high,
    ZOOM_WHEEL_SPEED,
    ZOOM_DRAG_THRESHOLD,
    PAN_THRESHOLD,
    xViewRange.min,
    xViewRange.max,
    followLatestRange.min,
    followLatestRange.max,
    AUTO_RETURN_DELAY_MS,
  ]);

  const liveTradeActions = useMemo(() => {
    const historyActions = (Array.isArray(orderHistoryRows) ? orderHistoryRows : [])
      .map((row, idx) => {
        const side = normalizeSide(pickValue(row, ['side', 'orderSide', 'action']));
        if (!side) return null;

        const instrument = String(pickValue(row, ['instrument', 'symbol', 'ticker']) || '').toUpperCase();
        const tickerMatch = !instrument || instrument === String(selectedTicker || '').toUpperCase();
        if (!tickerMatch) return null;

        const status = pickValue(row, ['status', 'state', 'orderStatus']) || 'Updated';
        const quantity = pickValue(row, ['quantity', 'qty', 'size']);
        const timeRaw = pickValue(row, ['issuedAt', 'issued', 'timestamp', 'time', 'createdAt']);
        const { sortTime, label } = normalizeTime(timeRaw);

        return {
          id: `history-${idx}-${sortTime}`,
          side,
          status: String(status),
          quantity: quantity !== null ? String(quantity) : '',
          timeLabel: label,
          sortTime,
        };
      })
      .filter(Boolean);

    const eventActions = (Array.isArray(accountEventRows) ? accountEventRows : [])
      .map((row, idx) => {
        const type = String(pickValue(row, ['type', 'eventType', 'reason']) || '').toUpperCase();
        const message = String(pickValue(row, ['message', 'description', 'details', 'text']) || '');
        const side = message.toUpperCase().includes('SELL') ? 'SELL' : message.toUpperCase().includes('BUY') ? 'BUY' : null;
        if (!side) return null;

        const looksLikeTrade = type.includes('ORDER') || type.includes('FILL') || type.includes('EXEC');
        if (!looksLikeTrade && !message.toUpperCase().includes('ORDER')) return null;

        const includesTicker = message.toUpperCase().includes(String(selectedTicker || '').toUpperCase());
        if (!includesTicker && selectedTicker) return null;

        const timeRaw = pickValue(row, ['time', 'timestamp', 'eventTime', 'createdAt']);
        const { sortTime, label } = normalizeTime(timeRaw);

        return {
          id: `event-${idx}-${sortTime}`,
          side,
          status: String(type || 'Event'),
          quantity: '',
          timeLabel: label,
          sortTime,
        };
      })
      .filter(Boolean);

    return [...historyActions, ...eventActions]
      .sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0))
      .slice(0, 5);
  }, [orderHistoryRows, accountEventRows, selectedTicker]);

  // Chart control functions
  const handleZoomIn = () => {
    if (chartRef.current) {
      chartRef.current.zoom(1.2);
    }
  };

  const handleZoomOut = () => {
    if (chartRef.current) {
      chartRef.current.zoom(0.8);
    }
  };

  const handleResetZoom = () => {
    if (chartRef.current) {
      chartRef.current.resetZoom();
    }
    setIsFollowingLatest(true);
    clearAutoReturnTimer();
    if (Number.isFinite(followLatestRange.min) && Number.isFinite(followLatestRange.max)) {
      setXViewRange({ min: followLatestRange.min, max: followLatestRange.max });
    } else {
      setXViewRange({ min: null, max: null });
    }
  };

  // Keep timeline marker at latest candle when data updates
  useEffect(() => {
    if (isFollowingLatest && filteredHistory.length > 0) {
      setSelectedTimeIndex(filteredHistory.length - 1);
    }
  }, [filteredHistory.length, isFollowingLatest]);

  // Handle timeline scrubber drag
  const handleTimelineDragStart = (e) => {
    if (!isPanning) return;
    setIsDraggingTimeline(true);
  };

  const handleTimelineDrag = (e) => {
    if (!isDraggingTimeline || !timelineRef.current || filteredHistory.length === 0) return;

    const timelineRect = timelineRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const x = clientX - timelineRect.left;
    const percentage = Math.max(0, Math.min(1, x / timelineRect.width));
    const newIndex = Math.floor(percentage * (filteredHistory.length - 1));

    setIsFollowingLatest(false);
    setSelectedTimeIndex(newIndex);
    scheduleAutoReturnToLatest();

    // Pan chart to match timeline position
    if (chartRef.current) {
      const visibleRange = Math.ceil(filteredHistory.length / 3);
      const targetPan = Math.max(0, newIndex - visibleRange);
      const pixelShift = targetPan * 10;
      chartRef.current.pan({ x: -pixelShift }, undefined, 'default');
    }
  };

  const handleTimelineDragEnd = () => {
    setIsDraggingTimeline(false);
  };

  // Add mouse move listener when dragging
  useEffect(() => {
    if (isDraggingTimeline) {
      window.addEventListener('mousemove', handleTimelineDrag);
      window.addEventListener('mouseup', handleTimelineDragEnd);
      window.addEventListener('touchmove', handleTimelineDrag, { passive: false });
      window.addEventListener('touchend', handleTimelineDragEnd);

      return () => {
        window.removeEventListener('mousemove', handleTimelineDrag);
        window.removeEventListener('mouseup', handleTimelineDragEnd);
        window.removeEventListener('touchmove', handleTimelineDrag);
        window.removeEventListener('touchend', handleTimelineDragEnd);
      };
    }
  }, [isDraggingTimeline, filteredHistory.length]);

  const handleLoadMore = () => {
    setDataLimit(prev => Math.min(prev + 200, 2000));
  };

  const handleLoadLess = () => {
    setDataLimit(prev => Math.max(prev - 200, 50));
  };

  const handleToggleFullscreen = async () => {
    const next = !isFullscreen;
    setIsFullscreen(next);
    if (Number.isFinite(followLatestRange.min) && Number.isFinite(followLatestRange.max)) {
      setIsFollowingLatest(true);
      setXViewRange({ min: followLatestRange.min, max: followLatestRange.max });
    }
    if (next) {
      setIsFullscreenPanelVisible(true);
    }

    if (next) {
      try {
        await document.documentElement.requestFullscreen?.();
      } catch (error) {
        // Fullscreen might be blocked; continue with layout-only fullscreen
      }
      try {
        await window.screen?.orientation?.lock?.('landscape');
      } catch (error) {
        // Orientation lock not available; ignore
      }
    } else {
      try {
        await document.exitFullscreen?.();
      } catch (error) {
        // Ignore exit fullscreen failures
      }
      try {
        window.screen?.orientation?.unlock?.();
      } catch (error) {
        // Ignore orientation unlock failures
      }
    }
  };

  useEffect(() => {
    document.body.style.overflow = isFullscreen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isFullscreen]);

  const tradeLineOverlay = (
    <>
      {showTradeLines && Number.isFinite(currentEntryPrice) && currentEntryPrice > 0 && (
        <div
          className="absolute left-0 right-0 pointer-events-none"
          style={{ top: `${linePriceToPct(currentEntryPrice)}%` }}
        >
          <div className="border-t border-cyan-400/80 border-dashed" />
          <span className="absolute right-2 -top-3 text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-200 border border-cyan-500/40">
            Entry {currentEntryPrice.toFixed(2)}
          </span>
        </div>
      )}

      {showTradeLines && Number.isFinite(takeProfitPrice) && (
        <div
          className="absolute left-0 right-0"
          style={{ top: `${linePriceToPct(takeProfitPrice)}%` }}
        >
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); setDraggingLine('tp'); }}
            onTouchStart={(e) => { e.preventDefault(); setDraggingLine('tp'); }}
            className="absolute left-0 right-0 -top-3 h-6 cursor-ns-resize"
            title="Drag Take Profit"
          />
          <div className="border-t border-emerald-400/90" />
          <span className="absolute right-2 -top-3 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40">
            TP {takeProfitPrice.toFixed(2)}
          </span>
        </div>
      )}

      {showTradeLines && Number.isFinite(stopLossPrice) && (
        <div
          className="absolute left-0 right-0"
          style={{ top: `${linePriceToPct(stopLossPrice)}%` }}
        >
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); setDraggingLine('sl'); }}
            onTouchStart={(e) => { e.preventDefault(); setDraggingLine('sl'); }}
            className="absolute left-0 right-0 -top-3 h-6 cursor-ns-resize"
            title="Drag Stop Loss"
          />
          <div className="border-t border-rose-400/90" />
          <span className="absolute right-2 -top-3 text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-200 border border-rose-500/40">
            SL {stopLossPrice.toFixed(2)}
          </span>
        </div>
      )}
    </>
  );

  const bracketPanel = (
    <div className="bg-gray-800/20 border border-gray-700/20 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => handleArmTrade('BUY')}
          className="h-8 px-3 rounded bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-semibold"
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => handleArmTrade('SELL')}
          className="h-8 px-3 rounded bg-rose-600/80 hover:bg-rose-500 text-white text-xs font-semibold"
        >
          Sell
        </button>
        <button
          type="button"
          onClick={toggleTradeLines}
          className={`h-8 px-3 rounded text-white text-xs font-semibold ${showTradeLines ? 'bg-cyan-700/80 hover:bg-cyan-600' : 'bg-gray-700/70 hover:bg-gray-600'}`}
        >
          Lines: {showTradeLines ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className={`grid gap-2 items-end ${isFullscreen ? 'grid-cols-1' : 'grid-cols-2 md:grid-cols-6'}`}>
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Side</label>
          <p className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white">{tradeSide}</p>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Entry Type</label>
          <select
            value={entryType}
            onChange={(e) => setEntryType(e.target.value)}
            className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"
          >
            <option value="MARKET">MARKET</option>
            <option value="LIMIT">LIMIT</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Qty</label>
          <input
            value={tradeQuantity}
            onChange={(e) => setTradeQuantity(e.target.value)}
            inputMode="decimal"
            className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Entry Price</label>
          <input
            value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)}
            inputMode="decimal"
            disabled={entryType !== 'LIMIT'}
            placeholder={entryType === 'LIMIT' ? 'Set price' : Number(derivedPrice || 0).toFixed(2)}
            className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white disabled:opacity-50"
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">TP / SL</label>
          <p className="mt-2 text-xs text-gray-300">{Number(takeProfitPrice || 0).toFixed(2)} / {Number(stopLossPrice || 0).toFixed(2)}</p>
        </div>
        <button
          type="button"
          onClick={handlePlaceBracket}
          disabled={isPlaceBracketDisabled}
          title={placeBracketDisabledReason || 'Place bracket order'}
          className="h-8 w-full rounded bg-cyan-600/80 hover:bg-cyan-500 text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmittingBracket ? 'Submitting...' : 'Place Bracket'}
        </button>
      </div>

      <div className={`mt-2 grid gap-2 ${isFullscreen ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
        <button
          type="button"
          onClick={onModifyOrder}
          disabled={isOrderActionSubmitting || isOrderActionDisabled || typeof onModifyOrder !== 'function'}
          className="h-8 w-full rounded bg-gray-700/70 hover:bg-gray-600 text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isOrderActionSubmitting ? 'Submitting...' : 'Modify Order'}
        </button>
        <button
          type="button"
          onClick={onCancelOrder}
          disabled={isOrderActionSubmitting || isOrderActionDisabled || typeof onCancelOrder !== 'function'}
          className="h-8 w-full rounded bg-red-700/70 hover:bg-red-600 text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isOrderActionSubmitting ? 'Submitting...' : 'Cancel Order'}
        </button>
      </div>

      {!!placeBracketDisabledReason && !isSubmittingBracket && (
        <p className="mt-2 text-xs text-amber-300">{placeBracketDisabledReason}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <input
          id="touch-trigger-toggle"
          type="checkbox"
          checked={autoTouchTriggerEnabled}
          onChange={(e) => setAutoTouchTriggerEnabled(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-900 text-cyan-500"
        />
        <label htmlFor="touch-trigger-toggle" className="text-xs text-gray-300">
          Auto close when candle touches TP/SL
        </label>
      </div>

      {!showTradeLines && (
        <p className="mt-2 text-xs text-gray-400">Use Buy or Sell to show draggable TP/SL lines on chart.</p>
      )}

      {showTradeLines && !activePositionCode && (
        <p className="mt-2 text-xs text-gray-500">Touch trigger activates after bracket entry returns a position code.</p>
      )}

      {showTradeLines && !!activePositionCode && (
        <p className="mt-2 text-xs text-cyan-300">Touch trigger armed for position {activePositionCode}.</p>
      )}

      {isTouchTriggerSubmitting && (
        <p className="mt-2 text-xs text-cyan-300">Submitting touch-trigger close order...</p>
      )}

      {selectedTradeAccount && (
        <p className="mt-2 text-[10px] text-gray-500">Account: {selectedTradeAccount.label} ({selectedTradeAccount.code})</p>
      )}

      <div className="mt-3 border-t border-gray-700/30 pt-2">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Live Trade Status</p>
        {liveTradeActions.length === 0 ? (
          <p className="mt-1 text-xs text-gray-500">Waiting for BUY/SELL actions on {selectedTicker}...</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {liveTradeActions.map((action) => (
              <div key={action.id} className="flex items-center justify-between gap-2 rounded bg-gray-900/60 border border-gray-700/30 px-2 py-1.5">
                <div className="min-w-0">
                  <p className={`text-xs font-semibold ${action.side === 'BUY' ? 'text-cyan-400' : 'text-rose-400'}`}>
                    {action.side} {action.quantity ? `${action.quantity}` : ''}
                  </p>
                  <p className="text-[10px] text-gray-400 truncate">{action.status}</p>
                </div>
                <span className="text-[10px] text-gray-500">{action.timeLabel}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!!bracketStatus && <p className="mt-2 text-xs text-emerald-400">{bracketStatus}</p>}
      {!!bracketError && <p className="mt-2 text-xs text-rose-400">{bracketError}</p>}
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-950 p-3 flex flex-col overflow-hidden box-border">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[220px] overflow-x-auto">
            <div className="flex gap-2 flex-nowrap min-w-max">
              {['1m', '2m', '5m', '1h', '1d', '1w'].map(tf => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition duration-200 ${
                    timeframe === tf
                      ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/50'
                      : 'bg-gray-800/40 text-gray-400 border border-gray-700/30 active:bg-gray-700/50'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 bg-gray-900/50 border border-gray-700/40 rounded-lg px-3 py-1.5">
            <span className="text-xs text-gray-400">{selectedTicker}</span>
            <span className="text-sm font-semibold text-white">${Number(derivedPrice || 0).toFixed(2)}</span>
            <span className={`text-xs font-semibold ${isPositive ? 'text-cyan-400' : 'text-red-400'}`}>
              {isPositive ? '↑' : '↓'} {Math.abs(pct).toFixed(2)}%
            </span>
          </div>

          <div className="flex gap-1 items-center bg-gray-900/70 rounded-lg p-0.5 border border-gray-700/40 backdrop-blur-sm ml-auto">
            <button
              onClick={handleZoomIn}
              className="p-2 rounded-md active:bg-gray-700/70 transition text-cyan-400"
              title="Zoom In"
            >
              <ZoomIn size={16} />
            </button>
            <button
              onClick={handleZoomOut}
              className="p-2 rounded-md active:bg-gray-700/70 transition text-cyan-400"
              title="Zoom Out"
            >
              <ZoomOut size={16} />
            </button>
            <button
              onClick={handleResetZoom}
              className="p-2 rounded-md active:bg-gray-700/70 transition text-orange-400"
              title="Reset"
            >
              <RotateCcw size={16} />
            </button>
            <button
              onClick={() => setIsPanning(!isPanning)}
              className={`p-2 rounded-md active:bg-gray-700/70 transition ${
                isPanning ? 'text-green-400 bg-green-500/20' : 'text-gray-400'
              }`}
              title={isPanning ? 'Drag: ON' : 'Drag: OFF'}
            >
              <Move size={16} />
            </button>
          </div>

          <button
            onClick={handleToggleFullscreen}
            className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition ml-auto sm:ml-0"
          >
            <Minimize2 size={14} />
            Exit Fullscreen
          </button>
        </div>

        <div className="mb-2 bg-gray-900/40 border border-gray-700/30 rounded-lg px-2.5 py-1.5">
          <p className="text-[11px] text-gray-400">
            Tip: Pinch/wheel to zoom • {isPanning ? 'Drag to pan' : 'Enable Move to pan'} • Use panel toggle on seam
          </p>
        </div>

        <div className="flex-1 min-h-0 min-w-0 flex gap-3 relative">
          <div className="flex-1 min-h-0 min-w-0 flex flex-col gap-2">
            <div ref={chartContainerRef} className="touch-none flex-1 relative min-h-0">
              <Bar ref={chartRef} data={chartData} options={chartOptions} />
              {tradeLineOverlay}
            </div>

            <div className="bg-gray-900/40 rounded-lg border border-gray-700/30 p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold text-gray-400 uppercase">Navigator</span>
                <span className="text-xs font-mono text-cyan-400">
                  {filteredHistory.length > 0 && selectedTimeIndex < filteredHistory.length
                    ? formatTimestampByTimeframe(filteredHistory[selectedTimeIndex].ts, true)
                    : 'No data'}
                </span>
              </div>

              <div
                ref={timelineRef}
                onMouseDown={handleTimelineDragStart}
                onTouchStart={handleTimelineDragStart}
                className={`relative h-10 bg-gray-900/70 border border-gray-700/40 rounded-lg overflow-hidden transition ${
                  isPanning ? 'cursor-pointer' : 'cursor-not-allowed opacity-80'
                } ${
                  isDraggingTimeline ? 'border-cyan-500/70' : 'hover:border-cyan-500/40'
                }`}
                style={{ userSelect: 'none' }}
              >
                <div className="absolute inset-0 flex items-end px-0 gap-0 pointer-events-none">
                  {filteredHistory.map((point, index) => {
                    const prevPoint = index > 0 ? filteredHistory[index - 1] : point;
                    const directionUp = point.price >= prevPoint.price;
                    const height = high > low
                      ? Math.max(10, ((point.price - low) / (high - low)) * 100)
                      : 30;
                    return (
                      <div
                        key={`full-nav-${point.ts}-${index}`}
                        className="flex-1"
                        style={{
                          height: `${height}%`,
                          backgroundColor: directionUp ? 'rgba(59, 130, 246, 0.55)' : 'rgba(239, 68, 68, 0.55)',
                        }}
                      />
                    );
                  })}
                </div>

                <div className="absolute inset-y-0 left-0 bg-gray-950/55 pointer-events-none" style={{ width: `${navigatorStartPct}%` }} />
                <div
                  className="absolute inset-y-0 bg-cyan-500/10 border-y border-cyan-400/60 pointer-events-none"
                  style={{ left: `${navigatorStartPct}%`, width: `${navigatorWidthPct}%` }}
                />
                <div
                  className="absolute inset-y-0 right-0 bg-gray-950/55 pointer-events-none"
                  style={{ width: `${Math.max(0, 100 - navigatorStartPct - navigatorWidthPct)}%` }}
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsFullscreenPanelVisible((prev) => !prev)}
            className={`absolute top-16 z-30 h-9 w-7 rounded-l-full border border-r-0 border-gray-600/50 bg-gray-900/85 text-gray-300 hover:bg-gray-800/90 hover:text-white transition-all duration-300 backdrop-blur-sm ${
              isFullscreenPanelVisible ? 'opacity-100' : 'opacity-60'
            }`}
            style={{ right: isFullscreenPanelVisible ? fullscreenPanelWidth : '0px' }}
            title={isFullscreenPanelVisible ? 'Hide trading panel' : 'Show trading panel'}
          >
            {isFullscreenPanelVisible ? '›' : '‹'}
          </button>

          <div
            className="relative shrink-0 transition-all duration-300 ease-in-out"
            style={{
              width: isFullscreenPanelVisible ? fullscreenPanelWidth : '0px',
              minWidth: isFullscreenPanelVisible ? '220px' : '0px',
              maxWidth: isFullscreenPanelVisible ? fullscreenPanelWidth : '0px',
              overflow: 'visible',
            }}
          >
            <div
              className={`absolute top-0 right-0 h-full transition-all duration-300 ease-in-out ${isFullscreenPanelVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
              style={{
                width: fullscreenPanelWidth,
                transform: isFullscreenPanelVisible ? 'translateX(0px)' : 'translateX(calc(100% + 10px))',
              }}
            >
              <div className="h-full overflow-y-auto pr-1">
                {bracketPanel}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const normalLayout = (
    <div className="px-5 pb-24 space-y-6 flex flex-col">
      {/* Header with Chart Selector */}
      <section className={`mt-3 flex justify-between items-start gap-4 ${isFullscreen ? 'pt-2' : ''}`}>
        <div className="flex-1">
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="w-full flex items-center justify-between bg-gray-800/40 border border-gray-700/50 rounded-lg px-4 py-2.5 hover:border-cyan-500/50 focus:border-cyan-500 focus:outline-none transition duration-200"
            >
              <div className="text-left">
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Chart</p>
                <p className="text-lg font-semibold text-white mt-0.5">{getDisplayName(selectedTicker)}</p>
              </div>
              <ChevronDown size={18} className={`text-gray-400 transition ${showDropdown ? 'rotate-180' : ''}`} />
            </button>
            
            {/* Dropdown Menu */}
            {showDropdown && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900 border border-gray-700/50 rounded-lg shadow-xl z-50 max-h-64 overflow-y-auto">
                {AVAILABLE_CHARTS.map(chart => (
                  <button
                    key={chart.value}
                    onClick={() => {
                      setTradingView(chart.value);
                      setShowDropdown(false);
                    }}
                    className={`w-full flex justify-between items-center px-4 py-3 text-sm border-b border-gray-800/30 hover:bg-gray-800/50 transition ${
                      selectedTicker === chart.value ? 'bg-cyan-600/20 text-cyan-400' : 'text-gray-300'
                    }`}
                  >
                    <div className="text-left">
                      <p className="font-semibold">{chart.value}</p>
                      <p className="text-xs text-gray-500">{chart.label}</p>
                    </div>
                    {selectedTicker === chart.value && (
                      <div className="w-2 h-2 bg-cyan-400 rounded-full"></div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        
        <div className="text-right">
          <p className="text-2xl font-bold text-white">${Number(derivedPrice || 0).toFixed(2)}</p>
          <p className={`text-xs font-semibold mt-1 ${isPositive ? 'text-cyan-400' : 'text-red-400'}`}>
            {isPositive ? '↑' : '↓'} {Math.abs(pct).toFixed(2)}%
          </p>
          <button
            onClick={handleToggleFullscreen}
            className="mt-3 inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition"
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </div>
      </section>

      {/* Main Chart Card */}
      <section className="bg-gradient-to-br from-gray-900 to-gray-950 rounded-2xl border border-gray-800/50 shadow-lg p-6">
        {/* Timeframe Selector */}
        <div className="flex gap-2 mb-3 pb-3 border-b border-gray-800/30 overflow-x-auto">
          {['1m', '2m', '5m', '1h', '1d', '1w'].map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition duration-200 ${
                timeframe === tf
                  ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/50'
                  : 'bg-gray-800/40 text-gray-400 border border-gray-700/30 active:bg-gray-700/50'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Chart Controls */}
        <div className="mb-3 space-y-2">
          <div className="flex gap-2 items-center justify-between">
            <div className="flex gap-1 items-center bg-gray-800/30 rounded-lg p-0.5 border border-gray-700/30">
              <button
                onClick={handleZoomIn}
                className="p-2 rounded-md active:bg-gray-700/70 transition text-cyan-400"
                title="Zoom In"
              >
                <ZoomIn size={18} />
              </button>
              <button
                onClick={handleZoomOut}
                className="p-2 rounded-md active:bg-gray-700/70 transition text-cyan-400"
                title="Zoom Out"
              >
                <ZoomOut size={18} />
              </button>
              <button
                onClick={handleResetZoom}
                className="p-2 rounded-md active:bg-gray-700/70 transition text-orange-400"
                title="Reset"
              >
                <RotateCcw size={18} />
              </button>
            </div>

            <div className="flex gap-1 items-center bg-gray-800/30 rounded-lg p-0.5 border border-gray-700/30">
              <button
                onClick={() => setIsPanning(!isPanning)}
                className={`p-2 rounded-md active:bg-gray-700/70 transition ${
                  isPanning ? 'text-green-400 bg-green-500/20' : 'text-gray-400'
                }`}
                title={isPanning ? 'Drag: ON' : 'Drag: OFF'}
              >
                <Move size={18} />
              </button>
            </div>
          </div>

          {/* Tips */}
          <div className="bg-gray-800/20 border border-gray-700/20 rounded-lg px-2.5 py-1.5">
            <p className="text-[10px] text-gray-500 leading-relaxed">
              <span className="font-semibold text-cyan-400">Tip:</span> Pinch to zoom • {isPanning ? 'Swipe to pan' : 'Tap Move to drag'}
            </p>
          </div>
        </div>

        {/* Chart */}
        <div ref={chartContainerRef} style={{ height: '280px' }} className="mb-4 touch-none relative">
          <Bar ref={chartRef} data={chartData} options={chartOptions} />
          {tradeLineOverlay}
        </div>

        {/* Liquid-style Timeline Navigator */}
        <div className="bg-gray-800/40 rounded-lg border border-gray-700/30 p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-400 uppercase">Navigator</span>
            <span className="text-sm font-mono text-cyan-400">
              {filteredHistory.length > 0 && selectedTimeIndex < filteredHistory.length
                ? formatTimestampByTimeframe(filteredHistory[selectedTimeIndex].ts, true)
                : 'No data'}
            </span>
          </div>

          <div
            ref={timelineRef}
            onMouseDown={handleTimelineDragStart}
            onTouchStart={handleTimelineDragStart}
            className={`relative h-14 bg-gray-900/70 border border-gray-700/40 rounded-lg overflow-hidden transition ${
              isPanning ? 'cursor-pointer' : 'cursor-not-allowed opacity-80'
            } ${
              isDraggingTimeline ? 'border-cyan-500/70' : 'hover:border-cyan-500/40'
            }`}
            style={{ userSelect: 'none' }}
          >
            <div className="absolute inset-0 flex items-end px-0 gap-0 pointer-events-none">
              {filteredHistory.map((point, index) => {
                const prevPoint = index > 0 ? filteredHistory[index - 1] : point;
                const directionUp = point.price >= prevPoint.price;
                const height = high > low
                  ? Math.max(10, ((point.price - low) / (high - low)) * 100)
                  : 30;
                return (
                  <div
                    key={`nav-${point.ts}-${index}`}
                    className="flex-1"
                    style={{
                      height: `${height}%`,
                      backgroundColor: directionUp ? 'rgba(59, 130, 246, 0.55)' : 'rgba(239, 68, 68, 0.55)',
                    }}
                  />
                );
              })}
            </div>

            <div className="absolute inset-y-0 left-0 bg-gray-950/55 pointer-events-none" style={{ width: `${navigatorStartPct}%` }} />
            <div
              className="absolute inset-y-0 bg-cyan-500/10 border-y border-cyan-400/60 pointer-events-none"
              style={{ left: `${navigatorStartPct}%`, width: `${navigatorWidthPct}%` }}
            >
              <div className="absolute inset-y-0 left-0 w-1.5 bg-cyan-400/90" />
              <div className="absolute inset-y-0 right-0 w-1.5 bg-cyan-400/90" />
            </div>
            <div
              className="absolute inset-y-0 right-0 bg-gray-950/55 pointer-events-none"
              style={{ width: `${Math.max(0, 100 - navigatorStartPct - navigatorWidthPct)}%` }}
            />

            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-2 pointer-events-none">
              {filteredHistory.length > 0 && (
                <>
                  <span className="text-[10px] text-gray-500 font-mono bg-gray-950/60 px-1 rounded">
                    {formatTimestampByTimeframe(filteredHistory[0].ts)}
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono bg-gray-950/60 px-1 rounded">
                    {formatTimestampByTimeframe(filteredHistory[filteredHistory.length - 1].ts)}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex gap-2 mt-2 text-[10px] text-gray-500">
            <span>Drag navigator • Visible window: {navigatorStartIndex + 1}-{navigatorEndIndex + 1} / {filteredHistory.length}</span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 pt-4 border-t border-gray-800/30">
          <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30 flex items-center justify-center min-h-[64px]">
            <p className="text-lg font-semibold text-cyan-400">${high.toFixed(2)}</p>
          </div>
          <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30 flex items-center justify-center min-h-[64px]">
            <p className="text-lg font-semibold text-red-400">${low.toFixed(2)}</p>
          </div>
          <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30 flex items-center justify-center min-h-[64px]">
            <p className="text-lg font-semibold text-white">{filteredHistory.length}</p>
          </div>
          <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30 flex items-center justify-center min-h-[64px]">
            <p className="text-lg font-semibold text-white">
              {low ? (((high - low) / low) * 100).toFixed(2) : '0.00'}%
            </p>
          </div>
        </div>
      </section>

      {/* Overview Widgets */}
      <section className="grid grid-cols-2 gap-3">
        <div className="bg-gray-900/60 border border-gray-800/50 rounded-xl p-3">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Trend</p>
          <p className={`text-lg font-semibold mt-1 ${isPositive ? 'text-blue-400' : 'text-red-400'}`}>
            {isPositive ? 'Up' : 'Down'}
          </p>
        </div>
        <div className="bg-gray-900/60 border border-gray-800/50 rounded-xl p-3">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Range</p>
          <p className="text-lg font-semibold mt-1 text-white">${(high - low).toFixed(2)}</p>
        </div>
        <div className="bg-gray-900/60 border border-gray-800/50 rounded-xl p-3">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Avg Price</p>
          <p className="text-lg font-semibold mt-1 text-white">${avgPrice.toFixed(2)}</p>
        </div>
        <div className="bg-gray-900/60 border border-gray-800/50 rounded-xl p-3">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Period Span</p>
          <p className="text-lg font-semibold mt-1 text-white">{periodLabel}</p>
        </div>
      </section>
    </div>
  );

  return normalLayout;
}
