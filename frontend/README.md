# Stock Trading App Frontend

React + Vite frontend for the Liquid-integrated trading app.

## Authentication Flow

- Login is **Liquid Basic Auth only**.
- Users sign in with `email` and `password`.
- The Liquid `domain` value is kept **behind the scenes** (not shown in the UI) and sent by the client during login.
- OAuth and registration screens are removed from the app flow.

## Local Session Storage

- `user`: signed-in UI user profile.
- `liquid_session_token`: active Liquid Basic session token.
- `liquid_domain`: hidden/default Liquid domain used by login.

## Development

From `frontend/`:

```bash
npm install
npm run dev
```

Default Vite dev server: `http://localhost:5173`

## Backend Requirement

The frontend expects the backend API to be available (default: `http://127.0.0.1:8000`) for auth, account data, orders, and market data routes.

## Android APK Login (Real Phone)

When installed on a real phone, `localhost` is the phone itself (not your PC), so the app must target your backend by LAN IP.

1. Run backend on your PC and bind it to all interfaces:

	```bash
	uvicorn main:app --host 0.0.0.0 --port 8001
	```

2. Set frontend API URL before building APK:

	```bash
	VITE_LIQUID_API_URL=http://<YOUR_PC_LAN_IP>:8001/api/trading
	```

3. Rebuild frontend + APK and install the new APK.

Notes:
- Login UI uses only `email` + `password`; Liquid `domain` is hidden and defaults behind the scenes.
- Android manifest in this project allows cleartext HTTP so LAN `http://` backend URLs work in development.

## Runtime API Base Override

The app supports a runtime override stored in `localStorage` key `liquid_api_base_url_v1`.

- This override now takes precedence over build-time `VITE_LIQUID_API_URL`.
- Useful when your LAN IP changes and you do not want to rebuild immediately.

Example value:

`http://192.168.1.25:8001/api/trading`
