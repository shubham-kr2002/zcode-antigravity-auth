# start-proxy.ps1 — Windows SessionStart hook for the Antigravity proxy plugin
#
# Mirrors hooks/start-proxy.sh: ensures the provider is configured and starts
# the proxy daemon in the background. Exits quickly so the hook does not block.

$ErrorActionPreference = 'SilentlyContinue'

$PluginRoot = $env:ZCODE_PLUGIN_ROOT
if (-not $PluginRoot) {
    $PluginRoot = Split-Path -Parent $PSScriptRoot
}
$ProxyPort = if ($env:ANTIGRAVITY_PROXY_PORT) { $env:ANTIGRAVITY_PROXY_PORT } else { '51120' }
$NodeBin = 'node'
$DistDir = Join-Path $PluginRoot 'dist'
$LogDir = Join-Path $env:USERPROFILE '.zcode\antigravity-logs'
$PidFile = Join-Path $env:USERPROFILE '.zcode\antigravity-proxy.pid'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# ---- 1. Build if dist/ is missing ------------------------------------------
if (-not (Test-Path (Join-Path $DistDir 'index.js'))) {
    Write-Host '[antigravity] Building proxy (one-time setup)...' -ForegroundColor Yellow
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Push-Location $PluginRoot
        npm run build 2>$null | Out-Null
        Pop-Location
    }
}

# ---- 2. Idempotent ZCode provider setup ------------------------------------
$AuthJs = Join-Path $DistDir 'cli\auth.js'
if (Test-Path $AuthJs) {
    & $NodeBin $AuthJs 'setup' 2>$null | Out-Null
}

# ---- 3. Check if proxy already running -------------------------------------
try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:${ProxyPort}/health" -TimeoutSec 2 -UseBasicParsing
    if ($health.StatusCode -eq 200) { exit 0 }
} catch { }

# ---- 4. Start the proxy in the background ----------------------------------
if (-not (Test-Path (Join-Path $DistDir 'index.js'))) {
    Write-Host "[antigravity] dist/index.js not found. Run 'npm run build' in $PluginRoot"
    exit 0
}

$today = Get-Date -Format 'yyyy-MM-dd'
$OutLog = Join-Path $LogDir "proxy-stdout-$today.log"
$ErrLog = Join-Path $LogDir "proxy-stderr-$today.log"

$env:ANTIGRAVITY_PROXY_PORT = $ProxyPort

# Start a detached process — Start-Process with -WindowStyle Hidden detaches it
# from this hook's lifetime so ZCode does not block.
$proc = Start-Process -FilePath $NodeBin `
    -ArgumentList @((Join-Path $DistDir 'index.js')) `
    -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -PassThru

$proc.Id | Out-File -FilePath $PidFile -Encoding ascii

# Wait briefly for the proxy to bind.
for ($i = 0; $i -lt 10; $i++) {
    try {
        $health = Invoke-WebRequest -Uri "http://127.0.0.1:${ProxyPort}/health" -TimeoutSec 1 -UseBasicParsing
        if ($health.StatusCode -eq 200) {
            Write-Host "[antigravity] Proxy is up on port ${ProxyPort}. Run /antigravity-login to authenticate."
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 200
}

Write-Host "[antigravity] Proxy is starting in the background. If models fail, run /antigravity-status."
exit 0
