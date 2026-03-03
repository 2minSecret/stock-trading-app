"""
Tests for the /api/trading/auth/basic/login endpoint.

Checks that the login flow behaves correctly for:
- Successful login (upstream returns a session token)
- Invalid credentials (upstream returns 401)
- Missing required fields (FastAPI validation)
- Network errors reaching the upstream auth service
"""

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

LOGIN_URL = "/api/trading/auth/basic/login"


def _make_httpx_response(status_code: int, json_body: dict) -> httpx.Response:
    """Build a minimal httpx.Response that can be used in HTTPStatusError."""
    response = httpx.Response(
        status_code=status_code,
        content=json.dumps(json_body).encode(),
        headers={"content-type": "application/json"},
        request=httpx.Request("POST", "https://api.liquidcharts.com/dxsca-web/login"),
    )
    return response


# ---------------------------------------------------------------------------
# Successful login
# ---------------------------------------------------------------------------

def test_login_success():
    """A valid credentials response from upstream is forwarded to the caller."""
    upstream_payload = {"sessionToken": "abc123", "userId": "user-1"}

    with patch(
        "liquid_charts_api.LiquidChartsAPI.basic_login",
        new_callable=AsyncMock,
        return_value=upstream_payload,
    ):
        resp = client.post(
            LOGIN_URL,
            json={"username": "user@example.com", "domain": "", "password": "secret"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["sessionToken"] == "abc123"


# ---------------------------------------------------------------------------
# Invalid credentials
# ---------------------------------------------------------------------------

def test_login_invalid_credentials():
    """Upstream 401 maps to a 401 from our proxy endpoint."""
    upstream_resp = _make_httpx_response(401, {"detail": "Invalid credentials"})
    http_error = httpx.HTTPStatusError(
        "401 Unauthorized",
        request=upstream_resp.request,
        response=upstream_resp,
    )

    with patch(
        "liquid_charts_api.LiquidChartsAPI.basic_login",
        new_callable=AsyncMock,
        side_effect=http_error,
    ):
        resp = client.post(
            LOGIN_URL,
            json={"username": "user@example.com", "domain": "", "password": "wrong"},
        )

    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Missing required fields
# ---------------------------------------------------------------------------

def test_login_missing_username():
    """Request without 'username' field fails FastAPI validation (422)."""
    resp = client.post(
        LOGIN_URL,
        json={"domain": "", "password": "secret"},
    )
    assert resp.status_code == 422


def test_login_missing_password():
    """Request without 'password' field fails FastAPI validation (422)."""
    resp = client.post(
        LOGIN_URL,
        json={"username": "user@example.com", "domain": ""},
    )
    assert resp.status_code == 422


def test_login_empty_body():
    """Empty body fails FastAPI validation (422)."""
    resp = client.post(LOGIN_URL, json={})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Network / connection errors
# ---------------------------------------------------------------------------

def test_login_network_error():
    """When the upstream server is unreachable the endpoint returns 400."""
    with patch(
        "liquid_charts_api.LiquidChartsAPI.basic_login",
        new_callable=AsyncMock,
        side_effect=httpx.ConnectError("Connection refused"),
    ):
        resp = client.post(
            LOGIN_URL,
            json={"username": "user@example.com", "domain": "", "password": "secret"},
        )

    assert resp.status_code == 400
    assert "Connection refused" in resp.json().get("detail", "")
