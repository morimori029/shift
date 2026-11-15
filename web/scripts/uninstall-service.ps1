<#
.SYNOPSIS
  Stop and remove the task registered by install-service.ps1 (run as Administrator).

.PARAMETER DeployDir
  Same .next/standalone folder that was given to install-service.ps1
  (used to stop the leftover node process)
#>
param(
  [Parameter(Mandatory = $true)][string]$DeployDir,
  [string]$TaskName = "ShiftWebApp"
)

$ErrorActionPreference = "Stop"
$serverJs = Join-Path $DeployDir "server.js"

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($serverJs) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host "Task '$TaskName' removed and its process stopped."
