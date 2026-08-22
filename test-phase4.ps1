$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "WeatherPro Phase 4 build check" -ForegroundColor Cyan
Write-Host ""

Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue

npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Build failed. Do not start the dev server yet." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Build passed." -ForegroundColor Green
Write-Host "Next run: npm run dev"
