/**
 * OpenAI-compatible → Antigravity Gemini format request transformer.
 *
 * Transforms:
 * - messages[] → contents[].parts[]
 * - tools[] → functionDeclarations[] (with Claude/Gemini normalization)
 * - system message → systemInstruction (with interleaved thinking hints)
 * - Wraps in { project, model, request }
 *
 * Phase 4: Integrated model resolver, Claude/Gemini transforms,
 * schema cleaning (toGeminiSchema), cross-model sanitization.
 */

import crypto from "node:crypto";
import {
  ANTIGRAVITY_SYSTEM_INSTRUCTION,
  CLAUDE_TOOL_SYSTEM_INSTRUCTION,
  getRandomizedHeaders,
  GEMINI_CLI_HEADERS,
  type HeaderStyle,
} from "../constants.js";
import type { AntigravityConfig } from "../config.js";
import { resolveModelWithTier, isClaudeModel } from "./model-resolver.js";
import { cleanJSONSchema, toGeminiSchema } from "./schema.js";
import { applyClaudeTransforms, isClaudeThinkingModel } from "./claude.js";
import { applyGeminiTransforms, isGemini3Model } from "./gemini.js";
import { sanitizeCrossModelPayloadInPlace, getTargetFamily } from "./cross-model-sanitizer.js";

// ---- Types ----

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  thinking?: {
    type: "enabled" | "disabled";
    budget_tokens?: number;
  };
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

// Antigravity internal types
interface AntigravityContent {
  role: "user" | "model";
  parts: AntigravityPart[];
}

interface AntigravityPart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: unknown;
  };
}

interface AntigravityToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AntigravityRequest {
  project: string;
  model: string;
  request: {
    contents: AntigravityContent[];
    systemInstruction?: {
      role: string;
      parts: { text: string }[];
    };
    tools?: { functionDeclarations: AntigravityToolDeclaration[] }[];
    toolConfig?: { functionCallingConfig: { mode: string } };
    generationConfig?: Record<string, unknown>;
  };
  userAgent?: string;
  requestType?: string;
  requestId?: string;
}

// ---- Transform Options ----

export interface TransformOptions {
  projectId: string;
  accessToken: string;
  headerStyle?: HeaderStyle;
  config: AntigravityConfig;
}

// ---- Main Transform ----

