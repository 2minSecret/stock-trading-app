from dotenv import load_dotenv
load_dotenv()  # MUST be called before importing modules that use os.getenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import random
import json
import os

from polygon_client import polygon_listener
from yahoo_client import yahoo_poller
from trading_routes import router as trading_router
from bot_routes import router as bot_router
print("STARTUP: FastAPI app being created")
app = FastAPI()
print("STARTUP: FastAPI app created successfully")

frontend_origins_env = os.getenv("FRONTEND_ORIGINS", "")
frontend_origins = [origin.strip() for origin in frontend_origins_env.split(",") if origin.strip()]

# Allow React front-end to communicate with this back-end
app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins or [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
print("STARTUP: CORS middleware added")

# Include trading routes for Liquid Charts API
app.include_router(trading_router, prefix="/api/trading")
# Include bot control routes
app.include_router(bot_router, prefix="/api/trading")

connected_clients: dict[WebSocket, asyncio.Queue] = {}
polygon_queue: asyncio.Queue | None = None


async def broadcaster():
    """Takes messages from polygon_queue and fans out to client queues."""
    global polygon_queue, connected_clients
    if polygon_queue is None:
        return
    while True:
        msg = await polygon_queue.get()
        to_remove = []
        for ws, q in list(connected_clients.items()):
            try:
                await q.put(msg)
            except Exception:
                to_remove.append(ws)
        for ws in to_remove:
            connected_clients.pop(ws, None)


@app.websocket("/ws/stock-data")
async def stock_data_endpoint(websocket: WebSocket):
    await websocket.accept()
    client_queue: asyncio.Queue = asyncio.Queue()
    connected_clients[websocket] = client_queue
    try:
        while True:
            # Wait for next message for this client
            msg = await client_queue.get()
            # Forward raw message to client
            await websocket.send_text(msg)

    except WebSocketDisconnect:
        pass
    finally:
        connected_clients.pop(websocket, None)

@app.on_event("startup")
async def startup_event():
    """Create polygon queue and start listener + broadcaster.

    If `POLYGON_API_KEY` is not set, a simple simulator will populate the queue.
    """
    global polygon_queue
    polygon_queue = asyncio.Queue()

    # Start broadcaster
    asyncio.create_task(broadcaster())

    # Start polygon listener if API key is configured, else start simulator
    api_key = os.getenv("POLYGON_API_KEY")
    if api_key:
        symbols_env = os.getenv("POLYGON_SYMBOLS", "AAPL,TSLA,MSFT,GOOGL,AMZN,NVDA,META,NFLX")
        symbols = [s.strip().upper() for s in symbols_env.split(",") if s.strip()]
        asyncio.create_task(polygon_listener(polygon_queue, symbols))
        print(f"Started Polygon listener for: {symbols}")
    else:
        # Use Yahoo Finance for testing by polling yfinance
        # Include all chart tickers: NAS100 (use ^IXIC), and popular stocks
        symbols_env = os.getenv("POLYGON_SYMBOLS", "^IXIC,AAPL,TSLA,MSFT,GOOGL,AMZN,NVDA,META,NFLX")
        symbols = [s.strip().upper() for s in symbols_env.split(",") if s.strip()]
        asyncio.create_task(yahoo_poller(polygon_queue, symbols, interval=2.0))
        print(f"Started Yahoo poller for: {symbols}")

# To run: uvicorn main:app --reload