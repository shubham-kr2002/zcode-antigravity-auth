/**
 * Tests for CLI setup: ZCode config generation for Antigravity provider.
 *
 * Uses temp directory + ZCODE_CONFIG_DIR to avoid fs mocking issues
 * with ESM frozen namespace imports (same pattern as discovery.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import {
  mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  setupAntigravityProvider,
  isProviderConfigured,
  getProviderConfig,
  removeAntigravityProvider,
} from "../src/cli/setup.js";
import { DEFAULT_PROXY_PORT } from "../src/constants.js";

// ---- Temp directory setup ----

let configDir: string;
let configFilePath: string;

beforeAll(() => {
  configDir = mkdtempSync(join(tmpdir(), "setup-test-"));
  process.env.ZCODE_CONFIG_DIR = configDir;
  configFilePath = join(configDir, "v2", "config.json");
});

afterAll(() => {
  delete process.env.ZCODE_CONFIG_DIR;
  rmSync(configDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.restoreAllMocks();
  // Remove any config file left from previous tests
  try {
    rmSync(configFilePath, { force: true });
  } catch { /* ignore */ }
  // Also remove the parent v2 dir if empty, so tests start clean
  try {
    rmSync(join(configDir, "v2"), { recursive: true, force: true });
  } catch { /* ignore */ }
});

// ---- Tests ----

describe("getProviderConfig", () => {
  it("returns null when no config file exists", () => {
    expect(getProviderConfig()).toBeNull();
  });

  it("returns null when config exists but has no provider key", () => {
    // Ensure parent dir exists
    mkdirSync(dirname(configFilePath), { recursive: true });
    writeFileSync(configFilePath, JSON.stringify({ version: "2.0" }), "utf8");
    expect(getProviderConfig()).toBeNull();
  });

  it("returns null when config exists but provider is empty", () => {
    mkdirSync(dirname(configFilePath), { recursive: true });
    writeFileSync(
      configFilePath,
      JSON.stringify({ provider: {} }),
      "utf8",
    );
    expect(getProviderConfig()).toBeNull();
  });

  it("returns null when config has provider but no antigravity entry", () => {
    mkdirSync(dirname(configFilePath), { recursive: true });
    writeFileSync(
      configFilePath,
      JSON.stringify({ provider: { someother: { name: "Other" } } }),
      "utf8",
    );
    expect(getProviderConfig()).toBeNull();
  });

  it("returns the antigravity provider config when present", () => {
    const expectedProvider = {
      name: "Antigravity (Google OAuth)",
      kind: "openai-compatible",
      options: {
        apiKey: "antigravity-oauth",
        baseURL: "http://127.0.0.1:51120/v1",
        apiKeyRequired: true,
      },
      enabled: true,
      source: "custom",
      models: {},
    };
    mkdirSync(dirname(configFilePath), { recursive: true });
    writeFileSync(
      configFilePath,
      JSON.stringify({ provider: { antigravity: expectedProvider } }),
      "utf8",
    );

    const result = getProviderConfig();
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Antigravity (Google OAuth)");
    expect(result!.kind).toBe("openai-compatible");
    expect(result!.options.apiKey).toBe("antigravity-oauth");
    expect(result!.options.baseURL).toBe("http://127.0.0.1:51120/v1");
    expect(result!.enabled).toBe(true);
    expect(result!.source).toBe("custom");
    expect(result!.models).toEqual({});
  });
});

describe("isProviderConfigured", () => {
  it("returns false when no config file exists", () => {
    expect(isProviderConfigured()).toBe(false);
  });

  it("returns false when config has no provider", () => {
    mkdirSync(dirname(configFilePath), { recursive: true });
    writeFileSync(configFilePath, JSON.stringify({ version: "2.0" }), "utf8");
    expect(isProviderConfigured()).toBe(false);
  });

  it("returns false when config has no antigravity provider", () => {
    mkdirSync(dirname(configFilePath), { recursive: true });
    writeFileSync(
      configFilePath,
      JSON.stringify({ provider: { other: { name: "Other" } } }),
      "utf8",
    );
    expect(isProviderConfigured()).toBe(false);
  });

  it("returns true when antigravity provider is configured", () => {
    mkdirSync(dirname(configFilePath), { recursive: true });
    writeFileSync(
      configFilePath,
      JSON.stringify({
        provider: { antigravity: { name: "Antigravity (Google OAuth)" } },
      }),
      "utf8",
    );
    expect(isProviderConfigured()).toBe(true);
  });
});

