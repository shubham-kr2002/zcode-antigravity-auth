import { describe, it, expect } from "vitest";
import { buildModelRegistry } from "../src/models/discovery.js";

describe("minimal", () => {
  it("works", () => {
    const result = buildModelRegistry({});
    expect(result.models).toEqual([]);
  });
});
