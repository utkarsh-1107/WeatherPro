$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "WeatherPro final map diagnostics" -ForegroundColor Cyan
Write-Host ""

$base = "http://localhost:3000"

try {
    Invoke-WebRequest `
        -Uri "$base/api/gfs/manifest?hourOffset=0&layer=temperature" `
        -UseBasicParsing `
        -TimeoutSec 5 | Out-Null
} catch {
    Write-Host "No WeatherPro server is running on localhost:3000." -ForegroundColor Yellow
    Write-Host "Run npm run dev first."
    exit 2
}

foreach ($layer in @("temperature", "rain", "clouds", "wind")) {
    try {
        $response = Invoke-WebRequest `
            -Uri "$base/api/gfs/manifest?hourOffset=0&layer=$layer" `
            -UseBasicParsing `
            -TimeoutSec 15

        $data = $response.Content | ConvertFrom-Json

        Write-Host "$layer -> HTTP $($response.StatusCode)" -ForegroundColor Green
        Write-Host "  model: $($data.model)"
        Write-Host "  variable: $($data.variable)"
        Write-Host "  primary host: $($data.metadataUrl)"
        Write-Host "  alternate host: $($data.alternateMetadataUrl)"
        Write-Host ""
    } catch {
        Write-Host "$layer -> FAILED" -ForegroundColor Red
        Write-Host $_.Exception.Message
        Write-Host ""
    }
}

try {
    $terrain = Invoke-WebRequest `
        -Uri "https://tiles.mapterhorn.com/tilejson.json" `
        -UseBasicParsing `
        -TimeoutSec 15

    Write-Host "Mapterhorn -> HTTP $($terrain.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "Mapterhorn -> FAILED" -ForegroundColor Red
    Write-Host $_.Exception.Message
}

Write-Host ""
Write-Host "Browser regression test:" -ForegroundColor Yellow
Write-Host "Temperature opacity -> Rain -> Clouds -> Wind"
Write-Host "Dark -> Satellite -> Dark"
Write-Host "Flat -> Relief -> 3D -> Flat"
Write-Host "NO page refresh between tests"
