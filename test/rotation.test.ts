/**
 * Tests for rotation system: HealthScoreTracker, TokenBucketTracker, hybrid selection.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  HealthScoreTracker,
  TokenBucketTracker,
  selectHybridAccount,
  sortByLruWithHealth,
  addJitter,
  randomDelay,
  DEFAULT_HEALTH_SCORE_CONFIG,
  DEFAULT_TOKEN_BUCKET_CONFIG,
  type AccountWithMetrics,
} from "../src/accounts/rotation.js";

// ---- HealthScoreTracker Tests ----

describe("HealthScoreTracker", () => {
  let tracker: HealthScoreTracker;

  beforeEach(() => {
    tracker = new HealthScoreTracker();
  });

  it("returns initial score for unknown accounts", () => {
    expect(tracker.getScore(0)).toBe(DEFAULT_HEALTH_SCORE_CONFIG.initial);
    expect(tracker.getScore(99)).toBe(DEFAULT_HEALTH_SCORE_CONFIG.initial);
  });

  it("records success and increases score", () => {
    tracker.recordSuccess(0);
    expect(tracker.getScore(0)).toBe(DEFAULT_HEALTH_SCORE_CONFIG.initial + DEFAULT_HEALTH_SCORE_CONFIG.successReward);
  });

  it("caps score at maxScore", () => {
    for (let i = 0; i < 100; i++) {
      tracker.recordSuccess(0);
    }
    expect(tracker.getScore(0)).toBeLessThanOrEqual(DEFAULT_HEALTH_SCORE_CONFIG.maxScore);
  });

  it("records rate limit penalties correctly", () => {
    tracker.recordRateLimit(0);
    expect(tracker.getScore(0)).toBe(DEFAULT_HEALTH_SCORE_CONFIG.initial + DEFAULT_HEALTH_SCORE_CONFIG.rateLimitPenalty);
  });

  it("records failure penalties correctly", () => {
    tracker.recordFailure(0);
    expect(tracker.getScore(0)).toBe(DEFAULT_HEALTH_SCORE_CONFIG.initial + DEFAULT_HEALTH_SCORE_CONFIG.failurePenalty);
  });

  it("scores never go below 0", () => {
    for (let i = 0; i < 20; i++) {
      tracker.recordFailure(0);
    }
    expect(tracker.getScore(0)).toBeGreaterThanOrEqual(0);
  });

  it("tracks consecutive failures", () => {
    expect(tracker.getConsecutiveFailures(0)).toBe(0);
    tracker.recordFailure(0);
    expect(tracker.getConsecutiveFailures(0)).toBe(1);
    tracker.recordFailure(0);
    expect(tracker.getConsecutiveFailures(0)).toBe(2);
    tracker.recordSuccess(0);
    expect(tracker.getConsecutiveFailures(0)).toBe(0);
  });

  it("records rate limit consecutive failures", () => {
    tracker.recordRateLimit(0);
    expect(tracker.getConsecutiveFailures(0)).toBe(1);
    tracker.recordRateLimit(0);
    expect(tracker.getConsecutiveFailures(0)).toBe(2);
  });

  it("checks if account is usable based on minUsable threshold", () => {
    // Fresh account should be usable
    expect(tracker.isUsable(0)).toBe(true);

    // Reduce score below minUsable
    for (let i = 0; i < 5; i++) {
      tracker.recordFailure(0);
    }
    // After 5 failures: 70 - (5 * 20) = -30 => clamped to 0
    expect(tracker.isUsable(0)).toBe(false);
  });

  it("applies time-based recovery", () => {
    // Record failures first
    tracker.recordFailure(0);
    const scoreAfterFailure = tracker.getScore(0);

    // Mock Date.now to simulate 2 hours passing
    const realNow = Date.now;
    const fakeNow = realNow() + 2 * 60 * 60 * 1000; // 2 hours
    vi.spyOn(Date, "now").mockReturnValue(fakeNow);

    const recoveredScore = tracker.getScore(0);
    expect(recoveredScore).toBeGreaterThan(scoreAfterFailure);

    vi.restoreAllMocks();
  });

  it("resets health state for account", () => {
    tracker.recordFailure(0);
    tracker.reset(0);
    expect(tracker.getScore(0)).toBe(DEFAULT_HEALTH_SCORE_CONFIG.initial);
    expect(tracker.getConsecutiveFailures(0)).toBe(0);
  });

  it("provides snapshot of scores", () => {
    tracker.recordSuccess(0);
    tracker.recordFailure(1);
    const snapshot = tracker.getSnapshot();
    expect(snapshot.has(0)).toBe(true);
    expect(snapshot.has(1)).toBe(true);
  });
});

// ---- TokenBucketTracker Tests ----

describe("TokenBucketTracker", () => {
  let bucket: TokenBucketTracker;

  beforeEach(() => {
    bucket = new TokenBucketTracker();
  });

  it("returns initial tokens for unknown accounts", () => {
    expect(bucket.getTokens(0)).toBe(DEFAULT_TOKEN_BUCKET_CONFIG.initialTokens);
  });

  it("consumes tokens correctly", () => {
    expect(bucket.consume(0, 10)).toBe(true);
    expect(bucket.getTokens(0)).toBeCloseTo(DEFAULT_TOKEN_BUCKET_CONFIG.initialTokens - 10, 0);
  });

  it("returns false when insufficient tokens", () => {
    expect(bucket.consume(0, DEFAULT_TOKEN_BUCKET_CONFIG.initialTokens + 1)).toBe(false);
  });

  it("hasTokens checks for sufficient balance", () => {
    expect(bucket.hasTokens(0, 10)).toBe(true);
    expect(bucket.hasTokens(0, DEFAULT_TOKEN_BUCKET_CONFIG.initialTokens + 1)).toBe(false);
  });

  it("refunds tokens correctly", () => {
    bucket.consume(0, 10);
    const afterConsume = bucket.getTokens(0);
    bucket.refund(0, 5);
    expect(bucket.getTokens(0)).toBeCloseTo(afterConsume + 5, 0);
  });

  it("caps tokens at maxTokens on refund", () => {
    bucket.refund(0, DEFAULT_TOKEN_BUCKET_CONFIG.maxTokens + 10);
    expect(bucket.getTokens(0)).toBeLessThanOrEqual(DEFAULT_TOKEN_BUCKET_CONFIG.maxTokens);
  });

  it("returns maxTokens", () => {
    expect(bucket.getMaxTokens()).toBe(DEFAULT_TOKEN_BUCKET_CONFIG.maxTokens);
  });

  it("regenerates tokens over time", () => {
    bucket.consume(0, 40); // 50 - 40 = 10 remaining
    expect(bucket.getTokens(0)).toBeCloseTo(10, 0);

    // Mock time passage: 5 minutes
    const realNow = Date.now;
    const fakeNow = realNow() + 5 * 60 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(fakeNow);

    // 5 min * 6 tokens/min = 30 tokens regenerated
    // 10 + 30 = 40, capped at 50
    expect(bucket.getTokens(0)).toBeCloseTo(40, 0);

    vi.restoreAllMocks();
  });
});

// ---- Jitter Utilities Tests ----

describe("Jitter Utilities", () => {
  it("addJitter stays within jitter range", () => {
    for (let i = 0; i < 100; i++) {
      const result = addJitter(1000, 0.3);
      expect(result).toBeGreaterThanOrEqual(700);
      expect(result).toBeLessThanOrEqual(1300);
    }
  });

  it("addJitter never returns negative", () => {
    for (let i = 0; i < 100; i++) {
      expect(addJitter(10, 2.0)).toBeGreaterThanOrEqual(0);
    }
  });

  it("randomDelay stays within range", () => {
    for (let i = 0; i < 100; i++) {
      const result = randomDelay(100, 200);
      expect(result).toBeGreaterThanOrEqual(100);
      expect(result).toBeLessThanOrEqual(200);
    }
  });
});

// ---- LRU Sort Tests ----

describe("sortByLruWithHealth", () => {
  function makeAccount(overrides: Partial<AccountWithMetrics> = {}): AccountWithMetrics {
    return {
      index: 0,
      lastUsed: 0,
      healthScore: 70,
      isRateLimited: false,
      isCoolingDown: false,
      ...overrides,
    };
  }

  it("sorts by lastUsed (LRU first)", () => {
    const accounts: AccountWithMetrics[] = [
      makeAccount({ index: 0, lastUsed: 3000 }),
      makeAccount({ index: 1, lastUsed: 1000 }),
      makeAccount({ index: 2, lastUsed: 2000 }),
    ];

    const sorted = sortByLruWithHealth(accounts);
    expect(sorted[0]!.index).toBe(1); // oldest (1000)
    expect(sorted[1]!.index).toBe(2); // middle (2000)
    expect(sorted[2]!.index).toBe(0); // newest (3000)
  });

  it("filters out rate-limited accounts", () => {
    const accounts: AccountWithMetrics[] = [
      makeAccount({ index: 0, isRateLimited: true }),
      makeAccount({ index: 1, isRateLimited: false }),
      makeAccount({ index: 2, isRateLimited: true }),
    ];

    const sorted = sortByLruWithHealth(accounts);
    expect(sorted.length).toBe(1);
    expect(sorted[0]!.index).toBe(1);
  });

  it("filters out cooling-down accounts", () => {
    const accounts: AccountWithMetrics[] = [
      makeAccount({ index: 0, isCoolingDown: true }),
      makeAccount({ index: 1, isCoolingDown: false }),
    ];

    const sorted = sortByLruWithHealth(accounts);
    expect(sorted.length).toBe(1);
    expect(sorted[0]!.index).toBe(1);
  });

  it("filters out unhealthy accounts", () => {
    const accounts: AccountWithMetrics[] = [
      makeAccount({ index: 0, healthScore: 30 }),
      makeAccount({ index: 1, healthScore: 80 }),
    ];

    const sorted = sortByLruWithHealth(accounts, 50);
    expect(sorted.length).toBe(1);
    expect(sorted[0]!.index).toBe(1);
  });

  it("uses health score as tiebreaker when lastUsed is same", () => {
    const accounts: AccountWithMetrics[] = [
      makeAccount({ index: 0, lastUsed: 1000, healthScore: 60 }),
      makeAccount({ index: 1, lastUsed: 1000, healthScore: 80 }),
    ];

    const sorted = sortByLruWithHealth(accounts);
    expect(sorted[0]!.index).toBe(1); // higher health score
    expect(sorted[1]!.index).toBe(0);
  });
});

// ---- Hybrid Selection Tests ----

describe("selectHybridAccount", () => {
  let tokenTracker: TokenBucketTracker;

  beforeEach(() => {
    tokenTracker = new TokenBucketTracker();
  });

  function makeAccount(overrides: Partial<AccountWithMetrics> = {}): AccountWithMetrics {
    return {
      index: 0,
      lastUsed: 0,
      healthScore: 70,
      isRateLimited: false,
      isCoolingDown: false,
      ...overrides,
    };
  }

  it("returns null when no accounts available", () => {
    expect(selectHybridAccount([], tokenTracker)).toBeNull();
  });

  it("returns null when all rate-limited", () => {
    const accounts = [
      makeAccount({ index: 0, isRateLimited: true }),
      makeAccount({ index: 1, isRateLimited: true }),
    ];
    expect(selectHybridAccount(accounts, tokenTracker)).toBeNull();
  });

  it("selects the only available account", () => {
    const accounts = [
      makeAccount({ index: 0, isRateLimited: true }),
      makeAccount({ index: 1 }),
    ];
    expect(selectHybridAccount(accounts, tokenTracker)).toBe(1);
  });

  it("prefers current account due to stickiness bonus", () => {
    const accounts = [
      makeAccount({ index: 0, healthScore: 90, lastUsed: 5000 }),
      makeAccount({ index: 1, healthScore: 80, lastUsed: 6000 }),
    ];
    // Both are valid; index 0 has advantage, but 1 is current
    expect(selectHybridAccount(accounts, tokenTracker, 1)).toBe(1);
  });

  it("switches when current is unhealthy", () => {
    const accounts = [
      makeAccount({ index: 0, healthScore: 80 }),
      makeAccount({ index: 1, healthScore: 30 }), // unhealthy
    ];
    expect(selectHybridAccount(accounts, tokenTracker, 1)).toBe(0);
  });

  it("switches when another account has large advantage", () => {
    // Account 0 has extreme advantage: 100 health vs 40 health
    // Score diff: (200-80) + (500-500) + (5-0.1) = 124.9 > 100 SWITCH_THRESHOLD
    const accounts = [
      makeAccount({ index: 0, healthScore: 100, lastUsed: 5000 }),
      makeAccount({ index: 1, healthScore: 40, lastUsed: 1000 }),
    ];
    expect(selectHybridAccount(accounts, tokenTracker, 1)).toBe(0);
  });

  it("filters by token availability", () => {
    // Drain tokens for account 0
    tokenTracker.consume(0, 50);

    const accounts = [
      makeAccount({ index: 0, healthScore: 100 }),
      makeAccount({ index: 1, healthScore: 50 }),
    ];
    expect(selectHybridAccount(accounts, tokenTracker)).toBe(1);
  });
});
