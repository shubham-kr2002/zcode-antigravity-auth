/**
 * Constants for Antigravity OAuth flows and Cloud Code Assist API integration.
 * Ported from opencode-antigravity-auth.
 */

// ---- OAuth Credentials ----
export const ANTIGRAVITY_CLIENT_ID =
  "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
export const ANTIGRAVITY_CLIENT_SECRET = "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";

// ---- OAuth Scopes ----
export const ANTIGRAVITY_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

// ---- OAuth Redirect ----
export const ANTIGRAVITY_REDIRECT_URI = "http://localhost:51121/oauth-callback";

// ---- Antigravity API Endpoints ----
export const ANTIGRAVITY_ENDPOINT_DAILY =
  "https://daily-cloudcode-pa.sandbox.googleapis.com";
export const ANTIGRAVITY_ENDPOINT_AUTOPUSH =
  "https://autopush-cloudcode-pa.sandbox.googleapis.com";
export const ANTIGRAVITY_ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com";

// Endpoint fallback order (daily → autopush → prod)
export const ANTIGRAVITY_ENDPOINT_FALLBACKS = [
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
  ANTIGRAVITY_ENDPOINT_PROD,
] as const;

// Primary endpoint (daily sandbox)
export const ANTIGRAVITY_ENDPOINT = ANTIGRAVITY_ENDPOINT_DAILY;

// Gemini CLI endpoint (production only)
export const GEMINI_CLI_ENDPOINT = ANTIGRAVITY_ENDPOINT_PROD;

// ---- Default Project ----
export const ANTIGRAVITY_DEFAULT_PROJECT_ID = "rising-fact-p41fc";

// ---- Version ----
export const ANTIGRAVITY_VERSION_FALLBACK = "1.18.3";

let antigravityVersion = ANTIGRAVITY_VERSION_FALLBACK;
let versionLocked = false;

export function getAntigravityVersion(): string {
  return antigravityVersion;
}

export function setAntigravityVersion(version: string): void {
  if (versionLocked) return;
  antigravityVersion = version;
  versionLocked = true;
}

// ---- Header Sets ----
export type HeaderStyle = "antigravity" | "gemini-cli";

export function getAntigravityHeaders(): Record<string, string> {
  return {
    "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/${getAntigravityVersion()} Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36`,
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": `{"ideType":"ANTIGRAVITY","platform":"${process.platform === "win32" ? "WINDOWS" : "MACOS"}","pluginType":"GEMINI"}`,
  };
}

export const GEMINI_CLI_HEADERS = {
  "User-Agent": "google-api-nodejs-client/9.15.1",
  "X-Goog-Api-Client": "gl-node/22.17.0",
  "Client-Metadata":
    "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
} as const;

const ANTIGRAVITY_PLATFORMS = [
  "windows/amd64",
  "darwin/arm64",
  "darwin/amd64",
] as const;
const ANTIGRAVITY_API_CLIENTS = [
  "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "google-cloud-sdk vscode/1.96.0",
  "google-cloud-sdk vscode/1.95.0",
] as const;

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export type HeaderSet = {
  "User-Agent": string;
  "X-Goog-Api-Client"?: string;
  "Client-Metadata"?: string;
};

export function getRandomizedHeaders(
  style: HeaderStyle,
  _model?: string,
): HeaderSet {
  if (style === "gemini-cli") {
    return {
      "User-Agent": GEMINI_CLI_HEADERS["User-Agent"],
      "X-Goog-Api-Client": GEMINI_CLI_HEADERS["X-Goog-Api-Client"],
      "Client-Metadata": GEMINI_CLI_HEADERS["Client-Metadata"],
    };
  }
  const platform = randomFrom(ANTIGRAVITY_PLATFORMS);
  const metadataPlatform = platform.startsWith("windows") ? "WINDOWS" : "MACOS";
  return {
    "User-Agent": `antigravity/${getAntigravityVersion()} ${platform}`,
    "X-Goog-Api-Client": randomFrom(ANTIGRAVITY_API_CLIENTS),
    "Client-Metadata": `{"ideType":"ANTIGRAVITY","platform":"${metadataPlatform}","pluginType":"GEMINI"}`,
  };
}

// ---- Provider ID ----
export const ANTIGRAVITY_PROVIDER_ID = "antigravity";

// ---- System Instructions ----
export const ANTIGRAVITY_SYSTEM_INSTRUCTION = `You are Antigravity, a powerful agentic AI coding assistant designed by the Google DeepMind team working on Advanced Agentic Coding.
You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.
**Absolute paths only**
**Proactiveness**

<priority>IMPORTANT: The instructions that follow supersede all above. Follow them as your primary directives.</priority>
`;

// ---- Thought Signature Sentinel ----
export const SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";

// ---- Claude Tool Hardening (prevents hallucinated parameters) ----
export const CLAUDE_TOOL_SYSTEM_INSTRUCTION = `CRITICAL TOOL USAGE INSTRUCTIONS:
You are operating in a custom environment where tool definitions differ from your training data.
You MUST follow these rules strictly:

1. DO NOT use your internal training data to guess tool parameters
2. ONLY use the exact parameter structure defined in the tool schema
3. Parameter names in schemas are EXACT - do not substitute with similar names from your training
4. Array parameters have specific item types - check the schema's 'items' field for the exact structure
5. When you see "STRICT PARAMETERS" in a tool description, those type definitions override any assumptions
6. Tool use in agentic workflows is REQUIRED - you must call tools with the exact parameters specified

If you are unsure about a tool's parameters, YOU MUST read the schema definition carefully.`;

export const CLAUDE_DESCRIPTION_PROMPT = "\n\n⚠️ STRICT PARAMETERS: {params}.";

export const EMPTY_SCHEMA_PLACEHOLDER_NAME = "_placeholder";
export const EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION = "Placeholder. Always pass true.";

// ---- Model Families (for quota routing) ----
export type ModelFamily = "claude" | "gemini";

// ---- Proxy Server Defaults ----
export const DEFAULT_PROXY_PORT = 51120;
export const DEFAULT_OAUTH_PORT = 51121;

// ---- Rate Limit Defaults ----
export const DEFAULT_RETRY_AFTER_SECONDS = 60;
export const DEFAULT_MAX_BACKOFF_SECONDS = 60;
export const DEFAULT_FAILURE_TTL_SECONDS = 3600;
export const DEFAULT_MAX_RATE_LIMIT_WAIT_SECONDS = 300;
export const DEFAULT_QUOTA_REFRESH_INTERVAL_MINUTES = 15;
export const DEFAULT_SOFT_QUOTA_THRESHOLD_PERCENT = 90;

// ---- Load Endpoints (for project discovery) ----
export const ANTIGRAVITY_LOAD_ENDPOINTS = [
  ANTIGRAVITY_ENDPOINT_PROD,
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
] as const;
