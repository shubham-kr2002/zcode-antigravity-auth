/**
 * OpenAI-compatible → Antigravity Gemini format request transformer.
 *
 * Transforms:
 * - messages[] → contents[].parts[]
 * - tools[] → functionDeclarations[] (with Claude/Gemini normalization)
 * - system message → systemInstruction (with interleaved thinking hints)
 * - Wraps in { project, model, request }
 *
 * Phase 4: Integrated model resolver, Claude/Gemini transforms,
 * schema cleaning (toGeminiSchema), cross-model sanitization.
 */
import { type HeaderStyle } from "../constants.js";
import type { AntigravityConfig } from "../config.js";
export interface OpenAIChatRequest {
    model: string;
    messages: OpenAIMessage[];
    tools?: OpenAITool[];
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    stop?: string[];
    thinking?: {
        type: "enabled" | "disabled";
        budget_tokens?: number;
    };
}
export interface OpenAIMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    name?: string;
    tool_calls?: OpenAIToolCall[];
    tool_call_id?: string;
    reasoning_content?: string;
}
export interface OpenAIToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}
export interface OpenAITool {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
    };
}
interface AntigravityContent {
    role: "user" | "model";
    parts: AntigravityPart[];
}
interface AntigravityPart {
    text?: string;
    functionCall?: {
        name: string;
        args: Record<string, unknown>;
    };
    functionResponse?: {
        name: string;
        response: unknown;
    };
}
interface AntigravityToolDeclaration {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}
export interface AntigravityRequest {
    project: string;
    model: string;
    request: {
        contents: AntigravityContent[];
        systemInstruction?: {
            role: string;
            parts: {
                text: string;
            }[];
        };
        tools?: {
            functionDeclarations: AntigravityToolDeclaration[];
        }[];
        toolConfig?: {
            functionCallingConfig: {
                mode: string;
            };
        };
        generationConfig?: Record<string, unknown>;
    };
    userAgent?: string;
    requestType?: string;
    requestId?: string;
}
export interface TransformOptions {
    projectId: string;
    accessToken: string;
    headerStyle?: HeaderStyle;
    config: AntigravityConfig;
}
export declare function transformRequest(openaiReq: OpenAIChatRequest, options: TransformOptions): {
    url: string;
    init: RequestInit;
};
export {};
//# sourceMappingURL=request.d.ts.map