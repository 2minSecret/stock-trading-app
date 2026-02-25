import React, { useEffect, useMemo, useState } from 'react';
import { useMarketFeed } from '../hooks/MarketFeedProvider';

const STORAGE_KEY = 'demo_portfolio_v1';

function loadPortfolio() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [{ ticker: 'AAPL', qty: 10, avg: 150 }, { ticker: 'TSLA', qty: 2, avg: 650 }];
    return JSON.parse(raw);
  } catch { return []; }
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

export default function PortfolioBar({ accountMetrics }) {
  const { prices } = useMarketFeed();
  const [portfolio, setPortfolio] = useState(() => loadPortfolio());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio));
  }, [portfolio]);

  const summary = useMemo(() => {
    let total = 0, cost = 0;
    for (const h of portfolio) {
      const p = prices[h.ticker]?.price ?? h.avg;
      total += p * h.qty;
      cost += h.avg * h.qty;
    }
    return { total, cost, pl: total - cost };
  }, [portfolio, prices]);

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

  const displayTotal = liveEquity ?? summary.total;
  const displayPnl = livePnl ?? summary.pl;
  const fallbackPct = summary.cost ? ((summary.pl / summary.cost) * 100) : 0;
  const displayPnlPct = livePnlPct ?? fallbackPct;

  return (
    <div className="bg-gradient-to-br from-gray-900 to-gray-950 rounded-2xl p-4 border border-gray-800/50 w-full shadow-lg">
      <div className="flex justify-between items-start pb-3 border-b border-gray-800/30">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Your Holdings</div>
          <div className="text-2xl font-bold text-white">${displayTotal.toFixed(2)}</div>
        </div>
        <div className={`text-right text-sm font-semibold ${displayPnl >= 0 ? 'text-cyan-400' : 'text-red-400'}`}>
          <div>{displayPnl >= 0 ? '↑' : '↓'} ${Math.abs(displayPnl).toFixed(2)}</div>
          <div className="text-xs text-gray-400 font-normal mt-1">{displayPnlPct.toFixed(2)}%</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {portfolio.map(h => {
          const p = prices[h.ticker]?.price ?? h.avg;
          const val = p * h.qty;
          const pl = (p - h.avg) * h.qty;
          const plPct = h.avg ? ((p - h.avg) / h.avg) * 100 : 0;
          return (
            <div key={h.ticker} className="p-3 bg-gray-800/30 rounded-lg border border-gray-700/30 hover:border-gray-600/50 transition duration-200">
              <div className="flex justify-between items-start mb-2">
                <div className="font-semibold text-white text-sm">{h.ticker}</div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-white">${val.toFixed(2)}</div>
                  <div className={`text-xs font-semibold ${pl >= 0 ? 'text-cyan-400' : 'text-red-400'}`}>
                    {pl >= 0 ? '+' : ''}{plPct.toFixed(1)}%
                  </div>
                </div>
              </div>
              <div className="text-xs text-gray-500">
                {h.qty} @ ${h.avg.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
