import React, { useState, useEffect } from 'react';
import { useMarketFeed } from '../hooks/MarketFeedProvider';

export default function MarketsPanel({ maxRows = 8 }) {
  const { prices, history } = useMarketFeed();
  const tickers = Object.keys(prices);
  const [selectedTicker, setSelectedTicker] = useState('');

  // Auto-select first ticker or NAS100 if available
  useEffect(() => {
    if (tickers.length > 0 && !selectedTicker) {
      const defaultTicker = tickers.includes('NAS100') ? 'NAS100' : tickers[0];
      setSelectedTicker(defaultTicker);
    }
  }, [tickers, selectedTicker]);

  const getTickerData = (ticker) => {
    if (!ticker || !prices[ticker]) return null;
    
    const p = prices[ticker];
    const hist = history[ticker] || [];
    const prev = hist.length > 1 ? hist[hist.length - 2].price : p.price;
    const change = p.price - prev;
    const pct = prev ? (change / prev) * 100 : 0;
    const isPos = change >= 0;
    
    return { price: p.price, change, pct, isPos };
  };

  const tickerData = getTickerData(selectedTicker);

  return (
    <section className="bg-gradient-to-br from-gray-900 to-gray-950 rounded-2xl p-4 border border-gray-800/50 shadow-lg">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">Market Overview</h4>
      
      {tickers.length === 0 ? (
        <div className="text-gray-500 text-xs py-4 text-center">Waiting for market data...</div>
      ) : (
        <div className="space-y-4">
          {/* Ticker Selector */}
          <div>
            <label className="block text-xs text-gray-500 font-medium uppercase tracking-wider mb-2">
              Select Market
            </label>
            <select
              value={selectedTicker}
              onChange={(e) => setSelectedTicker(e.target.value)}
              className="w-full bg-gray-800/40 border border-gray-700/50 text-white text-sm rounded-lg px-3 py-2.5 cursor-pointer hover:border-cyan-500/50 focus:border-cyan-500 focus:outline-none transition duration-200 font-medium"
            >
              {tickers.map(ticker => (
                <option key={ticker} value={ticker}>
                  {ticker}
                </option>
              ))}
            </select>
          </div>

          {/* Selected Ticker Details */}
          {tickerData && (
            <div className="p-4 rounded-lg bg-gray-800/30 border border-gray-700/30">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="text-lg font-bold text-white">{selectedTicker}</div>
                  <div className="text-xs text-gray-500 font-medium mt-1">Live Price</div>
                </div>
                <div className={`text-right text-sm font-semibold ${tickerData.isPos ? 'text-cyan-400' : 'text-red-400'}`}>
                  <div className="text-xs uppercase tracking-wider font-medium text-gray-500 mb-1">Change</div>
                  <div className="text-lg">{tickerData.isPos ? '↑' : '↓'} {Math.abs(tickerData.pct).toFixed(2)}%</div>
                </div>
              </div>
              
              <div className="flex justify-between items-center pt-3 border-t border-gray-700/30">
                <div className="text-2xl font-bold text-white">
                  {isNaN(tickerData.price) ? '—' : `$${tickerData.price.toFixed(2)}`}
                </div>
                <div className={`text-sm font-semibold ${tickerData.isPos ? 'text-cyan-400' : 'text-red-400'}`}>
                  {tickerData.isPos ? '+' : ''}{tickerData.change.toFixed(2)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
