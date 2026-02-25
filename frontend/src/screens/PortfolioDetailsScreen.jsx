import React, { useEffect, useState } from 'react';
import { useMarketFeed } from '../hooks/MarketFeedProvider';
import { Trash2, Plus } from 'lucide-react';

const STORAGE_KEY = 'demo_portfolio_v1';

function loadPortfolio() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [{ ticker: 'AAPL', qty: 10, avg: 150 }, { ticker: 'TSLA', qty: 2, avg: 650 }];
    return JSON.parse(raw);
  } catch { return []; }
}

export default function PortfolioDetailsScreen() {
  const { prices } = useMarketFeed();
  const [portfolio, setPortfolio] = useState(() => loadPortfolio());
  const [newTicker, setNewTicker] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newAvg, setNewAvg] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio));
  }, [portfolio]);

  const addHolding = () => {
    if (newTicker && newQty && newAvg) {
      setPortfolio(prev => [...prev, { ticker: newTicker.toUpperCase(), qty: parseInt(newQty) || 0, avg: parseFloat(newAvg) || 0 }]);
      setNewTicker('');
      setNewQty('');
      setNewAvg('');
    }
  };

  const removeHolding = (ticker) => {
    setPortfolio(prev => prev.filter(h => h.ticker !== ticker));
  };

  // Calculate totals
  let totalValue = 0, totalCost = 0;
  const holdings = portfolio.map(h => {
    const p = prices[h.ticker]?.price ?? h.avg;
    const value = p * h.qty;
    const cost = h.avg * h.qty;
    const pl = value - cost;
    totalValue += value;
    totalCost += cost;
    return { ...h, currentPrice: p, value, cost, pl, plPct: cost > 0 ? (pl / cost) * 100 : 0 };
  });

  const totalPL = totalValue - totalCost;
  const isPositive = totalPL >= 0;

  return (
    <div className="px-5 pb-24 space-y-6 flex flex-col">
      {/* Summary */}
      <section className="bg-gray-900 rounded-3xl p-5 border border-gray-800">
        <h3 className="text-xs text-gray-400 mb-2">Total Portfolio Value</h3>
        <h2 className="text-3xl font-bold">${totalValue.toFixed(2)}</h2>
        <div className={`flex items-center gap-2 mt-3 text-sm font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
          <span>{isPositive ? '+' : ''}${totalPL.toFixed(2)}</span>
          <span className="text-xs text-gray-400">({isPositive ? '+' : ''}{(totalPL / (totalCost || 1) * 100).toFixed(2)}%)</span>
        </div>
      </section>

      {/* Holdings List */}
      <section className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
        <h4 className="text-sm font-semibold mb-3">Holdings</h4>
        <div className="flex flex-col gap-3">
          {holdings.length === 0 && <div className="text-gray-500 text-sm">No holdings yet</div>}
          {holdings.map(h => (
            <div key={h.ticker} className="p-3 bg-gray-800 rounded-xl flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h5 className="font-semibold">{h.ticker}</h5>
                  <span className="text-xs text-gray-400">({h.qty} @ ${h.avg.toFixed(2)})</span>
                </div>
                <div className="text-xs text-gray-400">Current: ${h.currentPrice.toFixed(2)}</div>
              </div>
              <div className="text-right flex flex-col items-end gap-1">
                <div className="font-semibold">${h.value.toFixed(2)}</div>
                <div className={`text-xs font-medium ${h.pl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {h.pl >= 0 ? '+' : ''}${h.pl.toFixed(2)} ({h.plPct.toFixed(1)}%)
                </div>
                <button
                  onClick={() => removeHolding(h.ticker)}
                  className="mt-1 p-1 hover:bg-red-900/30 rounded text-red-400 transition"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Add new holding form */}
      <section className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Plus size={16} /> Add Holding
        </h4>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            placeholder="Ticker (e.g. TSLA)"
            value={newTicker}
            onChange={(e) => setNewTicker(e.target.value)}
            className="bg-gray-800 text-white px-3 py-2 rounded text-sm placeholder-gray-500 border border-gray-700"
          />
          <input
            type="number"
            placeholder="Quantity"
            value={newQty}
            onChange={(e) => setNewQty(e.target.value)}
            className="bg-gray-800 text-white px-3 py-2 rounded text-sm placeholder-gray-500 border border-gray-700"
          />
          <input
            type="number"
            placeholder="Avg Price"
            value={newAvg}
            onChange={(e) => setNewAvg(e.target.value)}
            step="0.01"
            className="bg-gray-800 text-white px-3 py-2 rounded text-sm placeholder-gray-500 border border-gray-700"
          />
          <button
            onClick={addHolding}
            className="bg-blue-600 hover:bg-blue-500 text-white py-2 rounded font-semibold transition text-sm mt-2"
          >
            Add
          </button>
        </div>
      </section>
    </div>
  );
}
