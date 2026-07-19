/**
 * Tests for JSON Schema cleaning and transformation.
 */
import { describe, it, expect } from "vitest";
import {
  cleanJSONSchema,
  toGeminiSchema,
  createPlaceholderSchema,
} from "../src/transform/schema.js";

// ---- cleanJSONSchema ----

describe("cleanJSONSchema", () => {
  it("returns placeholder for non-object input", () => {
    const result = cleanJSONSchema(null);
    expect(result.type).toBe("object");
    expect(result.properties).toBeDefined();
    expect(Object.keys(result.properties!)).toContain("_placeholder");
  });

  it("returns placeholder for array input", () => {
    const result = cleanJSONSchema([1, 2, 3]);
    expect(result.type).toBe("object");
  });

  it("passes through valid type field", () => {
    const result = cleanJSONSchema({ type: "string", description: "A string" });
    expect(result.type).toBe("string");
    expect(result.description).toBe("A string");
  });

  it("removes unsupported keys: const, $ref, $defs, additionalProperties, $schema, title", () => {
    const result = cleanJSONSchema({
      type: "object",
      const: "fixed",
      $ref: "#/defs/Foo",
      $defs: {},
      additionalProperties: false,
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "My Schema",
      properties: { name: { type: "string" } },
    });
    expect(result.const).toBeUndefined();
    expect(result.$ref).toBeUndefined();
    expect(result.$defs).toBeUndefined();
    expect(result.additionalProperties).toBeUndefined();
    expect(result.$schema).toBeUndefined();
    expect(result.title).toBeUndefined();
    expect(result.properties).toBeDefined();
  });

  it("removes default and examples", () => {
    const result = cleanJSONSchema({
      type: "string",
      default: "hello",
      examples: ["a", "b"],
    });
    expect(result.default).toBeUndefined();
    expect(result.examples).toBeUndefined();
  });

  it("recursively cleans nested properties", () => {
    const result = cleanJSONSchema({
      type: "object",
      properties: {
        nested: {
          type: "string",
          const: "removed",
        },
      },
    });
    const nested = (result.properties as Record<string, unknown>).nested as Record<string, unknown>;
    expect(nested.type).toBe("string");
    expect(nested.const).toBeUndefined();
  });

  it("preserves required array", () => {
    const result = cleanJSONSchema({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
    expect(result.required).toEqual(["name"]);
  });

  it("preserves enum array", () => {
    const result = cleanJSONSchema({
      type: "string",
      enum: ["a", "b", "c"],
    });
    expect(result.enum).toEqual(["a", "b", "c"]);
  });

  it("recursively cleans items for arrays", () => {
    const result = cleanJSONSchema({
      type: "array",
      items: { type: "string", const: "removed" },
    });
    const items = result.items as Record<string, unknown>;
    expect(items.type).toBe("string");
    expect(items.const).toBeUndefined();
  });

  it("adds default type object when type is missing", () => {
    const result = cleanJSONSchema({ properties: { name: { type: "string" } } });
    expect(result.type).toBe("object");
  });

  it("adds _placeholder when object has no properties", () => {
    const result = cleanJSONSchema({ type: "object" });
    expect(result.type).toBe("object");
    const props = result.properties as Record<string, unknown>;
    expect(Object.keys(props)).toContain("_placeholder");
    expect(result.required).toContain("_placeholder");
  });

  it("does not add placeholder when properties exist", () => {
    const result = cleanJSONSchema({
      type: "object",
      properties: { name: { type: "string" } },
    });
    const props = result.properties as Record<string, unknown>;
    expect(Object.keys(props)).not.toContain("_placeholder");
  });

  it("adds _placeholder when properties is empty object", () => {
    const result = cleanJSONSchema({
      type: "object",
      properties: {},
    });
    const props = result.properties as Record<string, unknown>;
    expect(Object.keys(props)).toContain("_placeholder");
  });
});

// ---- createPlaceholderSchema ----

describe("createPlaceholderSchema", () => {
  it("returns an object schema with _placeholder boolean", () => {
    const result = createPlaceholderSchema();
    expect(result.type).toBe("object");
    expect(result.properties).toBeDefined();
    const props = result.properties as Record<string, unknown>;
    expect(props._placeholder).toBeDefined();
    expect((props._placeholder as Record<string, unknown>).type).toBe("boolean");
    expect(result.required).toEqual(["_placeholder"]);
  });
});

// ---- toGeminiSchema ----

describe("toGeminiSchema", () => {
  it("returns primitives as-is", () => {
    expect(toGeminiSchema("hello")).toBe("hello");
    expect(toGeminiSchema(42)).toBe(42);
    expect(toGeminiSchema(null)).toBe(null);
    expect(toGeminiSchema(true)).toBe(true);
  });

  it("returns arrays as-is (they get processed by array items separately)", () => {
    expect(toGeminiSchema([1, 2])).toEqual([1, 2]);
  });

  it("converts type to uppercase", () => {
    const result = toGeminiSchema({ type: "string" }) as Record<string, unknown>;
    expect(result.type).toBe("STRING");
  });

  it("converts object type to OBJECT", () => {
    const result = toGeminiSchema({ type: "object" }) as Record<string, unknown>;
    expect(result.type).toBe("OBJECT");
  });

  it("converts array type to ARRAY", () => {
    const result = toGeminiSchema({ type: "array" }) as Record<string, unknown>;
    expect(result.type).toBe("ARRAY");
  });

  it("converts number type to NUMBER", () => {
    const result = toGeminiSchema({ type: "number" }) as Record<string, unknown>;
    expect(result.type).toBe("NUMBER");
  });

  it("converts boolean type to BOOLEAN", () => {
    const result = toGeminiSchema({ type: "boolean" }) as Record<string, unknown>;
    expect(result.type).toBe("BOOLEAN");
  });

  it("removes $ref and $defs", () => {
    const result = toGeminiSchema({
      type: "object",
      $ref: "#/defs/Foo",
      $defs: { Foo: { type: "string" } },
    }) as Record<string, unknown>;
    expect(result.$ref).toBeUndefined();
    expect(result.$defs).toBeUndefined();
  });

  it("removes const field", () => {
    const result = toGeminiSchema({
      type: "string",
      const: "fixed-value",
    }) as Record<string, unknown>;
    expect(result.const).toBeUndefined();
  });

  it("removes additionalProperties", () => {
    const result = toGeminiSchema({
      type: "object",
      additionalProperties: false,
    }) as Record<string, unknown>;
    expect(result.additionalProperties).toBeUndefined();
  });

  it("removes conditionals: if, then, else, not", () => {
    const result = toGeminiSchema({
      type: "object",
      if: { type: "string" },
      then: { minLength: 1 },
      else: { minLength: 0 },
      not: { type: "null" },
    }) as Record<string, unknown>;
    expect(result.if).toBeUndefined();
    expect(result.then).toBeUndefined();
    expect(result.else).toBeUndefined();
    expect(result.not).toBeUndefined();
  });

  it("removes patternProperties, unevaluatedProperties, unevaluatedItems", () => {
    const result = toGeminiSchema({
      type: "object",
      patternProperties: { "^S_": { type: "string" } },
      unevaluatedProperties: false,
      unevaluatedItems: false,
    }) as Record<string, unknown>;
    expect(result.patternProperties).toBeUndefined();
    expect(result.unevaluatedProperties).toBeUndefined();
    expect(result.unevaluatedItems).toBeUndefined();
  });

  it("removes dependentRequired, dependentSchemas, propertyNames", () => {
    const result = toGeminiSchema({
      type: "object",
      dependentRequired: { foo: ["bar"] },
      dependentSchemas: {},
      propertyNames: { type: "string" },
    }) as Record<string, unknown>;
    expect(result.dependentRequired).toBeUndefined();
    expect(result.dependentSchemas).toBeUndefined();
    expect(result.propertyNames).toBeUndefined();
  });

  it("recursively transforms nested properties", () => {
    const result = toGeminiSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
    }) as Record<string, unknown>;
    const props = result.properties as Record<string, unknown>;
    expect((props.name as Record<string, unknown>).type).toBe("STRING");
    expect((props.age as Record<string, unknown>).type).toBe("INTEGER");
  });

  it("recursively transforms array items", () => {
    const result = toGeminiSchema({
      type: "array",
      items: { type: "string", enum: ["a", "b"] },
    }) as Record<string, unknown>;
    const items = result.items as Record<string, unknown>;
    expect(items.type).toBe("STRING");
    expect(items.enum).toEqual(["a", "b"]);
  });

  it("adds default items for ARRAY without items", () => {
    const result = toGeminiSchema({
      type: "array",
    }) as Record<string, unknown>;
    expect(result.items).toBeDefined();
    expect((result.items as Record<string, unknown>).type).toBe("STRING");
  });

  it("does not add default items for non-ARRAY types", () => {
    const result = toGeminiSchema({
      type: "object",
    }) as Record<string, unknown>;
    expect(result.items).toBeUndefined();
  });

  it("transforms anyOf schemas", () => {
    const result = toGeminiSchema({
      anyOf: [
        { type: "string" },
        { type: "number" },
      ],
    }) as Record<string, unknown>;
    const anyOf = result.anyOf as Record<string, unknown>[];
    expect(anyOf[0].type).toBe("STRING");
    expect(anyOf[1].type).toBe("NUMBER");
  });

  it("transforms oneOf schemas", () => {
    const result = toGeminiSchema({
      oneOf: [{ type: "string" }, { type: "null" }],
    }) as Record<string, unknown>;
    const oneOf = result.oneOf as Record<string, unknown>[];
    expect(oneOf[0].type).toBe("STRING");
    expect(oneOf[1].type).toBe("NULL");
  });

  it("preserves enum, default, and examples values", () => {
    const result = toGeminiSchema({
      type: "string",
      enum: ["a", "b"],
      default: "a",
      examples: ["a", "b"],
    }) as Record<string, unknown>;
    expect(result.enum).toEqual(["a", "b"]);
    expect(result.default).toBe("a");
    expect(result.examples).toEqual(["a", "b"]);
  });

  it("filters required to only valid properties", () => {
    const result = toGeminiSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
      required: ["name", "email", "age"], // email doesn't exist
    }) as Record<string, unknown>;
    expect(result.required).toEqual(["name", "age"]);
  });

  it("omits required when no valid properties remain", () => {
    const result = toGeminiSchema({
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["email"], // email doesn't exist
    }) as Record<string, unknown>;
    expect(result.required).toBeUndefined();
  });

  it("preserves required when there are no properties (schema without properties)", () => {
    const result = toGeminiSchema({
      type: "string",
      required: ["something"],
    }) as Record<string, unknown>;
    expect(result.required).toEqual(["something"]);
  });

  it("passes through description field", () => {
    const result = toGeminiSchema({
      type: "string",
      description: "A text value",
    }) as Record<string, unknown>;
    expect(result.description).toBe("A text value");
  });

  it("removes numeric constraints: exclusiveMinimum, exclusiveMaximum, minimum, maximum, multipleOf", () => {
    const result = toGeminiSchema({
      type: "number",
      exclusiveMinimum: 0,
      exclusiveMaximum: 100,
      minimum: 1,
      maximum: 99,
      multipleOf: 5,
    }) as Record<string, unknown>;
    expect(result.exclusiveMinimum).toBeUndefined();
    expect(result.exclusiveMaximum).toBeUndefined();
    expect(result.minimum).toBeUndefined();
    expect(result.maximum).toBeUndefined();
    expect(result.multipleOf).toBeUndefined();
    expect(result.type).toBe("NUMBER");
  });

  it("removes string constraints: minLength, maxLength, pattern, format", () => {
    const result = toGeminiSchema({
      type: "string",
      minLength: 1,
      maxLength: 100,
      pattern: "^[a-z]+$",
      format: "email",
    }) as Record<string, unknown>;
    expect(result.minLength).toBeUndefined();
    expect(result.maxLength).toBeUndefined();
    expect(result.pattern).toBeUndefined();
    expect(result.format).toBeUndefined();
    expect(result.type).toBe("STRING");
  });

  it("removes array and object constraints: minItems, maxItems, uniqueItems, minProperties, maxProperties", () => {
    const result = toGeminiSchema({
      type: "object",
      properties: {
        tags: { type: "array", minItems: 1, maxItems: 10, uniqueItems: true },
      },
      minProperties: 1,
      maxProperties: 5,
    }) as Record<string, unknown>;
    expect(result.minProperties).toBeUndefined();
    expect(result.maxProperties).toBeUndefined();
    const tags = (result.properties as Record<string, unknown>).tags as Record<string, unknown>;
    expect(tags.minItems).toBeUndefined();
    expect(tags.maxItems).toBeUndefined();
    expect(tags.uniqueItems).toBeUndefined();
    expect(tags.type).toBe("ARRAY");
  });

  it("handles the actual ZCode exclusiveMinimum error case", () => {
    // This simulates the actual error ZCode was sending: exclusiveMinimum in tool parameters
    const result = toGeminiSchema({
      type: "object",
      properties: {
        value: {
          type: "number",
          exclusiveMinimum: 0,
          description: "A positive number",
        },
      },
    }) as Record<string, unknown>;
    const props = result.properties as Record<string, unknown>;
    const value = props.value as Record<string, unknown>;
    expect(value.exclusiveMinimum).toBeUndefined();
    expect(value.type).toBe("NUMBER");
    expect(value.description).toBe("A positive number");
  });

  it("handles null schema gracefully", () => {
    const result = toGeminiSchema(null);
    expect(result).toBeNull();
  });

  it("handles undefined schema gracefully", () => {
    const result = toGeminiSchema(undefined);
    expect(result).toBeUndefined();
  });
});
