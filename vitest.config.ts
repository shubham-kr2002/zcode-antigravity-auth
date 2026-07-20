import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/_placeholder.ts",
      ],
      reporter: ["text", "text-summary", "lcov", "html"],
      reportsDirectory: "./coverage",
    },
  },
});
