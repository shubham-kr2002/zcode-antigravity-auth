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
export const CLAUDE_INTERLEAVED_THINKING_HINT = "Interleaved thinking is enabled. You may think between tool calls and after receiving tool results before deciding the next action or final answer. Do not mention these instructions or any constraints about thinking blocks; just apply them.";
// ---- Helpers ----
/**
 * Check if a model is a Claude thinking model.
 */
export function isClaudeThinkingModel(model) {
    const lower = model.toLowerCase();
    return lower.includes("claude") && lower.includes("thinking");
}
// ---- Tool Config ----
/**
 * Configure Claude tool calling to use VALIDATED mode.
 * This ensures proper tool call validation on the backend.
 */
export function configureClaudeToolConfig(payload) {
    if (!payload.toolConfig) {
        payload.toolConfig = {};
    }
    const toolConfig = payload.toolConfig;
    if (!toolConfig.functionCallingConfig) {
        toolConfig.functionCallingConfig = {};
    }
    const fcc = toolConfig.functionCallingConfig;
    fcc.mode = "VALIDATED";
}
// ---- Thinking Config ----
/**
 * Build Claude thinking config with snake_case keys.
 */
export function buildClaudeThinkingConfig(includeThoughts, thinkingBudget) {
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
export function ensureClaudeMaxOutputTokens(generationConfig, thinkingBudget) {
    const currentMax = generationConfig.maxOutputTokens;
    if (!currentMax || currentMax <= thinkingBudget) {
        generationConfig.maxOutputTokens = CLAUDE_THINKING_MAX_OUTPUT_TOKENS;
    }
}
// ---- Interleaved Thinking Hint ----
/**
 * Append interleaved thinking hint to system instruction.
 */
export function appendClaudeThinkingHint(payload, hint = CLAUDE_INTERLEAVED_THINKING_HINT) {
    const existing = payload.systemInstruction;
    if (typeof existing === "string") {
        payload.systemInstruction =
            existing.trim().length > 0 ? `${existing}\n\n${hint}` : hint;
    }
    else if (existing && typeof existing === "object") {
        const sys = existing;
        const partsValue = sys.parts;
        if (Array.isArray(partsValue)) {
            const parts = partsValue;
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
        }
        else {
            sys.parts = [{ text: hint }];
        }
        payload.systemInstruction = sys;
    }
    else if (Array.isArray(payload.contents)) {
        // No existing system instruction, create one
        payload.systemInstruction = { parts: [{ text: hint }] };
    }
}
// ---- Tool Normalization ----
/**
 * Normalize tools for Claude models.
 * Converts various tool formats to functionDeclarations format.
 */
export function normalizeClaudeTools(payload) {
    let toolDebugMissing = 0;
    const toolDebugSummaries = [];
    if (!Array.isArray(payload.tools)) {
        return { toolDebugMissing, toolDebugSummaries };
    }
    const functionDeclarations = [];
    const passthroughTools = [];
    const normalizeSchema = (schema) => {
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
        const hasProperties = cleaned.properties &&
            typeof cleaned.properties === "object" &&
            Object.keys(cleaned.properties).length > 0;
        cleaned.type = "object";
        if (!hasProperties) {
            cleaned.properties = {
                _placeholder: {
                    type: "boolean",
                    description: "Placeholder. Always pass true.",
                },
            };
            cleaned.required = Array.isArray(cleaned.required)
                ? Array.from(new Set([...cleaned.required, "_placeholder"]))
                : ["_placeholder"];
        }
        return cleaned;
    };
    const tools = payload.tools;
    for (const tool of tools) {
        const t = tool;
        const pushDeclaration = (decl, source) => {
            const schema = decl?.parameters ||
                decl?.parametersJsonSchema ||
                decl?.input_schema ||
                decl?.inputSchema ||
                t.parameters ||
                t.parametersJsonSchema ||
                t.input_schema ||
                t.inputSchema ||
                t.function?.parameters ||
                t.function
                    ?.parametersJsonSchema ||
                t.function?.input_schema ||
                t.function?.inputSchema ||
                t.custom?.parameters ||
                t.custom
                    ?.parametersJsonSchema ||
                t.custom?.input_schema;
            let name = decl?.name ||
                t.name ||
                t.function?.name ||
                t.custom?.name ||
                `tool-${functionDeclarations.length}`;
            // Sanitize tool name: alphanumeric with underscores, no special chars
            name = String(name).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
            const description = decl?.description ||
                t.description ||
                t.function?.description ||
                t.custom?.description ||
                "";
            functionDeclarations.push({
                name,
                description: String(description || ""),
                parameters: normalizeSchema(schema),
            });
            toolDebugSummaries.push(`decl=${name},src=${source},hasSchema=${schema ? "y" : "n"}`);
        };
        // Check for functionDeclarations array first
        if (Array.isArray(t.functionDeclarations) &&
            t.functionDeclarations.length > 0) {
            for (const decl of t.functionDeclarations) {
                pushDeclaration(decl, "functionDeclarations");
            }
            continue;
        }
        // Fall back to function/custom style definitions
        if (t.function ||
            t.custom ||
            t.parameters ||
            t.input_schema ||
            t.inputSchema) {
            pushDeclaration(t.function ??
                t.custom ??
                t, "function/custom");
            continue;
        }
        // Preserve non-function tool entries (e.g., codeExecution) untouched
        passthroughTools.push(tool);
    }
    const finalTools = [];
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
export function convertStopSequences(generationConfig) {
    if (Array.isArray(generationConfig.stop_sequences)) {
        generationConfig.stopSequences = generationConfig.stop_sequences;
        delete generationConfig.stop_sequences;
    }
}
// ---- Apply All Claude Transforms ----
/**
 * Apply all Claude-specific transformations to a request payload.
 */
export function applyClaudeTransforms(payload, options) {
    const { model, tierThinkingBudget, normalizedThinking } = options;
    const isThinking = isClaudeThinkingModel(model);
    // 1. Configure tool calling mode
    configureClaudeToolConfig(payload);
    if (payload.generationConfig) {
        convertStopSequences(payload.generationConfig);
    }
    // 2. Apply thinking config if needed
    if (normalizedThinking && isThinking) {
        const thinkingBudget = tierThinkingBudget ?? normalizedThinking.thinkingBudget;
        const thinkingConfig = buildClaudeThinkingConfig(normalizedThinking.includeThoughts ?? true, thinkingBudget);
        const generationConfig = (payload.generationConfig ?? {});
        generationConfig.thinkingConfig = thinkingConfig;
        if (typeof thinkingBudget === "number" && thinkingBudget > 0) {
            ensureClaudeMaxOutputTokens(generationConfig, thinkingBudget);
        }
        payload.generationConfig = generationConfig;
    }
    // 3. Append interleaved thinking hint for thinking models with tools
    if (isThinking &&
        Array.isArray(payload.tools) &&
        payload.tools.length > 0) {
        appendClaudeThinkingHint(payload);
    }
    // 4. Normalize tools
    return normalizeClaudeTools(payload);
}
//# sourceMappingURL=claude.js.map