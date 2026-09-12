<#
.SYNOPSIS
  install-service.ps1 で登録したNext.jsサービスを削除する。
#>
param(
  [string]$NssmPath = "nssm",
  [string]$ServiceName = "ShiftWebApp"
)

$ErrorActionPreference = "Stop"
& $NssmPath stop $ServiceName
& $NssmPath remove $ServiceName confirm
Write-Host "サービス '$ServiceName' を削除しました。"
