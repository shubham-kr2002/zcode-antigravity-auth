/**
 * Rate limit handling, exponential backoff, and endpoint failover.
 * Ported from opencode-antigravity-auth plugin.ts retry/failover logic.
 */

import {
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  ANTIGRAVITY_ENDPOINT_PROD,
  type HeaderStyle,
} from "../constants.js";
import type { AntigravityConfig } from "../config.js";
import { parseRateLimitReason, calculateBackoffMs, type RateLimitReason } from "../accounts/manager.js";

// ---- Types ----

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

/** Progressive rate limit retry delays */
const FIRST_RETRY_DELAY_MS = 1000;

/** Max consecutive capacity retries per endpoint */
const MAX_CAPACITY_RETRIES_PER_ENDPOINT = 3;

/** Dedup window for concurrent 429s */
const RATE_LIMIT_DEDUP_WINDOW_MS = 5_000;

interface RateLimitDedupState {
  last429Time: number;
  consecutive429: number;
  currentAttempt: number;
}

// ---- Rate Limit State Tracking ----

const globalRateLimitState = new Map<string, RateLimitDedupState>();

function dedupKey(accountIndex: number, quotaKey: string): string {
  return `${accountIndex}:${quotaKey}`;
}

function cleanupDedupState(): void {
  const now = Date.now();
  for (const [key, state] of globalRateLimitState) {
    if (now - state.last429Time > RATE_LIMIT_DEDUP_WINDOW_MS * 2) {
      globalRateLimitState.delete(key);
    }
  }
}

/**
 * Get rate limit backoff with time-window deduplication.
 * Prevents concurrent 429s from causing incorrect exponential backoff.
 */
export function getDedupedBackoff(
  accountIndex: number,
  quotaKey: string,
  serverRetryAfterMs?: number | null,
  maxBackoffMs: number = 60_000,
  baseDelay: number = FIRST_RETRY_DELAY_MS,
): { attempt: number; delayMs: number; isDuplicate: boolean } {
  cleanupDedupState();

  const key = dedupKey(accountIndex, quotaKey);
  const now = Date.now();
  const previous = globalRateLimitState.get(key);

  // Check if this is a duplicate 429 within the dedup window
  if (previous && (now - previous.last429Time) < RATE_LIMIT_DEDUP_WINDOW_MS) {
    // Same rate limit event from concurrent request - don't increment
    const backoffDelay = Math.min(baseDelay * Math.pow(2, previous.consecutive429 - 1), maxBackoffMs);
    return {
      attempt: previous.consecutive429,
      delayMs: Math.max(baseDelay, backoffDelay),
      isDuplicate: true,
    };
  }

  // Reset if no 429 for 2 minutes, or increment
  const attempt = (previous && (now - previous.last429Time) < 120_000)
    ? previous.consecutive429 + 1
    : 1;

  globalRateLimitState.set(key, {
    last429Time: now,
    consecutive429: attempt,
    currentAttempt: attempt,
  });

  const backoffDelay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxBackoffMs);
  return { attempt, delayMs: Math.max(baseDelay, backoffDelay), isDuplicate: false };
}

/**
 * Reset rate limit state for an account+quota combination.
 */
export function resetRateLimitState(accountIndex: number, quotaKey: string): void {
  const key = dedupKey(accountIndex, quotaKey);
  globalRateLimitState.delete(key);
}

/**
 * Reset all rate limit state for an account.
 */
export function resetAccountRateLimitState(accountIndex: number): void {
  const prefix = `${accountIndex}:`;
  for (const key of globalRateLimitState.keys()) {
    if (key.startsWith(prefix)) {
      globalRateLimitState.delete(key);
    }
  }
}

// ---- Retry-After Parsing ----

