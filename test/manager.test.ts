/**
 * Tests for AccountManager: multi-account selection, rate limiting, cooldowns.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AccountManager,
  parseRateLimitReason,
  calculateBackoffMs,
  type ManagedAccount,
  type RateLimitReason,
} from "../src/accounts/manager.js";
import type { AccountStorage } from "../src/accounts/storage.js";
import { getTokenTracker, initTokenTracker, getHealthTracker, initHealthTracker } from "../src/accounts/rotation.js";

// ---- Helpers ----

function makeStorage(accounts: AccountStorage["accounts"] = [], overrides: Partial<AccountStorage> = {}): AccountStorage {
  return {
    version: 4,
    accounts,
    activeIndex: 0,
    activeIndexByFamily: { claude: 0, gemini: 0 },
    ...overrides,
  };
}

function makeStoredAccount(overrides: Partial<AccountStorage["accounts"][number]> = {}): AccountStorage["accounts"][number] {
  return {
    email: `user${overrides.addedAt ?? 0}@gmail.com`,
    refreshToken: `refresh-token-${overrides.addedAt ?? 0}`,
    projectId: `project-${overrides.addedAt ?? 0}`,
    addedAt: 1000000,
    lastUsed: 0,
    enabled: true,
    ...overrides,
  };
}

// ---- parseRateLimitReason Tests ----

describe("parseRateLimitReason", () => {
  it("detects QUOTA_EXHAUSTED from reason string", () => {
    expect(parseRateLimitReason("QUOTA_EXHAUSTED", "", undefined)).toBe("QUOTA_EXHAUSTED");
  });

  it("detects RATE_LIMIT_EXCEEDED from reason string", () => {
    expect(parseRateLimitReason("RATE_LIMIT_EXCEEDED", "", undefined)).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("detects MODEL_CAPACITY_EXHAUSTED from status 529", () => {
    expect(parseRateLimitReason(undefined, "", 529)).toBe("MODEL_CAPACITY_EXHAUSTED");
  });

  it("detects MODEL_CAPACITY_EXHAUSTED from status 503", () => {
    expect(parseRateLimitReason(undefined, "", 503)).toBe("MODEL_CAPACITY_EXHAUSTED");
  });

  it("detects SERVER_ERROR from status 500", () => {
    expect(parseRateLimitReason(undefined, "", 500)).toBe("SERVER_ERROR");
  });

  it("detects from message text: capacity/overloaded", () => {
    expect(parseRateLimitReason(undefined, "Model capacity exceeded", undefined)).toBe("MODEL_CAPACITY_EXHAUSTED");
    expect(parseRateLimitReason(undefined, "Service overloaded", undefined)).toBe("MODEL_CAPACITY_EXHAUSTED");
  });

  it("detects from message text: rate limit", () => {
    expect(parseRateLimitReason(undefined, "Rate limit per minute exceeded", undefined)).toBe("RATE_LIMIT_EXCEEDED");
    expect(parseRateLimitReason(undefined, "too many requests", undefined)).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("detects from message text: quota exhausted", () => {
    expect(parseRateLimitReason(undefined, "Quota exhausted", undefined)).toBe("QUOTA_EXHAUSTED");
    expect(parseRateLimitReason(undefined, "Token quota exhausted for today", undefined)).toBe("QUOTA_EXHAUSTED");
  });

  it("returns UNKNOWN for 429 without clear info", () => {
    expect(parseRateLimitReason(undefined, "Something went wrong", 429)).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for unrecognized status", () => {
    expect(parseRateLimitReason(undefined, "Something went wrong", 400)).toBe("UNKNOWN");
  });

  it("prioritizes capacity over exhausted in message scanning", () => {
    // "resource exhausted" should be capacity, not quota
    expect(parseRateLimitReason(undefined, "resource exhausted", undefined)).toBe("MODEL_CAPACITY_EXHAUSTED");
  });
});

// ---- calculateBackoffMs Tests ----

describe("calculateBackoffMs", () => {
  it("respects explicit retryAfterMs", () => {
    expect(calculateBackoffMs("UNKNOWN", 0, 5000)).toBe(5000);
  });

  it("applies minimum backoff for small retryAfterMs", () => {
    expect(calculateBackoffMs("UNKNOWN", 0, 100)).toBe(2000); // MIN_BACKOFF_MS
  });

  it("QUOTA_EXHAUSTED: tiered backoff by consecutive failures", () => {
    expect(calculateBackoffMs("QUOTA_EXHAUSTED", 0, null)).toBe(60000);    // 1 min
    expect(calculateBackoffMs("QUOTA_EXHAUSTED", 1, null)).toBe(300000);   // 5 min
    expect(calculateBackoffMs("QUOTA_EXHAUSTED", 2, null)).toBe(1800000);  // 30 min
    expect(calculateBackoffMs("QUOTA_EXHAUSTED", 3, null)).toBe(7200000);  // 2 hr
    expect(calculateBackoffMs("QUOTA_EXHAUSTED", 9, null)).toBe(7200000);  // capped at 2 hr
  });

  it("RATE_LIMIT_EXCEEDED: 30s backoff", () => {
    expect(calculateBackoffMs("RATE_LIMIT_EXCEEDED", 0, null)).toBe(30000);
    expect(calculateBackoffMs("RATE_LIMIT_EXCEEDED", 5, null)).toBe(30000);
  });

  it("SERVER_ERROR: 20s backoff", () => {
    expect(calculateBackoffMs("SERVER_ERROR", 0, null)).toBe(20000);
  });

  it("MODEL_CAPACITY_EXHAUSTED: 45s ± 15s jitter", () => {
    const result = calculateBackoffMs("MODEL_CAPACITY_EXHAUSTED", 0, null);
    // Should be 45s ± 15s = between 30s and 60s
    expect(result).toBeGreaterThanOrEqual(30000);
    expect(result).toBeLessThanOrEqual(60000);
  });

  it("UNKNOWN: 60s backoff", () => {
    expect(calculateBackoffMs("UNKNOWN", 0, null)).toBe(60000);
  });
});

// ---- AccountManager Tests ----

describe("AccountManager", () => {
  let manager: AccountManager;

  beforeEach(() => {
    // Reset singletons
    initTokenTracker({});
    initHealthTracker({});
  });

  describe("empty state", () => {
    it("creates with empty accounts", () => {
      const mgr = new AccountManager(makeStorage([]));
      expect(mgr.getAccountCount()).toBe(0);
      expect(mgr.getTotalAccountCount()).toBe(0);
    });

    it("creates with null storage", () => {
      const mgr = new AccountManager(null);
      expect(mgr.getAccountCount()).toBe(0);
    });
  });

  describe("with accounts", () => {
    beforeEach(() => {
      const storage = makeStorage([
        makeStoredAccount({ email: "user0@gmail.com", addedAt: 1000, refreshToken: "rt-0" }),
        makeStoredAccount({ email: "user1@gmail.com", addedAt: 2000, refreshToken: "rt-1" }),
      ]);
      manager = new AccountManager(storage);
    });

    it("loads accounts from storage", () => {
      expect(manager.getAccountCount()).toBe(2);
      expect(manager.getTotalAccountCount()).toBe(2);
    });

    it("returns current account for family", () => {
      const account = manager.getCurrentAccountForFamily("claude");
      expect(account).not.toBeNull();
      expect(account!.index).toBe(0);
    });

    it("returns null when no account for family", () => {
      const empty = new AccountManager(makeStorage([]));
      expect(empty.getCurrentAccountForFamily("claude")).toBeNull();
    });

    it("selects account with sticky strategy", () => {
      const account = manager.getCurrentOrNextForFamily("claude");
      expect(account).not.toBeNull();
      expect(account!.index).toBe(0);
    });

    it("returns same account on repeated calls (sticky)", () => {
      const first = manager.getCurrentOrNextForFamily("claude");
      const second = manager.getCurrentOrNextForFamily("claude");
      expect(first!.index).toBe(second!.index);
    });

    it("skips disabled accounts", () => {
      manager.setAccountEnabled(0, false);
      const account = manager.getCurrentOrNextForFamily("claude");
      expect(account!.index).toBe(1);
    });

    it("round-robin cycles through accounts", () => {
      const first = manager.getCurrentOrNextForFamily("gemini", null, "round-robin");
      const second = manager.getCurrentOrNextForFamily("gemini", null, "round-robin");
      expect(first!.index).not.toBe(second!.index);
    });

    it("returns null when all accounts rate limited", () => {
      const accounts = manager.getAccounts();
      for (const acc of accounts) {
        manager.markRateLimited(acc, 60000, "claude");
      }
      expect(manager.getCurrentOrNextForFamily("claude")).toBeNull();
    });
  });

  describe("rate limiting", () => {
    beforeEach(() => {
      const storage = makeStorage([
        makeStoredAccount({ email: "user0@gmail.com", refreshToken: "rt-0", addedAt: 1000 }),
        makeStoredAccount({ email: "user1@gmail.com", refreshToken: "rt-1", addedAt: 2000 }),
      ]);
      manager = new AccountManager(storage);
    });

    it("marks account rate limited", () => {
      const account = manager.getAccounts()[0]!;
      manager.markRateLimited(account, 60000, "claude");
      expect(account.rateLimitResetTimes["claude"]).toBeGreaterThan(Date.now());
    });

    it("switches to next account when current is rate limited", () => {
      const account0 = manager.getAccounts()[0]!;
      manager.markRateLimited(account0, 60000, "claude");

      const next = manager.getCurrentOrNextForFamily("claude");
      expect(next!.index).toBe(1);
    });

    it("markRateLimitedWithReason tracks consecutive failures", () => {
      const account = manager.getAccounts()[0]!;
      manager.markRateLimitedWithReason(account, "claude", "antigravity", "gemini-3-pro", "QUOTA_EXHAUSTED");
      expect(account.consecutiveFailures).toBe(1);

      manager.markRateLimitedWithReason(account, "claude", "antigravity", "gemini-3-pro", "QUOTA_EXHAUSTED");
      expect(account.consecutiveFailures).toBe(2);
    });

    it("markRequestSuccess resets consecutive failures", () => {
      const account = manager.getAccounts()[0]!;
      manager.markRateLimitedWithReason(account, "claude", "antigravity", "gemini-3-pro", "QUOTA_EXHAUSTED");
      manager.markRequestSuccess(account);
      expect(account.consecutiveFailures).toBe(0);
    });

    it("clears all rate limits for family", () => {
      const account = manager.getAccounts()[0]!;
      manager.markRateLimited(account, 60000, "claude");
      manager.clearAllRateLimitsForFamily("claude");
      expect(account.rateLimitResetTimes["claude"]).toBeUndefined();
    });

    it("expires rate limits after time passes", () => {
      const account0 = manager.getAccounts()[0]!;
      // Set a rate limit in the past
      account0.rateLimitResetTimes["claude"] = Date.now() - 10000;

      // Should be available since it expired
      const account = manager.getCurrentOrNextForFamily("claude");
      expect(account!.index).toBe(0);
    });

    it("getMinWaitTimeForFamily returns 0 when account available", () => {
      expect(manager.getMinWaitTimeForFamily("claude")).toBe(0);
    });

    it("getMinWaitTimeForFamily returns positive when all rate limited", () => {
      const accounts = manager.getAccounts();
      for (const acc of accounts) {
        manager.markRateLimited(acc, 60000, "claude");
      }
      expect(manager.getMinWaitTimeForFamily("claude")).toBeGreaterThan(0);
    });
  });

  describe("dual quota pools (Gemini)", () => {
    beforeEach(() => {
      const storage = makeStorage([
        makeStoredAccount({ email: "gemini-user@gmail.com", refreshToken: "rt-gem", addedAt: 1000 }),
      ]);
      manager = new AccountManager(storage);
    });

    it("returns antigravity style when available", () => {
      const account = manager.getAccounts()[0]!;
      const style = manager.getAvailableHeaderStyle(account, "gemini");
      expect(style).toBe("antigravity");
    });

    it("falls back to gemini-cli when antigravity rate limited", () => {
      const account = manager.getAccounts()[0]!;
      manager.markRateLimited(account, 60000, "gemini", "antigravity");
      const style = manager.getAvailableHeaderStyle(account, "gemini");
      expect(style).toBe("gemini-cli");
    });

    it("returns null when both pools rate limited", () => {
      const account = manager.getAccounts()[0]!;
      manager.markRateLimited(account, 60000, "gemini", "antigravity");
      manager.markRateLimited(account, 60000, "gemini", "gemini-cli");
      const style = manager.getAvailableHeaderStyle(account, "gemini");
      expect(style).toBeNull();
    });

    it("claude only has antigravity", () => {
      const account = manager.getAccounts()[0]!;
      manager.markRateLimited(account, 60000, "claude", "antigravity");
      const style = manager.getAvailableHeaderStyle(account, "claude");
      expect(style).toBeNull();
    });
  });

  describe("cooldown management", () => {
    beforeEach(() => {
      const storage = makeStorage([
        makeStoredAccount({ email: "cool@gmail.com", refreshToken: "rt-cool", addedAt: 1000 }),
      ]);
      manager = new AccountManager(storage);
    });

    it("marks account as cooling down", () => {
      const account = manager.getAccounts()[0]!;
      manager.markAccountCoolingDown(account, 30000, "auth-failure");
      expect(manager.isAccountCoolingDown(account)).toBe(true);
      expect(manager.getAccountCooldownReason(account)).toBe("auth-failure");
    });

    it("returns false when cooldown expired", () => {
      const account = manager.getAccounts()[0]!;
      // Set cooldown in the past
      account.coolingDownUntil = Date.now() - 10000;
      account.cooldownReason = "network-error";
      expect(manager.isAccountCoolingDown(account)).toBe(false);
      expect(manager.getAccountCooldownReason(account)).toBeUndefined();
    });

    it("clears cooldown explicitly", () => {
      const account = manager.getAccounts()[0]!;
      manager.markAccountCoolingDown(account, 60000, "validation-required");
      manager.clearAccountCooldown(account);
      expect(manager.isAccountCoolingDown(account)).toBe(false);
    });
  });

  describe("verification", () => {
    beforeEach(() => {
      const storage = makeStorage([
        makeStoredAccount({ email: "verify@gmail.com", refreshToken: "rt-verify", addedAt: 1000 }),
      ]);
      manager = new AccountManager(storage);
    });

    it("marks verification required and disables account", () => {
      manager.markAccountVerificationRequired(0, "Suspicious activity");
      const account = manager.getAccounts()[0]!;
      expect(account.verificationRequired).toBe(true);
      expect(account.enabled).toBe(false);
    });

    it("clears verification and re-enables account", () => {
      manager.markAccountVerificationRequired(0, "Check needed");
      manager.clearAccountVerificationRequired(0, true);
      const account = manager.getAccounts()[0]!;
      expect(account.verificationRequired).toBe(false);
      expect(account.enabled).toBe(true);
    });
  });

  describe("fingerprint management", () => {
    beforeEach(() => {
      const storage = makeStorage([
        makeStoredAccount({ email: "fprint@gmail.com", refreshToken: "rt-fprint", addedAt: 1000 }),
      ]);
      manager = new AccountManager(storage);
    });

    it("regenerates fingerprint and saves old to history", () => {
      const oldFp = manager.getAccounts()[0]!.fingerprint;
      const newFp = manager.regenerateAccountFingerprint(0);
      expect(newFp).not.toBeNull();
      expect(newFp!.deviceId).not.toBe(oldFp!.deviceId);

      const history = manager.getAccountFingerprintHistory(0);
      expect(history.length).toBe(1);
      expect(history[0]!.fingerprint.deviceId).toBe(oldFp!.deviceId);
    });

    it("restores fingerprint from history", () => {
      const oldFp = manager.getAccounts()[0]!.fingerprint;
      manager.regenerateAccountFingerprint(0);
      const restored = manager.restoreAccountFingerprint(0, 0);
      expect(restored).not.toBeNull();
      expect(restored!.deviceId).toBe(oldFp!.deviceId);
    });

    it("returns null for invalid history index", () => {
      expect(manager.restoreAccountFingerprint(0, 99)).toBeNull();
    });
  });
});
