# Liquid Charts Integration Guide

This project uses a FastAPI backend proxy and a React frontend.

## Current Architecture

Frontend (React/Vite)  
→ Backend proxy (`/api/trading/*`)  
→ Liquid DXSCA API

The frontend does **not** call Liquid directly.

## Authentication Model (Current)

- Login flow is **Basic Auth session-based**.
- Frontend sends username/domain/password to backend:
  - `POST /api/trading/auth/basic/login`
- Backend returns a session token.
- Frontend sends token on protected requests via `X-Liquid-Token` header.
- Session keep-alive:
  - `POST /api/trading/auth/basic/ping`
- Logout:
  - `POST /api/trading/auth/basic/logout`

Notes:
- The login UI is now login-only.
- Domain is kept behind the scenes in frontend state/storage.

## Key API Routes

Base prefix: `/api/trading`

### Market / Data
- `POST /market-data`
- `POST /ohlc`
- `POST /marketdata` (DXSCA-style market data payload)
- `POST /conversion-rates`

### Orders
- `POST /orders/place`
- `POST /orders/account/place`
- `PUT /orders/account/modify`
- `POST /orders/cancel`
- `DELETE /orders/account/cancel`
- `DELETE /orders/account/cancel-group`
- `GET /orders/{order_id}`
- `GET /orders`
- `GET /orders/history`

### Accounts / Users
- `GET /account`
- `GET /account/balance`
- `GET /account/positions`
- `GET /account/events`
- `GET /account/metrics`

## Local Development

### Backend
From `backend/`:

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend
From `frontend/`:

```bash
npm install
npm run dev
```

## Environment Notes

Backend uses these common vars when available:
- `POLYGON_API_KEY`
- `POLYGON_SYMBOLS`
- Any Liquid endpoint/credential vars used by `liquid_charts_api.py`

If Polygon is not configured, backend falls back to Yahoo/simulated feed logic for websocket updates.

## Troubleshooting

### `401 Unauthorized`
- Ensure you are logged in through `auth/basic/login`.
- Confirm `X-Liquid-Token` is present on protected requests.
- If session expires, login again.

### Backend start issues
- Verify nothing else is bound to port `8000`.
- Check API health quickly with:

```bash
curl http://127.0.0.1:8000/openapi.json
```

### Websocket feed but empty charts
- Verify selected symbol is supported by current feed source.
- Confirm backend websocket route is reachable at `/ws/stock-data`.
