/**
 * CLI: antigravity-auth setup
 * Auto-adds the Antigravity provider to ~/.zcode/v2/config.json.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { DEFAULT_PROXY_PORT } from "../constants.js";
import {
  type ModelCapabilities,
  inferModelCapabilities,
} from "../models/capabilities.js";
import {
  type OpenAIModelEntry,
  loadModelCache,
} from "../models/discovery.js";

// ---- Types ----

interface ZCodeModelConfig {
  name?: string;
  reasoning?: {
    enabled: boolean;
    variants: string[];
    defaultVariant: string;
  };
  limit: {
    context: number;
    output?: number;
  };
  modalities: {
    input: string[];
    output: string[];
  };
}

interface ZCodeProviderConfig {
  name: string;
  kind: "openai-compatible";
  options: {
    apiKey: string;
    baseURL: string;
    apiKeyRequired?: boolean;
  };
  enabled: boolean;
  source: "custom";
  models: Record<string, ZCodeModelConfig>;
}

interface ZCodeConfig {
  provider?: Record<string, ZCodeProviderConfig>;
  [key: string]: unknown;
}

// ---- Fallback Models (used when no cache available) ----

const FALLBACK_MODEL_IDS = [
  "claude-opus-4-6-thinking",
  "claude-sonnet-4-6",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-thinking",
  "gemini-3-flash",
  "gemini-3-flash-agent",
  "gemini-3.1-pro-low",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-image",
  "gemini-3.5-flash-low",
  "gemini-3.5-flash-extra-low",
  "gpt-oss-120b-medium",
];

// ---- Provider Definition ----

const PROVIDER_ID = "antigravity";

function getBaseUrl(): string {
  const port = process.env.ANTIGRAVITY_PROXY_PORT
    ? Number.parseInt(process.env.ANTIGRAVITY_PROXY_PORT, 10)
    : DEFAULT_PROXY_PORT;
  return `http://127.0.0.1:${port}/v1`;
}

/**
 * Get the list of model IDs to use for provider config generation.
 * Tries model cache first, falls back to hardcoded list.
 */
function getModelIdsForSetup(): string[] {
  // Try loading from cache
  const cache = loadModelCache();
  if (cache && cache.models && Object.keys(cache.models).length > 0) {
    const ids = Object.keys(cache.models)
      .filter(id => {
        // Filter out excluded/internal models (must match discovery.ts EXCLUDED_MODELS)
        if (/^(?:chat-bison|code-bison|chat_|test-|internal-|gemini-2\.5-pro$|gemini-3-pro$|gemini-3\.1-pro-high$|gemini-pro-agent$)/i.test(id)) return false;
        return true;
      })
      .sort((a, b) => a.localeCompare(b));
    if (ids.length > 0) return ids;
  }

  // Fallback
  return [...FALLBACK_MODEL_IDS];
}

/**
 * Convert ModelCapabilities to a ZCode model config entry.
 */
function capabilitiesToZCodeConfig(caps: ModelCapabilities): ZCodeModelConfig {
  const config: ZCodeModelConfig = {
    limit: {
      context: caps.context,
      ...(caps.output ? { output: caps.output } : {}),
    },
    modalities: {
      input: [...caps.modalities.input],
      output: [...caps.modalities.output],
    },
  };

  if (caps.reasoning?.enabled) {
    config.reasoning = {
      enabled: true,
      variants: [...caps.reasoning.variants],
      defaultVariant: caps.reasoning.defaultVariant,
    };
  }

  return config;
}

function buildAntigravityProvider(): ZCodeProviderConfig {
  const baseURL = getBaseUrl();
  const modelIds = getModelIdsForSetup();

  const models: Record<string, ZCodeModelConfig> = {};
  for (const id of modelIds) {
    const caps = inferModelCapabilities(id);
    models[id] = capabilitiesToZCodeConfig(caps);
  }

  return {
    name: "Antigravity (Google OAuth)",
    kind: "openai-compatible",
    options: {
      apiKey: "antigravity-oauth",
      baseURL,
      apiKeyRequired: true,
    },
    enabled: true,
    source: "custom",
    models,
  };
}

