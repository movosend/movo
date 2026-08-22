import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import Redis from "ioredis";
import { signAccessToken, UserRole, KycStatus } from "@movo/shared";
import authPlugin from "../src/plugins/auth";
import errorHandlerPlugin from "../src/plugins/error-handler";
import redisPlugin from "../src/plugins/redis";
import { EnvConfig } from "../src/config/env";

describe("auth plugin - decorador authorize", () => {
  let app: FastifyInstance;
  let redis: Redis;

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
    // authenticate ahora chequea `user-revoked-at:*` en Redis (MOVO-134) -- sin
    // registrar el plugin de Redis acá, app.redis queda undecorated y cualquier
    // ruta que pase por authenticate explota.
    await app.register(redisPlugin, { env });
    await app.register(authPlugin, { env });
    redis = app.redis;

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

  beforeEach(async () => {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "user-revoked-at:*", "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
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

describe("auth plugin - revocación de access tokens (MOVO-134)", () => {
  let app: FastifyInstance;
  let redis: Redis;

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
    process.env.JWT_SECRET = "test-secret";

    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    await app.register(redisPlugin, { env });
    await app.register(authPlugin, { env });
    redis = app.redis;

    app.get("/protected", {
      preHandler: app.authenticate,
      handler: async () => ({ ok: true }),
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rechaza un token cuyo iat es anterior a user-revoked-at:{userId} (cambio de contraseña o baja de cuenta)", async () => {
    const userId = "user-revoked-before";
    const token = signAccessToken({ sub: userId, roles: [UserRole.SENDER], kycStatus: KycStatus.APPROVED });

    // Simula lo que hace `revokeAccessTokensIssuedBefore` en svc-users: sella el
    // corte 60s después del `iat` del token ya emitido.
    const { iat } = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    await redis.set(`user-revoked-at:${userId}`, iat + 60, "EX", 3600);

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.code).toBe("AUTH_TOKEN_INVALID");
  });

  it("deja pasar un token cuyo iat es posterior a user-revoked-at:{userId} (sesión emitida después del corte)", async () => {
    const userId = "user-revoked-after";

    await redis.set(`user-revoked-at:${userId}`, Math.floor(Date.now() / 1000) - 60, "EX", 3600);
    const token = signAccessToken({ sub: userId, roles: [UserRole.SENDER], kycStatus: KycStatus.APPROVED });

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it("deja pasar si no hay ninguna marca de revocación para el usuario", async () => {
    const token = signAccessToken({ sub: "user-never-revoked", roles: [UserRole.SENDER], kycStatus: KycStatus.APPROVED });

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });
});
