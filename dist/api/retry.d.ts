/**
 * Rate limit handling, exponential backoff, and endpoint failover.
 * Ported from opencode-antigravity-auth plugin.ts retry/failover logic.
 */
import { type HeaderStyle } from "../constants.js";
import { type RateLimitReason } from "../accounts/manager.js";
export interface RetryContext {
    family: "claude" | "gemini";
    model?: string;
    headerStyle: HeaderStyle;
    endpointIndex: number;
    capacityRetries: number;
    consecutiveCapacityFailures: number;
    startTime: number;
}
export interface RetryResult {
    url: string;
    init: RequestInit;
    context: RetryContext;
}
export interface RateLimitDetection {
    isRateLimited: boolean;
    reason: RateLimitReason;
    retryAfterMs: number | null;
    message: string;
}
/**
 * Get rate limit backoff with time-window deduplication.
 * Prevents concurrent 429s from causing incorrect exponential backoff.
 */
export declare function getDedupedBackoff(accountIndex: number, quotaKey: string, serverRetryAfterMs?: number | null, maxBackoffMs?: number, baseDelay?: number): {
    attempt: number;
    delayMs: number;
    isDuplicate: boolean;
};
/**
 * Reset rate limit state for an account+quota combination.
 */
export declare function resetRateLimitState(accountIndex: number, quotaKey: string): void;
/**
 * Reset all rate limit state for an account.
 */
export declare function resetAccountRateLimitState(accountIndex: number): void;
export declare function detectRateLimit(response: Response, bodyText?: string): RateLimitDetection;
export interface EndpointResult {
    endpoint: string;
    url: string;
    headerStyle: HeaderStyle;
}
/**
 * Build the URL for a specific endpoint and streaming mode.
 */
export declare function buildAntigravityUrl(endpoint: string, isStreaming: boolean): string;
/**
 * Get the next viable endpoint in the failover chain.
 * Sandbox endpoints are skipped for Gemini CLI header style.
 */
export declare function getFailoverEndpoint(currentIndex: number, headerStyle: HeaderStyle): EndpointResult | null;
/**
 * Get all viable endpoint URLs for a given header style.
 */
export declare function getFailoverEndpoints(headerStyle: HeaderStyle): EndpointResult[];
export declare function sleep(ms: number): Promise<void>;
export declare function getCapacityBackoffDelay(consecutiveFailures: number): number;
//# sourceMappingURL=retry.d.ts.map