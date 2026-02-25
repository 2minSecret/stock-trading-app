#!/usr/bin/env powershell
# Quick test to see variant payloads in backend logs

param(
    [string]$Token = "16g1rj6dcotimr84bos77kkr7i"
)

Write-Host "Making request with token: $($Token.Substring(0,20))..." -ForegroundColor Cyan
Write-Host ""

$payload = @{
    request = @{
        symbols = @("NAS100")
        timeframe = "1h"
        limit = 200
        type = "candles"
        market = "spot"
    }
} | ConvertTo-Json -Depth 5

Write-Host "Sending request to /api/trading/marketdata..." -ForegroundColor Yellow
Write-Host "Payload: $payload" -ForegroundColor Gray

try {
    $response = Invoke-WebRequest -Uri 'http://localhost:8001/api/trading/marketdata' `
        -Method POST `
        -Body $payload `
        -ContentType 'application/json' `
        -Headers @{'X-Liquid-Token' = $Token} `
        -ErrorAction Stop
    
    Write-Host "✓ SUCCESS! Status: $($response.StatusCode)" -ForegroundColor Green
    $body = $response.Content | ConvertFrom-Json
    Write-Host "Response items: $(($body.data | Measure-Object).Count)" -ForegroundColor Green
} catch {
    Write-Host "✗ ERROR: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    try {
        $errorBody = $_.ErrorDetails.Message | ConvertFrom-Json
        Write-Host "Details: $(ConvertTo-Json $errorBody)" -ForegroundColor Red
    } catch {
        Write-Host "Response: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Check backend logs above for 'DEBUG: Trying marketdata variant' messages" -ForegroundColor Cyan
