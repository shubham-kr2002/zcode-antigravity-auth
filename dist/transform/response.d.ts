/**
 * Antigravity Gemini format → OpenAI-compatible response transformer.
 *
 * Transforms:
 * - candidates[] → choices[]
 * - parts[{text}] → delta.content
 * - parts[{thought}] → delta.reasoning_content
 * - functionCall → tool_calls (with FIFO ID matching)
 * - usageMetadata → usage
 * - SSE streaming: rewrites each SSE line in real-time
 *
 * Phase 4: Improved FIFO tool call ID matching, edge case handling.
 */
/** Reset the SSE state for a new request. */
export declare function resetSSEState(): void;
export declare function transformSSELine(line: string): string | null;
export declare function transformNonStreamResponse(responseText: string, model: string): string;
export declare function createStreamingTransform(): TransformStream<string, string>;
//# sourceMappingURL=response.d.ts.map