import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { buildApp } from "../src/app";
import { SmsProvider } from "../src/adapters/sms-provider";
import { EmailBody, EmailProvider } from "../src/adapters/email-provider";

function createCaptorSmsProvider() {
  const sentCodes = new Map<string, string>();
  const textMessages: { to: string; message: string }[] = [];
  const provider: SmsProvider = {
    async send(toE164: string, code: string): Promise<void> {
      sentCodes.set(toE164, code);
    },
    async sendText(toE164: string, message: string): Promise<void> {
      textMessages.push({ to: toE164, message });
    },
  };
  return { provider, sentCodes, textMessages };
}

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

describe("Recuperación de contraseña por OTP (MOVO-140)", () => {
  let app: FastifyInstance;
  let smsCaptor: ReturnType<typeof createCaptorSmsProvider>;
  let emailCaptor: ReturnType<typeof createCaptorEmailProvider>;

  let phoneCounter = 0;
  function nextPhone(): string {
    phoneCounter += 1;
    return `351${(4000000 + phoneCounter).toString().padStart(7, "0")}`;
  }

  function buildRegisterPayload(overrides: Record<string, unknown> = {}) {
    const phone = nextPhone();
    return {
      fullName: "Marina Suarez",
      email: `marina-${phone}@example.com`,
      phone,
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
      ...overrides,
    };
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    smsCaptor = createCaptorSmsProvider();
    emailCaptor = createCaptorEmailProvider();
    app = buildApp({ smsProvider: smsCaptor.provider, emailProvider: emailCaptor.provider });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
    smsCaptor.sentCodes.clear();
    smsCaptor.textMessages.length = 0;
    emailCaptor.sentCodes.clear();
    emailCaptor.messages.length = 0;

    for (const pattern of ["otp:*", "refresh:*", "user-revoked-at:*", "password-reset-used:*"]) {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await app.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await app.redis.del(...keys);
        }
      } while (cursor !== "0");
    }
  });

  /** Mismo helper que auth.login.integration.test.ts/users.account-settings.integration.test.ts. */
  async function registerFixtureUser(payload: ReturnType<typeof buildRegisterPayload>) {
    const send = await app.inject({ method: "POST", url: "/auth/send-otp", payload: { phone: payload.phone } });
    const { otpId } = JSON.parse(send.body) as { otpId: string };
    const code = [...smsCaptor.sentCodes.values()].pop();
    if (!code) {
      throw new Error("No se capturó ningún código OTP de registro");
    }
    const verify = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { otpId, code } });
    const { phoneVerificationToken } = JSON.parse(verify.body) as { phoneVerificationToken: string };
    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...payload, phoneVerificationToken },
    });
    smsCaptor.sentCodes.clear();
    return JSON.parse(register.body) as { userId: string; accessToken: string; refreshToken: string };
  }

  async function forgotPassword(identifier: string) {
    const response = await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { identifier } });
    return {
      response,
      body: JSON.parse(response.body) as { otpId: string; cooldownSeconds: number; channel: string },
    };
  }

  function verifyResetOtp(otpId: string, code: string) {
    return app.inject({ method: "POST", url: "/auth/verify-reset-otp", payload: { otpId, code } });
  }

  function resetPassword(passwordResetToken: string, newPassword: string) {
    return app.inject({ method: "POST", url: "/auth/reset-password", payload: { passwordResetToken, newPassword } });
  }

  describe("POST /auth/forgot-password", () => {
    it("flujo feliz por SMS: manda un OTP de 6 dígitos al teléfono normalizado", async () => {
      const payload = buildRegisterPayload();
      await registerFixtureUser(payload);

      const { response, body } = await forgotPassword(payload.phone);

      expect(response.statusCode).toBe(200);
      expect(body.otpId).toEqual(expect.any(String));
      expect(body.cooldownSeconds).toBe(60);
      expect(body.channel).toBe("sms");

      const normalizedPhone = `+549${payload.phone}`;
      const code = smsCaptor.sentCodes.get(normalizedPhone);
      expect(code).toMatch(/^\d{6}$/);
    });

    it("flujo feliz por email: manda un OTP de 6 dígitos al email, solo si emailVerified", async () => {
      const payload = buildRegisterPayload();
      const { userId } = await registerFixtureUser(payload);
      await app.db.user.update({ where: { id: userId }, data: { emailVerified: true } });

      const { response, body } = await forgotPassword(payload.email);

      expect(response.statusCode).toBe(200);
      expect(body.channel).toBe("email");

      const code = emailCaptor.sentCodes.get(payload.email.toLowerCase());
      expect(code).toMatch(/^\d{6}$/);
    });

    it("identificador que no matchea ni email ni teléfono devuelve 400 VALIDATION_FAILED, no un señuelo", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/forgot-password",
        payload: { identifier: "no-es-ni-email-ni-telefono" },
      });
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("AC2/AC5: un teléfono inexistente es indistinguible de uno real -- mismo status y shape, sin entregar nada", async () => {
      const payload = buildRegisterPayload();
      await registerFixtureUser(payload);
      const real = await forgotPassword(payload.phone);

      const fakePhone = nextPhone();
      const fake = await forgotPassword(fakePhone);

      expect(fake.response.statusCode).toBe(real.response.statusCode);
      expect(Object.keys(fake.body).sort()).toEqual(Object.keys(real.body).sort());
      expect(fake.body.cooldownSeconds).toBe(real.body.cooldownSeconds);
      expect(fake.body.channel).toBe(real.body.channel);
      expect(fake.body.otpId).toEqual(expect.any(String));

      // El señuelo nunca entrega nada por ningún canal.
      expect(smsCaptor.sentCodes.has(`+549${fakePhone}`)).toBe(false);
    });

    it("AC2: un email inexistente es tratado como señuelo, mismo shape que uno real", async () => {
      const fake = await forgotPassword("no-existe-nadie-con-este-email@example.com");
      expect(fake.response.statusCode).toBe(200);
      expect(fake.body.channel).toBe("email");
      expect(fake.body.otpId).toEqual(expect.any(String));
      expect(emailCaptor.sentCodes.size).toBe(0);
    });

    it("AC2: un email registrado pero con emailVerified=false es tratado como señuelo", async () => {
      const payload = buildRegisterPayload();
      await registerFixtureUser(payload); // emailVerified queda false por default

      const { response, body } = await forgotPassword(payload.email);

      expect(response.statusCode).toBe(200);
      expect(body.channel).toBe("email");
      expect(emailCaptor.sentCodes.has(payload.email.toLowerCase())).toBe(false);
    });

    it("AC2: una cuenta banned es tratada como señuelo", async () => {
      const payload = buildRegisterPayload();
      const { userId } = await registerFixtureUser(payload);
      await app.db.user.update({ where: { id: userId }, data: { status: "banned" } });

      const { response, body } = await forgotPassword(payload.phone);

      expect(response.statusCode).toBe(200);
      expect(body.channel).toBe("sms");
      expect(smsCaptor.sentCodes.has(`+549${payload.phone}`)).toBe(false);
    });

    it("AC2: una cuenta deleted es tratada como señuelo", async () => {
      const payload = buildRegisterPayload();
      const { userId } = await registerFixtureUser(payload);
      await app.db.user.update({ where: { id: userId }, data: { status: "deleted" } });

      const { response } = await forgotPassword(payload.phone);

      expect(response.statusCode).toBe(200);
      expect(smsCaptor.sentCodes.has(`+549${payload.phone}`)).toBe(false);
    });
  });

  describe("POST /auth/resend-otp sobre un otpId señuelo (AC3)", () => {
    it("responde 200 con el mismo shape que un resend real, pero no entrega nada", async () => {
      const { body } = await forgotPassword("nadie-registrado-con-este-mail@example.com");
      // Vencer el cooldown escribiendo lastSentAt viejo directo en Redis, como hacen
      // los tests de auth.otp.integration.test.ts.
      await app.redis.hset(`otp:${body.otpId}`, "lastSentAt", String(Date.now() - 61_000));

      const resend = await app.inject({ method: "POST", url: "/auth/resend-otp", payload: { otpId: body.otpId } });

      expect(resend.statusCode).toBe(200);
      const resendBody = JSON.parse(resend.body) as { resentAt: string; cooldownSeconds: number };
      expect(resendBody.cooldownSeconds).toBe(60);
      expect(emailCaptor.messages).toHaveLength(0);
    });

    it("respeta el cooldown de 429 igual que un otpId real", async () => {
      const { body } = await forgotPassword("otro-inexistente@example.com");

      const resend = await app.inject({ method: "POST", url: "/auth/resend-otp", payload: { otpId: body.otpId } });

      expect(resend.statusCode).toBe(429);
      expect(JSON.parse(resend.body).error.code).toBe("RATE_LIMIT_EXCEEDED");
    });
  });

  describe("POST /auth/verify-reset-otp", () => {
    it("código correcto devuelve 200 con un passwordResetToken (purpose password_reset, 15min TTL)", async () => {
      const payload = buildRegisterPayload();
      const { userId } = await registerFixtureUser(payload);
      const { body } = await forgotPassword(payload.phone);
      const code = smsCaptor.sentCodes.get(`+549${payload.phone}`)!;

      const response = await verifyResetOtp(body.otpId, code);

      expect(response.statusCode).toBe(200);
      const { passwordResetToken } = JSON.parse(response.body) as { passwordResetToken: string };
      const decoded = jwt.verify(passwordResetToken, "test-secret", { issuer: "movo" }) as jwt.JwtPayload;
      expect(decoded.sub).toBe(userId);
      expect(decoded.purpose).toBe("password_reset");
      expect(decoded.jti).toEqual(expect.any(String));
    });

    it("código incorrecto devuelve 401 AUTH_OTP_INVALID", async () => {
      const payload = buildRegisterPayload();
      await registerFixtureUser(payload);
      const { body } = await forgotPassword(payload.phone);
      const code = smsCaptor.sentCodes.get(`+549${payload.phone}`)!;
      const wrongCode = code === "000000" ? "111111" : "000000";

      const response = await verifyResetOtp(body.otpId, wrongCode);

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_OTP_INVALID");
    });

    it("un otpId nunca generado (OTP vencido/inexistente) devuelve 422 AUTH_OTP_EXPIRED", async () => {
      const response = await verifyResetOtp("00000000-0000-4000-8000-000000000099", "123456");
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_OTP_EXPIRED");
    });

    it("AC8: el phoneVerificationToken de registro no sirve como passwordResetToken", async () => {
      const payload = buildRegisterPayload();
      await registerFixtureUser(payload);

      // Genera un phoneVerificationToken real (mismo mecanismo, distinto propósito).
      const send = await app.inject({ method: "POST", url: "/auth/send-otp", payload: { phone: nextPhone() } });
      const { otpId } = JSON.parse(send.body) as { otpId: string };
      const code = [...smsCaptor.sentCodes.values()].pop()!;
      const verify = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { otpId, code } });
      const { phoneVerificationToken } = JSON.parse(verify.body) as { phoneVerificationToken: string };

      const response = await resetPassword(phoneVerificationToken, "NewPassword1");
      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /auth/reset-password", () => {
    async function forgotVerifyAndGetToken(phone: string) {
      const { body } = await forgotPassword(phone);
      const code = smsCaptor.sentCodes.get(`+549${phone}`)!;
      const verify = await verifyResetOtp(body.otpId, code);
      return (JSON.parse(verify.body) as { passwordResetToken: string }).passwordResetToken;
    }

    it("con un token válido y contraseña nueva, responde 204, persiste el hash y revoca todas las sesiones", async () => {
      const payload = buildRegisterPayload();
      const { refreshToken: oldRefreshToken } = await registerFixtureUser(payload);
      const passwordResetToken = await forgotVerifyAndGetToken(payload.phone);

      const response = await resetPassword(passwordResetToken, "NewPassword1");
      expect(response.statusCode).toBe(204);

      // AC12: el refresh token emitido antes del reset ya no sirve.
      const refreshAttempt = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: oldRefreshToken },
      });
      expect(refreshAttempt.statusCode).toBe(401);

      // AC11: login con la contraseña vieja falla, con la nueva funciona.
      const loginOld = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { phone: payload.phone, password: payload.password },
      });
      expect(loginOld.statusCode).toBe(401);

      const loginNew = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { phone: payload.phone, password: "NewPassword1" },
      });
      expect(loginNew.statusCode).toBe(200);
    });

    it("AC13: manda el aviso de contraseña cambiada por SMS siempre, y por email solo si emailVerified", async () => {
      const payload = buildRegisterPayload();
      const { userId } = await registerFixtureUser(payload);
      await app.db.user.update({ where: { id: userId }, data: { emailVerified: true } });
      const passwordResetToken = await forgotVerifyAndGetToken(payload.phone);

      await resetPassword(passwordResetToken, "NewPassword1");

      expect(smsCaptor.textMessages.some((m) => m.to === `+549${payload.phone}`)).toBe(true);
      expect(emailCaptor.messages.some((m) => m.to === payload.email.toLowerCase())).toBe(true);
    });

    it("no rechaza que la contraseña nueva sea igual a la anterior (AC11, a diferencia de MOVO-134)", async () => {
      const payload = buildRegisterPayload();
      await registerFixtureUser(payload);
      const passwordResetToken = await forgotVerifyAndGetToken(payload.phone);

      const response = await resetPassword(passwordResetToken, payload.password);
      expect(response.statusCode).toBe(204);
    });

    it("newPassword se valida con las mismas reglas que el registro (AC10)", async () => {
      const payload = buildRegisterPayload();
      await registerFixtureUser(payload);
      const passwordResetToken = await forgotVerifyAndGetToken(payload.phone);

      const response = await resetPassword(passwordResetToken, "short1");
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("AC9: un passwordResetToken ya usado devuelve 401 en el segundo intento", async () => {
      const payload = buildRegisterPayload();
      await registerFixtureUser(payload);
      const passwordResetToken = await forgotVerifyAndGetToken(payload.phone);

      const first = await resetPassword(passwordResetToken, "NewPassword1");
      expect(first.statusCode).toBe(204);

      const second = await resetPassword(passwordResetToken, "AnotherPassword2");
      expect(second.statusCode).toBe(401);
    });

    it("un token vencido devuelve 401", async () => {
      const payload = buildRegisterPayload();
      const { userId } = await registerFixtureUser(payload);
      const expired = jwt.sign(
        { sub: userId, purpose: "password_reset", jti: "jti-expired-reset" },
        "test-secret",
        { expiresIn: "-1s", issuer: "movo" }
      );

      const response = await resetPassword(expired, "NewPassword1");
      expect(response.statusCode).toBe(401);
    });

    it("fix de review (Pedro): una cuenta baneada DESPUÉS de emitir el token no puede canjearlo (403 ACCOUNT_SUSPENDED)", async () => {
      const payload = buildRegisterPayload();
      const { userId } = await registerFixtureUser(payload);
      const passwordResetToken = await forgotVerifyAndGetToken(payload.phone);

      // El token ya se emitió con la cuenta activa; recién ahora se banea.
      await app.db.user.update({ where: { id: userId }, data: { status: "banned" } });

      const response = await resetPassword(passwordResetToken, "NewPassword1");
      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error.code).toBe("ACCOUNT_SUSPENDED");
    });

    it("fix de review (Pedro): una cuenta eliminada DESPUÉS de emitir el token no puede canjearlo (403 ACCOUNT_SUSPENDED)", async () => {
      const payload = buildRegisterPayload();
      const { userId } = await registerFixtureUser(payload);
      const passwordResetToken = await forgotVerifyAndGetToken(payload.phone);

      await app.db.user.update({ where: { id: userId }, data: { status: "deleted" } });

      const response = await resetPassword(passwordResetToken, "NewPassword1");
      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error.code).toBe("ACCOUNT_SUSPENDED");
    });
  });

  describe("fix de review (Pedro): timing side-channel del señuelo", () => {
    it("el camino señuelo espera un tiempo comparable a una entrega real, no responde instantáneo", async () => {
      const start = Date.now();
      await forgotPassword("no-existe-para-timing@example.com");
      const elapsed = Date.now() - start;

      // DECOY_DELIVER_DELAY_MS = 200 en otp-service.ts -- antes del fix este camino
      // no esperaba nada acá (el deliver() real nunca se llamaba para un señuelo),
      // así que devolvía en pocos ms. Cota floja (no exacta) para no ser un test
      // flaky por jitter de CI: alcanza con confirmar que la espera existe.
      expect(elapsed).toBeGreaterThanOrEqual(150);
    });
  });
});
