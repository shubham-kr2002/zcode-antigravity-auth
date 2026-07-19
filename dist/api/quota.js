/**
 * Quota checking via Antigravity API endpoints.
 * Ported from opencode-antigravity-auth plugin/quota.ts
 *
 * Fetches quota info for accounts using two endpoints:
 * - v1internal:fetchAvailableModels (Antigravity quota)
 * - v1internal:retrieveUserQuota (Gemini CLI quota)
 */
import { ANTIGRAVITY_ENDPOINT_PROD, getAntigravityHeaders, } from "../constants.js";
import { getModelFamily } from "./model-resolver.js";
const FETCH_TIMEOUT_MS = 10000;
// ---- Helpers ----
function normalizeRemainingFraction(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return 0;
    }
    if (value < 0)
        return 0;
    if (value > 1)
        return 1;
    return value;
}
function parseResetTime(resetTime) {
    if (!resetTime)
        return null;
    const timestamp = Date.parse(resetTime);
    if (!Number.isFinite(timestamp)) {
        return null;
    }
    return timestamp;
}
function classifyQuotaGroup(modelName, displayName) {
    const combined = `${modelName} ${displayName ?? ""}`.toLowerCase();
    if (combined.includes("claude")) {
        return "claude";
    }
    const isGemini3 = combined.includes("gemini-3") || combined.includes("gemini 3");
    if (!isGemini3) {
        return null;
    }
    const family = getModelFamily(modelName);
    return family === "gemini-flash" ? "gemini-flash" : "gemini-pro";
}
function aggregateQuota(models) {
    const groups = {};
    if (!models) {
        return { groups, modelCount: 0 };
    }
    let totalCount = 0;
    for (const [modelName, entry] of Object.entries(models)) {
        const group = classifyQuotaGroup(modelName, entry.displayName ?? entry.modelName);
        if (!group)
            continue;
        const quotaInfo = entry.quotaInfo;
        const remainingFraction = quotaInfo
            ? normalizeRemainingFraction(quotaInfo.remainingFraction)
            : undefined;
        const resetTime = quotaInfo?.resetTime;
        const resetTimestamp = parseResetTime(resetTime);
        totalCount += 1;
        const existing = groups[group];
        const nextCount = (existing?.modelCount ?? 0) + 1;
        const nextRemaining = remainingFraction === undefined
            ? existing?.remainingFraction
            : existing?.remainingFraction === undefined
                ? remainingFraction
                : Math.min(existing.remainingFraction, remainingFraction);
        let nextResetTime = existing?.resetTime;
        if (resetTimestamp !== null) {
            if (!existing?.resetTime) {
                nextResetTime = resetTime;
            }
            else {
                const existingTimestamp = parseResetTime(existing.resetTime);
                if (existingTimestamp === null || resetTimestamp < existingTimestamp) {
                    nextResetTime = resetTime;
                }
            }
        }
        groups[group] = {
            remainingFraction: nextRemaining,
            resetTime: nextResetTime,
            modelCount: nextCount,
        };
    }
    return { groups, modelCount: totalCount };
}
// ---- API Calls ----
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
async function fetchAvailableModels(accessToken, projectId) {
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
async function fetchGeminiCliQuota(accessToken, projectId) {
    const endpoint = ANTIGRAVITY_ENDPOINT_PROD;
    const platform = process.platform || "darwin";
    const arch = process.arch || "arm64";
    const geminiCliUserAgent = `GeminiCLI/1.0.0/gemini-2.5-pro (${platform}; ${arch})`;
    const body = projectId ? { project: projectId } : {};
    try {
        const response = await fetchWithTimeout(`${endpoint}/v1internal:retrieveUserQuota`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "User-Agent": geminiCliUserAgent,
            },
            body: JSON.stringify(body),
        });
        if (response.ok) {
            return (await response.json());
        }
        return { buckets: [] };
    }
    catch {
        return { buckets: [] };
    }
}
function aggregateGeminiCliQuota(response) {
    const models = [];
    if (!response.buckets || response.buckets.length === 0) {
        return { models };
    }
    for (const bucket of response.buckets) {
        if (!bucket.modelId)
            continue;
        const modelId = bucket.modelId;
        const isRelevantModel = modelId.startsWith("gemini-3-") ||
            modelId === "gemini-2.5-pro";
        if (!isRelevantModel)
            continue;
        models.push({
            modelId: bucket.modelId,
            remainingFraction: normalizeRemainingFraction(bucket.remainingFraction),
            resetTime: bucket.resetTime,
        });
    }
    models.sort((a, b) => a.modelId.localeCompare(b.modelId));
    return { models };
}
/**
 * Check quota for multiple accounts.
 * Fetches both Antigravity and Gemini CLI quotas in parallel for each account.
 *
 * @param accounts - List of accounts with refresh tokens
 * @param getAccessToken - Function to get/refresh access token for each account
 */
export async function checkAccountsQuota(accounts, getAccessToken) {
    const results = [];
    for (const [index, account] of accounts.entries()) {
        const disabled = !account.enabled;
        try {
            const { accessToken, projectId } = await getAccessToken(account.refreshToken);
            // Fetch both Antigravity and Gemini CLI quotas in parallel
            const [antigravityResponse, geminiCliResponse] = await Promise.all([
                fetchAvailableModels(accessToken, projectId)
                    .catch(() => ({ models: undefined })),
                fetchGeminiCliQuota(accessToken, projectId),
            ]);
            // Process Antigravity quota
            let quotaResult;
            if (antigravityResponse.models === undefined) {
                quotaResult = {
                    groups: {},
                    modelCount: 0,
                    error: "Failed to fetch Antigravity quota",
                };
            }
            else {
                quotaResult = aggregateQuota(antigravityResponse.models);
            }
            // Process Gemini CLI quota
            const geminiCliQuotaResult = aggregateGeminiCliQuota(geminiCliResponse);
            if (geminiCliQuotaResult.models.length === 0) {
                geminiCliQuotaResult.error = "No Gemini CLI quota available";
            }
            results.push({
                index,
                email: account.email,
                status: "ok",
                disabled,
                quota: quotaResult,
                geminiCliQuota: geminiCliQuotaResult,
            });
        }
        catch (error) {
            results.push({
                index,
                email: account.email,
                status: "error",
                disabled,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return results;
}
//# sourceMappingURL=quota.js.map