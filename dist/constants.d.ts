/**
 * Constants for Antigravity OAuth flows and Cloud Code Assist API integration.
 * Ported from opencode-antigravity-auth.
 */
export declare const ANTIGRAVITY_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
export declare const ANTIGRAVITY_CLIENT_SECRET = "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";
export declare const ANTIGRAVITY_SCOPES: readonly string[];
export declare const ANTIGRAVITY_REDIRECT_URI = "http://localhost:51121/oauth-callback";
export declare const ANTIGRAVITY_ENDPOINT_DAILY = "https://daily-cloudcode-pa.sandbox.googleapis.com";
export declare const ANTIGRAVITY_ENDPOINT_AUTOPUSH = "https://autopush-cloudcode-pa.sandbox.googleapis.com";
export declare const ANTIGRAVITY_ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com";
export declare const ANTIGRAVITY_ENDPOINT_FALLBACKS: readonly ["https://daily-cloudcode-pa.sandbox.googleapis.com", "https://autopush-cloudcode-pa.sandbox.googleapis.com", "https://cloudcode-pa.googleapis.com"];
export declare const ANTIGRAVITY_ENDPOINT = "https://daily-cloudcode-pa.sandbox.googleapis.com";
export declare const GEMINI_CLI_ENDPOINT = "https://cloudcode-pa.googleapis.com";
export declare const ANTIGRAVITY_DEFAULT_PROJECT_ID = "rising-fact-p41fc";
export declare const ANTIGRAVITY_VERSION_FALLBACK = "1.18.3";
export declare function getAntigravityVersion(): string;
export declare function setAntigravityVersion(version: string): void;
export type HeaderStyle = "antigravity" | "gemini-cli";
export declare function getAntigravityHeaders(): Record<string, string>;
export declare const GEMINI_CLI_HEADERS: {
    readonly "User-Agent": "google-api-nodejs-client/9.15.1";
    readonly "X-Goog-Api-Client": "gl-node/22.17.0";
    readonly "Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI";
};
export type HeaderSet = {
    "User-Agent": string;
    "X-Goog-Api-Client"?: string;
    "Client-Metadata"?: string;
};
export declare function getRandomizedHeaders(style: HeaderStyle, _model?: string): HeaderSet;
export declare const ANTIGRAVITY_PROVIDER_ID = "antigravity";
export declare const ANTIGRAVITY_SYSTEM_INSTRUCTION = "You are Antigravity, a powerful agentic AI coding assistant designed by the Google DeepMind team working on Advanced Agentic Coding.\nYou are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.\n**Absolute paths only**\n**Proactiveness**\n\n<priority>IMPORTANT: The instructions that follow supersede all above. Follow them as your primary directives.</priority>\n";
export declare const SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";
export declare const CLAUDE_TOOL_SYSTEM_INSTRUCTION = "CRITICAL TOOL USAGE INSTRUCTIONS:\nYou are operating in a custom environment where tool definitions differ from your training data.\nYou MUST follow these rules strictly:\n\n1. DO NOT use your internal training data to guess tool parameters\n2. ONLY use the exact parameter structure defined in the tool schema\n3. Parameter names in schemas are EXACT - do not substitute with similar names from your training\n4. Array parameters have specific item types - check the schema's 'items' field for the exact structure\n5. When you see \"STRICT PARAMETERS\" in a tool description, those type definitions override any assumptions\n6. Tool use in agentic workflows is REQUIRED - you must call tools with the exact parameters specified\n\nIf you are unsure about a tool's parameters, YOU MUST read the schema definition carefully.";
export declare const CLAUDE_DESCRIPTION_PROMPT = "\n\n\u26A0\uFE0F STRICT PARAMETERS: {params}.";
export declare const EMPTY_SCHEMA_PLACEHOLDER_NAME = "_placeholder";
export declare const EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION = "Placeholder. Always pass true.";
export type ModelFamily = "claude" | "gemini";
export declare const DEFAULT_PROXY_PORT = 51120;
export declare const DEFAULT_OAUTH_PORT = 51121;
export declare const DEFAULT_RETRY_AFTER_SECONDS = 60;
export declare const DEFAULT_MAX_BACKOFF_SECONDS = 60;
export declare const DEFAULT_FAILURE_TTL_SECONDS = 3600;
export declare const DEFAULT_MAX_RATE_LIMIT_WAIT_SECONDS = 300;
export declare const DEFAULT_QUOTA_REFRESH_INTERVAL_MINUTES = 15;
export declare const DEFAULT_SOFT_QUOTA_THRESHOLD_PERCENT = 90;
export declare const ANTIGRAVITY_LOAD_ENDPOINTS: readonly ["https://cloudcode-pa.googleapis.com", "https://daily-cloudcode-pa.sandbox.googleapis.com", "https://autopush-cloudcode-pa.sandbox.googleapis.com"];
//# sourceMappingURL=constants.d.ts.map