import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/modules/**/*.service.ts", "src/modules/**/*.repository.ts"],
      exclude: ["src/modules/**/*.schema.ts", "src/modules/**/*.routes.ts"],
      // Umbral (55% lines) se activa cuando el módulo tenga lógica real y tests;
      // hoy son stubs vacíos, exigir cobertura sobre eso rompería el CI sin sentido.
    },
  },
});
