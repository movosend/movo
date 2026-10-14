import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/modules/**/*.ts", "src/adapters/**/*.ts", "src/utils/**/*.ts"],
      exclude: ["src/modules/**/*.schema.ts", "src/modules/**/*.routes.ts"],
      // MOVO-288: con dominio real (bitácora, conflicto de interés, clientes internos) se
      // activa el mínimo acordado para componentes críticos (plan de testing: 70%).
      thresholds: { lines: 70 },
    },
  },
});
