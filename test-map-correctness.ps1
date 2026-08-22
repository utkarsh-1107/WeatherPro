$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "WeatherPro stable map diagnostics" -ForegroundColor Cyan
Write-Host ""

$base = "http://localhost:3000"

try {
    Invoke-WebRequest `
        -Uri "$base/api/weather?lat=19.11&lon=72.87&timezone=Asia%2FKolkata" `
        -UseBasicParsing `
        -TimeoutSec 5 | Out-Null
} catch {
    Write-Host "No WeatherPro dev server is running on localhost:3000." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "PowerShell window 1:"
    Write-Host "npm run dev"
    Write-Host ""
    Write-Host "Then rerun this script in PowerShell window 2."
    exit 2
}

function Test-Manifest {
    param(
        [string]$Name,
        [string]$Layer
    )

    try {
        $response = Invoke-WebRequest `
            -Uri "$base/api/gfs/manifest?hourOffset=0&layer=$Layer" `
            -UseBasicParsing `
            -TimeoutSec 15

        $data = $response.Content | ConvertFrom-Json

        Write-Host "$Name -> HTTP $($response.StatusCode)" -ForegroundColor Green
        Write-Host "  Model:    $($data.model)"
        Write-Host "  Variable: $($data.variable)"
        Write-Host "  Valid:    $($data.validTime)"
        Write-Host ""
    } catch {
        Write-Host "$Name -> FAILED" -ForegroundColor Red
        Write-Host $_.Exception.Message
        Write-Host ""
    }
}

Test-Manifest -Name "Temperature" -Layer "temperature"
Test-Manifest -Name "Rain"        -Layer "rain"
Test-Manifest -Name "Clouds"      -Layer "clouds"
Test-Manifest -Name "Wind"        -Layer "wind"

try {
    $terrain = Invoke-WebRequest `
        -Uri "https://tiles.mapterhorn.com/tilejson.json" `
        -UseBasicParsing `
        -TimeoutSec 15

    Write-Host "Mapterhorn terrain -> HTTP $($terrain.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "Mapterhorn terrain -> FAILED" -ForegroundColor Red
    Write-Host $_.Exception.Message
}

Write-Host ""
Write-Host "Expected Wind primary variable:" -ForegroundColor Yellow
Write-Host "  wind_u_component_10m"
Write-Host ""
Write-Host "AQI is intentionally disabled in the map."
Write-Host "AQI remains available in the normal WeatherPro dashboard."
Write-Host ""
Write-Host "UI regression test:" -ForegroundColor Yellow
Write-Host "1. Temperature -> Rain -> Clouds -> Wind -> Map -> Temperature"
Write-Host "2. Dark -> Satellite -> Dark without refresh"
Write-Host "3. Flat -> Relief -> 3D -> Flat without refresh"
Write-Host "4. Pan away, tap My Location, map must recenter"
Write-Host "5. Refresh a normal page: browser GPS must win over the previous map pan"
Write-Host "6. No 'Layer value loading' inspector should exist"
