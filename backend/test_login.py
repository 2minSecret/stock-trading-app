"""
Tests for the /api/trading/auth/basic/login endpoint.

Checks that the login flow behaves correctly for:
- Successful login (upstream returns a session token)
- Invalid credentials (upstream returns 401)
- Missing required fields (FastAPI validation)
- Network errors reaching the upstream auth service
- Real-credential integration test (skipped when env vars are absent)

Real-credential integration test usage
---------------------------------------
Set the following environment variables before running pytest to exercise the
live Liquid Charts authentication service:

    LIQUID_TEST_USERNAME=<your email>
    LIQUID_TEST_PASSWORD=<your password>

Example:
    LIQUID_TEST_USERNAME=user@example.com LIQUID_TEST_PASSWORD=secret pytest backend/test_login.py::test_login_real_credentials -v
"""

import json
import os
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_session_token(payload: dict):
    """
    Return the session token from an upstream login response or None.

    The Liquid Charts API may return the token under several different key
    names.  This helper mirrors the logic in the frontend's
    ``extractSessionToken`` function in ``liquidChartsClient.js``.
    """
    top_level_keys = (
        "token", "accessToken", "sessionToken", "sessionID",
        "sessionId", "sid", "id", "authToken",
    )
    return (
        next((payload[k] for k in top_level_keys if payload.get(k)), None)
        or payload.get("session", {}).get("token")
        or payload.get("session", {}).get("id")
        or payload.get("data", {}).get("token")
        or payload.get("data", {}).get("sessionToken")
    )


# ---------------------------------------------------------------------------
# Real-credential integration test
# ---------------------------------------------------------------------------

@pytest.mark.skipif(
    not os.environ.get("LIQUID_TEST_USERNAME") or not os.environ.get("LIQUID_TEST_PASSWORD"),
    reason="Set LIQUID_TEST_USERNAME and LIQUID_TEST_PASSWORD env vars to run the live login test",
)
def test_login_real_credentials():
    """
    Integration test: attempt a real login against the upstream Liquid Charts API.

    Skipped automatically when the required environment variables are absent so
    the test suite remains safe to run in CI without live credentials.

    Run manually with:
        LIQUID_TEST_USERNAME=user@example.com \\
        LIQUID_TEST_PASSWORD=secret \\
        pytest backend/test_login.py::test_login_real_credentials -v -s
    """
    username = os.environ["LIQUID_TEST_USERNAME"]
    password = os.environ["LIQUID_TEST_PASSWORD"]

    resp = client.post(
        LOGIN_URL,
        json={"username": username, "domain": "", "password": password},
    )

    # A 400 whose detail mentions a hostname / address / connect error means the
    # upstream is not reachable from this environment (e.g. a sandboxed CI runner
    # with no internet access).  Skip instead of failing so the test doesn't
    # produce a misleading red result when the credentials themselves are correct.
    if resp.status_code == 400:
        detail = resp.json().get("detail", "")
        network_indicators = (
            "No address associated with hostname",
            "ConnectError",
            "Connection refused",
            "Name or service not known",
            "getaddrinfo failed",
        )
        if any(indicator in detail for indicator in network_indicators):
            pytest.skip(
                f"Upstream Liquid Charts API is not reachable from this environment "
                f"(network error: {detail}). Run this test on a machine with internet access."
            )

    assert resp.status_code == 200, (
        f"Login failed with status {resp.status_code}. "
        f"Response body: {resp.text[:500]}"
    )

    body = resp.json()
    session_token = _extract_session_token(body)

    assert session_token, (
        f"Login returned 200 but no session token was found in response body. "
        f"Full body: {json.dumps(body, indent=2)}"
    )

    # Avoid printing token values in logs; just confirm a token was received.
    print(f"\n✅ Login succeeded. Session token received (key count: {len(body)}).")

