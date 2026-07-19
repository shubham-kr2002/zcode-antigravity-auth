/**
 * Cross-Model Metadata Sanitization
 *
 * Fixes: "Invalid `signature` in `thinking` block" error when switching models mid-session.
 *
 * Root cause: Gemini stores thoughtSignature in metadata.google, Claude stores signature
 * in top-level thinking blocks. Foreign signatures fail validation on the target model.
 */
export type TargetModelFamily = "claude" | "gemini" | "unknown";
export interface SanitizerOptions {
    targetModel: string;
    sourceModel?: string;
    preserveNonSignatureMetadata?: boolean;
}
export interface SanitizationResult {
    payload: unknown;
    modified: boolean;
    signaturesStripped: number;
}
export declare function getTargetFamily(model: string): TargetModelFamily;
export declare function stripGeminiThinkingMetadata(part: Record<string, unknown>, preserveNonSignature?: boolean): {
    part: Record<string, unknown>;
    stripped: number;
};
export declare function stripClaudeThinkingFields(part: Record<string, unknown>): {
    part: Record<string, unknown>;
    stripped: number;
};
export declare function deepSanitizeCrossModelMetadata(obj: unknown, targetFamily: TargetModelFamily, preserveNonSignature?: boolean): {
    obj: unknown;
    stripped: number;
};
/**
 * Sanitize a payload for cross-model compatibility.
 *
 * Strips foreign signature/metadata fields from conversation history
 * that would cause validation errors on the target model.
 */
export declare function sanitizeCrossModelPayload(payload: unknown, options: SanitizerOptions): SanitizationResult;
/**
 * Sanitize a payload in-place (mutates the object).
 * Returns the number of signatures stripped.
 */
export declare function sanitizeCrossModelPayloadInPlace(payload: Record<string, unknown>, options: SanitizerOptions): number;
//# sourceMappingURL=cross-model-sanitizer.d.ts.map