#!/usr/bin/env python3
"""Simple test to see what the endpoint returns"""

import requests
import time
import json

time.sleep(2)

url = "http://localhost:8001/api/trading/marketdata"
token = "687hcmjpqorkr44te96gbteo25"
headers = {"X-Liquid-Token": token}
body = {"request": {"symbols": ["AAPL"], "market": "spot", "type": "quote"}}

print(f"URL: {url}")
print(f"Token: {token}")
print(f"Body: {json.dumps(body)}")
print("-" * 60)

try:
    resp = requests.post(url, json=body, headers=headers, timeout=10)
    print(f"Status: {resp.status_code}")
    print(f"Content-Type: {resp.headers.get('content-type', 'N/A')}")
    print(f"Response length: {len(resp.text)} chars")
    print("-" * 60)
    print("First 1000 chars of response:")
    print(resp.text[:1000])
    print("...\n")
    
    # Try to parse as JSON
    try:
        data = resp.json()
        print("Successfully parsed as JSON!")
        print(json.dumps(data, indent=2)[:2000])
    except:
        print("No not valid JSON")
        
except Exception as e:
    print(f"Error: {e}")
