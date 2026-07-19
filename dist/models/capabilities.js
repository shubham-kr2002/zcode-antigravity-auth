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
const CAPABILITY_RULES = [
    // ============================================
    // Claude Models
    // ============================================
    {
        pattern: /^claude-.*thinking/i,
        priority: 20,
        capabilities: (_id) => ({
            context: 200000,
            output: 64000,
            modalities: { input: ["text"], output: ["text"] },
            reasoning: {
                enabled: true,
                variants: ["low", "medium", "high"],
                defaultVariant: "high",
            },
        }),
    },
    {
        pattern: /^claude-/i,
        priority: 15,
        capabilities: (_id) => ({
            context: 200000,
            output: 64000,
            modalities: { input: ["text"], output: ["text"] },
        }),
    },
    // ============================================
    // Gemini Image Generation Models
    // ============================================
    {
        pattern: /image|imagen/i,
        priority: 25,
        capabilities: (_id) => ({
            context: 1048576,
            output: 65536,
            modalities: { input: ["text"], output: ["image"] },
        }),
    },
    // ============================================
    // Gemini 3.x Pro Models (pre-suffixed, tiered at API level)
    // ============================================
    {
        pattern: /^gemini-3(?:\.\d+)?-pro-high/i,
        priority: 24,
        capabilities: (_id) => ({
            context: 1048576,
            output: 65535,
            modalities: { input: ["text", "image", "pdf"], output: ["text"] },
            reasoning: { enabled: true, variants: ["high"], defaultVariant: "high" },
        }),
    },
    {
        pattern: /^gemini-3(?:\.\d+)?-pro-low/i,
        priority: 24,
        capabilities: (_id) => ({
            context: 1048576,
            output: 65535,
            modalities: { input: ["text", "image", "pdf"], output: ["text"] },
            reasoning: { enabled: true, variants: ["low"], defaultVariant: "low" },
        }),
    },
    {
        pattern: /^gemini-3(?:\.\d+)?-pro/i,
        priority: 22,
        capabilities: (_id) => ({
            context: 1048576,
            output: 65535,
            modalities: { input: ["text", "image", "pdf"], output: ["text"] },
            reasoning: { enabled: true, variants: ["low", "high"], defaultVariant: "high" },
        }),
    },
    // ============================================
    // Gemini 3.x Flash Models (pre-suffixed, tiered at API level)
    // ============================================
    {
        pattern: /^gemini-3(?:\.\d+)?-flash-extra-low/i,
        priority: 24,
        capabilities: (_id) => ({
            context: 1048576,
            output: 65536,
            modalities: { input: ["text"], output: ["text"] },
            reasoning: { enabled: true, variants: ["minimal"], defaultVariant: "minimal" },
        }),
    },
    {
        pattern: /^gemini-3(?:\.\d+)?-flash-low/i,
        priority: 24,
        capabilities: (_id) => ({
            context: 1048576,
            output: 65536,
            modalities: { input: ["text"], output: ["text"] },
            reasoning: { enabled: true, variants: ["low"], defaultVariant: "low" },
        }),
    },
    {
        pattern: /^gemini-3(?:\.\d+)?-flash-medium/i,
        priority: 24,
        capabilities: (_id) => ({
            context: 1048576,
            output: 65536,
            modalities: { input: ["text"], output: ["text"] },
            reasoning: { enabled: true, variants: ["medium"], defaultVariant: "medium" },
        }),
    },
    {
        pattern: /^gemini-3(?:\.\d+)?-flash-high/i,
        priority: 24,
        capabilities: (_id) => ({
            context: 1048576,
            output: 65536,
            modalities: { input: ["text"], output: ["text"] },
            reasoning: { enabled: true, variants: ["high"], defaultVariant: "high" },
        }),
    },
    {
        pattern: /^gemini-3(?:\.\d+)?-flash-lite/i,
        priority: 23,
        capabilities: (_id) => ({
            context: 1048576,
            output: 65536,
            modalities: { input: ["text"], output: ["text"] },
            reasoning: { enabled: true, variants: ["low", "medium", "high"], defaultVariant: "medium" },
        }),
    },
    {
        pattern: /^gemini-3(?:\.\d+)?-flash-agent/i,
        priority: 23,
        capabilities: (_id) => ({
            context: 1048576,
            output: 65536,
            modalities: { input: ["text"], output: ["text"] },
        }),
    },
    {
        pattern: /^gemini-3(?:\.\d+)?-flash/i,
        priority: 20,
        capabilities: (_id) => ({
            context: 1048576,
            output: 65536,
            modalities: { input: ["text", "image", "pdf"], output: ["text"] },
            reasoning: {
                enabled: true,
                variants: ["minimal", "low", "medium", "high"],
                defaultVariant: "high",
            },
        }),
    },
    // ============================================
    // Gemini 2.5 Models (Gemini CLI)
    // ============================================
    {
        pattern: /^gemini-2\.5-pro/i,
        priority: 18,
        capabilities: (_id) => ({
            context: 1048576,
            output: 65535,
            modalities: { input: ["text", "image", "pdf"], output: ["text"] },
            reasoning: { enabled: true, variants: ["low", "medium", "high"], defaultVariant: "high" },
        }),
    },
    {
        pattern: /^gemini-2\.5-flash-lite/i,
        priority: 18,
        capabilities: (_id) => ({
            context: 1048576,
            output: 65536,
            modalities: { input: ["text"], output: ["text"] },
            reasoning: { enabled: true, variants: ["low", "medium", "high"], defaultVariant: "medium" },
        }),
    },
    {
        pattern: /^gemini-2\.5-flash/i,
        priority: 17,
        capabilities: (_id) => ({
            context: 1048576,
            output: 65536,
            modalities: { input: ["text", "image", "pdf"], output: ["text"] },
            reasoning: { enabled: true, variants: ["low", "medium", "high"], defaultVariant: "high" },
        }),
    },
    // ============================================
    // Gemini Agent Models
    // ============================================
    {
        pattern: /-agent/i,
        priority: 16,
        capabilities: (_id) => ({
            context: 1048576,
            output: 65535,
            modalities: { input: ["text"], output: ["text"] },
        }),
    },
    // ============================================
    // GPT / non-Gemini/Claude models via Antigravity
    // ============================================
    {
        pattern: /^gpt-|^o[0-9]+-/i,
        priority: 14,
        capabilities: (_id) => ({
            context: 131072,
            output: 16384,
            modalities: { input: ["text"], output: ["text"] },
        }),
    },
];
// ---- Default Capabilities ----
const DEFAULT_CAPABILITIES = {
    context: 1048576,
    output: 65536,
    modalities: { input: ["text"], output: ["text"] },
};
/**
 * Infer capabilities for a model based on its ID and optional display name.
 * Rules are matched in priority order — first match wins.
 *
 * For unknown models, returns sensible defaults based on model family heuristics.
 */
