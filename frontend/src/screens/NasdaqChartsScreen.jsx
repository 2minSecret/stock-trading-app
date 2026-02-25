import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useMarketFeed } from '../hooks/MarketFeedProvider';

export default function NasdaqChartsScreen() {
  const { prices, history } = useMarketFeed();

  // Get Nasdaq (use a specific ticker we know is in the feed, or aggregate)
  const nasdaqData = prices['SIM:NQ'] || prices['AAPL'] || { price: 0 };
  const nasdaqHistory = history['SIM:NQ'] || history['AAPL'] || [];

  const prev = nasdaqHistory.length > 1 
    ? nasdaqHistory[nasdaqHistory.length - 2].price 
    : nasdaqData.price;
  const change = nasdaqData.price - prev;
  const pct = prev ? (change / prev) * 100 : 0;
  const isPositive = change >= 0;

  return (
    <div className="px-5 pb-24 space-y-6 flex flex-col">
      {/* Header */}
      <section className="mt-3">
        <h1 className="text-3xl font-bold text-white">NASDAQ 100</h1>
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mt-2\">Index Tracking</p>
      </section>

      {/* Price Card */}
      <section className="bg-gradient-to-br from-cyan-900/20 to-teal-900/20 rounded-2xl p-6 border border-cyan-800/30 shadow-lg">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-5xl font-bold text-white">${nasdaqData.price.toFixed(2)}</h2>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mt-3">Live Index Price</p>
          </div>
          <div className={`text-right ${isPositive ? 'text-cyan-400' : 'text-red-400'}`}>
            <div className="flex items-center gap-2 justify-end mb-2">
              {isPositive ? <TrendingUp size={24} /> : <TrendingDown size={24} />}
            </div>
            <p className="text-2xl font-bold">{isPositive ? '+' : ''}{change.toFixed(2)}</p>
            <p className="text-sm font-semibold">{isPositive ? '+' : ''}{pct.toFixed(2)}%</p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 pt-4 border-t border-cyan-800/20">
          <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30 flex items-center justify-center min-h-[64px]">
            <p className="text-lg font-semibold text-white">—</p>
          </div>
          <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30 flex items-center justify-center min-h-[64px]">
            <p className="text-lg font-semibold text-white">—</p>
          </div>
          <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30 flex items-center justify-center min-h-[64px]">
            <p className="text-lg font-semibold text-white">—</p>
          </div>
          <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30 flex items-center justify-center min-h-[64px]">
            <p className="text-lg font-semibold text-white">—</p>
          </div>
        </div>
      </section>

      {/* Performance */}
      <section className="bg-gradient-to-br from-gray-900 to-gray-950 rounded-2xl p-4 border border-gray-800/50 shadow-lg">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">Performance Metrics</h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center p-3 bg-gray-800/30 rounded-lg border border-gray-700/30">
            <span className="text-gray-400 text-sm">1D Change</span>
            <span className={isPositive ? 'text-cyan-400 font-semibold text-sm' : 'text-red-400 font-semibold text-sm'}>
              {isPositive ? '+' : ''}{pct.toFixed(2)}%
            </span>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-800/30 rounded-lg border border-gray-700/30">
            <span className="text-gray-400 text-sm">1W Change</span>
            <span className="text-gray-400 font-semibold text-sm">—</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-800/30 rounded-lg border border-gray-700/30">
            <span className="text-gray-400 text-sm">1M Change</span>
            <span className="text-gray-400 font-semibold text-sm">—</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-800/30 rounded-lg border border-gray-700/30">
            <span className="text-gray-400 text-sm">1Y Change</span>
            <span className="text-gray-400 font-semibold text-sm">—</span>
          </div>
        </div>
      </section>

      {/* Index Composition */}
      <section className="bg-gradient-to-br from-gray-900 to-gray-950 rounded-2xl p-4 border border-gray-800/50 shadow-lg">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">Top Holdings</h3>
        <div className="space-y-2">
          <div className="flex justify-between items-center p-3 bg-gray-800/30 rounded-lg border border-gray-700/30">
            <span className="text-gray-400 text-sm font-medium">AAPL</span>
            <span className="text-cyan-400 font-semibold">12.5%</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-800/30 rounded-lg border border-gray-700/30">
            <span className="text-gray-400 text-sm font-medium">MSFT</span>
            <span className="text-cyan-400 font-semibold">10.8%</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-800/30 rounded-lg border border-gray-700/30">
            <span className="text-gray-400 text-sm font-medium">TSLA</span>
            <span className="text-cyan-400 font-semibold">8.2%</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-800/30 rounded-lg border border-gray-700/30">
            <span className="text-gray-400 text-sm font-medium">NVDA</span>
            <span className="text-cyan-400 font-semibold">7.5%</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-800/30 rounded-lg border border-gray-700/30">
            <span className="text-gray-400 text-sm font-medium">AMZN</span>
            <span className="text-cyan-400 font-semibold">6.9%</span>
          </div>
        </div>
      </section>
    </div>
  );
}
