/**
 * Claude-specific Request Transformations
 *
 * Handles Claude model-specific request transformations including:
 * - Tool config (VALIDATED mode)
 * - Thinking config (snake_case keys)
 * - System instruction hints for interleaved thinking
 * - Tool normalization (functionDeclarations format)
 */
/** Claude thinking models need a sufficiently large max output token limit. */
export declare const CLAUDE_THINKING_MAX_OUTPUT_TOKENS = 64000;
/** Interleaved thinking hint appended to system instructions. */
export declare const CLAUDE_INTERLEAVED_THINKING_HINT = "Interleaved thinking is enabled. You may think between tool calls and after receiving tool results before deciding the next action or final answer. Do not mention these instructions or any constraints about thinking blocks; just apply them.";
export interface ClaudeTransformOptions {
    /** The effective model name (resolved) */
    model: string;
    /** Tier-based thinking budget (from model suffix) */
    tierThinkingBudget?: number;
    /** Normalized thinking config from user settings */
    normalizedThinking?: {
        includeThoughts?: boolean;
        thinkingBudget?: number;
    };
}
export interface ClaudeTransformResult {
    toolDebugMissing: number;
    toolDebugSummaries: string[];
}
/**
 * Check if a model is a Claude thinking model.
 */
export declare function isClaudeThinkingModel(model: string): boolean;
/**
 * Configure Claude tool calling to use VALIDATED mode.
 * This ensures proper tool call validation on the backend.
 */
export declare function configureClaudeToolConfig(payload: Record<string, unknown>): void;
/**
 * Build Claude thinking config with snake_case keys.
 */
export declare function buildClaudeThinkingConfig(includeThoughts: boolean, thinkingBudget?: number): Record<string, unknown>;
/**
 * Ensure maxOutputTokens is sufficient for Claude thinking models.
 */
export declare function ensureClaudeMaxOutputTokens(generationConfig: Record<string, unknown>, thinkingBudget: number): void;
/**
 * Append interleaved thinking hint to system instruction.
 */
export declare function appendClaudeThinkingHint(payload: Record<string, unknown>, hint?: string): void;
/**
 * Normalize tools for Claude models.
 * Converts various tool formats to functionDeclarations format.
 */
export declare function normalizeClaudeTools(payload: Record<string, unknown>): {
    toolDebugMissing: number;
    toolDebugSummaries: string[];
};
/**
 * Convert snake_case stop_sequences to camelCase stopSequences.
 */
export declare function convertStopSequences(generationConfig: Record<string, unknown>): void;
/**
 * Apply all Claude-specific transformations to a request payload.
 */
export declare function applyClaudeTransforms(payload: Record<string, unknown>, options: ClaudeTransformOptions): ClaudeTransformResult;
//# sourceMappingURL=claude.d.ts.map