import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { signAccessToken, UserRole, KycStatus } from "@movo/shared";
import authPlugin from "../src/plugins/auth";
import errorHandlerPlugin from "../src/plugins/error-handler";
import { EnvConfig } from "../src/config/env";

describe("auth plugin - decorador authorize", () => {
  let app: FastifyInstance;

  const env: EnvConfig = {
    PORT: 3000,
    JWT_SECRET: "test-secret",
    REDIS_URL: "redis://localhost:6379",
    USERS_SERVICE_URL: "http://localhost:1",
    SHIPMENTS_SERVICE_URL: "http://localhost:1",
    PAYMENTS_SERVICE_URL: "http://localhost:1",
    ADMIN_SERVICE_URL: "http://localhost:1",
    RATE_LIMIT_MAX: 200,
  };

  beforeAll(async () => {
    // signAccessToken (de @movo/shared) lee JWT_SECRET directo de process.env,
    // no del objeto `env` que le pasamos a nuestro propio plugin.
    process.env.JWT_SECRET = "test-secret";

    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin, { env });

    // Ruta de prueba que usa authorize() sola, sin pasar antes por authenticate,
    // para ejercitar la rama defensiva "usuario no autenticado" del decorador.
    app.get("/only-authorize", {
      preHandler: app.authorize([UserRole.ADMIN]),
      handler: async () => ({ ok: true }),
    });

    // Ruta de prueba que encadena authenticate + authorize, tal como hace
    // routes/index.ts para los prefijos con allowedRoles.
    app.get("/needs-admin", {
      preHandler: [app.authenticate, app.authorize([UserRole.ADMIN])],
      handler: async () => ({ ok: true }),
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("devuelve 403 AUTH_FORBIDDEN si no hay usuario autenticado en el request", async () => {
    const response = await app.inject({ method: "GET", url: "/only-authorize" });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe("AUTH_FORBIDDEN");
    expect(body.error.message).toBe("User not authenticated");
  });

  it("devuelve 403 AUTH_FORBIDDEN si el usuario autenticado no tiene el rol requerido", async () => {
    const token = signAccessToken({
      sub: "user-123",
      roles: [UserRole.SENDER],
      kycStatus: KycStatus.APPROVED,
    });

    const response = await app.inject({
      method: "GET",
      url: "/needs-admin",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe("AUTH_FORBIDDEN");
  });

  it("deja pasar si el usuario autenticado tiene el rol requerido", async () => {
    const token = signAccessToken({
      sub: "admin-user",
      roles: [UserRole.ADMIN],
      kycStatus: KycStatus.APPROVED,
    });

    const response = await app.inject({
      method: "GET",
      url: "/needs-admin",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });
});
