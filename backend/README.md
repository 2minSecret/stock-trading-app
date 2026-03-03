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

## Deploy 24/7 (Render)

This repo now includes production deployment files:

- Docker image config: [backend/Dockerfile](backend/Dockerfile)
- Render service config: [render.yaml](render.yaml)
- Environment template: [backend/.env.example](backend/.env.example)

### Steps

1. Push this repository to GitHub.
2. In Render, click **New +** → **Blueprint**.
3. Select this repo; Render reads [render.yaml](render.yaml) and creates backend service.
4. Wait for deploy to finish.
5. Copy your backend public URL (example: `https://stock-trading-backend.onrender.com`).

### Verify backend is live

Open:

`https://YOUR_RENDER_URL/api/trading`

You should get a JSON success response.

### Connect mobile app to cloud backend

In app Login screen, set **Backend API URL** to:

`https://YOUR_RENDER_URL/api/trading`

After this, your app login works anytime without running backend on your PC.
