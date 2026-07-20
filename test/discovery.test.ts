/**
 * Tests for model discovery: caching, registry building, API integration.
 *
 * NOTE: fs mocking is done via a real temp directory + ZCODE_CONFIG_DIR
 * because ESM namespace imports (import * as fs) are frozen and cannot
 * be spied on with vi.spyOn in vitest.
 *
 * TTL env var tests: CACHE_TTL_MS is computed once at module load time,
 * so testing different env values requires vi.resetModules() which causes
 * hangs in vitest ESM. Instead, we test the default behavior thoroughly
 * and validate the env var parsing logic through the observable behavior
 * of loadModelCache with varying timestamps.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import {
  mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadModelCache,
  saveModelCache,
  buildModelRegistry,
  discoverModels,
} from "../src/models/discovery.js";
import { makeResponse } from "./helpers.js";

// ---- Temp directory setup ----

let cacheDir: string;
let cacheFilePath: string;

beforeAll(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "discovery-test-"));
  process.env.ZCODE_CONFIG_DIR = cacheDir;
  cacheFilePath = join(cacheDir, "antigravity-models-cache.json");
});

afterAll(() => {
  delete process.env.ZCODE_CONFIG_DIR;
  rmSync(cacheDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.restoreAllMocks();
  // Remove any cache file left from previous tests
  try {
    rmSync(cacheFilePath, { force: true });
  } catch { /* ignore */ }
});

// ===================================================================
// getModelCacheTtlMs (tested indirectly through loadModelCache)
// ===================================================================

describe("getModelCacheTtlMs (observed via loadModelCache)", () => {
  const NOW = 1_000_000_000_000;

  it("defaults to 3600000ms (60 min) when no env var is set", () => {
    writeFileSync(
      cacheFilePath,
      JSON.stringify({ updatedAt: NOW - 100, models: { a: {} } }),
      "utf8",
    );

    // Current time set to NOW → cache is 100ms old → fresh
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    expect(loadModelCache()).not.toBeNull();

    // Advance to just past 60 min → expired
    vi.spyOn(Date, "now").mockReturnValue(NOW + 3_600_001);
    expect(loadModelCache()).toBeNull();
  });

  it("cache exactly at TTL boundary (age === TTL) is not expired", () => {
    writeFileSync(
      cacheFilePath,
      JSON.stringify({ updatedAt: NOW, models: { a: {} } }),
      "utf8",
    );

    // Age = 3600000 is NOT > 3600000 → valid
    vi.spyOn(Date, "now").mockReturnValue(NOW + 3_600_000);
    expect(loadModelCache()).not.toBeNull();
  });

  it("cache just past TTL boundary (age > TTL) is expired", () => {
    writeFileSync(
      cacheFilePath,
      JSON.stringify({ updatedAt: NOW, models: { a: {} } }),
      "utf8",
    );

    vi.spyOn(Date, "now").mockReturnValue(NOW + 3_600_001);
    expect(loadModelCache()).toBeNull();
  });
});

// ===================================================================
// loadModelCache
// ===================================================================

describe("loadModelCache", () => {
  const NOW = 2_000_000_000_000;

  it("returns null when cache file does not exist", () => {
    expect(loadModelCache()).toBeNull();
  });

  it("returns null when cache file contains corrupted JSON", () => {
    writeFileSync(cacheFilePath, "not-json-at-all", "utf8");
    expect(loadModelCache()).toBeNull();
  });

  it("returns null when cache has no updatedAt field", () => {
    writeFileSync(
      cacheFilePath,
      JSON.stringify({ models: { a: {} } }),
      "utf8",
    );
    expect(loadModelCache()).toBeNull();
  });

  it("returns null when cache has no models field", () => {
    writeFileSync(
      cacheFilePath,
      JSON.stringify({ updatedAt: Date.now() }),
      "utf8",
    );
    expect(loadModelCache()).toBeNull();
  });

  it("returns null when cache is expired (TTL exceeded)", () => {
    const updatedAt = NOW - 3_700_000; // ~61 minutes ago
    writeFileSync(
      cacheFilePath,
      JSON.stringify({ updatedAt, models: { a: {} } }),
      "utf8",
    );
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    expect(loadModelCache()).toBeNull();
  });

  it("returns parsed cache when valid and fresh", () => {
    const updatedAt = Date.now() - 1000; // 1 second ago
    const cacheData = {
      updatedAt,
      models: {
        "model-a": { displayName: "Model A" },
        "model-b": {},
      },
    };
    writeFileSync(cacheFilePath, JSON.stringify(cacheData), "utf8");

    const result = loadModelCache();
    expect(result).not.toBeNull();
    expect(result!.updatedAt).toBe(updatedAt);
    expect(result!.models["model-a"]?.displayName).toBe("Model A");
    expect(result!.models["model-b"]).toEqual({});
  });

  it("does NOT treat future updatedAt as expired", () => {
    const future = Date.now() + 3_600_000; // 1 hour in the future
    writeFileSync(
      cacheFilePath,
      JSON.stringify({ updatedAt: future, models: { a: {} } }),
      "utf8",
    );
    // age will be negative, which is not > TTL → valid
    expect(loadModelCache()).not.toBeNull();
  });
});

