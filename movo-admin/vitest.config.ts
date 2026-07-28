import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["app/**/*.tsx", "components/**/*.tsx"],
      exclude: ["**/*.test.tsx", "components/ui/**"],
      // Sin threshold todavía: es un paquete de UI recién creado, sin la
      // convención de services/repositories que sí tienen los demás paquetes.
    },
  },
});
