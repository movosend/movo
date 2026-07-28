import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/modules/**/*.service.ts", "src/modules/**/*.repository.ts"],
      exclude: ["src/modules/**/*.schema.ts", "src/modules/**/*.routes.ts"],
      thresholds: {
        lines: 55,
      },
    },
  },
});
