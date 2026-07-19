#!/usr/bin/env bash
# stop-proxy.sh — Stop hook for the Antigravity proxy plugin
#
# Kills the proxy daemon when the ZCode session ends. Safe to run multiple
# times; exits cleanly if no proxy is running.

set -u

PROXY_PORT="${ANTIGRAVITY_PROXY_PORT:-51120}"
PID_FILE="${HOME}/.zcode/antigravity-proxy.pid"

# ---- 1. Try the PID file first (cleanest shutdown) --------------------------
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "${PID:-}" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    # Give it a brief moment to shut down gracefully.
    for _ in 1 2 3 4 5; do
      kill -0 "$PID" 2>/dev/null || break
      sleep 0.1
    done
    # Force-kill if still alive.
    kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# ---- 2. Fallback: kill anything listening on the proxy port -----------------
# Portable across Linux/macOS without requiring lsof.
PID_PORT=$( (ss -tlnp 2>/dev/null | grep ":${PROXY_PORT} " | grep -oE 'pid=[0-9]+' | cut -d= -f2) \
         || (lsof -ti ":${PROXY_PORT}" 2>/dev/null) \
         || true )
if [ -n "${PID_PORT:-}" ]; then
  kill $PID_PORT 2>/dev/null || true
fi

# Always exit 0 — Stop hooks must never block session teardown.
exit 0
