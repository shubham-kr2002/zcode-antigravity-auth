/**
 * Express server that exposes an OpenAI-compatible API.
 * Intercepts chat completions and proxies them to the Antigravity API.
 *
 * Phase 3: Integrated with AccountManager for multi-account rotation
 * with sticky/round-robin/hybrid strategies, rate limit backoff,
 * and endpoint failover.
 */
import express from "express";
import { type HeaderStyle } from "./constants.js";
import { AccountManager } from "./accounts/manager.js";
import { type ModelRegistryData, type OpenAIModelEntry } from "./models/index.js";
export interface AuthResult {
    accessToken: string;
    projectId: string;
    headerStyle: HeaderStyle;
    accountIndex: number;
}
export declare function getAccountManager(): Promise<AccountManager>;
export declare function setAccountManager(mgr: AccountManager): void;
/** Fallback model list used when API discovery is unavailable (no accounts, network error). */
export declare const FALLBACK_MODELS: OpenAIModelEntry[];
export declare function getModelRegistry(): ModelRegistryData;
export declare function setModelRegistry(registry: ModelRegistryData): void;
/**
 * Initialize the model registry from cache, API, or fallback.
 * Called once at proxy startup. Also sets up periodic background
 * refresh so new models auto-appear without restarting.
 *
 * @param getAccessToken - Optional async function to get an access token for API discovery.
 *   If not provided, only cache and fallback are used.
 * @returns The discovery source used ("cache" | "api" | "fallback")
 */
export declare function initModelRegistry(getAccessToken?: () => Promise<{
    accessToken: string;
    projectId: string;
} | null>): Promise<"cache" | "api" | "fallback">;
export declare function createApp(): express.Express;
export declare function getApp(): express.Express;
//# sourceMappingURL=server.d.ts.map