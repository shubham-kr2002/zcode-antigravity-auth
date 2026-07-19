# Antigravity Models via zcode-antigravity-proxy

This document describes the models available when using the Antigravity proxy provider in ZCode.

## Model Auto-Discovery 🚀

**Models are now auto-discovered from the Antigravity API at startup.** When new models are released on Antigravity, they automatically appear — no code changes needed.

- On proxy startup, models are loaded from the `fetchAvailableModels` API endpoint
- Results are cached to `~/.zcode/antigravity-models-cache.json` (1 hour TTL)
- If the API is unreachable, a hardcoded fallback list is used
- Running `/antigravity-setup` regenerates the ZCode provider config from cached/discovered models

### Cache Configuration
- `ANTIGRAVITY_MODEL_CACHE_TTL_MINUTES` — Cache TTL in minutes (default: 60)

## Currently Working Models (15 verified working)

### Claude Models (Anthropic via Antigravity)

| Model ID | Context | Max Output | Thinking | Best For |
|----------|---------|------------|----------|----------|
| `claude-opus-4-6-thinking` | 200K | 64K | ✅ (low/medium/high) | Complex reasoning, architecture, multi-step planning |
| `claude-sonnet-4-6` | 200K | 64K | ❌ | Fast coding, simple refactors, quick answers |

**Thinking Tiers for Claude Opus:**
- `claude-opus-4-6-thinking-low` → 8,192 token budget
- `claude-opus-4-6-thinking-medium` → 16,384 token budget
- `claude-opus-4-6-thinking-high` → 32,768 token budget (default)

### Gemini 3.x Models (Google via Antigravity)

| Model ID | Context | Max Output | Thinking | Best For |
|----------|---------|------------|----------|----------|
| `gemini-3-flash` | 1M | 65K | ✅ (minimal/low/medium/high) | Fast completions, quick iterations |
| `gemini-3-flash-agent` | 1M | 65K | ✅ (minimal/low/medium/high) | Agent-powered tasks |

**Thinking Tiers for Gemini 3 Flash:**
- `gemini-3-flash-minimal` → Fastest, minimal thinking
- `gemini-3-flash-low`
- `gemini-3-flash-medium`
- `gemini-3-flash-high` → Deepest thinking (default)

### Gemini 3.1 Models (Google via Antigravity)

| Model ID | Context | Max Output | Thinking | Best For |
|----------|---------|------------|----------|----------|
| `gemini-3.1-pro-low` | 1M | 65K | ✅ (low) | Latest Pro, balanced reasoning |
| `gemini-3.1-flash-lite` | 1M | 65K | ✅ (low/medium/high) | Fast, cost-effective |
| `gemini-3.1-flash-image` | 1M | 65K | ❌ | Image generation tasks |

### Gemini 3.5 Models (Google via Antigravity)

| Model ID | Context | Max Output | Thinking | Best For |
|----------|---------|------------|----------|----------|
| `gemini-3.5-flash-low` | 1M | 65K | ✅ (low) | Latest Flash, light thinking |
| `gemini-3.5-flash-extra-low` | 1M | 65K | ✅ (extra-low) | Ultra-fast, minimal overhead |

### Gemini 2.5 Models (Google via Antigravity)

| Model ID | Context | Max Output | Thinking | Best For |
|----------|---------|------------|----------|----------|
| `gemini-2.5-flash` | 1M | 65K | ✅ (low/medium/high) | Fast, cost-effective completions |
| `gemini-2.5-flash-lite` | 1M | 65K | ✅ (low/medium/high) | Lightweight, fastest responses |
| `gemini-2.5-flash-thinking` | 1M | 65K | ✅ (low/medium/high) | Fast completions with thinking |

**Thinking Tiers for Gemini 2.5 Flash:**
- `gemini-2.5-flash-low` → 6,144 token budget
- `gemini-2.5-flash-medium` → 12,288 token budget
- `gemini-2.5-flash-high` → 24,576 token budget (default)

**Thinking Tiers for Gemini 2.5 Flash Lite:**
- `gemini-2.5-flash-lite-low` → 4,096 token budget
- `gemini-2.5-flash-lite-medium` → 8,192 token budget (default)
- `gemini-2.5-flash-lite-high` → 16,384 token budget

### Other Models

| Model ID | Context | Max Output | Thinking | Best For |
|----------|---------|------------|----------|----------|
| `gpt-oss-120b-medium` | 128K | 16K | ✅ (medium) | Open-source GPT alternative |

## Model Selection Guide

### For Complex Architecture & Planning
Use **Claude Opus 4.6 Thinking** with the `high` tier:
```
/claude-opus-4-6-thinking-high
```
Best for: System design, multi-file refactors, complex debugging, architectural decisions.

### For Fast Coding Tasks
Use **Claude Sonnet 4.6** or **Gemini 3 Flash**:
```
/claude-sonnet-4-6
/gemini-3-flash-high
```
Best for: Simple fixes, code generation, quick questions.

### For Large Codebase Analysis
Use **Gemini 3.1 Pro** with 1M context:
```
/gemini-3.1-pro-low
```
Best for: Analyzing entire repositories, long conversations, multi-file edits.

### For Cost-Effective Iterations
Use **Gemini 2.5 Flash** or **Gemini 2.5 Flash Lite**:
```
/gemini-2.5-flash-high
/gemini-2.5-flash-lite
```
Best for: Quick iterations, bulk operations, simple code generation.

### For Image Generation
Use **Gemini 3.1 Flash Image**:
```
/gemini-3.1-flash-image
```
Best for: Generating and editing images.

### For Open-Source Needs
Use **GPT-OSS 120B**:
```
/gpt-oss-120b-medium
```
Best for: Open-source model experimentation.

## Troubleshooting

### "Gemini API not enabled" (403 error)
Some models require the Gemini API to be enabled on your Google Cloud project.
Visit: `https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com`

### "Model not found" (404 error)
Ensure the proxy is running (`antigravity-auth status`) and your model name is correct.
Models are auto-discovered — run `antigravity-auth status` to see the current model list.

### Rate Limits (429)
The proxy handles automatic account rotation. Add more Google accounts via `antigravity-auth login`
for additional quota capacity.

### Authentication Issues
Run `antigravity-auth login` to re-authenticate. OAuth tokens are refreshed automatically.
