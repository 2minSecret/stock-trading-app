#!/usr/bin/env python3
"""
Test the marketdata endpoint with the new payload variants
"""
import asyncio
import httpx
import json
import os
import sys

# Get credentials from environment or command line
username = os.getenv("LIQUID_USERNAME", "demo")
domain = os.getenv("LIQUID_DOMAIN", "test")
password = os.getenv("LIQUID_PASSWORD", "demo123")

# Check if provided as CLI args
if len(sys.argv) > 1:
    username = sys.argv[1]
if len(sys.argv) > 2:
    domain = sys.argv[2]
if len(sys.argv) > 3:
    password = sys.argv[3]

async def test_marketdata():
    """Test the /api/trading/marketdata endpoint"""
    
    async with httpx.AsyncClient(base_url="http://localhost:8001") as client:
        print("=" * 70)
        print("1. Testing Basic Auth Login")
        print("=" * 70)
        
        login_response = await client.post(
            "/api/trading/auth/basic/login",
            json={"username": username, "domain": domain, "password": password}
        )
        
        print(f"Status: {login_response.status_code}")
        
        if login_response.status_code != 200:
            print(f"Login failed: {login_response.text}")
            return
        
        login_data = login_response.json()
        token = login_data.get("token")
        
        if not token:
            print(f"No token in response: {login_data}")
            return
        
        print(f"✓ Login successful")
        print(f"  Token: {token[:20]}...")
        
        print("\n" + "=" * 70)
        print("2. Testing /api/trading/marketdata with candles request")
        print("=" * 70)
        
        headers = {"X-Liquid-Token": token}
        
        marketdata_payload = {
            "request": {
                "symbols": ["NAS100"],
                "timeframe": "1h",
                "limit": 200,
                "type": "candles",
                "market": "spot"
            }
        }
        
        print(f"\nRequest payload: {json.dumps(marketdata_payload, indent=2)}")
        
        response = await client.post(
            "/api/trading/marketdata",
            json=marketdata_payload,
            headers=headers
        )
        
        print(f"\nResponse Status: {response.status_code}")
        
        try:
            response_data = response.json()
            print(f"Response body:\n{json.dumps(response_data, indent=2)}")
            
            if response.status_code == 200:
                print("\n✓ SUCCESS! Got candles data")
                # Check if we have the expected data
                if isinstance(response_data, dict):
                    num_candles = len(response_data.get("data", []))
                    print(f"  Received {num_candles} candles")
            elif response.status_code == 400:
                error_msg = response_data.get("detail", {})
                print(f"\n✗ Bad Request Error: {error_msg}")
                if isinstance(error_msg, dict) and "upstream" in error_msg:
                    print(f"  Upstream error: {error_msg['upstream']}")
            else:
                print(f"\n✗ Unexpected status: {response.status_code}")
                
        except Exception as e:
            print(f"Response text: {response.text}")
            print(f"Error parsing response: {e}")
        
        print("\n" + "=" * 70)

# Run the test
if __name__ == "__main__":
    print(f"Testing with credentials: {username}@{domain}")
    asyncio.run(test_marketdata())
