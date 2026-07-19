/**
 * Gemini-specific Request Transformations
 *
 * Handles Gemini model-specific request transformations including:
 * - Thinking config (camelCase keys, thinkingLevel for Gemini 3)
 * - Tool normalization (function/custom format)
 * - Schema transformation (JSON Schema → Gemini Schema format)
 * - Tool wrapping in functionDeclarations format
 */

import { toGeminiSchema } from "./schema.js";
import type { ThinkingTier } from "./model-resolver.js";

// ---- Helpers ----

/**
 * Check if a model is a Gemini 3 model (uses thinkingLevel string).
 */
export function isGemini3Model(model: string): boolean {
  return model.toLowerCase().includes("gemini-3");
}

/**
 * Check if a model is a Gemini 2.5 model (uses numeric thinkingBudget).
 */
export function isGemini25Model(model: string): boolean {
  return model.toLowerCase().includes("gemini-2.5");
}

/**
 * Check if a model is an image generation model.
 */
export function isImageGenerationModel(model: string): boolean {
  const lower = model.toLowerCase();
  return lower.includes("image") || lower.includes("imagen");
}

// ---- Thinking Config ----

/**
 * Build Gemini 3 thinking config with thinkingLevel string.
 */
export function buildGemini3ThinkingConfig(
  includeThoughts: boolean,
  thinkingLevel: ThinkingTier,
): Record<string, unknown> {
  return {
    includeThoughts,
    thinkingLevel,
  };
}

/**
 * Build Gemini 2.5 thinking config with numeric thinkingBudget.
 */
export function buildGemini25ThinkingConfig(
  includeThoughts: boolean,
  thinkingBudget?: number,
): Record<string, unknown> {
  return {
    includeThoughts,
    ...(typeof thinkingBudget === "number" && thinkingBudget > 0
      ? { thinkingBudget }
      : {}),
  };
}

// ---- Tool Normalization ----

/**
 * Normalize tools for Gemini models.
 * Ensures tools have proper function-style format with Gemini-compatible schemas.
 */
export function normalizeGeminiTools(
  payload: Record<string, unknown>,
): { toolDebugMissing: number; toolDebugSummaries: string[] } {
  let toolDebugMissing = 0;
  const toolDebugSummaries: string[] = [];

  if (!Array.isArray(payload.tools)) {
    return { toolDebugMissing, toolDebugSummaries };
  }

  payload.tools = (payload.tools as unknown[]).map(
    (tool: unknown, toolIndex: number) => {
      const t = tool as Record<string, unknown>;

      // Skip normalization for Google Search tools
      if (t.googleSearch || t.googleSearchRetrieval) {
        return t;
      }

      const newTool = { ...t };

      const schemaCandidates = [
        (newTool.function as Record<string, unknown> | undefined)?.input_schema,
        (newTool.function as Record<string, unknown> | undefined)?.parameters,
        (newTool.function as Record<string, unknown> | undefined)?.inputSchema,
        (newTool.custom as Record<string, unknown> | undefined)?.input_schema,
        (newTool.custom as Record<string, unknown> | undefined)?.parameters,
        newTool.parameters,
        newTool.input_schema,
        newTool.inputSchema,
      ].filter(Boolean);

      const placeholderSchema: Record<string, unknown> = {
        type: "OBJECT",
        properties: {
          _placeholder: {
            type: "BOOLEAN",
            description: "Placeholder. Always pass true.",
          },
        },
        required: ["_placeholder"],
      };

      let schema = schemaCandidates[0] as Record<string, unknown> | undefined;
      const schemaObjectOk =
        schema && typeof schema === "object" && !Array.isArray(schema);

      if (!schemaObjectOk) {
        schema = placeholderSchema;
        toolDebugMissing += 1;
      } else {
        // Transform existing schema to Gemini-compatible format
        schema = toGeminiSchema(schema) as Record<string, unknown>;
      }

      const nameCandidate =
        newTool.name ||
        (newTool.function as Record<string, unknown> | undefined)?.name ||
        (newTool.custom as Record<string, unknown> | undefined)?.name ||
        `tool-${toolIndex}`;

      // Always update function.input_schema with transformed schema
      if (newTool.function && schema) {
        (newTool.function as Record<string, unknown>).input_schema = schema;
      }

      // Always update custom.input_schema with transformed schema
      if (newTool.custom && schema) {
        (newTool.custom as Record<string, unknown>).input_schema = schema;
      }

      // Create custom from function if missing
      if (!newTool.custom && newTool.function) {
        const fn = newTool.function as Record<string, unknown>;
        newTool.custom = {
          name: fn.name || nameCandidate,
          description: fn.description,
          input_schema: schema,
        };
      }

      // Create custom if both missing
      if (!newTool.custom && !newTool.function) {
        newTool.custom = {
          name: nameCandidate,
          description: newTool.description,
          input_schema: schema,
        };

        if (
          !newTool.parameters &&
          !newTool.input_schema &&
          !newTool.inputSchema
        ) {
          newTool.parameters = schema;
        }
      }

      if (
        newTool.custom &&
        !(newTool.custom as Record<string, unknown>).input_schema
      ) {
        (newTool.custom as Record<string, unknown>).input_schema = {
          type: "OBJECT",
          properties: {},
        };
        toolDebugMissing += 1;
      }

      toolDebugSummaries.push(
        `idx=${toolIndex}, hasCustom=${!!newTool.custom}, hasFunction=${!!newTool.function}`,
      );

      // Strip custom wrappers for Gemini; only function-style is accepted
      if (newTool.custom) {
        delete newTool.custom;
      }

      return newTool;
    },
  );

  return { toolDebugMissing, toolDebugSummaries };
}

