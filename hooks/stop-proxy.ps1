# stop-proxy.ps1 — Windows Stop hook for the Antigravity proxy plugin
#
# Kills the proxy daemon when the ZCode session ends.

$ErrorActionPreference = 'SilentlyContinue'

$ProxyPort = if ($env:ANTIGRAVITY_PROXY_PORT) { $env:ANTIGRAVITY_PROXY_PORT } else { '51120' }
$PidFile = Join-Path $env:USERPROFILE '.zcode\antigravity-proxy.pid'

# ---- 1. Try the PID file first ---------------------------------------------
if (Test-Path $PidFile) {
    $procId = [int](Get-Content $PidFile -ErrorAction SilentlyContinue)
    if ($procId -and (Get-Process -Id $procId -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $procId -Force
    }
    Remove-Item $PidFile -Force
}

# ---- 2. Fallback: kill anything listening on the proxy port ----------------
$conns = Get-NetTCPConnection -LocalPort $ProxyPort -State Listen -ErrorAction SilentlyContinue
if ($conns) {
    $conns | ForEach-Object {
        if ($_.OwningProcess) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    }
}

exit 0
