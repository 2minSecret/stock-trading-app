import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { useMarketFeed } from '../hooks/MarketFeedProvider';
import { yahooFinanceClient } from '../services/yahooFinanceClient';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, zoomPlugin);

export default function LiveChart({ ticker = 'SIM:NQ', timeframe = '1h', height = 160, sessionReady = false }) {
  const { history } = useMarketFeed();
  const chartRef = useRef(null);
  const series = history[ticker] || [];
  const [apiSeries, setApiSeries] = useState([]);
  const [apiAuthUnavailable, setApiAuthUnavailable] = useState(false);
  const [xViewRange, setXViewRange] = useState({ min: null, max: null });
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const autoReturnTimerRef = useRef(null);
  const AUTO_RETURN_DELAY_MS = 5000;
  const CHART_RIGHT_PADDING_POINTS = 40;

  useEffect(() => {
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
          const close = row?.close ?? row?.c ?? row?.price ?? row?.last;
          const ts = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
          const price = typeof close === 'number' ? close : Number(close);
          if (!Number.isFinite(ts) || !Number.isFinite(price)) return null;
          return { ts, price };
        })
        .filter(Boolean)
        .sort((a, b) => a.ts - b.ts);
    };

    const fetchCandles = async () => {
      try {
        const response = await yahooFinanceClient.getHistory(ticker, timeframe, 200);
        const normalized = normalizeCandles(response);
        if (mounted) {
          setApiAuthUnavailable(false);
          setApiSeries(normalized);
        }
      } catch (error) {
        console.error('Error fetching Yahoo Finance history:', error);
        if (mounted) {
          setApiSeries([]);
        }
      }
    };

    fetchCandles();
    const timer = setInterval(fetchCandles, 10000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [ticker, timeframe, sessionReady]);

  useEffect(() => {
    const sessionToken = localStorage.getItem('liquid_session_token');
    if (sessionToken) {
      setApiAuthUnavailable(false);
    }
  }, [ticker, timeframe]);

  // Filter data based on timeframe
  const filteredFeedSeries = useMemo(() => {
    if (series.length === 0) return [];

    const now = Date.now();
    const timeframeMs = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
    }[timeframe] || 60 * 60 * 1000;

    const cutoff = now - timeframeMs;
    return series.filter(p => p.ts >= cutoff);
  }, [series, timeframe]);

  const chartSeries = apiSeries.length > 0 ? apiSeries : filteredFeedSeries;
  const paddedChartSeries = useMemo(() => {
    if (chartSeries.length === 0) return [];
    const lastPoint = chartSeries[chartSeries.length - 1];
    const prevPoint = chartSeries.length > 1 ? chartSeries[chartSeries.length - 2] : null;
    const stepMsRaw = prevPoint ? (lastPoint.ts - prevPoint.ts) : 60_000;
    const stepMs = Number.isFinite(stepMsRaw) && stepMsRaw > 0 ? stepMsRaw : 60_000;
    const padding = Array.from({ length: CHART_RIGHT_PADDING_POINTS }, (_, index) => ({
      ts: lastPoint.ts + stepMs * (index + 1),
      price: null,
      isPadding: true,
    }));
    return [...chartSeries, ...padding];
  }, [chartSeries]);
  const followWindowSize = Math.max(30, Math.round(chartSeries.length * 0.35));
  const followLatestRange = useMemo(() => {
    if (chartSeries.length === 0) return { min: null, max: null };
    const latestIndex = chartSeries.length - 1;
    const halfWindow = Math.max(10, Math.floor(followWindowSize / 2));
    const min = latestIndex - halfWindow;
    const max = latestIndex + halfWindow;
    return { min, max };
  }, [chartSeries.length, followWindowSize]);

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
  }, [ticker, timeframe]);

  const data = useMemo(() => {
    const labels = paddedChartSeries.map(p => new Date(p.ts).toLocaleTimeString());
    const values = paddedChartSeries.map(p => (p.isPadding ? null : p.price));
    return {
      labels,
      datasets: [{
        label: ticker,
        data: values,
        borderColor: '#06b6d4',
        backgroundColor: 'rgba(6,182,212,0.08)',
        tension: 0.2,
        pointRadius: 0,
        borderWidth: 2,
      }]
    };
  }, [paddedChartSeries, ticker]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      zoom: {
        zoom: {
          wheel: {
            enabled: true,
            speed: 0.08,
          },
          pinch: {
            enabled: true,
          },
          drag: {
            enabled: true,
            backgroundColor: 'rgba(6, 182, 212, 0.12)',
            borderColor: 'rgba(6, 182, 212, 0.4)',
            borderWidth: 1,
            threshold: 6,
          },
          mode: 'x',
        },
        pan: {
          enabled: true,
          mode: 'x',
          threshold: 2,
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
      },
    },
    scales: { 
      x: {
        display: false,
        ...(Number.isFinite(xViewRange.min) ? { min: xViewRange.min } : {}),
        ...(Number.isFinite(xViewRange.max) ? { max: xViewRange.max } : {}),
      }, 
      y: { display: false } 
    }
  }), [xViewRange.min, xViewRange.max, followLatestRange.min, followLatestRange.max, AUTO_RETURN_DELAY_MS]);

  return (
    <div style={{ height }} className="w-full">
      <Line ref={chartRef} data={data} options={options} />
    </div>
  );
}
