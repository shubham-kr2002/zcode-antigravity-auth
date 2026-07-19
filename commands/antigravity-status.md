---
description: Show the status of the Antigravity proxy — accounts, models, and connection health.
argument-hint: ""
allowed-tools: Read, Bash
skills: antigravity-auth
---

# Antigravity Status

Show the current state of the Antigravity proxy setup.

## Instructions

Run: `node "${ZCODE_PLUGIN_ROOT}/dist/cli/auth.js" status`

Report the results to the user:
- **Provider config**: whether the ZCode config has the Antigravity provider
- **Accounts**: how many Google accounts are authenticated
- **Proxy**: whether the local proxy is running and healthy
- **Models available**: the 7 models (claude-opus-4-6-thinking, claude-sonnet-4-6, gemini-3-pro, gemini-3-flash, gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite)

If the proxy is not running, offer to troubleshoot:
- Check if Node.js is installed (`node --version`)
- Check if `dist/index.js` exists — if not, run `cd "${ZCODE_PLUGIN_ROOT}" && npm run build`
- The proxy auto-starts on session start via ZCode hooks

If no accounts are set up, suggest running `/antigravity-login`.
