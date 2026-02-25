import React, { useState, useMemo } from 'react';
import { useMarketFeed } from '../hooks/MarketFeedProvider';
import { Search, TrendingUp, TrendingDown } from 'lucide-react';

export default function MarketsDetailsScreen() {
  const { prices, history } = useMarketFeed();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name'); // name, price, change

  const tickers = useMemo(() => {
    let list = Object.keys(prices).map(t => {
      const p = prices[t];
      const hist = history[t] || [];
      const prev = hist.length > 1 ? hist[hist.length - 2].price : p.price;
      const change = p.price - prev;
      const pct = prev ? (change / prev) * 100 : 0;
      return { ticker: t, price: p.price, change, pct, prev };
    });

    // Filter by search
    if (searchTerm) {
      list = list.filter(x => x.ticker.toUpperCase().includes(searchTerm.toUpperCase()));
    }

    // Sort
    if (sortBy === 'price') {
      list.sort((a, b) => b.price - a.price);
    } else if (sortBy === 'change') {
      list.sort((a, b) => b.pct - a.pct);
    } else {
      list.sort((a, b) => a.ticker.localeCompare(b.ticker));
    }

    return list;
  }, [prices, history, searchTerm, sortBy]);

  return (
    <div className="px-5 pb-24 space-y-4 flex flex-col">
      {/* Header */}
      <section className="bg-gray-900 rounded-2xl p-4 border border-gray-800 h-fit">
        <h3 className="text-sm font-semibold mb-3">Markets Overview</h3>
        <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
          <Search size={16} className="text-gray-400" />
          <input
            type="text"
            placeholder="Search ticker..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-transparent text-white text-sm flex-1 placeholder-gray-500 outline-none"
          />
        </div>
      </section>

      {/* Sort buttons */}
      <div className="flex gap-2 justify-center">
        <button
          onClick={() => setSortBy('name')}
          className={`px-3 py-1 text-xs rounded transition ${sortBy === 'name' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
        >
          Name
        </button>
        <button
          onClick={() => setSortBy('price')}
          className={`px-3 py-1 text-xs rounded transition ${sortBy === 'price' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
        >
          Price
        </button>
        <button
          onClick={() => setSortBy('change')}
          className={`px-3 py-1 text-xs rounded transition ${sortBy === 'change' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
        >
          Change %
        </button>
      </div>

      {/* Tickers list */}
      <section className="bg-gray-900 rounded-2xl p-4 border border-gray-800 max-h-[60vh] overflow-y-auto">
        <div className="flex flex-col gap-3">
          {tickers.length === 0 && <div className="text-gray-500 text-sm text-center py-4">No data yet</div>}
          {tickers.map(t => {
            const isPos = t.pct >= 0;
            return (
              <div key={t.ticker} className="p-3 bg-gray-800 rounded-lg flex justify-between items-center hover:bg-gray-750 transition">
                <div className="flex-1">
                  <h5 className="font-semibold text-sm">{t.ticker}</h5>
                  <div className="text-xs text-gray-400 mt-1">
                    24h: ${t.price.toFixed(2)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-sm">${t.price.toFixed(2)}</div>
                  <div className={`flex items-center gap-1 text-xs font-medium mt-1 ${isPos ? 'text-green-400' : 'text-red-400'}`}>
                    {isPos ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    <span>{isPos ? '+' : ''}{t.pct.toFixed(2)}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
