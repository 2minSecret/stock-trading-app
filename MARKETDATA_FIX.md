# Liquid Charts API - Marketdata Payload Fix

## Problem
The `/api/trading/marketdata` endpoint was failing with `"Incorrect request parameters: <null>"` after successfully authenticating. This indicated that the payload format being sent wasn't matching what the upstream `dxsca-web/marketdata` API expected.

## Root Cause
The upstream Liquid Charts DXSCA API has very strict payload validation:
- Previous error showed missing `eventTypes` field (we fixed that)
- Latest error showed `<null>` parameters, meaning fields like `limit`, `market`, or `timeframe` weren't recognized or were being processed as null values

## Solution Implemented

### 1. Enhanced Payload Variant Generation
Modified `LiquidChartsAPI._marketdata_payload_variants()` to generate 6 progressive variants:
- **Variant 1**: Full ` payload with `eventTypes: ["CANDLE"]`
- **Variant 2**: Full payload with `eventTypes: "CANDLE"` (string instead of array)
- **Variant 3**: Drop `limit` field
- **Variant 4**: Drop `market` field  
- **Variant 5**: Minimal payload - only `symbols` + `eventTypes: ["CANDLE"]` (no `limit`, `market`, `timeframe`)
- **Variant 6**: Minimal payload with `eventTypes: ["CANDLES"]` (plural)

This ensures that even if certain fields aren't recognized, a simpler payload will eventually succeed.

### 2. Improved Retry Logic
Modified `LiquidChartsAPI.post_market_data()` to:
- **Retry on ANY 400 error**, not just eventTypes validation errors
- This means the `<null>` error will now trigger automatic retry with the next variant
- Previous logic only retried if the error message contained "eventTypes", which would skip over `<null>` errors

### 3. Better Error Logging
Enhanced error messages to show which variant was rejected and why, making debugging easier.

## Testing

### Local Test Command
From the `backend/` directory:

```bash
# Ensure backend is running on port 8001
python -m uvicorn main:app --reload --port 8001
```

Then from browser or Postman:
1. **Login** to get a session token:
   ```
   POST http://localhost:8001/api/trading/auth/basic/login
   Content-Type: application/json
   
   {
     "username": "your_username",
     "domain": "your_domain",
     "password": "your_password"
   }
   ```

2. **Request Market Data**:
   ```
   POST http://localhost:8001/api/trading/marketdata
   Content-Type: application/json
   X-Liquid-Token: <token_from_step_1>
   
   {
     "request": {
       "symbols": ["NAS100"],
       "timeframe": "1h",
       "limit": 200,
       "type": "candles",
       "market": "spot"
     }
   }
   ```

### Expected Behavior
- **Before Fix**: Would fail with `"Incorrect request parameters: <null>"` after trying fixed number of variants
- **After Fix**: Should either:
  - ✅ **Success (200)**: Return candles data (variant matched the upstream's expectations)
  - 📋 **Successful Retry**: See log message like "marketdata variant #1 rejected; retrying variant #2" and eventually succeed
  - ❌ **Eventual Failure**: If all 6 variants fail, error message will show detailed upstream response

### Checking Backend Logs
Look for messages like:
```
INFO: marketdata succeeded with compatibility payload variant #5
```

This indicates which variant configuration worked.

## Code Changes

### File: `backend/liquid_charts_api.py`

#### Change 1: `_marketdata_payload_variants()` (lines 64-155)
- Generates 6 progressive variants instead of 5
- Each variant drops one or more fields progressively
- Better comments explaining the strategy

#### Change 2: `post_market_data()` retry logic (lines 336-353)
- Retries on ANY 400 error, not just eventTypes
- Extracts error description for better logging
- Simple condition: `is_param_error = (e.response.status_code == 400 and index < len(variants) - 1)`

## Why This Works

The upstream API is strict about payload format. By trying progressively simpler payloads:
1. If it accepts complex payloads, Variant #1 or #2 will succeed
2. If it only accepts certain fields, variant #3-4 will handle it
3. If it only accepts minimal payload, variant #5-6 will succeed
4. The retry logic ensures we try all variants automatically, no manual intervention needed

## Next Steps if Still Failing

If the issue persists after this fix, you would need to:
1. Check the backend logs to see which variant failed
2. Examine the exact upstream error message from the last variant
3. Look at the Liquid Charts API documentation for `dxsca-web/marketdata` endpoint
4. Add a new variant if a different field combination is needed

## Files Modified
- `backend/liquid_charts_api.py` - Enhanced variant generation and retry logic
