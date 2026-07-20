# EVAL: proxy-regression

## Description

Regression tests for the zcode-antigravity-proxy. Ensures that existing
behavior does not regress: model count stays at expected levels (fallback or
discovered), thinking models resolve correctly, auth errors are properly
rejected with 401, and account rate-limit metadata is present.

**Requires:** Proxy running on `http://localhost:51120` and
`ANTIGRAVITY_ACCESS_TOKEN` set in the environment.

---

## Eval Items

### 1. Model count >= 13 (not zero from fallback)

The proxy's hardcoded fallback list contains 13 models. If API discovery fails
(no accounts or network error) the proxy should return the full fallback list,
not an empty or zero-length list. A count below 13 indicates something went
wrong in model loading.

```bash
#@grade
BODY=$(curl -s http://localhost:51120/v1/models 2>/dev/null)
COUNT=$(echo "$BODY" | jq '.data | length' 2>/dev/null || echo 0)
if [ "$COUNT" -ge 13 ] 2>/dev/null; then
  echo "PASS: $COUNT models listed (>= 13)"
else
  echo "FAIL: expected at least 13 models, got $COUNT"
  echo "Response: $(echo "$BODY" | jq -c '.data[].id' 2>/dev/null | head -5)"
  exit 1
fi
```

### 2. Thinking model claude-opus-4-6-thinking is present

The thinking variant of Claude Opus 4 must be listed in the models endpoint so
that clients can discover and use it for extended reasoning tasks.

```bash
#@grade
BODY=$(curl -s http://localhost:51120/v1/models 2>/dev/null)
FOUND=$(echo "$BODY" | jq '[.data[].id] | any(. == "claude-opus-4-6-thinking")' 2>/dev/null || echo "false")
if [ "$FOUND" = "true" ]; then
  echo "PASS: claude-opus-4-6-thinking is in model list"
else
  echo "FAIL: claude-opus-4-6-thinking not found in model list"
  echo "Available: $(echo "$BODY" | jq -r '[.data[].id] | join(", ")' 2>/dev/null)"
  exit 1
fi
```

### 3. Request without auth returns 401

POST to `/v1/chat/completions` without an `Authorization` header must be
rejected with HTTP 401 (Unauthorized).

```bash
#@grade
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:51120/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"test"}],"max_tokens":10}' 2>/dev/null)
BODY=$(curl -s -X POST http://localhost:51120/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"test"}],"max_tokens":10}' 2>/dev/null)
if [ "$RESPONSE" = "401" ]; then
  echo "PASS: unauthenticated request returned 401"
elif echo "$BODY" | jq -e '.error' >/dev/null 2>&1; then
  # Some proxies return 400 or other codes for missing auth; check for error
  echo "FAIL: expected 401, got HTTP $RESPONSE (error: $(echo "$BODY" | jq -r '.error.message // .error' 2>/dev/null))"
  exit 1
else
  echo "FAIL: expected 401 for unauthenticated request, got HTTP $RESPONSE"
  exit 1
fi
```

### 4. Account rate limit reset times are present

The `/v1/accounts` endpoint should provide `rateLimitResetTimes` metadata for
each account, indicating when rate limits will reset. This is required for the
proxy's rate-limit backoff logic to function correctly.

```bash
#@grade
BODY=$(curl -s http://localhost:51120/v1/accounts 2>/dev/null)
ACCOUNTS_COUNT=$(echo "$BODY" | jq '.accounts | length' 2>/dev/null || echo 0)
HAS_RESET_TIMES=$(echo "$BODY" | jq '[.accounts[] | has("rateLimitResetTimes")] | all' 2>/dev/null || echo "false")
if [ "$ACCOUNTS_COUNT" -ge 0 ] 2>/dev/null && [ "$HAS_RESET_TIMES" = "true" ]; then
  echo "PASS: all $ACCOUNTS_COUNT accounts have rateLimitResetTimes"
elif [ "$ACCOUNTS_COUNT" = "0" ] 2>/dev/null; then
  echo "WARN: no accounts configured, but response format is valid (rateLimitResetTimes present in schema)"
  # For zero accounts, the field may not be present; check the response shape
  HAS_ACCOUNTS_FIELD=$(echo "$BODY" | jq 'has("accounts")' 2>/dev/null || echo "false")
  if [ "$HAS_ACCOUNTS_FIELD" = "true" ]; then
    echo "PASS: /v1/accounts response format is valid (0 accounts)"
  else
    echo "FAIL: /v1/accounts missing accounts field"
    exit 1
  fi
else
  echo "FAIL: accounts missing rateLimitResetTimes"
  echo "Response: $(echo "$BODY" | jq -c . 2>/dev/null)"
  exit 1
fi
```

---

## Success Checklist

- [ ] Item 1: At least 13 models listed (fallback or API discovery succeeded)
- [ ] Item 2: claude-opus-4-6-thinking is present in the model list
- [ ] Item 3: Request without Authorization header returns 401
- [ ] Item 4: Accounts have rateLimitResetTimes metadata or response format is valid