export function inferModelCapabilities(modelId, displayName) {
    // Sort rules by priority (descending) — highest priority first
    const sorted = [...CAPABILITY_RULES].sort((a, b) => b.priority - a.priority);
    for (const rule of sorted) {
        if (rule.pattern.test(modelId)) {
            return rule.capabilities(modelId, displayName);
        }
    }
    // ---- Fallback: infer from model ID patterns ----
    // Claude models: 200K context, text-only
    if (/claude/i.test(modelId)) {
        const hasThinking = /thinking/i.test(modelId);
        return {
            context: 200000,
            output: 64000,
            modalities: { input: ["text"], output: ["text"] },
            ...(hasThinking && {
                reasoning: {
                    enabled: true,
                    variants: ["low", "medium", "high"],
                    defaultVariant: "high",
                },
            }),
        };
    }
    // Gemini models: 1M context, multimodal
    if (/gemini/i.test(modelId)) {
        const isPro = /pro/i.test(modelId);
        const isFlashLite = /flash-lite/i.test(modelId);
        const isThinking = /thinking/i.test(modelId);
        const hasPreSuffixedTier = /-(minimal|extra-low|low|medium|high)$/i.test(modelId);
        // If model name already has a tier suffix, it's a single-tier model
        if (hasPreSuffixedTier) {
            const tier = modelId.match(/-(minimal|extra-low|low|medium|high)$/i)?.[1]?.toLowerCase() ?? "high";
            const variantLabel = tier === "extra-low" ? "minimal" : tier;
            return {
                context: 1048576,
                output: isPro ? 65535 : 65536,
                modalities: {
                    input: isFlashLite ? ["text"] : ["text", "image", "pdf"],
                    output: ["text"],
                },
                reasoning: {
                    enabled: true,
                    variants: [variantLabel],
                    defaultVariant: variantLabel,
                },
            };
        }
        // Agent models: no thinking
        if (/agent/i.test(modelId)) {
            return {
                context: 1048576,
                output: 65535,
                modalities: { input: ["text"], output: ["text"] },
            };
        }
        // Regular Gemini thinking model
        return {
            context: 1048576,
            output: isPro ? 65535 : 65536,
            modalities: {
                input: isFlashLite ? ["text"] : ["text", "image", "pdf"],
                output: ["text"],
            },
            ...(isThinking && {
                reasoning: {
                    enabled: true,
                    variants: ["low", "medium", "high"],
                    defaultVariant: "high",
                },
            }),
        };
    }
    // GPT/other models
    if (/gpt|openai/i.test(modelId)) {
        return {
            context: 131072,
            output: 16384,
            modalities: { input: ["text"], output: ["text"] },
        };
    }
    // Completely unknown model — conservative defaults
    return { ...DEFAULT_CAPABILITIES };
}
/**
 * Determine if a model supports thinking tiers.
 * Used by the model resolver to decide whether to append tier suffixes.
 */
export function supportsThinkingTiers(modelId) {
    const lower = modelId.toLowerCase();
    return (lower.includes("gemini-3") ||
        lower.includes("gemini-2.5") ||
        (lower.includes("claude") && lower.includes("thinking")));
}
/**
 * Determine if a model name already contains a tier suffix
 * (i.e., the API model itself encodes the tier, like "gemini-3.1-pro-high").
 */
export function hasPreSuffixedTier(modelId) {
    return /-(minimal|extra-low|low|medium|high)$/i.test(modelId);
}
/**
 * Extract the tier from a pre-suffixed model name.
 */
export function extractTierFromModel(modelId) {
    return modelId.match(/-(minimal|extra-low|low|medium|high)$/i)?.[1]?.toLowerCase();
}
//# sourceMappingURL=capabilities.js.map