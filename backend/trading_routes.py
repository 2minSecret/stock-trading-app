"""
FastAPI endpoints for Liquid Charts trading integration.
These endpoints securely proxy requests to Liquid Charts API,
keeping API keys safe on the backend.
"""

from fastapi import APIRouter, HTTPException, Header, Query, Request
from pydantic import BaseModel
from typing import Optional, Dict, Any
from liquid_charts_api import LiquidChartsAPI
import httpx
import asyncio
import time
import json
import logging

logger = logging.getLogger(__name__)

router = APIRouter(tags=["trading"])

UNAUTHORIZED_MARKETDATA_COOLDOWN_SECONDS = 10.0
_marketdata_unauthorized_until: Dict[str, float] = {}

# ===== Request Models =====
class PlaceOrderRequest(BaseModel):
    symbol: str
    side: str  # 'buy' or 'sell'
    quantity: float
    order_type: str = "limit"
    price: Optional[float] = None
    stop_price: Optional[float] = None
    time_in_force: str = "GTC"

class CancelOrderRequest(BaseModel):
    order_id: str

class MarketDataRequest(BaseModel):
    symbol: str
    market: str = "spot"

class OHLCRequest(BaseModel):
    symbol: str
    timeframe: str = "1h"
    limit: int = 100


class DxscaMarketDataRequest(BaseModel):
    request: Dict[str, Any]


class ConversionRatesRequest(BaseModel):
    to_currency: str
    from_currency: Optional[str] = None

class PlaceAccountOrderRequest(BaseModel):
    account_code: str
    order: dict


class PlaceAccountBracketOrderRequest(BaseModel):
    account_code: str
    entry_order: Dict[str, Any]
    stop_loss_price: float
    take_profit_price: float

class BotOrderRequest(BaseModel):
    """Request format for bot-automated trading"""
    accountId: str
    symbol: Optional[str] = None
    instrument: Optional[str] = None
    side: str  # 'buy' or 'sell'
    quantity: float
    amount: Optional[float] = None
    orderType: str = "MARKET"
    tif: str = "GTC"
    positionEffect: str = "OPEN"
    positionCode: Optional[str] = None
    orderCode: Optional[str] = None
    price: Optional[float] = None
    username: str
    password: str

class ModifyAccountOrderRequest(BaseModel):
    account_code: str
    order: dict
    if_match: str

class CancelAccountOrderRequest(BaseModel):
    account_code: str
    order_code: str
    if_match: str

class CancelAccountOrderGroupRequest(BaseModel):
    account_code: str
    order_codes: str
    contingency_type: str
    if_match: str

class BasicLoginRequest(BaseModel):
    username: str
    domain: str
    password: str

class BasicTokenRequest(BaseModel):
    token: str


class ListOrdersHistoryRequest(BaseModel):
    account_code: Optional[str] = None
    accounts: Optional[str] = None
    filters: Dict[str, Any] = {}


# ===== Helper to get user token from header =====
def get_user_token(authorization: Optional[str] = None) -> Optional[str]:
    """Extract bearer token from authorization header"""
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:]
    return None


def get_auth_context(authorization: Optional[str], x_liquid_token: Optional[str]) -> tuple[Optional[str], str]:
    """Return token and auth type ('basic' or 'bearer')."""
    token = x_liquid_token or get_user_token(authorization)
    auth_type = "basic" if x_liquid_token else "bearer"
    return token, auth_type


def _marketdata_client_key(http_request: Request) -> str:
        client_host = http_request.client.host if http_request.client else "unknown"
        forwarded_for = http_request.headers.get("x-forwarded-for")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        return client_host


