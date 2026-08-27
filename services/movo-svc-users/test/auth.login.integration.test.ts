import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { verifyAccessToken, KycStatus, UserRole } from "@movo/shared";
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

describe("POST /auth/login", () => {
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
    // Clean keys matching refresh:*/otp:* pattern from Redis
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
  async function registerFixtureUser(payload: typeof validRegisterPayload = validRegisterPayload) {
    const send = await app.inject({ method: "POST", url: "/auth/send-otp", payload: { phone: payload.phone } });
    const { otpId } = JSON.parse(send.body) as { otpId: string };
    const code = [...captor.sentCodes.values()].pop();
    if (!code) {
      throw new Error("No se capturó ningún código OTP");
    }
    const verify = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { otpId, code } });
    const { phoneVerificationToken } = JSON.parse(verify.body) as { phoneVerificationToken: string };
    return app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...payload, phoneVerificationToken },
    });
  }

  it("autentica correctamente con credenciales válidas y devuelve la respuesta plana esperada + guarda refresh token en Redis con TTL de 90 días", async () => {
    // 1. Registrar usuario
    const regRes = await registerFixtureUser();
    expect(regRes.statusCode).toBe(201);
    const { userId } = JSON.parse(regRes.body) as { userId: string };

    // 2. Login
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        phone: validRegisterPayload.phone,
        password: validRegisterPayload.password,
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const body = JSON.parse(loginRes.body) as {
      userId: string;
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      kycStatus: string;
      fullName: string;
      roles: string[];
    };

    expect(body.userId).toBe(userId);
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.expiresIn).toBe(3600);
    expect(body.kycStatus).toBe("not_started");
    expect(body.fullName).toBe("Tomas Olmos");
    expect(body.roles.sort()).toEqual(["carrier", "sender"].sort());

    // 3. Verificar Access Token JWT
    const verifyResult = verifyAccessToken(body.accessToken);
    expect(verifyResult.status).toBe("valid");
    if (verifyResult.status === "valid") {
      expect(verifyResult.claims.sub).toBe(userId);
      expect(verifyResult.claims.kycStatus).toBe(KycStatus.NOT_STARTED);
      expect(verifyResult.claims.roles.sort()).toEqual([UserRole.CARRIER, UserRole.SENDER].sort());
    }

    // 4. Verificar que el refresh token está guardado en Redis bajo `refresh:{userId}:*` con TTL de 90 días
    // 2 keys: una del register() (revisión de PR #51: también emite tokens de sesión) + una del login().
    const redisKeys = await app.redis.keys(`refresh:${userId}:*`);
    expect(redisKeys.length).toBe(2);
    const ttl = await app.redis.ttl(redisKeys[0]!);
    expect(ttl).toBeGreaterThan(7000000); // Cerca de 7776000 segundos (90 días)
    expect(ttl).toBeLessThanOrEqual(7776000);
  });

  it("devuelve 401 AUTH_INVALID_CREDENTIALS cuando la contraseña es incorrecta", async () => {
    await registerFixtureUser();

    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        phone: validRegisterPayload.phone,
        password: "WrongPassword123",
      },
    });

    expect(loginRes.statusCode).toBe(401);
    const body = JSON.parse(loginRes.body);
    expect(body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(body.error.message).toBe("Credenciales inválidas.");
  });

  it("devuelve 401 AUTH_INVALID_CREDENTIALS cuando el teléfono no existe", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        phone: "3519999999",
        password: "Password1",
      },
    });

    expect(loginRes.statusCode).toBe(401);
    const body = JSON.parse(loginRes.body);
    expect(body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(body.error.message).toBe("Credenciales inválidas.");
  });

  it("devuelve 403 ACCOUNT_SUSPENDED si la cuenta está suspendida (status: banned)", async () => {
    const regRes = await registerFixtureUser();
    const { userId } = JSON.parse(regRes.body) as { userId: string };

    // Cambiar status a banned
    await app.db.user.update({
      where: { id: userId },
      data: { status: "banned" },
    });

    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        phone: validRegisterPayload.phone,
        password: validRegisterPayload.password,
      },
    });

    expect(loginRes.statusCode).toBe(403);
    const body = JSON.parse(loginRes.body);
    expect(body.error.code).toBe("ACCOUNT_SUSPENDED");
    expect(body.error.message).toBe("La cuenta se encuentra suspendida o inhabilitada.");
  });

  it("permite login exitoso cuando el usuario tiene KYC pendiente", async () => {
    const regRes = await registerFixtureUser();
    const { userId } = JSON.parse(regRes.body) as { userId: string };

    // Actualizar kycStatusIdentity a pending
    await app.db.user.update({
      where: { id: userId },
      data: { kycStatusIdentity: "pending" },
    });

    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        phone: validRegisterPayload.phone,
        password: validRegisterPayload.password,
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const body = JSON.parse(loginRes.body) as { kycStatus: string };
    expect(body.kycStatus).toBe("pending");
  });

  it("permite múltiples logins simultáneos generando distintos tokenIds en Redis sin revocar las sesiones previas", async () => {
    const regRes = await registerFixtureUser();
    const { userId } = JSON.parse(regRes.body) as { userId: string };

    // Login 1
    const loginRes1 = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { phone: validRegisterPayload.phone, password: validRegisterPayload.password },
    });
    expect(loginRes1.statusCode).toBe(200);

    // Login 2
    const loginRes2 = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { phone: validRegisterPayload.phone, password: validRegisterPayload.password },
    });
    expect(loginRes2.statusCode).toBe(200);

    const body1 = JSON.parse(loginRes1.body);
    const body2 = JSON.parse(loginRes2.body);

    expect(body1.refreshToken).not.toBe(body2.refreshToken);

    // Los 2 refresh tokens de los logins existen en Redis, sin pisar la sesión que ya
    // había creado registerFixtureUser() (revisión de PR #51: register() también
    // emite tokens) — 3 en total, ninguna revocada.
    const redisKeys = await app.redis.keys(`refresh:${userId}:*`);
    expect(redisKeys.length).toBe(3);
  });
});
