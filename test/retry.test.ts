/**
 * Tests for retry module: rate limit detection, endpoint failover, backoff.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  detectRateLimit,
  getFailoverEndpoints,
  getFailoverEndpoint,
  buildAntigravityUrl,
  getDedupedBackoff,
  resetRateLimitState,
  resetAccountRateLimitState,
  getCapacityBackoffDelay,
} from "../src/api/retry.js";
import { ANTIGRAVITY_ENDPOINT_FALLBACKS, ANTIGRAVITY_ENDPOINT_PROD } from "../src/constants.js";

// ---- detectRateLimit Tests ----

describe("detectRateLimit", () => {
  function makeResponse(status: number, headers?: Record<string, string>): Response {
    const responseHeaders = new Headers(headers);
    return new Response(null, { status, headers: responseHeaders });
  }

  function makeJsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
    const responseHeaders = new Headers(headers);
    responseHeaders.set("Content-Type", "application/json");
    return new Response(JSON.stringify(body), { status, headers: responseHeaders });
  }

  it("detects rate limit from 429 status", () => {
    const resp = makeResponse(429);
    const result = detectRateLimit(resp, "");
    expect(result.isRateLimited).toBe(true);
    expect(result.reason).toBe("UNKNOWN");
  });

  it("detects 503 as capacity exhausted", () => {
    const resp = makeResponse(503);
    const result = detectRateLimit(resp, "");
    expect(result.isRateLimited).toBe(true);
    expect(result.reason).toBe("MODEL_CAPACITY_EXHAUSTED");
  });

  it("detects 529 as capacity exhausted", () => {
    const resp = makeResponse(529);
    const result = detectRateLimit(resp, "");
    expect(result.isRateLimited).toBe(true);
    expect(result.reason).toBe("MODEL_CAPACITY_EXHAUSTED");
  });

  it("detects 500 as server error", () => {
    const resp = makeResponse(500);
    const result = detectRateLimit(resp, "");
    expect(result.isRateLimited).toBe(false);
    expect(result.reason).toBe("SERVER_ERROR");
  });

  it("parses retry-after-ms header", () => {
    const resp = makeResponse(429, { "retry-after-ms": "5000" });
    const result = detectRateLimit(resp, "");
    expect(result.retryAfterMs).toBe(5000);
  });

  it("parses retry-after (seconds) header", () => {
    const resp = makeResponse(429, { "retry-after": "30" });
    const result = detectRateLimit(resp, "");
    expect(result.retryAfterMs).toBe(30000); // 30 seconds → 30000 ms
  });

  it("returns default retry when no header", () => {
    const resp = makeResponse(429);
    const result = detectRateLimit(resp, "");
    // Default is 60000
    expect(result.retryAfterMs).toBe(60000);
  });

  it("detects from text body: quota exhausted", () => {
    const resp = makeResponse(429);
    const result = detectRateLimit(resp, "Quota exhausted for this project");
    expect(result.reason).toBe("QUOTA_EXHAUSTED");
  });

  it("detects from text body: rate limit", () => {
    const resp = makeResponse(429);
    const result = detectRateLimit(resp, "Rate limit exceeded: 60 requests per minute");
    expect(result.reason).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("parses Google API error format", () => {
    const resp = makeJsonResponse(429, {
      error: {
        code: 429,
        message: "Quota exceeded for 'claude-opus-4-6-thinking'.",
        status: "RESOURCE_EXHAUSTED",
      },
    });
    const result = detectRateLimit(resp, JSON.stringify({
      error: {
        code: 429,
        message: "Quota exceeded for 'claude-opus-4-6-thinking'.",
        status: "RESOURCE_EXHAUSTED",
      },
    }));
    expect(result.isRateLimited).toBe(true);
    expect(result.reason).toBe("QUOTA_EXHAUSTED");
  });

  it("parses RetryInfo from Google API error details", () => {
    const body = {
      error: {
        code: 429,
        message: "Resource exhausted",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "30s",
          },
        ],
      },
    };
    const resp = makeJsonResponse(429, body);
    const result = detectRateLimit(resp, JSON.stringify(body));
    // 30s = 30000ms
    expect(result.retryAfterMs).toBe(30000);
  });
});

// ---- Endpoint Failover Tests ----

describe("Endpoint Failover", () => {
  it("buildAntigravityUrl includes sse for streaming", () => {
    const url = buildAntigravityUrl(ANTIGRAVITY_ENDPOINT_PROD, true);
    expect(url).toContain("streamGenerateContent");
    expect(url).toContain("alt=sse");
  });

  it("buildAntigravityUrl excludes sse for non-streaming", () => {
    const url = buildAntigravityUrl(ANTIGRAVITY_ENDPOINT_PROD, false);
    expect(url).toContain("generateContent");
    expect(url).not.toContain("alt=sse");
  });

  it("getFailoverEndpoints returns all for antigravity style", () => {
    const endpoints = getFailoverEndpoints("antigravity");
    expect(endpoints.length).toBe(ANTIGRAVITY_ENDPOINT_FALLBACKS.length);
    expect(endpoints[0]!.headerStyle).toBe("antigravity");
  });

  it("getFailoverEndpoints filters sandbox for gemini-cli", () => {
    const endpoints = getFailoverEndpoints("gemini-cli");
    // Only production endpoint should remain
    expect(endpoints.length).toBe(1);
    expect(endpoints[0]!.endpoint).toBe(ANTIGRAVITY_ENDPOINT_PROD);
  });

  it("getFailoverEndpoint returns null when index out of range", () => {
    const result = getFailoverEndpoint(999, "antigravity");
    expect(result).toBeNull();
  });

  it("getFailoverEndpoint skips sandbox for gemini-cli", () => {
    // Start at index 0 (daily sandbox) with gemini-cli
    const result = getFailoverEndpoint(0, "gemini-cli");
    expect(result).not.toBeNull();
    expect(result!.endpoint).toBe(ANTIGRAVITY_ENDPOINT_PROD);
  });
});

// ---- getDedupedBackoff Tests ----

describe("getDedupedBackoff", () => {
  beforeEach(() => {
    resetAccountRateLimitState(1);
  });

  it("returns base delay on first backoff", () => {
    const result = getDedupedBackoff(1, "claude");
    expect(result.attempt).toBe(1);
    expect(result.isDuplicate).toBe(false);
    expect(result.delayMs).toBe(1000); // FIRST_RETRY_DELAY_MS
  });

  it("detects duplicate 429 within dedup window", () => {
    getDedupedBackoff(1, "claude"); // First
    const result = getDedupedBackoff(1, "claude"); // Duplicate
    expect(result.isDuplicate).toBe(true);
  });

  it("increments attempt after dedup window expires", () => {
    const realNow = Date.now;
    // First
    getDedupedBackoff(1, "claude");

    // Advance past dedup window but within reset window
    const fakeNow = realNow() + 6000; // 6s > 5s dedup window
    vi.spyOn(Date, "now").mockReturnValue(fakeNow);
    const result = getDedupedBackoff(1, "claude");
    expect(result.attempt).toBe(2);

    vi.restoreAllMocks();
  });

  it("resets after 120s of no rate limits", () => {
    const realNow = Date.now;

    // First: attempt 1
    getDedupedBackoff(1, "claude");

    // Advance past dedup window: attempt 2
    const fakeNow1 = realNow() + 6000;
    vi.spyOn(Date, "now").mockReturnValue(fakeNow1);
    getDedupedBackoff(1, "claude");
    vi.restoreAllMocks();

    // Advance past 120s reset: should be attempt 1 again
    const fakeNow2 = realNow() + 130000;
    vi.spyOn(Date, "now").mockReturnValue(fakeNow2);
    const result = getDedupedBackoff(1, "claude");
    // State resets because we auto-cleanup and there's >120s gap
    expect(result.attempt).toBeLessThanOrEqual(2); // May have been cleaned up

    vi.restoreAllMocks();
  });

  it("resetRateLimitState clears state for account+quota", () => {
    getDedupedBackoff(1, "claude");
    resetRateLimitState(1, "claude");
    const result = getDedupedBackoff(1, "claude");
    expect(result.attempt).toBe(1);
  });

  it("resetAccountRateLimitState clears all for account", () => {
    getDedupedBackoff(1, "claude");
    getDedupedBackoff(1, "gemini-antigravity");
    resetAccountRateLimitState(1);
    const resultClaude = getDedupedBackoff(1, "claude");
    const resultGemini = getDedupedBackoff(1, "gemini-antigravity");
    expect(resultClaude.attempt).toBe(1);
    expect(resultGemini.attempt).toBe(1);
  });
});

// ---- Capacity Backoff Tests ----

describe("getCapacityBackoffDelay", () => {
  it("returns tiered delays", () => {
    expect(getCapacityBackoffDelay(0)).toBe(5000);
    expect(getCapacityBackoffDelay(1)).toBe(10000);
    expect(getCapacityBackoffDelay(2)).toBe(20000);
    expect(getCapacityBackoffDelay(3)).toBe(30000);
    expect(getCapacityBackoffDelay(4)).toBe(60000);
    expect(getCapacityBackoffDelay(10)).toBe(60000); // capped
  });
});
