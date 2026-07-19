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
import { loadAccounts, saveAccounts } from "./storage.js";
import { getHealthTracker, getTokenTracker, selectHybridAccount, } from "./rotation.js";
import { generateFingerprint, updateFingerprintVersion, MAX_FINGERPRINT_HISTORY, } from "./fingerprint.js";
import { resolveQuotaGroup } from "../api/model-resolver.js";
// ---- Backoff Constants ----
const QUOTA_EXHAUSTED_BACKOFFS = [60_000, 300_000, 1_800_000, 7_200_000];
const RATE_LIMIT_EXCEEDED_BACKOFF = 30_000;
const MODEL_CAPACITY_EXHAUSTED_BASE_BACKOFF = 45_000;
const MODEL_CAPACITY_EXHAUSTED_JITTER_MAX = 30_000; // ±15s jitter range
const SERVER_ERROR_BACKOFF = 20_000;
const UNKNOWN_BACKOFF = 60_000;
const MIN_BACKOFF_MS = 2_000;
// ---- Utilities ----
function nowMs() {
    return Date.now();
}
function clampNonNegativeInt(value, fallback) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return value < 0 ? 0 : Math.floor(value);
}
function generateJitter(maxJitterMs) {
    return Math.random() * maxJitterMs - (maxJitterMs / 2);
}
function getQuotaKey(family, headerStyle, model) {
    if (family === "claude") {
        return "claude";
    }
    const base = headerStyle === "gemini-cli" ? "gemini-cli" : "gemini-antigravity";
    if (model) {
        return `${base}:${model}`;
    }
    return base;
}
// ---- Rate Limit Reason Parsing ----
export function parseRateLimitReason(reason, message, status) {
    // 1. Status Code Checks
    if (status === 529 || status === 503)
        return "MODEL_CAPACITY_EXHAUSTED";
    if (status === 500)
        return "SERVER_ERROR";
    // 2. Explicit Reason String
    if (reason) {
        switch (reason.toUpperCase()) {
            case "QUOTA_EXHAUSTED": return "QUOTA_EXHAUSTED";
            case "RATE_LIMIT_EXCEEDED": return "RATE_LIMIT_EXCEEDED";
            case "MODEL_CAPACITY_EXHAUSTED": return "MODEL_CAPACITY_EXHAUSTED";
        }
    }
    // 3. Message Text Scanning
    if (message) {
        const lower = message.toLowerCase();
        if (lower.includes("capacity") || lower.includes("overloaded") || lower.includes("resource exhausted")) {
            return "MODEL_CAPACITY_EXHAUSTED";
        }
        if (lower.includes("per minute") || lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("presque")) {
            return "RATE_LIMIT_EXCEEDED";
        }
        if (lower.includes("exhausted") || lower.includes("quota")) {
            return "QUOTA_EXHAUSTED";
        }
    }
    // Default fallback for 429
    if (status === 429) {
        return "UNKNOWN";
    }
    return "UNKNOWN";
}
export function calculateBackoffMs(reason, consecutiveFailures, retryAfterMs) {
    if (retryAfterMs && retryAfterMs > 0) {
        return Math.max(retryAfterMs, MIN_BACKOFF_MS);
    }
    switch (reason) {
        case "QUOTA_EXHAUSTED": {
            const index = Math.min(consecutiveFailures, QUOTA_EXHAUSTED_BACKOFFS.length - 1);
            return QUOTA_EXHAUSTED_BACKOFFS[index] ?? UNKNOWN_BACKOFF;
        }
        case "RATE_LIMIT_EXCEEDED":
            return RATE_LIMIT_EXCEEDED_BACKOFF;
        case "MODEL_CAPACITY_EXHAUSTED":
            return MODEL_CAPACITY_EXHAUSTED_BASE_BACKOFF + generateJitter(MODEL_CAPACITY_EXHAUSTED_JITTER_MAX);
        case "SERVER_ERROR":
            return SERVER_ERROR_BACKOFF;
        case "UNKNOWN":
        default:
            return UNKNOWN_BACKOFF;
    }
}
export function computeSoftQuotaCacheTtlMs(ttlConfig, refreshIntervalMinutes) {
    if (ttlConfig === "auto") {
        return Math.max(2 * refreshIntervalMinutes, 10) * 60 * 1000;
    }
    return ttlConfig * 60 * 1000;
}
// ---- Rate Limit Check Helpers ----
function isRateLimitedForQuotaKey(account, key) {
    const resetTime = account.rateLimitResetTimes[key];
    return resetTime !== undefined && nowMs() < resetTime;
}
function clearExpiredRateLimits(account) {
    const now = nowMs();
    const keys = Object.keys(account.rateLimitResetTimes);
    for (const key of keys) {
        const resetTime = account.rateLimitResetTimes[key];
        if (resetTime !== undefined && now >= resetTime) {
            delete account.rateLimitResetTimes[key];
        }
    }
}
function isRateLimitedForHeaderStyleInternal(account, family, headerStyle, model) {
    clearExpiredRateLimits(account);
    if (family === "claude") {
        return isRateLimitedForQuotaKey(account, "claude");
    }
    if (model) {
        const modelKey = getQuotaKey(family, headerStyle, model);
        if (isRateLimitedForQuotaKey(account, modelKey)) {
            return true;
        }
    }
    const baseKey = getQuotaKey(family, headerStyle);
    return isRateLimitedForQuotaKey(account, baseKey);
}
function isRateLimitedForFamily(account, family, model) {
    if (family === "claude") {
        return isRateLimitedForQuotaKey(account, "claude");
    }
    const antigravityLimited = isRateLimitedForHeaderStyleInternal(account, family, "antigravity", model);
    const cliLimited = isRateLimitedForHeaderStyleInternal(account, family, "gemini-cli", model);
    return antigravityLimited && cliLimited;
}
function isOverSoftQuotaThreshold(account, family, thresholdPercent, cacheTtlMs, model) {
    if (thresholdPercent >= 100)
        return false;
    if (!account.cachedQuota)
        return false;
    if (account.cachedQuotaUpdatedAt == null)
        return false;
    const age = nowMs() - account.cachedQuotaUpdatedAt;
    if (age > cacheTtlMs)
        return false;
    const quotaGroup = resolveQuotaGroup(family, model);
    const groupData = account.cachedQuota[quotaGroup];
    if (groupData?.remainingFraction == null)
        return false;
    const remainingFraction = Math.max(0, Math.min(1, groupData.remainingFraction));
    const usedPercent = (1 - remainingFraction) * 100;
    return usedPercent >= thresholdPercent;
}
// ---- AccountManager Class ----
export class AccountManager {
    accounts = [];
    cursor = 0;
    currentAccountIndexByFamily = {
        claude: -1,
        gemini: -1,
    };
    sessionOffsetApplied = {
        claude: false,
        gemini: false,
    };
    savePending = false;
    saveTimeout = null;
    savePromiseResolvers = [];
    static async loadFromDisk() {
        const stored = await loadAccounts();
        return new AccountManager(stored);
    }
    constructor(stored) {
        if (stored && stored.accounts.length === 0) {
            this.accounts = [];
            this.cursor = 0;
            return;
        }
        if (stored && stored.accounts.length > 0) {
            const baseNow = nowMs();
            this.accounts = stored.accounts
                .map((acc, index) => {
                if (!acc.refreshToken || typeof acc.refreshToken !== "string") {
                    return null;
                }
                return {
                    index,
                    email: acc.email,
                    addedAt: clampNonNegativeInt(acc.addedAt, baseNow),
                    lastUsed: clampNonNegativeInt(acc.lastUsed, 0),
                    parts: {
                        refreshToken: acc.refreshToken,
                        projectId: acc.projectId,
                        managedProjectId: acc.managedProjectId,
                    },
                    access: acc.accessToken,
                    expires: acc.expiresAt,
                    enabled: acc.enabled !== false,
                    rateLimitResetTimes: acc.rateLimitResetTimes ?? {},
                    lastSwitchReason: acc.lastSwitchReason,
                    coolingDownUntil: acc.coolingDownUntil,
                    cooldownReason: acc.cooldownReason,
                    touchedForQuota: {},
                    fingerprint: acc.fingerprint ?? generateFingerprint(),
                    fingerprintHistory: acc.fingerprintHistory?.map(h => ({
                        fingerprint: h.fingerprint,
                        timestamp: h.timestamp,
                        reason: h.reason,
                    })) ?? [],
                    cachedQuota: acc.cachedQuota,
                    cachedQuotaUpdatedAt: acc.cachedQuotaUpdatedAt,
                    verificationRequired: acc.verificationRequired,
                    verificationRequiredAt: acc.verificationRequiredAt,
                    verificationRequiredReason: acc.verificationRequiredReason,
                    verificationUrl: acc.verificationUrl,
                };
            })
                .filter((a) => a !== null);
            // Update fingerprint versions to match current runtime version
            let fingerprintVersionChanged = false;
            for (const acc of this.accounts) {
                if (acc.fingerprint && updateFingerprintVersion(acc.fingerprint)) {
                    fingerprintVersionChanged = true;
                }
            }
            this.cursor = clampNonNegativeInt(stored.activeIndex, 0);
            if (this.accounts.length > 0) {
                this.cursor = this.cursor % this.accounts.length;
                const defaultIndex = this.cursor;
                this.currentAccountIndexByFamily.claude = clampNonNegativeInt(stored.activeIndexByFamily?.claude, defaultIndex) % this.accounts.length;
                this.currentAccountIndexByFamily.gemini = clampNonNegativeInt(stored.activeIndexByFamily?.gemini, defaultIndex) % this.accounts.length;
            }
            if (fingerprintVersionChanged) {
                this.requestSaveToDisk();
            }
        }
    }
    // ---- Account Access ----
    getAccountCount() {
        return this.getEnabledAccounts().length;
    }
    getTotalAccountCount() {
        return this.accounts.length;
    }
    getEnabledAccounts() {
        return this.accounts.filter((account) => account.enabled !== false);
    }
    getAccountsSnapshot() {
        return this.accounts.map((a) => ({ ...a, parts: { ...a.parts }, rateLimitResetTimes: { ...a.rateLimitResetTimes } }));
    }
    getCurrentAccountForFamily(family) {
        const currentIndex = this.currentAccountIndexByFamily[family];
        if (currentIndex >= 0 && currentIndex < this.accounts.length) {
            const account = this.accounts[currentIndex] ?? null;
            if (account && account.enabled !== false) {
                return account;
            }
        }
        return null;
    }
    markSwitched(account, reason, family) {
        account.lastSwitchReason = reason;
        this.currentAccountIndexByFamily[family] = account.index;
    }
    // ---- Account Selection ----
    getCurrentOrNextForFamily(family, model, strategy = "sticky", headerStyle = "antigravity", pidOffsetEnabled = false, softQuotaThresholdPercent = 100, softQuotaCacheTtlMs = 10 * 60 * 1000) {
        const quotaKey = getQuotaKey(family, headerStyle, model);
        if (strategy === "round-robin") {
            const next = this.getNextForFamily(family, model, headerStyle, softQuotaThresholdPercent, softQuotaCacheTtlMs);
            if (next) {
                this.markTouchedForQuota(next, quotaKey);
                this.currentAccountIndexByFamily[family] = next.index;
            }
            return next;
        }
        if (strategy === "hybrid") {
            const healthTracker = getHealthTracker();
            const tokenTracker = getTokenTracker();
            const accountsWithMetrics = this.accounts
                .filter(acc => acc.enabled !== false)
                .map(acc => {
                clearExpiredRateLimits(acc);
                return {
                    index: acc.index,
                    lastUsed: acc.lastUsed,
                    healthScore: healthTracker.getScore(acc.index),
                    isRateLimited: isRateLimitedForFamily(acc, family, model) ||
                        isOverSoftQuotaThreshold(acc, family, softQuotaThresholdPercent, softQuotaCacheTtlMs, model),
                    isCoolingDown: this.isAccountCoolingDown(acc),
                };
            });
            const currentIndex = this.currentAccountIndexByFamily[family] ?? null;
            const selectedIndex = selectHybridAccount(accountsWithMetrics, tokenTracker, currentIndex);
            if (selectedIndex !== null) {
                const selected = this.accounts[selectedIndex];
                if (selected) {
                    selected.lastUsed = nowMs();
                    this.markTouchedForQuota(selected, quotaKey);
                    this.currentAccountIndexByFamily[family] = selected.index;
                    return selected;
                }
            }
        }
        // Fallback: sticky selection
        if (pidOffsetEnabled && !this.sessionOffsetApplied[family] && this.accounts.length > 1) {
            const pidOffset = process.pid % this.accounts.length;
            const baseIndex = this.currentAccountIndexByFamily[family] ?? 0;
            const newIndex = (baseIndex + pidOffset) % this.accounts.length;
            this.currentAccountIndexByFamily[family] = newIndex;
            this.sessionOffsetApplied[family] = true;
        }
        const current = this.getCurrentAccountForFamily(family);
        if (current) {
            clearExpiredRateLimits(current);
            const isLimitedForRequestedStyle = isRateLimitedForHeaderStyleInternal(current, family, headerStyle, model);
            const isOverThreshold = isOverSoftQuotaThreshold(current, family, softQuotaThresholdPercent, softQuotaCacheTtlMs, model);
            if (!isLimitedForRequestedStyle && !isOverThreshold && !this.isAccountCoolingDown(current)) {
                this.markTouchedForQuota(current, quotaKey);
                return current;
            }
        }
        const next = this.getNextForFamily(family, model, headerStyle, softQuotaThresholdPercent, softQuotaCacheTtlMs);
        if (next) {
            this.markTouchedForQuota(next, quotaKey);
            this.currentAccountIndexByFamily[family] = next.index;
        }
        return next;
    }
    getNextForFamily(family, model, headerStyle = "antigravity", softQuotaThresholdPercent = 100, softQuotaCacheTtlMs = 10 * 60 * 1000) {
        const available = this.accounts.filter((a) => {
            clearExpiredRateLimits(a);
            return a.enabled !== false &&
                !isRateLimitedForHeaderStyleInternal(a, family, headerStyle, model) &&
                !isOverSoftQuotaThreshold(a, family, softQuotaThresholdPercent, softQuotaCacheTtlMs, model) &&
                !this.isAccountCoolingDown(a);
        });
        if (available.length === 0) {
            return null;
        }
        const account = available[this.cursor % available.length];
        if (!account) {
            return null;
        }
        this.cursor++;
        return account;
    }
    // ---- Rate Limit Management ----
    markRateLimited(account, retryAfterMs, family, headerStyle = "antigravity", model) {
        const key = getQuotaKey(family, headerStyle, model);
        account.rateLimitResetTimes[key] = nowMs() + retryAfterMs;
    }
    markAccountUsed(accountIndex) {
        const account = this.accounts.find(a => a.index === accountIndex);
        if (account) {
            account.lastUsed = nowMs();
        }
    }
    markRateLimitedWithReason(account, family, headerStyle, model, reason, retryAfterMs, failureTtlMs = 3600_000) {
        const now = nowMs();
        // TTL-based reset: if last failure was more than failureTtlMs ago, reset count
        if (account.lastFailureTime !== undefined && (now - account.lastFailureTime) > failureTtlMs) {
            account.consecutiveFailures = 0;
        }
        const failures = (account.consecutiveFailures ?? 0) + 1;
        account.consecutiveFailures = failures;
        account.lastFailureTime = now;
        const backoffMs = calculateBackoffMs(reason, failures - 1, retryAfterMs);
        const key = getQuotaKey(family, headerStyle, model);
        account.rateLimitResetTimes[key] = now + backoffMs;
        return backoffMs;
    }
    markRequestSuccess(account) {
        if (account.consecutiveFailures) {
            account.consecutiveFailures = 0;
        }
    }
    clearAllRateLimitsForFamily(family, model) {
        for (const account of this.accounts) {
            if (family === "claude") {
                delete account.rateLimitResetTimes.claude;
            }
            else {
                const antigravityKey = getQuotaKey(family, "antigravity", model);
                const cliKey = getQuotaKey(family, "gemini-cli", model);
                delete account.rateLimitResetTimes[antigravityKey];
                delete account.rateLimitResetTimes[cliKey];
            }
            account.consecutiveFailures = 0;
        }
    }
    shouldTryOptimisticReset(family, model) {
        const minWaitMs = this.getMinWaitTimeForFamily(family, model);
        return minWaitMs > 0 && minWaitMs <= 2000;
    }
    // ---- Cooldown Management ----
    markAccountCoolingDown(account, cooldownMs, reason) {
        account.coolingDownUntil = nowMs() + cooldownMs;
        account.cooldownReason = reason;
    }
    isAccountCoolingDown(account) {
        if (account.coolingDownUntil === undefined) {
            return false;
        }
        if (nowMs() >= account.coolingDownUntil) {
            this.clearAccountCooldown(account);
            return false;
        }
        return true;
    }
    clearAccountCooldown(account) {
        delete account.coolingDownUntil;
        delete account.cooldownReason;
    }
    getAccountCooldownReason(account) {
        return this.isAccountCoolingDown(account) ? account.cooldownReason : undefined;
    }
    // ---- Quota Tracking ----
    markTouchedForQuota(account, quotaKey) {
        account.touchedForQuota[quotaKey] = nowMs();
    }
    isFreshForQuota(account, quotaKey) {
        const touchedAt = account.touchedForQuota[quotaKey];
        if (!touchedAt)
            return true;
        const resetTime = account.rateLimitResetTimes[quotaKey];
        if (resetTime && touchedAt < resetTime)
            return true;
        return false;
    }
    // ---- Header Style Selection ----
    isRateLimitedForHeaderStyle(account, family, headerStyle, model) {
        return isRateLimitedForHeaderStyleInternal(account, family, headerStyle, model);
    }
    getAvailableHeaderStyle(account, family, model) {
        clearExpiredRateLimits(account);
        if (family === "claude") {
            return isRateLimitedForHeaderStyleInternal(account, family, "antigravity") ? null : "antigravity";
        }
        if (!isRateLimitedForHeaderStyleInternal(account, family, "antigravity", model)) {
            return "antigravity";
        }
        if (!isRateLimitedForHeaderStyleInternal(account, family, "gemini-cli", model)) {
            return "gemini-cli";
        }
        return null;
    }
    hasOtherAccountWithAntigravityAvailable(currentAccountIndex, family, model) {
        if (family === "claude") {
            return false;
        }
        return this.accounts.some(acc => {
            if (acc.index === currentAccountIndex)
                return false;
            if (acc.enabled === false)
                return false;
            if (this.isAccountCoolingDown(acc))
                return false;
            clearExpiredRateLimits(acc);
            return !isRateLimitedForHeaderStyleInternal(acc, family, "antigravity", model);
        });
    }
    // ---- Account Management ----
    setAccountEnabled(accountIndex, enabled) {
        const account = this.accounts[accountIndex];
        if (!account)
            return false;
        account.enabled = enabled;
        if (!enabled) {
            for (const family of Object.keys(this.currentAccountIndexByFamily)) {
                if (this.currentAccountIndexByFamily[family] === accountIndex) {
                    const next = this.accounts.find((a, i) => i !== accountIndex && a.enabled !== false);
                    this.currentAccountIndexByFamily[family] = next?.index ?? -1;
                }
            }
        }
        this.requestSaveToDisk();
        return true;
    }
    markAccountVerificationRequired(accountIndex, reason, verifyUrl) {
        const account = this.accounts[accountIndex];
        if (!account)
            return false;
        account.verificationRequired = true;
        account.verificationRequiredAt = nowMs();
        account.verificationRequiredReason = reason?.trim() || undefined;
        const normalizedUrl = verifyUrl?.trim();
        if (normalizedUrl) {
            account.verificationUrl = normalizedUrl;
        }
        if (account.enabled !== false) {
            this.setAccountEnabled(accountIndex, false);
        }
        else {
            this.requestSaveToDisk();
        }
        return true;
    }
    clearAccountVerificationRequired(accountIndex, enableAccount = false) {
        const account = this.accounts[accountIndex];
        if (!account)
            return false;
        const wasVerificationRequired = account.verificationRequired === true;
        account.verificationRequired = false;
        account.verificationRequiredAt = undefined;
        account.verificationRequiredReason = undefined;
        account.verificationUrl = undefined;
        if (enableAccount && wasVerificationRequired && account.enabled === false) {
            this.setAccountEnabled(accountIndex, true);
        }
        else if (wasVerificationRequired) {
            this.requestSaveToDisk();
        }
        return true;
    }
    removeAccountByIndex(accountIndex) {
        if (accountIndex < 0 || accountIndex >= this.accounts.length)
            return false;
        const account = this.accounts[accountIndex];
        if (!account)
            return false;
        return this.removeAccount(account);
    }
    removeAccount(account) {
        const idx = this.accounts.indexOf(account);
        if (idx < 0)
            return false;
        this.accounts.splice(idx, 1);
        this.accounts.forEach((acc, index) => {
            acc.index = index;
        });
        if (this.accounts.length === 0) {
            this.cursor = 0;
            this.currentAccountIndexByFamily.claude = -1;
            this.currentAccountIndexByFamily.gemini = -1;
            return true;
        }
        if (this.cursor > idx)
            this.cursor -= 1;
        this.cursor = this.cursor % this.accounts.length;
        for (const family of ["claude", "gemini"]) {
            if (this.currentAccountIndexByFamily[family] > idx) {
                this.currentAccountIndexByFamily[family] -= 1;
            }
            if (this.currentAccountIndexByFamily[family] >= this.accounts.length) {
                this.currentAccountIndexByFamily[family] = -1;
            }
        }
        return true;
    }
    updateFromRefresh(account, parts, accessToken, expiresAt) {
        account.parts = {
            ...parts,
            projectId: parts.projectId ?? account.parts.projectId,
            managedProjectId: parts.managedProjectId ?? account.parts.managedProjectId,
        };
        account.access = accessToken ?? account.access;
        account.expires = expiresAt ?? account.expires;
    }
    // ---- Wait Time Calculation ----
    getMinWaitTimeForFamily(family, model, headerStyle, strict) {
        const available = this.accounts.filter((a) => {
            clearExpiredRateLimits(a);
            return a.enabled !== false && (strict && headerStyle
                ? !isRateLimitedForHeaderStyleInternal(a, family, headerStyle, model)
                : !isRateLimitedForFamily(a, family, model));
        });
        if (available.length > 0)
            return 0;
        const waitTimes = [];
        for (const a of this.accounts) {
            if (family === "claude") {
                const t = a.rateLimitResetTimes.claude;
                if (t !== undefined)
                    waitTimes.push(Math.max(0, t - nowMs()));
            }
            else if (strict && headerStyle) {
                const key = getQuotaKey(family, headerStyle, model);
                const t = a.rateLimitResetTimes[key];
                if (t !== undefined)
                    waitTimes.push(Math.max(0, t - nowMs()));
            }
            else {
                const antigravityKey = getQuotaKey(family, "antigravity", model);
                const cliKey = getQuotaKey(family, "gemini-cli", model);
                const t1 = a.rateLimitResetTimes[antigravityKey];
                const t2 = a.rateLimitResetTimes[cliKey];
                const accountWait = Math.min(t1 !== undefined ? Math.max(0, t1 - nowMs()) : Infinity, t2 !== undefined ? Math.max(0, t2 - nowMs()) : Infinity);
                if (accountWait !== Infinity)
                    waitTimes.push(accountWait);
            }
        }
        return waitTimes.length > 0 ? Math.min(...waitTimes) : 0;
    }
    getAccounts() {
        return [...this.accounts];
    }
    // ---- Persistence ----
    async saveToDisk() {
        const claudeIndex = Math.max(0, this.currentAccountIndexByFamily.claude);
        const geminiIndex = Math.max(0, this.currentAccountIndexByFamily.gemini);
        const storage = {
            version: 4,
            accounts: this.accounts.map((a) => ({
                email: a.email,
                refreshToken: a.parts.refreshToken,
                projectId: a.parts.projectId,
                managedProjectId: a.parts.managedProjectId,
                accessToken: a.access,
                expiresAt: a.expires,
                addedAt: a.addedAt,
                lastUsed: a.lastUsed,
                enabled: a.enabled,
                lastSwitchReason: a.lastSwitchReason,
                rateLimitResetTimes: Object.keys(a.rateLimitResetTimes).length > 0 ? a.rateLimitResetTimes : undefined,
                coolingDownUntil: a.coolingDownUntil,
                cooldownReason: a.cooldownReason,
                fingerprint: a.fingerprint ? {
                    deviceId: a.fingerprint.deviceId,
                    sessionToken: a.fingerprint.sessionToken,
                    userAgent: a.fingerprint.userAgent,
                    apiClient: a.fingerprint.apiClient,
                    clientMetadata: a.fingerprint.clientMetadata,
                    createdAt: a.fingerprint.createdAt,
                } : undefined,
                fingerprintHistory: a.fingerprintHistory?.length ? a.fingerprintHistory : undefined,
                cachedQuota: a.cachedQuota && Object.keys(a.cachedQuota).length > 0 ? a.cachedQuota : undefined,
                cachedQuotaUpdatedAt: a.cachedQuotaUpdatedAt,
                verificationRequired: a.verificationRequired,
                verificationRequiredAt: a.verificationRequiredAt,
                verificationRequiredReason: a.verificationRequiredReason,
                verificationUrl: a.verificationUrl,
            })),
            activeIndex: claudeIndex,
            activeIndexByFamily: {
                claude: claudeIndex,
                gemini: geminiIndex,
            },
        };
        await saveAccounts(storage);
    }
    requestSaveToDisk() {
        if (this.savePending)
            return;
        this.savePending = true;
        this.saveTimeout = setTimeout(() => {
            void this.executeSave();
        }, 1000);
    }
    async flushSaveToDisk() {
        if (!this.savePending)
            return;
        return new Promise((resolve) => {
            this.savePromiseResolvers.push(resolve);
        });
    }
    async executeSave() {
        this.savePending = false;
        this.saveTimeout = null;
        try {
            await this.saveToDisk();
        }
        catch {
            // best-effort persistence
        }
        finally {
            const resolvers = this.savePromiseResolvers;
            this.savePromiseResolvers = [];
            for (const resolve of resolvers) {
                resolve();
            }
        }
    }
    // ========== Fingerprint Management ==========
    regenerateAccountFingerprint(accountIndex) {
        const account = this.accounts[accountIndex];
        if (!account)
            return null;
        if (account.fingerprint) {
            const historyEntry = {
                fingerprint: account.fingerprint,
                timestamp: nowMs(),
                reason: "regenerated",
            };
            if (!account.fingerprintHistory) {
                account.fingerprintHistory = [];
            }
            account.fingerprintHistory.unshift(historyEntry);
            if (account.fingerprintHistory.length > MAX_FINGERPRINT_HISTORY) {
                account.fingerprintHistory = account.fingerprintHistory.slice(0, MAX_FINGERPRINT_HISTORY);
            }
        }
        account.fingerprint = generateFingerprint();
        this.requestSaveToDisk();
        return account.fingerprint;
    }
    restoreAccountFingerprint(accountIndex, historyIndex) {
        const account = this.accounts[accountIndex];
        if (!account)
            return null;
        const history = account.fingerprintHistory;
        if (!history || historyIndex < 0 || historyIndex >= history.length) {
            return null;
        }
        const fingerprintToRestore = history[historyIndex].fingerprint;
        if (account.fingerprint) {
            const historyEntry = {
                fingerprint: account.fingerprint,
                timestamp: nowMs(),
                reason: "restored",
            };
            account.fingerprintHistory.unshift(historyEntry);
            if (account.fingerprintHistory.length > MAX_FINGERPRINT_HISTORY) {
                account.fingerprintHistory = account.fingerprintHistory.slice(0, MAX_FINGERPRINT_HISTORY);
            }
        }
        account.fingerprint = { ...fingerprintToRestore, createdAt: nowMs() };
        this.requestSaveToDisk();
        return account.fingerprint;
    }
    getAccountFingerprintHistory(accountIndex) {
        const account = this.accounts[accountIndex];
        if (!account || !account.fingerprintHistory) {
            return [];
        }
        return [...account.fingerprintHistory];
    }
    // ---- Quota Cache ----
    updateQuotaCache(accountIndex, quotaGroups) {
        const account = this.accounts[accountIndex];
        if (account) {
            account.cachedQuota = quotaGroups;
            account.cachedQuotaUpdatedAt = nowMs();
        }
    }
    isAccountOverSoftQuota(account, family, thresholdPercent, cacheTtlMs, model) {
        return isOverSoftQuotaThreshold(account, family, thresholdPercent, cacheTtlMs, model);
    }
    areAllAccountsOverSoftQuota(family, thresholdPercent, cacheTtlMs, model) {
        if (thresholdPercent >= 100)
            return false;
        const enabled = this.accounts.filter(a => a.enabled !== false);
        if (enabled.length === 0)
            return false;
        return enabled.every(a => isOverSoftQuotaThreshold(a, family, thresholdPercent, cacheTtlMs, model));
    }
    getMinWaitTimeForSoftQuota(family, thresholdPercent, cacheTtlMs, model) {
        if (thresholdPercent >= 100)
            return 0;
        const enabled = this.accounts.filter(a => a.enabled !== false);
        if (enabled.length === 0)
            return null;
        const available = enabled.filter(a => !isOverSoftQuotaThreshold(a, family, thresholdPercent, cacheTtlMs, model));
        if (available.length > 0)
            return 0;
        if (!model && family !== "claude")
            return null;
        const quotaGroup = resolveQuotaGroup(family, model);
        const now = nowMs();
        const waitTimes = [];
        for (const acc of enabled) {
            const groupData = acc.cachedQuota?.[quotaGroup];
            if (groupData?.resetTime) {
                const resetTimestamp = Date.parse(groupData.resetTime);
                if (Number.isFinite(resetTimestamp)) {
                    waitTimes.push(Math.max(0, resetTimestamp - now));
                }
            }
        }
        if (waitTimes.length === 0)
            return null;
        const minWait = Math.min(...waitTimes);
        return minWait === 0 ? null : minWait;
    }
    getOldestQuotaCacheAge() {
        let oldest = null;
        for (const acc of this.accounts) {
            if (acc.enabled === false)
                continue;
            if (acc.cachedQuotaUpdatedAt == null)
                return null;
            const age = nowMs() - acc.cachedQuotaUpdatedAt;
            if (oldest === null || age > oldest)
                oldest = age;
        }
        return oldest;
    }
}
//# sourceMappingURL=manager.js.map