import requests
import uuid
import time

BASE_URL = "https://api.liquidcharts.com/dxsca-web/accounts"
USER = "elyasaf2020@gmail.com"
PASSWORD = "Y4^xTO*2]>"
ACCOUNT_CODE = "default:DEM_3063067_1"
SYMBOL = "NAS100"

# Login (simulate, since direct API may require session token or basic auth)
# If you have a session token, use it. Otherwise, use basic auth.

# Prepare order payload
order_payload = {
    "clientOrderId": f"test-{uuid.uuid4().hex[:8]}",
    "instrument": SYMBOL,
    "side": "BUY",
    "type": "MARKET",
    "quantity": 1,
}

# Place order
print("[TEST] Placing order directly to LiquidCharts API...")
url = f"{BASE_URL}/{ACCOUNT_CODE}/orders"
headers = {
    "Authorization": f"Basic {USER}:{PASSWORD}",
    "Content-Type": "application/json"
}
resp = requests.post(url, json=order_payload, headers=headers)
print(f"[ORDER] Response: {resp.status_code} {resp.text}")
