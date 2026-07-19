/**
 * Tests for Claude-specific request transformations.
 */
import { describe, it, expect } from "vitest";
import {
  isClaudeThinkingModel,
  configureClaudeToolConfig,
  buildClaudeThinkingConfig,
  ensureClaudeMaxOutputTokens,
  appendClaudeThinkingHint,
  normalizeClaudeTools,
  applyClaudeTransforms,
  CLAUDE_THINKING_MAX_OUTPUT_TOKENS,
  CLAUDE_INTERLEAVED_THINKING_HINT,
} from "../src/transform/claude.js";

// ---- isClaudeThinkingModel ----

describe("isClaudeThinkingModel", () => {
  it("returns true for claude thinking models", () => {
    expect(isClaudeThinkingModel("claude-opus-4-6-thinking")).toBe(true);
    expect(isClaudeThinkingModel("claude-sonnet-4-6-thinking")).toBe(true);
  });

  it("returns false for non-thinking Claude models", () => {
    expect(isClaudeThinkingModel("claude-sonnet-4-6")).toBe(false);
  });

  it("returns false for Gemini models", () => {
    expect(isClaudeThinkingModel("gemini-3.1-pro")).toBe(false);
    expect(isClaudeThinkingModel("gemini-3-flash")).toBe(false);
  });
});

// ---- configureClaudeToolConfig ----

describe("configureClaudeToolConfig", () => {
  it("sets VALIDATED mode on empty payload", () => {
    const payload: Record<string, unknown> = {};
    configureClaudeToolConfig(payload);
    expect(payload.toolConfig).toBeDefined();
    const tc = payload.toolConfig as Record<string, unknown>;
    const fcc = tc.functionCallingConfig as Record<string, unknown>;
    expect(fcc.mode).toBe("VALIDATED");
  });

  it("preserves existing toolConfig structure", () => {
    const payload: Record<string, unknown> = {
      toolConfig: { existingField: "value" },
    };
    configureClaudeToolConfig(payload);
    const tc = payload.toolConfig as Record<string, unknown>;
    expect(tc.existingField).toBe("value");
    const fcc = tc.functionCallingConfig as Record<string, unknown>;
    expect(fcc.mode).toBe("VALIDATED");
  });

  it("does not overwrite existing VALIDATED mode", () => {
    const payload: Record<string, unknown> = {
      toolConfig: {
        functionCallingConfig: { mode: "ANY" },
      },
    };
    configureClaudeToolConfig(payload);
    const tc = payload.toolConfig as Record<string, unknown>;
    const fcc = tc.functionCallingConfig as Record<string, unknown>;
    expect(fcc.mode).toBe("VALIDATED");
  });
});

// ---- buildClaudeThinkingConfig ----

describe("buildClaudeThinkingConfig", () => {
  it("builds config with snake_case keys", () => {
    const config = buildClaudeThinkingConfig(true, 8192);
    expect(config.include_thoughts).toBe(true);
    expect(config.thinking_budget).toBe(8192);
  });

  it("omits thinking_budget when not provided", () => {
    const config = buildClaudeThinkingConfig(true);
    expect(config.include_thoughts).toBe(true);
    expect(config.thinking_budget).toBeUndefined();
  });

  it("omits thinking_budget when zero", () => {
    const config = buildClaudeThinkingConfig(true, 0);
    expect(config.thinking_budget).toBeUndefined();
  });
});

// ---- ensureClaudeMaxOutputTokens ----

describe("ensureClaudeMaxOutputTokens", () => {
  it("sets maxOutputTokens when not set", () => {
    const gc: Record<string, unknown> = {};
    ensureClaudeMaxOutputTokens(gc, 32768);
    expect(gc.maxOutputTokens).toBe(CLAUDE_THINKING_MAX_OUTPUT_TOKENS);
  });

  it("upsizes when current is less than thinking budget", () => {
    const gc: Record<string, unknown> = { maxOutputTokens: 1000 };
    ensureClaudeMaxOutputTokens(gc, 32768);
    expect(gc.maxOutputTokens).toBe(CLAUDE_THINKING_MAX_OUTPUT_TOKENS);
  });

  it("preserves when current is larger than thinking budget", () => {
    const gc: Record<string, unknown> = { maxOutputTokens: 100000 };
    ensureClaudeMaxOutputTokens(gc, 32768);
    expect(gc.maxOutputTokens).toBe(100000);
  });
});

// ---- appendClaudeThinkingHint ----

