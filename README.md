# zcode-antigravity-proxy

Local proxy server that enables ZCode to use **Antigravity** (Google's IDE) OAuth for accessing powerful AI models like Claude Opus 4.6, Sonnet 4.6, and Gemini 3.1 Pro/Flash through Google's infrastructure.

> ⚠️ **Terms of Service Warning:** Using this proxy violates Google's Terms of Service. Your Google account may be suspended or permanently banned. Use at your own risk. Consider using a secondary Google account.

## How It Works

```
ZCode → localhost:51120 (OpenAI-compatible API) → Antigravity API → Claude/Gemini
```

The proxy exposes an **OpenAI-compatible** endpoint that ZCode connects to as a custom provider. It translates requests and handles OAuth authentication, token refresh, rate limits, and endpoint failover behind the scenes.

## Quick Start

### One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/NoeFabris/opencode-antigravity-auth/main/scripts/install.sh | bash
```

Or via npx (once published):
```bash
npx zcode-antigravity-proxy install
```

### Manual Install

```bash
# Clone and install
git clone https://github.com/NoeFabris/opencode-antigravity-auth.git zcode-antigravity-proxy
cd zcode-antigravity-proxy
npm install
npm run build

# Full setup (login + configure ZCode)
npx tsx src/cli/auth.ts install

# Start the proxy
npx tsx src/cli/auth.ts start
```

### Step-by-Step

1. **Authenticate** with Google OAuth:
   ```bash
   antigravity-auth login
   ```

2. **Configure ZCode** to use the proxy:
   ```bash
   antigravity-auth setup
   ```

3. **Start the proxy** server:
   ```bash
   antigravity-auth start
   ```

4. **Restart ZCode** — Antigravity models will appear in the model picker.

## Commands

```bash
antigravity-auth login       # Authenticate with Google OAuth
antigravity-auth setup       # Add/update Antigravity provider in ZCode config
antigravity-auth install     # Full setup: login + provider + instructions
antigravity-auth uninstall   # Remove Antigravity from ZCode config
antigravity-auth status      # Show account and proxy status
antigravity-auth start       # Start the proxy server
```

## Available Models

| Model ID | Context | Output | Thinking | Best For |
|----------|---------|--------|----------|----------|
| `claude-opus-4-6-thinking` | 200K | 64K | ✅ (3 tiers) | Complex reasoning, architecture |
| `claude-sonnet-4-6` | 200K | 64K | ❌ | Fast coding, simple tasks |
| `gemini-3.5-pro` | 1M | 65K | ✅ (2 tiers) | Latest advanced reasoning |
| `gemini-3.5-flash` | 1M | 65K | ✅ (4 tiers) | Fast cutting-edge completions |
| `gemini-3.1-pro` | 1M | 65K | ✅ (2 tiers) | Long-context reasoning |
| `gemini-3.1-flash` | 1M | 65K | ✅ (4 tiers) | Fast long-context completions |
| `gemini-3-pro` | 1M | 65K | ✅ (2 tiers) | Code generation |
| `gemini-3-flash` | 1M | 65K | ✅ (4 tiers) | Fast iterations |
| `gemini-2.5-pro` | 1M | 65K | ✅ (3 tiers) | Complex reasoning |
| `gemini-2.5-flash` | 1M | 65K | ✅ (3 tiers) | Cost-effective |
| `gemini-2.5-flash-lite` | 1M | 65K | ✅ (3 tiers) | Drafts, boilerplate |

**Thinking tier suffixes:**
- `claude-opus-4-6-thinking-high` (32K budget, default)
- `claude-opus-4-6-thinking-medium` (16K budget)
- `claude-opus-4-6-thinking-low` (8K budget)
- `gemini-3.1-pro-high` (deep thinking, default)
- `gemini-3.1-pro-low` (minimal thinking)
- `gemini-3-flash-high` / `medium` / `low` / `minimal`

See [AGENTS.MD](./AGENTS.MD) for the full model guide and selection recommendations.

## Manual Testing (without OAuth)

```bash
# Get an access token from Google OAuth Playground or elsewhere
export ANTIGRAVITY_ACCESS_TOKEN="ya29.a0..."
export ANTIGRAVITY_PROJECT_ID="your-project-id"

# Start the proxy
npm run dev

# Test with curl
curl -X POST http://127.0.0.1:51120/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Hello, how are you?"}],
    "stream": false
  }'
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTIGRAVITY_PROXY_PORT` | `51120` | Proxy server port |
| `ANTIGRAVITY_OAUTH_PORT` | `51121` | OAuth callback server port |
| `ANTIGRAVITY_ACCESS_TOKEN` | — | Manual access token (bypass OAuth) |
| `ANTIGRAVITY_PROJECT_ID` | `rising-fact-p41fc` | Google Cloud project ID |
| `ANTIGRAVITY_DEBUG` | — | Set to `1` or `2` for debug logging |
| `ANTIGRAVITY_QUIET` | — | Set to `1` to suppress logs |
| `ZCODE_CONFIG_DIR` | `~/.zcode` | ZCode config directory |

### Config File (`~/.zcode/antigravity.json`)

```json
{
  "proxy_port": 51120,
  "debug": false,
  "quiet_mode": false,
  "account_selection_strategy": "sticky",
  "max_rate_limit_wait_seconds": 300,
  "quota_refresh_interval_minutes": 15,
  "soft_quota_threshold_percent": 90
}
```

**Account selection strategies:**
- `sticky` — Stick to one account until rate-limited (default)
- `round-robin` — Rotate through all accounts evenly
- `hybrid` — Stick until soft quota threshold, then rotate

### Debug Logging

Set `ANTIGRAVITY_DEBUG=1` to enable file-based logging to `~/.zcode/antigravity-logs/`. Log files are rotated daily (`antigravity-YYYY-MM-DD.log`).

## Multi-Account Support

Add multiple Google accounts for higher throughput:

```bash
antigravity-auth login   # First account
antigravity-auth login   # Second account
antigravity-auth login   # Third account...
```

The proxy automatically:
- Rotates accounts when rate-limited
- Tracks per-account rate limits with token bucket algorithm
- Handles token refresh proactively
- Falls back through endpoints (daily → autopush → prod)

Check status:
```bash
antigravity-auth status
```

## Troubleshooting

### "No available accounts"
Run `antigravity-auth login` to authenticate at least one account.

### "Rate limited" errors
- Wait for limits to reset (typically 1–5 minutes)
- Add more accounts: `antigravity-auth login`
- Check status: `antigravity-auth status`
- Increase wait timeout: Set `max_rate_limit_wait_seconds` in config

### Proxy won't start
- Check port: `lsof -i :51120`
- Use different port: `ANTIGRAVITY_PROXY_PORT=51122 antigravity-auth start`
- Debug mode: `ANTIGRAVITY_DEBUG=1 antigravity-auth start`
- Check logs: `cat ~/.zcode/antigravity-logs/antigravity-*.log`

### Models not showing in ZCode
- Verify config: `antigravity-auth setup`
- Restart ZCode completely (quit and reopen)
- Check `~/.zcode/v2/config.json` for the `antigravity` entry under `provider`

### Authentication expired
Run `antigravity-auth login` again to refresh credentials. Existing accounts are preserved.

### WSL / Docker / Headless
The proxy detects headless environments and falls back to manual OAuth flow:
1. URL is printed to console
2. Open it in a browser on your host machine
3. Paste the redirect URL back into the terminal

Set `ANTIGRAVITY_HEADLESS=1` to force manual mode.

## Architecture

```
src/
├── index.ts                        # Entry point
├── server.ts                       # Express server (OpenAI-compatible API)
├── config.ts                       # Configuration loading (Zod-validated)
├── constants.ts                    # Endpoints, client IDs, headers, scopes
├── logger.ts                       # File-based debug logging
├── oauth/
│   ├── authorize.ts                # PKCE OAuth URL generation
│   ├── exchange.ts                 # Code → token exchange
│   ├── refresh.ts                  # Proactive token refresh
│   └── server.ts                   # OAuth callback server (port 51121)
├── accounts/
│   ├── manager.ts                  # AccountManager: multi-account rotation
│   ├── storage.ts                  # ~/.zcode/antigravity-accounts.json
│   ├── rotation.ts                 # Token bucket + health tracker
│   └── fingerprint.ts              # Device fingerprint generation
├── transform/
│   ├── request.ts                  # OpenAI → Antigravity request transform
│   ├── response.ts                 # Antigravity → OpenAI response (SSE + non-stream)
│   ├── schema.ts                   # JSON schema cleaning (Gemini + Claude)
│   ├── model-resolver.ts           # Thinking tier resolution + model aliases
│   ├── claude.ts                   # Claude-specific transforms (VALIDATED, thinking)
│   ├── gemini.ts                   # Gemini-specific transforms (thinking, tools)
│   └── cross-model-sanitizer.ts    # Strip foreign model signatures
├── api/
│   ├── antigravity.ts              # Antigravity API client
│   ├── retry.ts                    # Rate limit backoff + endpoint failover
│   ├── quota.ts                    # Quota checking
│   └── model-resolver.ts           # Model name resolution
└── cli/
    ├── auth.ts                     # CLI: login, setup, install, status, start
    └── setup.ts                    # ZCode config auto-configuration
