import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { SmsProvider } from "../src/adapters/sms-provider";
import { DiditClient } from "../src/adapters/didit-client";

function createCaptorSmsProvider() {
  const sentCodes = new Map<string, string>();
  const provider: SmsProvider = {
    async send(toE164: string, code: string): Promise<void> {
      sentCodes.set(toE164, code);
    },
  };
  return { provider, sentCodes };
}

/** DiditClient determinístico para tests — no genera sessionId al azar, así los
 * asserts sobre kyc_verification.externalSessionId son estables. */
function createFakeDiditClient(): DiditClient {
  return {
    async createSession() {
      const sessionId = `sess-${randomUUID()}`;
      return { sessionId, sessionToken: `token-${sessionId}`, url: `https://didit.test/${sessionId}` };
    },
  };
}

describe("POST /kyc/session (MOVO-72)", () => {
  let app: FastifyInstance;
  let captor: ReturnType<typeof createCaptorSmsProvider>;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    captor = createCaptorSmsProvider();
    app = buildApp({ smsProvider: captor.provider, diditClient: createFakeDiditClient() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
    let cursor = "0";
    do {
      const [nextCursor, keys] = await app.redis.scan(cursor, "MATCH", "otp:*", "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) await app.redis.del(...keys);
    } while (cursor !== "0");
  });

  /** Registra un usuario real (teléfono verificado vía MOVO-71/72) para tener un
   * fixture con `phoneVerified: true` y `kycStatusIdentity: not_started`. Devuelve el
   * userId para armar el header `x-user-id` que ahora exige /kyc/session (MOVO-72,
   * revisión de PR #51) — mismo header que inyecta el gateway tras validar el JWT
   * (ADR-010); acá se pone a mano porque el test le pega directo a svc-users, sin
   * pasar por el gateway. */
  async function registerVerifiedUser(): Promise<string> {
    const phone = `351${Math.floor(1000000 + Math.random() * 8999999)}`;
    const send = await app.inject({ method: "POST", url: "/auth/send-otp", payload: { phone } });
    const { otpId } = JSON.parse(send.body) as { otpId: string };
    const normalizedPhone = `+549${phone}`;
    const code = captor.sentCodes.get(normalizedPhone);
    if (!code) throw new Error("No se capturó ningún código OTP");
    const verify = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { otpId, code } });
    const { phoneVerificationToken } = JSON.parse(verify.body) as { phoneVerificationToken: string };
    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        fullName: "Juan Perez",
        email: `${randomUUID()}@example.com`,
        phone,
        password: "Password1",
        phoneVerificationToken,
      },
    });
    const { userId } = JSON.parse(register.body) as { userId: string };
    return userId;
  }

  it("crea la sesión (201), inserta la fila en kyc_verification y actualiza el caché de users a pending (AC1/AC3)", async () => {
    const userId = await registerVerifiedUser();

    const response = await app.inject({
      method: "POST",
      url: "/kyc/session",
      headers: { "x-user-id": userId },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { sessionId: string; sessionToken: string };
    expect(body.sessionId).toEqual(expect.any(String));
    expect(body.sessionToken).toEqual(expect.any(String));

    const user = await app.db.user.findUnique({ where: { id: userId } });
    expect(user?.kycStatusIdentity).toBe("pending");

    const verifications = await app.db.kycVerification.findMany({ where: { userId } });
    expect(verifications).toHaveLength(1);
    expect(verifications[0]).toMatchObject({
      verificationType: "identity",
      provider: "didit",
      externalSessionId: body.sessionId,
      status: "pending",
      resolvedAt: null,
    });
  });

  it("rechaza con 409 KYC_SESSION_NOT_ALLOWED si el teléfono no está verificado (AC2)", async () => {
    const user = await app.db.user.create({
      data: {
        email: `${randomUUID()}@example.com`,
        phone: `+549351${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: "Sin",
        lastName: "Verificar",
        passwordHash: "hash",
        phoneVerified: false,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/kyc/session",
      headers: { "x-user-id": user.id },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe("KYC_SESSION_NOT_ALLOWED");
  });

  it("rechaza con 409 KYC_SESSION_NOT_ALLOWED si el kyc_status es approved (AC2)", async () => {
    const userId = await registerVerifiedUser();
    await app.db.user.update({ where: { id: userId }, data: { kycStatusIdentity: "approved" } });

    const response = await app.inject({
      method: "POST",
      url: "/kyc/session",
      headers: { "x-user-id": userId },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe("KYC_SESSION_NOT_ALLOWED");
  });

  it("rechaza con 409 KYC_SESSION_NOT_ALLOWED si ya hay una sesión pending (no reintenta ni devuelve la existente)", async () => {
    const userId = await registerVerifiedUser();
    await app.db.user.update({ where: { id: userId }, data: { kycStatusIdentity: "pending" } });

    const response = await app.inject({
      method: "POST",
      url: "/kyc/session",
      headers: { "x-user-id": userId },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe("KYC_SESSION_NOT_ALLOWED");
  });

  it.each(["rejected", "manual_review"])("permite crear sesión (201) si el kyc_status es %s (AC2)", async (status) => {
    const userId = await registerVerifiedUser();
    await app.db.user.update({ where: { id: userId }, data: { kycStatusIdentity: status } });

    const response = await app.inject({
      method: "POST",
      url: "/kyc/session",
      headers: { "x-user-id": userId },
    });

    expect(response.statusCode).toBe(201);
  });

  it("devuelve 404 NOT_FOUND si el usuario no existe", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/kyc/session",
      headers: { "x-user-id": randomUUID() },
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe("NOT_FOUND");
  });

  it("rechaza con 401 AUTH_TOKEN_INVALID si falta el header x-user-id (ruta protegida sin identidad inyectada)", async () => {
    const response = await app.inject({ method: "POST", url: "/kyc/session" });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.code).toBe("AUTH_TOKEN_INVALID");
  });

  it("rechaza con 401 AUTH_TOKEN_INVALID si x-user-id no es un uuid válido", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/kyc/session",
      headers: { "x-user-id": "no-es-un-uuid" },
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.code).toBe("AUTH_TOKEN_INVALID");
  });
});