describe("appendClaudeThinkingHint", () => {
  it("creates system instruction when none exists but contents present", () => {
    const payload: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
    };
    appendClaudeThinkingHint(payload);
    const si = payload.systemInstruction as Record<string, unknown>;
    const parts = si.parts as Record<string, unknown>[];
    expect(parts[0].text).toContain("Interleaved thinking");
  });

  it("appends to existing string system instruction", () => {
    const payload: Record<string, unknown> = {
      systemInstruction: "You are a helpful assistant.",
      contents: [],
    };
    appendClaudeThinkingHint(payload);
    expect(payload.systemInstruction).toContain("You are a helpful assistant.");
    expect(payload.systemInstruction).toContain("Interleaved thinking");
  });

  it("handles empty string system instruction", () => {
    const payload: Record<string, unknown> = {
      systemInstruction: "",
      contents: [],
    };
    appendClaudeThinkingHint(payload);
    expect(payload.systemInstruction).toBe(CLAUDE_INTERLEAVED_THINKING_HINT);
  });

  it("appends to last text part in system instruction object with parts", () => {
    const payload: Record<string, unknown> = {
      systemInstruction: {
        role: "user",
        parts: [{ text: "System prompt here." }],
      },
      contents: [],
    };
    appendClaudeThinkingHint(payload);
    const si = payload.systemInstruction as Record<string, unknown>;
    const parts = si.parts as Record<string, unknown>[];
    expect(parts[0].text).toContain("System prompt here.");
    expect(parts[0].text).toContain("Interleaved thinking");
  });

  it("adds new part when no text parts exist in system instruction", () => {
    const payload: Record<string, unknown> = {
      systemInstruction: {
        role: "user",
        parts: [{ notText: "something" }],
      },
      contents: [],
    };
    appendClaudeThinkingHint(payload);
    const si = payload.systemInstruction as Record<string, unknown>;
    const parts = si.parts as Record<string, unknown>[];
    expect(parts.length).toBe(2);
    expect(parts[1].text).toBe(CLAUDE_INTERLEAVED_THINKING_HINT);
  });

  it("creates parts array when system instruction has no parts", () => {
    const payload: Record<string, unknown> = {
      systemInstruction: { role: "user" },
      contents: [],
    };
    appendClaudeThinkingHint(payload);
    const si = payload.systemInstruction as Record<string, unknown>;
    const parts = si.parts as Record<string, unknown>[];
    expect(parts[0].text).toBe(CLAUDE_INTERLEAVED_THINKING_HINT);
  });
});

// ---- normalizeClaudeTools ----

describe("normalizeClaudeTools", () => {
  it("returns zero for payload without tools", () => {
    const payload: Record<string, unknown> = {};
    const result = normalizeClaudeTools(payload);
    expect(result.toolDebugMissing).toBe(0);
    expect(result.toolDebugSummaries).toEqual([]);
  });

  it("converts function-style tools to functionDeclarations", () => {
    const payload: Record<string, unknown> = {
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get the weather",
            parameters: {
              type: "object",
              properties: {
                city: { type: "string", description: "City name" },
              },
              required: ["city"],
            },
          },
        },
      ],
    };
    const result = normalizeClaudeTools(payload);
    expect(result.toolDebugMissing).toBe(0);
    const tools = payload.tools as Record<string, unknown>[];
    const fd = (tools[0] as Record<string, unknown>).functionDeclarations as Record<string, unknown>[];
    expect(fd).toBeDefined();
    expect(fd[0].name).toBe("get_weather");
    expect(fd[0].description).toBe("Get the weather");
  });

  it("sanitizes tool names (removes special chars, max 64)", () => {
    const payload: Record<string, unknown> = {
      tools: [
        {
          type: "function",
          function: {
            name: "get weather!!!",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          },
        },
      ],
    };
    normalizeClaudeTools(payload);
    const tools = payload.tools as Record<string, unknown>[];
    const fd = (tools[0] as Record<string, unknown>).functionDeclarations as Record<string, unknown>[];
    expect(fd[0].name).toBe("get_weather___");
  });

  it("adds placeholder schema for tools without parameters", () => {
    const payload: Record<string, unknown> = {
      tools: [
        {
          type: "function",
          function: {
            name: "noop",
          },
        },
      ],
    };
    const result = normalizeClaudeTools(payload);
    expect(result.toolDebugMissing).toBe(1);
    const tools = payload.tools as Record<string, unknown>[];
    const fd = (tools[0] as Record<string, unknown>).functionDeclarations as Record<string, unknown>[];
    const params = fd[0].parameters as Record<string, unknown>;
    expect(params.properties).toBeDefined();
    expect(Object.keys(params.properties as Record<string, unknown>)).toContain("_placeholder");
  });

  it("adds placeholder for null parameter schema", () => {
    const payload: Record<string, unknown> = {
      tools: [
        {
          type: "function",
          function: {
            name: "noop",
            parameters: null,
          },
        },
      ],
    };
    const result = normalizeClaudeTools(payload);
    expect(result.toolDebugMissing).toBe(1);
  });

  it("preserves non-function passthrough tools", () => {
    const payload: Record<string, unknown> = {
      tools: [
        { codeExecution: {} },
        {
          type: "function",
          function: {
            name: "search",
            parameters: { type: "object", properties: { q: { type: "string" } } },
          },
        },
      ],
    };
    normalizeClaudeTools(payload);
    const tools = payload.tools as Record<string, unknown>[];
    expect(tools.length).toBe(2);
    expect(tools[1]).toEqual({ codeExecution: {} });
  });

  it("handles tools from custom format", () => {
    const payload: Record<string, unknown> = {
      tools: [
        {
          custom: {
            name: "my_tool",
            description: "A custom tool",
            parameters: { type: "object", properties: { x: { type: "number" } } },
          },
        },
      ],
    };
    normalizeClaudeTools(payload);
    const tools = payload.tools as Record<string, unknown>[];
    const fd = (tools[0] as Record<string, unknown>).functionDeclarations as Record<string, unknown>[];
    expect(fd[0].name).toBe("my_tool");
    expect(fd[0].description).toBe("A custom tool");
  });

  it("handles tools with input_schema format", () => {
    const payload: Record<string, unknown> = {
      tools: [
        {
          type: "function",
          function: {
            name: "get_data",
            input_schema: {
              type: "object",
              properties: { key: { type: "string" } },
            },
          },
        },
      ],
    };
    normalizeClaudeTools(payload);
    const tools = payload.tools as Record<string, unknown>[];
    const fd = (tools[0] as Record<string, unknown>).functionDeclarations as Record<string, unknown>[];
    const params = fd[0].parameters as Record<string, unknown>;
    expect(params.properties).toBeDefined();
  });

  it("handles already-normalized functionDeclarations", () => {
    const payload: Record<string, unknown> = {
      tools: [
        {
          functionDeclarations: [
            {
              name: "tool1",
              description: "First tool",
              parameters: { type: "object", properties: { a: { type: "number" } } },
            },
            {
              name: "tool2",
              description: "Second tool",
              parameters: { type: "object", properties: { b: { type: "string" } } },
            },
          ],
        },
      ],
    };
    normalizeClaudeTools(payload);
    const tools = payload.tools as Record<string, unknown>[];
    const fd = (tools[0] as Record<string, unknown>).functionDeclarations as Record<string, unknown>[];
    expect(fd.length).toBe(2);
    expect(fd[0].name).toBe("tool1");
    expect(fd[1].name).toBe("tool2");
  });
});

