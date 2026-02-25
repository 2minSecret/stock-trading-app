# Login and Discover Account Codes Script
# This will help you find your real account codes for trading

Write-Host "=== Liquid Charts Account Discovery ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Get credentials
$username = Read-Host "Enter your Liquid Charts username"
$password = Read-Host "Enter your password" -AsSecureString
$passwordPlainText = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))

Write-Host "`nStep 1: Logging in..." -ForegroundColor Yellow

# Login
$loginBody = @{
    username = $username
    password = $passwordPlainText
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Uri "http://localhost:8001/api/trading/auth/basic/login" `
        -Method POST `
        -ContentType "application/json" `
        -Body $loginBody `
        -TimeoutSec 10

    $token = $loginResponse.token
    Write-Host "✓ Login successful!" -ForegroundColor Green
    Write-Host "  Token: $($token.Substring(0,30))..." -ForegroundColor Gray
    Write-Host ""

    # Step 2: Try to get users info
    Write-Host "Step 2: Fetching user account information..." -ForegroundColor Yellow
    
    try {
        $usersData = Invoke-RestMethod -Uri "http://localhost:8001/api/trading/users/$username" `
            -Method GET `
            -Headers @{"X-Liquid-Token" = $token} `
            -TimeoutSec 10
        
        Write-Host "✓ User data retrieved!" -ForegroundColor Green
        Write-Host "`n=== YOUR ACCOUNT INFORMATION ===" -ForegroundColor Cyan
        $usersData | ConvertTo-Json -Depth 5 | Write-Host
        
        # Try to extract account codes
        if ($usersData.accounts) {
            Write-Host "`n=== FOUND ACCOUNT CODES ===" -ForegroundColor Green
            $usersData.accounts | ForEach-Object {
                Write-Host "  - $($_.code)" -ForegroundColor Yellow
            }
        }
    }
    catch {
        Write-Host "  Note: Could not fetch user details" -ForegroundColor Gray
    }

    # Step 3: Try to get portfolio
    Write-Host "`nStep 3: Fetching portfolio to discover accounts..." -ForegroundColor Yellow
    
    try {
        $portfolio = Invoke-RestMethod -Uri "http://localhost:8001/api/trading/accounts/portfolio" `
            -Method GET `
            -Headers @{"X-Liquid-Token" = $token} `
            -TimeoutSec 10
        
        Write-Host "✓ Portfolio data retrieved!" -ForegroundColor Green
        Write-Host "`n=== YOUR PORTFOLIO ===" -ForegroundColor Cyan
        $portfolio | ConvertTo-Json -Depth 5 | Write-Host
    }
    catch {
        Write-Host "  Could not fetch portfolio" -ForegroundColor Gray
    }

    Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
    Write-Host "Your session token: $token" -ForegroundColor White
    Write-Host "`nReview the JSON output above to find your account code(s)." -ForegroundColor White
    Write-Host "Look for fields like 'accountCode', 'code', 'account', etc." -ForegroundColor Gray

} catch {
    Write-Host "✗ Login failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== Script Complete ===" -ForegroundColor Cyan
