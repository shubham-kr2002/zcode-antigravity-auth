# Test Strategy: zcode-antigravity-proxy

## 1. Test Strategy Overview

### Testing Scope

| Layer | Modules | Test Coverage |
|-------|---------|---------------|
| **Model Layer** | capabilities.ts, discovery.ts | 92.82% |
| **Transform Layer** | schema, request, response, claude, gemini, model-resolver, cross-model-sanitizer | 90.87% |
| **Accounts Layer** | manager, rotation, storage, fingerprint | ~85% |
| **API Layer** | retry, quota | ~47% |
| **CLI Layer** | setup, auth | ~32% |
| **Config/Constants** | config.ts, constants.ts | ~80% |
| **OAuth** | authorize, exchange, refresh, server | 0% |
| **Server Runtime** | server.ts, index.ts | 0% |

### Quality Objectives

- **Statement coverage**: >80% overall (current: 63.14%)
- **Branch coverage**: >85% for critical paths (current: 86.21%)
- **Function coverage**: >85% (current: 85.82%)
- **Zero regressions**: All 583 existing tests must pass before each release

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| OAuth token expires mid-session | Medium | High | Auto-refresh with retry logic, multi-account fallback |
| Antigravity API rate limits exhausted | Medium | High | Account rotation, exponential backoff, capacity retry |
| Model auto-discovery cache stale | Low | Medium | 1hr TTL, fallback to hardcoded list, graceful degradation |
| JSON schema incompatibility with Gemini API | Low | High | `toGeminiSchema()` strips 38+ unsupported fields |
| ESM module mocking in tests | Medium | Medium | Real temp directories for I/O, vi.spyOn for time-dependent logic |
| Race conditions in account selection | Low | Medium | Cursor increment, round-robin with health scores |

### Test Approach

- **Unit tests**: Vitest framework, pure function testing, I/O via temp directories
- **Integration tests**: Multi-module pipeline tests with mocked external APIs
- **No E2E tests**: Proxy depends on live Antigravity API which cannot be mocked realistically
- **Coverage-driven**: Target >80% statement coverage with `@vitest/coverage-v8`

---

## 2. ISTQB Framework Implementation

### Test Design Techniques

| Technique | Application |
|-----------|-------------|
| **Equivalence Partitioning** | Model ID patterns (Claude/Gemini/GPT/unknown), thinking tiers (low/medium/high/minimal/extra-low), finish reasons (STOP/MAX_TOKENS/Safety) |
| **Boundary Value Analysis** | TTL boundaries (59min/60min/61min), token budgets (4095/4096/4097), model name length (63/64/65 chars) |
| **Decision Table Testing** | Account selection strategy (sticky/round-robin/hybrid) × rate limit state × header style (antigravity/gemini-cli) |
| **State Transition Testing** | Account lifecycle (active → rate-limited → cooling-down → active), token refresh flow (valid → expired → refreshed) |
| **Experience-Based Testing** | Schema edge cases (circular refs, null values), empty/weird model names, double-prefixed antigravity models |

### Test Types Coverage Matrix

| Test Type | Coverage | Priority |
|-----------|----------|----------|
| **Functional** | Model resolution, request transform, response transform, schema cleaning, account rotation, retry logic | Critical |
| **Non-Functional** | Cache TTL, backoff delays, token bucket rates | High |
| **Structural** | Branch coverage, uncovered lines tracking | Medium |
| **Regression** | All 583 tests as pre-commit gate | Critical |

---

## 3. ISO 25010 Quality Characteristics Assessment

| Characteristic | Priority | Validation Approach |
|---------------|----------|-------------------|
| **Functional Suitability** | Critical | 583 unit/integration tests covering all exported functions |
| **Performance Efficiency** | High | Token bucket regeneration, rate limit backoff timing, cache TTL |
| **Reliability** | Critical | Account rotation fallback, endpoint failover, rate limit dedup, cache + hardcoded fallback |
| **Maintainability** | High | Modular architecture, ESM imports, typed interfaces, consistent test patterns |
| **Security** | High | OAuth PKCE flow, token storage in encrypted file, fingerprint headers |
| **Compatibility** | Medium | OpenAI-compatible API surface, Gemini + Claude model support |

---

## 4. Test Environment

- **Runtime**: Node.js >=20.0.0, ESM modules
- **Framework**: Vitest v3.x with `@vitest/coverage-v8`
- **CI**: `npm test` runs all 583 tests, `npm run test:coverage` generates coverage reports
- **File I/O**: Tests use `mkdtempSync` + `ZCODE_CONFIG_DIR` to avoid polluting real config
- **Network**: No network calls in unit tests — API interaction tested via mock Response objects
