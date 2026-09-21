<#
.SYNOPSIS
  install-service.ps1 で登録したNext.jsのタスクを停止して削除する（管理者権限で実行）。

.PARAMETER DeployDir
  install-service.ps1 に渡したものと同じ .next/standalone の配置先（残っているnodeプロセスを止めるために使う）
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
Write-Host "タスク '$TaskName' を削除し、プロセスを停止しました。"
