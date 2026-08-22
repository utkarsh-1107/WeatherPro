$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "WeatherPro map runtime diagnostics" -ForegroundColor Cyan
Write-Host ""

$base = "http://localhost:3000"

function Test-JsonEndpoint {
    param(
        [string]$Name,
        [string]$Uri,
        [string]$Method = "GET",
        [string]$Body = ""
    )

    try {
        if ($Method -eq "POST") {
            $response = Invoke-WebRequest `
                -Uri $Uri `
                -Method POST `
                -ContentType "application/json" `
                -Body $Body `
                -UseBasicParsing
        } else {
            $response = Invoke-WebRequest `
                -Uri $Uri `
                -UseBasicParsing
        }

        Write-Host "$Name -> HTTP $($response.StatusCode)" -ForegroundColor Green
        Write-Host $response.Content.Substring(0, [Math]::Min(220, $response.Content.Length))
        Write-Host ""
    } catch {
        Write-Host "$Name -> FAILED" -ForegroundColor Red
        Write-Host $_.Exception.Message
        Write-Host ""
    }
}

Test-JsonEndpoint `
  -Name "GFS Temperature" `
  -Uri "$base/api/gfs/manifest?hourOffset=0&layer=temperature"

Test-JsonEndpoint `
  -Name "GFS Rain" `
  -Uri "$base/api/gfs/manifest?hourOffset=0&layer=rain"

Test-JsonEndpoint `
  -Name "GFS Clouds" `
  -Uri "$base/api/gfs/manifest?hourOffset=0&layer=clouds"

Test-JsonEndpoint `
  -Name "GFS Wind" `
  -Uri "$base/api/gfs/manifest?hourOffset=0&layer=wind"

$aqiBody = @{
    west = 72.75
    south = 18.95
    east = 73.05
    north = 19.25
    zoom = 8
    hourOffset = 0
} | ConvertTo-Json

Test-JsonEndpoint `
  -Name "AQI Map" `
  -Uri "$base/api/map-aqi" `
  -Method "POST" `
  -Body $aqiBody

Write-Host "If all five endpoints return HTTP 200, test the map UI." -ForegroundColor Yellow
