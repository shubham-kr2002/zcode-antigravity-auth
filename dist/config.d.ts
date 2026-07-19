/**
 * Configuration loading for zcode-antigravity-proxy.
 * Reads from environment variables and optional config file.
 */
import { z } from "zod";
declare const AntigravityConfigSchema: z.ZodObject<{
    proxy_port: z.ZodDefault<z.ZodNumber>;
    oauth_port: z.ZodDefault<z.ZodNumber>;
    quiet_mode: z.ZodDefault<z.ZodBoolean>;
    debug: z.ZodDefault<z.ZodBoolean>;
    account_selection_strategy: z.ZodDefault<z.ZodEnum<["sticky", "round-robin", "hybrid"]>>;
    cli_first: z.ZodDefault<z.ZodBoolean>;
    default_retry_after_seconds: z.ZodDefault<z.ZodNumber>;
    max_backoff_seconds: z.ZodDefault<z.ZodNumber>;
    failure_ttl_seconds: z.ZodDefault<z.ZodNumber>;
    max_rate_limit_wait_seconds: z.ZodDefault<z.ZodNumber>;
    quota_refresh_interval_minutes: z.ZodDefault<z.ZodNumber>;
    soft_quota_threshold_percent: z.ZodDefault<z.ZodNumber>;
    soft_quota_cache_ttl_minutes: z.ZodDefault<z.ZodUnion<[z.ZodLiteral<"auto">, z.ZodNumber]>>;
    scheduling_mode: z.ZodDefault<z.ZodEnum<["cache_first", "balance", "performance_first"]>>;
    max_cache_first_wait_seconds: z.ZodDefault<z.ZodNumber>;
    switch_on_first_rate_limit: z.ZodDefault<z.ZodBoolean>;
    pid_offset_enabled: z.ZodDefault<z.ZodBoolean>;
    keep_thinking: z.ZodDefault<z.ZodBoolean>;
    claude_tool_hardening: z.ZodDefault<z.ZodBoolean>;
    request_jitter_max_ms: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    proxy_port: number;
    oauth_port: number;
    quiet_mode: boolean;
    debug: boolean;
    account_selection_strategy: "sticky" | "round-robin" | "hybrid";
    cli_first: boolean;
    default_retry_after_seconds: number;
    max_backoff_seconds: number;
    failure_ttl_seconds: number;
    max_rate_limit_wait_seconds: number;
    quota_refresh_interval_minutes: number;
    soft_quota_threshold_percent: number;
    soft_quota_cache_ttl_minutes: number | "auto";
    scheduling_mode: "cache_first" | "balance" | "performance_first";
    max_cache_first_wait_seconds: number;
    switch_on_first_rate_limit: boolean;
    pid_offset_enabled: boolean;
    keep_thinking: boolean;
    claude_tool_hardening: boolean;
    request_jitter_max_ms: number;
}, {
    proxy_port?: number | undefined;
    oauth_port?: number | undefined;
    quiet_mode?: boolean | undefined;
    debug?: boolean | undefined;
    account_selection_strategy?: "sticky" | "round-robin" | "hybrid" | undefined;
    cli_first?: boolean | undefined;
    default_retry_after_seconds?: number | undefined;
    max_backoff_seconds?: number | undefined;
    failure_ttl_seconds?: number | undefined;
    max_rate_limit_wait_seconds?: number | undefined;
    quota_refresh_interval_minutes?: number | undefined;
    soft_quota_threshold_percent?: number | undefined;
    soft_quota_cache_ttl_minutes?: number | "auto" | undefined;
    scheduling_mode?: "cache_first" | "balance" | "performance_first" | undefined;
    max_cache_first_wait_seconds?: number | undefined;
    switch_on_first_rate_limit?: boolean | undefined;
    pid_offset_enabled?: boolean | undefined;
    keep_thinking?: boolean | undefined;
    claude_tool_hardening?: boolean | undefined;
    request_jitter_max_ms?: number | undefined;
}>;
export type AntigravityConfig = z.infer<typeof AntigravityConfigSchema>;
export declare function initRuntimeConfig(partial: Partial<AntigravityConfig>): void;
export declare function getConfig(): AntigravityConfig;
export declare function getZCodeDir(): string;
export declare function getAccountsFilePath(): string;
export declare function getConfigFilePath(): string;
export declare function getLogDir(): string;
export declare function loadConfig(): AntigravityConfig;
export declare function getManualAccessToken(): string | null;
export declare function getManualProjectId(): string | null;
export {};
//# sourceMappingURL=config.d.ts.map