import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Los tests de integración comparten la misma base y truncan tablas
    // (`carrier_mp_accounts` lo usan mp-connect y holds): en paralelo se pisan.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: [
        "src/modules/**/*.service.ts",
        "src/modules/**/*.repository.ts",
        // MOVO-267: el cliente de MP y la config del logger (redacción) son código
        // real con tests propios, no stubs.
        "src/adapters/**/*.ts",
        // MOVO-209: holds (service) y su repositorio.
        "src/modules/holds/*.ts",
        // MOVO-111: vinculación de la cuenta de MP.
        "src/modules/mp-connect/*.ts",
        "src/repositories/**/*.ts",
        "src/utils/**/*.ts",
        "src/config/logger.ts",
      ],
      exclude: ["src/modules/**/*.schema.ts", "src/modules/**/*.routes.ts"],
      // Umbral (55% lines) se activa cuando el módulo tenga lógica real y tests;
      // hoy son stubs vacíos, exigir cobertura sobre eso rompería el CI sin sentido.
    },
  },
});
