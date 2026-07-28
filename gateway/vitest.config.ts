import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/config/**"],
    },
  },
});