describe("removeAntigravityProvider", () => {
  it("returns false when no config file exists", () => {
    expect(removeAntigravityProvider()).toBe(false);
  });

  it("returns false when antigravity provider is not in config", () => {
    mkdirSync(dirname(configFilePath), { recursive: true });
    writeFileSync(
      configFilePath,
      JSON.stringify({ provider: { other: { name: "Other" } } }),
      "utf8",
    );
    expect(removeAntigravityProvider()).toBe(false);
  });

  it("removes the antigravity provider from config", () => {
    mkdirSync(dirname(configFilePath), { recursive: true });
    writeFileSync(
      configFilePath,
      JSON.stringify({
        provider: {
          antigravity: { name: "Antigravity (Google OAuth)" },
          other: { name: "Other" },
        },
      }),
      "utf8",
    );

    const result = removeAntigravityProvider();
    expect(result).toBe(true);

    // Verify on disk
    const raw = readFileSync(configFilePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.provider.antigravity).toBeUndefined();
    expect(parsed.provider.other).toBeDefined();
  });

  it("removes the entire provider key when it would be empty after removal", () => {
    mkdirSync(dirname(configFilePath), { recursive: true });
    writeFileSync(
      configFilePath,
      JSON.stringify({
        provider: { antigravity: { name: "Antigravity (Google OAuth)" } },
      }),
      "utf8",
    );

    const result = removeAntigravityProvider();
    expect(result).toBe(true);

    // Verify on disk — provider key should be gone
    const raw = readFileSync(configFilePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.provider).toBeUndefined();
  });
});

