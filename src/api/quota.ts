/**
 * Quota checking via Antigravity API endpoints.
 * Ported from opencode-antigravity-auth plugin/quota.ts
 *
 * Fetches quota info for accounts using two endpoints:
 * - v1internal:fetchAvailableModels (Antigravity quota)
 * - v1internal:retrieveUserQuota (Gemini CLI quota)
 */

import {
  ANTIGRAVITY_ENDPOINT_PROD,
  getAntigravityHeaders,
  ANTIGRAVITY_PROVIDER_ID,
} from "../constants.js";
import { getModelFamily } from "./model-resolver.js";
import type { QuotaGroup } from "./model-resolver.js";
import type { RefreshParts } from "../accounts/manager.js";

export type { QuotaGroup } from "./model-resolver.js";

const FETCH_TIMEOUT_MS = 10000;

export interface QuotaGroupSummary {
  remainingFraction?: number;
  resetTime?: string;
  modelCount: number;
}

export interface QuotaSummary {
  groups: Partial<Record<QuotaGroup, QuotaGroupSummary>>;
  modelCount: number;
  error?: string;
}

// Gemini CLI quota types
export interface GeminiCliQuotaModel {
  modelId: string;
  remainingFraction: number;
  resetTime?: string;
}

export interface GeminiCliQuotaSummary {
  models: GeminiCliQuotaModel[];
  error?: string;
}

interface RetrieveUserQuotaResponse {
  buckets?: {
    remainingAmount?: string;
    remainingFraction?: number;
    resetTime?: string;
    tokenType?: string;
    modelId?: string;
  }[];
}

export type AccountQuotaStatus = "ok" | "disabled" | "error";

export interface AccountQuotaResult {
  index: number;
  email?: string;
  status: AccountQuotaStatus;
  error?: string;
  disabled?: boolean;
  quota?: QuotaSummary;
  geminiCliQuota?: GeminiCliQuotaSummary;
  updatedParts?: RefreshParts;
}

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

// ---- Helpers ----

function normalizeRemainingFraction(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function parseResetTime(resetTime?: string): number | null {
  if (!resetTime) return null;
  const timestamp = Date.parse(resetTime);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return timestamp;
}

function classifyQuotaGroup(modelName: string, displayName?: string): QuotaGroup | null {
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

function aggregateQuota(models?: Record<string, FetchAvailableModelEntry>): QuotaSummary {
  const groups: Partial<Record<QuotaGroup, QuotaGroupSummary>> = {};
  if (!models) {
    return { groups, modelCount: 0 };
  }

  let totalCount = 0;
  for (const [modelName, entry] of Object.entries(models)) {
    const group = classifyQuotaGroup(modelName, entry.displayName ?? entry.modelName);
    if (!group) continue;

    const quotaInfo = entry.quotaInfo;
    const remainingFraction = quotaInfo
      ? normalizeRemainingFraction(quotaInfo.remainingFraction)
      : undefined;
    const resetTime = quotaInfo?.resetTime;
    const resetTimestamp = parseResetTime(resetTime);

    totalCount += 1;

    const existing = groups[group];
    const nextCount = (existing?.modelCount ?? 0) + 1;
    const nextRemaining =
      remainingFraction === undefined
        ? existing?.remainingFraction
        : existing?.remainingFraction === undefined
          ? remainingFraction
          : Math.min(existing.remainingFraction, remainingFraction);

    let nextResetTime = existing?.resetTime;
    if (resetTimestamp !== null) {
      if (!existing?.resetTime) {
        nextResetTime = resetTime;
      } else {
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

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAvailableModels(
  accessToken: string,
  projectId: string,
): Promise<FetchAvailableModelsResponse> {
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
    return (await response.json()) as FetchAvailableModelsResponse;
  }

  throw new Error(`fetchAvailableModels failed: ${response.status}`);
}

async function fetchGeminiCliQuota(
  accessToken: string,
  projectId: string,
): Promise<RetrieveUserQuotaResponse> {
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
      return (await response.json()) as RetrieveUserQuotaResponse;
    }

    return { buckets: [] };
  } catch {
    return { buckets: [] };
  }
}

function aggregateGeminiCliQuota(response: RetrieveUserQuotaResponse): GeminiCliQuotaSummary {
  const models: GeminiCliQuotaModel[] = [];

  if (!response.buckets || response.buckets.length === 0) {
    return { models };
  }

  for (const bucket of response.buckets) {
    if (!bucket.modelId) continue;

    const modelId = bucket.modelId;
    const isRelevantModel =
      modelId.startsWith("gemini-3-") ||
      modelId === "gemini-2.5-pro";

    if (!isRelevantModel) continue;

    models.push({
      modelId: bucket.modelId,
      remainingFraction: normalizeRemainingFraction(bucket.remainingFraction),
      resetTime: bucket.resetTime,
    });
  }

  models.sort((a, b) => a.modelId.localeCompare(b.modelId));

  return { models };
}

// ---- Quota Check Entry Point ----

export interface QuotaCheckAccount {
  index: number;
  email?: string;
  refreshToken: string;
  projectId?: string;
  enabled: boolean;
}

/**
 * Check quota for multiple accounts.
 * Fetches both Antigravity and Gemini CLI quotas in parallel for each account.
 *
 * @param accounts - List of accounts with refresh tokens
 * @param getAccessToken - Function to get/refresh access token for each account
 */
export async function checkAccountsQuota(
  accounts: QuotaCheckAccount[],
  getAccessToken: (refreshToken: string) => Promise<{ accessToken: string; projectId: string }>,
): Promise<AccountQuotaResult[]> {
  const results: AccountQuotaResult[] = [];

  for (const [index, account] of accounts.entries()) {
    const disabled = !account.enabled;

    try {
      const { accessToken, projectId } = await getAccessToken(account.refreshToken);

      // Fetch both Antigravity and Gemini CLI quotas in parallel
      const [antigravityResponse, geminiCliResponse] = await Promise.all([
        fetchAvailableModels(accessToken, projectId)
          .catch((): FetchAvailableModelsResponse => ({ models: undefined })),
        fetchGeminiCliQuota(accessToken, projectId),
      ]);

      // Process Antigravity quota
      let quotaResult: QuotaSummary;
      if (antigravityResponse.models === undefined) {
        quotaResult = {
          groups: {},
          modelCount: 0,
          error: "Failed to fetch Antigravity quota",
        };
      } else {
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
    } catch (error) {
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
