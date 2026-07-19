/**
 * Model Resolution with Thinking Tier Support
 *
 * Resolves model names with tier suffixes (e.g., gemini-3-pro-high, claude-opus-4-6-thinking-low)
 * to their actual API model names and corresponding thinking configurations.
 */
import { supportsThinkingTiers as inferSupportsThinkingTiers, } from "../models/index.js";
// ---- Module-level registry reference ----
// Set by server.ts after model discovery. Defaults to an empty registry.
let _registry = {
    models: [],
    nameMap: {},
    capabilities: {},
    aliases: {},
    preSuffixedModels: new Set(),
};
/**
 * Update the model registry reference used for resolution.
 * Called by server.ts after initModelRegistry().
 */
export function setModelRegistryForResolution(registry) {
    _registry = registry;
}
function getRegistry() {
    return _registry;
}
// ---- Thinking Tier Budgets ----
export const THINKING_TIER_BUDGETS = {
    claude: { low: 8192, medium: 16384, high: 32768 },
    "gemini-2.5-pro": { low: 8192, medium: 16384, high: 32768 },
    "gemini-2.5-flash": { low: 6144, medium: 12288, high: 24576 },
    "gemini-2.5-flash-lite": { low: 4096, medium: 8192, high: 16384 },
    default: { low: 4096, medium: 8192, high: 16384 },
};
// ---- Model Aliases (dynamic + fallback) ----
/** Hardcoded fallback aliases when registry is unavailable */
const FALLBACK_MODEL_ALIASES = {
    // Gemini 3 Flash variants
    "gemini-3-flash-minimal": "gemini-3-flash",
    "gemini-3-flash-low": "gemini-3-flash",
    "gemini-3-flash-medium": "gemini-3-flash",
    "gemini-3-flash-high": "gemini-3-flash",
    // Gemini 2.5 Flash variants
    "gemini-2.5-flash-low": "gemini-2.5-flash",
    "gemini-2.5-flash-medium": "gemini-2.5-flash",
    "gemini-2.5-flash-high": "gemini-2.5-flash",
    // Gemini 2.5 Flash Lite variants
    "gemini-2.5-flash-lite-low": "gemini-2.5-flash-lite",
    "gemini-2.5-flash-lite-medium": "gemini-2.5-flash-lite",
    "gemini-2.5-flash-lite-high": "gemini-2.5-flash-lite",
    // Gemini 3.1 Pro — API models ARE tier-suffixed (identity aliases)
    "gemini-3.1-pro-low": "gemini-3.1-pro-low",
    // Gemini 3.5 Flash — API models ARE tier-suffixed (identity aliases)
    "gemini-3.5-flash-low": "gemini-3.5-flash-low",
    "gemini-3.5-flash-extra-low": "gemini-3.5-flash-extra-low",
    // Claude proxy names (gemini- prefix for compatibility)
    "gemini-claude-opus-4-6-thinking-low": "claude-opus-4-6-thinking",
    "gemini-claude-opus-4-6-thinking-medium": "claude-opus-4-6-thinking",
    "gemini-claude-opus-4-6-thinking-high": "claude-opus-4-6-thinking",
    "gemini-claude-sonnet-4-6": "claude-sonnet-4-6",
};
// Export for backward compatibility — dynamically resolves aliases
export const MODEL_ALIASES = new Proxy({}, {
    get(_target, prop) {
        const registry = getRegistry();
        // Check registry aliases first (auto-discovered)
        if (registry.aliases[prop] !== undefined)
            return registry.aliases[prop];
        // Fall back to hardcoded
        return FALLBACK_MODEL_ALIASES[prop];
    },
    ownKeys() {
        const registry = getRegistry();
        return [...new Set([...Object.keys(registry.aliases), ...Object.keys(FALLBACK_MODEL_ALIASES)])];
    },
    getOwnPropertyDescriptor(_target, prop) {
        const registry = getRegistry();
        const val = registry.aliases[prop] ?? FALLBACK_MODEL_ALIASES[prop];
        if (val === undefined)
            return undefined;
        return {
            configurable: true,
            enumerable: true,
            value: val,
            writable: true,
        };
    },
});
/**
 * Get a direct copy of the alias map (for iteration/export).
 */
