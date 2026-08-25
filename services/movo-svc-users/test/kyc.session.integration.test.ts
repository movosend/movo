import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { SmsProvider } from "../src/adapters/sms-provider";
import { DiditClient, DiditSessionDecision } from "../src/adapters/didit-client";

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

/** DiditClient determinístico para tests — no genera sessionId al azar, así los
 * asserts sobre kyc_verification.externalSessionId son estables.
 *
 * `pinnedSessionId` permite simular el dedupe implícito de Didit por `vendor_data`
 * (ver `didit-client.ts`): con el mismo usuario y una sesión sin terminar, Didit puede
 * devolver la sesión que ya existía en vez de crear una nueva. */
function createFakeDiditClient() {
  let pinnedSessionId: string | null = null;
  // Lo que va a devolver `getSessionDecision`. Default `null` = "Didit no conoce la
  // sesión", el caso de un intento que nunca llegó a completarse.
  let decision: DiditSessionDecision | null = null;
  let decisionError: Error | null = null;
  const decisionCalls: string[] = [];

  const client: DiditClient = {
    async createSession() {
      const sessionId = pinnedSessionId ?? `sess-${randomUUID()}`;
      return { sessionId, sessionToken: `token-${sessionId}`, url: `https://didit.test/${sessionId}` };
    },
    async getSessionDecision(sessionId: string) {
      decisionCalls.push(sessionId);
      if (decisionError) throw decisionError;
      return decision;
    },
  };

  return {
    client,
    decisionCalls,
    pinSessionId(sessionId: string | null) {
      pinnedSessionId = sessionId;
    },
    /** Simula que Didit ya tiene una decisión tomada para el intento pendiente. */
    setDecision(next: DiditSessionDecision | null) {
      decision = next;
      decisionError = null;
    },
    /** Simula el proveedor caído al consultar la decisión. */
    failDecisionWith(error: Error) {
      decisionError = error;
    },
  };
}

