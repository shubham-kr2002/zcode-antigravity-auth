/**
 * Entry point for zcode-antigravity-proxy.
 * Starts the HTTP proxy server and optionally the OAuth callback server.
 */

import { loadConfig, initRuntimeConfig, getConfig } from "./config.js";
import { initLogger } from "./logger.js";
import { getApp, initModelRegistry, getModelRegistry } from "./server.js";
import { AccountManager } from "./accounts/manager.js";
import { refreshAccessToken } from "./oauth/refresh.js";

// ---- Main ----

async function main(): Promise<void> {
  const config = loadConfig();
  initRuntimeConfig(config);
  initLogger(config.debug);

  const app = getApp();
  const port = config.proxy_port;

  // ---- Model Discovery ----
  // Try to discover models from the Antigravity API before listening.
  // If no accounts exist, falls back to the hardcoded list silently.
  let modelSource = "fallback";
  try {
    modelSource = await initModelRegistry(async () => {
      try {
        const mgr = await AccountManager.loadFromDisk();
        const accounts = mgr.getAccounts();
        if (accounts.length === 0) return null;

        // Use the first enabled account
        const account = accounts.find(a => a.enabled) ?? accounts[0];
        if (!account) return null;

        // Refresh token if needed
        let accessToken = account.access;
        let projectId = account.parts.projectId ?? account.parts.managedProjectId;
        const isExpired = !account.expires || Date.now() >= account.expires;

        if (!accessToken || isExpired) {
          try {
            const refreshed = await refreshAccessToken(account.parts.refreshToken);
            accessToken = refreshed.accessToken;
            // Update account in-memory
            account.access = refreshed.accessToken;
            account.expires = refreshed.expiresAt;
          } catch {
            // Token refresh failed — can't discover models
            return null;
          }
        }

        if (!accessToken) return null;

        return {
          accessToken,
          projectId: projectId ?? "rising-fact-p41fc",
        };
      } catch {
        return null;
      }
    });
  } catch {
    // Discovery failed — silent fallback already handled in initModelRegistry
    modelSource = "fallback";
  }

  // ---- Start Listening ----
  app.listen(port, () => {
    const registry = getModelRegistry();
    const modelCount = registry.models.length;
    const sourceLabel = modelSource === "api" ? "Antigravity API" :
      modelSource === "cache" ? "cache" : "fallback list";

    console.error(
      `[zcode-antigravity-proxy] Listening on http://127.0.0.1:${port}`,
    );
    console.error(
      `[zcode-antigravity-proxy] Models: ${modelCount} models loaded from ${sourceLabel}`,
    );
    console.error(
      `[zcode-antigravity-proxy] Health check: http://127.0.0.1:${port}/health`,
    );
    console.error(
      `[zcode-antigravity-proxy] Set ANTIGRAVITY_ACCESS_TOKEN env var for manual auth, or run "antigravity-auth login"`,
    );
  });
}

main().catch((err) => {
  console.error("[zcode-antigravity-proxy] Failed to start:", err);
  process.exit(1);
});
