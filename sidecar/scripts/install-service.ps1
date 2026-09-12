<#
.SYNOPSIS
  CP-SAT最適化サイドカー（Python/FastAPI）をNSSMでWindowsサービスとして登録する。

.DESCRIPTION
  事前に以下が完了していること:
    1. このサーバーにPython 3.11以降がインストール済み
    2. NSSM (https://nssm.cc/download) をダウンロードし、nssm.exe にパスが通っている
       （または -NssmPath でフルパスを指定）
    3. `sidecar/` フォルダをこのサーバーの配置先にコピー済み
    4. 配置先で仮想環境を作成し、依存関係をインストール済み:
         python -m venv .venv
         .venv\Scripts\pip install -r requirements.txt

.PARAMETER DeployDir
  sidecar/ の実際の配置先フォルダ（.venv がある場所）

.PARAMETER Port
  サイドカーがLISTENするポート番号（既定: 8001、127.0.0.1のみでLISTENしLANには公開しない）

.PARAMETER NssmPath
  nssm.exe のフルパス（PATHが通っていれば省略可）

.EXAMPLE
  ./install-service.ps1 -DeployDir "C:\ShiftApp\sidecar"
#>
param(
  [Parameter(Mandatory = $true)][string]$DeployDir,
  [int]$Port = 8001,
  [string]$NssmPath = "nssm",
  [string]$ServiceName = "ShiftCpSatSidecar"
)

$ErrorActionPreference = "Stop"

$venvPython = Join-Path $DeployDir ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
  throw "venvのpython.exeが見つかりません: $venvPython`n先に `python -m venv .venv` と `pip install -r requirements.txt` を実行してください。"
}

$logDir = Join-Path $DeployDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Write-Host "サービス '$ServiceName' を登録します..."
& $NssmPath install $ServiceName $venvPython "-m uvicorn app.main:app --host 127.0.0.1 --port $Port"
& $NssmPath set $ServiceName AppDirectory $DeployDir
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath set $ServiceName AppExit Default Restart
& $NssmPath set $ServiceName AppStdout (Join-Path $logDir "sidecar.log")
& $NssmPath set $ServiceName AppStderr (Join-Path $logDir "sidecar-error.log")

& $NssmPath start $ServiceName

Write-Host ""
Write-Host "登録完了。サービス名: $ServiceName"
Write-Host "確認（このサーバー上のみ、LANには公開されない）: http://127.0.0.1:$Port/health"
Write-Host "ログ: $logDir\sidecar.log / sidecar-error.log"
Write-Host ""
Write-Host "127.0.0.1のみでLISTENしているため、ファイアウォール設定は不要（かつ絶対に開放しないこと）。"
