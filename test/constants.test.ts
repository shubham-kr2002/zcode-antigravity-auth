/**
 * Tests for constants, header randomization, and version accessors.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ANTIGRAVITY_ENDPOINT_PROD,
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
  ANTIGRAVITY_ENDPOINT,
  GEMINI_CLI_ENDPOINT,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  getRandomizedHeaders,
  getAntigravityHeaders,
  getAntigravityVersion,
  setAntigravityVersion,
  ANTIGRAVITY_VERSION_FALLBACK,
} from "../src/constants.js";

describe("constants", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("endpoint constants", () => {
    it("ANTIGRAVITY_ENDPOINT_PROD is defined and a valid URL", () => {
      expect(ANTIGRAVITY_ENDPOINT_PROD).toBeDefined();
      expect(ANTIGRAVITY_ENDPOINT_PROD).toMatch(/^https?:\/\//);
    });

    it("ANTIGRAVITY_ENDPOINT_DAILY is defined and a valid URL", () => {
      expect(ANTIGRAVITY_ENDPOINT_DAILY).toBeDefined();
      expect(ANTIGRAVITY_ENDPOINT_DAILY).toMatch(/^https?:\/\//);
    });

    it("ANTIGRAVITY_ENDPOINT_AUTOPUSH is defined and a valid URL", () => {
      expect(ANTIGRAVITY_ENDPOINT_AUTOPUSH).toBeDefined();
      expect(ANTIGRAVITY_ENDPOINT_AUTOPUSH).toMatch(/^https?:\/\//);
    });

    it("ANTIGRAVITY_ENDPOINT defaults to daily sandbox", () => {
      expect(ANTIGRAVITY_ENDPOINT).toBe(ANTIGRAVITY_ENDPOINT_DAILY);
    });

    it("GEMINI_CLI_ENDPOINT is production endpoint", () => {
      expect(GEMINI_CLI_ENDPOINT).toBe(ANTIGRAVITY_ENDPOINT_PROD);
    });

    it("ANTIGRAVITY_ENDPOINT_FALLBACKS contains all three endpoints in order", () => {
      expect(ANTIGRAVITY_ENDPOINT_FALLBACKS).toEqual([
        ANTIGRAVITY_ENDPOINT_DAILY,
        ANTIGRAVITY_ENDPOINT_AUTOPUSH,
        ANTIGRAVITY_ENDPOINT_PROD,
      ]);
    });
  });

  describe("getAntigravityHeaders", () => {
    it("returns headers with expected keys", () => {
      const headers = getAntigravityHeaders();
      expect(headers).toHaveProperty("User-Agent");
      expect(headers).toHaveProperty("X-Goog-Api-Client");
      expect(headers).toHaveProperty("Client-Metadata");
    });

    it("includes the current Antigravity version in User-Agent", () => {
      const headers = getAntigravityHeaders();
      expect(headers["User-Agent"]).toContain(getAntigravityVersion());
    });
  });

  describe("getRandomizedHeaders", () => {
    it("returns headers with expected shape for antigravity style", () => {
      const headers = getRandomizedHeaders("antigravity");
      expect(headers).toHaveProperty("User-Agent");
      expect(headers).toHaveProperty("X-Goog-Api-Client");
      expect(headers).toHaveProperty("Client-Metadata");
    });

    it("returns deterministic headers for gemini-cli style", () => {
      const a = getRandomizedHeaders("gemini-cli");
      const b = getRandomizedHeaders("gemini-cli");
      expect(a).toEqual(b);
    });

    it("randomizes User-Agent across multiple calls with antigravity style", () => {
      // Call many times; with 3 platform choices it is extremely likely
      // at least two calls produce different User-Agents
      const userAgents = new Set<string>();
      for (let i = 0; i < 10; i++) {
        userAgents.add(getRandomizedHeaders("antigravity")["User-Agent"]);
      }
      expect(userAgents.size).toBeGreaterThan(1);
    });

    it("antigravity style User-Agent has expected platform suffix", () => {
      const headers = getRandomizedHeaders("antigravity");
      const ua = headers["User-Agent"];
      expect(ua).toMatch(
        /antigravity\/\S+ (windows\/amd64|darwin\/arm64|darwin\/amd64)$/,
      );
    });

    it("antigravity style X-Goog-Api-Client starts with google-cloud-sdk", () => {
      const headers = getRandomizedHeaders("antigravity");
      const client = headers["X-Goog-Api-Client"];
      expect(client).toMatch(/^google-cloud-sdk\s/);
    });
  });

  describe("getAntigravityVersion / setAntigravityVersion", () => {
    it("getAntigravityVersion returns a string", () => {
      const version = getAntigravityVersion();
      expect(typeof version).toBe("string");
      expect(version.length).toBeGreaterThan(0);
    });

    it("getAntigravityVersion returns the fallback initially", () => {
      expect(getAntigravityVersion()).toBe(ANTIGRAVITY_VERSION_FALLBACK);
    });

    it("setAntigravityVersion / getAntigravityVersion round-trips and locks after first call", () => {
      // Because versionLocked is module-level state, all three assertions
      // are combined in one test: fallback, set, lock.
      expect(getAntigravityVersion()).toBe(ANTIGRAVITY_VERSION_FALLBACK);

      setAntigravityVersion("9.9.9");
      expect(getAntigravityVersion()).toBe("9.9.9");

      // Second set is ignored because versionLocked is true
      setAntigravityVersion("8.8.8");
      expect(getAntigravityVersion()).toBe("9.9.9");
    });
  });
});
