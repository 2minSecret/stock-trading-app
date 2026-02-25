#!/usr/bin/env python3
"""Test the /api/trading/marketdata endpoint"""

import requests
import json
import time
import sys

# Wait for server to be ready
print("Waiting for server...", flush=True)
time.sleep(2)

url = "http://localhost:8001/api/trading/marketdata"
token = "687hcmjpqorkr44te96gbteo25"
headers = {
    "Content-Type": "application/json",
    "X-Liquid-Token": token
}
body = {
    "request": {
        "symbols": ["AAPL"],
        "market": "spot",
        "type": "quote"
    }
}

print(f"Testing: POST {url}", flush=True)
print(f"Token: {token}", flush=True)
print(f"Request body: {json.dumps(body, indent=2)}", flush=True)
print("-" * 60, flush=True)

try:
    response = requests.post(url, json=body, headers=headers, timeout=15)
    print(f"Status Code: {response.status_code}", flush=True)
    print(f"Response Headers: {dict(response.headers)}", flush=True)
    print(f"Response Body:", flush=True)
    print(json.dumps(response.json(), indent=2), flush=True)
except requests.exceptions.ConnectionError as e:
    print(f"Connection Error: {e}", flush=True)
    sys.exit(1)
except Exception as e:
    print(f"Error: {type(e).__name__}: {e}", flush=True)
    sys.exit(1)