def _normalize_marketdata_request(request_payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(request_payload)

    symbols = normalized.get("symbols")
    if isinstance(symbols, list):
        normalized_symbols = [str(symbol).strip().upper() for symbol in symbols if str(symbol).strip()]
        if normalized_symbols:
            normalized["symbols"] = normalized_symbols

    if "market" not in normalized or not normalized.get("market"):
        normalized["market"] = "spot"

    timeframe = normalized.get("timeframe")
    if isinstance(timeframe, str):
        normalized["timeframe"] = timeframe.strip().lower()

    # Keep eventTypes only if explicitly provided by caller.
    # Auto-injecting this field causes upstream validation failures.
    if "eventTypes" in normalized and normalized.get("eventTypes") in (None, "", []):
        normalized.pop("eventTypes", None)

    return normalized


def _dxsca_error_description(response_body: Any) -> str:
    if isinstance(response_body, dict):
        description = response_body.get("description")
        return str(description) if description is not None else ""
    return str(response_body or "")


def _is_eventtypes_validation_error(response_body: Any) -> bool:
    description = _dxsca_error_description(response_body).lower()
    return "eventtypes" in description


def _is_html_error_payload(response_body: Any) -> bool:
    if not isinstance(response_body, str):
        return False
    lowered = response_body.lower()
    return "<html" in lowered or "<!doctype html" in lowered


def _safe_upstream_detail(response_body: Any, status_code: int) -> Any:
    if _is_html_error_payload(response_body):
        return {
            "message": "Upstream Liquid Charts returned HTML instead of JSON.",
            "hint": "Session may be expired/invalid or upstream endpoint rejected the request.",
            "status_code": status_code,
        }
    if isinstance(response_body, str) and len(response_body) > 2000:
        return response_body[:2000] + "..."
    return response_body


def _build_quote_from_ohlc_payload(symbol: str, market: str, ohlc_data: Any) -> Dict[str, Any]:
    row = None
    if isinstance(ohlc_data, list) and ohlc_data:
        row = ohlc_data[-1]
    elif isinstance(ohlc_data, dict):
        for key in ("items", "data", "candles", "marketData", "quotes"):
            value = ohlc_data.get(key)
            if isinstance(value, list) and value:
                row = value[-1]
                break

    if not isinstance(row, dict):
        row = {}

    last_price = (
        row.get("close")
        or row.get("c")
        or row.get("price")
        or row.get("last")
    )
    quote_time = (
        row.get("time")
        or row.get("timestamp")
        or row.get("ts")
        or row.get("dateTime")
        or row.get("date")
    )

    return {
        "quotes": [
            {
                "symbol": symbol,
                "last": last_price,
                "price": last_price,
                "time": quote_time,
                "market": market,
            }
        ]
    }


def _extract_position_code_from_payload(payload: Any) -> Optional[str]:
    if not payload or not isinstance(payload, dict):
        return None

    direct = payload.get("positionCode") or payload.get("position_code")
    if direct:
        return str(direct)

    data = payload.get("data")
    if isinstance(data, dict):
        nested = data.get("positionCode") or data.get("position_code")
        if nested:
            return str(nested)

    return None


def _extract_positions_list(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []

    for key in ("positions", "items", "data"):
        value = payload.get(key)
        if isinstance(value, list):
            return [row for row in value if isinstance(row, dict)]

    for value in payload.values():
        if isinstance(value, list):
            dict_rows = [row for row in value if isinstance(row, dict)]
            if dict_rows:
                return dict_rows

    return []


def _position_matches_instrument(position_row: dict, instrument: str) -> bool:
    fields = (
        position_row.get("instrument"),
        position_row.get("symbol"),
        position_row.get("security"),
        position_row.get("ticker"),
    )
    values = {str(v).upper() for v in fields if v is not None}
    return instrument.upper() in values


def _position_side_matches_entry(position_row: dict, entry_side: str) -> bool:
    row_side = str(
        position_row.get("side")
        or position_row.get("positionSide")
        or position_row.get("direction")
        or ""
    ).upper()
    if not row_side:
        return True
    if entry_side == "BUY":
        return row_side in ("BUY", "LONG")
    return row_side in ("SELL", "SHORT")


async def _resolve_position_code_after_entry(
    account_code: str,
    instrument: str,
    entry_side: str,
    token: str,
    auth_type: str,
    max_attempts: int = 8,
    delay_seconds: float = 0.75,
) -> Optional[str]:
    for _ in range(max_attempts):
        try:
            positions_payload = await LiquidChartsAPI.get_open_positions(
                account_code=account_code,
                token=token,
                auth_type=auth_type,
            )
        except Exception:
            await asyncio.sleep(delay_seconds)
            continue

        rows = _extract_positions_list(positions_payload)
        filtered = [
            row for row in rows
            if _position_matches_instrument(row, instrument)
            and _position_side_matches_entry(row, entry_side)
        ]
        if not filtered:
            filtered = [row for row in rows if _position_matches_instrument(row, instrument)]

        for row in filtered:
            position_code = row.get("positionCode") or row.get("position_code") or row.get("code") or row.get("id")
            if position_code:
                return str(position_code)

        await asyncio.sleep(delay_seconds)

    return None


def _extract_error_code_and_description(error_detail: Any) -> tuple[Optional[str], str]:
    if isinstance(error_detail, dict):
        code = error_detail.get("errorCode")
        description = error_detail.get("description") or error_detail.get("message") or ""
        return (str(code) if code is not None else None, str(description))
    return (None, str(error_detail or ""))


def _is_retriable_shape_error(error_detail: Any) -> bool:
    code, description = _extract_error_code_and_description(error_detail)
    if code in ("32", "33"):
        return True
    lowered = description.lower()
    return "incorrect request" in lowered or "incorrect request parameters" in lowered


async def _place_leg_with_type_fallback(
    account_code: str,
    order_template: Dict[str, Any],
    order_code_prefix: str,
    fallback_types: list[str],
    token: str,
    auth_type: str,
) -> tuple[Optional[Dict[str, Any]], Optional[Any], list[Dict[str, Any]]]:
    attempts: list[Dict[str, Any]] = []

    for index, leg_type in enumerate(fallback_types):
        base_payload = dict(order_template)
        base_payload["type"] = leg_type

        variant_payloads: list[tuple[str, Dict[str, Any]]] = []
        if leg_type == "LIMIT":
            price_value = base_payload.get("price")
            if price_value is not None:
                only_price = dict(base_payload)
                only_price.pop("limitPrice", None)
                variant_payloads.append(("price", only_price))

                only_limit_price = dict(base_payload)
                only_limit_price.pop("price", None)
                only_limit_price["limitPrice"] = price_value
                variant_payloads.append(("limitPrice", only_limit_price))

                both = dict(base_payload)
                both["limitPrice"] = price_value
                variant_payloads.append(("price+limitPrice", both))
            else:
                variant_payloads.append(("default", base_payload))
        else:
            payload = dict(base_payload)
            if leg_type == "STOP":
                if "price" in payload:
                    payload["stopPrice"] = payload["price"]
            elif leg_type in ("STOP_MARKET", "STOP_LIMIT"):
                if "price" in payload:
                    payload["stopPrice"] = payload["price"]
            variant_payloads.append(("default", payload))

        for variant_index, (variant_name, payload) in enumerate(variant_payloads):
            payload["orderCode"] = f"{order_code_prefix}-{int(time.time() * 1000)}-{index}-{variant_index}"
            try:
                result = await LiquidChartsAPI.place_account_order(
                    account_code=account_code,
                    order_payload=payload,
                    token=token,
                    auth_type=auth_type,
                )
                attempts.append({"type": leg_type, "variant": variant_name, "status": "ok"})
                return result, None, attempts
            except httpx.HTTPStatusError as e:
                try:
                    err = e.response.json()
                except Exception:
                    err = e.response.text
                attempts.append({"type": leg_type, "variant": variant_name, "status": "error", "error": err})
                if not _is_retriable_shape_error(err):
                    return None, err, attempts
            except Exception as e:
                err = str(e)
                attempts.append({"type": leg_type, "variant": variant_name, "status": "error", "error": err})
                return None, err, attempts

    last_error = attempts[-1]["error"] if attempts else "Unknown error"
    return None, last_error, attempts


# ===== Market Data Endpoints =====
@router.post("/market-data")
async def get_market_data(
    request: MarketDataRequest,
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Get current market data for a symbol"""
    try:
        token, auth_type = get_auth_context(authorization, x_liquid_token)
        data = await LiquidChartsAPI.post_market_data(
            request_payload={
                "symbols": [request.symbol],
                "market": request.market,
                "type": "quote",
            },
            token=token,
            auth_type=auth_type,
        )
        return data
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/ohlc")
async def get_ohlc(
    request: OHLCRequest,
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Get historical OHLC data"""
    try:
        token, auth_type = get_auth_context(authorization, x_liquid_token)
        data = await LiquidChartsAPI.post_market_data(
            request_payload={
                "symbols": [request.symbol],
                "timeframe": request.timeframe,
                "limit": request.limit,
                "type": "candles",
            },
            token=token,
            auth_type=auth_type,
        )
        return data
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/yahoo/history")
async def get_yahoo_history(
    symbol: str = Query(..., description="Stock symbol (e.g., AAPL, ^IXIC for NASDAQ)"),
    period: str = Query("1d", description="Data period (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max)"),
    interval: str = Query("1h", description="Data interval (1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo)"),
):
    """Get historical OHLC data from Yahoo Finance"""
    try:
        import yfinance as yf
        import asyncio
        
        def fetch_history():
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period=period, interval=interval)
            
            if hist.empty:
                return []
            
            # Convert to list of candles
            candles = []
            for timestamp, row in hist.iterrows():
                candles.append({
                    "ts": int(timestamp.timestamp() * 1000),  # Convert to milliseconds
                    "open": float(row['Open']),
                    "high": float(row['High']),
                    "low": float(row['Low']),
                    "close": float(row['Close']),
                    "volume": int(row['Volume']) if 'Volume' in row else 0,
                })
            
            return candles
        
        # Run yfinance in a thread to avoid blocking
        candles = await asyncio.to_thread(fetch_history)
        
        return {
            "success": True,
            "symbol": symbol,
            "candles": candles,
            "count": len(candles)
        }
        
    except Exception as e:
        logger.error(f"Yahoo Finance history error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch Yahoo Finance data: {str(e)}")


@router.post("/marketdata")
async def post_dxsca_market_data(
    payload: DxscaMarketDataRequest,
    http_request: Request,
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Pass-through for dxsca-web/marketdata (quotes and chart candles)."""
    client_key = None
    normalized_request = None
    try:
        print("DEBUG: /marketdata endpoint called")  # Confirm endpoint is reached
        print(f"DEBUG: authorization header: {authorization}")
        print(f"DEBUG: x_liquid_token header: {x_liquid_token}")
        print(f"DEBUG: all headers: {dict(http_request.headers)}")
        client_key = _marketdata_client_key(http_request)
        now = time.monotonic()
        blocked_until = _marketdata_unauthorized_until.get(client_key)
        if blocked_until and now < blocked_until:
            retry_after = max(1, int(blocked_until - now))
            raise HTTPException(
                status_code=401,
                detail=f"Session unauthorized. Retry after {retry_after}s or re-login.",
            )

        token, auth_type = get_auth_context(authorization, x_liquid_token)
        if not token:
            raise HTTPException(
                status_code=401,
                detail={
                    "error": "Authentication required",
                    "debug": {
                        "has_authorization_header": bool(authorization),
                        "has_x_liquid_token": bool(x_liquid_token),
                        "client_key": client_key,
                    },
                },
            )

        if not isinstance(payload.request, dict) or not payload.request:
            raise HTTPException(status_code=400, detail="request payload is required")

        normalized_request = _normalize_marketdata_request(payload.request)
        print(f"DEBUG: Forwarding marketdata request: {json.dumps(normalized_request)}")

        request_type = str(normalized_request.get("type") or "").strip().lower()
        symbols = normalized_request.get("symbols") or []
        symbol = symbols[0] if isinstance(symbols, list) and symbols else None
        market = str(normalized_request.get("market") or "spot")
        timeframe = str(normalized_request.get("timeframe") or "1h")
        limit_value = normalized_request.get("limit")
        try:
            limit = int(limit_value) if limit_value is not None else 200
        except (TypeError, ValueError):
            limit = 200

        data = await LiquidChartsAPI.post_market_data(
            request_payload=normalized_request,
            token=token,
            auth_type=auth_type,
        )

        if client_key:
            _marketdata_unauthorized_until.pop(client_key, None)
        return data
    except httpx.HTTPStatusError as e:
        if client_key and e.response.status_code in (401, 403):
            _marketdata_unauthorized_until[client_key] = time.monotonic() + UNAUTHORIZED_MARKETDATA_COOLDOWN_SECONDS
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text

        if (
            e.response.status_code == 400
            and normalized_request
            and _is_eventtypes_validation_error(response_body)
        ):
            print("WARN: Upstream rejected marketdata payload with eventTypes validation after compatibility retries")
        
        print(f"ERROR: Upstream marketdata HTTP {e.response.status_code}")
        print(f"ERROR: Response body: {response_body}")
        if normalized_request:
            print(f"ERROR: Request that failed: {json.dumps(normalized_request)}")
        safe_detail = _safe_upstream_detail(response_body, e.response.status_code)
        raise HTTPException(
            status_code=e.response.status_code,
            detail={
                "upstream": safe_detail,
                "debug": {
                    "auth_type": auth_type if 'auth_type' in locals() else None,
                    "has_token": bool(token) if 'token' in locals() else False,
                    "token_length": len(token) if isinstance(token, str) else 0,
                    "request_payload": normalized_request,
                    "client_key": client_key,
                },
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"EXCEPTION: {type(e).__name__}: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/conversion-rates")
async def get_conversion_rates(
    request: ConversionRatesRequest,
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Get currency conversion rates via dxsca-web/conversionRates."""
    try:
        token, auth_type = get_auth_context(authorization, x_liquid_token)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        if not request.to_currency:
            raise HTTPException(status_code=400, detail="to_currency is required")

        data = await LiquidChartsAPI.get_conversion_rates(
            to_currency=request.to_currency,
            from_currency=request.from_currency,
            token=token,
            auth_type=auth_type,
        )
        return data
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ===== Basic Auth Session Endpoints =====
@router.post("/auth/basic/login")
async def basic_login(request: BasicLoginRequest):
    """Create a Basic Authentication session token"""
    try:
        data = await LiquidChartsAPI.basic_login(request.username, request.domain, request.password)
        return data
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/auth/basic/logout")
async def basic_logout(
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Logout from Basic Authentication session"""
    try:
        token = x_liquid_token or get_user_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        data = await LiquidChartsAPI.basic_logout(token)
        return data
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (400, 401, 403):
            return {
                "status": "logged_out",
                "detail": "Session already expired or invalid; treated as logged out.",
            }
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/auth/basic/ping")
async def basic_ping(
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Keep Basic Authentication session alive"""
    try:
        token = x_liquid_token or get_user_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        data = await LiquidChartsAPI.basic_ping(token)
        return data
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ===== Trading Endpoints =====
@router.post("/orders/place")
async def place_order(request: PlaceOrderRequest, authorization: Optional[str] = Header(default=None)):
    """Place a new buy/sell order"""
    try:
        token = get_user_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        order = await LiquidChartsAPI.place_order(
            symbol=request.symbol,
            side=request.side,
            quantity=request.quantity,
            order_type=request.order_type,
            price=request.price,
            stop_price=request.stop_price,
            time_in_force=request.time_in_force,
            token=token
        )
        return order
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/orders/account/place")
async def place_account_order(
    request: PlaceAccountOrderRequest,
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Place an order on /dxsca-web/accounts/{accountCode}/orders."""
    try:
        token = x_liquid_token or get_user_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        if not request.account_code:
            raise HTTPException(status_code=400, detail="account_code is required")

        if not isinstance(request.order, dict) or not request.order:
            raise HTTPException(status_code=400, detail="order payload is required")

        if not request.order.get("orderCode") and not request.order.get("clientOrderId"):
            raise HTTPException(status_code=400, detail="orderCode (or clientOrderId) is required")

        if not request.order.get("instrument") and not request.order.get("symbol"):
            raise HTTPException(status_code=400, detail="instrument (or symbol) is required")

        result = await LiquidChartsAPI.place_account_order(
            account_code=request.account_code,
            order_payload=request.order,
            token=token,
            auth_type="basic" if x_liquid_token else "bearer",
        )
        return result
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/orders/account/place-bracket")
async def place_account_bracket_order(
    request: PlaceAccountBracketOrderRequest,
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Phase 2 bracket flow: place entry, resolve position code, and auto-place TP/SL close legs."""
    try:
        token = x_liquid_token or get_user_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        if not request.account_code:
            raise HTTPException(status_code=400, detail="account_code is required")

        entry_order = dict(request.entry_order or {})
        if not entry_order:
            raise HTTPException(status_code=400, detail="entry_order is required")

        instrument = entry_order.get("instrument") or entry_order.get("symbol")
        if not instrument:
            raise HTTPException(status_code=400, detail="entry_order.instrument (or symbol) is required")

        side = str(entry_order.get("side", "")).upper()
        if side not in ("BUY", "SELL"):
            raise HTTPException(status_code=400, detail="entry_order.side must be BUY or SELL")

        order_type = str(entry_order.get("type") or entry_order.get("orderType") or "MARKET").upper()
        if order_type not in ("MARKET", "LIMIT"):
            raise HTTPException(status_code=400, detail="entry_order.type must be MARKET or LIMIT")

        quantity = entry_order.get("quantity")
        try:
            quantity = float(quantity)
        except Exception:
            quantity = None
        if not quantity or quantity <= 0:
            raise HTTPException(status_code=400, detail="entry_order.quantity must be > 0")

        stop_loss = float(request.stop_loss_price)
        take_profit = float(request.take_profit_price)
        if stop_loss <= 0 or take_profit <= 0:
            raise HTTPException(status_code=400, detail="stop_loss_price and take_profit_price must be > 0")

        entry_price = entry_order.get("price")
        if entry_price is not None:
            try:
                entry_price = float(entry_price)
            except Exception:
                entry_price = None

        # Directional validation (entry reference required for strict checks)
        if entry_price and side == "BUY":
            if not (stop_loss < entry_price < take_profit):
                raise HTTPException(status_code=400, detail="For BUY: stop_loss < entry_price < take_profit is required")
        elif entry_price and side == "SELL":
            if not (take_profit < entry_price < stop_loss):
                raise HTTPException(status_code=400, detail="For SELL: take_profit < entry_price < stop_loss is required")
        elif abs(take_profit - stop_loss) < 1e-9:
            raise HTTPException(status_code=400, detail="take_profit_price and stop_loss_price must be different")

        entry_order_normalized = {
            "orderCode": entry_order.get("orderCode") or entry_order.get("clientOrderId") or f"web-{int(time.time() * 1000)}",
            "type": order_type,
            "positionEffect": entry_order.get("positionEffect") or "OPEN",
            "tif": entry_order.get("tif") or entry_order.get("timeInForce") or "GTC",
            "instrument": instrument,
            "side": side,
            "quantity": quantity,
        }
        if order_type == "LIMIT":
            if not entry_price or entry_price <= 0:
                raise HTTPException(status_code=400, detail="LIMIT entry requires entry_order.price > 0")
            entry_order_normalized["price"] = entry_price

        auth_type = "basic" if x_liquid_token else "bearer"

        entry_result = await LiquidChartsAPI.place_account_order(
            account_code=request.account_code,
            order_payload=entry_order_normalized,
            token=token,
            auth_type=auth_type,
        )

        position_code = _extract_position_code_from_payload(entry_result)
        if not position_code:
            position_code = await _resolve_position_code_after_entry(
                account_code=request.account_code,
                instrument=instrument,
                entry_side=side,
                token=token,
                auth_type=auth_type,
            )

        if not position_code:
            return {
                "status": "entry_placed_position_pending",
                "entry_order": entry_result,
                "bracket_plan": {
                    "stop_loss_price": stop_loss,
                    "take_profit_price": take_profit,
                    "note": "Entry placed, but position code is not available yet. TP/SL auto-legs were not submitted.",
                },
            }

        close_side = "SELL" if side == "BUY" else "BUY"
        base_leg = {
            "positionEffect": "CLOSE",
            "positionCode": str(position_code),
            "tif": "GTC",
            "instrument": instrument,
            "side": close_side,
            "quantity": quantity,
        }

        tp_order = {
            "price": take_profit,
            **base_leg,
        }
        sl_order = {
            "price": stop_loss,
            **base_leg,
        }

        tp_result, tp_error, tp_attempts = await _place_leg_with_type_fallback(
            account_code=request.account_code,
            order_template=tp_order,
            order_code_prefix="tp",
            fallback_types=["LIMIT"],
            token=token,
            auth_type=auth_type,
        )
        sl_result, sl_error, sl_attempts = await _place_leg_with_type_fallback(
            account_code=request.account_code,
            order_template=sl_order,
            order_code_prefix="sl",
            fallback_types=["STOP", "STOP_MARKET", "STOP_LIMIT"],
            token=token,
            auth_type=auth_type,
        )

        if tp_result and sl_result:
            status = "entry_tp_sl_placed"
        elif tp_result or sl_result:
            status = "entry_placed_tp_sl_partial"
        else:
            status = "entry_placed_tp_sl_failed"

        return {
            "status": status,
            "entry_order": entry_result,
            "position_code": str(position_code),
            "take_profit_order": tp_result,
            "stop_loss_order": sl_result,
            "errors": {
                "take_profit": tp_error,
                "stop_loss": sl_error,
            },
            "attempts": {
                "take_profit": tp_attempts,
                "stop_loss": sl_attempts,
            },
            "bracket_plan": {
                "stop_loss_price": stop_loss,
                "take_profit_price": take_profit,
            },
        }
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/bot/orders/place")
async def place_bot_order(request: BotOrderRequest):
    """
    Place a buy/sell order from the trading bot.
    Accepts bot-format request with username/password authentication.
    """
    try:
        # Authenticate with username/password
        login_data = await LiquidChartsAPI.basic_login(
            username=request.username,
            domain="",
            password=request.password
        )
        
        if not login_data.get('success'):
            raise HTTPException(status_code=401, detail="Authentication failed")
        
        token = login_data.get('token') or login_data.get('data', {}).get('token')
        if not token:
            raise HTTPException(status_code=401, detail="No token received from login")
        
        instrument = request.instrument or request.symbol
        if not instrument:
            raise HTTPException(status_code=400, detail="symbol or instrument is required")

        side = str(request.side or "").upper()
        if side not in ("BUY", "SELL"):
            raise HTTPException(status_code=400, detail="side must be BUY or SELL")

        order_type = str(request.orderType or "MARKET").upper()
        position_effect = str(request.positionEffect or "OPEN").upper()
        tif = str(request.tif or "GTC").upper()

        if position_effect == "CLOSE" and not request.positionCode:
            raise HTTPException(status_code=400, detail="positionCode is required for CLOSE orders")

        if order_type == "LIMIT":
            if request.price is None or float(request.price) <= 0:
                raise HTTPException(status_code=400, detail="LIMIT orders require positive price")

        # Build DXSCA order payload (same schema as working account order flow)
        order_payload = {
            "orderCode": request.orderCode or f"bot-{request.accountId}-{instrument}-{side}-{int(time.time() * 1000)}",
            "instrument": instrument,
            "side": side,
            "type": order_type,
            "positionEffect": position_effect,
            "tif": tif,
            "quantity": float(request.quantity),
        }
        if request.price is not None:
            order_payload["price"] = float(request.price)
        if request.positionCode:
            order_payload["positionCode"] = str(request.positionCode)
        
        # Place the order using the account place endpoint
        result = await LiquidChartsAPI.place_account_order(
            account_code=request.accountId,
            order_payload=order_payload,
            token=token,
            auth_type="basic"
        )
        
        return {
            "success": True,
            "orderId": result.get('id') or result.get('orderId') or result.get('orderCode') or result.get('clientOrderId'),
            "data": result
        }
    
    except Exception as e:
        logger.error(f"Bot order placement failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/orders/account/modify")
async def modify_account_order(
    request: ModifyAccountOrderRequest,
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Modify an order on /dxsca-web/accounts/{accountCode}/orders with conditional If-Match header."""
    try:
        token = x_liquid_token or get_user_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        if not request.account_code:
            raise HTTPException(status_code=400, detail="account_code is required")

        if not request.if_match:
            raise HTTPException(status_code=403, detail="Conditional request required (If-Match)")

        if not isinstance(request.order, dict) or not request.order:
            raise HTTPException(status_code=400, detail="order payload is required")

        result = await LiquidChartsAPI.modify_account_order(
            account_code=request.account_code,
            order_payload=request.order,
            if_match=request.if_match,
            token=token,
            auth_type="basic" if x_liquid_token else "bearer",
        )
        return result
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/orders/cancel")
async def cancel_order(request: CancelOrderRequest, authorization: Optional[str] = Header(default=None)):
    """Cancel an existing order"""
    try:
        token = get_user_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        result = await LiquidChartsAPI.cancel_order(request.order_id, token)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/orders/account/cancel")
async def cancel_account_order(
    request: CancelAccountOrderRequest,
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Cancel single order on /dxsca-web/accounts/{accountCode}/orders/{orderCode} with If-Match."""
    try:
        token = x_liquid_token or get_user_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        if not request.account_code:
            raise HTTPException(status_code=400, detail="account_code is required")
        if not request.order_code:
            raise HTTPException(status_code=400, detail="order_code is required")
        if not request.if_match:
            raise HTTPException(status_code=403, detail="Conditional request required (If-Match)")

        result = await LiquidChartsAPI.cancel_account_order(
            account_code=request.account_code,
            order_code=request.order_code,
            if_match=request.if_match,
            token=token,
            auth_type="basic" if x_liquid_token else "bearer",
        )
        return result
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/orders/account/cancel-group")
async def cancel_account_order_group(
    request: CancelAccountOrderGroupRequest,
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Cancel order group on /dxsca-web/accounts/{accountCode}/orders/group with If-Match."""
    try:
        token = x_liquid_token or get_user_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        if not request.account_code:
            raise HTTPException(status_code=400, detail="account_code is required")
        if not request.order_codes:
            raise HTTPException(status_code=400, detail="order_codes is required")
        if not request.contingency_type:
            raise HTTPException(status_code=400, detail="contingency_type is required")
        if not request.if_match:
            raise HTTPException(status_code=403, detail="Conditional request required (If-Match)")

        result = await LiquidChartsAPI.cancel_account_order_group(
            account_code=request.account_code,
            order_codes=request.order_codes,
            contingency_type=request.contingency_type,
            if_match=request.if_match,
            token=token,
            auth_type="basic" if x_liquid_token else "bearer",
        )
        return result
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/orders/{order_id}")
async def get_order(order_id: str, authorization: Optional[str] = Header(default=None)):
    """Get order details"""
    try:
        token = get_user_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        order = await LiquidChartsAPI.get_order(order_id, token)
        return order
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/orders")
async def get_orders(authorization: Optional[str] = Header(default=None)):
    """Get all active orders"""
    try:
        token = get_user_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        orders = await LiquidChartsAPI.get_orders(token)
        return orders
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/orders/history")
async def get_order_history(authorization: Optional[str] = Header(default=None)):
    """Get order history"""
    try:
        token = get_user_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        history = await LiquidChartsAPI.get_order_history(token)
        return history
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ===== Account Endpoints =====
@router.get("/account")
async def get_account(authorization: Optional[str] = Header(default=None)):
    """Get account information"""
    try:
        token = get_user_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        account = await LiquidChartsAPI.get_account_info(token)
        return account
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/account/balance")
async def get_balance(authorization: Optional[str] = Header(default=None)):
    """Get account balance"""
    try:
        token = get_user_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        balance = await LiquidChartsAPI.get_balance(token)
        return balance
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/account/positions")
async def get_positions(authorization: Optional[str] = Header(default=None)):
    """Get current positions"""
    try:
        token = get_user_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        positions = await LiquidChartsAPI.get_positions(token)
        return positions
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/account/events")
async def get_account_events(authorization: Optional[str] = Header(default=None)):
    """Get account history/events"""
    try:
        token = get_user_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        events = await LiquidChartsAPI.get_account_events(token)
        return events
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/account/metrics")
async def get_account_metrics(
    account_code: Optional[str] = Query(default=None),
    accounts: Optional[str] = Query(default=None),
    include_positions: bool = Query(default=False),
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Get live account metrics (equity, PnL, and optional position-level metrics)."""
    try:
        token, auth_type = get_auth_context(authorization, x_liquid_token)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        metrics = await LiquidChartsAPI.get_account_metrics(
            account_code=account_code,
            accounts=accounts,
            include_positions=include_positions,
            token=token,
            auth_type=auth_type,
        )
        return metrics
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ===== Users & Accounts Endpoints (dxsca-web) =====
@router.get("/users")
@router.get("/users/{username}")
async def get_users(
    request: Request,
    username: Optional[str] = None,
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Get one user or list of users from dxsca-web/users."""
    try:
        token, auth_type = get_auth_context(authorization, x_liquid_token)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        filters = dict(request.query_params)
        result = await LiquidChartsAPI.get_users(
            token=token,
            auth_type=auth_type,
            username=username,
            filters=filters,
        )
        return result
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/accounts/portfolio")
async def get_account_portfolio(
    account_code: Optional[str] = Query(default=None),
    accounts: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Get account portfolio for one or multiple accounts."""
    try:
        token, auth_type = get_auth_context(authorization, x_liquid_token)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        result = await LiquidChartsAPI.get_account_portfolio(
            account_code=account_code,
            accounts=accounts,
            token=token,
            auth_type=auth_type,
        )
        return result
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/accounts/positions")
async def get_open_positions(
    account_code: Optional[str] = Query(default=None),
    accounts: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Get open positions for one or multiple accounts."""
    try:
        token, auth_type = get_auth_context(authorization, x_liquid_token)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        result = await LiquidChartsAPI.get_open_positions(
            account_code=account_code,
            accounts=accounts,
            token=token,
            auth_type=auth_type,
        )
        return result
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/accounts/open-orders")
async def get_open_orders_dxsca(
    account_code: Optional[str] = Query(default=None),
    accounts: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Get open orders for one or multiple accounts."""
    try:
        token, auth_type = get_auth_context(authorization, x_liquid_token)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        result = await LiquidChartsAPI.get_open_orders(
            account_code=account_code,
            accounts=accounts,
            token=token,
            auth_type=auth_type,
        )
        return result
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/accounts/transfers")
async def get_cash_transfers(
    request: Request,
    account_code: Optional[str] = Query(default=None),
    accounts: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Get cash transfers for one or multiple accounts."""
    try:
        token, auth_type = get_auth_context(authorization, x_liquid_token)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        filters = dict(request.query_params)
        filters.pop("account_code", None)
        filters.pop("accounts", None)

        result = await LiquidChartsAPI.get_cash_transfers(
            account_code=account_code,
            accounts=accounts,
            filters=filters,
            token=token,
            auth_type=auth_type,
        )
        return result
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/accounts/orders/history")
async def get_orders_history_dxsca(
    request: Request,
    account_code: Optional[str] = Query(default=None),
    accounts: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Get historical orders (GET) for one or multiple accounts."""
    try:
        token, auth_type = get_auth_context(authorization, x_liquid_token)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        filters = dict(request.query_params)
        filters.pop("account_code", None)
        filters.pop("accounts", None)

        result = await LiquidChartsAPI.list_orders_history(
            account_code=account_code,
            accounts=accounts,
            filters=filters,
            token=token,
            auth_type=auth_type,
            use_post=False,
        )
        return result
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/accounts/orders/history")
async def post_orders_history_dxsca(
    payload: ListOrdersHistoryRequest,
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Get historical orders (POST) for one or multiple accounts."""
    try:
        token, auth_type = get_auth_context(authorization, x_liquid_token)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        result = await LiquidChartsAPI.list_orders_history(
            account_code=payload.account_code,
            accounts=payload.accounts,
            filters=payload.filters,
            token=token,
            auth_type=auth_type,
            use_post=True,
        )
        return result
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/accounts/events")
async def get_account_events_dxsca(
    request: Request,
    account_code: Optional[str] = Query(default=None),
    accounts: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
    x_liquid_token: Optional[str] = Header(default=None, alias="X-Liquid-Token"),
):
    """Get account events for one or multiple accounts."""
    try:
        token, auth_type = get_auth_context(authorization, x_liquid_token)
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        filters = dict(request.query_params)
        filters.pop("account_code", None)
        filters.pop("accounts", None)

        result = await LiquidChartsAPI.get_account_events_dxsca(
            account_code=account_code,
            accounts=accounts,
            filters=filters,
            token=token,
            auth_type=auth_type,
        )
        return result
    except httpx.HTTPStatusError as e:
        response_body = None
        try:
            response_body = e.response.json()
        except Exception:
            response_body = e.response.text
        raise HTTPException(status_code=e.response.status_code, detail=response_body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
