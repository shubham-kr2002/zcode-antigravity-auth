---
description: Login to Antigravity with your Google account to authenticate for Claude & Gemini models.
argument-hint: ""
allowed-tools: Read, Bash, AskUserQuestion
skills: antigravity-auth
---

# Antigravity Login

Log the user in to Antigravity via Google OAuth. This is a one-time setup step.

## Instructions

1. Tell the user: "I'll open Google's OAuth page in your browser. Complete the sign-in and I'll handle the rest."
2. Run: `node "${ZCODE_PLUGIN_ROOT}/dist/cli/auth.js" login`
3. The CLI will open a browser and wait for the OAuth callback.
4. After success, confirm to the user: "✅ Authenticated! Your Claude & Gemini models are now ready to use."
5. Check status with `/antigravity-status`

If the user is in a headless environment (SSH, no browser), tell them to:
- Open the URL manually on a machine with a browser
- After Google sign-in, copy the full redirect URL from the address bar
- Paste it back here and I'll complete the auth
