<#
.SYNOPSIS
  Next.js（シフト管理アプリ本体）を、Windows標準のタスクスケジューラで常駐化する（追加ソフト不要）。

.DESCRIPTION
  「システム起動時に自動実行」「落ちたら10秒後に自動再起動」のタスクを登録する。
  管理者権限のPowerShellで実行すること。

  事前に以下が完了していること:
    1. このサーバーにNode.jsがインストール済み
    2. `web/` フォルダをこのサーバーの配置先にコピー済み
    3. 配置先で `npm install` → `npm run build` 実行済み（.next/standalone/ が生成されている）
    4. .next/standalone/ に .next/static と public/ を手動コピー済み（Next.jsのstandalone仕様）
       Copy-Item -Recurse .next\static .next\standalone\.next\static
       Copy-Item -Recurse public .next\standalone\public
    5. データ用ディレクトリ（DBファイル・バックアップの保存先）を決めてある
       （コードの再配置とは独立させることを推奨。例: C:\ShiftAppData\）

.PARAMETER DeployDir
  .next/standalone の実際の配置先フォルダ（server.js がある場所）

.PARAMETER DataDir
  DBファイル(dev.db)・バックアップ・ログ・起動用スクリプトを保存するディレクトリ

.PARAMETER Port
  Next.jsがLISTENするポート番号（既定: 3000）

.PARAMETER SidecarUrl
  CP-SATサイドカーのURL（既定: http://127.0.0.1:8001）

.PARAMETER AdminPassword
  全ページ共通のログインパスワード（必須。/dashboard は誰でも見られる公開ページ、
  それ以外の全画面はこのパスワードでのログインが必要）。ダブルクォート(")は使えない。

.EXAMPLE
  ./install-service.ps1 -DeployDir "C:\ShiftApp\web\.next\standalone" -DataDir "C:\ShiftAppData" -AdminPassword "実際のパスワード"
#>
param(
  [Parameter(Mandatory = $true)][string]$DeployDir,
  [Parameter(Mandatory = $true)][string]$DataDir,
  [Parameter(Mandatory = $true)][string]$AdminPassword,
  [int]$Port = 3000,
  [string]$SidecarUrl = "http://127.0.0.1:8001",
  [string]$TaskName = "ShiftWebApp"
)

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  throw "管理者権限が必要です。PowerShellを「管理者として実行」で開き直してください。"
}
if ($AdminPassword.Contains('"')) {
  throw "AdminPassword にダブルクォート(`")は使えません。"
}

$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) {
  throw "node.exe が見つかりません。Node.jsをインストールしてください。"
}

$serverJs = Join-Path $DeployDir "server.js"
if (-not (Test-Path $serverJs)) {
  throw "server.js が見つかりません: $serverJs`n先に `npm run build` と standalone出力への static/public コピーを済ませてください。"
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$dbPath = Join-Path $DataDir "dev.db"
if (-not (Test-Path $dbPath)) {
  Write-Warning "DBファイルが $dbPath に見つかりません。先に「npx prisma migrate deploy」でスキーマを作成するか、開発機のdev.dbをこの場所にコピーしてください。"
}
$databaseUrl = "file:$($dbPath -replace '\\', '/')"

$logOut = Join-Path $DataDir "web-service.log"
$logErr = Join-Path $DataDir "web-service-error.log"
$runCmd = Join-Path $DataDir "run-shift-web.cmd"

# cmdの環境変数代入では % が特殊文字なので二重にする
$pwEscaped = $AdminPassword -replace '%', '%%'

# 起動用スクリプト（パスワードを含むので、SYSTEMと管理者以外は読めないようにする）
$cmdBody = @"
@echo off
rem 自動生成: install-service.ps1 により作成。
rem タスクスケジューラの再起動機能は異常終了では働かないため、ここで再起動ループを回す。
set "NODE_ENV=production"
set "PORT=$Port"
set "HOSTNAME=0.0.0.0"
set "DATABASE_URL=$databaseUrl"
set "SIDECAR_URL=$SidecarUrl"
set "ADMIN_PASSWORD=$pwEscaped"
cd /d "$DeployDir"
:loop
for %%F in ("$logOut") do if exist "%%~F" if %%~zF gtr 10485760 move /y "%%~F" "%%~F.old" >nul
for %%F in ("$logErr") do if exist "%%~F" if %%~zF gtr 10485760 move /y "%%~F" "%%~F.old" >nul
"$nodeExe" "$serverJs" >> "$logOut" 2>> "$logErr"
echo [%date% %time%] server.js が終了しました (code=%ERRORLEVEL%)。10秒後に再起動します >> "$logErr"
ping -n 11 127.0.0.1 >nul
goto loop
"@
Set-Content -Path $runCmd -Value $cmdBody -Encoding Ascii
& icacls $runCmd /inheritance:r /grant:r "SYSTEM:F" "Administrators:F" | Out-Null

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host "既存のタスク '$TaskName' を置き換えます..."
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
# タスクを止めても子のnode.exeは残るため、このアプリのプロセスを明示的に止める
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($serverJs) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Write-Host "タスク '$TaskName' を登録します..."
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$runCmd`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description "シフト管理アプリ（Next.js）。システム起動時に自動起動、異常終了時は10秒後に再起動" | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "登録完了。タスク名: $TaskName"
Write-Host "確認: http://<このサーバーのIP>:$Port"
Write-Host "ログ: $logOut / $logErr"
Write-Host ""
Write-Host "Windowsファイアウォールで受信ポート $Port を開放するのを忘れずに:"
Write-Host "  New-NetFirewallRule -DisplayName 'Shift Web App' -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow"
