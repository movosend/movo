import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Los tests de integración (ver test/*.integration.test.ts) pegan contra
    // el mismo Postgres real y aíslan filas con TRUNCATE en beforeEach — si
    // Vitest corriera los archivos en paralelo, el TRUNCATE de un archivo
    // puede pisar filas que otro archivo insertó milisegundos antes,
    // produciendo fallos intermitentes (MOVO-87). Serializar por archivo
    // evita la carrera a costa de algo más de tiempo total de test.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: [
        "src/modules/**/*.service.ts",
        "src/modules/**/*.repository.ts",
        "src/repositories/**/*.ts",
        "src/models/**/*.ts",
        "src/services/**/*.ts",
        "src/adapters/**/*.ts",
      ],
      exclude: ["src/modules/**/*.schema.ts", "src/modules/**/*.routes.ts"],
      thresholds: {
        lines: 55,
      },
    },
  },
});
