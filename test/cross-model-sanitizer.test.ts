/**
 * Tests for the cross-model-sanitizer module.
 *
 * Covers: sanitizeCrossModelPayload, deepSanitizeCrossModelMetadata,
 * stripGeminiThinkingMetadata, stripClaudeThinkingFields, getTargetFamily.
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeCrossModelPayload,
  deepSanitizeCrossModelMetadata,
  stripGeminiThinkingMetadata,
  stripClaudeThinkingFields,
  getTargetFamily,
} from "../src/transform/cross-model-sanitizer.js";

// ============================================================
// 1. getTargetFamily
// ============================================================

describe("getTargetFamily", () => {
  it('returns "claude" for Claude models', () => {
    expect(getTargetFamily("claude-sonnet-4-6")).toBe("claude");
    expect(getTargetFamily("claude-opus-4-6-thinking")).toBe("claude");
    expect(getTargetFamily("CLAUDE-3-opus")).toBe("claude");
  });

  it('returns "gemini" for Gemini models', () => {
    expect(getTargetFamily("gemini-2.5-flash")).toBe("gemini");
    expect(getTargetFamily("gemini-3-pro")).toBe("gemini");
    expect(getTargetFamily("GEMINI-3-flash")).toBe("gemini");
  });

  it('returns "unknown" for unrecognized models', () => {
    expect(getTargetFamily("unknown-model")).toBe("unknown");
    expect(getTargetFamily("gpt-4")).toBe("unknown");
    expect(getTargetFamily("")).toBe("unknown");
  });
});

// ============================================================
// 2. stripGeminiThinkingMetadata (Gemini -> Claude)
// ============================================================

describe("stripGeminiThinkingMetadata", () => {
  it("removes thoughtSignature and thinkingMetadata at top level", () => {
    const part = {
      text: "Hello",
      thoughtSignature: "abc123",
      thinkingMetadata: { some: "data" },
    };
    const result = stripGeminiThinkingMetadata(part);
    expect(result.part).not.toHaveProperty("thoughtSignature");
    expect(result.part).not.toHaveProperty("thinkingMetadata");
    expect(result.part).toHaveProperty("text", "Hello");
    expect(result.stripped).toBe(2);
  });

  it("removes thoughtSignature and thinkingMetadata inside metadata.google", () => {
    const part = {
      text: "Hello",
      metadata: {
        google: {
          thoughtSignature: "sig123",
          thinkingMetadata: { tokens: 42 },
          someOtherField: "keep-me",
        },
      },
    };
    const result = stripGeminiThinkingMetadata(part);
    const google = (result.part.metadata as Record<string, unknown>)
      ?.google as Record<string, unknown>;
    expect(google).not.toHaveProperty("thoughtSignature");
    expect(google).not.toHaveProperty("thinkingMetadata");
    expect(google).toHaveProperty("someOtherField", "keep-me");
    expect(result.stripped).toBe(2);
  });

  it("removes metadata.google entirely when only signature fields exist and preserveNonSignature is true", () => {
    const part = {
      text: "Hello",
      metadata: {
        google: {
          thoughtSignature: "sig123",
          thinkingMetadata: { tokens: 42 },
        },
      },
    };
    const result = stripGeminiThinkingMetadata(part, true);
    const metadata = result.part.metadata as Record<string, unknown> | undefined;
    // google is removed because after stripping sig fields, google is empty
    // and Object.keys(google).length === 0 triggers metadata.google deletion
    expect(metadata).toBeUndefined();
    expect(result.stripped).toBe(2);
  });

  it("removes metadata entirely when only google (now empty) existed", () => {
    const part = {
      text: "Hello",
      metadata: {
        google: {
          thoughtSignature: "sig123",
        },
      },
    };
    const result = stripGeminiThinkingMetadata(part, true);
    expect(result.part).not.toHaveProperty("metadata");
    expect(result.stripped).toBe(1);
  });

  it("preserves non-signature fields when preserveNonSignature is true", () => {
    const part = {
      text: "Hello",
      metadata: {
        google: {
          thoughtSignature: "sig123",
          modelId: "gemini-3-pro",
          safetyRating: "safe",
        },
      },
    };
    const result = stripGeminiThinkingMetadata(part, true);
    const google = (result.part.metadata as Record<string, unknown>)
      ?.google as Record<string, unknown>;
    expect(google).not.toHaveProperty("thoughtSignature");
    expect(google).toHaveProperty("modelId", "gemini-3-pro");
    expect(google).toHaveProperty("safetyRating", "safe");
    expect(result.stripped).toBe(1);
  });

  it("strips all metadata.google fields when preserveNonSignature is false", () => {
    const part = {
      text: "Hello",
      metadata: {
        google: {
          thoughtSignature: "sig123",
          modelId: "gemini-3-pro",
        },
      },
    };
    const result = stripGeminiThinkingMetadata(part, false);
    const metadata = result.part.metadata as Record<string, unknown> | undefined;
    // preserveNonSignature=false, and Object.keys(google).length > 0 after stripping
    // but we still delete signature fields only; non-signature fields stay
    // Actually: preserveNonSignature only controls whether we delete google when it has non-signature fields
    // Looking at code more carefully:
    // if (!preserveNonSignature || Object.keys(google).length === 0) { delete metadata.google; }
    // So with preserveNonSignature=false, we always delete metadata.google
    const google = (result.part.metadata as Record<string, unknown>)
      ?.google as Record<string, unknown> | undefined;
    expect(google).toBeUndefined();
    expect(result.stripped).toBe(1);
  });

  it("does nothing when no signature fields are present", () => {
    const part = {
      text: "Hello",
      role: "user",
    };
    const result = stripGeminiThinkingMetadata(part);
    expect(result.part).toEqual(part);
    expect(result.stripped).toBe(0);
  });

  it("handles part with metadata but no google sub-object", () => {
    const part = {
      text: "Hello",
      metadata: {
        something: "else",
      },
    };
    const result = stripGeminiThinkingMetadata(part);
    expect(result.part).toEqual(part);
    expect(result.stripped).toBe(0);
  });

  it("handles empty metadata.google", () => {
    const part = {
      text: "Hello",
      metadata: {
        google: {},
      },
    };
    const result = stripGeminiThinkingMetadata(part);
    expect(result.part).toEqual(part);
    expect(result.stripped).toBe(0);
  });
});

// ============================================================
// 3. stripClaudeThinkingFields (Claude -> Gemini)
// ============================================================

describe("stripClaudeThinkingFields", () => {
  it("removes signature from thinking-type parts", () => {
    const part = {
      type: "thinking",
      text: "Let me think...",
      signature: "some-signature-value",
    };
    const result = stripClaudeThinkingFields(part);
    expect(result.part).not.toHaveProperty("signature");
    expect(result.part).toHaveProperty("type", "thinking");
    expect(result.part).toHaveProperty("text", "Let me think...");
    expect(result.stripped).toBe(1);
  });

  it("removes signature from redacted_thinking parts", () => {
    const part = {
      type: "redacted_thinking",
      signature: "redacted-sig",
    };
    const result = stripClaudeThinkingFields(part);
    expect(result.part).not.toHaveProperty("signature");
    expect(result.stripped).toBe(1);
  });

  it("strips signature string >= 50 chars even without type", () => {
    const part = {
      text: "some text",
      signature: "a".repeat(50),
    };
    const result = stripClaudeThinkingFields(part);
    expect(result.part).not.toHaveProperty("signature");
    expect(result.stripped).toBe(1);
  });

  it("strips signature string >= 50 chars with type=thinking", () => {
    const part = {
      type: "thinking",
      signature: "a".repeat(60),
    };
    const result = stripClaudeThinkingFields(part);
    expect(result.part).not.toHaveProperty("signature");
    expect(result.stripped).toBe(1);
  });

  it("does NOT strip signature string < 50 chars without thinking type", () => {
    const part = {
      text: "some text",
      signature: "short", // length 5
    };
    const result = stripClaudeThinkingFields(part);
    expect(result.part).toHaveProperty("signature", "short");
    expect(result.stripped).toBe(0);
  });

  it("does not strip non-signature fields", () => {
    const part = {
      type: "thinking",
      text: "Let me think...",
      thinking: "some data",
    };
    const result = stripClaudeThinkingFields(part);
    expect(result.part).toHaveProperty("type", "thinking");
    expect(result.part).toHaveProperty("text", "Let me think...");
    expect(result.part).toHaveProperty("thinking", "some data");
    expect(result.stripped).toBe(0);
  });

  it("does nothing when no matching fields are present", () => {
    const part = {
      type: "text",
      text: "Hello",
    };
    const result = stripClaudeThinkingFields(part);
    expect(result.part).toEqual(part);
    expect(result.stripped).toBe(0);
  });
});

// ============================================================
// 4. deepSanitizeCrossModelMetadata
// ============================================================

describe("deepSanitizeCrossModelMetadata", () => {
  describe("with targetFamily=claude (strips Gemini fields)", () => {
    it("sanitizes contents array", () => {
      const obj = {
        contents: [
          {
            parts: [
              {
                text: "Hello",
                metadata: {
                  google: {
                    thoughtSignature: "sig123",
                  },
                },
              },
            ],
          },
        ],
      };
      const result = deepSanitizeCrossModelMetadata(obj, "claude");
      const contents = result.obj as Record<string, unknown[]>;
      const parts = (contents.contents[0] as Record<string, unknown>)
        .parts as Record<string, unknown>[];
      const metadata = parts[0].metadata as Record<string, unknown> | undefined;
      expect(metadata).toBeUndefined();
      expect(result.stripped).toBe(1);
    });

    it("sanitizes messages array (content parts)", () => {
      const obj = {
        messages: [
          {
            role: "user",
            content: [
              {
                text: "Hello",
                metadata: {
                  google: {
                    thoughtSignature: "sig456",
                  },
                },
              },
            ],
          },
        ],
      };
      const result = deepSanitizeCrossModelMetadata(obj, "claude");
      const resultObj = result.obj as Record<string, unknown>;
      const messages = resultObj.messages as Record<string, unknown>[];
      const content = messages[0].content as Record<string, unknown>[];
      const metadata = content[0].metadata as Record<string, unknown> | undefined;
      expect(metadata).toBeUndefined();
      expect(result.stripped).toBe(1);
    });

    it("sanitizes extra_body.messages array", () => {
      const obj = {
        extra_body: {
          messages: [
            {
              role: "user",
              content: [
                {
                  text: "Hello",
                  thoughtSignature: "abc",
                },
              ],
            },
          ],
        },
      };
      const result = deepSanitizeCrossModelMetadata(obj, "claude");
      const resultObj = result.obj as Record<string, unknown>;
      const extraBody = resultObj.extra_body as Record<string, unknown>;
      const messages = extraBody.messages as Record<string, unknown>[];
      const content = messages[0].content as Record<string, unknown>[];
      expect(content[0]).not.toHaveProperty("thoughtSignature");
      expect(result.stripped).toBe(1);
    });
  });

  describe("with targetFamily=gemini (strips Claude fields)", () => {
    it("sanitizes contents array", () => {
      const obj = {
        contents: [
          {
            parts: [
              {
                type: "thinking",
                text: "Let me think...",
                signature: "claude-sig",
              },
            ],
          },
        ],
      };
      const result = deepSanitizeCrossModelMetadata(obj, "gemini");
      const contents = result.obj as Record<string, unknown[]>;
      const parts = (contents.contents[0] as Record<string, unknown>)
        .parts as Record<string, unknown>[];
      expect(parts[0]).not.toHaveProperty("signature");
      expect(parts[0]).toHaveProperty("type", "thinking");
      expect(result.stripped).toBe(1);
    });

    it("sanitizes messages array (content parts)", () => {
      const obj = {
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                signature: "claude-sig-here",
                text: "Thinking...",
              },
            ],
          },
        ],
      };
      const result = deepSanitizeCrossModelMetadata(obj, "gemini");
      const resultObj = result.obj as Record<string, unknown>;
      const messages = resultObj.messages as Record<string, unknown>[];
      const content = messages[0].content as Record<string, unknown>[];
      expect(content[0]).not.toHaveProperty("signature");
      expect(result.stripped).toBe(1);
    });

    it("sanitizes extra_body.messages array", () => {
      const obj = {
        extra_body: {
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "redacted_thinking",
                  signature: "redacted-sig",
                },
              ],
            },
          ],
        },
      };
      const result = deepSanitizeCrossModelMetadata(obj, "gemini");
      const resultObj = result.obj as Record<string, unknown>;
      const extraBody = resultObj.extra_body as Record<string, unknown>;
      const messages = extraBody.messages as Record<string, unknown>[];
      const content = messages[0].content as Record<string, unknown>[];
      expect(content[0]).not.toHaveProperty("signature");
      expect(result.stripped).toBe(1);
    });
  });

  it("returns obj unchanged with stripped=0 when targetFamily is unknown", () => {
    const obj = {
      messages: [
        {
          content: [{ type: "thinking", signature: "sig" }],
        },
      ],
    };
    const result = deepSanitizeCrossModelMetadata(obj, "unknown");
    expect(result.obj).toEqual(obj);
    expect(result.stripped).toBe(0);
  });
});

// ============================================================
// 5. sanitizeCrossModelPayload (main entry)
// ============================================================

describe("sanitizeCrossModelPayload", () => {
  it("strips Gemini metadata when targeting Claude", () => {
    const payload = {
      model: "claude-sonnet-4-6",
      messages: [
        {
          role: "user",
          content: [
            {
              text: "Hello",
              metadata: {
                google: {
                  thoughtSignature: "gemini-sig",
                },
              },
            },
          ],
        },
      ],
    };
    const result = sanitizeCrossModelPayload(payload, {
      targetModel: "claude-sonnet-4-6",
    });
    const messages = (result.payload as Record<string, unknown>)
      .messages as Record<string, unknown>[];
    const content = messages[0].content as Record<string, unknown>[];
    expect(content[0]).not.toHaveProperty("metadata");
    expect(result.modified).toBe(true);
    expect(result.signaturesStripped).toBe(1);
  });

  it("strips Claude signature when targeting Gemini", () => {
    const payload = {
      model: "gemini-2.5-flash",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              signature: "claude-sig-long-enough-to-trigger-removal",
              text: "Let me think about this...",
            },
          ],
        },
      ],
    };
    const result = sanitizeCrossModelPayload(payload, {
      targetModel: "gemini-2.5-flash",
    });
    const messages = (result.payload as Record<string, unknown>)
      .messages as Record<string, unknown>[];
    const content = messages[0].content as Record<string, unknown>[];
    expect(content[0]).not.toHaveProperty("signature");
    expect(result.modified).toBe(true);
    expect(result.signaturesStripped).toBe(1);
  });

  it("preserves non-message fields in the payload", () => {
    const payload = {
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      temperature: 0.7,
      messages: [
        {
          role: "user",
          content: [
            {
              text: "Hello",
              thoughtSignature: "abc",
            },
          ],
        },
      ],
    };
    const result = sanitizeCrossModelPayload(payload, {
      targetModel: "claude-sonnet-4-6",
    });
    const resultObj = result.payload as Record<string, unknown>;
    expect(resultObj).toHaveProperty("model", "claude-sonnet-4-6");
    expect(resultObj).toHaveProperty("max_tokens", 4096);
    expect(resultObj).toHaveProperty("temperature", 0.7);
    expect(result.modified).toBe(true);
  });

  it("returns modified=false when targetFamily is unknown", () => {
    const payload = { messages: [{ content: [{ signature: "abc" }] }] };
    const result = sanitizeCrossModelPayload(payload, {
      targetModel: "gpt-4",
    });
    expect(result.modified).toBe(false);
    expect(result.signaturesStripped).toBe(0);
    expect(result.payload).toBe(payload);
  });

  it("preserves preserveNonSignatureMetadata option", () => {
    const payload = {
      extra_body: {
        messages: [
          {
            role: "user",
            content: [
              {
                text: "Hello",
                metadata: {
                  google: {
                    thoughtSignature: "sig",
                    modelId: "gemini-pro",
                  },
                },
              },
            ],
          },
        ],
      },
    };
    // With preserveNonSignatureMetadata: false, google is always removed
    const result = sanitizeCrossModelPayload(payload, {
      targetModel: "claude-sonnet-4-6",
      preserveNonSignatureMetadata: false,
    });
    const resultObj = result.payload as Record<string, unknown>;
    const extraBody = resultObj.extra_body as Record<string, unknown>;
    const messages = extraBody.messages as Record<string, unknown>[];
    const content = messages[0].content as Record<string, unknown>[];
    expect(content[0]).not.toHaveProperty("metadata");
    expect(result.modified).toBe(true);
  });

  it("does not mutate the original payload", () => {
    const payload = {
      messages: [
        {
          role: "user",
          content: [
            {
              text: "Hello",
              thoughtSignature: "sig",
            },
          ],
        },
      ],
    };
    const original = JSON.parse(JSON.stringify(payload));
    sanitizeCrossModelPayload(payload, { targetModel: "claude-sonnet-4-6" });
    expect(payload).toEqual(original);
  });

  it("handles extra_body containing messages with Gemini metadata", () => {
    const payload = {
      extra_body: {
        messages: [
          {
            role: "user",
            content: [
              {
                text: "Hello",
                metadata: {
                  google: {
                    thoughtSignature: "abc123",
                  },
                },
              },
            ],
          },
        ],
      },
    };
    const result = sanitizeCrossModelPayload(payload, {
      targetModel: "claude-sonnet-4-6",
    });
    const resultObj = result.payload as Record<string, unknown>;
    const extraBody = resultObj.extra_body as Record<string, unknown>;
    const messages = extraBody.messages as Record<string, unknown>[];
    const content = messages[0].content as Record<string, unknown>[];
    const metadata = content[0].metadata as Record<string, unknown> | undefined;
    expect(metadata).toBeUndefined();
    expect(result.signaturesStripped).toBe(1);
  });
});

// ============================================================
// 6. Edge cases
// ============================================================

describe("edge cases", () => {
  describe("empty / null / undefined / non-object inputs", () => {
    it("deepSanitizeCrossModelMetadata handles empty object", () => {
      const result = deepSanitizeCrossModelMetadata({}, "claude");
      expect(result.obj).toEqual({});
      expect(result.stripped).toBe(0);
    });

    it("deepSanitizeCrossModelMetadata returns null as-is", () => {
      const result = deepSanitizeCrossModelMetadata(null, "claude");
      expect(result.obj).toBeNull();
      expect(result.stripped).toBe(0);
    });

    it("deepSanitizeCrossModelMetadata returns undefined as-is", () => {
      const result = deepSanitizeCrossModelMetadata(undefined, "claude");
      expect(result.obj).toBeUndefined();
      expect(result.stripped).toBe(0);
    });

    it("deepSanitizeCrossModelMetadata returns string as-is", () => {
      const result = deepSanitizeCrossModelMetadata("hello", "claude");
      expect(result.obj).toBe("hello");
      expect(result.stripped).toBe(0);
    });

    it("deepSanitizeCrossModelMetadata returns number as-is", () => {
      const result = deepSanitizeCrossModelMetadata(42, "claude");
      expect(result.obj).toBe(42);
      expect(result.stripped).toBe(0);
    });

    it("deepSanitizeCrossModelMetadata returns array as-is", () => {
      const result = deepSanitizeCrossModelMetadata([1, 2, 3], "claude");
      expect(result.obj).toEqual([1, 2, 3]);
      expect(result.stripped).toBe(0);
    });
  });

  describe("payload with no matching metadata", () => {
    it("returns payload unchanged when no signature fields exist", () => {
      const payload = {
        model: "claude-sonnet-4-6",
        messages: [
          {
            role: "user",
            content: [{ text: "Hello", type: "text" }],
          },
        ],
      };
      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "claude-sonnet-4-6",
      });
      expect(result.payload).toEqual(payload);
      expect(result.modified).toBe(false);
      expect(result.signaturesStripped).toBe(0);
    });
  });

  describe("nested metadata at depth", () => {
    it("strips Gemini fields from deeply nested messages", () => {
      const payload = {
        messages: [
          {
            role: "user",
            content: [
              {
                text: "Hello",
                metadata: {
                  google: {
                    thoughtSignature: "deep-sig",
                  },
                },
              },
              {
                text: "World",
                metadata: {
                  google: {
                    thinkingMetadata: { tokens: 100 },
                  },
                },
              },
            ],
          },
        ],
      };
      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "claude-sonnet-4-6",
      });
      const messages = (result.payload as Record<string, unknown>)
        .messages as Record<string, unknown>[];
      const content = messages[0].content as Record<string, unknown>[];
      expect(content[0].metadata).toBeUndefined();
      expect(content[1].metadata).toBeUndefined();
      expect(result.signaturesStripped).toBe(2);
    });

    it("strips Claude fields from deeply nested messages", () => {
      const payload = {
        messages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", signature: "sig1", text: "..." },
              { type: "thinking", signature: "sig2", text: "..." },
            ],
          },
        ],
      };
      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "gemini-2.5-flash",
      });
      const messages = (result.payload as Record<string, unknown>)
        .messages as Record<string, unknown>[];
      const content = messages[0].content as Record<string, unknown>[];
      expect(content[0]).not.toHaveProperty("signature");
      expect(content[1]).not.toHaveProperty("signature");
      expect(result.signaturesStripped).toBe(2);
    });
  });

  describe("array of messages with mixed content", () => {
    it("sanitizes mixed content types (text, thinking, Gemini parts)", () => {
      const payload = {
        messages: [
          {
            role: "user",
            content: [{ text: "Hello", type: "text" }],
          },
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                signature: "claude-signature",
                text: "I need to think...",
              },
              {
                type: "text",
                text: "Here is my answer.",
              },
            ],
          },
        ],
      };
      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "gemini-2.5-flash",
      });
      const messages = (result.payload as Record<string, unknown>)
        .messages as Record<string, unknown>[];
      const assistantContent = messages[1].content as Record<string, unknown>[];
      expect(assistantContent[0]).not.toHaveProperty("signature");
      expect(assistantContent[0]).toHaveProperty("type", "thinking");
      expect(assistantContent[1]).toHaveProperty("text", "Here is my answer.");
      expect(result.modified).toBe(true);
      expect(result.signaturesStripped).toBe(1);
    });

    it("handles messages where content is not an array", () => {
      const payload = {
        messages: [
          {
            role: "user",
            content: "Just a string, not an array",
          },
        ],
      };
      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "claude-sonnet-4-6",
      });
      expect(result.modified).toBe(false);
      expect(result.signaturesStripped).toBe(0);
    });

    it("handles messages with null content", () => {
      const payload = {
        messages: [
          {
            role: "user",
            content: null,
          },
        ],
      };
      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "claude-sonnet-4-6",
      });
      expect(result.modified).toBe(false);
      expect(result.signaturesStripped).toBe(0);
    });
  });

  describe("contents array edge cases", () => {
    it("sanitizes contents with mixed Gemini parts", () => {
      const obj = {
        contents: [
          {
            parts: [
              { text: "Hello" },
              {
                text: "Thinking...",
                metadata: {
                  google: {
                    thoughtSignature: "sig",
                    thinkingMetadata: { tokens: 50 },
                  },
                },
              },
            ],
          },
        ],
      };
      const result = deepSanitizeCrossModelMetadata(obj, "claude");
      const contents = result.obj as Record<string, unknown[]>;
      const parts = (contents.contents[0] as Record<string, unknown>)
        .parts as Record<string, unknown>[];
      expect(parts[0]).toEqual({ text: "Hello" });
      expect(parts[1]).not.toHaveProperty("metadata");
      expect(result.stripped).toBe(2);
    });

    it("handles contents where parts is not an array", () => {
      const obj = {
        contents: [
          {
            parts: "not-an-array",
          },
        ],
      };
      const result = deepSanitizeCrossModelMetadata(obj, "claude");
      const contents = result.obj as Record<string, unknown[]>;
      expect(contents.contents[0]).toHaveProperty("parts", "not-an-array");
      expect(result.stripped).toBe(0);
    });

    it("handles contents entries that are not plain objects", () => {
      const obj = {
        contents: [null, "string", 42],
      };
      const result = deepSanitizeCrossModelMetadata(obj, "claude");
      const contents = result.obj as Record<string, unknown[]>;
      expect(contents.contents).toEqual([null, "string", 42]);
      expect(result.stripped).toBe(0);
    });
  });

  describe("extra_body edge cases", () => {
    it("handles extra_body that is not a plain object", () => {
      const payload = {
        extra_body: "string-extra-body",
      };
      const result = deepSanitizeCrossModelMetadata(payload, "claude");
      expect(result.obj).toEqual({ extra_body: "string-extra-body" });
      expect(result.stripped).toBe(0);
    });

    it("handles extra_body with messages that is not an array", () => {
      const payload = {
        extra_body: {
          messages: "not-array",
        },
      };
      const result = deepSanitizeCrossModelMetadata(payload, "claude");
      const obj = result.obj as Record<string, unknown>;
      const extraBody = obj.extra_body as Record<string, unknown>;
      expect(extraBody.messages).toBe("not-array");
      expect(result.stripped).toBe(0);
    });

    it("handles extra_body with empty messages array", () => {
      const payload = {
        extra_body: {
          messages: [],
        },
      };
      const result = deepSanitizeCrossModelMetadata(payload, "claude");
      const obj = result.obj as Record<string, unknown>;
      const extraBody = obj.extra_body as Record<string, unknown>;
      expect(extraBody.messages).toEqual([]);
      expect(result.stripped).toBe(0);
    });
  });

  describe("sanitizeCrossModelPayload with unknown target model", () => {
    it("returns payload unmodified for unknown targetFamily", () => {
      const payload = { test: "data" };
      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "some-unknown-model",
      });
      expect(result.payload).toBe(payload);
      expect(result.modified).toBe(false);
      expect(result.signaturesStripped).toBe(0);
    });
  });

  describe("very deeply nested structures", () => {
    it("handles nested metadata.google.thoughtSignature three levels deep in contents", () => {
      const payload = {
        contents: [
          {
            parts: [
              {
                text: "deep",
                metadata: {
                  google: {
                    thoughtSignature: "very-deep",
                  },
                  otherScope: {
                    thoughtSignature: "should-not-strip",
                  },
                },
              },
            ],
          },
        ],
      };
      const result = deepSanitizeCrossModelMetadata(payload, "claude");
      const obj = result.obj as Record<string, unknown[]>;
      const parts = (obj.contents[0] as Record<string, unknown>)
        .parts as Record<string, unknown>[];
      const part = parts[0] as Record<string, unknown>;
      const metadata = part.metadata as Record<string, unknown>;
      // google is removed since it only had thoughtSignature
      expect(metadata).not.toHaveProperty("google");
      // otherScope should still exist
      expect(metadata.otherScope).toBeDefined();
      expect(result.stripped).toBe(1);
    });
  });

  describe("stripGeminiThinkingMetadata with non-object metadata branches", () => {
    it("handles metadata.google that is not a plain object", () => {
      const part = {
        text: "test",
        metadata: {
          google: "string-not-object",
        },
      };
      const result = stripGeminiThinkingMetadata(part);
      expect(result.part).toEqual(part);
      expect(result.stripped).toBe(0);
    });

    it("handles metadata that is not a plain object", () => {
      const part = {
        text: "test",
        metadata: "string",
      };
      const result = stripGeminiThinkingMetadata(part);
      expect(result.part).toEqual(part);
      expect(result.stripped).toBe(0);
    });
  });

  describe("stripClaudeThinkingFields edge cases", () => {
    it("strips signature when it is exactly 50 characters long", () => {
      const part = {
        signature: "x".repeat(50),
      };
      const result = stripClaudeThinkingFields(part);
      expect(result.part).not.toHaveProperty("signature");
      expect(result.stripped).toBe(1);
    });

    it("does not strip signature when it is 49 characters long and type is not thinking", () => {
      const part = {
        signature: "x".repeat(49),
      };
      const result = stripClaudeThinkingFields(part);
      expect(result.part).toHaveProperty("signature");
      expect(result.stripped).toBe(0);
    });

    it("handles empty object", () => {
      const result = stripClaudeThinkingFields({});
      expect(result.part).toEqual({});
      expect(result.stripped).toBe(0);
    });

    it("handles signature that is not a string", () => {
      const part = {
        type: "thinking",
        signature: 12345,
      };
      const result = stripClaudeThinkingFields(part);
      // type === "thinking" hits the first loop which uses CLAUDE_SIGNATURE_FIELDS = ["signature"]
      // "signature" in part is true, so it deletes it and increments stripped
      expect(result.part).not.toHaveProperty("signature");
      expect(result.stripped).toBe(1);
    });
  });

  describe("deepSanitizeCrossModelMetadata with targetFamily unknown", () => {
    it("does not strip anything for unknown family", () => {
      const obj = {
        messages: [
          {
            content: [
              { type: "thinking", signature: "claude-sig" },
              { metadata: { google: { thoughtSignature: "gemini-sig" } } },
            ],
          },
        ],
      };
      const result = deepSanitizeCrossModelMetadata(obj, "unknown");
      expect(result.obj).toEqual(obj);
      expect(result.stripped).toBe(0);
    });
  });

  describe("multiple messages with mixed models", () => {
    it("strips Gemini metadata from all messages when targeting Claude", () => {
      const payload = {
        messages: [
          {
            role: "user",
            content: [
              {
                text: "First",
                thoughtSignature: "sig1",
              },
            ],
          },
          {
            role: "assistant",
            content: [
              {
                text: "Second",
                metadata: {
                  google: {
                    thinkingMetadata: { tokens: 10 },
                  },
                },
              },
            ],
          },
        ],
      };
      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "claude-sonnet-4-6",
      });
      expect(result.signaturesStripped).toBe(2);
      expect(result.modified).toBe(true);
    });

    it("strips Claude signatures from all messages when targeting Gemini", () => {
      const payload = {
        messages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", signature: "sig-a", text: "..." },
            ],
          },
          {
            role: "assistant",
            content: [
              { type: "thinking", signature: "sig-b", text: "..." },
            ],
          },
        ],
      };
      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "gemini-2.5-flash",
      });
      expect(result.signaturesStripped).toBe(2);
      expect(result.modified).toBe(true);
    });
  });
});