export function getModelAliases() {
    const registry = getRegistry();
    return { ...FALLBACK_MODEL_ALIASES, ...registry.aliases };
}
// ---- Direct Model Name Map (public → Antigravity internal) ----
// Falls back to hardcoded map when registry hasn't been populated yet.
const FALLBACK_MODEL_NAME_MAP = {
    // Claude models
    "claude-opus-4-6-thinking": "claude-opus-4-6-thinking",
    "claude-sonnet-4-6": "claude-sonnet-4-6",
    // Gemini 2.5 models
    "gemini-2.5-flash": "gemini-2.5-flash",
    "gemini-2.5-flash-lite": "gemini-2.5-flash-lite",
    "gemini-2.5-flash-thinking": "gemini-2.5-flash-thinking",
    // Gemini 3 models
    "gemini-3-flash": "gemini-3-flash",
    "gemini-3-flash-agent": "gemini-3-flash-agent",
    // Gemini 3.1 models (API uses tier-suffixed names directly)
    "gemini-3.1-pro-low": "gemini-3.1-pro-low",
    "gemini-3.1-flash-lite": "gemini-3.1-flash-lite",
    "gemini-3.1-flash-image": "gemini-3.1-flash-image",
    // Gemini 3.5 models (API uses tier-suffixed names directly)
    "gemini-3.5-flash-low": "gemini-3.5-flash-low",
    "gemini-3.5-flash-extra-low": "gemini-3.5-flash-extra-low",
    // GPT via Antigravity
    "gpt-oss-120b-medium": "gpt-oss-120b-medium",
};
function getModelNameMap() {
    const registry = getRegistry();
    // Merge: registry takes precedence, fallback for anything missing
    return { ...FALLBACK_MODEL_NAME_MAP, ...registry.nameMap };
}
// ---- Regex Patterns ----
const TIER_REGEX = /-(minimal|extra-low|low|medium|high)$/;
const QUOTA_PREFIX_REGEX = /^antigravity-/i;
const GEMINI_3_PRO_REGEX = /^gemini-3(?:\.\d+)?-pro/i;
// ---- Image Generation Detection ----
const IMAGE_GENERATION_MODELS = /image|imagen/i;
// ---- Functions ----
/**
 * Checks if a model supports thinking tier suffixes.
 * Uses the registry-aware inference engine first, falls back to heuristics.
 */
function supportsThinkingTiers(model) {
    // Try registry-based inference first
    const registryResult = inferSupportsThinkingTiers(model);
    if (registryResult)
        return true;
    // Fallback heuristics
    const lower = model.toLowerCase();
    return (lower.includes("gemini-3") ||
        lower.includes("gemini-2.5") ||
        (lower.includes("claude") && lower.includes("thinking")));
}
/**
 * Extracts thinking tier from model name suffix.
 */
function extractThinkingTierFromModel(model) {
    if (!supportsThinkingTiers(model))
        return undefined;
    const tierMatch = model.match(TIER_REGEX);
    return tierMatch?.[1];
}
/**
 * Determines the budget family for a model.
 */
function getBudgetFamily(model) {
    if (model.includes("claude"))
        return "claude";
    if (model.includes("gemini-2.5-pro"))
        return "gemini-2.5-pro";
    if (model.includes("gemini-2.5-flash-lite"))
        return "gemini-2.5-flash-lite";
    if (model.includes("gemini-2.5-flash"))
        return "gemini-2.5-flash";
    return "default";
}
/**
 * Checks if a model is thinking-capable.
 */
function isThinkingCapableModel(model) {
    const lower = model.toLowerCase();
    return (lower.includes("thinking") ||
        lower.includes("gemini-3") ||
        lower.includes("gemini-2.5"));
}
/**
 * Resolves a model name with optional tier suffix and quota prefix.
 *
 * Examples:
 * - "gemini-2.5-flash" → { quotaPreference: "antigravity" }
 * - "gemini-3-pro-high" → { thinkingLevel: "high", tier: "high" }
 * - "claude-opus-4-6-thinking-medium" → { thinkingBudget: 16384, tier: "medium" }
 */