describe("setupAntigravityProvider", () => {
  it("creates the config file with correct structure", () => {
    const result = setupAntigravityProvider();

    // Check result shape
    expect(result.action).toBe("added");
    expect(result.configPath).toBe(configFilePath);
    expect(result.baseURL).toBe("http://127.0.0.1:51120/v1");
    expect(result.modelCount).toBeGreaterThan(0);
    expect(result.modelNames.length).toBeGreaterThan(0);
    expect(result.modelNames).toContain("claude-opus-4-6-thinking");
    expect(result.modelNames).toContain("claude-sonnet-4-6");

    // Verify config was written to disk
    expect(existsSync(configFilePath)).toBe(true);
    const raw = readFileSync(configFilePath, "utf8");
    const parsed = JSON.parse(raw);

    expect(parsed.provider).toBeDefined();
    expect(parsed.provider.antigravity).toBeDefined();
    expect(parsed.provider.antigravity.name).toBe("Antigravity (Google OAuth)");
    expect(parsed.provider.antigravity.kind).toBe("openai-compatible");
    expect(parsed.provider.antigravity.options.apiKey).toBe("antigravity-oauth");
    expect(parsed.provider.antigravity.options.baseURL).toBe("http://127.0.0.1:51120/v1");
    expect(parsed.provider.antigravity.options.apiKeyRequired).toBe(true);
    expect(parsed.provider.antigravity.enabled).toBe(true);
    expect(parsed.provider.antigravity.source).toBe("custom");
    expect(parsed.provider.antigravity.models).toBeDefined();

    // Verify each model has correct structure
    for (const modelId of result.modelNames) {
      const modelConfig = parsed.provider.antigravity.models[modelId];
      expect(modelConfig).toBeDefined();
      expect(modelConfig.limit).toBeDefined();
      expect(modelConfig.limit.context).toBeGreaterThan(0);
      expect(modelConfig.modalities).toBeDefined();
      expect(modelConfig.modalities.input).toBeInstanceOf(Array);
      expect(modelConfig.modalities.output).toBeInstanceOf(Array);
    }
  });

  it("returns 'added' action on first run", () => {
    const result = setupAntigravityProvider();
    expect(result.action).toBe("added");
  });

  it("returns 'unchanged' when run twice with same models", () => {
    setupAntigravityProvider();
    const result = setupAntigravityProvider();
    expect(result.action).toBe("unchanged");
  });

  it("returns 'updated' when existing config has a different baseURL", () => {
    // First, create a config with a different baseURL
    mkdirSync(dirname(configFilePath), { recursive: true });
    writeFileSync(
      configFilePath,
      JSON.stringify({
        provider: {
          antigravity: {
            name: "Antigravity (Google OAuth)",
            kind: "openai-compatible",
            options: {
              apiKey: "antigravity-oauth",
              baseURL: "http://127.0.0.1:99999/v1",
              apiKeyRequired: true,
            },
            enabled: true,
            source: "custom",
            models: {},
          },
        },
      }),
      "utf8",
    );

    const result = setupAntigravityProvider();
    expect(result.action).toBe("updated");
    expect(result.baseURL).toBe("http://127.0.0.1:51120/v1");

    // Verify the config was updated on disk
    const raw = readFileSync(configFilePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.provider.antigravity.options.baseURL).toBe("http://127.0.0.1:51120/v1");
  });

  it("uses ANTIGRAVITY_PROXY_PORT env var for baseURL", () => {
    const originalPort = process.env.ANTIGRAVITY_PROXY_PORT;
    process.env.ANTIGRAVITY_PROXY_PORT = "54321";

    try {
      const result = setupAntigravityProvider();
      expect(result.baseURL).toBe("http://127.0.0.1:54321/v1");

      // Verify config on disk
      const raw = readFileSync(configFilePath, "utf8");
      const parsed = JSON.parse(raw);
      expect(parsed.provider.antigravity.options.baseURL).toBe("http://127.0.0.1:54321/v1");
    } finally {
      if (originalPort !== undefined) {
        process.env.ANTIGRAVITY_PROXY_PORT = originalPort;
      } else {
        delete process.env.ANTIGRAVITY_PROXY_PORT;
      }
    }
  });

  it("includes model capabilities for each model (context, modalities, reasoning)", () => {
    const result = setupAntigravityProvider();
    const raw = readFileSync(configFilePath, "utf8");
    const parsed = JSON.parse(raw);
    const models = parsed.provider.antigravity.models;

    // claude-opus-4-6-thinking should have reasoning
    const thinkingModel = models["claude-opus-4-6-thinking"];
    expect(thinkingModel.reasoning).toBeDefined();
    expect(thinkingModel.reasoning.enabled).toBe(true);
    expect(thinkingModel.reasoning.variants).toEqual(["low", "medium", "high"]);
    expect(thinkingModel.reasoning.defaultVariant).toBe("high");

    // claude-sonnet-4-6 (non-thinking) should not have reasoning
    const nonThinkingModel = models["claude-sonnet-4-6"];
    expect(nonThinkingModel.reasoning).toBeUndefined();

    // gemini-2.5-flash should have multimodal input
    const geminiModel = models["gemini-2.5-flash"];
    expect(geminiModel.modalities.input).toContain("image");
    expect(geminiModel.modalities.input).toContain("pdf");
  });

  it("preserves user-added models in an update", () => {
    // First setup adds models from fallback list
    setupAntigravityProvider();

    // Manually add a user model to the config
    const raw = readFileSync(configFilePath, "utf8");
    const parsed = JSON.parse(raw);
    parsed.provider.antigravity.models["my-custom-model"] = {
      limit: { context: 1000 },
      modalities: { input: ["text"], output: ["text"] },
    };
    writeFileSync(configFilePath, JSON.stringify(parsed, null, 2) + "\n", "utf8");

    // Run setup again
    const result = setupAntigravityProvider();

    // The user-added model should be preserved
    const updatedRaw = readFileSync(configFilePath, "utf8");
    const updatedParsed = JSON.parse(updatedRaw);
    expect(updatedParsed.provider.antigravity.models["my-custom-model"]).toBeDefined();
    expect(result.modelNames).not.toContain("my-custom-model"); // only our models listed
  });
});