// ---- Config File Operations ----

function getZCodeConfigPath(): string {
  const envDir = process.env.ZCODE_CONFIG_DIR;
  const baseDir = envDir ?? join(homedir(), ".zcode");
  return join(baseDir, "v2", "config.json");
}

function readZCodeConfig(): ZCodeConfig {
  const path = getZCodeConfigPath();
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ZCodeConfig;
  } catch {
    return {};
  }
}

function writeZCodeConfig(config: ZCodeConfig): void {
  const path = getZCodeConfigPath();
  // Ensure directory exists
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Backup existing if it exists
  if (existsSync(path)) {
    const backupPath = `${path}.antigravity-backup-${Date.now()}`;
    try {
      copyFileSync(path, backupPath);
    } catch {
      // Non-fatal
    }
  }
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf8");
}

// ---- Main Setup Function ----

export interface SetupResult {
  action: "added" | "updated" | "unchanged";
  configPath: string;
  baseURL: string;
  modelCount: number;
  modelNames: string[];
}

export function setupAntigravityProvider(): SetupResult {
  const configPath = getZCodeConfigPath();
  const config = readZCodeConfig();

  // Ensure provider key exists
  if (!config.provider) {
    config.provider = {};
  }

  const provider = buildAntigravityProvider();
  const modelNames = Object.keys(provider.models);
  const baseURL = provider.options.baseURL;

  let action: "added" | "updated" | "unchanged";

  const existing = config.provider[PROVIDER_ID];
  if (!existing) {
    // New provider
    config.provider[PROVIDER_ID] = provider;
    action = "added";
  } else {
    // Update existing provider config while preserving unknown fields
    const existingModels = existing.models ?? {};
    const mergedModels: Record<string, ZCodeModelConfig> = {};

    // Add new models from provider definition
    for (const [id, modelConfig] of Object.entries(provider.models)) {
      mergedModels[id] = modelConfig;
    }
    // Preserve any user-added models not in our definition
    for (const [id, modelConfig] of Object.entries(existingModels)) {
      if (!mergedModels[id]) {
        mergedModels[id] = modelConfig;
      }
    }

    // Only count as "updated" if something actually changed
    const currentBaseUrl = existing.options?.baseURL;
    const currentModelCount = Object.keys(existingModels).length;

    config.provider[PROVIDER_ID] = {
      ...existing,
      ...provider,
      models: mergedModels,
      options: {
        ...existing.options,
        ...provider.options,
      },
    };

    action =
      currentBaseUrl !== baseURL || currentModelCount !== Object.keys(mergedModels).length
        ? "updated"
        : "unchanged";
  }

  writeZCodeConfig(config);

  return {
    action,
    configPath,
    baseURL,
    modelCount: modelNames.length,
    modelNames,
  };
}

/**
 * Check if the Antigravity provider is already configured.
 */
export function isProviderConfigured(): boolean {
  const config = readZCodeConfig();
  return !!(config.provider?.[PROVIDER_ID]);
}

/**
 * Get the current provider config (if any).
 */
export function getProviderConfig(): ZCodeProviderConfig | null {
  const config = readZCodeConfig();
  return config.provider?.[PROVIDER_ID] ?? null;
}

/**
 * Remove the Antigravity provider from the ZCode config.
 */
export function removeAntigravityProvider(): boolean {
  const config = readZCodeConfig();
  if (!config.provider?.[PROVIDER_ID]) {
    return false;
  }
  delete config.provider[PROVIDER_ID];
  // Clean up empty provider object
  if (Object.keys(config.provider).length === 0) {
    delete config.provider;
  }
  writeZCodeConfig(config);
  return true;
}
