/**
 * Integration tests for zcode-antigravity-proxy.
 *
 * Tests that multiple modules work together correctly:
 * 1. Model Registry → Model Resolution Pipeline
 * 2. Request → Transform → Response Pipeline (full round-trip with mocks)
 * 3. Model Cache → Setup
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { transformRequest, type OpenAIChatRequest } from "../src/transform/request.js";
import { transformNonStreamResponse, transformSSELine, resetSSEState } from "../src/transform/response.js";
import {
  resolveModelWithTier,
  resolveAntigravityModel,
  getModelAliases,
  setModelRegistryForResolution,
} from "../src/transform/model-resolver.js";
import { buildModelRegistry } from "../src/models/discovery.js";
import { setupAntigravityProvider, isProviderConfigured } from "../src/cli/setup.js";
import { getConfig, initRuntimeConfig } from "../src/config.js";
import { makeEmptyRegistry } from "./helpers.js";
import type { ModelRegistryData } from "../src/models/discovery.js";
import type { TransformOptions, OpenAIChatRequest as OAIRequest } from "../src/transform/request.js";

// ---- Initialize runtime config at module scope ----
initRuntimeConfig(getConfig());

// ===================================================================
// 1. Model Registry → Model Resolution Pipeline
// ===================================================================

describe("Integration: Model Registry → Model Resolution Pipeline", () => {
  // ---- Populated Registry ----

  describe("with populated registry", () => {
    let registry: ModelRegistryData;

    beforeAll(() => {
      // Build a registry from a synthetic API response
      registry = buildModelRegistry({
        models: {
          "gemini-3.1-pro-low": { displayName: "Gemini 3.1 Pro (Low)" },
          "gemini-3-flash": { displayName: "Gemini 3 Flash" },
          "claude-sonnet-4-thinking": { displayName: "Claude Sonnet 4 Thinking" },
          "claude-sonnet-4": { displayName: "Claude Sonnet 4" },
        },
      });
      setModelRegistryForResolution(registry);
    });

    it("buildModelRegistry produces ModelRegistryData with correct entries", () => {
      // Verify the registry structure
      expect(registry.models.length).toBeGreaterThan(0);
      const modelIds = registry.models.map((m) => m.id);
      expect(modelIds).toContain("gemini-3.1-pro-low");
      expect(modelIds).toContain("gemini-3-flash");
      expect(modelIds).toContain("claude-sonnet-4-thinking");
      expect(modelIds).toContain("claude-sonnet-4");

      // Name map entries
      expect(registry.nameMap["gemini-3.1-pro-low"]).toBe("gemini-3.1-pro-low");
      expect(registry.nameMap["gemini-3-flash"]).toBe("gemini-3-flash");

      // Capabilities inferred
      expect(registry.capabilities["gemini-3.1-pro-low"]).toBeDefined();
      expect(registry.capabilities["gemini-3-flash"]).toBeDefined();
      expect(registry.capabilities["claude-sonnet-4-thinking"]).toBeDefined();

      // Pre-suffixed detection
      expect(registry.preSuffixedModels.has("gemini-3.1-pro-low")).toBe(true);
      expect(registry.preSuffixedModels.has("gemini-3-flash")).toBe(false);
    });

    it("setModelRegistryForResolution makes registry available to the resolver", () => {
      // Registry was set in beforeAll, so getModelAliases() should include registry-generated aliases
      const aliases = getModelAliases();

      // Registry-generated tier aliases for thinking models
      expect(aliases["gemini-3-flash-low"]).toBe("gemini-3-flash");
      expect(aliases["gemini-3-flash-medium"]).toBe("gemini-3-flash");
      expect(aliases["gemini-3-flash-high"]).toBe("gemini-3-flash");
      expect(aliases["claude-sonnet-4-thinking-low"]).toBe("claude-sonnet-4-thinking");
      expect(aliases["claude-sonnet-4-thinking-medium"]).toBe("claude-sonnet-4-thinking");
      expect(aliases["claude-sonnet-4-thinking-high"]).toBe("claude-sonnet-4-thinking");

      // Gemini-prefixed Claude proxy aliases
      expect(aliases["gemini-claude-sonnet-4"]).toBe("claude-sonnet-4");
      expect(aliases["gemini-claude-sonnet-4-thinking-low"]).toBe("claude-sonnet-4-thinking");
      expect(aliases["gemini-claude-sonnet-4-thinking-medium"]).toBe("claude-sonnet-4-thinking");
      expect(aliases["gemini-claude-sonnet-4-thinking-high"]).toBe("claude-sonnet-4-thinking");

      // Pre-suffixed model identity alias
      expect(aliases["gemini-3.1-pro-low"]).toBe("gemini-3.1-pro-low");
    });

    it("resolveModelWithTier uses registry data to resolve gemini-3.1-pro-low", () => {
      const resolved = resolveModelWithTier("gemini-3.1-pro-low");
      expect(resolved.actualModel).toBe("gemini-3.1-pro-low");
      expect(resolved.isThinkingModel).toBe(true);
      // Pre-suffixed model → no explicit thinkingLevel or tier (API handles via model name)
      expect(resolved.thinkingLevel).toBeUndefined();
      expect(resolved.tier).toBeUndefined();
    });

    it("resolveAntigravityModel returns the correct mapped name", () => {
      const mapped = resolveAntigravityModel("gemini-3.1-pro-low");
      expect(mapped).toBe("gemini-3.1-pro-low");
    });

    it("getModelAliases returns aliases that include registry-generated entries", () => {
      const aliases = getModelAliases();

      // Registry-only entries (not in fallback)
      expect(aliases["claude-sonnet-4-thinking-low"]).toBe("claude-sonnet-4-thinking");
      expect(aliases["claude-sonnet-4-thinking-medium"]).toBe("claude-sonnet-4-thinking");
      expect(aliases["claude-sonnet-4-thinking-high"]).toBe("claude-sonnet-4-thinking");

      // Fallback entries are still present
      expect(aliases["gemini-3-flash-low"]).toBe("gemini-3-flash");
      expect(aliases["gemini-3-flash-medium"]).toBe("gemini-3-flash");
      expect(aliases["gemini-3-flash-high"]).toBe("gemini-3-flash");

      // Claude thinking minimal/extra-low tiers are NOT generated
      expect(aliases["claude-sonnet-4-thinking-minimal"]).toBeUndefined();
      expect(aliases["claude-sonnet-4-thinking-extra-low"]).toBeUndefined();
    });
  });

  // ---- Fallback Chain ----

  describe("fallback chain with empty registry", () => {
    beforeAll(() => {
      setModelRegistryForResolution(makeEmptyRegistry());
    });

    it("getModelAliases still returns FALLBACK_MODEL_ALIASES for known models", () => {
      const aliases = getModelAliases();

      // Known models from fallback
      expect(aliases["gemini-3-flash-low"]).toBe("gemini-3-flash");
      expect(aliases["gemini-3-flash-medium"]).toBe("gemini-3-flash");
      expect(aliases["gemini-3-flash-high"]).toBe("gemini-3-flash");
      expect(aliases["gemini-2.5-flash-low"]).toBe("gemini-2.5-flash");
      expect(aliases["gemini-2.5-flash-medium"]).toBe("gemini-2.5-flash");
      expect(aliases["gemini-2.5-flash-high"]).toBe("gemini-2.5-flash");
      expect(aliases["gemini-claude-opus-4-6-thinking-low"]).toBe("claude-opus-4-6-thinking");
      expect(aliases["gemini-claude-sonnet-4-6"]).toBe("claude-sonnet-4-6");
      expect(aliases["gemini-3.1-pro-low"]).toBe("gemini-3.1-pro-low");

      // Registry-only entries are NOT present with empty registry
      expect(aliases["claude-sonnet-4-thinking-low"]).toBeUndefined();

      // Confirm the alias map has fallback entries
      expect(Object.keys(aliases).length).toBeGreaterThan(0);
    });

    it("resolveAntigravityModel returns fallback name for known models", () => {
      const mapped = resolveAntigravityModel("claude-sonnet-4-6");
      // FALLBACK_MODEL_NAME_MAP has identity mapping
      expect(mapped).toBe("claude-sonnet-4-6");
    });
  });
});

// ===================================================================
// 2. Request → Transform → Response Pipeline
// ===================================================================

describe("Integration: Request → Transform → Response Pipeline", () => {
  const sharedOptions: TransformOptions = {
    projectId: "test-project",
    accessToken: "test-token",
    config: getConfig(),
  };

  beforeEach(() => {
    resetSSEState();
  });

  // ---- Non-Streaming Round-trip ----

  describe("non-streaming request", () => {
    it("transforms a simple user message into the correct Antigravity request shape", () => {
      const request: OpenAIChatRequest = {
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "Hello" }],
      };

      const { url, init } = transformRequest(request, sharedOptions);

      // URL check
      expect(url).toContain("daily-cloudcode-pa.sandbox.googleapis.com");
      expect(url).toContain("v1internal:generateContent");
      expect(url).not.toContain("alt=sse");

      // Body structure
      const body = JSON.parse(init.body as string);
      expect(body.project).toBe("test-project");
      expect(body.model).toBe("gemini-2.5-flash");

      // Contents
      expect(body.request.contents).toHaveLength(1);
      expect(body.request.contents[0].role).toBe("user");
      expect(body.request.contents[0].parts[0].text).toBe("Hello");

      // System instruction (antigravity default)
      expect(body.request.systemInstruction).toBeDefined();
      expect(body.request.systemInstruction.role).toBe("user");
      expect(body.request.systemInstruction.parts[0].text).toContain("You are Antigravity");

      // Generation config (thinking config for Gemini 2.5)
      expect(body.request.generationConfig).toBeDefined();
      expect(body.request.generationConfig.thinkingConfig).toBeDefined();
      expect(body.request.generationConfig.thinkingConfig.includeThoughts).toBe(true);
      expect(body.request.generationConfig.thinkingConfig.thinkingBudget).toBe(8192);

      // Top-level fields
      expect(body.userAgent).toBe("antigravity");
      expect(body.requestType).toBe("agent");
      expect(body.requestId).toBeDefined();

      // Headers
      expect(init.headers).toBeDefined();
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer test-token");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("produces correct OpenAI-compatible output from a mock non-stream response", () => {
      const mockResponse = JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: "Hello! How can I assist you today?" }],
            },
            finishReason: "stop",
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      });

      const result = transformNonStreamResponse(mockResponse, "gemini-2.5-flash");
      const parsed = JSON.parse(result);

      // Shape checks
      expect(parsed.object).toBe("chat.completion");
      expect(parsed.id).toMatch(/^chatcmpl-/);
      expect(parsed.model).toBe("gemini-2.5-flash");

      // Choices
      expect(parsed.choices).toHaveLength(1);
      expect(parsed.choices[0].index).toBe(0);
      expect(parsed.choices[0].message.role).toBe("assistant");
      expect(parsed.choices[0].message.content).toBe("Hello! How can I assist you today?");
      expect(parsed.choices[0].finish_reason).toBe("stop");

      // Usage
      expect(parsed.usage).toBeDefined();
      expect(parsed.usage.prompt_tokens).toBe(10);
      expect(parsed.usage.completion_tokens).toBe(5);
      expect(parsed.usage.total_tokens).toBe(15);
    });

    it("produces correct output for a response with tool calls", () => {
      const toolResponse = JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "get_weather",
                    args: { location: "London" },
                  },
                },
              ],
            },
            finishReason: "stop",
          },
        ],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 5,
          totalTokenCount: 25,
        },
      });

      const result = transformNonStreamResponse(toolResponse, "gemini-2.5-flash");
      const parsed = JSON.parse(result);

      expect(parsed.choices[0].message.tool_calls).toHaveLength(1);
      expect(parsed.choices[0].message.tool_calls[0].type).toBe("function");
      expect(parsed.choices[0].message.tool_calls[0].function.name).toBe("get_weather");
      expect(parsed.choices[0].message.tool_calls[0].function.arguments).toBe(
        JSON.stringify({ location: "London" }),
      );
      expect(parsed.choices[0].finish_reason).toBe("tool_calls");
    });

    it("returns empty response for empty candidates", () => {
      const emptyResponse = JSON.stringify({
        candidates: [],
      });

      const result = transformNonStreamResponse(emptyResponse, "gemini-2.5-flash");
      const parsed = JSON.parse(result);

      // Empty candidates returns empty string for content (not null)
      expect(parsed.choices[0].message.content).toBe("");
      expect(parsed.choices[0].finish_reason).toBe("stop");
    });
  });

  // ---- Streaming ----

  describe("streaming request", () => {
    it("transformRequest returns URL with alt=sse for streaming", () => {
      const request: OpenAIChatRequest = {
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      };

      const { url, init } = transformRequest(request, sharedOptions);

      expect(url).toContain("streamGenerateContent");
      expect(url).toContain("alt=sse");
      expect((init.headers as Record<string, string>)["Accept"]).toBe("text/event-stream");
    });

    it("transformSSELine transforms a text SSE line into a chat completion chunk", () => {
      const sseLine = 'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}';
      const result = transformSSELine(sseLine);

      expect(result).not.toBeNull();
      expect(result).toMatch(/^data: /);
      expect(result).toMatch(/\n\n$/);

      const parsed = JSON.parse(result!.replace(/^data: /, "").trim());
      expect(parsed.object).toBe("chat.completion.chunk");
      expect(parsed.choices[0].delta.content).toBe("Hello");
    });

    it("transformSSELine transforms a finish+usage SSE line into a completion chunk", () => {
      const sseLine =
        'data: {"candidates":[{"content":{"parts":[]},"finishReason":"stop"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":10,"totalTokenCount":15}}';
      const result = transformSSELine(sseLine);

      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!.replace(/^data: /, "").trim());
      expect(parsed.object).toBe("chat.completion.chunk");
      expect(parsed.choices[0].delta).toEqual({});
      expect(parsed.choices[0].finish_reason).toBe("stop");
      expect(parsed.usage).toBeDefined();
      expect(parsed.usage.prompt_tokens).toBe(5);
    });

    it("transformSSELine passes through [DONE] marker", () => {
      const result = transformSSELine("data: [DONE]");
      expect(result).toBe("data: [DONE]\n\n");
    });

    it("transformSSELine returns null for non-data lines", () => {
      expect(transformSSELine("event: foo")).toBeNull();
      expect(transformSSELine(": comment")).toBeNull();
      expect(transformSSELine("")).toBeNull();
    });
  });

  // ---- Different Model Types ----

  describe("model type specific transforms", () => {
    it("Claude thinking model gets thinking_budget in generationConfig", () => {
      const request: OpenAIChatRequest = {
        model: "claude-opus-4-6-thinking",
        messages: [{ role: "user", content: "Think about this" }],
      };
      const { init } = transformRequest(request, sharedOptions);
      const body = JSON.parse(init.body as string);

      expect(body.request.generationConfig.thinkingConfig).toBeDefined();
      expect(body.request.generationConfig.thinkingConfig.include_thoughts).toBe(true);
      expect(body.request.generationConfig.thinkingConfig.thinking_budget).toBe(32768);
      // Claude: ensure anthropic-beta header is set
      expect((init.headers as Record<string, string>)["anthropic-beta"]).toBe(
        "interleaved-thinking-2025-05-14",
      );
    });

    it("Gemini 3 model with tier gets thinkingLevel in generationConfig", () => {
      const request: OpenAIChatRequest = {
        model: "gemini-3-flash-low",
        messages: [{ role: "user", content: "Hello" }],
      };
      const { init } = transformRequest(request, sharedOptions);
      const body = JSON.parse(init.body as string);

      expect(body.request.generationConfig.thinkingConfig).toBeDefined();
      expect(body.request.generationConfig.thinkingConfig.includeThoughts).toBe(true);
      expect(body.request.generationConfig.thinkingConfig.thinkingLevel).toBe("low");
    });

    it("Non-thinking model (gpt-oss-120b-medium) has no thinking config", () => {
      const request: OpenAIChatRequest = {
        model: "gpt-oss-120b-medium",
        messages: [{ role: "user", content: "Hello" }],
      };
      const { init } = transformRequest(request, sharedOptions);
      const body = JSON.parse(init.body as string);

      // Non-thinking models should not have thinkingConfig
      expect(body.request.generationConfig?.thinkingConfig).toBeUndefined();
    });
  });

  // ---- Tools ----

  describe("tool handling", () => {
    it("request with tools produces functionDeclarations in output", () => {
      const request: OpenAIChatRequest = {
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "Use a tool" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather for a location",
              parameters: {
                type: "object",
                properties: {
                  location: { type: "string", description: "City name" },
                },
                required: ["location"],
              },
            },
          },
        ],
      };

      const { init } = transformRequest(request, sharedOptions);
      const body = JSON.parse(init.body as string);

      expect(body.request.tools).toBeDefined();
      expect(body.request.tools[0].functionDeclarations).toBeDefined();
      expect(body.request.tools[0].functionDeclarations).toHaveLength(1);
      expect(body.request.tools[0].functionDeclarations[0].name).toBe("get_weather");
      expect(body.request.tools[0].functionDeclarations[0].description).toBe(
        "Get weather for a location",
      );
      expect(body.request.tools[0].functionDeclarations[0].parameters).toBeDefined();
    });

    it("request with tools containing exclusiveMinimum strips it in Gemini path", () => {
      const request: OpenAIChatRequest = {
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "Use a tool" }],
        tools: [
          {
            type: "function",
            function: {
              name: "test_tool",
              description: "A test tool",
              parameters: {
                type: "object",
                properties: {
                  count: {
                    type: "integer",
                    description: "A count value",
                    exclusiveMinimum: 0,
                  },
                  name: {
                    type: "string",
                    description: "A name",
                  },
                },
                required: ["count"],
              },
            },
          },
        ],
      };

      const { init } = transformRequest(request, sharedOptions);
      const body = JSON.parse(init.body as string);

      const params = body.request.tools[0].functionDeclarations[0].parameters;
      // exclusiveMinimum should be stripped by toGeminiSchema
      expect(params.properties.count.exclusiveMinimum).toBeUndefined();
      // Other fields should remain
      expect(params.properties.count.type).toBe("INTEGER"); // Uppercased by toGeminiSchema
      expect(params.properties.count.description).toBe("A count value");
      // name property should still be present
      expect(params.properties.name).toBeDefined();
      expect(params.properties.name.type).toBe("STRING");
    });
  });
});

// ===================================================================
// 3. Model Cache → Setup
// ===================================================================

describe("Integration: Model Cache → Setup", () => {
  let configDir: string;
  let cacheFilePath: string;
  let configFilePath: string;

  beforeAll(() => {
    configDir = mkdtempSync(join(tmpdir(), "integration-setup-"));
    process.env.ZCODE_CONFIG_DIR = configDir;
    cacheFilePath = join(configDir, "antigravity-models-cache.json");
    configFilePath = join(configDir, "v2", "config.json");
  });

  afterAll(() => {
    delete process.env.ZCODE_CONFIG_DIR;
    rmSync(configDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    // Clean up files from previous tests
    try {
      rmSync(cacheFilePath, { force: true });
    } catch {
      /* ignore */
    }
    try {
      rmSync(join(configDir, "v2"), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("setupAntigravityProvider includes models from cache", () => {
    // Write a valid cache file with specific models
    const cacheData = {
      updatedAt: Date.now() - 1000, // 1 second old, well within 60-min TTL
      models: {
        "gemini-3-flash": { displayName: "Gemini 3 Flash" },
        "claude-sonnet-4-6": { displayName: "Claude Sonnet 4.6" },
      },
    };
    writeFileSync(cacheFilePath, JSON.stringify(cacheData), "utf8");

    const result = setupAntigravityProvider();

    // Verify the model names from cache appear in the result
    expect(result.modelNames).toContain("gemini-3-flash");
    expect(result.modelNames).toContain("claude-sonnet-4-6");
    expect(result.action).toBe("added");
    expect(result.baseURL).toBe("http://127.0.0.1:51120/v1");

    // Verify config was written to disk
    expect(existsSync(configFilePath)).toBe(true);
    const raw = readFileSync(configFilePath, "utf8");
    const parsed = JSON.parse(raw);
    const models = parsed.provider.antigravity.models;
    expect(models["gemini-3-flash"]).toBeDefined();
    expect(models["claude-sonnet-4-6"]).toBeDefined();
  });

  it("model capabilities are inferred correctly from cache (thinking vs non-thinking)", () => {
    // Write cache with a thinking and non-thinking model
    const cacheData = {
      updatedAt: Date.now() - 1000,
      models: {
        "claude-opus-4-6-thinking": { displayName: "Claude Opus 4.6 Thinking" },
        "claude-sonnet-4-6": { displayName: "Claude Sonnet 4.6" },
      },
    };
    writeFileSync(cacheFilePath, JSON.stringify(cacheData), "utf8");

    setupAntigravityProvider();

    const raw = readFileSync(configFilePath, "utf8");
    const parsed = JSON.parse(raw);
    const models = parsed.provider.antigravity.models;

    // Thinking model should have reasoning config
    const thinkingModel = models["claude-opus-4-6-thinking"];
    expect(thinkingModel.reasoning).toBeDefined();
    expect(thinkingModel.reasoning.enabled).toBe(true);
    expect(thinkingModel.reasoning.variants).toEqual(["low", "medium", "high"]);
    expect(thinkingModel.reasoning.defaultVariant).toBe("high");

    // Non-thinking model should NOT have reasoning config
    const nonThinkingModel = models["claude-sonnet-4-6"];
    expect(nonThinkingModel.reasoning).toBeUndefined();
  });

  it("gemini-3-flash from cache gets full Gemini 3 capabilities", () => {
    const cacheData = {
      updatedAt: Date.now() - 1000,
      models: {
        "gemini-3-flash": { displayName: "Gemini 3 Flash" },
      },
    };
    writeFileSync(cacheFilePath, JSON.stringify(cacheData), "utf8");

    setupAntigravityProvider();

    const raw = readFileSync(configFilePath, "utf8");
    const parsed = JSON.parse(raw);
    const modelConfig = parsed.provider.antigravity.models["gemini-3-flash"];

    // Context window
    expect(modelConfig.limit.context).toBe(1048576);
    expect(modelConfig.limit.output).toBe(65536);

    // Modalities
    expect(modelConfig.modalities.input).toContain("text");
    expect(modelConfig.modalities.input).toContain("image");
    expect(modelConfig.modalities.input).toContain("pdf");
    expect(modelConfig.modalities.output).toContain("text");

    // Reasoning (Gemini 3 Flash supports thinking tiers)
    expect(modelConfig.reasoning).toBeDefined();
    expect(modelConfig.reasoning.enabled).toBe(true);
    expect(modelConfig.reasoning.variants).toEqual(["minimal", "low", "medium", "high"]);
    expect(modelConfig.reasoning.defaultVariant).toBe("high");
  });
});
