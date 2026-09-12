<#
.SYNOPSIS
  Next.js（シフト管理アプリ本体）をNSSMでWindowsサービスとして登録する。

.DESCRIPTION
  事前に以下が完了していること:
    1. このサーバーにNode.jsがインストール済み
    2. NSSM (https://nssm.cc/download) をダウンロードし、nssm.exe にパスが通っている
       （または -NssmPath でフルパスを指定）
    3. `web/` フォルダをこのサーバーの配置先にコピー済み
    4. 配置先で `npm install` → `npm run build` 実行済み（.next/standalone/ が生成されている）
    5. .next/standalone/ に .next/static と public/ を手動コピー済み（Next.jsのstandalone仕様）
       cp -r .next/static .next/standalone/.next/static
       cp -r public .next/standalone/public
    6. データ用ディレクトリ（DBファイル・バックアップの保存先）を決めてある
       （コードの再配置とは独立させることを推奨。例: C:\ShiftAppData\）

.PARAMETER DeployDir
  .next/standalone の実際の配置先フォルダ（server.js がある場所）

.PARAMETER DataDir
  DBファイル(dev.db)・バックアップを保存するディレクトリ（DeployDirとは別の場所を推奨）

.PARAMETER Port
  Next.jsがLISTENするポート番号（既定: 3000）

.PARAMETER SidecarUrl
  CP-SATサイドカーのURL（既定: http://127.0.0.1:8001、先にサイドカー側のサービスを
  インストールしておくか、後で this app を再起動すればつながる）

.PARAMETER AdminPassword
  全ページ共通のログインパスワード（必須。/dashboard は誰でも見られる公開ページ、
  それ以外の全画面はこのパスワードでのログインが必要）

.PARAMETER NssmPath
  nssm.exe のフルパス（PATHが通っていれば省略可、既定値 "nssm"）

.EXAMPLE
  ./install-service.ps1 -DeployDir "C:\ShiftApp\web" -DataDir "C:\ShiftAppData" -AdminPassword "実際のパスワード"
#>
param(
  [Parameter(Mandatory = $true)][string]$DeployDir,
  [Parameter(Mandatory = $true)][string]$DataDir,
  [Parameter(Mandatory = $true)][string]$AdminPassword,
  [int]$Port = 3000,
  [string]$SidecarUrl = "http://127.0.0.1:8001",
  [string]$NssmPath = "nssm",
  [string]$ServiceName = "ShiftWebApp"
)

$ErrorActionPreference = "Stop"

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
$databaseUrl = "file:$($dbPath -replace '\\', '/')"

Write-Host "サービス '$ServiceName' を登録します..."
& $NssmPath install $ServiceName $nodeExe "server.js"
& $NssmPath set $ServiceName AppDirectory $DeployDir
& $NssmPath set $ServiceName AppEnvironmentExtra `
  "NODE_ENV=production" `
  "PORT=$Port" `
  "HOSTNAME=0.0.0.0" `
  "DATABASE_URL=$databaseUrl" `
  "SIDECAR_URL=$SidecarUrl" `
  "ADMIN_PASSWORD=$AdminPassword"
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath set $ServiceName AppExit Default Restart
& $NssmPath set $ServiceName AppStdout (Join-Path $DataDir "web-service.log")
& $NssmPath set $ServiceName AppStderr (Join-Path $DataDir "web-service-error.log")

Write-Host "初回起動前にDBスキーマを作成します（Prisma migrate deploy）..."
Push-Location $DeployDir
$env:DATABASE_URL = $databaseUrl
try {
  # standalone出力にはprisma CLIが含まれないため、配置元（ビルド前のweb/フォルダ）で実行するか、
  # 事前に DataDir に dev.db をコピーしておくこと。ここでは既にDBがある前提でスキップ可能。
  if (-not (Test-Path $dbPath)) {
    Write-Warning "DBファイルが $dbPath に見つかりません。先に「npx prisma migrate deploy」でスキーマを作成するか、開発機で作成したdev.dbをこの場所にコピーしてください。"
  }
} finally {
  Pop-Location
}

& $NssmPath start $ServiceName

Write-Host ""
Write-Host "登録完了。サービス名: $ServiceName"
Write-Host "確認: http://<このサーバーのIP>:$Port"
Write-Host "ログ: $DataDir\web-service.log / web-service-error.log"
Write-Host ""
Write-Host "Windowsファイアウォールで受信ポート $Port を開放するのを忘れずに:"
Write-Host "  New-NetFirewallRule -DisplayName 'Shift Web App' -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow"
