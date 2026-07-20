/**
 * Express server that exposes an OpenAI-compatible API.
 * Intercepts chat completions and proxies them to the Antigravity API.
 *
 * Phase 3: Integrated with AccountManager for multi-account rotation
 * with sticky/round-robin/hybrid strategies, rate limit backoff,
 * and endpoint failover.
 */

import express, { type Request as ExpressRequest, type Response as ExpressResponse } from "express";
import {
  transformRequest,
  type OpenAIChatRequest,
} from "./transform/request.js";
import {
  transformNonStreamResponse,
  transformSSELine,
} from "./transform/response.js";
import { getConfig, getManualAccessToken, getManualProjectId } from "./config.js";
import {
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  type HeaderStyle,
  type ModelFamily,
} from "./constants.js";
import { AccountManager, computeSoftQuotaCacheTtlMs } from "./accounts/manager.js";
import { refreshAccessToken } from "./oauth/refresh.js";
import { getHealthTracker, getTokenTracker } from "./accounts/rotation.js";
import {
  buildAntigravityUrl,
  detectRateLimit,
  getFailoverEndpoints,
  getCapacityBackoffDelay,
  sleep,
} from "./api/retry.js";
import {
  type ModelRegistryData,
  type OpenAIModelEntry,
  discoverModels,
  buildModelRegistry,
  loadModelCache,
} from "./models/index.js";
import { setModelRegistryForResolution } from "./transform/model-resolver.js";

// ---- Types ----

export interface AuthResult {
  accessToken: string;
  projectId: string;
  headerStyle: HeaderStyle;
  accountIndex: number;
}

// ---- Module-level AccountManager ----

let accountManager: AccountManager | null = null;

export async function getAccountManager(): Promise<AccountManager> {
  if (!accountManager) {
    accountManager = await AccountManager.loadFromDisk();
  }
  return accountManager;
}

export function setAccountManager(mgr: AccountManager): void {
  accountManager = mgr;
}

// ---- Logger ----

import { log as fileLog } from "./logger.js";

function log(level: "info" | "warn" | "error" | "debug", msg: string, data?: unknown): void {
  const config = getConfig();
  if (level === "debug" && !config.debug) return;
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (data) {
    console.error(`${prefix} ${msg}`, data);
  } else {
    console.error(`${prefix} ${msg}`);
  }
  // Also write to file-based logger
  fileLog[level](msg, data);
}

// ---- Model Family Resolution ----

function getModelFamily(model: string): ModelFamily {
  if (model.toLowerCase().includes("claude")) return "claude";
  return "gemini";
}

// ---- Auth Resolution (with AccountManager integration) ----

async function resolveAuth(model: string): Promise<AuthResult> {
  // Priority 1: Manual token via env var (for testing)
  const manualToken = getManualAccessToken();
  const manualProject = getManualProjectId();
  if (manualToken) {
    return {
      accessToken: manualToken,
      projectId: manualProject ?? ANTIGRAVITY_DEFAULT_PROJECT_ID,
      headerStyle: "antigravity",
      accountIndex: -1,
    };
  }

  // Priority 2: Stored accounts via AccountManager
  const mgr = await getAccountManager();
  const family = getModelFamily(model);
  const config = getConfig();
  const softQuotaCacheTtlMs = computeSoftQuotaCacheTtlMs(
    config.soft_quota_cache_ttl_minutes,
    config.quota_refresh_interval_minutes,
  );

  const selected = mgr.getCurrentOrNextForFamily(
    family,
    model,
    config.account_selection_strategy,
    "antigravity",
    config.pid_offset_enabled,
    config.soft_quota_threshold_percent,
    softQuotaCacheTtlMs,
  );

  if (!selected) {
    throw new Error(
      "No available accounts. All accounts are rate-limited or disabled. " +
      "Run `antigravity-auth login` to add accounts or wait for rate limits to reset.",
    );
  }

  // Check if token needs refresh
  let accessToken = selected.access;
  if (!accessToken || Date.now() >= (selected.expires ?? 0)) {
    try {
      const refreshed = await refreshAccessToken(
        selected.parts.refreshToken,
        selected.parts.projectId,
      );
      accessToken = refreshed.accessToken;

      // Update account with new token
      selected.access = refreshed.accessToken;
      if (refreshed.expiresAt) {
        selected.expires = refreshed.expiresAt;
      }
      mgr.requestSaveToDisk();
    } catch (err) {
      log("error", "Failed to refresh access token", err);
      throw new Error(
        "Authentication failed. Run `antigravity-auth login` to re-authenticate.",
      );
    }
  }

  // Determine header style based on model and rate limit state
  let headerStyle: HeaderStyle = "antigravity";
  if (family === "gemini") {
    const available = mgr.getAvailableHeaderStyle(selected, family, model);
    if (!available) {
      // Try fallback to other accounts
      if (mgr.hasOtherAccountWithAntigravityAvailable(selected.index, family, model)) {
        // Will be picked up on next iteration
        throw new Error(
          "Current account rate-limited, retry to switch to another account.",
        );
      }
      // Fall back to gemini-cli if antigravity exhausted
      headerStyle = mgr.isRateLimitedForHeaderStyle(selected, family, "gemini-cli", model)
        ? "antigravity" // Both exhausted, use default
        : "gemini-cli";
    } else {
      headerStyle = available;
    }
  }

  return {
    accessToken,
    projectId: selected.parts.projectId ?? ANTIGRAVITY_DEFAULT_PROJECT_ID,
    headerStyle,
    accountIndex: selected.index,
  };
}

