/**
 * Account storage — reads/writes ~/.zcode/antigravity-accounts.json.
 * Ported from opencode-antigravity-auth plugin/storage.ts
 */
export type CooldownReason = "auth-failure" | "network-error" | "project-error" | "validation-required";
export type ModelFamily = "claude" | "gemini";
export type RateLimitStateV3 = Record<string, number | undefined>;
export interface StoredAccount {
    email?: string;
    refreshToken: string;
    accessToken?: string;
    expiresAt?: number;
    projectId?: string;
    managedProjectId?: string;
    addedAt: number;
    lastUsed: number;
    enabled: boolean;
    lastSwitchReason?: "rate-limit" | "initial" | "rotation";
    rateLimitResetTimes?: RateLimitStateV3;
    coolingDownUntil?: number;
    cooldownReason?: CooldownReason;
    fingerprint?: {
        quotaUser?: string;
        deviceId: string;
        sessionToken?: string;
        userAgent?: string;
        apiClient?: string;
        clientMetadata?: {
            ideType: string;
            platform: string;
            pluginType: string;
        };
        createdAt: number;
        version?: string;
    };
    fingerprintHistory?: Array<{
        fingerprint: StoredAccount["fingerprint"];
        timestamp: number;
        reason: "initial" | "regenerated" | "restored";
    }>;
    /** Cached soft quota data from checkAccountsQuota() */
    cachedQuota?: Record<string, {
        remainingFraction?: number;
        resetTime?: string;
        modelCount: number;
    }>;
    cachedQuotaUpdatedAt?: number;
    /** Set when Google requires account verification */
    verificationRequired?: boolean;
    verificationRequiredAt?: number;
    verificationRequiredReason?: string;
    verificationUrl?: string;
}
export interface AccountStorage {
    version: number;
    accounts: StoredAccount[];
    activeIndex: number;
    activeIndexByFamily?: {
        claude: number;
        gemini: number;
    };
}
export declare function loadAccounts(): Promise<AccountStorage | null>;
export declare function saveAccounts(data: AccountStorage): Promise<void>;
export declare function clearAccounts(): Promise<void>;
export declare function getActiveAccount(): Promise<StoredAccount | null>;
export declare function addAccount(account: StoredAccount): Promise<void>;
//# sourceMappingURL=storage.d.ts.map