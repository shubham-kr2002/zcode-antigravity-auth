/**
 * Quota checking via Antigravity API endpoints.
 * Ported from opencode-antigravity-auth plugin/quota.ts
 *
 * Fetches quota info for accounts using two endpoints:
 * - v1internal:fetchAvailableModels (Antigravity quota)
 * - v1internal:retrieveUserQuota (Gemini CLI quota)
 */
import type { QuotaGroup } from "./model-resolver.js";
import type { RefreshParts } from "../accounts/manager.js";
export type { QuotaGroup } from "./model-resolver.js";
export interface QuotaGroupSummary {
    remainingFraction?: number;
    resetTime?: string;
    modelCount: number;
}
export interface QuotaSummary {
    groups: Partial<Record<QuotaGroup, QuotaGroupSummary>>;
    modelCount: number;
    error?: string;
}
export interface GeminiCliQuotaModel {
    modelId: string;
    remainingFraction: number;
    resetTime?: string;
}
export interface GeminiCliQuotaSummary {
    models: GeminiCliQuotaModel[];
    error?: string;
}
export type AccountQuotaStatus = "ok" | "disabled" | "error";
export interface AccountQuotaResult {
    index: number;
    email?: string;
    status: AccountQuotaStatus;
    error?: string;
    disabled?: boolean;
    quota?: QuotaSummary;
    geminiCliQuota?: GeminiCliQuotaSummary;
    updatedParts?: RefreshParts;
}
export interface QuotaCheckAccount {
    index: number;
    email?: string;
    refreshToken: string;
    projectId?: string;
    enabled: boolean;
}
/**
 * Check quota for multiple accounts.
 * Fetches both Antigravity and Gemini CLI quotas in parallel for each account.
 *
 * @param accounts - List of accounts with refresh tokens
 * @param getAccessToken - Function to get/refresh access token for each account
 */
export declare function checkAccountsQuota(accounts: QuotaCheckAccount[], getAccessToken: (refreshToken: string) => Promise<{
    accessToken: string;
    projectId: string;
}>): Promise<AccountQuotaResult[]>;
//# sourceMappingURL=quota.d.ts.map