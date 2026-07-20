# EVAL: proxy-capability

## Description

Verifies that the zcode-antigravity-proxy exposes all required API endpoints and
handles core scenarios correctly: health checks, model listing, chat completions
(both Claude and Gemini), tool schema handling with strict numeric constraints,
and account status.

**Requires:** Proxy running on `http://localhost:51120` and
`ANTIGRAVITY_ACCESS_TOKEN` set in the environment.

---

## Eval Items

### 1. Health check returns OK

The `/health` endpoint must respond 200 with `status: "ok"`.

```bash
#@grade
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:51120/health)
BODY=$(curl -s http://localhost:51120/health)
echo "$BODY" | grep -q '"status":"ok"' && echo "PASS: health check OK (HTTP $RESPONSE)" || echo "FAIL: expected status ok, got: $BODY"
[ "$RESPONSE" = "200" ] || exit 1
```

### 2. Model list returns at least 5 models

The `/v1/models` endpoint must return a JSON response with a `data` array
containing at least 5 model entries.

```bash
#@grade
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:51120/v1/models)
BODY=$(curl -s http://localhost:51120/v1/models)
COUNT=$(echo "$BODY" | jq '.data | length' 2>/dev/null || echo 0)
if [ "$RESPONSE" = "200" ] && [ "$COUNT" -ge 5 ] 2>/dev/null; then
  echo "PASS: $COUNT models returned (HTTP $RESPONSE)"
else
  echo "FAIL: expected >= 5 models, got $COUNT (HTTP $RESPONSE)"
  exit 1
fi
```

### 3. Chat completion with claude-sonnet-4-6

POST to `/v1/chat/completions` with model `claude-sonnet-4-6` must return a
response with a non-empty `choices[0].message.content`.

```bash
#@grade
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:51120/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANTIGRAVITY_ACCESS_TOKEN" \
  -d '{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"Reply with exactly one word: hello"}],"max_tokens":20}' 2>/dev/null)
BODY=$(curl -s -X POST http://localhost:51120/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANTIGRAVITY_ACCESS_TOKEN" \
  -d '{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"Reply with exactly one word: hello"}],"max_tokens":20}' 2>/dev/null)
CONTENT=$(echo "$BODY" | jq -r '.choices[0].message.content // empty' 2>/dev/null)
if [ "$RESPONSE" = "200" ] && [ -n "$CONTENT" ]; then
  echo "PASS: claude-sonnet-4-6 returned content (HTTP $RESPONSE)"
elif echo "$BODY" | jq -e '.error' >/dev/null 2>&1; then
  echo "FAIL: API returned error: $(echo "$BODY" | jq -r '.error.message // .error')"
  exit 1
else
  echo "FAIL: expected 200 with content, got HTTP $RESPONSE"
  exit 1
fi
```

### 4. Chat completion with gemini-3-flash

POST to `/v1/chat/completions` with model `gemini-3-flash` must return a
response with a non-empty `choices` array.

```bash
#@grade
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:51120/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANTIGRAVITY_ACCESS_TOKEN" \
  -d '{"model":"gemini-3-flash","messages":[{"role":"user","content":"Reply with exactly one word: world"}],"max_tokens":20}' 2>/dev/null)
BODY=$(curl -s -X POST http://localhost:51120/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANTIGRAVITY_ACCESS_TOKEN" \
  -d '{"model":"gemini-3-flash","messages":[{"role":"user","content":"Reply with exactly one word: world"}],"max_tokens":20}' 2>/dev/null)
CHOICES_COUNT=$(echo "$BODY" | jq '.choices | length' 2>/dev/null || echo 0)
CONTENT=$(echo "$BODY" | jq -r '.choices[0].message.content // empty' 2>/dev/null)
if [ "$RESPONSE" = "200" ] && [ "$CHOICES_COUNT" -gt 0 ] && [ -n "$CONTENT" ]; then
  echo "PASS: gemini-3-flash returned content (HTTP $RESPONSE)"
elif echo "$BODY" | jq -e '.error' >/dev/null 2>&1; then
  echo "FAIL: API returned error: $(echo "$BODY" | jq -r '.error.message // .error')"
  exit 1
else
  echo "FAIL: expected 200 with choices, got HTTP $RESPONSE"
  exit 1
fi
```

### 5. Chat completion with tools containing exclusiveMinimum

POST with a tool whose parameter schema includes `exclusiveMinimum` (a strict
numeric constraint that Gemini rejects). The proxy must strip the unsupported
field (via `toGeminiSchema` / `cleanJSONSchema`) and return a success response
rather than a 400 schema validation error.

```bash
#@grade
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:51120/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANTIGRAVITY_ACCESS_TOKEN" \
  -d '{
    "model":"claude-sonnet-4-6",
    "messages":[{"role":"user","content":"Call the test tool with value 5"}],
    "tools":[{
      "type":"function",
      "function":{
        "name":"test_tool",
        "description":"A test tool",
        "parameters":{
          "type":"object",
          "properties":{
            "value":{"type":"integer","exclusiveMinimum":0,"description":"Must be > 0"}
          },
          "required":["value"]
        }
      }
    }],
    "max_tokens":50
  }' 2>/dev/null)
if [ "$RESPONSE" = "200" ]; then
  echo "PASS: tool with exclusiveMinimum accepted (HTTP $RESPONSE)"
else
  BODY=$(curl -s -X POST http://localhost:51120/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ANTIGRAVITY_ACCESS_TOKEN" \
    -d '{
      "model":"claude-sonnet-4-6",
      "messages":[{"role":"user","content":"Call the test tool with value 5"}],
      "tools":[{
        "type":"function",
        "function":{
          "name":"test_tool",
          "description":"A test tool",
          "parameters":{
            "type":"object",
            "properties":{
              "value":{"type":"integer","exclusiveMinimum":0,"description":"Must be > 0"}
            },
            "required":["value"]
          }
        }
      }],
      "max_tokens":50
    }' 2>/dev/null)
  echo "FAIL: expected 200, got HTTP $RESPONSE: $(echo "$BODY" | jq -r '.error.message // .error // empty')"
  exit 1
fi
```

### 6. Accounts endpoint returns valid JSON

The `/v1/accounts` endpoint must return HTTP 200 with a JSON body containing an
`accounts` array.

```bash
#@grade
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:51120/v1/accounts)
BODY=$(curl -s http://localhost:51120/v1/accounts)
HAS_ACCOUNTS=$(echo "$BODY" | jq 'has("accounts")' 2>/dev/null || echo "false")
ACCOUNTS_TYPE=$(echo "$BODY" | jq '.accounts | type' 2>/dev/null || echo '""')
if [ "$RESPONSE" = "200" ] && [ "$HAS_ACCOUNTS" = "true" ] && [ "$ACCOUNTS_TYPE" = '"array"' ]; then
  echo "PASS: /v1/accounts returned valid JSON with accounts array (HTTP $RESPONSE)"
else
  echo "FAIL: expected 200 with accounts array, got HTTP $RESPONSE, has accounts: $HAS_ACCOUNTS, type: $ACCOUNTS_TYPE"
  exit 1
fi
```

---

## Success Checklist

- [ ] Item 1: Health endpoint responds 200 with status ok
- [ ] Item 2: Model list contains at least 5 entries
- [ ] Item 3: Claude chat completion returns content
- [ ] Item 4: Gemini chat completion returns choices
- [ ] Item 5: Tool with exclusiveMinimum is accepted (schema stripping works)
- [ ] Item 6: Accounts endpoint returns valid accounts array
