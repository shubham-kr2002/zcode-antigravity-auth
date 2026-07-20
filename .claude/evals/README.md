# Eval Harness: zcode-antigravity-proxy

This directory contains eval definitions for the `zcode-antigravity-proxy`
Express server. The evals use code-based graders (curl + jq) to verify the
proxy's behavior against its running instance.

## Prerequisites

Before running evals, ensure:

1. **Proxy is running** on `http://localhost:51120` (the default port).
   ```bash
   cd /home/krira/ZCodeProject/zcode-antigravity-proxy
   npm start        # or: node dist/index.js
   ```

2. **`ANTIGRAVITY_ACCESS_TOKEN` environment variable is set** to a valid
   access token. The proxy uses this for manual auth when no stored accounts
   are available.
   ```bash
   export ANTIGRAVITY_ACCESS_TOKEN="your-token-here"
   ```

3. **`jq` is installed** for JSON parsing in grader commands.
   ```bash
   which jq || (sudo apt-get update && sudo apt-get install -y jq)
   ```

## Running Evals

### Capability Eval

Verifies core proxy features:

```bash
claude /eval check proxy-capability
```

This runs six checks:
- Health endpoint responds with status ok
- Model list contains at least 5 entries
- Claude chat completion returns content
- Gemini chat completion returns choices
- Tool schemas with `exclusiveMinimum` are accepted (schema stripping works)
- Accounts endpoint returns valid JSON

### Regression Eval

Ensures existing behavior hasn't regressed:

```bash
claude /eval check proxy-regression
```

This runs four checks:
- At least 13 models listed (full fallback or API-discovered)
- `claude-opus-4-6-thinking` model is present
- Requests without auth return 401
- Account rate-limit reset times are present

## Grading

Each eval item is a **code-based grader** (shell command) that:

1. Makes one or more `curl` requests to the proxy
2. Parses the JSON response with `jq`
3. Prints `PASS` or `FAIL` for each check
4. Exits with code 0 on pass, 1 on fail

No model-based grading is used -- all checks are deterministic.

## Pass Criteria

- **Capability eval:** All 6 items in the success checklist must pass.
- **Regression eval:** All 4 items in the success checklist must pass.

Items with `WARN` (e.g., zero accounts) are not failures -- they indicate a
valid but empty state (e.g., no accounts configured yet).

## Eval Files

| File | Purpose |
|------|---------|
| `proxy-capability.md` | Capability tests for all major endpoints and scenarios |
| `proxy-regression.md` | Regression tests for model count, thinking models, auth, and rate limits |
| `README.md` | This file: usage instructions and documentation |

## Adding New Evals

To add a new eval item to an existing file:

1. Add a new section with a descriptive heading and `#@grade` block
2. Include a curl command that pings the proxy endpoint
3. Use `jq` to inspect the response and `grep` or numeric comparisons to assert
   expected values
4. Print `PASS` or `FAIL` and `exit 1` on failure
5. Add a bullet to the Success Checklist at the bottom of the file

Evals are first-class artifacts -- version them with the codebase.
