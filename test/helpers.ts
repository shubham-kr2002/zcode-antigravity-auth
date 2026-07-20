/**
 * Shared test helpers for zcode-antigravity-proxy tests.
 *
 * Provides factory functions for creating common test objects
 * and mock utilities used across test files.
 */

import type { AccountStorage } from "../src/accounts/storage.js";
import type { StoredAccount } from "../src/accounts/storage.js";
import type { ManagedAccount, ManagedAccountOptions } from "../src/accounts/manager.js";
import type { AccountWithMetrics } from "../src/accounts/rotation.js";
import type { ModelRegistryData } from "../src/models/discovery.js";

// ---- Account Factories ----

export interface StoredAccountOverrides {
  email?: string;
  projectId?: string;
  refreshToken?: string;
  accessToken?: string;
  tokenExpiresAt?: number;
  enabled?: boolean;
}

/**
 * Create a minimal StoredAccount with defaults.
 */
export function makeStoredAccount(overrides: StoredAccountOverrides = {}): StoredAccount {
  return {
    email: overrides.email ?? "test@example.com",
    projectId: overrides.projectId ?? "test-project",
    refreshToken: overrides.refreshToken ?? "rt_test_refresh_token_12345",
    accessToken: overrides.accessToken ?? "at_test_access_token_12345",
    tokenExpiresAt: overrides.tokenExpiresAt ?? Date.now() + 3600_000,
    enabled: overrides.enabled ?? true,
  };
}

export interface StorageOverrides {
  accounts?: StoredAccount[];
  version?: string;
}

/**
 * Create a minimal AccountStorage object.
 */
export function makeStorage(overrides: StorageOverrides = {}): AccountStorage {
  return {
    accounts: overrides.accounts ?? [makeStoredAccount()],
    version: overrides.version ?? "1",
  };
}

// ---- Managed Account Factory ----

/**
 * Create a minimal ManagedAccount for use in AccountManager tests.
 * Note: ManagedAccount has many fields; only the essential ones are set.
 */
export function makeManagedAccount(
  index: number,
  overrides: Partial<ManagedAccount> = {},
): ManagedAccount {
  return {
    index,
    email: overrides.email ?? `user${index}@example.com`,
    projectId: overrides.projectId ?? "test-project",
    refreshToken: overrides.refreshToken ?? `rt_refresh_${index}`,
    accessToken: overrides.accessToken ?? `at_token_${index}`,
    tokenExpiresAt: overrides.tokenExpiresAt ?? Date.now() + 3600_000,
    enabled: overrides.enabled ?? true,
    lastUsed: overrides.lastUsed ?? 0,
    consecutiveFailures: overrides.consecutiveFailures ?? 0,
    lastFailureTime: overrides.lastFailureTime ?? 0,
    rateLimitResetTimes: overrides.rateLimitResetTimes ?? {},
    softQuotaOverThreshold: overrides.softQuotaOverThreshold ?? false,
    cachedQuotaUpdatedAt: overrides.cachedQuotaUpdatedAt ?? 0,
    verificationRequired: overrides.verificationRequired ?? false,
    fingerprint: overrides.fingerprint ?? undefined,
  };
}

// ---- AccountWithMetrics Factory ----

export interface AccountWithMetricsOverrides {
  index?: number;
  email?: string;
  enabled?: boolean;
  lastUsed?: number;
  consecutiveFailures?: number;
  rateLimitResetTimes?: Record<string, number>;
}

/**
 * Create a minimal AccountWithMetrics for rotation tests.
 */
export function makeAccountWithMetrics(
  overrides: AccountWithMetricsOverrides = {},
): AccountWithMetrics {
  return {
    index: overrides.index ?? 0,
    email: overrides.email ?? "test@example.com",
    projectId: "test-project",
    refreshToken: "rt_test",
    accessToken: "at_test",
    tokenExpiresAt: Date.now() + 3600_000,
    enabled: overrides.enabled ?? true,
    lastUsed: overrides.lastUsed ?? 0,
    consecutiveFailures: overrides.consecutiveFailures ?? 0,
    lastFailureTime: 0,
    rateLimitResetTimes: overrides.rateLimitResetTimes ?? {},
    softQuotaOverThreshold: false,
    cachedQuotaUpdatedAt: 0,
    verificationRequired: false,
  };
}

// ---- Model Registry Factory ----

/**
 * Create an empty ModelRegistryData for test setup.
 */
export function makeEmptyRegistry(): ModelRegistryData {
  return {
    models: [],
    nameMap: {},
    capabilities: {},
    aliases: {},
    preSuffixedModels: new Set(),
  };
}

/**
 * Create a ModelRegistryData with a single model entry.
 */
export function makeModelRegistry(
  modelId: string,
  overrides: Partial<ModelRegistryData> = {},
): ModelRegistryData {
  const created = Math.floor(Date.now() / 1000);
  return {
    models: [{ id: modelId, object: "model", created, owned_by: "antigravity" }],
    nameMap: { [modelId]: modelId },
    capabilities: {},
    aliases: {},
    preSuffixedModels: new Set(),
    ...overrides,
  };
}

// ---- Response Mock Factory ----

/**
 * Create a minimal Response object for testing API response handlers.
 */
export function makeResponse(
  status: number,
  body: unknown = "",
  headers: Record<string, string> = {},
): globalThis.Response {
  const bodyText = typeof body === "string" ? body : JSON.stringify(body);
  const contentType =
    typeof body === "string" && body.startsWith("{")
      ? "application/json"
      : "text/plain";

  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => headers[name] ?? null,
      forEach: (cb: (v: string, k: string) => void) => {
        for (const [k, v] of Object.entries(headers)) cb(v, k);
      },
    } as Headers,
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    json: () => Promise.resolve(typeof body === "string" ? JSON.parse(bodyText) : body),
    text: () => Promise.resolve(bodyText),
    clone: function () {
      return makeResponse(status, body, headers) as globalThis.Response;
    },
    redirect: false,
    type: "basic" as ResponseType,
    url: "",
    statusText: status === 429 ? "Too Many Requests" : "OK",
  } satisfies globalThis.Response;
}
