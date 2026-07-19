/**
 * Model Resolution with Thinking Tier Support
 *
 * Resolves model names with tier suffixes (e.g., gemini-3-pro-high, claude-opus-4-6-thinking-low)
 * to their actual API model names and corresponding thinking configurations.
 */
import type { HeaderStyle, ModelFamily } from "../constants.js";
import { type ModelRegistryData } from "../models/index.js";
/**
 * Update the model registry reference used for resolution.
 * Called by server.ts after initModelRegistry().
 */
export declare function setModelRegistryForResolution(registry: ModelRegistryData): void;
export type ThinkingTier = "minimal" | "extra-low" | "low" | "medium" | "high";
export interface ResolvedModel {
    /** The actual model name for the API call */
    actualModel: string;
    /** Thinking level for Gemini 3 models */
    thinkingLevel?: string;
    /** Thinking budget for Claude/Gemini 2.5 */
    thinkingBudget?: number;
    /** The tier suffix that was extracted */
    tier?: ThinkingTier;
    /** Whether this is a thinking-capable model */
    isThinkingModel?: boolean;
    /** Whether this is an image generation model */
    isImageModel?: boolean;
    /** Quota preference */
    quotaPreference?: HeaderStyle;
    /** Whether user explicitly specified quota via suffix */
    explicitQuota?: boolean;
}
export declare const THINKING_TIER_BUDGETS: {
    readonly claude: {
        readonly low: 8192;
        readonly medium: 16384;
        readonly high: 32768;
    };
    readonly "gemini-2.5-pro": {
        readonly low: 8192;
        readonly medium: 16384;
        readonly high: 32768;
    };
    readonly "gemini-2.5-flash": {
        readonly low: 6144;
        readonly medium: 12288;
        readonly high: 24576;
    };
    readonly "gemini-2.5-flash-lite": {
        readonly low: 4096;
        readonly medium: 8192;
        readonly high: 16384;
    };
    readonly default: {
        readonly low: 4096;
        readonly medium: 8192;
        readonly high: 16384;
    };
};
export declare const MODEL_ALIASES: Record<string, string>;
/**
 * Get a direct copy of the alias map (for iteration/export).
 */
export declare function getModelAliases(): Record<string, string>;
export interface ModelResolverOptions {
    cli_first?: boolean;
}
/**
 * Resolves a model name with optional tier suffix and quota prefix.
 *
 * Examples:
 * - "gemini-2.5-flash" → { quotaPreference: "antigravity" }
 * - "gemini-3-pro-high" → { thinkingLevel: "high", tier: "high" }
 * - "claude-opus-4-6-thinking-medium" → { thinkingBudget: 16384, tier: "medium" }
 */
export declare function resolveModelWithTier(requestedModel: string, options?: ModelResolverOptions): ResolvedModel;
/**
 * Gets the model family for routing decisions.
 */
export declare function getModelFamily(model: string): ModelFamily;
/**
 * Check if a model is a Claude model.
 */
export declare function isClaudeModel(model: string): boolean;
/**
 * Check if a model is a Claude thinking model.
 */
export declare function isClaudeThinkingModel(model: string): boolean;
/**
 * Check if a model is a Gemini 3 model (uses thinkingLevel string).
 */
export declare function isGemini3Model(model: string): boolean;
/**
 * Check if a model is a Gemini 2.5 model (uses numeric thinkingBudget).
 */
export declare function isGemini25Model(model: string): boolean;
/**
 * Resolves model name for a specific header style (quota fallback support).
 */
export declare function resolveModelForHeaderStyle(requestedModel: string, headerStyle: HeaderStyle): ResolvedModel;
/**
 * Resolves the Antigravity internal model name from a public model name.
 * Kept for backward compatibility with existing request.ts.
 * Uses the dynamic model registry when available, falls back to hardcoded map.
 */
export declare function resolveAntigravityModel(modelName: string): string;
//# sourceMappingURL=model-resolver.d.ts.map