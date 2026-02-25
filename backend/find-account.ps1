# Login and Discover Account Codes for Liquid Charts
Write-Host "=== Liquid Charts Account Discovery ===" -ForegroundColor Cyan
Write-Host ""

$username = Read-Host "Enter your username"
$domain = Read-Host "Enter your domain"
$password = Read-Host "Enter your password" -AsSecureString
$passwordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))

Write-Host "`nLogging in..." -ForegroundColor Yellow

$loginBody = @{
    username = $username
    domain = $domain
    password = $passwordPlain
} | ConvertTo-Json

try {
    $login = Invoke-RestMethod -Uri "http://localhost:8001/api/trading/auth/basic/login" -Method POST -ContentType "application/json" -Body $loginBody -TimeoutSec 10
    Write-Host "Login successful!" -ForegroundColor Green
    Write-Host "`nLOGIN RESPONSE:" -ForegroundColor Cyan
    $login | ConvertTo-Json -Depth 3
    
    $token = $login.token
    if (-not $token) {
        Write-Host "`nWarning: No 'token' field found in response" -ForegroundColor Yellow
        Write-Host "Trying to extract token from response..." -ForegroundColor Yellow
        # Try common alternative field names
        $token = if ($login.sessionToken) { $login.sessionToken }
                elseif ($login.authToken) { $login.authToken }
                elseif ($login.data.token) { $login.data.token }
                elseif ($login.'session-token') { $login.'session-token' }
                else { $null }
    }
    
    if ($token) {
        Write-Host "`nToken: $($token.Substring(0,[Math]::Min(30,$token.Length)))..." -ForegroundColor Gray
    } else {
        Write-Host "`nERROR: Could not find token in response!" -ForegroundColor Red
        return
    }
    
    Write-Host "`nFetching portfolio..." -ForegroundColor Yellow
    try {
        $portfolio = Invoke-RestMethod -Uri "http://localhost:8001/api/trading/accounts/portfolio" -Headers @{"X-Liquid-Token"=$token}
        Write-Host "`nPORTFOLIO DATA:" -ForegroundColor Cyan
        $portfolio | ConvertTo-Json -Depth 5
    } catch {
        Write-Host "Could not fetch portfolio: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Write-Host "`n=== TO FIX YOUR BUY/SELL ===" -ForegroundColor Yellow
    Write-Host "1. Find your account code in the JSON above" -ForegroundColor White
    Write-Host "2. Update frontend/src/App.jsx line 18" -ForegroundColor White
    Write-Host "3. Replace 'DEMO-ACCOUNT' with your real code" -ForegroundColor White
    
} catch {
    Write-Host "Login failed: $($_.Exception.Message)" -ForegroundColor Red
}