// ---- applyClaudeTransforms ----

describe("applyClaudeTransforms", () => {
  it("applies all transforms for thinking model with tools", () => {
    const payload: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          },
        },
      ],
      generationConfig: {},
    };

    const result = applyClaudeTransforms(payload, {
      model: "claude-opus-4-6-thinking",
      tierThinkingBudget: 16384,
      normalizedThinking: { includeThoughts: true },
    });

    // Tool config should be VALIDATED
    const tc = payload.toolConfig as Record<string, unknown>;
    expect(tc).toBeDefined();

    // Thinking config should be set
    const gc = payload.generationConfig as Record<string, unknown>;
    const thinkingConfig = gc.thinkingConfig as Record<string, unknown>;
    expect(thinkingConfig).toBeDefined();
    expect(thinkingConfig.include_thoughts).toBe(true);
    expect(thinkingConfig.thinking_budget).toBe(16384);

    // System instruction should have interleaved thinking hint
    const si = payload.systemInstruction as Record<string, unknown>;
    const parts = si.parts as Record<string, unknown>[];
    expect(parts[0].text).toContain("Interleaved thinking");

    // Tools should be normalized
    expect(result.toolDebugSummaries.length).toBeGreaterThan(0);
  });

  it("does not add interleaved hint for thinking models without tools", () => {
    const payload: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      generationConfig: {},
    };

    applyClaudeTransforms(payload, {
      model: "claude-opus-4-6-thinking",
      normalizedThinking: { includeThoughts: true, thinkingBudget: 8192 },
    });

    // Should not have system instruction (no tools, no interleaved hint needed)
    expect(payload.systemInstruction).toBeUndefined();
  });

  it("does not add thinking config for non-thinking models", () => {
    const payload: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
    };

    applyClaudeTransforms(payload, {
      model: "claude-sonnet-4-6",
      normalizedThinking: { includeThoughts: true, thinkingBudget: 8192 },
    });

    const gc = payload.generationConfig as Record<string, unknown> | undefined;
    // Should not have thinkingConfig for non-thinking model
    expect(gc?.thinkingConfig).toBeUndefined();
  });

  it("converts stop_sequences to stopSequences", () => {
    const payload: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      generationConfig: { stop_sequences: ["END"] },
    };

    applyClaudeTransforms(payload, {
      model: "claude-sonnet-4-6",
    });

    const gc = payload.generationConfig as Record<string, unknown>;
    expect(gc.stopSequences).toEqual(["END"]);
    expect(gc.stop_sequences).toBeUndefined();
  });
});
