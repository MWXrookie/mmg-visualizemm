$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$appUrl = 'http://127.0.0.1:3088'
$healthUrl = "$appUrl/api/health"

function Test-MmgServer {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        return ($health.ok -eq $true -and $health.name -eq 'mmg-visualizemm')
    } catch {
        return $false
    }
}

if (Test-MmgServer) {
    Start-Process $appUrl
    exit 0
}

Set-Location -LiteralPath $projectRoot

Write-Host '正在构建 MMG_VisualizeMM 前端...'
& npm.cmd run build
if ($LASTEXITCODE -ne 0) {
    Write-Host '构建失败。请查看上方错误信息。' -ForegroundColor Red
    Read-Host '按 Enter 键关闭窗口'
    exit $LASTEXITCODE
}

$browserJob = Start-Job -ScriptBlock {
    param($url)
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2
            if ($health.ok -eq $true -and $health.name -eq 'mmg-visualizemm') {
                Start-Process $url
                break
            }
        } catch {
            Start-Sleep -Seconds 1
        }
    }
} -ArgumentList $appUrl

try {
    Write-Host '正在启动服务。关闭此窗口即可停止服务。'
    & npm.cmd start
    if ($LASTEXITCODE -ne 0) {
        Write-Host '服务启动失败。请查看上方错误信息。' -ForegroundColor Red
        Read-Host '按 Enter 键关闭窗口'
    }
} finally {
    Stop-Job $browserJob -ErrorAction SilentlyContinue
    Remove-Job $browserJob -Force -ErrorAction SilentlyContinue
}
