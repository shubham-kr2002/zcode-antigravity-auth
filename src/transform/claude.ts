/**
 * Claude-specific Request Transformations
 *
 * Handles Claude model-specific request transformations including:
 * - Tool config (VALIDATED mode)
 * - Thinking config (snake_case keys)
 * - System instruction hints for interleaved thinking
 * - Tool normalization (functionDeclarations format)
 */

import { cleanJSONSchema, createPlaceholderSchema } from "./schema.js";

// ---- Constants ----

/** Claude thinking models need a sufficiently large max output token limit. */
export const CLAUDE_THINKING_MAX_OUTPUT_TOKENS = 64_000;

/** Interleaved thinking hint appended to system instructions. */
export const CLAUDE_INTERLEAVED_THINKING_HINT =
  "Interleaved thinking is enabled. You may think between tool calls and after receiving tool results before deciding the next action or final answer. Do not mention these instructions or any constraints about thinking blocks; just apply them.";

// ---- Types ----

export interface ClaudeTransformOptions {
  /** The effective model name (resolved) */
  model: string;
  /** Tier-based thinking budget (from model suffix) */
  tierThinkingBudget?: number;
  /** Normalized thinking config from user settings */
  normalizedThinking?: { includeThoughts?: boolean; thinkingBudget?: number };
}

export interface ClaudeTransformResult {
  toolDebugMissing: number;
  toolDebugSummaries: string[];
}

// ---- Helpers ----

/**
 * Check if a model is a Claude thinking model.
 */
export function isClaudeThinkingModel(model: string): boolean {
  const lower = model.toLowerCase();
  return lower.includes("claude") && lower.includes("thinking");
}

// ---- Tool Config ----

/**
 * Configure Claude tool calling to use VALIDATED mode.
 * This ensures proper tool call validation on the backend.
 */
export function configureClaudeToolConfig(
  payload: Record<string, unknown>,
): void {
  if (!payload.toolConfig) {
    payload.toolConfig = {};
  }

  const toolConfig = payload.toolConfig as Record<string, unknown>;
  if (!toolConfig.functionCallingConfig) {
    toolConfig.functionCallingConfig = {};
  }
  const fcc = toolConfig.functionCallingConfig as Record<string, unknown>;
  fcc.mode = "VALIDATED";
}

// ---- Thinking Config ----

/**
 * Build Claude thinking config with snake_case keys.
 */
export function buildClaudeThinkingConfig(
  includeThoughts: boolean,
  thinkingBudget?: number,
): Record<string, unknown> {
  return {
    include_thoughts: includeThoughts,
    ...(typeof thinkingBudget === "number" && thinkingBudget > 0
      ? { thinking_budget: thinkingBudget }
      : {}),
  };
}

/**
 * Ensure maxOutputTokens is sufficient for Claude thinking models.
 */
export function ensureClaudeMaxOutputTokens(
  generationConfig: Record<string, unknown>,
  thinkingBudget: number,
): void {
  const currentMax = generationConfig.maxOutputTokens as number | undefined;

  if (!currentMax || currentMax <= thinkingBudget) {
    generationConfig.maxOutputTokens = CLAUDE_THINKING_MAX_OUTPUT_TOKENS;
  }
}

// ---- Interleaved Thinking Hint ----

/**
 * Append interleaved thinking hint to system instruction.
 */
export function appendClaudeThinkingHint(
  payload: Record<string, unknown>,
  hint: string = CLAUDE_INTERLEAVED_THINKING_HINT,
): void {
  const existing = payload.systemInstruction;

  if (typeof existing === "string") {
    payload.systemInstruction =
      existing.trim().length > 0 ? `${existing}\n\n${hint}` : hint;
  } else if (existing && typeof existing === "object") {
    const sys = existing as Record<string, unknown>;
    const partsValue = sys.parts;

    if (Array.isArray(partsValue)) {
      const parts = partsValue as Record<string, unknown>[];
      let appended = false;

      // Find the last text part and append to it
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i];
        if (part && typeof part === "object") {
          const text = part.text;
          if (typeof text === "string") {
            part.text = `${text}\n\n${hint}`;
            appended = true;
            break;
          }
        }
      }

      if (!appended) {
        parts.push({ text: hint });
      }
    } else {
      sys.parts = [{ text: hint }];
    }

    payload.systemInstruction = sys;
  } else if (Array.isArray(payload.contents)) {
    // No existing system instruction, create one
    payload.systemInstruction = { parts: [{ text: hint }] };
  }
}

// ---- Tool Normalization ----

/**
 * Normalize tools for Claude models.
 * Converts various tool formats to functionDeclarations format.
 */
