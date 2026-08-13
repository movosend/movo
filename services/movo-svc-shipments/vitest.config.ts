import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Los tests de integración de shipment-repository.ts (MOVO-104) pegan
    // contra el mismo Postgres real y aíslan filas con TRUNCATE en
    // beforeEach — mismo motivo que fileParallelism: false en
    // movo-svc-users (MOVO-87): correr archivos en paralelo pisa filas entre
    // sí.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: [
        "src/modules/**/*.service.ts",
        "src/modules/**/*.repository.ts",
        "src/domain/**/*.ts",
        "src/repositories/**/*.ts",
        "src/models/**/*.ts",
      ],
      exclude: ["src/modules/**/*.schema.ts", "src/modules/**/*.routes.ts"],
      // Umbral general (55% lines) se activa cuando el resto de los módulos (hoy stubs
      // vacíos) tenga lógica real y tests — src/domain/shipment-state-machine.ts (MOVO-105)
      // y src/repositories/shipment-repository.ts (MOVO-104) ya lo cumplen individualmente,
      // pero exigirlo repo-wide todavía rompería el CI sin sentido contra los stubs.
    },
  },
});
