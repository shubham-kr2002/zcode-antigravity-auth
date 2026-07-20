/**
 * Tests for Antigravity → OpenAI response transformation.
 */
import { describe, it, expect } from "vitest";
import {
  transformSSELine,
  transformNonStreamResponse,
} from "../src/transform/response.js";

describe("transformSSELine", () => {
  it("returns null for empty/non-data lines", () => {
    expect(transformSSELine("")).toBeNull();
    expect(transformSSELine("event: ping")).toBeNull();
    expect(transformSSELine(":comment")).toBeNull();
  });

  it("returns [DONE] for [DONE] data", () => {
    const result = transformSSELine("data: [DONE]");
    expect(result).toBe("data: [DONE]\n\n");
  });

  it("transforms simple text content", () => {
    const line = JSON.stringify({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "Hello from Antigravity!" }],
          },
        },
      ],
    });
    const result = transformSSELine(`data: ${line}`);
    expect(result).not.toBeNull();
    // Should be an OpenAI chunk with delta.content
    const parsed = JSON.parse(result!.replace("data: ", "").trim());
    expect(parsed.choices[0].delta.content).toBe("Hello from Antigravity!");
    expect(parsed.object).toBe("chat.completion.chunk");
  });

  it("transforms thinking/reasoning content", () => {
    const line = JSON.stringify({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ thought: true, text: "Let me think about this..." }],
          },
        },
      ],
    });
    const result = transformSSELine(`data: ${line}`);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!.replace("data: ", "").trim());
    expect(parsed.choices[0].delta.reasoning_content).toBe(
      "Let me think about this...",
    );
    expect(parsed.choices[0].delta.content).toBeUndefined();
  });

  it("transforms functionCall to tool_calls", () => {
    const line = JSON.stringify({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "read_file",
                  args: { path: "/test.txt" },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    });
    const result = transformSSELine(`data: ${line}`);
    expect(result).not.toBeNull();
    // May produce multiple chunks (tool call + finish)
    const chunks = result!.split("\n\n").filter(Boolean);
    // First chunk should have the tool call
    const firstChunk = JSON.parse(chunks[0]!.replace("data: ", "").trim());
    expect(firstChunk.choices[0].delta.tool_calls).toBeDefined();
    expect(firstChunk.choices[0].delta.tool_calls[0].function.name).toBe(
      "read_file",
    );
  });

  it("transforms usage metadata", () => {
    const line = JSON.stringify({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "Done" }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        totalTokenCount: 150,
      },
    });
    const result = transformSSELine(`data: ${line}`);
    expect(result).not.toBeNull();
    // Result may contain multiple SSE chunks (content + finish with usage)
    const chunks = result!.split("\n\n").filter(Boolean);
    // Find the chunk with usage
    const usageChunk = chunks.find((c) => c.includes('"usage"'));
    expect(usageChunk).toBeDefined();
    const parsed = JSON.parse(usageChunk!.replace("data: ", "").trim());
    expect(parsed.usage).toBeDefined();
    expect(parsed.usage.prompt_tokens).toBe(100);
    expect(parsed.usage.completion_tokens).toBe(50);
    expect(parsed.usage.total_tokens).toBe(150);
  });

  it("maps finish reasons correctly", () => {
    const testCases = [
      { antigravity: "STOP", expected: "stop" },
      { antigravity: "MAX_TOKENS", expected: "length" },
    ];

    for (const tc of testCases) {
      const line = JSON.stringify({
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Done" }],
            },
            finishReason: tc.antigravity,
          },
        ],
      });
      const result = transformSSELine(`data: ${line}`);
      expect(result).not.toBeNull();
      // Result contains content chunk + finish chunk
      const chunks = result!.split("\n\n").filter(Boolean);
      const finishChunk = chunks.find((c) => c.includes('"finish_reason"'));
      expect(finishChunk).toBeDefined();
      const parsed = JSON.parse(finishChunk!.replace("data: ", "").trim());
      expect(parsed.choices[0].finish_reason).toBe(tc.expected);
    }
  });

  it("handles multiple parts in one SSE event", () => {
    const line = JSON.stringify({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { thought: true, text: "Thinking..." },
              { text: "Regular content" },
            ],
          },
        },
      ],
    });
    const result = transformSSELine(`data: ${line}`);
    expect(result).not.toBeNull();
    const chunks = result!.split("data: ").filter((s) => s.trim());
    // Should have 2 chunks (thinking + text)
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("returns null for malformed JSON", () => {
    expect(transformSSELine("data: {invalid")).toBeNull();
  });

  it("handles candidate with empty parts", () => {
    const line = JSON.stringify({
      candidates: [
        {
          content: { role: "model", parts: [] },
          finishReason: "STOP",
        },
      ],
    });
    const result = transformSSELine(`data: ${line}`);
    // Should produce a finish chunk
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!.replace("data: ", "").trim());
    expect(parsed.choices[0].finish_reason).toBe("stop");
  });
});

