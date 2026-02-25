# Backend (FastAPI)

Backend proxy for trading, account, and market-data routes used by the frontend.

## Run

From `backend/`:

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

OpenAPI check:

```bash
curl http://127.0.0.1:8000/openapi.json
```

## Route Prefixes

- REST API: `/api/trading/*`
- Websocket feed: `/ws/stock-data`

## Auth Behavior

- Basic login endpoint creates a session token:
  - `POST /api/trading/auth/basic/login`
- Protected endpoints accept token via:
  - `X-Liquid-Token`
- Session maintenance:
  - `POST /api/trading/auth/basic/ping`
- Logout:
  - `POST /api/trading/auth/basic/logout`

## Common Endpoints

- Market: `/market-data`, `/ohlc`, `/marketdata`
- Orders: `/orders/*`, `/orders/account/*`
- Account: `/account`, `/account/balance`, `/account/positions`, `/account/events`, `/account/metrics`

## Environment

Common variables:
- `POLYGON_API_KEY`
- `POLYGON_SYMBOLS`
- Liquid API config used by `liquid_charts_api.py`

If Polygon is unavailable, startup falls back to Yahoo/simulated feed polling.

## Troubleshooting

### `uvicorn` exits immediately

- Make sure you are running from `backend/`.
- Confirm no existing process owns port `8000`.
- Try stopping old instances before restart:

```powershell
Stop-Process -Name "uvicorn" -Force -ErrorAction SilentlyContinue
cd backend
uvicorn main:app --reload --port 8000
```

### Backend reachable but terminal shows exit code 1

- If `http://127.0.0.1:8000/openapi.json` loads, backend may be running in another terminal/process.
- Check active Python/uvicorn processes and terminate duplicates.
