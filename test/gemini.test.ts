/**
 * Tests for Gemini-specific request transformations.
 */
import { describe, it, expect } from "vitest";
import {
  isGemini3Model,
  isGemini25Model,
  isImageGenerationModel,
  buildGemini3ThinkingConfig,
  buildGemini25ThinkingConfig,
  normalizeGeminiTools,
  wrapToolsAsFunctionDeclarations,
  applyGeminiTransforms,
} from "../src/transform/gemini.js";

// ---- isGemini3Model ----

describe("isGemini3Model", () => {
  it("returns true for Gemini 3 models", () => {
    expect(isGemini3Model("gemini-3-pro")).toBe(true);
    expect(isGemini3Model("gemini-3.1-pro")).toBe(true);
    expect(isGemini3Model("gemini-3-flash")).toBe(true);
  });

  it("returns false for Gemini 2.5 models", () => {
    expect(isGemini3Model("gemini-2.5-pro")).toBe(false);
    expect(isGemini3Model("gemini-2.5-flash")).toBe(false);
  });

  it("returns false for Claude models", () => {
    expect(isGemini3Model("claude-opus-4-6-thinking")).toBe(false);
  });
});

// ---- isGemini25Model ----

describe("isGemini25Model", () => {
  it("returns true for Gemini 2.5 models", () => {
    expect(isGemini25Model("gemini-2.5-pro")).toBe(true);
    expect(isGemini25Model("gemini-2.5-flash")).toBe(true);
  });

  it("returns false for Gemini 3 models", () => {
    expect(isGemini25Model("gemini-3-pro")).toBe(false);
  });
});

// ---- isImageGenerationModel ----

describe("isImageGenerationModel", () => {
  it("returns true for image models", () => {
    expect(isImageGenerationModel("gemini-3-pro-image")).toBe(true);
    expect(isImageGenerationModel("imagen-3")).toBe(true);
  });

  it("returns false for text models", () => {
    expect(isImageGenerationModel("gemini-3-pro")).toBe(false);
  });
});

// ---- buildGemini3ThinkingConfig ----

describe("buildGemini3ThinkingConfig", () => {
  it("builds config with thinkingLevel", () => {
    const config = buildGemini3ThinkingConfig(true, "high");
    expect(config.includeThoughts).toBe(true);
    expect(config.thinkingLevel).toBe("high");
  });

  it("uses camelCase keys", () => {
    const config = buildGemini3ThinkingConfig(true, "medium");
    expect(config.includeThoughts).toBe(true);
    expect(config.thinkingLevel).toBe("medium");
  });
});

// ---- buildGemini25ThinkingConfig ----

describe("buildGemini25ThinkingConfig", () => {
  it("builds config with thinkingBudget", () => {
    const config = buildGemini25ThinkingConfig(true, 16384);
    expect(config.includeThoughts).toBe(true);
    expect(config.thinkingBudget).toBe(16384);
  });

  it("omits budget when not provided", () => {
    const config = buildGemini25ThinkingConfig(true);
    expect(config.includeThoughts).toBe(true);
    expect(config.thinkingBudget).toBeUndefined();
  });
});

// ---- normalizeGeminiTools ----

