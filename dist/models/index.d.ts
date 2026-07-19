/**
 * Models Module — Barrel Export
 *
 * Provides model discovery (auto-loading from Antigravity API),
 * capability inference, and the ModelRegistry data structure.
 */
export { ModelRegistryData, OpenAIModelEntry, DiscoveryResult, DiscoverySource, discoverModels, buildModelRegistry, fetchAvailableModelsFromAPI, loadModelCache, saveModelCache, getModelCachePath } from "./discovery.js";
export { ModelCapabilities, inferModelCapabilities, supportsThinkingTiers, hasPreSuffixedTier, extractTierFromModel } from "./capabilities.js";
//# sourceMappingURL=index.d.ts.map