// ===================================================================
// saveModelCache
// ===================================================================

describe("saveModelCache", () => {
  const NOW = 3_000_000_000_000;

  it("saves with correct structure (updatedAt + models)", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const models = { m1: { displayName: "M1" }, m2: {} };
    saveModelCache(models);

    expect(existsSync(cacheFilePath)).toBe(true);
    const raw = readFileSync(cacheFilePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.updatedAt).toBe(NOW);
    expect(parsed.models).toEqual(models);
  });

  it("creates the cache directory if missing", () => {
    // Remove the temp cache directory entirely
    rmSync(cacheDir, { recursive: true, force: true });
    expect(existsSync(cacheDir)).toBe(false);

    saveModelCache({ "x": {} });

    expect(existsSync(cacheDir)).toBe(true);
    expect(existsSync(cacheFilePath)).toBe(true);

    const raw = readFileSync(cacheFilePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.models).toEqual({ x: {} });
  });

  it("throws on disk error (propagates writeFileSync error)", () => {
    // Create a read-only directory to force a write error
    const roDir = mkdtempSync(join(tmpdir(), "discovery-ro-"));
    const origDir = process.env.ZCODE_CONFIG_DIR;

    try {
      process.env.ZCODE_CONFIG_DIR = roDir;
      chmodSync(roDir, 0o444); // remove write permission

      expect(() => saveModelCache({ a: {} })).toThrow();
    } finally {
      chmodSync(roDir, 0o755); // restore for cleanup
      process.env.ZCODE_CONFIG_DIR = origDir;
      rmSync(roDir, { recursive: true, force: true });
    }
  });
});

// ===================================================================
// buildModelRegistry
// ===================================================================

