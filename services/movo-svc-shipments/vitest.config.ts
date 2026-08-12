import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/modules/**/*.service.ts", "src/modules/**/*.repository.ts", "src/domain/**/*.ts"],
      exclude: ["src/modules/**/*.schema.ts", "src/modules/**/*.routes.ts"],
      // Umbral general (55% lines) se activa cuando el resto de los módulos (hoy stubs
      // vacíos) tenga lógica real y tests — src/domain/shipment-state-machine.ts (MOVO-105)
      // ya lo cumple individualmente (100%), pero exigirlo repo-wide todavía rompería el
      // CI sin sentido contra los stubs.
    },
  },
});
