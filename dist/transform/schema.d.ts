/**
 * JSON Schema cleaning and transformation for Antigravity Gemini API.
 *
 * Two levels of cleaning:
 * 1. cleanJSONSchema — light cleaning for Claude (removes unsupported fields, adds _placeholder)
 * 2. toGeminiSchema  — full Gemini-compatible schema (uppercase types, 22+ unsupported fields)
 */
/** Name for placeholder properties added to empty schemas. */
declare const EMPTY_SCHEMA_PLACEHOLDER_NAME = "_placeholder";
declare const EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION = "Placeholder. Always pass true.";
/**
 * Light schema cleaning for Claude models.
 * Removes basic unsupported fields and ensures at least one property exists
 * for Claude's VALIDATED mode.
 */
export declare function cleanJSONSchema(schema: unknown): Record<string, unknown>;
/**
 * Create a placeholder schema for tools without parameters.
 */
export declare function createPlaceholderSchema(): Record<string, unknown>;
/**
 * Transform a JSON Schema to Gemini-compatible format.
 * Based on @google/genai SDK's processJsonSchema() function.
 *
 * Key transformations:
 * - Converts type values to uppercase (object → OBJECT)
 * - Removes 22 unsupported fields
 * - Recursively processes nested schemas (properties, items, anyOf, etc.)
 * - Filters `required` array to only include properties that exist
 * - Adds default `items` for array types without one
 */
export declare function toGeminiSchema(schema: unknown): unknown;
export { EMPTY_SCHEMA_PLACEHOLDER_NAME, EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION };
//# sourceMappingURL=schema.d.ts.map