/**
 * Tests for runtime configuration loading.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  getZCodeDir,
  getConfig,
  initRuntimeConfig,
  getManualAccessToken,
  getManualProjectId,
} from "../src/config.js";

describe("config", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("getZCodeDir", () => {
    it("returns ZCODE_CONFIG_DIR when env var is set", () => {
      process.env.ZCODE_CONFIG_DIR = "/custom/zcode/path";
      expect(getZCodeDir()).toBe("/custom/zcode/path");
      delete process.env.ZCODE_CONFIG_DIR;
    });

    it("returns default path when ZCODE_CONFIG_DIR is not set", () => {
      delete process.env.ZCODE_CONFIG_DIR;
      expect(getZCodeDir()).toBe(join(homedir(), ".zcode"));
    });
  });

  describe("initRuntimeConfig / getConfig", () => {
    it("round-trips partial config through initRuntimeConfig and getConfig", () => {
      initRuntimeConfig({
        proxy_port: 12345,
        quiet_mode: true,
        debug: true,
        account_selection_strategy: "round-robin",
      });

      const cfg = getConfig();
      expect(cfg.proxy_port).toBe(12345);
      expect(cfg.quiet_mode).toBe(true);
      expect(cfg.debug).toBe(true);
      expect(cfg.account_selection_strategy).toBe("round-robin");
    });

    it("fills defaults for omitted fields", () => {
      initRuntimeConfig({});
      const cfg = getConfig();
      expect(cfg.proxy_port).toBe(51120);
      expect(cfg.oauth_port).toBe(51121);
      expect(cfg.quiet_mode).toBe(false);
      expect(cfg.debug).toBe(false);
      expect(cfg.account_selection_strategy).toBe("sticky");
    });

    it("rejects invalid config values", () => {
      expect(() =>
        initRuntimeConfig({ proxy_port: 1 } as any),
      ).toThrow();
    });
  });

  describe("getManualAccessToken", () => {
    it("returns the token when ANTIGRAVITY_ACCESS_TOKEN is set", () => {
      process.env.ANTIGRAVITY_ACCESS_TOKEN = "test-token-123";
      expect(getManualAccessToken()).toBe("test-token-123");
      delete process.env.ANTIGRAVITY_ACCESS_TOKEN;
    });

    it("returns null when ANTIGRAVITY_ACCESS_TOKEN is not set", () => {
      delete process.env.ANTIGRAVITY_ACCESS_TOKEN;
      expect(getManualAccessToken()).toBeNull();
    });
  });

  describe("getManualProjectId", () => {
    it("returns the project ID when ANTIGRAVITY_PROJECT_ID is set", () => {
      process.env.ANTIGRAVITY_PROJECT_ID = "my-project-456";
      expect(getManualProjectId()).toBe("my-project-456");
      delete process.env.ANTIGRAVITY_PROJECT_ID;
    });

    it("returns null when ANTIGRAVITY_PROJECT_ID is not set", () => {
      delete process.env.ANTIGRAVITY_PROJECT_ID;
      expect(getManualProjectId()).toBeNull();
    });
  });
});
