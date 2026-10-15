import { afterEach, describe, expect, it, vi } from "vitest";
import { readAdminRoleCliConfig } from "../src/scripts/admin-role";

afterEach(() => vi.unstubAllEnvs());

describe("Configuración del CLI de roles admin", () => {
  it("grant funciona sin Redis ni JWT_SECRET y reutiliza el provider por defecto", () => {
    vi.stubEnv("REDIS_URL", undefined);
    vi.stubEnv("JWT_SECRET", undefined);
    vi.stubEnv("EMAIL_PROVIDER", undefined);
    const config = readAdminRoleCliConfig("grant", { DATABASE_URL: "postgresql://localhost/movo" }, false);
    expect(config.EMAIL_PROVIDER).toBe("console");
    expect(config.REDIS_URL).toBeUndefined();
  });

  it("revoke exige Redis", () => {
    vi.stubEnv("REDIS_URL", undefined);
    expect(() => readAdminRoleCliConfig("revoke", { DATABASE_URL: "postgresql://localhost/movo" }, false))
      .toThrow(/REDIS_URL/);
  });

  it("rechaza un provider inválido con la validación compartida", () => {
    expect(() => readAdminRoleCliConfig("grant", {
      DATABASE_URL: "postgresql://localhost/movo", EMAIL_PROVIDER: "typo",
    }, false)).toThrow(/EMAIL_PROVIDER/);
  });
});