describe("buildModelRegistry", () => {
  it("returns empty registry when apiResponse.models is undefined", () => {
    const result = buildModelRegistry({});
    expect(result.models).toEqual([]);
    expect(result.nameMap).toEqual({});
    expect(result.capabilities).toEqual({});
    expect(result.aliases).toEqual({});
    expect(result.preSuffixedModels).toEqual(new Set());
  });

  it("returns empty registry when apiResponse.models is undefined explicitly", () => {
    const result = buildModelRegistry({ models: undefined });
    expect(result.models).toEqual([]);
  });

  it("creates correct OpenAIModelEntry shape for a single model", () => {
    const before = Math.floor(Date.now() / 1000);
    const result = buildModelRegistry({
      models: {
        "my-model": {},
      },
    });
    const after = Math.floor(Date.now() / 1000);
    expect(result.models).toHaveLength(1);
    expect(result.models[0]!.id).toBe("my-model");
    expect(result.models[0]!.object).toBe("model");
    expect(result.models[0]!.created).toBeGreaterThanOrEqual(before);
    expect(result.models[0]!.created).toBeLessThanOrEqual(after);
    expect(result.models[0]!.owned_by).toBe("antigravity");
  });

  it("excludes models matching EXCLUDED_MODELS patterns", () => {
    const result = buildModelRegistry({
      models: {
        "chat-bison-2": {},
        "code-bison-v1": {},
        "chat_something": {},
        "test-model-alpha": {},
        "internal-secret": {},
        "gemini-2.5-pro": {},
        "gemini-3-pro": {},
        "gemini-3.1-pro-high": {},
        "gemini-pro-agent": {},
        "valid-model": {},
      },
    });

    const modelIds = result.models.map((m) => m.id);
    // Each excluded pattern:
    expect(modelIds).not.toContain("chat-bison-2");       // chat-bison*
    expect(modelIds).not.toContain("code-bison-v1");      // code-bison*
    expect(modelIds).not.toContain("chat_something");     // chat_*
    expect(modelIds).not.toContain("test-model-alpha");   // test-*
    expect(modelIds).not.toContain("internal-secret");    // internal-*
    expect(modelIds).not.toContain("gemini-2.5-pro");     // $ anchor match
    expect(modelIds).not.toContain("gemini-3-pro");       // $ anchor match
    expect(modelIds).not.toContain("gemini-3.1-pro-high");// $ anchor match
    expect(modelIds).not.toContain("gemini-pro-agent");   // $ anchor match
    expect(modelIds).toContain("valid-model");
    expect(result.models).toHaveLength(1);
  });

  it("excludes gemini-2.5-pro but not gemini-2.5-pro-exp (anchor check)", () => {
    const result = buildModelRegistry({
      models: {
        "gemini-2.5-pro": {},
        "gemini-2.5-pro-exp": {},
      },
    });
    const modelIds = result.models.map((m) => m.id);
    expect(modelIds).not.toContain("gemini-2.5-pro");
    expect(modelIds).toContain("gemini-2.5-pro-exp");
  });

  it("uses modelName as public name when provided", () => {
    const result = buildModelRegistry({
      models: {
        "api-key-123": {
          modelName: "public-name",
          displayName: "Public Name",
        },
      },
    });

    expect(result.models).toHaveLength(1);
    expect(result.models[0]!.id).toBe("public-name");
    expect(result.nameMap["public-name"]).toBe("api-key-123");
  });

  it("falls back to the key when modelName is undefined", () => {
    const result = buildModelRegistry({
      models: {
        "my-key": {},
      },
    });

    expect(result.models[0]!.id).toBe("my-key");
    expect(result.nameMap["my-key"]).toBe("my-key");
  });

  it("uses empty string modelName as-is (?? does not treat '' as nullish)", () => {
    // The source uses `??` which only checks null/undefined, not falsy
    // So empty string is treated as a valid modelName
    const result = buildModelRegistry({
      models: {
        "fallback-key": {
          modelName: "",
        },
      },
    });

    // '' is not null/undefined, so ?? gives ''
    expect(result.models[0]!.id).toBe("");
    expect(result.nameMap[""]).toBe("fallback-key");
  });

  it("marks pre-suffixed models and adds identity alias", () => {
    const result = buildModelRegistry({
      models: {
        "gemini-2.5-flash-low": {},
      },
    });

    expect(result.preSuffixedModels.has("gemini-2.5-flash-low")).toBe(true);
    expect(result.aliases["gemini-2.5-flash-low"]).toBe("gemini-2.5-flash-low");
  });

  it("generates tier aliases for non-pre-suffixed thinking models", () => {
    const result = buildModelRegistry({
      models: {
        "claude-sonnet-4-thinking": {},
      },
    });

    expect(result.preSuffixedModels.has("claude-sonnet-4-thinking")).toBe(false);
    expect(result.aliases["claude-sonnet-4-thinking-low"]).toBe("claude-sonnet-4-thinking");
    expect(result.aliases["claude-sonnet-4-thinking-medium"]).toBe("claude-sonnet-4-thinking");
    expect(result.aliases["claude-sonnet-4-thinking-high"]).toBe("claude-sonnet-4-thinking");
    // Minimal/extra-low are skipped for Claude thinking models
    expect(result.aliases["claude-sonnet-4-thinking-minimal"]).toBeUndefined();
    expect(result.aliases["claude-sonnet-4-thinking-extra-low"]).toBeUndefined();
  });

  it("does not generate tier aliases for non-thinking models", () => {
    const result = buildModelRegistry({
      models: {
        "claude-sonnet-4": {},
      },
    });

    expect(result.aliases["claude-sonnet-4-low"]).toBeUndefined();
    expect(result.aliases["claude-sonnet-4-medium"]).toBeUndefined();
    expect(result.aliases["claude-sonnet-4-high"]).toBeUndefined();
  });

  it("generates gemini-prefixed Claude proxy aliases", () => {
    const result = buildModelRegistry({
      models: {
        "claude-sonnet-4": {},
      },
    });

    expect(result.aliases["gemini-claude-sonnet-4"]).toBe("claude-sonnet-4");
  });

  it("generates gemini-prefixed Claude proxy aliases with tiers for thinking models", () => {
    const result = buildModelRegistry({
      models: {
        "claude-thinking-v1": {
          modelName: "claude-thinking-v1",
        },
      },
    });

    expect(result.aliases["gemini-claude-thinking-v1-low"]).toBe("claude-thinking-v1");
    expect(result.aliases["gemini-claude-thinking-v1-medium"]).toBe("claude-thinking-v1");
    expect(result.aliases["gemini-claude-thinking-v1-high"]).toBe("claude-thinking-v1");
    expect(result.aliases["gemini-claude-thinking-v1-minimal"]).toBeUndefined();
    expect(result.aliases["gemini-claude-thinking-v1-extra-low"]).toBeUndefined();
  });

  it("sorts models deterministically by localeCompare", () => {
    const result = buildModelRegistry({
      models: {
        "z-model": {},
        "a-model": {},
        "m-model": {},
      },
    });

    expect(result.models).toHaveLength(3);
    expect(result.models[0]!.id).toBe("a-model");
    expect(result.models[1]!.id).toBe("m-model");
    expect(result.models[2]!.id).toBe("z-model");
  });

  it("later model with same publicName overwrites earlier in nameMap", () => {
    const result = buildModelRegistry({
      models: {
        "first-id": { modelName: "same-name" },
        "second-id": { modelName: "same-name" },
      },
    });

    expect(result.models).toHaveLength(2);
    expect(result.models[0]!.id).toBe("same-name");
    expect(result.models[1]!.id).toBe("same-name");
    expect(result.nameMap["same-name"]).toBe("second-id");
  });

  it("does not generate duplicate tier aliases when tier is already in name (pre-suffixed)", () => {
    const result = buildModelRegistry({
      models: {
        "gemini-2.5-pro-something-low": {},
      },
    });

    expect(result.preSuffixedModels.has("gemini-2.5-pro-something-low")).toBe(true);
    expect(result.aliases["gemini-2.5-pro-something-low"]).toBe("gemini-2.5-pro-something-low");
  });

  it("populates capabilities for each model", () => {
    const result = buildModelRegistry({
      models: {
        "claude-sonnet-4": {},
        "gemini-2.5-flash": {},
      },
    });

    expect(result.capabilities["claude-sonnet-4"]).toBeDefined();
    expect(result.capabilities["claude-sonnet-4"]!.context).toBe(200000);
    expect(result.capabilities["gemini-2.5-flash"]).toBeDefined();
    expect(result.capabilities["gemini-2.5-flash"]!.context).toBe(1048576);
  });
});