// ---- Tool Wrapping (functionDeclarations) ----

/**
 * Detect if a tool is a web search tool.
 */
function isWebSearchTool(tool: Record<string, unknown>): boolean {
  // 1. Gemini native format
  if (tool.googleSearch || tool.googleSearchRetrieval) return true;

  // 2. Claude/Anthropic format: { type: "web_search_20250305" }
  if (tool.type === "web_search_20250305") return true;

  // 3. Simple name-based format
  const name = tool.name as string | undefined;
  if (name === "web_search" || name === "google_search") return true;

  return false;
}

export interface WrapToolsResult {
  wrappedFunctionCount: number;
  passthroughToolCount: number;
}

/**
 * Wrap tools array in Gemini's required functionDeclarations format.
 *
 * Gemini/Antigravity API expects:
 *   { tools: [{ functionDeclarations: [{ name, description, parameters }] }] }
 *
 * NOT:
 *   { tools: [{ function: {...}, parameters: {...} }] }
 */
export function wrapToolsAsFunctionDeclarations(
  payload: Record<string, unknown>,
): WrapToolsResult {
  if (!Array.isArray(payload.tools) || payload.tools.length === 0) {
    return { wrappedFunctionCount: 0, passthroughToolCount: 0 };
  }

  const functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> = [];

  const passthroughTools: unknown[] = [];
  let hasWebSearchTool = false;

  for (const tool of payload.tools as Array<Record<string, unknown>>) {
    // Handle passthrough tools (Google Search and Code Execution)
    if (tool.googleSearch || tool.googleSearchRetrieval || tool.codeExecution) {
      passthroughTools.push(tool);
      continue;
    }

    // Detect and convert web search tools to Gemini format
    if (isWebSearchTool(tool)) {
      hasWebSearchTool = true;
      continue;
    }

    if (tool.functionDeclarations) {
      if (Array.isArray(tool.functionDeclarations)) {
        for (const decl of tool.functionDeclarations as Array<
          Record<string, unknown>
        >) {
          functionDeclarations.push({
            name: String(
              decl.name || `tool-${functionDeclarations.length}`,
            ),
            description: String(decl.description || ""),
            parameters:
              (decl.parameters as Record<string, unknown>) || {
                type: "OBJECT",
                properties: {},
              },
          });
        }
      }
      continue;
    }

    const fn = tool.function as Record<string, unknown> | undefined;
    const custom = tool.custom as Record<string, unknown> | undefined;

    const name = String(
      tool.name ||
        fn?.name ||
        custom?.name ||
        `tool-${functionDeclarations.length}`,
    );

    const description = String(
      tool.description || fn?.description || custom?.description || "",
    );

    const schema = (
      fn?.input_schema ||
      fn?.parameters ||
      fn?.inputSchema ||
      custom?.input_schema ||
      custom?.parameters ||
      tool.parameters ||
      tool.input_schema ||
      tool.inputSchema || { type: "OBJECT", properties: {} }
    ) as Record<string, unknown>;

    functionDeclarations.push({
      name,
      description,
      parameters: schema,
    });
  }

  const finalTools: unknown[] = [];

  if (functionDeclarations.length > 0) {
    finalTools.push({ functionDeclarations });
  }

  finalTools.push(...passthroughTools);

  // Add googleSearch tool if a web search tool was detected
  if (hasWebSearchTool && functionDeclarations.length === 0) {
    finalTools.push({ googleSearch: {} });
  }

  payload.tools = finalTools;

  return {
    wrappedFunctionCount: functionDeclarations.length,
    passthroughToolCount:
      passthroughTools.length +
      (hasWebSearchTool && functionDeclarations.length === 0 ? 1 : 0),
  };
}

