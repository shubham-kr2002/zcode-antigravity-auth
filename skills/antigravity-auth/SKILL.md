---
name: antigravity-auth
description: This skill should be used when the user asks to authenticate with Antigravity, check proxy status, configure the provider, or troubleshoot Claude/Gemini model access through the Antigravity proxy.
metadata:
  version: "1.0"
---

# Antigravity Auth Skill

This skill provides the agent with instructions for managing the Antigravity proxy plugin — OAuth authentication, status checks, provider configuration, and troubleshooting.

## Proxy Architecture

```
ZCode → POST /v1/chat/completions → localhost:51120 → Antigravity API → Claude/Gemini
```

The proxy is a Node.js Express server that auto-starts via ZCode `SessionStart` hook and stops on `Stop` hook. It translates OpenAI-compatible requests to Antigravity format and handles Google OAuth token refresh automatically.

## Available Models (auto-discovered from Antigravity API)

Models are automatically discovered from the Antigravity API at startup. New models appear without code changes. A fallback list of 13 known models is used when the API is unreachable.

### Currently Working Models (as of 2026-07)

| Model | Context | Thinking | Notes |
|-------|---------|----------|-------|
| claude-opus-4-6-thinking | 200K | low/medium/high | Best for complex reasoning |
| claude-sonnet-4-6 | 200K | none | Fast coding tasks |
| gemini-2.5-flash | 1M | low/medium/high | Cost-effective |
| gemini-2.5-flash-lite | 1M | low/medium/high | Lightweight, fastest |
| gemini-2.5-flash-thinking | 1M | low/medium/high | Fast with thinking |
| gemini-3-flash | 1M | minimal/low/medium/high | Fast completions |
| gemini-3-flash-agent | 1M | minimal/low/medium/high | Agent tasks |
| gemini-3.1-pro-low | 1M | low | Latest Pro with light thinking |
| gemini-3.1-flash-lite | 1M | low/medium/high | Latest Flash Lite |
| gemini-3.1-flash-image | 1M | none | Image generation |
| gemini-3.5-flash-low | 1M | low | Latest Flash |
| gemini-3.5-flash-extra-low | 1M | extra-low | Ultra-fast Flash |
| gpt-oss-120b-medium | 128K | medium | Open-source GPT |

Model list is auto-updated — run `antigravity-auth status` to see current models.

## File Locations

- Plugin root: `dist/cli/auth.js` (relative to `${ZCODE_PLUGIN_ROOT}`)
- Proxy: `dist/index.js`
- Accounts: `~/.zcode/antigravity-accounts.json`
- ZCode config: `~/.zcode/v2/config.json`
- Model cache: `~/.zcode/antigravity-models-cache.json` (auto-generated, 1hr TTL)
- Logs: `~/.zcode/antigravity-logs/`
- PID file: `~/.zcode/antigravity-proxy.pid`

## Commands

- **Login**: `node "${ZCODE_PLUGIN_ROOT}/dist/cli/auth.js" login` — Opens browser for Google OAuth
- **Status**: `node "${ZCODE_PLUGIN_ROOT}/dist/cli/auth.js" status` — Shows accounts, config, proxy health
- **Setup**: `node "${ZCODE_PLUGIN_ROOT}/dist/cli/auth.js" setup` — Registers provider in ZCode config
- **Start proxy**: `node "${ZCODE_PLUGIN_ROOT}/dist/index.js"` (auto-started by hook)

## Troubleshooting

### "No accounts" — run `/antigravity-login`
The user needs to authenticate with Google once. The OAuth refresh token is stored and auto-refreshed.

### "Proxy not running"
Check if `dist/index.js` exists. If not, the plugin needs a build: `cd "${ZCODE_PLUGIN_ROOT}" && npm run build`. The proxy auto-starts on `SessionStart` — restart ZCode to trigger it.

### "401 Unauthenticated" from Antigravity
The access token may have expired. Run `/antigravity-login` to re-authenticate.

### "403 Gemini API not enabled"
Some models require the Gemini API to be enabled on the Google Cloud project. Visit: `https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com`

### "404 Model not found"
The model name may be incorrect. Use only the 7 models listed above.

### "429 Rate limited"
The proxy handles auto account rotation. Add more Google accounts via `/antigravity-login` for additional quota.
