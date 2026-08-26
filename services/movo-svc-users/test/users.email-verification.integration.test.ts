import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";
import { SmsProvider } from "../src/adapters/sms-provider";
import { EmailBody, EmailProvider } from "../src/adapters/email-provider";

/** El código nunca sale por HTTP (mismo criterio que el captor de SMS de MOVO-71):
 * los tests lo leen del mail que habría salido. `messages` guarda todo lo enviado,
 * incluido el aviso al email anterior (que no lleva código). */
function createCaptorEmailProvider() {
  const sentCodes = new Map<string, string>();
  const messages: { to: string; subject: string; body: EmailBody }[] = [];
  const provider: EmailProvider = {
    async send(to: string, subject: string, body: EmailBody): Promise<void> {
      messages.push({ to, subject, body });
      const match = body.text.match(/\b(\d{6})\b/);
      if (match?.[1]) {
        sentCodes.set(to, match[1]);
      }
    },
  };
  return { provider, sentCodes, messages };
}

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

describe("Verificación de email por OTP (MOVO-139)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;
  let emailCaptor: ReturnType<typeof createCaptorEmailProvider>;
  let smsCaptor: ReturnType<typeof createCaptorSmsProvider>;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    emailCaptor = createCaptorEmailProvider();
    smsCaptor = createCaptorSmsProvider();
    app = buildApp({ emailProvider: emailCaptor.provider, smsProvider: smsCaptor.provider });
    await app.ready();
    repo = createUserRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
    emailCaptor.sentCodes.clear();
    emailCaptor.messages.length = 0;
    smsCaptor.sentCodes.clear();

    let cursor = "0";
    do {
      const [nextCursor, keys] = await app.redis.scan(cursor, "MATCH", "otp:*", "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await app.redis.del(...keys);
      }
    } while (cursor !== "0");
  });

  let phoneCounter = 0;
  function nextPhone(): string {
    phoneCounter += 1;
    return `+549351${(3000000 + phoneCounter).toString().padStart(7, "0")}`;
  }

  function buildInput(overrides: Partial<CreateUserInput> = {}): CreateUserInput {
    return {
      email: `user-${randomUUID()}@movo.test`,
      phone: nextPhone(),
      firstName: "Alena",
      lastName: "Ariza",
      passwordHash: "hashed_password",
      roles: [UserRole.SENDER, UserRole.CARRIER],
      phoneVerified: true,
      address: {
        street: "Av. Colón",
        number: "1234",
        city: "Córdoba",
        province: "Córdoba",
        zip: "5000",
        lat: -31.4201,
        long: -64.1888,
      },
      ...overrides,
    };
  }

  async function requestVerification(userId: string) {
    const response = await app.inject({
      method: "POST",
      url: "/users/me/email/verify/otp",
      headers: { "x-user-id": userId },
    });
    return { response, body: JSON.parse(response.body) as { otpId: string; cooldownSeconds: number; sent: boolean } };
  }

  function confirmVerification(userId: string, otpId: string, code: string) {
    return app.inject({
      method: "POST",
      url: "/users/me/email/verify/confirm",
      headers: { "x-user-id": userId },
      payload: { otpId, code },
    });
  }

  describe("POST /users/me/email/verify/otp (AC2)", () => {
    it("manda un código de 6 dígitos al email ACTUAL de la cuenta", async () => {
      const user = await repo.create(buildInput());

      const { response, body } = await requestVerification(user.id);

      expect(response.statusCode).toBe(200);
      expect(body.otpId).toEqual(expect.any(String));
      expect(body.cooldownSeconds).toBe(60);
      expect(body.sent).toBe(true);
      expect(emailCaptor.sentCodes.get(user.email)).toMatch(/^\d{6}$/);
      // Nunca sale por SMS: el canal lo elige el service, no el caller.
      expect(smsCaptor.sentCodes.size).toBe(0);
    });

    it("el mail incluye la advertencia de no compartir el código y no lo expone por HTTP", async () => {
      const user = await repo.create(buildInput());

      const { response } = await requestVerification(user.id);

      const code = emailCaptor.sentCodes.get(user.email)!;
      const message = emailCaptor.messages.find((m) => m.to === user.email)!;
      expect(message.body.text).toMatch(/no lo compartas/i);
      expect(message.body.html).toContain(code);
      // El código nunca sale por HTTP (DoD de MOVO-71, mismo criterio acá).
      expect(response.body).not.toContain(code);
    });

    it("email ya verificado -> 400, sin gastar un envío", async () => {
      const user = await repo.create(buildInput());
      await repo.markEmailVerified(user.id);

      const { response } = await requestVerification(user.id);

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
      expect(emailCaptor.messages).toHaveLength(0);
    });

    it("exige JWT -> 401 sin header x-user-id", async () => {
      const response = await app.inject({ method: "POST", url: "/users/me/email/verify/otp" });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /users/me/email/verify/confirm (AC3)", () => {
    it("con el código correcto deja emailVerified=true y devuelve el PrivateProfile actualizado", async () => {
      const user = await repo.create(buildInput());
      const { body: otpBody } = await requestVerification(user.id);
      const code = emailCaptor.sentCodes.get(user.email)!;

      const response = await confirmVerification(user.id, otpBody.otpId, code);

      expect(response.statusCode).toBe(200);
      const profile = JSON.parse(response.body);
      expect(profile.emailVerified).toBe(true);
      expect(profile.email).toBe(user.email);

      const reloaded = await repo.findById(user.id);
      expect(reloaded?.emailVerified).toBe(true);
      expect(reloaded?.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it("sin verificar, nada cambia: el email sigue sin verificar", async () => {
      const user = await repo.create(buildInput());
      await requestVerification(user.id);

      const reloaded = await repo.findById(user.id);
      expect(reloaded?.emailVerified).toBe(false);
      expect(reloaded?.emailVerifiedAt).toBeNull();
    });

    it("AC6: código inválido -> 401 AUTH_OTP_INVALID y el email sigue sin verificar", async () => {
      const user = await repo.create(buildInput());
      const { body: otpBody } = await requestVerification(user.id);
      const code = emailCaptor.sentCodes.get(user.email)!;
      const wrongCode = code === "000000" ? "111111" : "000000";

      const response = await confirmVerification(user.id, otpBody.otpId, wrongCode);

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_OTP_INVALID");
      expect((await repo.findById(user.id))?.emailVerified).toBe(false);
    });

    it("AC6: reusar un otpId ya consumido -> 422 AUTH_OTP_EXPIRED", async () => {
      const user = await repo.create(buildInput());
      const { body: otpBody } = await requestVerification(user.id);
      const code = emailCaptor.sentCodes.get(user.email)!;

      expect((await confirmVerification(user.id, otpBody.otpId, code)).statusCode).toBe(200);

      const reused = await confirmVerification(user.id, otpBody.otpId, code);
      expect(reused.statusCode).toBe(422);
      expect(JSON.parse(reused.body).error.code).toBe("AUTH_OTP_EXPIRED");
    });

    it("AC6: otpId inexistente/vencido -> 422 AUTH_OTP_EXPIRED", async () => {
      const user = await repo.create(buildInput());

      const response = await confirmVerification(user.id, "00000000-0000-4000-8000-000000000097", "123456");

      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_OTP_EXPIRED");
    });

    it("AC6: a los 5 intentos fallidos el código queda invalidado (el 6º, con el código bueno, ya no sirve)", async () => {
      const user = await repo.create(buildInput());
      const { body: otpBody } = await requestVerification(user.id);
      const code = emailCaptor.sentCodes.get(user.email)!;
      const wrongCode = code === "000000" ? "111111" : "000000";

      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await confirmVerification(user.id, otpBody.otpId, wrongCode)).statusCode).toBe(401);
      }

      const afterLockout = await confirmVerification(user.id, otpBody.otpId, code);
      expect(afterLockout.statusCode).toBe(422);
      expect((await repo.findById(user.id))?.emailVerified).toBe(false);
    });

    it("exige JWT -> 401 sin header x-user-id", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/users/me/email/verify/confirm",
        payload: { otpId: randomUUID(), code: "123456" },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("Cooldown y reenvío (AC6/AC7)", () => {
    it("un segundo pedido dentro del cooldown reusa el mismo otpId y no manda un mail nuevo", async () => {
      const user = await repo.create(buildInput());
      const { body: first } = await requestVerification(user.id);
      emailCaptor.messages.length = 0;

      const { body: second } = await requestVerification(user.id);

      expect(second.otpId).toBe(first.otpId);
      expect(second.sent).toBe(false);
      expect(second.cooldownSeconds).toBeGreaterThan(0);
      expect(emailCaptor.messages).toHaveLength(0);
    });

    it("AC7: POST /auth/resend-otp reenvía un OTP de canal email POR EMAIL, y el código nuevo verifica", async () => {
      // El canal se persiste en el registro de Redis: `resendOtp` solo recibe el otpId,
      // así que sin ese campo el reenvío no sabría si el target es un teléfono o un
      // email (y en el estado anterior de este código habría intentado mandar un SMS).
      const user = await repo.create(buildInput());
      const { body: otpBody } = await requestVerification(user.id);
      const firstCode = emailCaptor.sentCodes.get(user.email)!;

      // Vence el cooldown sin esperar 60s reales (mismo patrón que el resto de las suites).
      await app.redis.hset(`otp:${otpBody.otpId}`, "lastSentAt", String(Date.now() - 61_000));
      const resend = await app.inject({ method: "POST", url: "/auth/resend-otp", payload: { otpId: otpBody.otpId } });
      expect(resend.statusCode).toBe(200);

      const resentCode = emailCaptor.sentCodes.get(user.email)!;
      expect(resentCode).toMatch(/^\d{6}$/);
      expect(smsCaptor.sentCodes.size).toBe(0);

      // El código viejo ya no sirve (rotación bajo el mismo otpId), el nuevo sí.
      if (resentCode !== firstCode) {
        expect((await confirmVerification(user.id, otpBody.otpId, firstCode)).statusCode).toBe(401);
      }
      expect((await confirmVerification(user.id, otpBody.otpId, resentCode)).statusCode).toBe(200);
    });

    it("reenviar dentro del cooldown -> 429", async () => {
      const user = await repo.create(buildInput());
      const { body: otpBody } = await requestVerification(user.id);

      const resend = await app.inject({ method: "POST", url: "/auth/resend-otp", payload: { otpId: otpBody.otpId } });

      expect(resend.statusCode).toBe(429);
    });
  });

  describe("Aislamiento entre flujos (AC8)", () => {
    it("un OTP de verificación de email no sirve para confirmar un CAMBIO de email", async () => {
      const user = await repo.create(buildInput());
      const { body: verifyOtp } = await requestVerification(user.id);
      const code = emailCaptor.sentCodes.get(user.email)!;

      const misrouted = await app.inject({
        method: "POST",
        url: "/users/me/email/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: verifyOtp.otpId, code },
      });

      expect(misrouted.statusCode).toBe(401);
      expect(JSON.parse(misrouted.body).error.code).toBe("AUTH_OTP_INVALID");
      // El mismatch de flujo no consume el OTP real: sigue sirviendo para lo suyo.
      expect((await confirmVerification(user.id, verifyOtp.otpId, code)).statusCode).toBe(200);
    });

    it("un OTP de cambio de teléfono no sirve para verificar el email", async () => {
      const user = await repo.create(buildInput());
      const newPhone = nextPhone();
      const phoneOtp = await app.inject({
        method: "POST",
        url: "/users/me/phone/change/otp",
        headers: { "x-user-id": user.id },
        payload: { phone: newPhone },
      });
      const { otpId } = JSON.parse(phoneOtp.body) as { otpId: string };
      const code = smsCaptor.sentCodes.get(newPhone)!;

      const response = await confirmVerification(user.id, otpId, code);

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_OTP_INVALID");
      expect((await repo.findById(user.id))?.emailVerified).toBe(false);
    });

    it("el email de la cuenta cambió entre el paso 1 y el confirm -> 401, no verifica una dirección vieja", async () => {
      const user = await repo.create(buildInput());
      const { body: otpBody } = await requestVerification(user.id);
      const code = emailCaptor.sentCodes.get(user.email)!;

      await repo.updateEmail(user.id, `otro-${randomUUID()}@movo.test`);
      // `updateEmail` marca verificado por construcción (AC4) -- se revierte a mano
      // para aislar lo que este caso prueba: que el OTP viejo ya no aplica.
      await app.db.$executeRawUnsafe(
        "UPDATE users.users SET email_verified = false, email_verified_at = NULL WHERE id = $1::uuid",
        user.id
      );

      const response = await confirmVerification(user.id, otpBody.otpId, code);

      expect(response.statusCode).toBe(401);
      expect((await repo.findById(user.id))?.emailVerified).toBe(false);
    });
  });

  describe("Contrato (AC9)", () => {
    it("GET /users/me expone emailVerified", async () => {
      const user = await repo.create(buildInput());

      const before = await app.inject({ method: "GET", url: "/users/me", headers: { "x-user-id": user.id } });
      expect(JSON.parse(before.body).emailVerified).toBe(false);

      await repo.markEmailVerified(user.id);

      const after = await app.inject({ method: "GET", url: "/users/me", headers: { "x-user-id": user.id } });
      expect(JSON.parse(after.body).emailVerified).toBe(true);
    });
  });
});
