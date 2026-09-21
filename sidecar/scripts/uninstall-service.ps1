<#
.SYNOPSIS
  install-service.ps1 で登録したサイドカーのタスクを停止して削除する（管理者権限で実行）。
#>
param(
  [int]$Port = 8001,
  [string]$TaskName = "ShiftCpSatSidecar"
)

$ErrorActionPreference = "Stop"

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains("uvicorn app.main:app --host 127.0.0.1 --port $Port") } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host "タスク '$TaskName' を削除し、プロセスを停止しました。"