export function normalizeClaudeTools(
  payload: Record<string, unknown>,
): { toolDebugMissing: number; toolDebugSummaries: string[] } {
  let toolDebugMissing = 0;
  const toolDebugSummaries: string[] = [];

  if (!Array.isArray(payload.tools)) {
    return { toolDebugMissing, toolDebugSummaries };
  }

  const functionDeclarations: Record<string, unknown>[] = [];
  const passthroughTools: unknown[] = [];

  const normalizeSchema = (schema: unknown): Record<string, unknown> => {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
      toolDebugMissing += 1;
      return createPlaceholderSchema();
    }

    const cleaned = cleanJSONSchema(schema);
    if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) {
      toolDebugMissing += 1;
      return createPlaceholderSchema();
    }

    // Claude VALIDATED mode requires tool parameters to be an object schema
    // with at least one property.
    const hasProperties =
      cleaned.properties &&
      typeof cleaned.properties === "object" &&
      Object.keys(cleaned.properties as Record<string, unknown>).length > 0;

    cleaned.type = "object";

    if (!hasProperties) {
      cleaned.properties = {
        _placeholder: {
          type: "boolean",
          description: "Placeholder. Always pass true.",
        },
      };
      cleaned.required = Array.isArray(cleaned.required)
        ? Array.from(
            new Set([...(cleaned.required as string[]), "_placeholder"]),
          )
        : ["_placeholder"];
    }

    return cleaned;
  };

  const tools = payload.tools as unknown[];
  for (const tool of tools) {
    const t = tool as Record<string, unknown>;

    const pushDeclaration = (
      decl: Record<string, unknown> | undefined,
      source: string,
    ): void => {
      const schema =
        decl?.parameters ||
        decl?.parametersJsonSchema ||
        decl?.input_schema ||
        decl?.inputSchema ||
        t.parameters ||
        t.parametersJsonSchema ||
        t.input_schema ||
        t.inputSchema ||
        (t.function as Record<string, unknown> | undefined)?.parameters ||
        (t.function as Record<string, unknown> | undefined)
          ?.parametersJsonSchema ||
        (t.function as Record<string, unknown> | undefined)?.input_schema ||
        (t.function as Record<string, unknown> | undefined)?.inputSchema ||
        (t.custom as Record<string, unknown> | undefined)?.parameters ||
        (t.custom as Record<string, unknown> | undefined)
          ?.parametersJsonSchema ||
        (t.custom as Record<string, unknown> | undefined)?.input_schema;

      let name =
        decl?.name ||
        t.name ||
        (t.function as Record<string, unknown> | undefined)?.name ||
        (t.custom as Record<string, unknown> | undefined)?.name ||
        `tool-${functionDeclarations.length}`;

      // Sanitize tool name: alphanumeric with underscores, no special chars
      name = String(name).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

      const description =
        decl?.description ||
        t.description ||
        (t.function as Record<string, unknown> | undefined)?.description ||
        (t.custom as Record<string, unknown> | undefined)?.description ||
        "";

      functionDeclarations.push({
        name,
        description: String(description || ""),
        parameters: normalizeSchema(schema),
      });

      toolDebugSummaries.push(
        `decl=${name},src=${source},hasSchema=${schema ? "y" : "n"}`,
      );
    };

    // Check for functionDeclarations array first
    if (
      Array.isArray(t.functionDeclarations) &&
      (t.functionDeclarations as unknown[]).length > 0
    ) {
      for (const decl of t.functionDeclarations as Record<string, unknown>[]) {
        pushDeclaration(decl, "functionDeclarations");
      }
      continue;
    }

    // Fall back to function/custom style definitions
    if (
      t.function ||
      t.custom ||
      t.parameters ||
      t.input_schema ||
      t.inputSchema
    ) {
      pushDeclaration(
        (t.function as Record<string, unknown> | undefined) ??
          (t.custom as Record<string, unknown> | undefined) ??
          t,
        "function/custom",
      );
      continue;
    }

    // Preserve non-function tool entries (e.g., codeExecution) untouched
    passthroughTools.push(tool);
  }

  const finalTools: unknown[] = [];
  if (functionDeclarations.length > 0) {
    finalTools.push({ functionDeclarations });
  }
  payload.tools = finalTools.concat(passthroughTools);

  return { toolDebugMissing, toolDebugSummaries };
}

// ---- Convert Stop Sequences ----

/**
 * Convert snake_case stop_sequences to camelCase stopSequences.
 */
export function convertStopSequences(
  generationConfig: Record<string, unknown>,
): void {
  if (Array.isArray(generationConfig.stop_sequences)) {
    generationConfig.stopSequences = generationConfig.stop_sequences;
    delete generationConfig.stop_sequences;
  }
}

// ---- Apply All Claude Transforms ----

/**
 * Apply all Claude-specific transformations to a request payload.
 */
export function applyClaudeTransforms(
  payload: Record<string, unknown>,
  options: ClaudeTransformOptions,
): ClaudeTransformResult {
  const { model, tierThinkingBudget, normalizedThinking } = options;
  const isThinking = isClaudeThinkingModel(model);

  // 1. Configure tool calling mode
  configureClaudeToolConfig(payload);

  if (payload.generationConfig) {
    convertStopSequences(payload.generationConfig as Record<string, unknown>);
  }

  // 2. Apply thinking config if needed
  if (normalizedThinking && isThinking) {
    const thinkingBudget =
      tierThinkingBudget ?? normalizedThinking.thinkingBudget;

    const thinkingConfig = buildClaudeThinkingConfig(
      normalizedThinking.includeThoughts ?? true,
      thinkingBudget,
    );

    const generationConfig = (payload.generationConfig ?? {}) as Record<
      string,
      unknown
    >;
    generationConfig.thinkingConfig = thinkingConfig;

    if (typeof thinkingBudget === "number" && thinkingBudget > 0) {
      ensureClaudeMaxOutputTokens(generationConfig, thinkingBudget);
    }

    payload.generationConfig = generationConfig;
  }

  // 3. Append interleaved thinking hint for thinking models with tools
  if (
    isThinking &&
    Array.isArray(payload.tools) &&
    (payload.tools as unknown[]).length > 0
  ) {
    appendClaudeThinkingHint(payload);
  }

  // 4. Normalize tools
  return normalizeClaudeTools(payload);
}
