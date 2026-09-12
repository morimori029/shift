<#
.SYNOPSIS
  install-service.ps1 で登録したサイドカーサービスを削除する。
#>
param(
  [string]$NssmPath = "nssm",
  [string]$ServiceName = "ShiftCpSatSidecar"
)

$ErrorActionPreference = "Stop"
& $NssmPath stop $ServiceName
& $NssmPath remove $ServiceName confirm
Write-Host "サービス '$ServiceName' を削除しました。"
