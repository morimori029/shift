<#
.SYNOPSIS
  Start the standalone production build using the settings in web/.env.

.DESCRIPTION
  Reads web/.env (one level above this script), sets each KEY=VALUE as an
  environment variable, then runs .next/standalone/server.js.
  For manual checks and troubleshooting. For always-on operation use
  install-service.ps1 instead.

  Example web/.env:
    DATABASE_URL="file:C:/ShiftAppData/dev.db"
    ADMIN_PASSWORD="your-password"
    PORT=8002
    HOSTNAME=0.0.0.0
    SIDECAR_URL="http://127.0.0.1:8001"

  Defaults when not set in .env: NODE_ENV=production, HOSTNAME=0.0.0.0, PORT=8002

.PARAMETER EnvFile
  Path to the .env file (default: web/.env)

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
#>
param(
  [string]$EnvFile = (Join-Path (Split-Path $PSScriptRoot -Parent) ".env")
)

$ErrorActionPreference = "Stop"
$WebDir = Split-Path $PSScriptRoot -Parent
$StandaloneDir = Join-Path $WebDir ".next\standalone"
$ServerJs = Join-Path $StandaloneDir "server.js"

if (-not (Test-Path $EnvFile)) {
  throw ".env not found: $EnvFile (create it in the web folder with DATABASE_URL, ADMIN_PASSWORD, etc.)"
}
if (-not (Test-Path $ServerJs)) {
  throw "server.js not found: $ServerJs (run npm run build and copy static/public first)"
}

Write-Host "Loading .env: $EnvFile"
Get-Content $EnvFile -Encoding UTF8 | ForEach-Object {
  $line = $_.Trim()
  if ($line -eq "" -or $line.StartsWith("#")) { return }
  $idx = $line.IndexOf("=")
  if ($idx -lt 1) { return }
  $key = $line.Substring(0, $idx).Trim()
  $value = $line.Substring($idx + 1).Trim()
  if ($value.Length -ge 2 -and $value[0] -eq $value[-1] -and ($value[0] -eq '"' -or $value[0] -eq "'")) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  Set-Item -Path "Env:$key" -Value $value
  if ($key -eq "ADMIN_PASSWORD") {
    Write-Host "  $key = ********"
  } else {
    Write-Host "  $key = $value"
  }
}

if (-not $env:NODE_ENV) { $env:NODE_ENV = "production" }
if (-not $env:HOSTNAME) { $env:HOSTNAME = "0.0.0.0" }
if (-not $env:PORT) { $env:PORT = "8002" }

Write-Host ""
Write-Host "Starting: http://localhost:$($env:PORT)  (Ctrl+C to stop)"
Push-Location $StandaloneDir
try {
  node server.js
} finally {
  Pop-Location
}
