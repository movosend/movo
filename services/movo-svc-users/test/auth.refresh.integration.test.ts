import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { verifyAccessToken } from "@movo/shared";
import { buildApp } from "../src/app";

describe("POST /auth/refresh", () => {
  let app: FastifyInstance;

  const validRegisterPayload = {
    fullName: "Tomas Olmos",
    email: "tomasolmos04@example.com",
    phone: "3511234567",
    password: "Password1",
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
    const keys = await app.redis.keys("refresh:*");
    if (keys.length > 0) {
      await app.redis.del(...keys);
    }
  });

  async function registerAndLogin() {
    await app.inject({ method: "POST", url: "/auth/register", payload: validRegisterPayload });
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { phone: validRegisterPayload.phone, password: validRegisterPayload.password },
    });
    return JSON.parse(loginRes.body) as {
      userId: string;
      accessToken: string;
      refreshToken: string;
    };
  }

  it("emite un par de tokens nuevo con un refresh token vigente y rota la sesión (AC1/AC2)", async () => {
    const { userId, refreshToken } = await registerAndLogin();

    const refreshRes = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });

    expect(refreshRes.statusCode).toBe(200);
    const body = JSON.parse(refreshRes.body) as {
      userId: string;
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      kycStatus: string;
      fullName: string;
      roles: string[];
    };

    expect(body.userId).toBe(userId);
    expect(body.refreshToken).not.toBe(refreshToken);
    expect(body.expiresIn).toBe(3600);

    const verifyResult = verifyAccessToken(body.accessToken);
    expect(verifyResult.status).toBe("valid");

    // La rotación no borra la key vieja (queda como tombstone `used:true` para
    // poder detectar un reuso posterior) — genera una key nueva con tokenId
    // distinto, así que ahora hay 2 keys para este usuario.
    const redisKeys = await app.redis.keys(`refresh:${userId}:*`);
    expect(redisKeys.length).toBe(2);
  });

  it("devuelve 401 AUTH_REFRESH_INVALID y revoca todas las sesiones si el refresh token ya fue usado (AC3)", async () => {
    const { userId, refreshToken } = await registerAndLogin();

    const firstRefresh = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(firstRefresh.statusCode).toBe(200);
    const { refreshToken: rotatedToken } = JSON.parse(firstRefresh.body) as { refreshToken: string };

    // Reusar el token viejo (ya canjeado) — señal de robo.
    const reuseRes = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });

    expect(reuseRes.statusCode).toBe(401);
    const body = JSON.parse(reuseRes.body);
    expect(body.error.code).toBe("AUTH_REFRESH_INVALID");

    // El token rotado (válido, nunca reusado) también quedó revocado por el barrido.
    const rotatedRefreshAttempt = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: rotatedToken },
    });
    expect(rotatedRefreshAttempt.statusCode).toBe(401);

    const redisKeys = await app.redis.keys(`refresh:${userId}:*`);
    expect(redisKeys.length).toBe(0);
  });

  it("devuelve 401 AUTH_REFRESH_INVALID con un refresh token inexistente o malformado (AC4)", async () => {
    const malformed = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: "no-es-un-token-valido" },
    });
    expect(malformed.statusCode).toBe(401);
    expect(JSON.parse(malformed.body).error.code).toBe("AUTH_REFRESH_INVALID");

    const inexistente = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: "11111111-1111-1111-1111-111111111111.22222222-2222-2222-2222-222222222222.secret" },
    });
    expect(inexistente.statusCode).toBe(401);
    expect(JSON.parse(inexistente.body).error.code).toBe("AUTH_REFRESH_INVALID");
  });

  it("devuelve 401 AUTH_REFRESH_INVALID si el secreto no coincide con el hash guardado (token adulterado)", async () => {
    const { userId, refreshToken } = await registerAndLogin();
    const [tokenUserId, tokenId] = refreshToken.split(".");

    const tampered = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: `${tokenUserId}.${tokenId}.secreto-inventado` },
    });

    expect(tampered.statusCode).toBe(401);
    expect(JSON.parse(tampered.body).error.code).toBe("AUTH_REFRESH_INVALID");

    // La sesión original sigue intacta: un secreto adulterado no cuenta como
    // "uso" válido, así que no dispara la marca de un solo uso ni la revocación.
    const stillValid = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(stillValid.statusCode).toBe(200);

    const redisKeys = await app.redis.keys(`refresh:${userId}:*`);
    expect(redisKeys.length).toBe(2);
  });

  it("devuelve 401 AUTH_REFRESH_INVALID y revoca la sesión si el usuario ya no existe", async () => {
    const { userId, refreshToken } = await registerAndLogin();

    // onDelete: Cascade en UserRoleGrant se encarga de los roles.
    await app.db.user.delete({ where: { id: userId } });

    const refreshRes = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });

    expect(refreshRes.statusCode).toBe(401);
    expect(JSON.parse(refreshRes.body).error.code).toBe("AUTH_REFRESH_INVALID");

    const redisKeys = await app.redis.keys(`refresh:${userId}:*`);
    expect(redisKeys.length).toBe(0);
  });

  it("refleja roles/kycStatus actuales del usuario en el token nuevo (AC5)", async () => {
    const { userId, refreshToken } = await registerAndLogin();

    await app.db.user.update({
      where: { id: userId },
      data: { kycStatusIdentity: "approved" },
    });

    const refreshRes = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });

    expect(refreshRes.statusCode).toBe(200);
    const body = JSON.parse(refreshRes.body) as { kycStatus: string; accessToken: string };
    expect(body.kycStatus).toBe("approved");

    const verifyResult = verifyAccessToken(body.accessToken);
    expect(verifyResult.status).toBe("valid");
    if (verifyResult.status === "valid") {
      expect(verifyResult.claims.kycStatus).toBe("approved");
    }
  });

  it("devuelve 403 ACCOUNT_SUSPENDED y revoca todas las sesiones si la cuenta fue suspendida (AC6)", async () => {
    const { userId, refreshToken } = await registerAndLogin();

    await app.db.user.update({
      where: { id: userId },
      data: { status: "banned" },
    });

    const refreshRes = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });

    expect(refreshRes.statusCode).toBe(403);
    expect(JSON.parse(refreshRes.body).error.code).toBe("ACCOUNT_SUSPENDED");

    const redisKeys = await app.redis.keys(`refresh:${userId}:*`);
    expect(redisKeys.length).toBe(0);
  });
});
