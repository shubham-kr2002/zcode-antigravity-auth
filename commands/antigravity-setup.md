---
description: Configure the Antigravity provider in ZCode — adds the 7 models to your local config.
argument-hint: ""
allowed-tools: Read, Bash, Write
skills: antigravity-auth
---

# Antigravity Setup

Register the Antigravity provider and models in the ZCode configuration at `~/.zcode/v2/config.json`.

## Instructions

1. Run: `node "${ZCODE_PLUGIN_ROOT}/dist/cli/auth.js" setup`
2. The setup is idempotent — running it multiple times won't duplicate models.
3. After setup, confirm the models are registered by checking `/antigravity-status`.

## What gets configured

- Provider name: "Antigravity (Google OAuth)"
- Base URL: `http://127.0.0.1:51120/v1`
- 7 models with context limits and thinking tiers

If setup fails:
- Ensure `${HOME}/.zcode/v2/config.json` exists (ZCode must have been run at least once)
- A backup is created at `${HOME}/.zcode/v2/config.json.antigravity-backup` before any changes
