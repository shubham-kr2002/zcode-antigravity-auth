/**
 * Tests for OpenAI → Antigravity request transformation.
 */
import { describe, it, expect } from "vitest";
import { transformRequest, type OpenAIChatRequest } from "../src/transform/request.js";
import { getConfig, initRuntimeConfig } from "../src/config.js";

// Initialize default config for tests
initRuntimeConfig(getConfig());

function makeTransform(model: string, messages: OpenAIChatRequest["messages"], opts?: Partial<OpenAIChatRequest>) {
  const req: OpenAIChatRequest = {
    model,
    messages,
    ...opts,
  };
  return transformRequest(req, {
    projectId: "test-project-123",
    accessToken: "test-token",
    config: getConfig(),
  });
}

describe("transformRequest", () => {
  it("builds correct URL for non-streaming request", () => {
    const result = makeTransform("claude-sonnet-4-6", [
      { role: "user", content: "Hello" },
    ]);
    expect(result.url).toContain("v1internal:generateContent");
    expect(result.url).not.toContain("alt=sse");
    expect(result.url).toContain("daily-cloudcode-pa.sandbox.googleapis.com");
  });

  it("builds correct URL for streaming request", () => {
    const result = makeTransform(
      "gemini-2.5-flash",
      [{ role: "user", content: "Hello" }],
      { stream: true },
    );
    expect(result.url).toContain("v1internal:streamGenerateContent");
    expect(result.url).toContain("alt=sse");
  });

  it("transforms simple user message", () => {
    const result = makeTransform("gemini-2.5-flash", [
      { role: "user", content: "Hello" },
    ]);
    const body = JSON.parse(result.init.body as string);
    expect(body.request.contents).toHaveLength(1);
    expect(body.request.contents[0]).toEqual({
      role: "user",
      parts: [{ text: "Hello" }],
    });
  });

  it("transforms system message to systemInstruction", () => {
    const result = makeTransform("claude-sonnet-4-6", [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
    ]);
    const body = JSON.parse(result.init.body as string);
    expect(body.request.systemInstruction).toBeDefined();
    expect(body.request.systemInstruction.role).toBe("user");
    expect(body.request.systemInstruction.parts[0].text).toContain(
      "You are a helpful assistant.",
    );
  });

  it("transforms assistant message with content", () => {
    const result = makeTransform("claude-sonnet-4-6", [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
      { role: "user", content: "How are you?" },
    ]);
    const body = JSON.parse(result.init.body as string);
    expect(body.request.contents).toHaveLength(3);
    const assistantContent = body.request.contents[1];
    expect(assistantContent.role).toBe("model");
    expect(assistantContent.parts[0].text).toBe("Hi there!");
  });

  it("transforms tool calls", () => {
    const result = makeTransform("claude-opus-4-6-thinking", [
      { role: "user", content: "Read file.txt" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "read_file",
              arguments: JSON.stringify({ path: "/file.txt" }),
            },
          },
        ],
      },
    ]);
    const body = JSON.parse(result.init.body as string);
    const assistantContent = body.request.contents[1];
    expect(assistantContent.role).toBe("model");
    expect(assistantContent.parts[0].functionCall).toBeDefined();
    expect(assistantContent.parts[0].functionCall.name).toBe("read_file");
    expect(assistantContent.parts[0].functionCall.args).toEqual({
      path: "/file.txt",
    });
  });

  it("transforms tool response messages", () => {
    const result = makeTransform("claude-opus-4-6-thinking", [
      { role: "user", content: "Read file.txt" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "read_file",
              arguments: JSON.stringify({ path: "/file.txt" }),
            },
          },
        ],
      },
      {
        role: "tool",
        content: "file contents here",
        tool_call_id: "call_1",
      },
    ]);
    const body = JSON.parse(result.init.body as string);

    // Should have user → model (tool call) → user (tool result)
    expect(body.request.contents).toHaveLength(3);

    const toolResponse = body.request.contents[2];
    expect(toolResponse.role).toBe("user");
    expect(toolResponse.parts[0].functionResponse).toBeDefined();
    expect(toolResponse.parts[0].functionResponse.name).toBe("read_file");
    expect(toolResponse.parts[0].functionResponse.response).toEqual({
      content: "file contents here",
    });
  });

  it("transforms tools definition to functionDeclarations", () => {
    const result = makeTransform(
      "claude-sonnet-4-6",
      [{ role: "user", content: "Read a file" }],
      {
        tools: [
          {
            type: "function",
            function: {
              name: "read_file",
              description: "Read a file from disk",
              parameters: {
                type: "object",
                properties: {
                  path: { type: "string", description: "File path" },
                },
                required: ["path"],
              },
            },
          },
        ],
      },
    );
    const body = JSON.parse(result.init.body as string);
    expect(body.request.tools).toBeDefined();
    expect(body.request.tools[0].functionDeclarations).toHaveLength(1);
    const decl = body.request.tools[0].functionDeclarations[0];
    expect(decl.name).toBe("read_file");
    expect(decl.description).toBe("Read a file from disk");
    expect(decl.parameters.type).toBe("object");
  });

  it("cleans schemas — removes unsupported keys", () => {
    const result = makeTransform(
      "claude-sonnet-4-6",
      [{ role: "user", content: "test" }],
      {
        tools: [
          {
            type: "function",
            function: {
              name: "test_tool",
              parameters: {
                type: "object",
                $schema: "http://json-schema.org/draft-07/schema#",
                title: "Test",
                default: {},
                const: "value",
                examples: [],
                properties: {
                  name: { type: "string", default: "test", const: "fixed" },
                },
              },
            },
          },
        ],
      },
    );
    const body = JSON.parse(result.init.body as string);
    const params =
      body.request.tools[0].functionDeclarations[0].parameters;
    // These keys should be removed
    expect(params.$schema).toBeUndefined();
    expect(params.title).toBeUndefined();
    expect(params.default).toBeUndefined();
    expect(params.const).toBeUndefined();
    expect(params.examples).toBeUndefined();
    // Property cleaning
    expect(params.properties.name.default).toBeUndefined();
    expect(params.properties.name.const).toBeUndefined();
    expect(params.properties.name.type).toBe("string");
  });

  it("wraps request with project, model, and userAgent", () => {
    const result = makeTransform("claude-sonnet-4-6", [
      { role: "user", content: "Hello" },
    ]);
    const body = JSON.parse(result.init.body as string);
    expect(body.project).toBe("test-project-123");
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.userAgent).toBe("antigravity");
    expect(body.requestType).toBe("agent");
    expect(body.requestId).toMatch(/^agent-/);
  });

  it("sets Authorization header", () => {
    const result = makeTransform("gemini-2.5-flash", [
      { role: "user", content: "Hello" },
    ]);
    const headers = result.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("adds thinking config for Claude thinking model", () => {
    const result = makeTransform(
      "claude-opus-4-6-thinking",
      [{ role: "user", content: "Hello" }],
      { thinking: { type: "enabled", budget_tokens: 32768 } },
    );
    const body = JSON.parse(result.init.body as string);
    expect(body.request.generationConfig.thinkingConfig).toBeDefined();
    expect(
      body.request.generationConfig.thinkingConfig.thinking_budget,
    ).toBe(32768);
    expect(
      body.request.generationConfig.thinkingConfig.include_thoughts,
    ).toBe(true);
  });

  it("adds thinking config for Gemini 3 model", () => {
    const result = makeTransform(
      "gemini-3.1-pro",
      [{ role: "user", content: "Hello" }],
      { thinking: { type: "enabled", budget_tokens: 32768 } },
    );
    const body = JSON.parse(result.init.body as string);
    expect(body.request.generationConfig.thinkingConfig).toBeDefined();
    expect(
      body.request.generationConfig.thinkingConfig.thinkingLevel,
    ).toBe("high"); // 32768 budget → high level
  });

  it("handles multiple tool results grouped together", () => {
    const result = makeTransform("claude-opus-4-6-thinking", [
      { role: "user", content: "Read two files" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"/a.txt"}' },
          },
          {
            id: "call_2",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"/b.txt"}' },
          },
        ],
      },
      { role: "tool", content: "contents a", tool_call_id: "call_1" },
      { role: "tool", content: "contents b", tool_call_id: "call_2" },
    ]);
    const body = JSON.parse(result.init.body as string);
    // Tool results should be in a single user content block
    const userContents = body.request.contents.filter(
      (c: { role: string }) => c.role === "user",
    );
    // We expect: original user + tool results grouped together = 2 user blocks
    expect(userContents.length).toBe(2);
    // The second user block should contain both tool results
    const toolResponseBlock = userContents[1];
    expect(toolResponseBlock.parts).toHaveLength(2);
    expect(toolResponseBlock.parts[0].functionResponse).toBeDefined();
    expect(toolResponseBlock.parts[1].functionResponse).toBeDefined();
  });
});