export function resolveModelWithTier(requestedModel, options = {}) {
    const isAntigravity = QUOTA_PREFIX_REGEX.test(requestedModel);
    const modelWithoutQuota = requestedModel.replace(QUOTA_PREFIX_REGEX, "");
    const tier = extractThinkingTierFromModel(modelWithoutQuota);
    const baseName = tier
        ? modelWithoutQuota.replace(TIER_REGEX, "")
        : modelWithoutQuota;
    const isImageModel = IMAGE_GENERATION_MODELS.test(modelWithoutQuota);
    const isClaudeModel = modelWithoutQuota.toLowerCase().includes("claude");
    // All models default to Antigravity quota unless cli_first is enabled
    const preferGeminiCli = options.cli_first === true &&
        !isAntigravity &&
        !isImageModel &&
        !isClaudeModel;
    const quotaPreference = preferGeminiCli
        ? "gemini-cli"
        : "antigravity";
    const explicitQuota = isAntigravity || isImageModel;
    const isGemini3 = modelWithoutQuota.toLowerCase().startsWith("gemini-3");
    const skipAlias = isAntigravity && isGemini3;
    // For Antigravity Gemini 3 Pro models without explicit tier, append default tier
    const isGemini3Pro = GEMINI_3_PRO_REGEX.test(modelWithoutQuota);
    let antigravityModel = modelWithoutQuota;
    if (skipAlias) {
        if (isGemini3Pro && !tier && !isImageModel) {
            antigravityModel = `${modelWithoutQuota}-low`;
        }
        else if (!isGemini3Pro && tier) {
            // Gemini 3 Flash uses bare name + thinkingLevel; strip tier from model name
            antigravityModel = baseName;
        }
    }
    let actualModel = skipAlias
        ? antigravityModel
        : MODEL_ALIASES[modelWithoutQuota] ||
            MODEL_ALIASES[baseName] ||
            baseName;
    // For Gemini 3 Pro models going to Antigravity (even without explicit prefix),
    // the API requires tier suffix in the model name (e.g., "gemini-3-pro-low")
    if (!skipAlias && isGemini3Pro && !tier && quotaPreference === "antigravity" && !isImageModel) {
        actualModel = `${actualModel}-low`;
    }
    const resolvedModel = actualModel;
    const isThinking = isThinkingCapableModel(resolvedModel);
    // Image generation models don't support thinking
    if (isImageModel) {
        return {
            actualModel: resolvedModel,
            isThinkingModel: false,
            isImageModel: true,
            quotaPreference,
            explicitQuota,
        };
    }
    // Check if this is a Gemini 3 model
    const isEffectiveGemini3 = resolvedModel.toLowerCase().includes("gemini-3");
    const isClaudeThinking = resolvedModel.toLowerCase().includes("claude") &&
        resolvedModel.toLowerCase().includes("thinking");
    if (!tier) {
        // Gemini 3 models without explicit tier get a default thinkingLevel
        if (isEffectiveGemini3) {
            return {
                actualModel: resolvedModel,
                thinkingLevel: "low",
                isThinkingModel: true,
                quotaPreference,
                explicitQuota,
            };
        }
        // Claude thinking models without explicit tier get max budget
        if (isClaudeThinking) {
            return {
                actualModel: resolvedModel,
                thinkingBudget: THINKING_TIER_BUDGETS.claude.high,
                isThinkingModel: true,
                quotaPreference,
                explicitQuota,
            };
        }
        return {
            actualModel: resolvedModel,
            isThinkingModel: isThinking,
            quotaPreference,
            explicitQuota,
        };
    }
    // Gemini 3 models with tier always get thinkingLevel set
    if (isEffectiveGemini3) {
        // For pre-suffixed API models (e.g., "gemini-3.1-pro-high" maps to itself),
        // the API handles thinking via the model name — don't set thinkingLevel.
        // For alias-transformed models (e.g., "gemini-3-flash-high" → "gemini-3-flash"),
        // set thinkingLevel explicitly.
        const isPreSuffixed = MODEL_ALIASES[modelWithoutQuota] === modelWithoutQuota;
        const shouldSetLevel = tier && !isPreSuffixed && tier !== "extra-low";
        const effectiveLevel = shouldSetLevel ? tier : undefined;
        return {
            actualModel: resolvedModel,
            ...(effectiveLevel ? { thinkingLevel: effectiveLevel, tier } : {}),
            isThinkingModel: true,
            quotaPreference,
            explicitQuota,
        };
    }
    const budgetFamily = getBudgetFamily(resolvedModel);
    const budgets = THINKING_TIER_BUDGETS[budgetFamily];
    // "minimal" and "extra-low" tiers map to "low" budget
    const budgetKey = tier === "minimal" || tier === "extra-low" ? "low" : tier;
    const thinkingBudget = budgets[budgetKey];
    return {
        actualModel: resolvedModel,
        thinkingBudget,
        tier,
        isThinkingModel: isThinking,
        quotaPreference,
        explicitQuota,
    };
}
/**
 * Gets the model family for routing decisions.
 */
