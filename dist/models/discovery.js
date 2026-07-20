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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getZCodeDir } from "../config.js";
import { ANTIGRAVITY_ENDPOINT_PROD, getAntigravityHeaders } from "../constants.js";
import { inferModelCapabilities } from "./capabilities.js";
// ---- Cache ----
const CACHE_TTL_MS = getModelCacheTtlMs();
/** @internal exported for testing */
export function getModelCacheTtlMs() {
    const env = process.env.ANTIGRAVITY_MODEL_CACHE_TTL_MINUTES;
    const minutes = env ? Number.parseInt(env, 10) : 60;
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60 * 1000;
}
function getCachePath() {
    return join(getZCodeDir(), "antigravity-models-cache.json");
}
export function loadModelCache() {
    const path = getCachePath();
    if (!existsSync(path))
        return null;
    try {
        const raw = readFileSync(path, "utf8");
        const cache = JSON.parse(raw);
        if (!cache.updatedAt || !cache.models)
            return null;
        // Check freshness
        const age = Date.now() - cache.updatedAt;
        if (age > CACHE_TTL_MS)
            return null; // Stale
        return cache;
    }
    catch {
        return null;
    }
}
export function saveModelCache(models) {
    const path = getCachePath();
    const dir = join(path, "..");
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    const cache = {
        updatedAt: Date.now(),
        models,
    };
    writeFileSync(path, JSON.stringify(cache, null, 2) + "\n", "utf8");
}
// ---- API Call ----
const FETCH_TIMEOUT_MS = 10000;
async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    }
    finally {
        clearTimeout(timeout);
    }
}
export async function fetchAvailableModelsFromAPI(accessToken, projectId) {
    const endpoint = ANTIGRAVITY_ENDPOINT_PROD;
    const quotaUserAgent = getAntigravityHeaders()["User-Agent"] || "antigravity/windows/amd64";
    const body = projectId ? { project: projectId } : {};
    const response = await fetchWithTimeout(`${endpoint}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "User-Agent": quotaUserAgent,
        },
        body: JSON.stringify(body),
    });
    if (response.ok) {
        return (await response.json());
    }
    throw new Error(`fetchAvailableModels failed: ${response.status}`);
}
// ---- Model Registry Builder ----
/** Thinking tiers recognized by the system */
const THINKING_TIERS = ["minimal", "extra-low", "low", "medium", "high"];
/** Models we intentionally exclude (internal/experimental only) */
const EXCLUDED_MODELS = /^(?:chat-bison|code-bison|chat_|test-|internal-|gemini-2\.5-pro$|gemini-3-pro$|gemini-3\.1-pro-high$|gemini-pro-agent$)/i;
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
export function buildModelRegistry(apiResponse) {
    const models = [];
    const nameMap = {};
    const capabilities = {};
    const aliases = {};
    const preSuffixedModels = new Set();
    if (!apiResponse.models) {
        return { models, nameMap, capabilities, aliases, preSuffixedModels };
    }
    const created = Math.floor(Date.now() / 1000);
    const modelIds = Object.keys(apiResponse.models);
    // Sort for deterministic output
    modelIds.sort((a, b) => a.localeCompare(b));
    for (const modelId of modelIds) {
        // Skip excluded models
        if (EXCLUDED_MODELS.test(modelId))
            continue;
        const entry = apiResponse.models[modelId];
        if (!entry)
            continue;
        // Use modelName from API if available, otherwise modelId key
        const publicName = entry.modelName ?? modelId;
        const displayName = entry.displayName;
        // Add to OpenAI model list
        models.push({
            id: publicName,
            object: "model",
            created,
            owned_by: "antigravity",
        });
        // Name map: public name → internal API name (usually identity)
        nameMap[publicName] = modelId;
        // Infer capabilities
        capabilities[publicName] = inferModelCapabilities(publicName, displayName);
        // Detect pre-suffixed models (tier encoded in API name itself)
        const isPreSuffixed = /-(minimal|extra-low|low|medium|high)$/i.test(publicName);
        if (isPreSuffixed) {
            preSuffixedModels.add(publicName);
            // Pre-suffixed model IS its own alias
            aliases[publicName] = publicName;
        }
    }
    // For pre-suffixed models, add reverse aliases from the base name
    // to a default tier variant. Prefer "-low" as the default, falling back
    // to the "lowest" alphabetical tier if no "-low" variant exists.
    const baseNameToVariant = new Map();
    const TIER_ORDER = ["low", "medium", "high", "extra-low", "minimal"]; // prefer low
    for (const modelId of modelIds) {
        if (EXCLUDED_MODELS.test(modelId))
            continue;
        const entry = apiResponse.models[modelId];
        const publicName = entry?.modelName ?? modelId;
        if (!preSuffixedModels.has(publicName))
            continue;
        const baseName = publicName.replace(/-(minimal|extra-low|low|medium|high)$/i, "");
        const existingVariant = baseNameToVariant.get(baseName);
        if (!existingVariant) {
            baseNameToVariant.set(baseName, publicName);
        }
        else {
            // Pick the preferred tier (lower index = preferred)
            const existingTier = (existingVariant.match(/-(minimal|extra-low|low|medium|high)$/i)?.[1] ?? "").toLowerCase();
            const currentTier = (publicName.match(/-(minimal|extra-low|low|medium|high)$/i)?.[1] ?? "").toLowerCase();
            const existingRank = TIER_ORDER.indexOf(existingTier);
            const currentRank = TIER_ORDER.indexOf(currentTier);
            if (existingRank === -1 || (currentRank !== -1 && currentRank < existingRank)) {
                baseNameToVariant.set(baseName, publicName);
            }
        }
    }
    for (const [baseName, publicName] of baseNameToVariant) {
        aliases[baseName] = publicName;
    }
    // Generate aliases for thinking-capable non-pre-suffixed models
    for (const modelId of modelIds) {
        if (EXCLUDED_MODELS.test(modelId))
            continue;
        const entry = apiResponse.models[modelId];
        const publicName = entry?.modelName ?? modelId;
        if (preSuffixedModels.has(publicName))
            continue;
        const cap = capabilities[publicName];
        if (!cap?.reasoning?.enabled)
            continue;
        const variants = cap.reasoning.variants;
        for (let ti = 0; ti < variants.length; ti++) {
            const tier = variants[ti];
            // Skip if tier is already in the model name
            if (publicName.endsWith(`-${tier}`))
                continue;
            const aliasName = `${publicName}-${tier}`;
            aliases[aliasName] = publicName;
        }
    }
    // Also generate Claude proxy aliases (gemini- prefixed for compatibility)
    for (const [modelId, cap] of Object.entries(capabilities)) {
        const lower = modelId.toLowerCase();
        if (!lower.includes("claude"))
            continue;
        if (lower.includes("thinking")) {
            for (const tier of THINKING_TIERS) {
                // Skip tiers that don't apply to Claude
                if (tier === "minimal" || tier === "extra-low")
                    continue;
                const aliasName = `gemini-${modelId}-${tier}`;
                aliases[aliasName] = modelId;
            }
        }
        else {
            const aliasName = `gemini-${modelId}`;
            aliases[aliasName] = modelId;
        }
    }
    return { models, nameMap, capabilities, aliases, preSuffixedModels };
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
export async function discoverModels(accessToken, projectId) {
    // 1. Try cache first
    const cache = loadModelCache();
    if (cache) {
        // Build a synthetic API response from the cache
        const syntheticResponse = {
            models: {},
        };
        for (const [id, entry] of Object.entries(cache.models)) {
            syntheticResponse.models[id] = {
                displayName: entry.displayName,
                modelName: id,
            };
        }
        const registry = buildModelRegistry(syntheticResponse);
        return {
            registry,
            source: "cache",
            modelCount: registry.models.length,
        };
    }
    // 2. Call the API
    try {
        const apiResponse = await fetchAvailableModelsFromAPI(accessToken, projectId);
        const registry = buildModelRegistry(apiResponse);
        // Save to cache for next time
        const cacheData = {};
        for (const model of registry.models) {
            cacheData[model.id] = {
                displayName: registry.capabilities[model.id]
                    ? undefined // Could store display name from API response, but it's not in our registry
                    : undefined,
            };
        }
        // Save the actual API models to cache
        if (apiResponse.models) {
            saveModelCache(Object.fromEntries(Object.entries(apiResponse.models).map(([id, entry]) => [
                id,
                { displayName: entry.displayName },
            ])));
        }
        return {
            registry,
            source: "api",
            modelCount: registry.models.length,
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            registry: { models: [], nameMap: {}, capabilities: {}, aliases: {}, preSuffixedModels: new Set() },
            source: "fallback",
            modelCount: 0,
            error: message,
        };
    }
}
/**
 * Get the path where the model cache is stored.
 */
export { getCachePath as getModelCachePath };
//# sourceMappingURL=discovery.js.map