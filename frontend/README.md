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