export function getModelFamily(model) {
    const lower = model.toLowerCase();
    if (lower.includes("claude"))
        return "claude";
    return "gemini";
}
/**
 * Check if a model is a Claude model.
 */
export function isClaudeModel(model) {
    return model.toLowerCase().includes("claude");
}
/**
 * Check if a model is a Claude thinking model.
 */
export function isClaudeThinkingModel(model) {
    const lower = model.toLowerCase();
    return lower.includes("claude") && lower.includes("thinking");
}
/**
 * Check if a model is a Gemini 3 model (uses thinkingLevel string).
 */
export function isGemini3Model(model) {
    return model.toLowerCase().includes("gemini-3");
}
/**
 * Check if a model is a Gemini 2.5 model (uses numeric thinkingBudget).
 */
export function isGemini25Model(model) {
    return model.toLowerCase().includes("gemini-2.5");
}
/**
 * Resolves model name for a specific header style (quota fallback support).
 */
export function resolveModelForHeaderStyle(requestedModel, headerStyle) {
    const lower = requestedModel.toLowerCase();
    const isGemini3 = lower.includes("gemini-3");
    if (!isGemini3) {
        return resolveModelWithTier(requestedModel);
    }
    if (headerStyle === "antigravity") {
        let transformedModel = requestedModel
            .replace(/-preview-customtools$/i, "")
            .replace(/-preview$/i, "")
            .replace(/^antigravity-/i, "");
        const isGemini3Pro = GEMINI_3_PRO_REGEX.test(transformedModel);
        const hasTierSuffix = /-(low|medium|high)$/i.test(transformedModel);
        const isImageModel = IMAGE_GENERATION_MODELS.test(transformedModel);
        if (isGemini3Pro && !hasTierSuffix && !isImageModel) {
            transformedModel = `${transformedModel}-low`;
        }
        const prefixedModel = `antigravity-${transformedModel}`;
        return resolveModelWithTier(prefixedModel);
    }
    if (headerStyle === "gemini-cli") {
        let transformedModel = requestedModel
            .replace(/^antigravity-/i, "")
            .replace(/-(low|medium|high)$/i, "");
        const hasPreviewSuffix = /-preview($|-)/i.test(transformedModel);
        if (!hasPreviewSuffix) {
            transformedModel = `${transformedModel}-preview`;
        }
        return {
            ...resolveModelWithTier(transformedModel),
            quotaPreference: "gemini-cli",
        };
    }
    return resolveModelWithTier(requestedModel);
}
/**
 * Resolves the Antigravity internal model name from a public model name.
 * Kept for backward compatibility with existing request.ts.
 * Uses the dynamic model registry when available, falls back to hardcoded map.
 */
export function resolveAntigravityModel(modelName) {
    const nameMap = getModelNameMap();
    return nameMap[modelName] ?? modelName;
}
//# sourceMappingURL=model-resolver.js.map