// ---- Apply All Gemini Transforms ----

export interface GeminiTransformOptions {
  /** The effective model name (resolved) */
  model: string;
  /** Tier-based thinking budget (from model suffix, for Gemini 2.5) */
  tierThinkingBudget?: number;
  /** Tier-based thinking level (from model suffix, for Gemini 3) */
  tierThinkingLevel?: ThinkingTier;
  /** Normalized thinking config from user settings */
  normalizedThinking?: { includeThoughts?: boolean; thinkingBudget?: number };
}

export interface GeminiTransformResult {
  toolDebugMissing: number;
  toolDebugSummaries: string[];
  /** Number of function declarations after wrapping */
  wrappedFunctionCount: number;
  /** Number of passthrough tools */
  passthroughToolCount: number;
}

/**
 * Apply all Gemini-specific transformations to a request payload.
 */
export function applyGeminiTransforms(
  payload: Record<string, unknown>,
  options: GeminiTransformOptions,
): GeminiTransformResult {
  const {
    model,
    tierThinkingBudget,
    tierThinkingLevel,
    normalizedThinking,
  } = options;

  // 1. Apply thinking config if needed
  if (normalizedThinking) {
    let thinkingConfig: Record<string, unknown>;

    if (tierThinkingLevel && isGemini3Model(model)) {
      // Gemini 3 uses thinkingLevel string
      thinkingConfig = buildGemini3ThinkingConfig(
        normalizedThinking.includeThoughts ?? true,
        tierThinkingLevel,
      );
    } else {
      // Gemini 2.5 and others use numeric budget
      const thinkingBudget =
        tierThinkingBudget ?? normalizedThinking.thinkingBudget;
      thinkingConfig = buildGemini25ThinkingConfig(
        normalizedThinking.includeThoughts ?? true,
        thinkingBudget,
      );
    }

    const generationConfig = (payload.generationConfig ?? {}) as Record<
      string,
      unknown
    >;
    generationConfig.thinkingConfig = thinkingConfig;
    payload.generationConfig = generationConfig;
  }

  // 2. Normalize tools
  const result = normalizeGeminiTools(payload);

  // 3. Wrap tools in functionDeclarations format
  const wrapResult = wrapToolsAsFunctionDeclarations(payload);

  return {
    ...result,
    wrappedFunctionCount: wrapResult.wrappedFunctionCount,
    passthroughToolCount: wrapResult.passthroughToolCount,
  };
}
