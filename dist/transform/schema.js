/**
 * JSON Schema cleaning and transformation for Antigravity Gemini API.
 *
 * Two levels of cleaning:
 * 1. cleanJSONSchema — light cleaning for Claude (removes unsupported fields, adds _placeholder)
 * 2. toGeminiSchema  — full Gemini-compatible schema (uppercase types, 22+ unsupported fields)
 */
// ---- Shared Constants ----
/**
 * Fields that the Antigravity API supports in Schema objects (function declarations).
 * Antigravity uses strict protobuf-backed JSON validation — any field NOT in this set
 * is rejected with "Unknown name" errors.
 * Based on the Google Cloud Vertex AI FunctionDeclaration Schema proto.
 * Only include fields we've confirmed work — be conservative.
 */
const SUPPORTED_SCHEMA_FIELDS = new Set([
    "type",
    "properties",
    "items",
    "required",
    "description",
    "enum",
    "nullable",
    "default",
    "examples",
    "anyOf",
    "oneOf",
    "allOf",
]);
/**
 * Strip any field that is NOT in the supported set.
 * This is safer than maintaining a blocklist — any field Antigravity
 * doesn't support is automatically dropped.
 */
function stripUnsupportedFields(schema) {
    const result = {};
    for (const [key, value] of Object.entries(schema)) {
        if (SUPPORTED_SCHEMA_FIELDS.has(key)) {
            result[key] = value;
        }
    }
    // Always ensure type is set for the object itself
    if (!result.type) {
        result.type = "OBJECT";
    }
    return result;
}
/** Fields removed in basic Claude-level cleaning. */
const BASIC_UNSUPPORTED_KEYS = new Set([
    "const",
    "$ref",
    "$defs",
    "default",
    "examples",
    "additionalProperties",
    "$schema",
    "title",
]);
// ---- Shared Helpers ----
/** Name for placeholder properties added to empty schemas. */
const EMPTY_SCHEMA_PLACEHOLDER_NAME = "_placeholder";
const EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION = "Placeholder. Always pass true.";
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
// ---- Claude-level Schema Cleaning ----
/**
 * Light schema cleaning for Claude models.
 * Removes basic unsupported fields and ensures at least one property exists
 * for Claude's VALIDATED mode.
 */
export function cleanJSONSchema(schema) {
    if (!isObject(schema)) {
        return createPlaceholderSchema();
    }
    const cleaned = {};
    for (const [key, value] of Object.entries(schema)) {
        if (BASIC_UNSUPPORTED_KEYS.has(key))
            continue;
        if (key === "type" && typeof value === "string") {
            cleaned.type = value;
            continue;
        }
        if (key === "properties" && isObject(value)) {
            const props = {};
            for (const [propName, propSchema] of Object.entries(value)) {
                props[propName] = cleanJSONSchema(propSchema);
            }
            cleaned.properties = props;
            continue;
        }
        if (key === "required" && Array.isArray(value)) {
            cleaned.required = value;
            continue;
        }
        if (key === "description" && typeof value === "string") {
            cleaned.description = value;
            continue;
        }
        if (key === "enum" && Array.isArray(value)) {
            cleaned.enum = value;
            continue;
        }
        if (key === "items" && value) {
            cleaned.items = cleanJSONSchema(value);
            continue;
        }
    }
    // Ensure type is set
    if (!cleaned.type) {
        cleaned.type = "object";
    }
    // Claude VALIDATED mode requires at least one property
    if (cleaned.type === "object") {
        const props = (cleaned.properties ?? {});
        if (Object.keys(props).length === 0) {
            cleaned.properties = {
                [EMPTY_SCHEMA_PLACEHOLDER_NAME]: {
                    type: "boolean",
                    description: EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION,
                },
            };
            cleaned.required = [EMPTY_SCHEMA_PLACEHOLDER_NAME];
        }
    }
    return cleaned;
}
/**
 * Create a placeholder schema for tools without parameters.
 */
export function createPlaceholderSchema() {
    return {
        type: "object",
        properties: {
            [EMPTY_SCHEMA_PLACEHOLDER_NAME]: {
                type: "boolean",
                description: EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION,
            },
        },
        required: [EMPTY_SCHEMA_PLACEHOLDER_NAME],
    };
}
// ---- Gemini Schema Transformation (toGeminiSchema) ----
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
export function toGeminiSchema(schema) {
    // Return primitives and arrays as-is
    if (!isObject(schema)) {
        return schema;
    }
    const result = {};
    // First pass: collect all property names for required validation
    const propertyNames = new Set();
    if (isObject(schema.properties)) {
        for (const propName of Object.keys(schema.properties)) {
            propertyNames.add(propName);
        }
    }
    for (const [key, value] of Object.entries(schema)) {
        // Strip any field that Antigravity doesn't support
        if (!SUPPORTED_SCHEMA_FIELDS.has(key)) {
            continue;
        }
        if (key === "type" && typeof value === "string") {
            // Convert type to uppercase for Gemini API
            result[key] = value.toUpperCase();
        }
        else if (key === "properties" && isObject(value)) {
            // Recursively transform nested property schemas
            const props = {};
            for (const [propName, propSchema] of Object.entries(value)) {
                props[propName] = toGeminiSchema(propSchema);
            }
            result[key] = props;
        }
        else if (key === "items" && isObject(value)) {
            // Transform array items schema
            result[key] = toGeminiSchema(value);
        }
        else if ((key === "anyOf" || key === "oneOf" || key === "allOf") && Array.isArray(value)) {
            // Transform union type schemas
            result[key] = value.map((item) => toGeminiSchema(item));
        }
        else if (key === "enum" && Array.isArray(value)) {
            result[key] = value;
        }
        else if (key === "default" || key === "examples") {
            result[key] = value;
        }
        else if (key === "required" && Array.isArray(value)) {
            // Filter required array to only include properties that exist
            // This fixes: "parameters.required[X]: property is not defined"
            if (propertyNames.size > 0) {
                const validRequired = value.filter((prop) => typeof prop === "string" && propertyNames.has(prop));
                if (validRequired.length > 0) {
                    result[key] = validRequired;
                }
                // If no valid required properties, omit the required field entirely
            }
            else {
                // If there are no properties, keep required as-is
                result[key] = value;
            }
        }
        else {
            result[key] = value;
        }
    }
    // Issue #80: Ensure array schemas have an 'items' field
    // Gemini API requires: "parameters.properties[X].items: missing field"
    if (result.type === "ARRAY" && !result.items) {
        result.items = { type: "STRING" };
    }
    return result;
}
export { EMPTY_SCHEMA_PLACEHOLDER_NAME, EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION };
//# sourceMappingURL=schema.js.map