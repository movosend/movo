import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { SmsProvider } from "../src/adapters/sms-provider";
import { DiditClient } from "../src/adapters/didit-client";

/**
 * `/kyc/license/session` y `/kyc/license/status` (MOVO-15) — reusan la misma
 * implementación genérica de `kyc.service.ts` que ya cubre `/kyc/session`/`/kyc/status`
 * (identidad, MOVO-72, ver `kyc.session.integration.test.ts`/`kyc.status.integration.test.ts`
 * para la cobertura completa de esa lógica compartida: reintentos, reconciliación,
 * dedupe de Didit, etc.). Este archivo se enfoca en lo específico de MOVO-15: que el
 * tipo de verificación correcto se persiste/lee, que el caché de `users` que se toca es
 * `kyc_status_license` (nunca `kyc_status_identity`), y que los dos tipos son
 * independientes entre sí para un mismo usuario.
 */
function createCaptorSmsProvider() {
  const sentCodes = new Map<string, string>();
  const provider: SmsProvider = {
    async send(toE164: string, code: string): Promise<void> {
      sentCodes.set(toE164, code);
    },
  };
  return { provider, sentCodes };
}

function createFakeDiditClient(): DiditClient {
  return {
    async createSession() {
      const sessionId = `sess-${randomUUID()}`;
      return { sessionId, sessionToken: `token-${sessionId}`, url: `https://didit.test/${sessionId}` };
    },
    async getSessionDecision() {
      return null;
    },
  };
}

describe("/kyc/license/session y /kyc/license/status (MOVO-15)", () => {
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
      },
    });
    const { userId } = JSON.parse(register.body) as { userId: string };
    return userId;
  }

  it("crea la sesión (201), inserta verification_type='license' y actualiza kyc_status_license a pending sin tocar kyc_status_identity", async () => {
    const userId = await registerVerifiedUser();

    const response = await app.inject({
      method: "POST",
      url: "/kyc/license/session",
      headers: { "x-user-id": userId },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { sessionId: string; sessionToken: string };
    expect(body.sessionId).toEqual(expect.any(String));

    const user = await app.db.user.findUnique({ where: { id: userId } });
    expect(user?.kycStatusLicense).toBe("pending");
    expect(user?.kycStatusIdentity).toBe("not_started");

    const verifications = await app.db.kycVerification.findMany({ where: { userId } });
    expect(verifications).toHaveLength(1);
    expect(verifications[0]).toMatchObject({
      verificationType: "license",
      provider: "didit",
      externalSessionId: body.sessionId,
      status: "pending",
    });
  });

  it("un intento de identidad pending no bloquea abrir una sesión de licencia (son independientes)", async () => {
    const userId = await registerVerifiedUser();
    const identitySession = await app.inject({ method: "POST", url: "/kyc/session", headers: { "x-user-id": userId } });
    expect(identitySession.statusCode).toBe(201);

    const licenseSession = await app.inject({
      method: "POST",
      url: "/kyc/license/session",
      headers: { "x-user-id": userId },
    });

    expect(licenseSession.statusCode).toBe(201);
    const verifications = await app.db.kycVerification.findMany({ where: { userId }, orderBy: { verificationType: "asc" } });
    expect(verifications.map((v) => v.verificationType).sort()).toEqual(["identity", "license"]);
  });

  it("rechaza con 409 KYC_SESSION_NOT_ALLOWED si kyc_status_license ya es approved, aunque identity esté not_started", async () => {
    const userId = await registerVerifiedUser();
    await app.db.user.update({ where: { id: userId }, data: { kycStatusLicense: "approved" } });

    const response = await app.inject({
      method: "POST",
      url: "/kyc/license/session",
      headers: { "x-user-id": userId },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe("KYC_SESSION_NOT_ALLOWED");
  });

  it("rechaza con 409 KYC_SESSION_NOT_ALLOWED si el teléfono no está verificado", async () => {
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
      url: "/kyc/license/session",
      headers: { "x-user-id": user.id },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe("KYC_SESSION_NOT_ALLOWED");
  });

  it("GET /kyc/license/status devuelve kyc_status_license, independiente de kyc_status_identity", async () => {
    const user = await app.db.user.create({
      data: {
        email: `${randomUUID()}@example.com`,
        phone: `+549351${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: "Juan",
        lastName: "Perez",
        passwordHash: "hash",
        phoneVerified: true,
        kycStatusIdentity: "approved",
        kycStatusLicense: "rejected",
      },
    });

    const response = await app.inject({ method: "GET", url: "/kyc/license/status", headers: { "x-user-id": user.id } });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "rejected", manualReviewReason: null });
  });

  it("GET /kyc/license/status con manual_review lee el motivo del intento de licencia más reciente, no el de identidad", async () => {
    const user = await app.db.user.create({
      data: {
        email: `${randomUUID()}@example.com`,
        phone: `+549351${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: "Juan",
        lastName: "Perez",
        passwordHash: "hash",
        phoneVerified: true,
        kycStatusIdentity: "manual_review",
        kycStatusLicense: "manual_review",
      },
    });
    await app.db.kycVerification.create({
      data: {
        userId: user.id,
        verificationType: "identity",
        provider: "didit",
        externalSessionId: `sess-identity-${randomUUID()}`,
        status: "manual_review",
        resolvedAt: new Date(),
        rawDecision: { status: "In Review", warnings: [{ feature: "X", risk: "Y", description: "motivo de identidad" }] },
      },
    });
    await app.db.kycVerification.create({
      data: {
        userId: user.id,
        verificationType: "license",
        provider: "didit",
        externalSessionId: `sess-license-${randomUUID()}`,
        status: "manual_review",
        resolvedAt: new Date(),
        rawDecision: { status: "In Review", warnings: [{ feature: "X", risk: "Y", description: "motivo de licencia" }] },
      },
    });

    const response = await app.inject({ method: "GET", url: "/kyc/license/status", headers: { "x-user-id": user.id } });

    expect(JSON.parse(response.body).manualReviewReason).toBe("motivo de licencia");
  });

  it("devuelve 404 NOT_FOUND si el usuario no existe", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/kyc/license/session",
      headers: { "x-user-id": randomUUID() },
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe("NOT_FOUND");
  });

  it("rechaza con 401 AUTH_TOKEN_INVALID si falta el header x-user-id", async () => {
    const sessionResponse = await app.inject({ method: "POST", url: "/kyc/license/session" });
    const statusResponse = await app.inject({ method: "GET", url: "/kyc/license/status" });

    expect(sessionResponse.statusCode).toBe(401);
    expect(statusResponse.statusCode).toBe(401);
  });
});
