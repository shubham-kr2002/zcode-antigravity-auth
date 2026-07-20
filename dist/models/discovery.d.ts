/**
 * Model Discovery Engine
 *
 * Auto-discovers available models from the Antigravity API's
 * `fetchAvailableModels` endpoint. Caches results to disk to
 * avoid excessive API calls on every startup.
 *
 * New models released on Antigravity are automatically picked up
 * without any code changes — just restart the proxy.
 */
import { type ModelCapabilities } from "./capabilities.js";
/** A single model entry for the OpenAI-compatible /v1/models endpoint */
export interface OpenAIModelEntry {
    id: string;
    object: "model";
    created: number;
    owned_by: string;
}
/** Internal model registry built from API discovery */
export interface ModelRegistryData {
    /** Models listed at /v1/models */
    models: OpenAIModelEntry[];
    /** Public name → Antigravity internal name map (MODEL_NAME_MAP replacement) */
    nameMap: Record<string, string>;
    /** Model ID → capabilities (for ZCode config generation) */
    capabilities: Record<string, ModelCapabilities>;
    /** Alias map: tier-suffixed names → base model names */
    aliases: Record<string, string>;
    /** Model IDs that are pre-suffixed (tier encoded in API model name) */
    preSuffixedModels: Set<string>;
}
/** Cached model list from API */
interface ModelCache {
    updatedAt: number;
    /** Keyed by model ID from API */
    models: Record<string, {
        displayName?: string;
    }>;
}
/** API response from fetchAvailableModels */
interface FetchAvailableModelsResponse {
    models?: Record<string, FetchAvailableModelEntry>;
}
interface FetchAvailableModelEntry {
    quotaInfo?: {
        remainingFraction?: number;
        resetTime?: string;
    };
    displayName?: string;
    modelName?: string;
}
/** @internal exported for testing */
export declare function getModelCacheTtlMs(): number;
declare function getCachePath(): string;
export declare function loadModelCache(): ModelCache | null;
export declare function saveModelCache(models: Record<string, {
    displayName?: string;
}>): void;
export declare function fetchAvailableModelsFromAPI(accessToken: string, projectId: string): Promise<FetchAvailableModelsResponse>;
/**
 * Build a complete ModelRegistry from the API response.
 *
 * This generates:
 * - OpenAI-compatible model list (for /v1/models)
 * - Name map (identity: public name → API name)
 * - Capabilities (inferred from model patterns)
 * - Aliases (tier-suffixed aliases for thinking models)
 * - Pre-suffixed model set
 */
export declare function buildModelRegistry(apiResponse: FetchAvailableModelsResponse): ModelRegistryData;
export type DiscoverySource = "cache" | "api" | "fallback";
export interface DiscoveryResult {
    registry: ModelRegistryData;
    source: DiscoverySource;
    modelCount: number;
    error?: string;
}
/**
 * Discover models from the Antigravity API using stored credentials.
 *
 * Strategy:
 * 1. Try loading from disk cache (fast, no API call)
 * 2. If cache is stale/missing, call the API with provided token
 * 3. If API call succeeds, save cache for next time
 * 4. If both fail, it's up to the caller to use fallback
 */
export declare function discoverModels(accessToken: string, projectId: string): Promise<DiscoveryResult>;
/**
 * Get the path where the model cache is stored.
 */
export { getCachePath as getModelCachePath };
//# sourceMappingURL=discovery.d.ts.map