import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

/**
 * El `addContentTypeParser` que kyc.routes.ts registra para capturar el rawBody del
 * webhook (AC5) está scoped al plugin `kycRoutes` — Fastify lo encapsula por contexto
 * de registro. Este test verifica que NO se filtra a `/auth/*` (plugin hermano,
 * registrado aparte en app.ts): un JSON normal sigue parseándose igual que antes de
 * que existiera el módulo kyc.
 */
describe("Aislamiento del content-type parser de kyc.routes.ts (MOVO-72)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
  });

  it("POST /auth/register sigue devolviendo 400 VALIDATION_FAILED ante un body inválido (el parser normal de Fastify sigue activo fuera de /kyc)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { fullName: "Juan" }, // falta email/phone/password/phoneVerificationToken
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
  });

  it("POST /kyc/session con JSON malformado devuelve 400 (el parser scoped de /kyc también rechaza JSON inválido, no lo deja pasar silenciosamente)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/kyc/session",
      headers: { "content-type": "application/json" },
      payload: "{esto-no-es-json",
    });

    expect(response.statusCode).toBe(400);
  });
});