// ---- Model Info ----

/** Fallback model list used when API discovery is unavailable (no accounts, network error). */
export const FALLBACK_MODELS: OpenAIModelEntry[] = [
  // Claude models
  { id: "claude-opus-4-6-thinking", object: "model", created: 1750000000, owned_by: "antigravity" },
  { id: "claude-sonnet-4-6", object: "model", created: 1750000000, owned_by: "antigravity" },
  // Gemini 2.5 models
  { id: "gemini-2.5-flash", object: "model", created: 1750000000, owned_by: "antigravity" },
  { id: "gemini-2.5-flash-lite", object: "model", created: 1750000000, owned_by: "antigravity" },
  { id: "gemini-2.5-flash-thinking", object: "model", created: 1750000000, owned_by: "antigravity" },
  // Gemini 3 models
  { id: "gemini-3-flash", object: "model", created: 1750000000, owned_by: "antigravity" },
  { id: "gemini-3-flash-agent", object: "model", created: 1750000000, owned_by: "antigravity" },
  // Gemini 3.1 models
  { id: "gemini-3.1-pro-low", object: "model", created: 1750000000, owned_by: "antigravity" },
  { id: "gemini-3.1-flash-lite", object: "model", created: 1750000000, owned_by: "antigravity" },
  { id: "gemini-3.1-flash-image", object: "model", created: 1750000000, owned_by: "antigravity" },
  // Gemini 3.5 models
  { id: "gemini-3.5-flash-low", object: "model", created: 1750000000, owned_by: "antigravity" },
  { id: "gemini-3.5-flash-extra-low", object: "model", created: 1750000000, owned_by: "antigravity" },
  // Other
  { id: "gpt-oss-120b-medium", object: "model", created: 1750000000, owned_by: "antigravity" },
];

// ---- Dynamic Model Registry ----

let modelRegistry: ModelRegistryData = {
  models: [...FALLBACK_MODELS],
  nameMap: Object.fromEntries(FALLBACK_MODELS.map(m => [m.id, m.id])),
  capabilities: {},
  aliases: {},
  preSuffixedModels: new Set(),
};

export function getModelRegistry(): ModelRegistryData {
  return modelRegistry;
}

export function setModelRegistry(registry: ModelRegistryData): void {
  modelRegistry = registry;
}

/**
 * Initialize the model registry from cache, API, or fallback.
 * Called once at proxy startup.
 *
 * @param getAccessToken - Optional async function to get an access token for API discovery.
 *   If not provided, only cache and fallback are used.
 * @returns The discovery source used ("cache" | "api" | "fallback")
 */