describe("POST /kyc/session (MOVO-72)", () => {
  let app: FastifyInstance;
  let captor: ReturnType<typeof createCaptorSmsProvider>;
  let didit: ReturnType<typeof createFakeDiditClient>;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    captor = createCaptorSmsProvider();
    didit = createFakeDiditClient();
    app = buildApp({ smsProvider: captor.provider, diditClient: didit.client });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    didit.pinSessionId(null);
    didit.setDecision(null);
    didit.decisionCalls.length = 0;
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

  // Revierte la política original de MOVO-72 (409 desde `pending`): un intento que
  // quedó `pending` porque el SDK del cliente nunca llegó a Didit no se resuelve solo
  // por webhook, así que rechazar el reintento dejaba al usuario sin salida. Ver el
  // comentario de ALLOWED_SESSION_SOURCE_STATUSES en kyc.service.ts.
  it("permite reintentar desde pending: descarta el intento anterior como expired y abre uno nuevo", async () => {
    const userId = await registerVerifiedUser();
    const first = await app.inject({ method: "POST", url: "/kyc/session", headers: { "x-user-id": userId } });
    const firstSessionId = (JSON.parse(first.body) as { sessionId: string }).sessionId;

    const second = await app.inject({ method: "POST", url: "/kyc/session", headers: { "x-user-id": userId } });

    expect(second.statusCode).toBe(201);
    const secondSessionId = (JSON.parse(second.body) as { sessionId: string }).sessionId;
    expect(secondSessionId).not.toBe(firstSessionId);
    // Se le preguntó a Didit antes de descartar; acá no había decisión que preservar.
    expect(didit.decisionCalls).toContain(firstSessionId);

    const abandoned = await app.db.kycVerification.findUnique({
      where: { externalSessionId: firstSessionId },
    });
    expect(abandoned?.status).toBe("expired");
    expect(abandoned?.resolvedAt).toBeInstanceOf(Date);

    const current = await app.db.kycVerification.findUnique({
      where: { externalSessionId: secondSessionId },
    });
    expect(current?.status).toBe("pending");
    expect(current?.resolvedAt).toBeNull();

    // El caché de `users` sigue en pending: hay exactamente un intento vivo.
    const user = await app.db.user.findUnique({ where: { id: userId } });
    expect(user?.kycStatusIdentity).toBe("pending");
    const stillPending = await app.db.kycVerification.findMany({ where: { userId, status: "pending" } });
    expect(stillPending).toHaveLength(1);
  });

  // Revisión de PR #52: descartar el intento `pending` a ciegas perdía la decisión de una
  // verificación recién completada cuyo webhook todavía no había llegado (el gate de
  // idempotencia exige `pending`, así que el webhook tardío ya no matcheaba). Ahora se le
  // pregunta a Didit antes de descartar nada.
  it("preserva la decisión de Didit que el webhook todavía no entregó: aprueba y ya no deja abrir otra sesión", async () => {
    const userId = await registerVerifiedUser();
    const first = await app.inject({ method: "POST", url: "/kyc/session", headers: { "x-user-id": userId } });
    const sessionId = (JSON.parse(first.body) as { sessionId: string }).sessionId;

    // El usuario completó la verificación en Didit; el webhook viene en camino.
    didit.setDecision({
      sessionId,
      rawStatus: "Approved",
      decision: { status: "Approved", id_verifications: [{ warnings: [] }] },
    });

    const retry = await app.inject({ method: "POST", url: "/kyc/session", headers: { "x-user-id": userId } });

    expect(didit.decisionCalls).toContain(sessionId);
    // Ya está aprobado: no corresponde una sesión nueva (AC2).
    expect(retry.statusCode).toBe(409);
    expect(JSON.parse(retry.body).error.code).toBe("KYC_SESSION_NOT_ALLOWED");

    const resolved = await app.db.kycVerification.findUnique({ where: { externalSessionId: sessionId } });
    expect(resolved?.status).toBe("approved");
    expect(resolved?.resolvedAt).toBeInstanceOf(Date);

    const user = await app.db.user.findUnique({ where: { id: userId } });
    expect(user?.kycStatusIdentity).toBe("approved");

    // No se abrió ningún intento nuevo.
    const verifications = await app.db.kycVerification.findMany({ where: { userId } });
    expect(verifications).toHaveLength(1);
  });

  it("aplica una decisión pendiente de rechazo y deja reintentar en la misma llamada", async () => {
    const userId = await registerVerifiedUser();
    const first = await app.inject({ method: "POST", url: "/kyc/session", headers: { "x-user-id": userId } });
    const sessionId = (JSON.parse(first.body) as { sessionId: string }).sessionId;

    didit.setDecision({
      sessionId,
      rawStatus: "Declined",
      decision: {
        status: "Declined",
        id_verifications: [
          {
            address: "Calle Falsa 123", // PII: AC9 prohíbe persistirla
            warnings: [{ feature: "ID_VERIFICATION", risk: "DOCUMENT_EXPIRED", short_description: "Document expired" }],
          },
        ],
      },
    });

    const retry = await app.inject({ method: "POST", url: "/kyc/session", headers: { "x-user-id": userId } });

    // `rejected` sí permite reintentar, así que la sesión nueva se crea igual.
    expect(retry.statusCode).toBe(201);
    const newSessionId = (JSON.parse(retry.body) as { sessionId: string }).sessionId;
    expect(newSessionId).not.toBe(sessionId);

    // El intento viejo quedó con la decisión real, no como `expired`.
    const resolved = await app.db.kycVerification.findUnique({ where: { externalSessionId: sessionId } });
    expect(resolved?.status).toBe("rejected");
    // Misma redacción de AC9 que el webhook: solo status/session_id/warnings acotados.
    expect(resolved?.rawDecision).toEqual({
      status: "Declined",
      session_id: sessionId,
      warnings: [{ feature: "ID_VERIFICATION", risk: "DOCUMENT_EXPIRED", description: "Document expired" }],
    });
    expect(JSON.stringify(resolved?.rawDecision)).not.toContain("Calle Falsa");
  });

  it("no bloquea el reintento si no se puede consultar la decisión (proveedor caído)", async () => {
    const userId = await registerVerifiedUser();
    const first = await app.inject({ method: "POST", url: "/kyc/session", headers: { "x-user-id": userId } });
    const sessionId = (JSON.parse(first.body) as { sessionId: string }).sessionId;

    didit.failDecisionWith(new Error("didit caído"));

    const retry = await app.inject({ method: "POST", url: "/kyc/session", headers: { "x-user-id": userId } });

    // Falla hacia la fricción (descartar y rehacer), nunca hacia dejar al usuario trabado.
    expect(retry.statusCode).toBe(201);
    const abandoned = await app.db.kycVerification.findUnique({ where: { externalSessionId: sessionId } });
    expect(abandoned?.status).toBe("expired");
  });

  it("no cambia nada si Didit reporta un estado no terminal: el intento se descarta como antes", async () => {
    const userId = await registerVerifiedUser();
    const first = await app.inject({ method: "POST", url: "/kyc/session", headers: { "x-user-id": userId } });
    const sessionId = (JSON.parse(first.body) as { sessionId: string }).sessionId;

    didit.setDecision({ sessionId, rawStatus: "In Progress", decision: { status: "In Progress" } });

    const retry = await app.inject({ method: "POST", url: "/kyc/session", headers: { "x-user-id": userId } });

    expect(retry.statusCode).toBe(201);
    const abandoned = await app.db.kycVerification.findUnique({ where: { externalSessionId: sessionId } });
    expect(abandoned?.status).toBe("expired");
  });

  // Didit hace dedupe implícito por `vendor_data` (spike MOVO-48): con una sesión sin
  // terminar puede devolver la MISMA que ya teníamos. Un insert plano rompería contra la
  // constraint única de external_session_id -- por eso el repositorio hace upsert.
  it("revive el intento sin romper la unicidad si Didit devuelve la misma sesión que ya existía", async () => {
    const userId = await registerVerifiedUser();
    const first = await app.inject({ method: "POST", url: "/kyc/session", headers: { "x-user-id": userId } });
    const sessionId = (JSON.parse(first.body) as { sessionId: string }).sessionId;

    didit.pinSessionId(sessionId);
    const second = await app.inject({ method: "POST", url: "/kyc/session", headers: { "x-user-id": userId } });

    expect(second.statusCode).toBe(201);
    expect((JSON.parse(second.body) as { sessionId: string }).sessionId).toBe(sessionId);

    const verifications = await app.db.kycVerification.findMany({ where: { userId } });
    expect(verifications).toHaveLength(1);
    expect(verifications[0]).toMatchObject({ externalSessionId: sessionId, status: "pending", resolvedAt: null });
  });

  it.each(["rejected", "manual_review", "expired", "pending"])(
    "permite crear sesión (201) si el kyc_status es %s (AC2)",
    async (status) => {
      const userId = await registerVerifiedUser();
      await app.db.user.update({ where: { id: userId }, data: { kycStatusIdentity: status } });

      const response = await app.inject({
        method: "POST",
        url: "/kyc/session",
        headers: { "x-user-id": userId },
      });

      expect(response.statusCode).toBe(201);
    }
  );

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