describe("transformNonStreamResponse", () => {
  it("transforms simple text response", () => {
    const response = JSON.stringify({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "Hello back!" }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    });

    const result = transformNonStreamResponse(response, "test-model");
    const parsed = JSON.parse(result);

    expect(parsed.object).toBe("chat.completion");
    expect(parsed.model).toBe("test-model");
    expect(parsed.choices[0].message.role).toBe("assistant");
    expect(parsed.choices[0].message.content).toBe("Hello back!");
    expect(parsed.choices[0].finish_reason).toBe("stop");
    expect(parsed.usage.prompt_tokens).toBe(10);
    expect(parsed.usage.completion_tokens).toBe(5);
  });

  it("transforms functionCall to tool_calls in non-streaming", () => {
    const response = JSON.stringify({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "write_file",
                  args: { path: "/out.txt", content: "data" },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    });

    const result = transformNonStreamResponse(response, "test-model");
    const parsed = JSON.parse(result);

    expect(parsed.choices[0].message.tool_calls).toBeDefined();
    expect(parsed.choices[0].message.tool_calls[0].function.name).toBe(
      "write_file",
    );
    const args = JSON.parse(
      parsed.choices[0].message.tool_calls[0].function.arguments,
    );
    expect(args.path).toBe("/out.txt");
    expect(parsed.choices[0].finish_reason).toBe("tool_calls");
    expect(parsed.choices[0].message.content).toBeNull();
  });

  it("handles nested response wrapper", () => {
    const response = JSON.stringify({
      response: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Wrapped response" }],
            },
            finishReason: "STOP",
          },
        ],
      },
    });

    const result = transformNonStreamResponse(response, "nested-model");
    const parsed = JSON.parse(result);
    expect(parsed.choices[0].message.content).toBe("Wrapped response");
  });

  it("handles malformed input gracefully", () => {
    const result = transformNonStreamResponse("not-json", "model");
    // Should return a valid JSON fallback completion
    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    expect(parsed.object).toBe("chat.completion");
    expect(parsed.choices[0].message.content).toBe("");
  });

  it("handles empty candidates", () => {
    const response = JSON.stringify({ candidates: [] });
    const result = transformNonStreamResponse(response, "model");
    const parsed = JSON.parse(result);
    expect(parsed.choices[0].message.content).toBe("");
  });

  it("includes thinking in non-streaming content", () => {
    const response = JSON.stringify({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { thought: true, text: "Internal reasoning" },
              { text: "Final answer" },
            ],
          },
          finishReason: "STOP",
        },
      ],
    });

    const result = transformNonStreamResponse(response, "model");
    const parsed = JSON.parse(result);
    // Thinking should be included in the content with a marker
    expect(parsed.choices[0].message.content).toContain("Internal reasoning");
    expect(parsed.choices[0].message.content).toContain("Final answer");
  });

  // ---- Edge cases ----

  it("maps non-standard finish reasons (SAFETY/RECITATION/BLOCKLIST) to 'stop'", () => {
    // mapFinishReason only handles stop, length, and tool_calls — all others become "stop"
    for (const reason of ["SAFETY", "RECITATION", "BLOCKLIST"]) {
      const response = JSON.stringify({
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Blocked" }] },
            finishReason: reason,
          },
        ],
      });
      const result = transformNonStreamResponse(response, "model");
      const parsed = JSON.parse(result);
      expect(parsed.choices[0].finish_reason).toBe("stop");
    }
  });

  it("handles response with null content but functionCall present", () => {
    const response = JSON.stringify({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "get_weather",
                  args: { location: "NYC" },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    });
    const result = transformNonStreamResponse(response, "model");
    const parsed = JSON.parse(result);
    expect(parsed.choices[0].message.content).toBeNull();
    expect(parsed.choices[0].message.tool_calls).toHaveLength(1);
    expect(parsed.choices[0].finish_reason).toBe("tool_calls");
  });

  it("handles empty candidates array with nested response wrapper", () => {
    const response = JSON.stringify({ response: { candidates: [] } });
    const result = transformNonStreamResponse(response, "model");
    const parsed = JSON.parse(result);
    expect(parsed.choices[0].message.content).toBe("");
  });

  it("preserves usage metadata through transformNonStreamResponse", () => {
    const response = JSON.stringify({
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Hello" }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 50,
        candidatesTokenCount: 25,
        totalTokenCount: 75,
      },
    });
    const result = transformNonStreamResponse(response, "model");
    const parsed = JSON.parse(result);
    expect(parsed.usage.prompt_tokens).toBe(50);
    expect(parsed.usage.completion_tokens).toBe(25);
    expect(parsed.usage.total_tokens).toBe(75);
  });
});
