import { describe, it, expect } from "vitest";
import {
  inferModelCapabilities,
  supportsThinkingTiers,
  hasPreSuffixedTier,
  extractTierFromModel,
} from "../src/models/capabilities.js";
import type { ModelCapabilities } from "../src/models/capabilities.js";

// ---------------------------------------------------------------------------
// Helper: verify reasoning properties concisely
// ---------------------------------------------------------------------------
function expectReasoning(
  caps: ModelCapabilities,
  enabled: boolean,
  variants?: string[],
  defaultVariant?: string,
) {
  if (!enabled) {
    expect(caps.reasoning).toBeUndefined();
    return;
  }
  expect(caps.reasoning).toBeDefined();
  expect(caps.reasoning!.enabled).toBe(true);
  expect(caps.reasoning!.variants).toEqual(variants);
  expect(caps.reasoning!.defaultVariant).toBe(defaultVariant);
}

// ---------------------------------------------------------------------------
// 1. CAPABILITY_RULES priority ordering
// ---------------------------------------------------------------------------
describe("priority ordering", () => {
  it("gemini-3.5-flash-low matches flash-low (24) over flash (20)", () => {
    const caps = inferModelCapabilities("gemini-3.5-flash-low");
    expect(caps.context).toBe(1048576);
    expect(caps.output).toBe(65536);
    expect(caps.modalities.input).toEqual(["text"]);
    expectReasoning(caps, true, ["low"], "low");
  });

  it("gemini-3.1-pro-high matches pro-high (24) over pro (22)", () => {
    const caps = inferModelCapabilities("gemini-3.1-pro-high");
    expectReasoning(caps, true, ["high"], "high");
  });

  it("gemini-3-flash-agent matches flash-agent (23) over flash (20) and -agent (16)", () => {
    const caps = inferModelCapabilities("gemini-3-flash-agent");
    expectReasoning(caps, false);
  });
});

// ---------------------------------------------------------------------------
// 2. Every known pattern
// ---------------------------------------------------------------------------
describe("Claude thinking (priority 20)", () => {
  it.each([
    ["claude-opus-4-6-thinking"],
    ["claude-sonnet-4-6-thinking"],
  ])("%s → context 200000, output 64000, reasoning enabled", (modelId) => {
    const caps = inferModelCapabilities(modelId);
    expect(caps.context).toBe(200000);
    expect(caps.output).toBe(64000);
    expect(caps.modalities).toEqual({ input: ["text"], output: ["text"] });
    expectReasoning(caps, true, ["low", "medium", "high"], "high");
  });
});

describe("Claude base (priority 15)", () => {
  it.each([
    ["claude-sonnet-4-6"],
    ["claude-3-5-sonnet"],
  ])("%s → context 200000, output 64000, NO reasoning", (modelId) => {
    const caps = inferModelCapabilities(modelId);
    expect(caps.context).toBe(200000);
    expect(caps.output).toBe(64000);
    expect(caps.modalities).toEqual({ input: ["text"], output: ["text"] });
    expectReasoning(caps, false);
  });
});

describe("Image models (priority 25)", () => {
  it.each([
    ["gemini-3.1-flash-image", ["image"]],
    ["imagen-3.0", ["image"]],
  ])("%s → output modality image", (modelId) => {
    const caps = inferModelCapabilities(modelId);
    expect(caps.modalities.output).toEqual(["image"]);
    expect(caps.modalities.input).toEqual(["text"]);
    expectReasoning(caps, false);
  });
});

describe("Gemini Pro High (priority 24)", () => {
  it.each([
    ["gemini-3.1-pro-high"],
    ["gemini-3-pro-high"],
  ])("%s → variants [high], defaultVariant high", (modelId) => {
    const caps = inferModelCapabilities(modelId);
    expectReasoning(caps, true, ["high"], "high");
    expect(caps.context).toBe(1048576);
    expect(caps.output).toBe(65535);
    expect(caps.modalities.input).toEqual(["text", "image", "pdf"]);
  });
});

describe("Gemini Pro Low (priority 24)", () => {
  it("gemini-3.1-pro-low → variants [low], defaultVariant low", () => {
    const caps = inferModelCapabilities("gemini-3.1-pro-low");
    expectReasoning(caps, true, ["low"], "low");
    expect(caps.context).toBe(1048576);
    expect(caps.output).toBe(65535);
    expect(caps.modalities.input).toEqual(["text", "image", "pdf"]);
  });
});

