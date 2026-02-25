import React, { useEffect, useMemo, useState } from 'react';
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
import { useMarketFeed } from '../hooks/MarketFeedProvider';
import { yahooFinanceClient } from '../services/yahooFinanceClient';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

export default function LiveChart({ ticker = 'SIM:NQ', timeframe = '1h', height = 160, sessionReady = false }) {
  const { history } = useMarketFeed();
  const series = history[ticker] || [];
  const [apiSeries, setApiSeries] = useState([]);
  const [apiAuthUnavailable, setApiAuthUnavailable] = useState(false);

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

  const data = useMemo(() => {
    const labels = chartSeries.map(p => new Date(p.ts).toLocaleTimeString());
    const values = chartSeries.map(p => p.price);
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
  }, [chartSeries, ticker]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { 
      x: { display: false }, 
      y: { display: false } 
    }
  }), []);

  return (
    <div style={{ height }} className="w-full">
      <Line data={data} options={options} />
    </div>
  );
}
