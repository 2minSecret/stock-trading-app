"""
Test script to diagnose Liquid Charts API issues
"""
import httpx
import asyncio
import os
from dotenv import load_dotenv

load_dotenv()

LIQUID_API_BASE = os.getenv("LIQUID_API_URL", "https://api.liquidcharts.com/v1")
LIQUID_BASIC_AUTH_PREFIX = os.getenv("LIQUID_BASIC_AUTH_PREFIX", "")

async def test_api(token: str, symbol: str = "NAS100"):
    """Test API calls with different configurations"""
    
    print(f"Testing Liquid Charts API")
    print(f"Base URL: {LIQUID_API_BASE}")
    print(f"Auth Prefix: '{LIQUID_BASIC_AUTH_PREFIX}'")
    print(f"Token length: {len(token)}")
    print(f"Symbol: {symbol}")
    print("-" * 60)
    
    # Test 1: Basic auth headers
    auth_value = f"{LIQUID_BASIC_AUTH_PREFIX}{token}" if LIQUID_BASIC_AUTH_PREFIX else token
    headers = {
        "Authorization": auth_value,
        "X-Liquid-Token": token
    }
    
    async with httpx.AsyncClient(base_url=LIQUID_API_BASE, timeout=30.0) as client:
        # Test /price-history endpoint
        print("\n1. Testing /price-history endpoint...")
        try:
            response = await client.get(
                "/price-history",
                params={"symbol": symbol, "timeframe": "1h", "limit": 10},
                headers=headers
            )
            print(f"Status: {response.status_code}")
            print(f"Content-Type: {response.headers.get('content-type')}")
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    print(f"Success! Got {len(data.get('data', []))} candles")
                    print(f"Response keys: {list(data.keys())}")
                except Exception as e:
                    print(f"JSON parse error: {e}")
                    print(f"Response text (first 500 chars): {response.text[:500]}")
            else:
                print(f"Error response:")
                print(f"Text (first 500 chars): {response.text[:500]}")
                
        except Exception as e:
            print(f"Request failed: {e}")
        
        # Test with alternative symbol formats
        print("\n2. Testing alternative symbol formats...")
        alt_symbols = [
            "US100",  # Common alternative for NAS100
            "NAS100.I",  # Index format
            "AAPL",  # Try a stock symbol
            "EURUSD",  # Try forex
        ]
        
        for alt_symbol in alt_symbols:
            try:
                response = await client.get(
                    "/price-history",
                    params={"symbol": alt_symbol, "timeframe": "1h", "limit": 2},
                    headers=headers
                )
                status_ok = "✓" if response.status_code == 200 else "✗"
                print(f"{status_ok} {alt_symbol}: {response.status_code}")
            except Exception as e:
                print(f"✗ {alt_symbol}: {e}")
        
        # Test if there's a symbols list endpoint
        print("\n3. Checking common API endpoints...")
        test_endpoints = [
            "/symbols",
            "/instruments",
            "/markets",
            "/status",
            "/health"
        ]
        
        for endpoint in test_endpoints:
            try:
                response = await client.get(endpoint, headers=headers)
                if response.status_code == 200:
                    print(f"✓ {endpoint}: Available")
                    try:
                        data = response.json()
                        print(f"  Keys: {list(data.keys())[:5]}")
                    except:
                        pass
            except:
                pass

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python test_liquid_api.py YOUR_TOKEN [SYMBOL]")
        print("Example: python test_liquid_api.py 5gt3lmo3u90kh6t4mmboraom6n NAS100")
        sys.exit(1)
    
    token = sys.argv[1]
    symbol = sys.argv[2] if len(sys.argv) > 2 else "NAS100"
    
    asyncio.run(test_api(token, symbol))
