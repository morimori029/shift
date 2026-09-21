<#
.SYNOPSIS
  CP-SAT最適化サイドカー（Python/FastAPI）を、Windows標準のタスクスケジューラで常駐化する（追加ソフト不要）。

.DESCRIPTION
  「システム起動時に自動実行」「落ちたら10秒後に自動再起動」のタスクを登録する。
  管理者権限のPowerShellで実行すること。

  事前に以下が完了していること:
    1. このサーバーにPython 3.11以降がインストール済み
    2. `sidecar/` フォルダをこのサーバーの配置先にコピー済み
    3. 配置先で仮想環境を作成し、依存関係をインストール済み:
         python -m venv .venv
         .venv\Scripts\pip install -r requirements.txt

.PARAMETER DeployDir
  sidecar/ の実際の配置先フォルダ（.venv がある場所）

.PARAMETER Port
  サイドカーがLISTENするポート番号（既定: 8001、127.0.0.1のみでLISTENしLANには公開しない）

.EXAMPLE
  ./install-service.ps1 -DeployDir "C:\ShiftApp\sidecar"
#>
param(
  [Parameter(Mandatory = $true)][string]$DeployDir,
  [int]$Port = 8001,
  [string]$TaskName = "ShiftCpSatSidecar"
)

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  throw "管理者権限が必要です。PowerShellを「管理者として実行」で開き直してください。"
}

$venvPython = Join-Path $DeployDir ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
  throw "venvのpython.exeが見つかりません: $venvPython`n先に `python -m venv .venv` と `pip install -r requirements.txt` を実行してください。"
}

$logDir = Join-Path $DeployDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logOut = Join-Path $logDir "sidecar.log"
$logErr = Join-Path $logDir "sidecar-error.log"
$runCmd = Join-Path $DeployDir "run-sidecar.cmd"

$cmdBody = @"
@echo off
rem 自動生成: install-service.ps1 により作成。
rem タスクスケジューラの再起動機能は異常終了では働かないため、ここで再起動ループを回す。
cd /d "$DeployDir"
:loop
for %%F in ("$logOut") do if exist "%%~F" if %%~zF gtr 10485760 move /y "%%~F" "%%~F.old" >nul
for %%F in ("$logErr") do if exist "%%~F" if %%~zF gtr 10485760 move /y "%%~F" "%%~F.old" >nul
"$venvPython" -m uvicorn app.main:app --host 127.0.0.1 --port $Port >> "$logOut" 2>> "$logErr"
echo [%date% %time%] uvicorn が終了しました (code=%ERRORLEVEL%)。10秒後に再起動します >> "$logErr"
ping -n 11 127.0.0.1 >nul
goto loop
"@
Set-Content -Path $runCmd -Value $cmdBody -Encoding Ascii

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host "既存のタスク '$TaskName' を置き換えます..."
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
# タスクを止めても子のpythonは残るため、このサイドカーのプロセスを明示的に止める
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains("uvicorn app.main:app --host 127.0.0.1 --port $Port") } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "タスク '$TaskName' を登録します..."
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$runCmd`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description "CP-SAT最適化サイドカー。システム起動時に自動起動、異常終了時は10秒後に再起動" | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "登録完了。タスク名: $TaskName"
Write-Host "確認（このサーバー上のみ、LANには公開されない）: http://127.0.0.1:$Port/health"
Write-Host "ログ: $logOut / $logErr"
Write-Host ""
Write-Host "127.0.0.1のみでLISTENしているため、ファイアウォール設定は不要（かつ絶対に開放しないこと）。"