describe("normalizeGeminiTools", () => {
  it("returns zero for payload without tools", () => {
    const payload: Record<string, unknown> = {};
    const result = normalizeGeminiTools(payload);
    expect(result.toolDebugMissing).toBe(0);
    expect(result.toolDebugSummaries).toEqual([]);
  });

  it("preserves googleSearch tools unchanged", () => {
    const payload: Record<string, unknown> = {
      tools: [{ googleSearch: {} }],
    };
    normalizeGeminiTools(payload);
    const tools = payload.tools as Record<string, unknown>[];
    expect(tools[0]).toEqual({ googleSearch: {} });
  });

  it("preserves googleSearchRetrieval tools unchanged", () => {
    const payload: Record<string, unknown> = {
      tools: [{ googleSearchRetrieval: {} }],
    };
    normalizeGeminiTools(payload);
    const tools = payload.tools as Record<string, unknown>[];
    expect(tools[0]).toEqual({ googleSearchRetrieval: {} });
  });

  it("transforms function tool schema to uppercase types", () => {
    const payload: Record<string, unknown> = {
      tools: [
        {
          function: {
            name: "search",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
                limit: { type: "integer" },
              },
            },
          },
        },
      ],
    };
    normalizeGeminiTools(payload);
    const tools = payload.tools as Record<string, unknown>[];
    const tool = tools[0] as Record<string, unknown>;
    const fn = tool.function as Record<string, unknown>;
    const schema = fn.input_schema as Record<string, unknown>;
    expect(schema.type).toBe("OBJECT");
    const props = schema.properties as Record<string, unknown>;
    expect((props.query as Record<string, unknown>).type).toBe("STRING");
    expect((props.limit as Record<string, unknown>).type).toBe("INTEGER");
  });

  it("adds placeholder schema for tools without parameters", () => {
    const payload: Record<string, unknown> = {
      tools: [
        {
          function: { name: "noop" },
        },
      ],
    };
    const result = normalizeGeminiTools(payload);
    expect(result.toolDebugMissing).toBe(1);
    const tools = payload.tools as Record<string, unknown>[];
    const fn = (tools[0] as Record<string, unknown>).function as Record<string, unknown>;
    const schema = fn.input_schema as Record<string, unknown>;
    expect(schema.type).toBe("OBJECT");
    expect(schema.properties).toBeDefined();
  });

  it("handles custom tool format through full pipeline", () => {
    // Custom-only tools (no function) get their name preserved via tool-level name
    // after normalizeGeminiTools strips the .custom wrapper
    const payload: Record<string, unknown> = {
      tools: [
        {
          name: "my_tool",
          description: "Custom tool",
          custom: {
            parameters: { type: "object", properties: { x: { type: "number" } } },
          },
        },
      ],
    };
    normalizeGeminiTools(payload);
    const wrapResult = wrapToolsAsFunctionDeclarations(payload);
    expect(wrapResult.wrappedFunctionCount).toBe(1);
    const tools = payload.tools as Record<string, unknown>[];
    const wrapper = tools[0] as Record<string, unknown>;
    const fd = wrapper.functionDeclarations as Record<string, unknown>[];
    // Name comes from tool-level name after custom is stripped
    expect(fd[0].name).toBe("my_tool");
  });

  it("strips custom wrappers after normalization and wraps correctly", () => {
    const payload: Record<string, unknown> = {
      tools: [
        {
          custom: {
            name: "my_tool",
            input_schema: { type: "object", properties: {} },
          },
        },
      ],
    };
    normalizeGeminiTools(payload);
    const tools = payload.tools as Record<string, unknown>[];
    // custom is stripped by design
    expect((tools[0] as Record<string, unknown>).custom).toBeUndefined();
    // After full pipeline, wrapToolsAsFunctionDeclarations restructures it
    wrapToolsAsFunctionDeclarations(payload);
    const wrapper = (payload.tools as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(wrapper.functionDeclarations).toBeDefined();
  });

  it("creates structure for tools without function or custom", () => {
    const payload: Record<string, unknown> = {
      tools: [
        {
          parameters: { type: "object", properties: { q: { type: "string" } } },
        },
      ],
    };
    normalizeGeminiTools(payload);
    // After normalize, custom was created and stripped
    // Full pipeline should still produce valid output
    const result = wrapToolsAsFunctionDeclarations(payload);
    expect(result.wrappedFunctionCount).toBe(1);
  });

  it("generates tool names from index when missing", () => {
    const payload: Record<string, unknown> = {
      tools: [
        { parameters: { type: "object" } },
        { parameters: { type: "object" } },
      ],
    };
    normalizeGeminiTools(payload);
    const result = wrapToolsAsFunctionDeclarations(payload);
    expect(result.wrappedFunctionCount).toBe(2);
    const tools = payload.tools as Record<string, unknown>[];
    const fd = (tools[0] as Record<string, unknown>).functionDeclarations as Record<string, unknown>[];
    expect(fd[0].name).toBe("tool-0");
    expect(fd[1].name).toBe("tool-1");
  });
});

// ---- wrapToolsAsFunctionDeclarations ----

