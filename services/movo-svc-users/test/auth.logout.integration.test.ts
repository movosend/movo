import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

describe("POST /auth/logout y POST /auth/logout-all", () => {
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
    return JSON.parse(loginRes.body) as { userId: string; refreshToken: string };
  }

  describe("POST /auth/logout", () => {
    it("revoca el refresh token de la sesión actual y devuelve 204 (AC7)", async () => {
      const { userId, refreshToken } = await registerAndLogin();

      const logoutRes = await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: { "x-user-id": userId },
        payload: { refreshToken },
      });

      expect(logoutRes.statusCode).toBe(204);

      const redisKeys = await app.redis.keys(`refresh:${userId}:*`);
      expect(redisKeys.length).toBe(0);

      const refreshAfterLogout = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken },
      });
      expect(refreshAfterLogout.statusCode).toBe(401);
    });

    it("no revoca las otras sesiones del usuario", async () => {
      const { userId, refreshToken: refreshToken1 } = await registerAndLogin();
      const loginRes2 = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { phone: validRegisterPayload.phone, password: validRegisterPayload.password },
      });
      const { refreshToken: refreshToken2 } = JSON.parse(loginRes2.body) as { refreshToken: string };

      await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: { "x-user-id": userId },
        payload: { refreshToken: refreshToken1 },
      });

      const redisKeys = await app.redis.keys(`refresh:${userId}:*`);
      expect(redisKeys.length).toBe(1);

      const refreshRes = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: refreshToken2 },
      });
      expect(refreshRes.statusCode).toBe(200);
    });

    it("es idempotente: llamarlo dos veces no devuelve error (AC9)", async () => {
      const { userId, refreshToken } = await registerAndLogin();

      const first = await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: { "x-user-id": userId },
        payload: { refreshToken },
      });
      expect(first.statusCode).toBe(204);

      const second = await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: { "x-user-id": userId },
        payload: { refreshToken },
      });
      expect(second.statusCode).toBe(204);
    });

    it("no revoca la sesión de otro usuario aunque se mande su refresh token", async () => {
      const { userId, refreshToken } = await registerAndLogin();

      const otherUserId = "11111111-1111-1111-1111-111111111111";
      const logoutRes = await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: { "x-user-id": otherUserId },
        payload: { refreshToken },
      });
      expect(logoutRes.statusCode).toBe(204);

      const redisKeys = await app.redis.keys(`refresh:${userId}:*`);
      expect(redisKeys.length).toBe(1);
    });
  });

  describe("POST /auth/logout-all", () => {
    it("revoca todas las sesiones del usuario (AC8)", async () => {
      const { userId } = await registerAndLogin();
      await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { phone: validRegisterPayload.phone, password: validRegisterPayload.password },
      });

      const redisKeysBefore = await app.redis.keys(`refresh:${userId}:*`);
      expect(redisKeysBefore.length).toBe(2);

      const logoutAllRes = await app.inject({
        method: "POST",
        url: "/auth/logout-all",
        headers: { "x-user-id": userId },
      });
      expect(logoutAllRes.statusCode).toBe(204);

      const redisKeysAfter = await app.redis.keys(`refresh:${userId}:*`);
      expect(redisKeysAfter.length).toBe(0);
    });
  });
});
