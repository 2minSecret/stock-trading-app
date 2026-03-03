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
LIQUID_ORDER_BASE = os.getenv("LIQUID_ORDER_BASE_URL", "https://trader.liquidcharts.com")
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
    def _error_mentions_eventtypes(response: httpx.Response) -> bool:
        try:
            payload = response.json()
            if isinstance(payload, dict):
                description = str(payload.get("description", ""))
                return "eventtypes" in description.lower()
        except Exception:
            pass

        text = response.text or ""
        return "eventtypes" in text.lower()

    @staticmethod
    def _marketdata_payload_variants(request_payload: Dict[str, Any]) -> list[Dict[str, Any]]:
        """Build compatible payload variants for dxsca-web/marketdata.
        
        The upstream API is very strict. We try progressively different payloads.
        Key variations:
        - Use eventTypes (required field)
        - Try symbols array vs symbol string
        - Drop extra fields (limit, market, timeframe)
        """
        base = dict(request_payload)
        request_type = str(base.get("type") or "").strip().lower()

        # Remove unrecognized fields that might cause <null> errors
        base.pop("type", None)
        
        # Get the symbol(s)
        symbols = base.get("symbols")
        symbol_str = None
        if isinstance(symbols, list) and symbols:
            symbol_str = str(symbols[0]).strip()
        elif isinstance(symbols, str):
            symbol_str = str(symbols).strip()
        
        # Fields that might not be recognized: market, limit, timeframe
        # Test without them first
        all_fields_payload = dict(base)
        
        # Build variants: try with all fields first, then drop potentially problematic ones
        variants: list[Dict[str, Any]] = []
        
        if request_type == "candles":
            # Variant 1: Full payload with symbols array + eventTypes array
            v1 = dict(all_fields_payload)
            v1["eventTypes"] = ["CANDLE"]
            variants.append(v1)
            
            # Variant 2: Full payload with symbols array + eventTypes string
            v2 = dict(all_fields_payload)
            v2["eventTypes"] = "CANDLE"
            variants.append(v2)
            
            # Variant 3: Try symbol (singular) string instead of symbols array
            if symbol_str:
                v3 = dict(all_fields_payload)
                v3.pop("symbols", None)
                v3["symbol"] = symbol_str
                v3["eventTypes"] = ["CANDLE"]
                variants.append(v3)
                
                # Variant 4: symbol string + eventTypes as string
                v4 = dict(all_fields_payload)
                v4.pop("symbols", None)
                v4["symbol"] = symbol_str
                v4["eventTypes"] = "CANDLE"
                variants.append(v4)
            
            # Variant 5: Minimal symbols array - only symbols and eventTypes
            v5 = dict(all_fields_payload)
            v5.pop("limit", None)
            v5.pop("market", None)
            v5.pop("timeframe", None)
            v5["eventTypes"] = ["CANDLE"]
            variants.append(v5)
            
            # Variant 6: Minimal symbol string - only symbol and eventTypes
            if symbol_str:
                v6 = {
                    "symbol": symbol_str,
                    "eventTypes": ["CANDLE"]
                }
                variants.append(v6)
            
            # Variant 7: Try CANDLES (plural) with symbol string
            if symbol_str:
                v7 = {
                    "symbol": symbol_str,
                    "eventTypes": ["CANDLES"]
                }
                variants.append(v7)
            
            # Variant 8: Try with only symbol and eventTypes (minimal)
            if symbol_str:
                v8 = {
                    "symbols": [symbol_str],
                    "eventTypes": ["CANDLE"]
                }
                variants.append(v8)
            
            # Variant 9: Try with 'type' field included explicitly
            v9 = {
                "symbols": [symbol_str] if symbol_str else [],
                "type": "candles",
                "eventTypes": ["CANDLE"]
            }
            if v9.get("symbols"):
                variants.append(v9)
            
        elif request_type == "quote":
            # Variant 1: Full payload with symbols array + eventTypes array
            v1 = dict(all_fields_payload)
            v1["eventTypes"] = ["QUOTE"]
            variants.append(v1)
            
            # Variant 2: Full payload with symbols array + eventTypes string
            v2 = dict(all_fields_payload)
            v2["eventTypes"] = "QUOTE"
            variants.append(v2)
            
            # Variant 3: Try symbol (singular) string
            if symbol_str:
                v3 = dict(all_fields_payload)
                v3.pop("symbols", None)
                v3["symbol"] = symbol_str
                v3["eventTypes"] = ["QUOTE"]
                variants.append(v3)
                
                # Variant 4: symbol string + eventTypes string
                v4 = dict(all_fields_payload)
                v4.pop("symbols", None)
                v4["symbol"] = symbol_str
                v4["eventTypes"] = "QUOTE"
                variants.append(v4)
            
            # Variant 5: Minimal symbols array
            v5 = dict(all_fields_payload)
            v5.pop("limit", None)
            v5.pop("market", None)
            v5.pop("timeframe", None)
            v5["eventTypes"] = ["QUOTE"]
            variants.append(v5)
            
            # Variant 6: Minimal symbol string
            if symbol_str:
                v6 = {
                    "symbol": symbol_str,
                    "eventTypes": ["QUOTE"]
                }
                variants.append(v6)
            
            # Variant 7: Try QUOTES (plural)
            if symbol_str:
                v7 = {
                    "symbol": symbol_str,
                    "eventTypes": ["QUOTES"]
                }
                variants.append(v7)
            
            # Variant 8: Minimal with symbols array
            v8 = {
                "symbols": [symbol_str] if symbol_str else [],
                "eventTypes": ["QUOTE"]
            }
            if v8.get("symbols"):
                variants.append(v8)
            
            # Variant 9: Try with 'type' field included explicitly
            v9 = {
                "symbols": [symbol_str] if symbol_str else [],
                "type": "quote",
                "eventTypes": ["QUOTE"]
            }
            if v9.get("symbols"):
                variants.append(v9)
        
        return variants if variants else [all_fields_payload]

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
        prefixes = [LIQUID_BASIC_AUTH_PREFIX] if explicit_prefix else ["DXAPI ", ""]

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
        requested_domain = (domain or "").strip()
        domain_candidates: list[str] = []

        for candidate in (
            requested_domain,
            "default" if not requested_domain else "",
        ):
            if candidate not in domain_candidates:
                domain_candidates.append(candidate)

        last_error: Optional[httpx.HTTPStatusError] = None

        for index, domain_candidate in enumerate(domain_candidates):
            try:
                response = await get_client().post(
                    f"{LIQUID_METRICS_BASE}/dxsca-web/login",
                    json={"username": username, "domain": domain_candidate, "password": password}
                )
                response.raise_for_status()
                if index > 0:
                    print(f"INFO: basic_login succeeded with fallback domain '{domain_candidate or '<empty>'}'")
                return response.json()
            except httpx.HTTPStatusError as e:
                last_error = e
                if e.response.status_code in (401, 403) and index < len(domain_candidates) - 1:
                    print(
                        "WARN: basic_login failed with domain "
                        f"'{domain_candidate or '<empty>'}' (status {e.response.status_code}); retrying fallback domain"
                    )
                    continue
                raise
            except httpx.HTTPError as e:
                print(f"Basic login error: {e}")
                raise

        if last_error:
            raise last_error

        raise httpx.HTTPStatusError("Basic login failed", request=None, response=None)

    @staticmethod
    async def basic_logout(token: str) -> Dict[str, Any]:
        """Logout from Basic Auth session"""
        try:
            headers = {"Authorization": f"DXAPI {token}", "X-Liquid-Token": token}
            response = await get_client().post(
                f"{LIQUID_METRICS_BASE}/dxsca-web/logout",
                headers=headers,
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
            headers = {"Authorization": f"DXAPI {token}", "X-Liquid-Token": token}
            response = await get_client().post(
                f"{LIQUID_METRICS_BASE}/dxsca-web/ping",
                headers=headers,
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
            variants = LiquidChartsAPI._marketdata_payload_variants(request_payload)
            last_error: Optional[httpx.HTTPStatusError] = None

            for index, payload_variant in enumerate(variants):
                did_ping_retry = False
                try:
                    print(f"DEBUG: Trying marketdata variant #{index + 1}: {json.dumps(payload_variant)}")
                    if auth_type == "basic" and token:
                        response = await LiquidChartsAPI._dxsca_request_with_basic_retry(
                            "POST",
                            f"{LIQUID_METRICS_BASE}/dxsca-web/marketdata",
                            token=token,
                            json_body=payload_variant,
                        )
                    else:
                        headers = LiquidChartsAPI._auth_headers(token, auth_type)
                        response = await get_client().post(
                            f"{LIQUID_METRICS_BASE}/dxsca-web/marketdata",
                            json=payload_variant,
                            headers=headers,
                        )
                    response.raise_for_status()
                    if index > 0:
                        print(f"INFO: marketdata succeeded with compatibility payload variant #{index + 1}")
                    return response.json()
                except httpx.HTTPStatusError as e:
                    if (
                        auth_type == "basic"
                        and token
                        and e.response.status_code in (401, 403)
                        and not did_ping_retry
                    ):
                        did_ping_retry = True
                        try:
                            print("WARN: marketdata unauthorized; attempting basic_ping and one retry")
                            await LiquidChartsAPI.basic_ping(token)
                            response = await LiquidChartsAPI._dxsca_request_with_basic_retry(
                                "POST",
                                f"{LIQUID_METRICS_BASE}/dxsca-web/marketdata",
                                token=token,
                                json_body=payload_variant,
                            )
                            response.raise_for_status()
                            print(f"INFO: marketdata recovered after basic_ping on variant #{index + 1}")
                            return response.json()
                        except Exception as ping_retry_error:
                            print(f"WARN: basic_ping retry failed: {ping_retry_error}")

                    last_error = e
                    # Retry on 400 errors that indicate request format issues
                    # (eventTypes errors, parameter validation errors, etc.)
                    is_param_error = (
                        e.response.status_code == 400
                        and index < len(variants) - 1
                    )
                    if is_param_error:
                        try:
                            error_body = e.response.json()
                            description = str(error_body.get("detail", {}).get("upstream", {}).get("description", ""))
                        except:
                            description = str(e.response.text)[:200]
                        print(
                            f"WARN: marketdata variant #{index + 1} rejected ({description}); retrying variant #{index + 2}"
                        )
                        continue
                    raise

            if last_error:
                raise last_error
            raise httpx.HTTPStatusError("dxsca marketdata request failed", request=None, response=None)
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
            return await LiquidChartsAPI.post_market_data(
                request_payload={
                    "symbols": [symbol],
                    "timeframe": timeframe,
                    "limit": limit,
                    "type": "candles",
                },
                token=token,
                auth_type=auth_type,
            )
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
            if auth_type == "basic" and token:
                # For basic auth with X-Liquid-Token, use DXAPI prefix
                headers = {"Authorization": f"DXAPI {token}", "X-Liquid-Token": token}
            else:
                # Bearer auth fallback
                headers = {"Authorization": f"Bearer {token}"} if token else {}

            order_urls = [
                f"{LIQUID_ORDER_BASE}/dxsca-fxblue/accounts/{account_code}/orders",
                f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/orders",
            ]

            last_error: Optional[httpx.HTTPStatusError] = None
            for url in order_urls:
                response = await get_client().post(
                    url,
                    json=order_payload,
                    headers=headers,
                )
                try:
                    response.raise_for_status()
                    return response.json()
                except httpx.HTTPStatusError as e:
                    last_error = e
                    if e.response.status_code in (400, 409):
                        raise
                    continue

            if last_error:
                raise last_error
            raise httpx.HTTPStatusError("Order request failed", request=None, response=None)

        except httpx.HTTPError as e:
            print(f"Place account order error: {e}")
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_detail = e.response.json()
                    print(f"Error response: {error_detail}")
                except Exception:
                    print(f"Error response text: {e.response.text}")
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
                    # For basic auth with X-Liquid-Token, use DXAPI prefix
                    headers["Authorization"] = f"DXAPI {token}"
                    headers["X-Liquid-Token"] = token
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
                    # For basic auth with X-Liquid-Token, use DXAPI prefix
                    headers["Authorization"] = f"DXAPI {token}"
                    headers["X-Liquid-Token"] = token
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

            # For basic auth with X-Liquid-Token, use DXAPI prefix
            if token and auth_type == "basic":
                headers = {"Authorization": f"DXAPI {token}", "X-Liquid-Token": token}
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
            params: Dict[str, Any] = {}
            if account_code:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/portfolio"
            else:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/portfolio"
                if accounts:
                    params["accounts"] = accounts

            # For basic auth with X-Liquid-Token, use DXAPI prefix
            if token and auth_type == "basic":
                headers = {"Authorization": f"DXAPI {token}", "X-Liquid-Token": token}
            else:
                headers = LiquidChartsAPI._auth_headers(token, auth_type)
            
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
            params: Dict[str, Any] = {}
            if account_code:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/positions"
            else:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/positions"
                if accounts:
                    params["accounts"] = accounts

            # For basic auth with X-Liquid-Token, use DXAPI prefix
            if token and auth_type == "basic":
                headers = {"Authorization": f"DXAPI {token}", "X-Liquid-Token": token}
            else:
                headers = LiquidChartsAPI._auth_headers(token, auth_type)
            
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
            params: Dict[str, Any] = {}
            if account_code:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/orders"
            else:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/orders"
                if accounts:
                    params["accounts"] = accounts

            # For basic auth with X-Liquid-Token, use DXAPI prefix
            if token and auth_type == "basic":
                headers = {"Authorization": f"DXAPI {token}", "X-Liquid-Token": token}
            else:
                headers = LiquidChartsAPI._auth_headers(token, auth_type)
            
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
            params: Dict[str, Any] = dict(filters or {})
            if account_code:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/transfers"
            else:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/transfers"
                if accounts:
                    params["accounts"] = accounts

            # For basic auth with X-Liquid-Token, use DXAPI prefix
            if token and auth_type == "basic":
                headers = {"Authorization": f"DXAPI {token}", "X-Liquid-Token": token}
            else:
                headers = LiquidChartsAPI._auth_headers(token, auth_type)
            
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
            query_params: Dict[str, Any] = {}
            body = dict(filters or {})

            if account_code:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/orders/history"
            else:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/orders/history"
                if accounts:
                    query_params["accounts"] = accounts

            # For basic auth with X-Liquid-Token, use DXAPI prefix
            if token and auth_type == "basic":
                headers = {"Authorization": f"DXAPI {token}", "X-Liquid-Token": token}
            else:
                headers = LiquidChartsAPI._auth_headers(token, auth_type)

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
            params: Dict[str, Any] = dict(filters or {})
            if account_code:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/{account_code}/events"
            else:
                url = f"{LIQUID_METRICS_BASE}/dxsca-web/accounts/events"
                if accounts:
                    params["accounts"] = accounts

            # For basic auth with X-Liquid-Token, use DXAPI prefix
            if token and auth_type == "basic":
                headers = {"Authorization": f"DXAPI {token}", "X-Liquid-Token": token}
            else:
                headers = LiquidChartsAPI._auth_headers(token, auth_type)

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

