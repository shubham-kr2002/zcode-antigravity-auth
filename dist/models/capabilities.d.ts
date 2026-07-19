/**
 * Model Capability Inference Engine
 *
 * Maps model names (from the fetchAvailableModels API) to their
 * capabilities: context window, output limits, modalities, and
 * thinking/reasoning support.
 *
 * Uses pattern-based inference for unknown models so that newly
 * released models on Antigravity auto-work without code changes.
 */
export interface ModelCapabilities {
    context: number;
    output: number;
    modalities: {
        input: string[];
        output: string[];
    };
    reasoning?: {
        enabled: boolean;
        variants: string[];
        defaultVariant: string;
    };
}
/**
 * Infer capabilities for a model based on its ID and optional display name.
 * Rules are matched in priority order — first match wins.
 *
 * For unknown models, returns sensible defaults based on model family heuristics.
 */
export declare function inferModelCapabilities(modelId: string, displayName?: string): ModelCapabilities;
/**
 * Determine if a model supports thinking tiers.
 * Used by the model resolver to decide whether to append tier suffixes.
 */
export declare function supportsThinkingTiers(modelId: string): boolean;
/**
 * Determine if a model name already contains a tier suffix
 * (i.e., the API model itself encodes the tier, like "gemini-3.1-pro-high").
 */
export declare function hasPreSuffixedTier(modelId: string): boolean;
/**
 * Extract the tier from a pre-suffixed model name.
 */
export declare function extractTierFromModel(modelId: string): string | undefined;
//# sourceMappingURL=capabilities.d.ts.map