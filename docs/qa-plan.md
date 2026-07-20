# Quality Assurance Plan: zcode-antigravity-proxy

## Quality Gates

### Gate 1: Development (Pre-Commit)

| Criteria | Requirement |
|----------|-------------|
| Build | `npx tsc --noEmit` passes with zero errors |
| Unit tests | `npx vitest run` — all 583+ tests pass |
| Coverage | No decrease in statement coverage |
| Lint | Code follows project conventions |

### Gate 2: Staging (Pre-Release)

| Criteria | Requirement |
|----------|-------------|
| Integration tests | All pass |
| Model auto-discovery | Verified against live Antigravity API |
| Rate limit handling | Account rotation cycles correctly |
| OAuth refresh | Token refresh works end-to-end |

### Gate 3: Production

| Criteria | Requirement |
|----------|-------------|
| Smoke test | Proxy starts, /v1/models returns 200 |
| Model count | At least 13+ models auto-discovered |
| Chat completion | At least Claude and Gemini models respond |
| Auth flow | Login → setup → status cycle works |

---

## Quality Metrics

| Metric | Current | Target |
|--------|---------|--------|
| **Statement coverage** | 63.14% | >80% |
| **Branch coverage** | 86.21% | >85% ✅ |
| **Function coverage** | 85.82% | >85% ✅ |
| **Test count** | 583 | >600 |
| **Test files** | 17 | >20 |
| **Build failures** | 0 | 0 |

---

## Coverage Gaps (Priority Order)

| Module | Lines | Coverage | Priority | Action |
|--------|-------|----------|----------|--------|
| `src/server.ts` | 663 | 0% | High | Integration tests with mocked Express |
| `src/index.ts` | 95 | 0% | High | Startup sequence test |
| `src/oauth/*` | 405 | 0% | High | OAuth flow unit tests with mocked fetch |
| `src/api/quota.ts` | 340 | 0% | Medium | Quota checking logic |
| `src/cli/auth.ts` | 444 | 0% | Medium | CLI command tests |
| `src/accounts/fingerprint.ts` | 193 | ~60% | Low | Fingerprint edge cases |

---

## Escalation Procedures

| Issue | Action |
|-------|--------|
| **Test failure in CI** | Block merge, assign to author, fix within 24hrs |
| **Coverage drop >1%** | Block merge, add tests before merge |
| **Flaky test (>5% failure rate)** | Investigate, quarantine with `--bail`, fix within 1 week |
| **Production regression** | Hotfix + regression test added to suite |

---

## Risk-Based Test Prioritization

| Risk Area | Tests | Priority |
|-----------|-------|----------|
| Model resolution with thinking tiers | model-resolver.test.ts (77) | P0 |
| Schema cleaning for Gemini API | schema.test.ts (54) | P0 |
| Account rotation and rate limiting | manager.test.ts (48), rotation.test.ts (38) | P0 |
| Model auto-discovery | discovery.test.ts (35), capabilities.test.ts (68) | P0 |
| Request/response transformation | request.test.ts (20), response.test.ts (20) | P1 |
| Cross-model sanitization | cross-model-sanitizer.test.ts (62) | P1 |
| Retry and failover | retry.test.ts (24) | P1 |
| CLI setup and config | setup.test.ts (20), config.test.ts (9) | P2 |
| Storage and fingerprint | storage.test.ts (21), fingerprint.test.ts (12) | P2 |
| Constants/headers | constants.test.ts (16) | P2 |

---

## Test Execution Timeline

| Phase | Test Count | Status |
|-------|-----------|--------|
| Phase 1: Infrastructure | N/A | ✅ Done |
| Phase 2: Model Layer | 180 | ✅ Done |
| Phase 3: Extended Unit | 94 | ✅ Done |
| Phase 4: Infrastructure | 140 | ✅ Done |
| Phase 5: Integration | ~20 | 🔄 In Progress |
| Phase 6: Production Eval | ~15 | 📋 Planned |
| **Total** | **~600** | |
