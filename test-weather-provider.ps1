$ErrorActionPreference = "Stop"

$base = "http://localhost:3000/api/weather?lat=19.1136&lon=72.8697&timezone=Asia%2FKolkata"

Write-Host ""
Write-Host "WeatherPro provider test" -ForegroundColor Cyan
Write-Host $base
Write-Host ""

$response = Invoke-WebRequest `
  -Uri $base `
  -Headers @{ Accept = "application/json" }

Write-Host "Status:" $response.StatusCode
Write-Host "Provider:" $response.Headers["X-Weather-Provider"]
Write-Host "Fallback:" $response.Headers["X-Weather-Fallback"]
Write-Host "Cache:" $response.Headers["X-Weather-Cache"]
Write-Host "Server-Timing:" $response.Headers["Server-Timing"]

$data = $response.Content | ConvertFrom-Json

Write-Host ""
Write-Host "Temperature:" $data.current.temperature
Write-Host "Timezone:" $data.timezone
Write-Host "Hourly points:" $data.hourly.Count
Write-Host "Daily points:" $data.daily.time.Count
Write-Host "AQI:" $data.airQuality.usAqi
Write-Host ""

Write-Host "Calling the same coordinate again to verify server cache..." -ForegroundColor Yellow

$response2 = Invoke-WebRequest `
  -Uri $base `
  -Headers @{ Accept = "application/json" }

Write-Host "Provider:" $response2.Headers["X-Weather-Provider"]
Write-Host "Cache:" $response2.Headers["X-Weather-Cache"]
