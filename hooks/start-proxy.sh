#!/usr/bin/env bash
# start-proxy.sh — SessionStart hook for the Antigravity proxy plugin
#
# Responsibilities:
#   1. Ensure the Antigravity provider is registered in ZCode config (idempotent).
#   2. Start the proxy server in the background if it is not already running.
#
# IMPORTANT: This script MUST daemonize the proxy and exit quickly — hooks are
# synchronous and a long-running hook blocks ZCode. The proxy detaches itself
# so this script returns within a second or two.

set -u

PLUGIN_ROOT="${ZCODE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PROXY_PORT="${ANTIGRAVITY_PROXY_PORT:-51120}"
NODE_BIN="${NODE_BIN:-node}"
DIST_DIR="$PLUGIN_ROOT/dist"
LOG_DIR="${HOME}/.zcode/antigravity-logs"
PID_FILE="${HOME}/.zcode/antigravity-proxy.pid"

mkdir -p "$LOG_DIR"

# ---- 1. Ensure dist/ is built (covers source installs) ----------------------
if [ ! -f "$DIST_DIR/index.js" ]; then
  echo "[antigravity] Building proxy (one-time setup)..." >&2
  if command -v npm >/dev/null 2>&1; then
    (cd "$PLUGIN_ROOT" && npm run build >/dev/null 2>&1) || true
  fi
fi

# ---- 2. Idempotent ZCode provider setup -------------------------------------
# Only runs if dist/ is present — setup is best-effort and must never block.
if [ -f "$DIST_DIR/cli/auth.js" ]; then
  "$NODE_BIN" "$DIST_DIR/cli/auth.js" setup >/dev/null 2>&1 || true
fi

# ---- 3. Check if proxy is already running -----------------------------------
# Health check avoids duplicate instances on session resume/clear/compact.
if curl -s --max-time 2 "http://127.0.0.1:${PROXY_PORT}/health" >/dev/null 2>&1; then
  # Proxy already up — nothing to do. Exit 0 silently (no hook output).
  exit 0
fi

# ---- 4. Start the proxy in the background -----------------------------------
if [ ! -f "$DIST_DIR/index.js" ]; then
  # Cannot start without a build — surface a friendly nudge in the hook output.
  echo "[antigravity] dist/index.js not found. Run \`npm run build\` in $PLUGIN_ROOT"
  exit 0
fi

TODAY=$(date +%Y-%m-%d 2>/dev/null || echo "unknown")
OUT_LOG="$LOG_DIR/proxy-stdout-${TODAY}.log"
ERR_LOG="$LOG_DIR/proxy-stderr-${TODAY}.log"

# Detach the proxy into its own session so it survives this hook's exit.
# nohup + setsid + & disown = fully daemonized, no controlling terminal.
export ANTIGRAVITY_PROXY_PORT="$PROXY_PORT"

nohup setsid "$NODE_BIN" "$DIST_DIR/index.js" \
  >>"$OUT_LOG" 2>>"$ERR_LOG" < /dev/null &

PROXY_PID=$!
echo "$PROXY_PID" > "$PID_FILE"
disown "$PROXY_PID" 2>/dev/null || true

# Give the proxy a moment to bind, but do not block the hook longer than ~2s.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s --max-time 1 "http://127.0.0.1:${PROXY_PORT}/health" >/dev/null 2>&1; then
    # Healthy — emit a brief context note for the agent.
    echo "[antigravity] Proxy is up on port ${PROXY_PORT}. Run /antigravity-login to authenticate."
    exit 0
  fi
  sleep 0.2
done

# Did not become healthy within the wait window — that is OK, the daemon is
# still starting. Surface a non-blocking note.
echo "[antigravity] Proxy is starting in the background. If models fail, run /antigravity-status."
exit 0
