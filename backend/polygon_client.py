import asyncio
import json
import os
import websockets
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv("POLYGON_API_KEY")

async def polygon_listener(out_queue: asyncio.Queue, symbols: list[str] | None = None):
    """
    Connects to Polygon.io WebSocket and pushes raw messages into out_queue.
    If POLYGON_API_KEY is not set, this coroutine returns immediately.
    """
    if not API_KEY:
        print("POLYGON_API_KEY not set — polygon_listener will not run")
        return

    url = "wss://socket.polygon.io/stocks"
    backoff = 1
    while True:
        try:
            async with websockets.connect(url) as ws:
                # Authenticate
                auth = {"action": "auth", "params": API_KEY}
                await ws.send(json.dumps(auth))

                # Subscribe to provided symbols (e.g., ['AAPL','TSLA']) as trades
                if symbols:
                    params = ",".join(f"T.{s}" for s in symbols)
                    sub = {"action": "subscribe", "params": params}
                    await ws.send(json.dumps(sub))

                # Read loop
                async for msg in ws:
                    # Push raw JSON string to the out_queue
                    await out_queue.put(msg)

        except Exception as e:
            print(f"Polygon websocket error: {e}. Reconnecting in {backoff}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)