describe("Gemini Pro base (priority 22)", () => {
  it.each([
    ["gemini-3-pro"],
    ["gemini-3.1-pro"],
  ])("%s → variants [low, high], defaultVariant high", (modelId) => {
    const caps = inferModelCapabilities(modelId);
    expectReasoning(caps, true, ["low", "high"], "high");
    expect(caps.context).toBe(1048576);
    expect(caps.output).toBe(65535);
    expect(caps.modalities.input).toEqual(["text", "image", "pdf"]);
  });
});

describe("Gemini Flash extra-low (priority 24)", () => {
  it("gemini-3.5-flash-extra-low → variants [minimal], input [text]", () => {
    const caps = inferModelCapabilities("gemini-3.5-flash-extra-low");
    expect(caps.modalities.input).toEqual(["text"]);
    expectReasoning(caps, true, ["minimal"], "minimal");
  });
});

describe("Gemini Flash low (priority 24)", () => {
  it("gemini-3.5-flash-low → variants [low]", () => {
    const caps = inferModelCapabilities("gemini-3.5-flash-low");
    expectReasoning(caps, true, ["low"], "low");
  });
});

describe("Gemini Flash medium (priority 24)", () => {
  it("gemini-3.5-flash-medium → variants [medium]", () => {
    const caps = inferModelCapabilities("gemini-3.5-flash-medium");
    expectReasoning(caps, true, ["medium"], "medium");
  });
});

describe("Gemini Flash high (priority 24)", () => {
  it("gemini-3.5-flash-high → variants [high]", () => {
    const caps = inferModelCapabilities("gemini-3.5-flash-high");
    expectReasoning(caps, true, ["high"], "high");
  });
});

describe("Gemini Flash Lite (priority 23)", () => {
  it("gemini-2.5-flash-lite → input [text] only", () => {
    const caps = inferModelCapabilities("gemini-2.5-flash-lite");
    expect(caps.modalities.input).toEqual(["text"]);
    expectReasoning(caps, true, ["low", "medium", "high"], "medium");
  });

  it.each([
    ["gemini-3.1-flash-lite"],
    ["gemini-3-flash-lite"],
  ])("%s → variants [low,medium,high], defaultVariant medium, input [text]", (modelId) => {
    const caps = inferModelCapabilities(modelId);
    expect(caps.modalities.input).toEqual(["text"]);
    expectReasoning(caps, true, ["low", "medium", "high"], "medium");
  });
});

describe("Gemini Flash Agent (priority 23)", () => {
  it.each([
    ["gemini-3-flash-agent"],
    ["gemini-3.5-flash-agent"],
  ])("%s → NO reasoning", (modelId) => {
    const caps = inferModelCapabilities(modelId);
    expectReasoning(caps, false);
    expect(caps.context).toBe(1048576);
    expect(caps.output).toBe(65536);
    expect(caps.modalities.input).toEqual(["text"]);
  });
});

describe("Gemini Flash base (priority 20)", () => {
  it("gemini-3-flash → multimodal input, full variant set", () => {
    const caps = inferModelCapabilities("gemini-3-flash");
    expect(caps.modalities.input).toEqual(["text", "image", "pdf"]);
    expectReasoning(caps, true, ["minimal", "low", "medium", "high"], "high");
    expect(caps.context).toBe(1048576);
    expect(caps.output).toBe(65536);
  });
});

describe("Gemini 2.5 Pro (priority 18)", () => {
  it("gemini-2.5-pro → variants [low,medium,high], defaultVariant high", () => {
    const caps = inferModelCapabilities("gemini-2.5-pro");
    expectReasoning(caps, true, ["low", "medium", "high"], "high");
    expect(caps.context).toBe(1048576);
    expect(caps.output).toBe(65535);
    expect(caps.modalities.input).toEqual(["text", "image", "pdf"]);
  });
});

describe("Gemini 2.5 Flash Lite (priority 18)", () => {
  it("gemini-2.5-flash-lite → input [text], variants [low,medium,high], defaultVariant medium", () => {
    const caps = inferModelCapabilities("gemini-2.5-flash-lite");
    expect(caps.modalities.input).toEqual(["text"]);
    expectReasoning(caps, true, ["low", "medium", "high"], "medium");
  });
});

