import requests

BASE_URL = "http://127.0.0.1:8001/api/trading"
USER = "elyasaf2020@gmail.com"
PASSWORD = "Y4^xTO*2]>"
SYMBOL = "NAS100"
ACCOUNT_CODE = "default:DEM_3063067_1"

# Login
print("[TEST] Logging in...")
login_resp = requests.post(f"{BASE_URL}/auth/basic/login", json={
    "username": USER,
    "domain": "default",
    "password": PASSWORD
})
if login_resp.status_code != 200:
    print(f"[LOGIN] Failed: {login_resp.status_code} {login_resp.text}")
    exit(1)
login_data = login_resp.json()
token = login_data.get("token") or login_data.get("sessionToken")
if not token:
    print("[LOGIN] No token received.")
    exit(1)
print("[TEST] Login successful.")

headers = {"X-Liquid-Token": token}

# Buy
print("[TEST] Performing buy...")
buy_payload = {
    "account_code": ACCOUNT_CODE,
    "order": {
        "clientOrderId": f"test-buy-{USER}",
        "instrument": SYMBOL,
        "side": "BUY",
        "type": "MARKET",
        "quantity": 1
    }
}
buy_resp = requests.post(f"{BASE_URL}/orders/account/place", json=buy_payload, headers=headers)
print(f"[BUY] Response: {buy_resp.status_code} {buy_resp.text}")

# Sell
print("[TEST] Performing sell...")
sell_payload = {
    "account_code": ACCOUNT_CODE,
    "order": {
        "clientOrderId": f"test-sell-{USER}",
        "instrument": SYMBOL,
        "side": "SELL",
        "type": "MARKET",
        "quantity": 1
    }
}
sell_resp = requests.post(f"{BASE_URL}/orders/account/place", json=sell_payload, headers=headers)
print(f"[SELL] Response: {sell_resp.status_code} {sell_resp.text}")

# Logout
print("[TEST] Logging out...")
logout_resp = requests.post(f"{BASE_URL}/auth/logout", headers=headers)
print(f"[LOGOUT] Response: {logout_resp.status_code} {logout_resp.text}")

print("[TEST] Done.")