export function transformRequest(
  openaiReq: OpenAIChatRequest,
  options: TransformOptions,
): { url: string; init: RequestInit } {
  const headerStyle = options.headerStyle ?? "antigravity";
  const isStreaming = openaiReq.stream === true;

  // 1. Resolve model with tier support (handles tier suffixes, aliases)
  const resolved = resolveModelWithTier(openaiReq.model, {
    cli_first: headerStyle === "gemini-cli",
  });
  const antigravityModel = resolved.actualModel;
  const isClaude = isClaudeModel(antigravityModel);

  // 2. Transform messages → contents
  const contents: AntigravityContent[] = [];
  let systemText: string | undefined;

  // Track tool calls from assistant messages for matching with tool responses
  const toolCallNameById = new Map<string, string>(); // call_id → function_name

  for (const msg of openaiReq.messages) {
    if (msg.role === "system") {
      systemText = (systemText ?? "") + (msg.content ?? "");
      continue;
    }

    if (msg.role === "user") {
      const parts: AntigravityPart[] = [];
      if (msg.content) {
        parts.push({ text: msg.content });
      }
      contents.push({ role: "user", parts });
      continue;
    }

    if (msg.role === "assistant") {
      const parts: AntigravityPart[] = [];

      // Add reasoning/thinking as first part if present
      if (msg.reasoning_content) {
        parts.push({ text: msg.reasoning_content });
      }

      // Add text content
      if (msg.content) {
        parts.push({ text: msg.content });
      }

      // Add tool calls as functionCall parts
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }
          toolCallNameById.set(tc.id, tc.function.name);
          parts.push({
            functionCall: { name: tc.function.name, args },
          });
        }
      }

      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
      continue;
    }

    if (msg.role === "tool") {
      const toolCallId = msg.tool_call_id ?? "";
      const functionName = toolCallNameById.get(toolCallId) ?? "unknown";

      // Group tool results into a single user content block
      const lastContent =
        contents.length > 0 ? contents[contents.length - 1] : null;
      if (
        lastContent &&
        lastContent.role === "user" &&
        lastContent.parts.some((p) => p.functionResponse)
      ) {
        lastContent.parts.push({
          functionResponse: {
            name: functionName,
            response: { content: msg.content ?? "" },
          },
        });
      } else {
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: functionName,
                response: { content: msg.content ?? "" },
              },
            },
          ],
        });
      }
      continue;
    }
  }

  // 3. Build system instruction
  let systemInstruction: AntigravityRequest["request"]["systemInstruction"];
  if (headerStyle === "antigravity") {
    const fullSystemText = systemText
      ? `${ANTIGRAVITY_SYSTEM_INSTRUCTION}\n\n${systemText}`
      : ANTIGRAVITY_SYSTEM_INSTRUCTION;
    systemInstruction = {
      role: "user",
      parts: [{ text: fullSystemText }],
    };
  } else if (systemText) {
    systemInstruction = {
      role: "user",
      parts: [{ text: systemText }],
    };
  }

  // 3b. Inject Claude tool hardening instruction when tools are present
  if (
    isClaude &&
    openaiReq.tools &&
    openaiReq.tools.length > 0 &&
    options.config.claude_tool_hardening !== false
  ) {
    const hardeningText = `\n\n${CLAUDE_TOOL_SYSTEM_INSTRUCTION}`;
    if (systemInstruction) {
      const lastPart = systemInstruction.parts[systemInstruction.parts.length - 1];
      if (lastPart) {
        lastPart.text = `${lastPart.text}${hardeningText}`;
      }
    } else {
      systemInstruction = {
        role: "user",
        parts: [{ text: hardeningText.trim() }],
      };
    }
  }

  // 4. Build tools
  let tools: AntigravityRequest["request"]["tools"];
  if (openaiReq.tools && openaiReq.tools.length > 0) {
    if (isClaude) {
      // Claude: use cleaned schema with functionDeclarations
      const functionDeclarations: AntigravityToolDeclaration[] =
        openaiReq.tools
          .filter((t) => t.type === "function")
          .map((t) => ({
            name: t.function.name
              .replace(/[^a-zA-Z0-9_-]/g, "_")
              .slice(0, 64),
            description: t.function.description ?? "",
            parameters: cleanJSONSchema(t.function.parameters),
          }));

      if (functionDeclarations.length > 0) {
        tools = [{ functionDeclarations }];
      }
    } else {
      // Gemini: use toGeminiSchema with uppercase types
      const functionDeclarations: AntigravityToolDeclaration[] =
        openaiReq.tools
          .filter((t) => t.type === "function")
          .map((t) => ({
            name: t.function.name
              .replace(/[^a-zA-Z0-9_-]/g, "_")
              .slice(0, 64),
            description: t.function.description ?? "",
            parameters: toGeminiSchema(t.function.parameters) as Record<
              string,
              unknown
            >,
          }));

      if (functionDeclarations.length > 0) {
        tools = [{ functionDeclarations }];
      }
    }
  }

  // 5. Build generation config
  const generationConfig: Record<string, unknown> = {};

  if (openaiReq.temperature !== undefined) {
    generationConfig.temperature = openaiReq.temperature;
  }
  if (openaiReq.max_tokens !== undefined) {
    generationConfig.maxOutputTokens = openaiReq.max_tokens;
  }
  if (openaiReq.top_p !== undefined) {
    generationConfig.topP = openaiReq.top_p;
  }
  if (openaiReq.stop) {
    generationConfig.stopSequences = openaiReq.stop;
  }

  // 6. Thinking config
  if (resolved.isThinkingModel) {
    if (isClaude) {
      // Claude: snake_case keys
      const budget = resolved.thinkingBudget ?? openaiReq.thinking?.budget_tokens ?? 32768;
      generationConfig.thinkingConfig = {
        include_thoughts: true,
        thinking_budget: budget,
      };
      // Ensure maxOutputTokens is sufficient
      if (!generationConfig.maxOutputTokens || (generationConfig.maxOutputTokens as number) <= budget) {
        generationConfig.maxOutputTokens = 64000;
      }
    } else if (isGemini3Model(antigravityModel)) {
      // Gemini 3: thinkingLevel string
      // User-provided budget takes priority over model default tier
      const level = openaiReq.thinking?.budget_tokens
        ? budgetToLevel(openaiReq.thinking.budget_tokens)
        : resolved.thinkingLevel ?? "low";
      generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingLevel: level,
      };
    } else {
      // Gemini 2.5: camelCase numeric budget
      const budget = resolved.thinkingBudget ?? openaiReq.thinking?.budget_tokens ?? 8192;
      generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: budget,
      };
    }
  }

  // 7. Build Antigravity request body (as a mutable object for transforms)
  const requestPayload: Record<string, unknown> = {
    contents,
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(tools ? { tools } : {}),
    ...(tools
      ? {
          toolConfig: {
            functionCallingConfig: { mode: "VALIDATED" },
          },
        }
      : {}),
    ...(Object.keys(generationConfig).length > 0
      ? { generationConfig }
      : {}),
  };

  // 8. Cross-model sanitization: strip foreign signature fields
  sanitizeCrossModelPayloadInPlace(requestPayload, {
    targetModel: antigravityModel,
  });

  // 9. Apply Claude-specific transforms (interleaved thinking hint, tool normalization)
  if (isClaude) {
    const isThinking = isClaudeThinkingModel(antigravityModel);

    // Configure tool config
    if (tools && requestPayload.toolConfig) {
      const tc = requestPayload.toolConfig as Record<string, unknown>;
      if (!tc.functionCallingConfig) {
        tc.functionCallingConfig = {};
      }
      (tc.functionCallingConfig as Record<string, unknown>).mode = "VALIDATED";
    }

    // Convert stop_sequences if present
    if (generationConfig.stop_sequences) {
      generationConfig.stopSequences = generationConfig.stop_sequences;
      delete generationConfig.stop_sequences;
    }

    // Append interleaved thinking hint for thinking models with tools
    if (isThinking && tools && tools.length > 0) {
      const hint =
        "Interleaved thinking is enabled. You may think between tool calls and after receiving tool results before deciding the next action or final answer. Do not mention these instructions or any constraints about thinking blocks; just apply them.";

      if (systemInstruction) {
        // Append to last text part
        const parts = systemInstruction.parts;
        const lastPart = parts[parts.length - 1];
        if (lastPart) {
          lastPart.text = `${lastPart.text}\n\n${hint}`;
        } else {
          parts.push({ text: hint });
        }
      }
    }
  }

  // 10. Apply Gemini-specific transforms
  if (!isClaude) {
    // Wrap tools in functionDeclarations format (already done above, but ensure correct format)
    // normalizeGeminiTools would be called here if we needed the full pipeline,
    // but our tool construction above already handles this for the basic case.
  }

  // Build final Antigravity request
  const body: AntigravityRequest = {
    project: options.projectId,
    model: antigravityModel,
    request: requestPayload as AntigravityRequest["request"],
  };

  if (headerStyle === "antigravity") {
    body.userAgent = "antigravity";
    body.requestType = "agent";
    body.requestId = `agent-${crypto.randomUUID()}`;
  }

  // 11. Build endpoint URL
  const baseEndpoint =
    headerStyle === "gemini-cli"
      ? "https://cloudcode-pa.googleapis.com"
      : "https://daily-cloudcode-pa.sandbox.googleapis.com";

  const action = isStreaming
    ? "streamGenerateContent"
    : "generateContent";
  const url = `${baseEndpoint}/v1internal:${action}${isStreaming ? "?alt=sse" : ""}`;

  // 12. Build headers
  const headers: Record<string, string> = {};
  headers["Authorization"] = `Bearer ${options.accessToken}`;
  headers["Content-Type"] = "application/json";

  if (isStreaming) {
    headers["Accept"] = "text/event-stream";
  }

  if (isClaude && resolved.isThinkingModel) {
    headers["anthropic-beta"] = "interleaved-thinking-2025-05-14";
  }

  // Add Antigravity or Gemini CLI headers
  if (headerStyle === "antigravity") {
    const h = getRandomizedHeaders("antigravity", antigravityModel);
    headers["User-Agent"] = h["User-Agent"];
  } else {
    headers["User-Agent"] = GEMINI_CLI_HEADERS["User-Agent"];
    headers["X-Goog-Api-Client"] = GEMINI_CLI_HEADERS["X-Goog-Api-Client"];
    headers["Client-Metadata"] = GEMINI_CLI_HEADERS["Client-Metadata"];
  }

  return {
    url,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  };
}

// ---- Helpers ----

function budgetToLevel(budget?: number): string {
  if (!budget || budget <= 4096) return "low";
  if (budget <= 16384) return "medium";
  return "high";
}
