"""
Liquid Charts REST API Integration
Documentation: https://liquid-charts.gitbook.io/liquid-charts-api-docs

This module provides secure integration with Liquid Charts API.
API keys should be stored in environment variables.
"""

import os
import httpx
import asyncio
import json
import logging
from typing import Optional, Dict, Any
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()

# Configuration
LIQUID_API_BASE = os.getenv("LIQUID_API_URL", "https://api.liquidcharts.com/v1")
LIQUID_API_KEY = os.getenv("LIQUID_API_KEY")
LIQUID_API_SECRET = os.getenv("LIQUID_API_SECRET")
LIQUID_METRICS_BASE = os.getenv("LIQUID_METRICS_BASE_URL", "https://api.liquidcharts.com")
LIQUID_BASIC_AUTH_HEADER = os.getenv("LIQUID_BASIC_AUTH_HEADER", "Authorization")
LIQUID_BASIC_AUTH_PREFIX = os.getenv("LIQUID_BASIC_AUTH_PREFIX", "")

# Async HTTP client - lazy initialized to avoid SSL hang on Windows
_client = None

def get_client():
    """Get or create the async HTTP client."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=LIQUID_API_BASE,
            headers={
                "Content-Type": "application/json",
                "X-API-Key": LIQUID_API_KEY or "",
            },
            timeout=30.0  # Increase timeout to 30 seconds for slow endpoints
        )
    return _client


class LiquidChartsAPI:
    """Liquid Charts API Client"""

    @staticmethod
    def _basic_headers(token: str) -> Dict[str, Any]:
        value = f"{LIQUID_BASIC_AUTH_PREFIX}{token}" if LIQUID_BASIC_AUTH_PREFIX else token
        headers: Dict[str, Any] = {LIQUID_BASIC_AUTH_HEADER: value}
        if LIQUID_BASIC_AUTH_HEADER.lower() != "authorization":
            headers["Authorization"] = value
        # Compatibility header used by some clients; safe to include
        headers["X-Liquid-Token"] = token
        return headers

    @staticmethod
    async def _dxsca_request_with_basic_retry(
        method: str,
        url: str,
        token: str,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
    ) -> httpx.Response:
        """Perform a dxsca-web request and retry once with DXAPI prefix if needed.

        If LIQUID_BASIC_AUTH_PREFIX is explicitly set, no retry is performed.
        """
        explicit_prefix = bool(LIQUID_BASIC_AUTH_PREFIX)
        prefixes = [LIQUID_BASIC_AUTH_PREFIX] if explicit_prefix else ["", "DXAPI "]

        last_error: Optional[httpx.HTTPStatusError] = None
        for prefix in prefixes:
            headers = LiquidChartsAPI._basic_headers(token) if prefix == LIQUID_BASIC_AUTH_PREFIX else {
                LIQUID_BASIC_AUTH_HEADER: f"{prefix}{token}",
                "Authorization": f"{prefix}{token}",
                "X-Liquid-Token": token,
            }

            response = await get_client().request(method, url, params=params, json=json_body, headers=headers)
            try:
                response.raise_for_status()
                return response
            except httpx.HTTPStatusError as e:
                last_error = e
                if e.response.status_code not in (401, 403) or explicit_prefix:
                    break

        if last_error:
            raise last_error
        raise httpx.HTTPStatusError("dxsca request failed", request=None, response=None)

    @staticmethod
    def _auth_headers(token: Optional[str] = None, auth_type: str = "bearer") -> Dict[str, Any]:
        headers: Dict[str, Any] = {}
        if token:
            if auth_type == "basic":
                headers.update(LiquidChartsAPI._basic_headers(token))
            else:
                headers["Authorization"] = f"Bearer {token}"
        return headers

    # ===== Authentication =====
    @staticmethod
    async def login(email: str, password: str) -> Dict[str, Any]:
        """Login to Liquid Charts account"""
        try:
            response = await get_client().post("/auth/login", json={"email": email, "password": password})
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            print(f"Login error: {e}")
            raise

    @staticmethod
    async def logout(token: str) -> Dict[str, Any]:
        """Logout from account"""
        try:
            response = await get_client().post(
                "/auth/logout",
                headers={"Authorization": f"Bearer {token}"}
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            print(f"Logout error: {e}")
            raise

    @staticmethod
    async def basic_login(username: str, domain: str, password: str) -> Dict[str, Any]:
        """Create a Basic Auth session token"""
        try:
            response = await get_client().post(
                f"{LIQUID_METRICS_BASE}/dxsca-web/login",
                json={"username": username, "domain": domain, "password": password}
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            print(f"Basic login error: {e}")
            raise

    @staticmethod
    async def basic_logout(token: str) -> Dict[str, Any]:
        """Logout from Basic Auth session"""
        try:
            response = await LiquidChartsAPI._dxsca_request_with_basic_retry(
                "POST",
                f"{LIQUID_METRICS_BASE}/dxsca-web/logout",
                token=token,
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            print(f"Basic logout error: {e}")
            raise

    @staticmethod
    async def basic_ping(token: str) -> Dict[str, Any]:
        """Keep Basic Auth session alive"""
        try:
            response = await LiquidChartsAPI._dxsca_request_with_basic_retry(
                "POST",
                f"{LIQUID_METRICS_BASE}/dxsca-web/ping",
                token=token,
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code not in (401, 403):
                print(f"Basic ping error: {e}")
            raise
        except httpx.HTTPError as e:
            print(f"Basic ping error: {e}")
            raise

    # ===== Market Data =====
    @staticmethod
    async def get_market_data(symbol: str, market: str = "spot") -> Dict[str, Any]:
        """Get current market data for a symbol"""
        try:
            response = await get_client().post(
                "/market-data",
                json={"symbols": [symbol], "market": market}
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            print(f"Market data error: {e}")
            raise

    @staticmethod
    async def post_market_data(
        request_payload: Dict[str, Any],
        token: Optional[str] = None,
        auth_type: str = "basic",
    ) -> Dict[str, Any]:
        """Request current or historical market data via dxsca-web/marketdata."""
        try:
            print(f"DEBUG: post_market_data payload: {json.dumps(request_payload)}")
            if auth_type == "basic" and token:
                response = await LiquidChartsAPI._dxsca_request_with_basic_retry(
                    "POST",
                    f"{LIQUID_METRICS_BASE}/dxsca-web/marketdata",
                    token=token,
                    json_body=request_payload,
                )
            else:
                headers = LiquidChartsAPI._auth_headers(token, auth_type)
                response = await get_client().post(
                    f"{LIQUID_METRICS_BASE}/dxsca-web/marketdata",
                    json=request_payload,
                    headers=headers,
                )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code not in (401, 403):
                print(f"ERROR: dxsca market data HTTP {e.response.status_code}: {e}")
                try:
                    error_detail = e.response.json()
                except Exception:
                    error_detail = e.response.text
                print(f"ERROR: Response body: {error_detail}")
            raise
        except httpx.HTTPError as e:
            print(f"dxsca market data error: {e}")
            raise

    @staticmethod
    async def get_conversion_rates(
        to_currency: str,
        from_currency: Optional[str] = None,
        token: Optional[str] = None,
        auth_type: str = "basic",
    ) -> Dict[str, Any]:
        """Get conversion rates via dxsca-web/conversionRates endpoint."""
        try:
            headers = LiquidChartsAPI._auth_headers(token, auth_type)
            params: Dict[str, Any] = {"toCurrency": to_currency}
            if from_currency:
                params["fromCurrency"] = from_currency

            response = await get_client().post(
                f"{LIQUID_METRICS_BASE}/dxsca-web/conversionRates",
                params=params,
                headers=headers,
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            print(f"conversion rates error: {e}")
            raise

    @staticmethod
    async def get_ohlc(
        symbol: str,
        timeframe: str = "1h",
        limit: int = 100,
        token: Optional[str] = None,
        auth_type: str = "basic"
    ) -> Dict[str, Any]:
        """Get historical OHLC data for a symbol"""
        try:
            headers = LiquidChartsAPI._auth_headers(token, auth_type)

            response = await get_client().get(
                "/price-history",
                params={"symbol": symbol, "timeframe": timeframe, "limit": limit},
                headers=headers
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            print(f"OHLC data error: {e}")
            raise

    # ===== Trading =====
    @staticmethod
    async def place_order(
        symbol: str,
        side: str,  # 'buy' or 'sell'
        quantity: float,
        order_type: str = "limit",
        price: Optional[float] = None,
        stop_price: Optional[float] = None,
        time_in_force: str = "GTC",
        token: Optional[str] = None
    ) -> Dict[str, Any]:
        """Place a new order"""
        try:
            order_data = {
                "symbol": symbol,
                "side": side,
                "type": order_type,
                "quantity": quantity,
                "timeInForce": time_in_force,
            }

            if price is not None:
                order_data["price"] = price

            if stop_price is not None:
                order_data["stopPrice"] = stop_price

            headers = {}
            if token:
                headers["Authorization"] = f"Bearer {token}"

            response = await get_client().post("/orders", json=order_data, headers=headers)
            response.raise_for_status()
            return response.json()

        except httpx.HTTPError as e:
            print(f"Place order error: {e}")
            raise

    @staticmethod
    async def place_account_order(
        account_code: str,
        order_payload: Dict[str, Any],
        token: Optional[str] = None,
        auth_type: str = "basic",
    ) -> Dict[str, Any]:
        """Place an order on a specific account via dxsca-web accounts API."""
        try:
            headers = {}
            if token:
                if auth_type == "basic":
                    headers.update(LiquidChartsAPI._basic_headers(token))
                else:
                    headers["Authorization"] = f"Bearer {token}"

            response = await get_client().post(
                f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/orders",
                json=order_payload,
                headers=headers,
            )
            response.raise_for_status()
            return response.json()

        except httpx.HTTPError as e:
            print(f"Place account order error: {e}")
            raise

    @staticmethod
    async def modify_account_order(
        account_code: str,
        order_payload: Dict[str, Any],
        if_match: str,
        token: Optional[str] = None,
        auth_type: str = "basic",
    ) -> Dict[str, Any]:
        """Modify an order on a specific account via dxsca-web accounts API using conditional updates."""
        try:
            headers = {"If-Match": if_match}
            if token:
                if auth_type == "basic":
                    headers.update(LiquidChartsAPI._basic_headers(token))
                else:
                    headers["Authorization"] = f"Bearer {token}"

            response = await get_client().put(
                f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/orders",
                json=order_payload,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()
            etag = response.headers.get("ETag")
            if etag:
                data["_etag"] = etag
            return data

        except httpx.HTTPError as e:
            print(f"Modify account order error: {e}")
            raise

    @staticmethod
    async def cancel_account_order(
        account_code: str,
        order_code: str,
        if_match: str,
        token: Optional[str] = None,
        auth_type: str = "basic",
    ) -> Dict[str, Any]:
        """Cancel a single order on a specific account via dxsca-web accounts API."""
        try:
            headers = {"If-Match": if_match}
            if token:
                if auth_type == "basic":
                    headers.update(LiquidChartsAPI._basic_headers(token))
                else:
                    headers["Authorization"] = f"Bearer {token}"

            response = await get_client().delete(
                f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/orders/{order_code}",
                headers=headers,
            )
            response.raise_for_status()
            return response.json()

        except httpx.HTTPError as e:
            print(f"Cancel account order error: {e}")
            raise

    @staticmethod
    async def cancel_account_order_group(
        account_code: str,
        order_codes: str,
        contingency_type: str,
        if_match: str,
        token: Optional[str] = None,
        auth_type: str = "basic",
    ) -> Dict[str, Any]:
        """Cancel an order group on a specific account via dxsca-web accounts API."""
        try:
            headers = {"If-Match": if_match}
            if token:
                if auth_type == "basic":
                    headers.update(LiquidChartsAPI._basic_headers(token))
                else:
                    headers["Authorization"] = f"Bearer {token}"

            response = await get_client().delete(
                f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/orders/group",
                params={
                    "order-codes": order_codes,
                    "contingency-type": contingency_type,
                },
                headers=headers,
            )
            response.raise_for_status()
            return response.json()

        except httpx.HTTPError as e:
            print(f"Cancel account order group error: {e}")
            raise

    @staticmethod
    async def cancel_order(order_id: str, token: Optional[str] = None) -> Dict[str, Any]:
        """Cancel an existing order"""
        try:
            headers = {}
            if token:
                headers["Authorization"] = f"Bearer {token}"

            response = await get_client().delete(f"/orders/{order_id}", headers=headers)
            response.raise_for_status()
            return response.json()

        except httpx.HTTPError as e:
            print(f"Cancel order error: {e}")
            raise

    @staticmethod
    async def get_order(order_id: str, token: Optional[str] = None) -> Dict[str, Any]:
        """Get order details"""
        try:
            headers = {}
            if token:
                headers["Authorization"] = f"Bearer {token}"

            response = await get_client().get(f"/orders/{order_id}", headers=headers)
            response.raise_for_status()
            return response.json()

        except httpx.HTTPError as e:
            print(f"Get order error: {e}")
            raise

    @staticmethod
    async def get_orders(token: Optional[str] = None, filters: Optional[Dict] = None) -> Dict[str, Any]:
        """Get all active orders"""
        try:
            headers = {}
            if token:
                headers["Authorization"] = f"Bearer {token}"

            response = await get_client().get("/orders", params=filters or {}, headers=headers)
            response.raise_for_status()
            return response.json()

        except httpx.HTTPError as e:
            print(f"Get orders error: {e}")
            raise

    @staticmethod
    async def get_order_history(token: Optional[str] = None, filters: Optional[Dict] = None) -> Dict[str, Any]:
        """Get order history"""
        try:
            headers = {}
            if token:
                headers["Authorization"] = f"Bearer {token}"

            response = await get_client().get("/orders/history", params=filters or {}, headers=headers)
            response.raise_for_status()
            return response.json()

        except httpx.HTTPError as e:
            print(f"Get order history error: {e}")
            raise

    # ===== Account =====
    @staticmethod
    async def get_account_info(token: Optional[str] = None) -> Dict[str, Any]:
        """Get account information"""
        try:
            headers = {}
            if token:
                headers["Authorization"] = f"Bearer {token}"

            response = await get_client().get("/account", headers=headers)
            response.raise_for_status()
            return response.json()

        except httpx.HTTPError as e:
            print(f"Get account info error: {e}")
            raise

    @staticmethod
    async def get_balance(token: Optional[str] = None) -> Dict[str, Any]:
        """Get account balance"""
        try:
            headers = {}
            if token:
                headers["Authorization"] = f"Bearer {token}"

            response = await get_client().get("/account/balance", headers=headers)
            response.raise_for_status()
            return response.json()

        except httpx.HTTPError as e:
            print(f"Get balance error: {e}")
            raise

    @staticmethod
    async def get_positions(token: Optional[str] = None) -> Dict[str, Any]:
        """Get current positions"""
        try:
            headers = {}
            if token:
                headers["Authorization"] = f"Bearer {token}"

            response = await get_client().get("/account/positions", headers=headers)
            response.raise_for_status()
            return response.json()

        except httpx.HTTPError as e:
            print(f"Get positions error: {e}")
            raise

    @staticmethod
    async def get_account_events(token: Optional[str] = None, filters: Optional[Dict] = None) -> Dict[str, Any]:
        """Get account history/events"""
        try:
            headers = {}
            if token:
                headers["Authorization"] = f"Bearer {token}"

            response = await get_client().get("/account/events", params=filters or {}, headers=headers)
            response.raise_for_status()
            return response.json()

        except httpx.HTTPError as e:
            print(f"Get account events error: {e}")
            raise

    @staticmethod
    async def get_account_metrics(
        account_code: Optional[str] = None,
        accounts: Optional[str] = None,
        include_positions: bool = False,
        token: Optional[str] = None,
        auth_type: str = "bearer",
    ) -> Dict[str, Any]:
        """Get account metrics (equity, PnL, etc.) for one or multiple accounts."""
        try:
            params: Dict[str, Any] = {}
            if include_positions:
                params["include-positions"] = "true"

            if account_code:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/metrics"
            else:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/metrics"
                if accounts:
                    params["accounts"] = accounts

            if auth_type == "basic" and token:
                response = await LiquidChartsAPI._dxsca_request_with_basic_retry(
                    "GET",
                    url,
                    token=token,
                    params=params,
                )
            else:
                headers = LiquidChartsAPI._auth_headers(token, auth_type)
                response = await get_client().get(url, params=params, headers=headers)
            response.raise_for_status()
            return response.json()

        except httpx.HTTPError as e:
            print(f"Get account metrics error: {e}")
            raise

    @staticmethod
    async def get_users(
        token: Optional[str] = None,
        auth_type: str = "basic",
        username: Optional[str] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Get one user or list of accessible users from dxsca-web."""
        try:
            headers = LiquidChartsAPI._auth_headers(token, auth_type)
            if username:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/users/{username}"
            else:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/users"

            response = await get_client().get(url, params=filters or {}, headers=headers)
            response.raise_for_status()
            data = response.json()
            etag = response.headers.get("ETag")
            if etag:
                if isinstance(data, dict):
                    data["_etag"] = etag
                else:
                    data = {"data": data, "_etag": etag}
            return data
        except httpx.HTTPError as e:
            print(f"Get users error: {e}")
            raise

    @staticmethod
    async def get_account_portfolio(
        account_code: Optional[str] = None,
        accounts: Optional[str] = None,
        token: Optional[str] = None,
        auth_type: str = "basic",
    ) -> Dict[str, Any]:
        """List account portfolio for one or multiple accounts."""
        try:
            headers = LiquidChartsAPI._auth_headers(token, auth_type)
            params: Dict[str, Any] = {}
            if account_code:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/portfolio"
            else:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/portfolio"
                if accounts:
                    params["accounts"] = accounts

            response = await get_client().get(url, params=params, headers=headers)
            response.raise_for_status()
            data = response.json()
            etag = response.headers.get("ETag")
            if etag:
                if isinstance(data, dict):
                    data["_etag"] = etag
                else:
                    data = {"data": data, "_etag": etag}
            return data
        except httpx.HTTPError as e:
            print(f"Get account portfolio error: {e}")
            raise

    @staticmethod
    async def get_open_positions(
        account_code: Optional[str] = None,
        accounts: Optional[str] = None,
        token: Optional[str] = None,
        auth_type: str = "basic",
    ) -> Dict[str, Any]:
        """List open positions for one or multiple accounts."""
        try:
            headers = LiquidChartsAPI._auth_headers(token, auth_type)
            params: Dict[str, Any] = {}
            if account_code:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/positions"
            else:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/positions"
                if accounts:
                    params["accounts"] = accounts

            response = await get_client().get(url, params=params, headers=headers)
            response.raise_for_status()
            data = response.json()
            etag = response.headers.get("ETag")
            if etag:
                if isinstance(data, dict):
                    data["_etag"] = etag
                else:
                    data = {"data": data, "_etag": etag}
            return data
        except httpx.HTTPError as e:
            print(f"Get open positions error: {e}")
            raise

    @staticmethod
    async def get_open_orders(
        account_code: Optional[str] = None,
        accounts: Optional[str] = None,
        token: Optional[str] = None,
        auth_type: str = "basic",
    ) -> Dict[str, Any]:
        """List open orders for one or multiple accounts."""
        try:
            headers = LiquidChartsAPI._auth_headers(token, auth_type)
            params: Dict[str, Any] = {}
            if account_code:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/orders"
            else:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/orders"
                if accounts:
                    params["accounts"] = accounts

            response = await get_client().get(url, params=params, headers=headers)
            response.raise_for_status()
            data = response.json()
            etag = response.headers.get("ETag")
            if etag:
                if isinstance(data, dict):
                    data["_etag"] = etag
                else:
                    data = {"data": data, "_etag": etag}
            return data
        except httpx.HTTPError as e:
            print(f"Get open orders error: {e}")
            raise

    @staticmethod
    async def get_cash_transfers(
        account_code: Optional[str] = None,
        accounts: Optional[str] = None,
        filters: Optional[Dict[str, Any]] = None,
        token: Optional[str] = None,
        auth_type: str = "basic",
    ) -> Dict[str, Any]:
        """List cash transfers for one or multiple accounts."""
        try:
            headers = LiquidChartsAPI._auth_headers(token, auth_type)
            params: Dict[str, Any] = dict(filters or {})
            if account_code:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/transfers"
            else:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/transfers"
                if accounts:
                    params["accounts"] = accounts

            response = await get_client().get(url, params=params, headers=headers)
            response.raise_for_status()
            data = response.json()
            etag = response.headers.get("ETag")
            if etag:
                if isinstance(data, dict):
                    data["_etag"] = etag
                else:
                    data = {"data": data, "_etag": etag}
            return data
        except httpx.HTTPError as e:
            print(f"Get cash transfers error: {e}")
            raise

    @staticmethod
    async def list_orders_history(
        account_code: Optional[str] = None,
        accounts: Optional[str] = None,
        filters: Optional[Dict[str, Any]] = None,
        token: Optional[str] = None,
        auth_type: str = "basic",
        use_post: bool = False,
    ) -> Dict[str, Any]:
        """List historical orders (GET/POST) for one or multiple accounts."""
        try:
            headers = LiquidChartsAPI._auth_headers(token, auth_type)
            query_params: Dict[str, Any] = {}
            body = dict(filters or {})

            if account_code:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/orders/history"
            else:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/orders/history"
                if accounts:
                    query_params["accounts"] = accounts

            if use_post:
                response = await get_client().post(url, params=query_params, json=body, headers=headers)
            else:
                query_params.update(body)
                response = await get_client().get(url, params=query_params, headers=headers)

            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            print(f"List orders history error: {e}")
            raise

    @staticmethod
    async def get_account_events_dxsca(
        account_code: Optional[str] = None,
        accounts: Optional[str] = None,
        filters: Optional[Dict[str, Any]] = None,
        token: Optional[str] = None,
        auth_type: str = "basic",
    ) -> Dict[str, Any]:
        """List account events for one or multiple accounts."""
        try:
            headers = LiquidChartsAPI._auth_headers(token, auth_type)
            params: Dict[str, Any] = dict(filters or {})
            if account_code:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/events"
            else:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/events"
                if accounts:
                    params["accounts"] = accounts

            response = await get_client().get(url, params=params, headers=headers)
            response.raise_for_status()
            data = response.json()
            etag = response.headers.get("ETag")
            if etag:
                if isinstance(data, dict):
                    data["_etag"] = etag
                else:
                    data = {"data": data, "_etag": etag}
            return data
        except httpx.HTTPError as e:
            print(f"Get account events (dxsca) error: {e}")
            raise


async def close_client():
    """Close the HTTP client"""
    await get_client().aclose()

