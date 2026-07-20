/**
 * Tests for fingerprint generation (generateFingerprint,
 * buildFingerprintHeaders, getSessionFingerprint, etc.).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  generateFingerprint,
  collectCurrentFingerprint,
  buildFingerprintHeaders,
  getSessionFingerprint,
  Fingerprint,
} from "../src/accounts/fingerprint.js";

beforeEach(() => {
  vi.restoreAllMocks();
});

// ===================================================================
// generateFingerprint
// ===================================================================

describe("generateFingerprint", () => {
  it("returns an object with the expected shape", () => {
    const fp = generateFingerprint();

    expect(fp).toBeDefined();
    expect(typeof fp.deviceId).toBe("string");
    expect(fp.deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    ); // UUID v4
    expect(typeof fp.sessionToken).toBe("string");
    expect(fp.sessionToken).toMatch(/^[0-9a-f]{32}$/); // 16 bytes = 32 hex chars
    expect(typeof fp.userAgent).toBe("string");
    expect(fp.userAgent).toMatch(/^antigravity\/[\d.]+ (darwin|win32)\/(x64|arm64)$/);
    expect(typeof fp.apiClient).toBe("string");
    expect(fp.apiClient).toMatch(/^google-cloud-sdk /);
    expect(fp.clientMetadata).toBeDefined();
    expect(fp.clientMetadata.ideType).toBe("ANTIGRAVITY");
    expect(["WINDOWS", "MACOS"]).toContain(fp.clientMetadata.platform);
    expect(fp.clientMetadata.pluginType).toBe("GEMINI");
    expect(typeof fp.createdAt).toBe("number");
    expect(fp.createdAt).toBeGreaterThan(0);
  });

  it("generates unique fingerprints on successive calls", () => {
    const fp1 = generateFingerprint();
    const fp2 = generateFingerprint();
    expect(fp1.deviceId).not.toBe(fp2.deviceId);
    expect(fp1.sessionToken).not.toBe(fp2.sessionToken);
  });

  it("does not include quotaUser by default", () => {
    const fp = generateFingerprint();
    expect(fp.quotaUser).toBeUndefined();
  });
});

// ===================================================================
// collectCurrentFingerprint
// ===================================================================

describe("collectCurrentFingerprint", () => {
  it("returns an object with the expected shape using real OS info", () => {
    const fp = collectCurrentFingerprint();

    expect(fp).toBeDefined();
    expect(typeof fp.deviceId).toBe("string");
    expect(fp.deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(typeof fp.sessionToken).toBe("string");
    expect(fp.sessionToken).toMatch(/^[0-9a-f]{32}$/);
    expect(fp.userAgent).toMatch(/^antigravity\/[\d.]+ (linux|darwin|win32)\/(x64|arm64|arm)$/);
    expect(fp.clientMetadata.ideType).toBe("ANTIGRAVITY");
    expect(fp.clientMetadata.pluginType).toBe("GEMINI");
    expect(typeof fp.createdAt).toBe("number");
  });

  it("generates unique fingerprints on successive calls", () => {
    const fp1 = collectCurrentFingerprint();
    const fp2 = collectCurrentFingerprint();
    expect(fp1.deviceId).not.toBe(fp2.deviceId);
  });
});

// ===================================================================
// buildFingerprintHeaders
// ===================================================================

describe("buildFingerprintHeaders", () => {
  it("returns an empty object when fingerprint is null", () => {
    const headers = buildFingerprintHeaders(null);
    expect(headers).toEqual({});
  });

  it("returns headers with User-Agent when fingerprint is provided", () => {
    const fp = generateFingerprint();
    const headers = buildFingerprintHeaders(fp);

    expect(headers).toHaveProperty("User-Agent");
    expect(headers["User-Agent"]).toBe(fp.userAgent);
  });

  it("returns only User-Agent key in headers", () => {
    const fp = generateFingerprint();
    const headers = buildFingerprintHeaders(fp);

    // Should only have the one property
    expect(Object.keys(headers)).toEqual(["User-Agent"]);
  });

  it("returns User-Agent headers for multiple fingerprints", () => {
    const fp1 = generateFingerprint();
    const fp2 = generateFingerprint();

    const h1 = buildFingerprintHeaders(fp1);
    const h2 = buildFingerprintHeaders(fp2);

    // Both should have valid User-Agent strings
    expect(h1["User-Agent"]).toBeDefined();
    expect(h2["User-Agent"]).toBeDefined();
    expect(h1["User-Agent"]!.length).toBeGreaterThan(0);
    expect(h2["User-Agent"]!.length).toBeGreaterThan(0);
  });
});

// ===================================================================
// getSessionFingerprint
// ===================================================================

describe("getSessionFingerprint", () => {
  it("returns a fingerprint object", () => {
    const fp = getSessionFingerprint();
    expect(fp).toBeDefined();
    expect(fp.deviceId).toBeTruthy();
    expect(fp.sessionToken).toBeTruthy();
    expect(fp.createdAt).toBeGreaterThan(0);
  });

  it("returns the same value when called multiple times", () => {
    const fp1 = getSessionFingerprint();
    const fp2 = getSessionFingerprint();
    const fp3 = getSessionFingerprint();

    expect(fp1).toBe(fp2);
    expect(fp2).toBe(fp3);
    expect(fp1.deviceId).toBe(fp2.deviceId);
    expect(fp1.sessionToken).toBe(fp2.sessionToken);
  });

  it("returns a value consistent with generateFingerprint shape", () => {
    const fp = getSessionFingerprint();

    expect(fp).toMatchObject({
      deviceId: expect.any(String),
      sessionToken: expect.any(String),
      userAgent: expect.any(String),
      apiClient: expect.any(String),
      clientMetadata: {
        ideType: expect.any(String),
        platform: expect.any(String),
        pluginType: expect.any(String),
      },
      createdAt: expect.any(Number),
    });
    expect(fp.userAgent).toMatch(/^antigravity\//);
  });
});
