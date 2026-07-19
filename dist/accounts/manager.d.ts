/**
 * Multi-account manager with sticky, round-robin, and hybrid selection strategies.
 * Ported from opencode-antigravity-auth plugin/accounts.ts
 *
 * Uses the same account until it hits a rate limit (429), then switches.
 * Rate limits are tracked per-model-family (claude/gemini) so an account
 * rate-limited for Claude can still be used for Gemini.
 *
 * Source of truth for the pool is `~/.zcode/antigravity-accounts.json`.
 */
import { type StoredAccount, type AccountStorage, type ModelFamily, type CooldownReason, type RateLimitStateV3 } from "./storage.js";
import { type Fingerprint, type FingerprintVersion } from "./fingerprint.js";
import type { HeaderStyle } from "../constants.js";
export type { ModelFamily, CooldownReason } from "./storage.js";
export type { HeaderStyle } from "../constants.js";
export type AccountSelectionStrategy = "sticky" | "round-robin" | "hybrid";
export type RateLimitReason = "QUOTA_EXHAUSTED" | "RATE_LIMIT_EXCEEDED" | "MODEL_CAPACITY_EXHAUSTED" | "SERVER_ERROR" | "UNKNOWN";
export type QuotaKey = string;
export interface RefreshParts {
    refreshToken: string;
    projectId?: string;
    managedProjectId?: string;
}
export interface ManagedAccount {
    index: number;
    email?: string;
    addedAt: number;
    lastUsed: number;
    parts: RefreshParts;
    access?: string;
    expires?: number;
    enabled: boolean;
    rateLimitResetTimes: RateLimitStateV3;
    lastSwitchReason?: "rate-limit" | "initial" | "rotation";
    coolingDownUntil?: number;
    cooldownReason?: CooldownReason;
    touchedForQuota: Record<string, number>;
    consecutiveFailures?: number;
    /** Timestamp of last failure for TTL-based reset of consecutiveFailures */
    lastFailureTime?: number;
    /** Per-account device fingerprint for rate limit mitigation */
    fingerprint?: Fingerprint;
    /** History of previous fingerprints for this account */
    fingerprintHistory?: FingerprintVersion[];
    /** Cached quota data from last checkAccountsQuota() call */
    cachedQuota?: StoredAccount["cachedQuota"];
    cachedQuotaUpdatedAt?: number;
    verificationRequired?: boolean;
    verificationRequiredAt?: number;
    verificationRequiredReason?: string;
    verificationUrl?: string;
}
export declare function parseRateLimitReason(reason: string | undefined, message: string | undefined, status?: number): RateLimitReason;
export declare function calculateBackoffMs(reason: RateLimitReason, consecutiveFailures: number, retryAfterMs?: number | null): number;
export declare function computeSoftQuotaCacheTtlMs(ttlConfig: "auto" | number, refreshIntervalMinutes: number): number;
export declare class AccountManager {
    private accounts;
    private cursor;
    private currentAccountIndexByFamily;
    private sessionOffsetApplied;
    private savePending;
    private saveTimeout;
    private savePromiseResolvers;
    static loadFromDisk(): Promise<AccountManager>;
    constructor(stored?: AccountStorage | null);
    getAccountCount(): number;
    getTotalAccountCount(): number;
    getEnabledAccounts(): ManagedAccount[];
    getAccountsSnapshot(): ManagedAccount[];
    getCurrentAccountForFamily(family: ModelFamily): ManagedAccount | null;
    markSwitched(account: ManagedAccount, reason: "rate-limit" | "initial" | "rotation", family: ModelFamily): void;
    getCurrentOrNextForFamily(family: ModelFamily, model?: string | null, strategy?: AccountSelectionStrategy, headerStyle?: HeaderStyle, pidOffsetEnabled?: boolean, softQuotaThresholdPercent?: number, softQuotaCacheTtlMs?: number): ManagedAccount | null;
    getNextForFamily(family: ModelFamily, model?: string | null, headerStyle?: HeaderStyle, softQuotaThresholdPercent?: number, softQuotaCacheTtlMs?: number): ManagedAccount | null;
    markRateLimited(account: ManagedAccount, retryAfterMs: number, family: ModelFamily, headerStyle?: HeaderStyle, model?: string | null): void;
    markAccountUsed(accountIndex: number): void;
    markRateLimitedWithReason(account: ManagedAccount, family: ModelFamily, headerStyle: HeaderStyle, model: string | null | undefined, reason: RateLimitReason, retryAfterMs?: number | null, failureTtlMs?: number): number;
    markRequestSuccess(account: ManagedAccount): void;
    clearAllRateLimitsForFamily(family: ModelFamily, model?: string | null): void;
    shouldTryOptimisticReset(family: ModelFamily, model?: string | null): boolean;
    markAccountCoolingDown(account: ManagedAccount, cooldownMs: number, reason: CooldownReason): void;
    isAccountCoolingDown(account: ManagedAccount): boolean;
    clearAccountCooldown(account: ManagedAccount): void;
    getAccountCooldownReason(account: ManagedAccount): CooldownReason | undefined;
    markTouchedForQuota(account: ManagedAccount, quotaKey: string): void;
    isFreshForQuota(account: ManagedAccount, quotaKey: string): boolean;
    isRateLimitedForHeaderStyle(account: ManagedAccount, family: ModelFamily, headerStyle: HeaderStyle, model?: string | null): boolean;
    getAvailableHeaderStyle(account: ManagedAccount, family: ModelFamily, model?: string | null): HeaderStyle | null;
    hasOtherAccountWithAntigravityAvailable(currentAccountIndex: number, family: ModelFamily, model?: string | null): boolean;
    setAccountEnabled(accountIndex: number, enabled: boolean): boolean;
    markAccountVerificationRequired(accountIndex: number, reason?: string, verifyUrl?: string): boolean;
    clearAccountVerificationRequired(accountIndex: number, enableAccount?: boolean): boolean;
    removeAccountByIndex(accountIndex: number): boolean;
    removeAccount(account: ManagedAccount): boolean;
    updateFromRefresh(account: ManagedAccount, parts: RefreshParts, accessToken?: string, expiresAt?: number): void;
    getMinWaitTimeForFamily(family: ModelFamily, model?: string | null, headerStyle?: HeaderStyle, strict?: boolean): number;
    getAccounts(): ManagedAccount[];
    saveToDisk(): Promise<void>;
    requestSaveToDisk(): void;
    flushSaveToDisk(): Promise<void>;
    private executeSave;
    regenerateAccountFingerprint(accountIndex: number): Fingerprint | null;
    restoreAccountFingerprint(accountIndex: number, historyIndex: number): Fingerprint | null;
    getAccountFingerprintHistory(accountIndex: number): FingerprintVersion[];
    updateQuotaCache(accountIndex: number, quotaGroups: StoredAccount["cachedQuota"]): void;
    isAccountOverSoftQuota(account: ManagedAccount, family: ModelFamily, thresholdPercent: number, cacheTtlMs: number, model?: string | null): boolean;
    areAllAccountsOverSoftQuota(family: ModelFamily, thresholdPercent: number, cacheTtlMs: number, model?: string | null): boolean;
    getMinWaitTimeForSoftQuota(family: ModelFamily, thresholdPercent: number, cacheTtlMs: number, model?: string | null): number | null;
    getOldestQuotaCacheAge(): number | null;
}
//# sourceMappingURL=manager.d.ts.map