```

### Request Flow

1. ZCode sends `POST /v1/chat/completions` (OpenAI format)
2. Proxy resolves auth (manual token > stored accounts > manager selection)
3. Transforms request: OpenAI → Antigravity Gemini format
   - `messages[].role` → `contents[].role` (assistant→model, tool→user)
   - `tools[{type:"function"}]` → `[{functionDeclarations:[...]}]`
   - System message → `systemInstruction`
   - Injects thinking config, tool hardening, interleaved hint
4. Routes to Antigravity endpoint with failover (daily→autopush→prod)
5. Transforms response: Antigravity → OpenAI format
   - `candidates[].parts[{text}]` → `choices[].delta.content`
   - `candidates[].parts[{thought}]` → `choices[].delta.reasoning_content`
   - `functionCall` → `tool_calls[{function:{name,arguments}}]`
   - SSE lines rewritten in real-time

### Response Flow

- **Streaming**: Raw SSE lines → `transformSSELine()` → OpenAI SSE chunks → `data: [DONE]`
- **Non-streaming**: Full JSON response → `transformNonStreamResponse()` → OpenAI completion
- **Tool calls**: FIFO ID matching (deterministic `call_{name}_{index}` IDs)
- **Thinking**: Extracted as `reasoning_content` in streaming delta chunks

## Development

```bash
npm install
npm run dev          # Start with tsx hot-reload
npm run build        # Compile TypeScript
npm run typecheck    # Type checking only
npm test             # Run test suite (vitest)

# Integration testing
npm run build && node dist/index.js &
curl http://127.0.0.1:51120/health
curl http://127.0.0.1:51120/v1/models
```

## Acknowledgments

Ported from [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) by NoeFabris — a plugin for OpenCode that inspired this ZCode-compatible proxy.

## License

MIT
