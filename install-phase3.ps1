powershell -ExecutionPolicy Bypass -File .\install-phase3.ps1$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "WeatherPro Phase 3 — GFS Map Engine" -ForegroundColor Cyan
Write-Host ""

npm install @openmeteo/weather-map-layer@0.0.20

Write-Host ""
Write-Host "Weather map dependency installed." -ForegroundColor Green
Write-Host ""
Write-Host "Next:"
Write-Host "Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue"
Write-Host "npm run build"
