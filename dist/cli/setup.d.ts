/**
 * CLI: antigravity-auth setup
 * Auto-adds the Antigravity provider to ~/.zcode/v2/config.json.
 */
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
export interface SetupResult {
    action: "added" | "updated" | "unchanged";
    configPath: string;
    baseURL: string;
    modelCount: number;
    modelNames: string[];
}
export declare function setupAntigravityProvider(): SetupResult;
/**
 * Check if the Antigravity provider is already configured.
 */
export declare function isProviderConfigured(): boolean;
/**
 * Get the current provider config (if any).
 */
export declare function getProviderConfig(): ZCodeProviderConfig | null;
/**
 * Remove the Antigravity provider from the ZCode config.
 */
export declare function removeAntigravityProvider(): boolean;
export {};
//# sourceMappingURL=setup.d.ts.map