// ===================================================================
// discoverModels (orchestrator)
// ===================================================================

describe("discoverModels", () => {
  const ACCESS_TOKEN = "test-token";
  const PROJECT_ID = "test-project";

  it("returns from cache when cache hit, does not call API", async () => {
    writeFileSync(
      cacheFilePath,
      JSON.stringify({
        updatedAt: Date.now() - 1000,
        models: { "cached-model": { displayName: "Cached Model" } },
      }),
      "utf8",
    );

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeResponse(200, { models: {} }),
    );

    const result = await discoverModels(ACCESS_TOKEN, PROJECT_ID);

    expect(result.source).toBe("cache");
    expect(result.modelCount).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls API on cache miss, saves cache, returns registry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeResponse(200, {
        models: {
          "api-model-a": { displayName: "API Model A" },
        },
      }),
    );

    const result = await discoverModels(ACCESS_TOKEN, PROJECT_ID);

    expect(result.source).toBe("api");
    expect(result.modelCount).toBe(1);
    expect(result.registry.models[0]!.id).toBe("api-model-a");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Verify cache was saved to disk
    expect(existsSync(cacheFilePath)).toBe(true);
    const raw = readFileSync(cacheFilePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.models).toHaveProperty("api-model-a");
  });

  it("returns empty fallback when cache miss and API fails (throws)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("Network failure");
    });

    const result = await discoverModels(ACCESS_TOKEN, PROJECT_ID);

    expect(result.source).toBe("fallback");
    expect(result.modelCount).toBe(0);
    expect(result.registry.models).toEqual([]);
    expect(result.error).toBe("Network failure");
  });

  it("returns empty fallback when cache miss and API returns error status", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeResponse(500, "Server Error"),
    );

    const result = await discoverModels(ACCESS_TOKEN, PROJECT_ID);

    expect(result.source).toBe("fallback");
    expect(result.modelCount).toBe(0);
    expect(result.error).toContain("fetchAvailableModels failed");
  });

  it("both cache miss and API fail returns empty fallback with correct shape", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("API unreachable");
    });

    const result = await discoverModels(ACCESS_TOKEN, PROJECT_ID);

    expect(result.source).toBe("fallback");
    expect(result.modelCount).toBe(0);
    expect(result.registry).toEqual({
      models: [],
      nameMap: {},
      capabilities: {},
      aliases: {},
      preSuffixedModels: new Set(),
    });
  });
});
