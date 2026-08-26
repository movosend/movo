import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { SmsProvider } from "../src/adapters/sms-provider";

function createCaptorSmsProvider() {
  const sentCodes = new Map<string, string>();
  const provider: SmsProvider = {
    async send(toE164: string, code: string): Promise<void> {
      sentCodes.set(toE164, code);
    },
    async sendText(): Promise<void> {},
  };
  return { provider, sentCodes };
}

describe("POST /auth/logout y POST /auth/logout-all", () => {
  let app: FastifyInstance;
  let captor: ReturnType<typeof createCaptorSmsProvider>;

  const validRegisterPayload = {
    fullName: "Tomas Olmos",
    email: "tomasolmos04@example.com",
    phone: "3511234567",
    password: "Password1",
    dni: "30123456",
    address: {
      street: "Av. Colón",
      number: "1234",
      city: "Córdoba",
      province: "Córdoba",
      zip: "5000",
      lat: -31.4201,
      long: -64.1888,
    },
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    captor = createCaptorSmsProvider();
    app = buildApp({ smsProvider: captor.provider });
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
    let cursor = "0";
    do {
      const [nextCursor, otpKeys] = await app.redis.scan(cursor, "MATCH", "otp:*", "COUNT", 100);
      cursor = nextCursor;
      if (otpKeys.length > 0) {
        await app.redis.del(...otpKeys);
      }
    } while (cursor !== "0");
  });

  /** MOVO-72: /auth/register exige un phoneVerificationToken real (MOVO-71). */
  async function registerAndLogin() {
    const send = await app.inject({
      method: "POST",
      url: "/auth/send-otp",
      payload: { phone: validRegisterPayload.phone },
    });
    const { otpId } = JSON.parse(send.body) as { otpId: string };
    const code = [...captor.sentCodes.values()].pop();
    if (!code) {
      throw new Error("No se capturó ningún código OTP");
    }
    const verify = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { otpId, code } });
    const { phoneVerificationToken } = JSON.parse(verify.body) as { phoneVerificationToken: string };

    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...validRegisterPayload, phoneVerificationToken },
    });
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

      // Baseline de 2 (register() + login(), MOVO-72): logout solo revoca la sesión
      // de login(), la de register() sigue en pie.
      const redisKeys = await app.redis.keys(`refresh:${userId}:*`);
      expect(redisKeys.length).toBe(1);

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

      // Baseline de 3 (register() + login() de registerAndLogin() + este segundo
      // login(), MOVO-72): revocar refreshToken1 deja 2.
      const redisKeys = await app.redis.keys(`refresh:${userId}:*`);
      expect(redisKeys.length).toBe(2);

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

      // Baseline de 2 (register() + login(), MOVO-72): logout con un x-user-id ajeno
      // es un no-op, ninguna sesión se toca.
      const redisKeys = await app.redis.keys(`refresh:${userId}:*`);
      expect(redisKeys.length).toBe(2);
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

      // Baseline de 3 (register() + login() de registerAndLogin() + este segundo login(), MOVO-72).
      const redisKeysBefore = await app.redis.keys(`refresh:${userId}:*`);
      expect(redisKeysBefore.length).toBe(3);

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