export async function initModelRegistry(
  getAccessToken?: () => Promise<{ accessToken: string; projectId: string } | null>,
): Promise<"cache" | "api" | "fallback"> {
  // 1. Try loading from cache
  const cache = loadModelCache();
  if (cache) {
    const apiResponse = {
      models: Object.fromEntries(
        Object.entries(cache.models).map(([id, entry]) => [
          id,
          { displayName: entry.displayName, modelName: id },
        ]),
      ),
    };
    const registry = buildModelRegistry(apiResponse);
    modelRegistry = registry;
    setModelRegistryForResolution(registry);
    log("info", `[models] Loaded ${registry.models.length} models from cache`);
    return "cache";
  }

  // 2. Try calling the API
  if (getAccessToken) {
    try {
      const auth = await getAccessToken();
      if (auth) {
        const result = await discoverModels(auth.accessToken, auth.projectId);
        if (result.source === "api" && result.registry.models.length > 0) {
          modelRegistry = result.registry;
          setModelRegistryForResolution(result.registry);
          log("info", `[models] Discovered ${result.modelCount} models from Antigravity API`);
          return "api";
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("warn", `[models] API discovery failed: ${msg}. Using fallback.`);
    }
  } else {
    log("warn", "[models] No credentials available — using fallback model list");
  }

  // 3. Use fallback
  const fallbackRegistry: ModelRegistryData = {
    models: [...FALLBACK_MODELS],
    nameMap: Object.fromEntries(FALLBACK_MODELS.map(m => [m.id, m.id])),
    capabilities: {},
    aliases: {},
    preSuffixedModels: new Set(),
  };
  modelRegistry = fallbackRegistry;
  setModelRegistryForResolution(fallbackRegistry);
  log("info", `[models] Using fallback list with ${FALLBACK_MODELS.length} hardcoded models`);
  return "fallback";
}

// ---- Rate Limit Response Handler ----

function handleRateLimitError(
  res: ExpressResponse,
  response: globalThis.Response,
  bodyText: string,
  accountIndex: number,
  family: ModelFamily,
  model: string,
): void {
  const detection = detectRateLimit(response, bodyText);
  const mgrPromise = accountManager
    ? Promise.resolve(accountManager)
    : AccountManager.loadFromDisk();

  mgrPromise.then((mgr) => {
    if (accountIndex >= 0) {
      const account = mgr.getAccounts().find(a => a.index === accountIndex);
      if (account) {
        mgr.markRateLimitedWithReason(
          account,
          family,
          "antigravity",
          model,
          detection.reason,
          detection.retryAfterMs,
        );
        mgr.requestSaveToDisk();

        const healthTracker = getHealthTracker();
        healthTracker.recordRateLimit(accountIndex);
        log("warn", `Account ${accountIndex} rate-limited: ${detection.reason}`, {
          family,
          model,
          retryAfterMs: detection.retryAfterMs,
        });
      }
    }
  });

  // Return a 429 in a format ZCode can understand
  res.status(429).json({
    error: {
      message: `Rate limited: ${detection.message.slice(0, 200)}. Waiting and retrying...`,
      type: "rate_limit",
      retry_after_ms: detection.retryAfterMs ?? 60000,
    },
  });
}

// ---- TransformStream-based streaming ----

import { createStreamingTransform } from "./transform/response.js";

async function proxyStream(
  res: ExpressResponse,
  antigravityResponse: globalThis.Response,
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const body = antigravityResponse.body;
  if (!body) {
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

	  try {
	    // Use the TransformStream pipeline for robust SSE transformation
	    const textStream = body.pipeThrough(new TextDecoderStream());
	    const transformStream = createStreamingTransform();
	    const readable = textStream.pipeThrough(transformStream);

    const reader = readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (streamErr) {
    log("error", "Stream error", streamErr);
  }

  res.write("data: [DONE]\n\n");
  res.end();
}

// ---- Express App ----

export function createApp(): express.Express {
  const app = express();

  // Parse JSON bodies with high limit for large requests
  app.use(express.json({ limit: "10mb" }));

  // Health check
  app.get("/health", (_req: ExpressRequest, res: ExpressResponse) => {
    res.json({ status: "ok", service: "zcode-antigravity-proxy" });
  });

  // Account status endpoint
  app.get("/v1/accounts", async (_req: ExpressRequest, res: ExpressResponse) => {
    try {
      const mgr = await getAccountManager();
      const accounts = mgr.getAccountsSnapshot().map(a => ({
        index: a.index,
        email: a.email,
        enabled: a.enabled,
        lastUsed: a.lastUsed,
        lastSwitchReason: a.lastSwitchReason,
        cooldownReason: mgr.getAccountCooldownReason(a),
        rateLimitResetTimes: a.rateLimitResetTimes,
      }));
      res.json({
        count: mgr.getAccountCount(),
        total: mgr.getTotalAccountCount(),
        accounts,
      });
    } catch (err) {
      res.status(500).json({ error: { message: "Failed to get accounts" } });
    }
  });

  // Model listing — returns dynamically discovered models
  app.get("/v1/models", (_req: ExpressRequest, res: ExpressResponse) => {
    res.json({
      object: "list",
      data: modelRegistry.models,
    });
  });

  // Chat completions
  app.post("/v1/chat/completions", async (req: ExpressRequest, res: ExpressResponse) => {
    const config = getConfig();
    const maxWaitMs = (config.max_rate_limit_wait_seconds ?? 300) * 1000;
    let totalWait = 0;

    try {
      const openaiReq = req.body as OpenAIChatRequest;

      if (!openaiReq.model) {
        res.status(400).json({ error: { message: "Missing model field" } });
        return;
      }

      const family = getModelFamily(openaiReq.model);

      // Retry loop for rate limits
      while (true) {
        // Resolve auth
        let auth: AuthResult;
        try {
          auth = await resolveAuth(openaiReq.model);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Authentication failed";

          // Check if this is a "retry to switch accounts" error
          if (message.includes("retry to switch")) {
            if (totalWait < maxWaitMs) {
              const mgr = await getAccountManager();
              const waitMs = mgr.getMinWaitTimeForFamily(family, openaiReq.model);
              const effectiveWait = Math.min(waitMs > 0 ? waitMs : FIRST_RETRY_DELAY_MS, maxWaitMs - totalWait);
              log("info", `Waiting ${effectiveWait}ms for account switch (total wait: ${totalWait}ms)`);
              await sleep(effectiveWait);
              totalWait += effectiveWait;
              continue;
            }
            res.status(429).json({
              error: { message: "All accounts are rate-limited. Add more accounts or wait for reset." },
            });
            return;
          }

          res.status(401).json({ error: { message } });
          return;
        }

        const isStreaming = openaiReq.stream === true;

        // Get failover endpoints for this header style
        const endpoints = getFailoverEndpoints(auth.headerStyle);

        // Try each endpoint with capacity retries
        let lastError: string | null = null;
        let lastStatus = 0;

        for (const endpointResult of endpoints) {
          const url = buildAntigravityUrl(
            endpointResult.endpoint,
            isStreaming,
          );

          const { url: _transformUrl, init } = transformRequest(openaiReq, {
            projectId: auth.projectId,
            accessToken: auth.accessToken,
            headerStyle: auth.headerStyle,
            config,
          });

          // Override URL with current endpoint
          const effectiveUrl = url;

          // Capacity retry loop per endpoint
          for (let capRetry = 0; capRetry <= MAX_CAPACITY_RETRIES_PER_ENDPOINT; capRetry++) {
            if (capRetry > 0) {
              const delay = getCapacityBackoffDelay(capRetry - 1);
              log("debug", `Capacity retry ${capRetry}/${MAX_CAPACITY_RETRIES_PER_ENDPOINT} for ${endpointResult.endpoint}, waiting ${delay}ms`);
              if (totalWait + delay > maxWaitMs) {
                break;
              }
              await sleep(delay);
              totalWait += delay;
            }

            // Parse the body to get the actual model name sent
            let actualModelSent = openaiReq.model;
            try { actualModelSent = JSON.parse(init.body as string).model ?? openaiReq.model; } catch {}
            log("info", `Proxying to Antigravity: ${openaiReq.model} → ${actualModelSent} @ ${effectiveUrl} (style=${auth.headerStyle}, account=${auth.accountIndex})`);

            const antigravityResponse = await fetch(effectiveUrl, {
              ...init,
              // Ensure the URL from transformRequest is replaced
              method: "POST",
              headers: init.headers,
              body: init.body,
            });

            // Successful response
            if (antigravityResponse.ok) {
              // Record success
              if (auth.accountIndex >= 0) {
                const mgr = await getAccountManager();
                const account = mgr.getAccounts().find(a => a.index === auth.accountIndex);
                if (account) {
                  mgr.markRequestSuccess(account);
                  mgr.markAccountUsed(auth.accountIndex);
                  mgr.requestSaveToDisk();
                  getHealthTracker().recordSuccess(auth.accountIndex);
                  getTokenTracker().consume(auth.accountIndex);
                }
              }

              // Handle streaming response
              if (isStreaming) {
                await proxyStream(res, antigravityResponse);
                return;
              }

              // Non-streaming response
              const responseText = await antigravityResponse.text();
              const transformed = transformNonStreamResponse(
                responseText,
                openaiReq.model,
              );

              res.setHeader("Content-Type", "application/json");
              res.send(transformed);
              return;
            }

            // Handle rate limit / capacity errors
            if (antigravityResponse.status === 429 || antigravityResponse.status === 503 || antigravityResponse.status === 529) {
              const bodyText = await antigravityResponse.text().catch(() => "");
              const detection = detectRateLimit(antigravityResponse, bodyText);

              log("warn", `Rate limited: status=${antigravityResponse.status} reason=${detection.reason} endpoint=${endpointResult.endpoint}`);

              // Mark account rate limited
              if (auth.accountIndex >= 0) {
                const mgr = await getAccountManager();
                const account = mgr.getAccounts().find(a => a.index === auth.accountIndex);
                if (account) {
                  mgr.markRateLimitedWithReason(
                    account,
                    family,
                    auth.headerStyle,
                    openaiReq.model,
                    detection.reason,
                    detection.retryAfterMs,
                  );
                  mgr.requestSaveToDisk();
                  getHealthTracker().recordRateLimit(auth.accountIndex);
                  getTokenTracker().refund(auth.accountIndex);
                }
              }

              // For capacity errors, retry same endpoint
              if (detection.reason === "MODEL_CAPACITY_EXHAUSTED") {
                continue; // Will try next capacity retry
              }

              // For quota/rate limit, break to endpoint failover
              break;
            }

            // Other errors
            const errorText = await antigravityResponse.text().catch(() => "");
            lastError = errorText.slice(0, 500);
            lastStatus = antigravityResponse.status;
            log("error", `Antigravity API error ${antigravityResponse.status}`, { body: lastError });

            // Break to next endpoint
            break;
          }
        }

        // All endpoints failed
        if (lastStatus > 0) {
          // Try to parse error for a meaningful message
          let errorMessage = `Antigravity API error: ${lastStatus}`;
          try {
            const errorJson = JSON.parse(lastError ?? "{}");
            errorMessage = errorJson.error?.message ?? errorJson.error ?? errorMessage;
          } catch {
            errorMessage = (lastError ?? "").slice(0, 200) || errorMessage;
          }

          res.status(lastStatus).json({ error: { message: errorMessage } });
          return;
        }

        // No endpoints available — all rate limited
        const mgr = await getAccountManager();
        const minWait = mgr.getMinWaitTimeForFamily(family, openaiReq.model);

        if (minWait > 0 && totalWait + minWait <= maxWaitMs) {
          log("info", `All endpoints rate-limited, waiting ${minWait}ms before retry`);
          await sleep(minWait);
          totalWait += minWait;
          continue;
        }

        res.status(429).json({
          error: {
            message: `All ${mgr.getAccountCount()} account(s) rate-limited. Add more accounts or wait and retry.`,
            type: "rate_limit",
          },
        });
        return;
      }
    } catch (err) {
      log("error", "Unexpected error in /v1/chat/completions", err);
      res.status(500).json({
        error: {
          message:
            err instanceof Error ? err.message : "Internal server error",
        },
      });
    }
  });

  return app;
}

// ---- Constants ----

const FIRST_RETRY_DELAY_MS = 1000;
const MAX_CAPACITY_RETRIES_PER_ENDPOINT = 3;

// ---- Shared app factory ----
let sharedApp: express.Express | null = null;

export function getApp(): express.Express {
  if (!sharedApp) {
    sharedApp = createApp();
  }
  return sharedApp;
}