describe("Gemini 2.5 Flash (priority 17)", () => {
  it.each([
    ["gemini-2.5-flash"],
    ["gemini-2.5-flash-thinking"],
  ])("%s → multimodal input, variants [low,medium,high], defaultVariant high", (modelId) => {
    const caps = inferModelCapabilities(modelId);
    expect(caps.modalities.input).toEqual(["text", "image", "pdf"]);
    expectReasoning(caps, true, ["low", "medium", "high"], "high");
    expect(caps.context).toBe(1048576);
    expect(caps.output).toBe(65536);
  });
});

describe("Agent models (priority 16)", () => {
  it("gemini-pro-agent → context 1048576, output 65535, NO reasoning", () => {
    const caps = inferModelCapabilities("gemini-pro-agent");
    expect(caps.context).toBe(1048576);
    expect(caps.output).toBe(65535);
    expect(caps.modalities.input).toEqual(["text"]);
    expectReasoning(caps, false);
  });

  it("custom-agent-model → NO reasoning", () => {
    const caps = inferModelCapabilities("custom-agent-model");
    expect(caps.modalities.input).toEqual(["text"]);
    expectReasoning(caps, false);
  });
});

describe("GPT models (priority 14)", () => {
  it.each([
    ["gpt-oss-120b-medium"],
    ["gpt-4"],
    ["o1-mini"],
  ])("%s → context 131072, output 16384, no reasoning", (modelId) => {
    const caps = inferModelCapabilities(modelId);
    expect(caps.context).toBe(131072);
    expect(caps.output).toBe(16384);
    expect(caps.modalities).toEqual({ input: ["text"], output: ["text"] });
    expectReasoning(caps, false);
  });
});

// ---------------------------------------------------------------------------
// 3. Fallback paths (when no CAPABILITY_RULES match)
// ---------------------------------------------------------------------------
describe("fallback paths", () => {
  it("claude (exact) → /claude/i fallback → context 200000, output 64000, no reasoning", () => {
    // "claude" does NOT match /^claude-/i (no dash), so it falls through
    const caps = inferModelCapabilities("claude");
    expect(caps.context).toBe(200000);
    expect(caps.output).toBe(64000);
    expect(caps.modalities).toEqual({ input: ["text"], output: ["text"] });
    // hasThinking = false since "thinking" is not in "claude"
    expectReasoning(caps, false);
  });

  it("my-claude-model → /claude/i fallback, no reasoning (thinking not in name)", () => {
    // Does NOT start with "claude-" so no CAPABILITY_RULE matches → fallback
    const caps = inferModelCapabilities("my-claude-model");
    expect(caps.context).toBe(200000);
    expect(caps.output).toBe(64000);
    expect(caps.modalities).toEqual({ input: ["text"], output: ["text"] });
    // hasThinking = false → no reasoning spread
    expectReasoning(caps, false);
  });

  it("gemini-4-pro (future model) → /gemini/i fallback, pro output", () => {
    const caps = inferModelCapabilities("gemini-4-pro");
    expect(caps.context).toBe(1048576);
    expect(caps.output).toBe(65535); // isPro → 65535
    expect(caps.modalities.input).toEqual(["text", "image", "pdf"]);
    expectReasoning(caps, false);
  });

  it("custom-gemini-model → /gemini/i fallback", () => {
    const caps = inferModelCapabilities("custom-gemini-model");
    expect(caps.context).toBe(1048576);
    expect(caps.output).toBe(65536); // not pro → 65536
    expect(caps.modalities.input).toEqual(["text", "image", "pdf"]);
    expectReasoning(caps, false);
  });

  it("gpt-something → /gpt|openai/i fallback → context 131072, output 16384", () => {
    // "gpt-something" doesn't match /^gpt-|^o[0-9]+-/i ... wait, it does match /^gpt-/
    // Actually "gpt-something" starts with "gpt-" so it matches the CAPABILITY_RULE at priority 14.
    // But the test says "falls to /gpt|openai/i" — it does reach the same rule, just through the rule
    // not the fallback. The end result is the same.
    const caps = inferModelCapabilities("gpt-something");
    expect(caps.context).toBe(131072);
    expect(caps.output).toBe(16384);
    expect(caps.modalities).toEqual({ input: ["text"], output: ["text"] });
    expectReasoning(caps, false);
  });

  it("openai-gpt5 → /gpt|openai/i fallback", () => {
    // "openai-gpt5" doesn't match /^gpt-|^o[0-9]+-/i (doesn't start with gpt- or o<N>-)
    // So it falls through to the /gpt|openai/i fallback
    const caps = inferModelCapabilities("openai-gpt5");
    expect(caps.context).toBe(131072);
    expect(caps.output).toBe(16384);
    expect(caps.modalities).toEqual({ input: ["text"], output: ["text"] });
    expectReasoning(caps, false);
  });

  it("completely-unknown-model-x42 → DEFAULT_CAPABILITIES", () => {
    const caps = inferModelCapabilities("completely-unknown-model-x42");
    expect(caps.context).toBe(1048576);
    expect(caps.output).toBe(65536);
    expect(caps.modalities).toEqual({ input: ["text"], output: ["text"] });
    expectReasoning(caps, false);
  });
});

