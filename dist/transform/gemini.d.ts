/**
 * Gemini-specific Request Transformations
 *
 * Handles Gemini model-specific request transformations including:
 * - Thinking config (camelCase keys, thinkingLevel for Gemini 3)
 * - Tool normalization (function/custom format)
 * - Schema transformation (JSON Schema → Gemini Schema format)
 * - Tool wrapping in functionDeclarations format
 */
import type { ThinkingTier } from "./model-resolver.js";
/**
 * Check if a model is a Gemini 3 model (uses thinkingLevel string).
 */
export declare function isGemini3Model(model: string): boolean;
/**
 * Check if a model is a Gemini 2.5 model (uses numeric thinkingBudget).
 */
export declare function isGemini25Model(model: string): boolean;
/**
 * Check if a model is an image generation model.
 */
export declare function isImageGenerationModel(model: string): boolean;
/**
 * Build Gemini 3 thinking config with thinkingLevel string.
 */
export declare function buildGemini3ThinkingConfig(includeThoughts: boolean, thinkingLevel: ThinkingTier): Record<string, unknown>;
/**
 * Build Gemini 2.5 thinking config with numeric thinkingBudget.
 */
export declare function buildGemini25ThinkingConfig(includeThoughts: boolean, thinkingBudget?: number): Record<string, unknown>;
/**
 * Normalize tools for Gemini models.
 * Ensures tools have proper function-style format with Gemini-compatible schemas.
 */
export declare function normalizeGeminiTools(payload: Record<string, unknown>): {
    toolDebugMissing: number;
    toolDebugSummaries: string[];
};
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
export declare function wrapToolsAsFunctionDeclarations(payload: Record<string, unknown>): WrapToolsResult;
export interface GeminiTransformOptions {
    /** The effective model name (resolved) */
    model: string;
    /** Tier-based thinking budget (from model suffix, for Gemini 2.5) */
    tierThinkingBudget?: number;
    /** Tier-based thinking level (from model suffix, for Gemini 3) */
    tierThinkingLevel?: ThinkingTier;
    /** Normalized thinking config from user settings */
    normalizedThinking?: {
        includeThoughts?: boolean;
        thinkingBudget?: number;
    };
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
export declare function applyGeminiTransforms(payload: Record<string, unknown>, options: GeminiTransformOptions): GeminiTransformResult;
//# sourceMappingURL=gemini.d.ts.map