import asyncio
import json
import os
import random
from typing import Dict, List

import yfinance as yf


async def yahoo_poller(out_queue: asyncio.Queue, symbols: List[str], interval: float = 2.0):
    """
    Polls Yahoo Finance (via `yfinance`) for the latest close/price for each symbol
    and pushes JSON strings into out_queue. Uses `asyncio.to_thread` to call
    synchronous yfinance functions without blocking the event loop.

    - `symbols`: list of tickers (e.g., ['AAPL','TSLA'])
    - `interval`: seconds between polls
    """
    if not symbols:
        return

    use_synthetic = os.getenv("SIMULATE_FEED", "true").lower() in {"1", "true", "yes"}
    last_prices: Dict[str, float] = {}

    while True:
        try:
            for sym in symbols:
                try:
                    # Use yfinance Ticker.history in a thread to avoid blocking
                    def fetch():
                        t = yf.Ticker(sym)
                        # fetch most recent market price from history
                        hist = t.history(period="1d", interval="1m")
                        if not hist.empty:
                            last = hist['Close'].iloc[-1]
                            return float(last)
                        # fallback to fast_info if available
                        fi = getattr(t, 'fast_info', None)
                        if fi and 'last_price' in fi:
                            return float(fi['last_price'])
                        return None

                    price = await asyncio.to_thread(fetch)
                    if price is None and use_synthetic:
                        seed = last_prices.get(sym) or random.uniform(80, 220)
                        drift = random.uniform(-0.003, 0.003)
                        price = max(1.0, seed * (1 + drift))

                    if price is not None:
                        last_prices[sym] = price
                        payload = {"ticker": sym, "price": round(price, 2)}
                        await out_queue.put(json.dumps(payload))

                except Exception:
                    if use_synthetic:
                        seed = last_prices.get(sym) or random.uniform(80, 220)
                        drift = random.uniform(-0.003, 0.003)
                        price = max(1.0, seed * (1 + drift))
                        last_prices[sym] = price
                        payload = {"ticker": sym, "price": round(price, 2)}
                        await out_queue.put(json.dumps(payload))
                    continue

            await asyncio.sleep(interval)

        except asyncio.CancelledError:
            break
        except Exception as e:
            # log and keep running
            print(f"Yahoo poller error: {e}")
            await asyncio.sleep(interval)