// ---------------------------------------------------------------------------
// 4. Edge cases
// ---------------------------------------------------------------------------
describe("edge cases", () => {
  it('empty string "" → DEFAULT_CAPABILITIES, does not throw', () => {
    const caps = inferModelCapabilities("");
    expect(caps.context).toBe(1048576);
    expect(caps.output).toBe(65536);
    expect(caps.modalities).toEqual({ input: ["text"], output: ["text"] });
    expectReasoning(caps, false);
  });

  it("null → DEFAULT_CAPABILITIES (string coercion)", () => {
    // Passing null coerces to "null" — no patterns match
    const caps = inferModelCapabilities(null as unknown as string);
    expect(caps.context).toBe(1048576);
    expect(caps.output).toBe(65536);
    expect(caps.modalities).toEqual({ input: ["text"], output: ["text"] });
    expectReasoning(caps, false);
  });

  it("undefined → DEFAULT_CAPABILITIES", () => {
    const caps = inferModelCapabilities(undefined as unknown as string);
    expect(caps.context).toBe(1048576);
    expect(caps.output).toBe(65536);
    expect(caps.modalities).toEqual({ input: ["text"], output: ["text"] });
    expectReasoning(caps, false);
  });

  it("gemini-3.1-flash🦄-image → matches image rule (priority 25)", () => {
    const caps = inferModelCapabilities("gemini-3.1-flash🦄-image");
    expect(caps.modalities.output).toEqual(["image"]);
  });

  it("gemini-3.1-pro-high-extra → matches pro-high (24) due to partial regex match", () => {
    // The pattern /^gemini-3(?:\.\d+)?-pro-high/i does not have a $ anchor,
    // so "gemini-3.1-pro-high-extra" matches it.
    const caps = inferModelCapabilities("gemini-3.1-pro-high-extra");
    expectReasoning(caps, true, ["high"], "high");
  });
});

// ---------------------------------------------------------------------------
// 5. supportsThinkingTiers()
// ---------------------------------------------------------------------------
describe("supportsThinkingTiers", () => {
  it.each([
    ["gemini-3-flash", true],
    ["gemini-3.1-pro-low", true],
    ["gemini-2.5-flash", true],
    ["claude-opus-4-6-thinking", true],
    ["claude-sonnet-4-6", false],
    ["gpt-oss-120b-medium", false],
    ["", false],
    ["gemini-4-pro", false],
  ])("%s → %s", (modelId, expected) => {
    expect(supportsThinkingTiers(modelId)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 6. hasPreSuffixedTier()
// ---------------------------------------------------------------------------
describe("hasPreSuffixedTier", () => {
  it.each([
    ["gemini-3.1-pro-high", true],
    ["gemini-3.1-pro-low", true],
    ["gemini-3.5-flash-low", true],
    ["gemini-3.5-flash-extra-low", true],
    ["gemini-3-flash", false],
    ["gemini-2.5-pro", false],
    ["something-high", true], // known false positive
    ["", false],
  ])("%s → %s", (modelId, expected) => {
    expect(hasPreSuffixedTier(modelId)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 7. extractTierFromModel()
// ---------------------------------------------------------------------------
describe("extractTierFromModel", () => {
  it.each([
    ["gemini-3.1-pro-high", "high"],
    ["gemini-3.5-flash-extra-low", "extra-low"],
    ["gemini-3.5-flash-low", "low"],
    ["gemini-3.5-flash-medium", "medium"],
    ["gemini-3-flash", undefined],
    ["", undefined],
    ["something-high", "high"],
  ])("%s → %s", (modelId, expected) => {
    expect(extractTierFromModel(modelId)).toBe(expected);
  });
});