function retryAfterMsFromResponse(response: Response, defaultRetryMs: number = 60_000): number {
  const retryAfterMsHeader = response.headers.get("retry-after-ms");
  if (retryAfterMsHeader) {
    const parsed = Number.parseInt(retryAfterMsHeader, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const retryAfterHeader = response.headers.get("retry-after");
  if (retryAfterHeader) {
    const parsed = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed * 1000; // Convert seconds to ms
    }
  }

  return defaultRetryMs;
}

// ---- Rate Limit Detection from Response ----

function parseDurationToMs(duration: string): number | null {
  // Parse duration strings like "60s", "5m", "1h"
  const match = duration.match(/^(\d+)(s|m|h)$/);
  if (!match) return null;

  const value = Number.parseInt(match[1]!, 10);
  const unit = match[2]!;

  switch (unit) {
    case "s": return value * 1000;
    case "m": return value * 60 * 1000;
    case "h": return value * 3600 * 1000;
    default: return null;
  }
}

export function detectRateLimit(response: Response, bodyText?: string): RateLimitDetection {
  const status = response.status;
  const message = bodyText ?? "";
  let reason = parseRateLimitReason(undefined, message, status);
  let retryAfterMs: number | null = retryAfterMsFromResponse(response);

  // Try to parse structured error from body
  try {
    const parsed = JSON.parse(message);
    const error = parsed.error;

    if (error) {
      // Google API error format
      reason = parseRateLimitReason(
        error.reason ?? error.status,
        error.message ?? message,
        error.code ?? status,
      );

      // Google quota error: retryDelay field
      if (error.details && Array.isArray(error.details)) {
        for (const detail of error.details) {
          if (detail["@type"]?.includes("QuotaFailure") && detail.violations) {
            for (const violation of detail.violations) {
              if (violation.retryDelay && retryAfterMs === null) {
                retryAfterMs = parseDurationToMs(violation.retryDelay as string);
              }
            }
          }
          if (detail.retryDelay && retryAfterMs === null) {
            retryAfterMs = parseDurationToMs(detail.retryDelay as string);
          }
        }
      }

      // RetryInfo
      if (error.details && Array.isArray(error.details)) {
        for (const detail of error.details) {
          if (detail["@type"]?.includes("RetryInfo") && detail.retryDelay) {
            retryAfterMs = parseDurationToMs(detail.retryDelay as string);
          }
        }
      }
    }
  } catch {
    // Not JSON - use text-based detection
  }

  const isRateLimited = status === 429 || status === 503 || status === 529 ||
    reason === "QUOTA_EXHAUSTED" || reason === "RATE_LIMIT_EXCEEDED" ||
    reason === "MODEL_CAPACITY_EXHAUSTED";

  return { isRateLimited, reason, retryAfterMs, message };
}

// ---- Endpoint Failover ----

export interface EndpointResult {
  endpoint: string;
  url: string;
  headerStyle: HeaderStyle;
}

/**
 * Build the URL for a specific endpoint and streaming mode.
 */
export function buildAntigravityUrl(
  endpoint: string,
  isStreaming: boolean,
): string {
  const action = isStreaming ? "streamGenerateContent" : "generateContent";
  return `${endpoint}/v1internal:${action}${isStreaming ? "?alt=sse" : ""}`;
}

/**
 * Get the next viable endpoint in the failover chain.
 * Sandbox endpoints are skipped for Gemini CLI header style.
 */
export function getFailoverEndpoint(
  currentIndex: number,
  headerStyle: HeaderStyle,
): EndpointResult | null {
  for (let i = currentIndex; i < ANTIGRAVITY_ENDPOINT_FALLBACKS.length; i++) {
    const endpoint = ANTIGRAVITY_ENDPOINT_FALLBACKS[i]!;

    // Skip sandbox endpoints for Gemini CLI models
    if (headerStyle === "gemini-cli" && endpoint !== ANTIGRAVITY_ENDPOINT_PROD) {
      continue;
    }

    return {
      endpoint,
      url: buildAntigravityUrl(endpoint, true), // streaming URL as default
      headerStyle,
    };
  }

  return null;
}

/**
 * Get all viable endpoint URLs for a given header style.
 */
export function getFailoverEndpoints(headerStyle: HeaderStyle): EndpointResult[] {
  const results: EndpointResult[] = [];
  for (const endpoint of ANTIGRAVITY_ENDPOINT_FALLBACKS) {
    if (headerStyle === "gemini-cli" && endpoint !== ANTIGRAVITY_ENDPOINT_PROD) {
      continue;
    }
    results.push({
      endpoint,
      url: buildAntigravityUrl(endpoint, true),
      headerStyle,
    });
  }
  return results;
}

// ---- Sleep Utility ----

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Capacity Backoff Tiers ----

const CAPACITY_BACKOFF_TIERS_MS = [5000, 10000, 20000, 30000, 60000];

export function getCapacityBackoffDelay(consecutiveFailures: number): number {
  const index = Math.min(consecutiveFailures, CAPACITY_BACKOFF_TIERS_MS.length - 1);
  return CAPACITY_BACKOFF_TIERS_MS[Math.max(0, index)] ?? 5000;
}
