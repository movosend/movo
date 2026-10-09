import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { requireMercadoPagoSecret, EnvConfig } from "../src/config/env";

describe("/payments exige x-user-id del gateway (ADR-010)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("401 sin header", async () => {
    const response = await app.inject({ method: "GET", url: "/payments" });
    expect(response.statusCode).toBe(401);
  });

  it("401 con un x-user-id que no es UUID", async () => {
    const response = await app.inject({ method: "GET", url: "/payments", headers: { "x-user-id": "no-uuid" } });
    expect(response.statusCode).toBe(401);
  });

  it("200 con un x-user-id válido", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/payments",
      headers: { "x-user-id": "3f2b8c1e-6a4d-4e0b-9c7a-1d2e3f4a5b6c" },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe("requireMercadoPagoSecret", () => {
  const base = { MP_WEBHOOK_SECRET: "" } as EnvConfig;

  it("falla si la credencial está vacía o ausente", () => {
    expect(() => requireMercadoPagoSecret(base, "MP_WEBHOOK_SECRET")).toThrow(/MP_WEBHOOK_SECRET/);
    expect(() => requireMercadoPagoSecret(base, "MP_CLIENT_ID")).toThrow(/MP_CLIENT_ID/);
  });

  it("devuelve el valor si está cargada", () => {
    expect(requireMercadoPagoSecret({ MP_WEBHOOK_SECRET: "abc" } as EnvConfig, "MP_WEBHOOK_SECRET")).toBe("abc");
  });
});