describe("wrapToolsAsFunctionDeclarations", () => {
  it("returns zero for empty tools", () => {
    const payload: Record<string, unknown> = { tools: [] };
    const result = wrapToolsAsFunctionDeclarations(payload);
    expect(result.wrappedFunctionCount).toBe(0);
    expect(result.passthroughToolCount).toBe(0);
  });

  it("wraps function tools in functionDeclarations", () => {
    const payload: Record<string, unknown> = {
      tools: [
        {
          function: {
            name: "search",
            description: "Search",
            parameters: { type: "OBJECT", properties: { q: { type: "STRING" } } },
          },
        },
      ],
    };
    const result = wrapToolsAsFunctionDeclarations(payload);
    expect(result.wrappedFunctionCount).toBe(1);
    const tools = payload.tools as Record<string, unknown>[];
    const wrapper = tools[0] as Record<string, unknown>;
    expect(wrapper.functionDeclarations).toBeDefined();
    const fd = wrapper.functionDeclarations as Record<string, unknown>[];
    expect(fd[0].name).toBe("search");
  });

  it("passes through googleSearch and codeExecution tools", () => {
    const payload: Record<string, unknown> = {
      tools: [
        { googleSearch: {} },
        { codeExecution: {} },
      ],
    };
    const result = wrapToolsAsFunctionDeclarations(payload);
    expect(result.passthroughToolCount).toBe(2);
    expect(result.wrappedFunctionCount).toBe(0);
    const tools = payload.tools as Record<string, unknown>[];
    expect(tools[0]).toEqual({ googleSearch: {} });
    expect(tools[1]).toEqual({ codeExecution: {} });
  });

  it("converts Claude-style web_search tool to googleSearch when no functions present", () => {
    const payload: Record<string, unknown> = {
      tools: [
        { type: "web_search_20250305" },
      ],
    };
    const result = wrapToolsAsFunctionDeclarations(payload);
    expect(result.wrappedFunctionCount).toBe(0);
    expect(result.passthroughToolCount).toBe(1);
    const tools = payload.tools as Record<string, unknown>[];
    expect(tools[0]).toEqual({ googleSearch: {} });
  });

  it("detects name-based web search tools", () => {
    const payload: Record<string, unknown> = {
      tools: [{ name: "web_search" }],
    };
    const result = wrapToolsAsFunctionDeclarations(payload);
    expect(result.passthroughToolCount).toBe(1);
  });

  it("skips googleSearch when function declarations are present (API limitation)", () => {
    const payload: Record<string, unknown> = {
      tools: [
        { type: "web_search_20250305" },
        {
          function: {
            name: "search",
            parameters: { type: "OBJECT" },
          },
        },
      ],
    };
    const result = wrapToolsAsFunctionDeclarations(payload);
    expect(result.wrappedFunctionCount).toBe(1);
    const tools = payload.tools as Record<string, unknown>[];
    // Should only have functionDeclarations, not googleSearch
    expect(tools.length).toBe(1);
  });

  it("handles already-normalized functionDeclarations format", () => {
    const payload: Record<string, unknown> = {
      tools: [
        {
          functionDeclarations: [
            { name: "tool1", description: "", parameters: { type: "OBJECT" } },
            { name: "tool2", description: "", parameters: { type: "OBJECT" } },
          ],
        },
      ],
    };
    const result = wrapToolsAsFunctionDeclarations(payload);
    expect(result.wrappedFunctionCount).toBe(2);
  });
});

// ---- applyGeminiTransforms ----

describe("applyGeminiTransforms", () => {
  it("applies thinking config for Gemini 3 model", () => {
    const payload: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      generationConfig: {},
    };

    applyGeminiTransforms(payload, {
      model: "gemini-3.1-pro",
      tierThinkingLevel: "high",
      normalizedThinking: { includeThoughts: true },
    });

    const gc = payload.generationConfig as Record<string, unknown>;
    const tc = gc.thinkingConfig as Record<string, unknown>;
    expect(tc).toBeDefined();
    expect(tc.includeThoughts).toBe(true);
    expect(tc.thinkingLevel).toBe("high");
  });

  it("applies thinking config for Gemini 2.5 model", () => {
    const payload: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      generationConfig: {},
    };

    applyGeminiTransforms(payload, {
      model: "gemini-2.5-pro",
      tierThinkingBudget: 16384,
      normalizedThinking: { includeThoughts: true },
    });

    const gc = payload.generationConfig as Record<string, unknown>;
    const tc = gc.thinkingConfig as Record<string, unknown>;
    expect(tc).toBeDefined();
    expect(tc.includeThoughts).toBe(true);
    expect(tc.thinkingBudget).toBe(16384);
  });

  it("normalizes and wraps tools", () => {
    const payload: Record<string, unknown> = {
      contents: [],
      tools: [
        {
          function: {
            name: "search",
            parameters: { type: "object", properties: { q: { type: "string" } } },
          },
        },
      ],
    };

    const result = applyGeminiTransforms(payload, {
      model: "gemini-3.1-pro",
    });

    expect(result.wrappedFunctionCount).toBe(1);
    expect(result.toolDebugMissing).toBe(0);
    const tools = payload.tools as Record<string, unknown>[];
    const wrapper = tools[0] as Record<string, unknown>;
    expect(wrapper.functionDeclarations).toBeDefined();
  });

  it("handles models without thinking config", () => {
    const payload: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
    };

    applyGeminiTransforms(payload, {
      model: "gemini-2.5-flash",
    });

    // No thinking config should be set
    expect(payload.generationConfig).toBeUndefined();
  });
});
