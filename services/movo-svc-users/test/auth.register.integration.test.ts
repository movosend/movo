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
  };
  return { provider, sentCodes };
}

describe("POST /auth/register", () => {
  let app: FastifyInstance;
  let captor: ReturnType<typeof createCaptorSmsProvider>;

  const basePayload = {
    fullName: "Juan Perez",
    email: "juan.perez@example.com",
    phone: "3511234567",
    password: "Password1",
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    captor = createCaptorSmsProvider();
    app = buildApp({ smsProvider: captor.provider });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Aísla cada test: sin esto, el orden de ejecución hace que los tests fallen
    // de forma intermitente cuando comparten filas insertadas por otros tests.
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");

    let cursor = "0";
    do {
      const [nextCursor, keys] = await app.redis.scan(cursor, "MATCH", "otp:*", "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await app.redis.del(...keys);
      }
    } while (cursor !== "0");
  });

  /**
   * Camino real (MOVO-72): el phoneVerificationToken que exige /auth/register se
   * obtiene pasando por send-otp/verify-otp de verdad (MOVO-71), no fabricado a mano.
   */
  async function getPhoneVerificationToken(phone: string, normalizedPhone: string): Promise<string> {
    const send = await app.inject({ method: "POST", url: "/auth/send-otp", payload: { phone } });
    const { otpId } = JSON.parse(send.body) as { otpId: string };
    const code = captor.sentCodes.get(normalizedPhone);
    if (!code) {
      throw new Error(`No se capturó ningún código para ${normalizedPhone}`);
    }
    const verify = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { otpId, code } });
    const { phoneVerificationToken } = JSON.parse(verify.body) as { phoneVerificationToken: string };
    return phoneVerificationToken;
  }

  async function register(payloadOverrides: Partial<typeof basePayload> = {}) {
    const payload = { ...basePayload, ...payloadOverrides };
    const phoneVerificationToken = await getPhoneVerificationToken(payload.phone, normalizeForTest(payload.phone));
    return app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...payload, phoneVerificationToken },
    });
  }

  // Espejo mínimo de auth.service.ts#normalizePhoneToE164Ar, solo para armar el target
  // que usó send-otp y así poder leer el código capturado — no se reimporta el service
  // real a propósito, para no acoplar el test a un detalle interno más de lo necesario.
  function normalizeForTest(rawPhone: string): string {
    let digits = rawPhone.replace(/\D/g, "");
    if (digits.startsWith("54")) digits = digits.slice(2);
    if (digits.startsWith("9")) digits = digits.slice(1);
    return `+549${digits}`;
  }

  it("da de alta un usuario exitosamente, persiste roles por defecto, phoneVerified=true, y emite tokens de sesión (revisión de PR #51: register() autentica igual que login())", async () => {
    const response = await register();

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as {
      userId: string;
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      kycStatus: string;
      fullName: string;
      roles: string[];
    };
    expect(body).toEqual({
      userId: expect.any(String),
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresIn: 3600,
      kycStatus: "not_started",
      fullName: "Juan Perez",
      roles: ["sender", "carrier"],
    });
    expect(response.body).not.toContain(basePayload.password);

    const userRow = await app.db.user.findUnique({ where: { id: body.userId } });
    expect(userRow).toMatchObject({
      email: "juan.perez@example.com",
      phone: "+5493511234567",
      firstName: "Juan",
      lastName: "Perez",
      kycStatusIdentity: "not_started",
      status: "active",
      phoneVerified: true,
    });
    expect(userRow?.passwordHash).not.toBe(basePayload.password);

    const roles = await app.db.userRoleGrant.findMany({
      where: { userId: body.userId },
      orderBy: { role: "asc" },
    });
    // MOVO-91: roles pasan a los literales de @movo/shared (UserRole.SENDER/CARRIER).
    // El ORDER BY de un enum de Postgres sigue el orden ordinal de declaración del
    // tipo ('sender','carrier','admin'), no el alfabético.
    expect(roles.map((r) => r.role)).toEqual(["sender", "carrier"]);
  });

  it("rechaza el registro sin phoneVerificationToken con 400 VALIDATION_FAILED", async () => {
    const response = await app.inject({ method: "POST", url: "/auth/register", payload: basePayload });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
  });

  it("rechaza un phoneVerificationToken inválido/inexistente con 401 AUTH_OTP_INVALID, sin crear el usuario", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...basePayload, phoneVerificationToken: "no-es-un-jwt-valido" },
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.code).toBe("AUTH_OTP_INVALID");

    const count = await app.db.user.count();
    expect(count).toBe(0);
  });

  it("rechaza reutilizar el mismo phoneVerificationToken en un segundo registro (single-use)", async () => {
    const phoneVerificationToken = await getPhoneVerificationToken(basePayload.phone, "+5493511234567");

    const first = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...basePayload, phoneVerificationToken },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...basePayload, email: "otro@example.com", phone: "3511234568", phoneVerificationToken },
    });
    expect(second.statusCode).toBe(401);
    expect(JSON.parse(second.body).error.code).toBe("AUTH_OTP_INVALID");
  });

  it("rechaza un phoneVerificationToken emitido para otro teléfono con 401 AUTH_OTP_INVALID", async () => {
    // Token válido para 3511234567, pero el body de /auth/register declara otro teléfono.
    const phoneVerificationToken = await getPhoneVerificationToken(basePayload.phone, "+5493511234567");

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...basePayload, phone: "3511234599", phoneVerificationToken },
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.code).toBe("AUTH_OTP_INVALID");
  });

  it("normaliza el email a minúsculas antes de persistir y de comparar (AC5)", async () => {
    await register({ email: "Juan.Perez@Example.com" });

    const duplicate = await register({ phone: "3511234568", email: "juan.perez@example.com" });

    expect(duplicate.statusCode).toBe(409);
    expect(JSON.parse(duplicate.body).error.code).toBe("USER_EMAIL_ALREADY_EXISTS");
  });

  it("rechaza un email ya registrado con 409 USER_EMAIL_ALREADY_EXISTS", async () => {
    await register();

    const response = await register({ phone: "3511234568" });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe("USER_EMAIL_ALREADY_EXISTS");
  });

  it("libera el phoneVerificationToken si el registro falla por conflicto, para que el reintento con el dato corregido no tenga que rehacer el OTP (revisión de PR #51, tmvergara)", async () => {
    // Repro exacto del comentario de review: registrar con un email que ya existe
    // consume el token igual (el conflicto se descubre después), pero como el
    // registro no prosperó, el token tiene que seguir sirviendo para el reintento.
    // Teléfono distinto al de basePayload en los dos intentos siguientes, para que el
    // único conflicto real sea el email (si no, el segundo intento chocaría también
    // por teléfono, y el test no probaría lo que dice probar).
    await register({ email: "ya-existe@example.com" });

    const phoneVerificationToken = await getPhoneVerificationToken("3511234568", "+5493511234568");

    const conflicting = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...basePayload, email: "ya-existe@example.com", phone: "3511234568", phoneVerificationToken },
    });
    expect(conflicting.statusCode).toBe(409);
    expect(JSON.parse(conflicting.body).error.code).toBe("USER_EMAIL_ALREADY_EXISTS");

    // Mismo token, email corregido: no debería pedir un OTP nuevo.
    const retry = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...basePayload, email: "corregido@example.com", phone: "3511234568", phoneVerificationToken },
    });
    expect(retry.statusCode).toBe(201);
  });

  it("rechaza un teléfono ya registrado con 409 USER_PHONE_ALREADY_EXISTS, incluso escrito en otro formato", async () => {
    await register({ phone: "3511234567" });

    const response = await register({ email: "otro@example.com", phone: "+543511234567" });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe("USER_PHONE_ALREADY_EXISTS");
  });

  it("rechaza una password débil (sin dígito) con 400 VALIDATION_FAILED", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...basePayload, password: "abcdefgh", phoneVerificationToken: "irrelevante" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
  });

  it("rechaza una password corta con 400 VALIDATION_FAILED", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...basePayload, password: "abc123", phoneVerificationToken: "irrelevante" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
  });

  it("rechaza un teléfono con formato inválido con 400 VALIDATION_FAILED", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...basePayload, phone: "123", phoneVerificationToken: "irrelevante" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
  });

  it("acepta variantes válidas del formato argentino y normaliza todas al mismo E.164", async () => {
    const variants = ["3511234567", "93511234567", "+543511234567", "+5493511234567"];

    for (const [index, phone] of variants.entries()) {
      await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
      const response = await register({ email: `variant${index}@example.com`, phone });

      expect(response.statusCode).toBe(201);
      const { userId } = JSON.parse(response.body) as { userId: string };
      const row = await app.db.user.findUnique({ where: { id: userId } });
      expect(row?.phone).toBe("+5493511234567");
    }
  });

  it("rechaza un fullName de una sola palabra con 400 VALIDATION_FAILED", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...basePayload, fullName: "Juan", phoneVerificationToken: "irrelevante" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
  });
});
