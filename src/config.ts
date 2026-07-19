/**
 * Configuration loading for zcode-antigravity-proxy.
 * Reads from environment variables and optional config file.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  DEFAULT_PROXY_PORT,
  DEFAULT_OAUTH_PORT,
  DEFAULT_RETRY_AFTER_SECONDS,
  DEFAULT_MAX_BACKOFF_SECONDS,
  DEFAULT_FAILURE_TTL_SECONDS,
  DEFAULT_MAX_RATE_LIMIT_WAIT_SECONDS,
  DEFAULT_QUOTA_REFRESH_INTERVAL_MINUTES,
  DEFAULT_SOFT_QUOTA_THRESHOLD_PERCENT,
} from "./constants.js";

// ---- Config Schema ----
const AntigravityConfigSchema = z.object({
  proxy_port: z.number().int().min(1024).max(65535).default(DEFAULT_PROXY_PORT),
  oauth_port: z.number().int().min(1024).max(65535).default(DEFAULT_OAUTH_PORT),
  quiet_mode: z.boolean().default(false),
  debug: z.boolean().default(false),
  account_selection_strategy: z
    .enum(["sticky", "round-robin", "hybrid"])
    .default("sticky"),
  cli_first: z.boolean().default(false),
  default_retry_after_seconds: z
    .number()
    .int()
    .min(1)
    .default(DEFAULT_RETRY_AFTER_SECONDS),
  max_backoff_seconds: z
    .number()
    .int()
    .min(1)
    .default(DEFAULT_MAX_BACKOFF_SECONDS),
  failure_ttl_seconds: z
    .number()
    .int()
    .min(1)
    .default(DEFAULT_FAILURE_TTL_SECONDS),
  max_rate_limit_wait_seconds: z
    .number()
    .int()
    .min(0)
    .default(DEFAULT_MAX_RATE_LIMIT_WAIT_SECONDS),
  quota_refresh_interval_minutes: z
    .number()
    .int()
    .min(0)
    .default(DEFAULT_QUOTA_REFRESH_INTERVAL_MINUTES),
  soft_quota_threshold_percent: z
    .number()
    .int()
    .min(0)
    .max(100)
    .default(DEFAULT_SOFT_QUOTA_THRESHOLD_PERCENT),
  soft_quota_cache_ttl_minutes: z
    .union([z.literal("auto"), z.number().int().min(1).max(120)])
    .default("auto"),
  scheduling_mode: z
    .enum(["cache_first", "balance", "performance_first"])
    .default("cache_first"),
  max_cache_first_wait_seconds: z.number().int().min(1).default(60),
  switch_on_first_rate_limit: z.boolean().default(true),
  pid_offset_enabled: z.boolean().default(false),
  keep_thinking: z.boolean().default(false),
  claude_tool_hardening: z.boolean().default(true),
  request_jitter_max_ms: z.number().int().min(0).default(0),
});

export type AntigravityConfig = z.infer<typeof AntigravityConfigSchema>;

// ---- Runtime Config ----
let runtimeConfig: AntigravityConfig = AntigravityConfigSchema.parse({});

export function initRuntimeConfig(partial: Partial<AntigravityConfig>): void {
  runtimeConfig = AntigravityConfigSchema.parse(partial);
}

export function getConfig(): AntigravityConfig {
  return runtimeConfig;
}

// ---- Config File Paths ----
export function getZCodeDir(): string {
  const envDir = process.env.ZCODE_CONFIG_DIR;
  if (envDir) return envDir;
  return join(homedir(), ".zcode");
}

export function getAccountsFilePath(): string {
  return join(getZCodeDir(), "antigravity-accounts.json");
}

export function getConfigFilePath(): string {
  return join(getZCodeDir(), "antigravity.json");
}

export function getLogDir(): string {
  return join(getZCodeDir(), "antigravity-logs");
}

// ---- Load from env vars ----
export function loadConfig(): AntigravityConfig {
  const partial: Record<string, unknown> = {};

  // Port config from env vars
  if (process.env.ANTIGRAVITY_PROXY_PORT) {
    partial.proxy_port = Number.parseInt(
      process.env.ANTIGRAVITY_PROXY_PORT,
      10,
    );
  }
  if (process.env.ANTIGRAVITY_OAUTH_PORT) {
    partial.oauth_port = Number.parseInt(
      process.env.ANTIGRAVITY_OAUTH_PORT,
      10,
    );
  }

  // Debug flags
  if (process.env.ANTIGRAVITY_DEBUG) {
    const level = Number.parseInt(process.env.ANTIGRAVITY_DEBUG, 10);
    if (level === 1 || level === 2) {
      partial.debug = true;
    }
  }

  // Quiet mode
  if (
    process.env.ANTIGRAVITY_QUIET === "1" ||
    process.env.ANTIGRAVITY_QUIET === "true"
  ) {
    partial.quiet_mode = true;
  }

  // Load from config file if it exists
  const configPath = getConfigFilePath();
  if (existsSync(configPath)) {
    try {
      const fileConfig = JSON.parse(readFileSync(configPath, "utf8"));
      Object.assign(partial, fileConfig);
    } catch {
      // Ignore invalid config file
    }
  }

  return AntigravityConfigSchema.parse(partial);
}

// ---- Token from env var (for testing without OAuth) ----
export function getManualAccessToken(): string | null {
  return process.env.ANTIGRAVITY_ACCESS_TOKEN || null;
}

export function getManualProjectId(): string | null {
  return process.env.ANTIGRAVITY_PROJECT_ID || null;
}
