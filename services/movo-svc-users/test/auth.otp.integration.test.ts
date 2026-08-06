import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { buildApp } from "../src/app";
import { SmsProvider } from "../src/adapters/sms-provider";

function createCaptorSmsProvider() {
  const sentCodes = new Map<string, string>();
  const sendCalls: Array<{ to: string; code: string }> = [];
  const provider: SmsProvider = {
    async send(toE164: string, code: string): Promise<void> {
      sentCodes.set(toE164, code);
      sendCalls.push({ to: toE164, code });
    },
  };
  return { provider, sentCodes, sendCalls };
}

describe("OTP endpoints (send-otp / verify-otp / resend-otp)", () => {
  let app: FastifyInstance;
  let captor: ReturnType<typeof createCaptorSmsProvider>;

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
    captor.sentCodes.clear();
    captor.sendCalls.length = 0;

    let cursor = "0";
    do {
      const [nextCursor, keys] = await app.redis.scan(cursor, "MATCH", "otp:*", "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await app.redis.del(...keys);
      }
    } while (cursor !== "0");
  });

  async function sendOtp(phone: string) {
    const response = await app.inject({ method: "POST", url: "/auth/send-otp", payload: { phone } });
    return { response, body: JSON.parse(response.body) as { otpId: string; cooldownSeconds: number } };
  }

  async function sendAndCapture(phone: string, normalizedPhone: string) {
    const { body } = await sendOtp(phone);
    const code = captor.sentCodes.get(normalizedPhone);
    if (!code) {
      throw new Error(`No se capturó ningún código para ${normalizedPhone}`);
    }
    return { otpId: body.otpId, code };
  }

  describe("POST /auth/send-otp", () => {
    it("genera un otpId nuevo, cooldown=60, y el SmsProvider recibe un código de 6 dígitos", async () => {
      const { response, body } = await sendOtp("3512220001");

      expect(response.statusCode).toBe(200);
      expect(body.otpId).toEqual(expect.any(String));
      expect(body.cooldownSeconds).toBe(60);

      const code = captor.sentCodes.get("+5493512220001");
      expect(code).toMatch(/^\d{6}$/);
    });

    it("normaliza variantes del teléfono argentino al mismo target E.164", async () => {
      const first = await sendOtp("3512220002");
      // Vencer el cooldown escribiendo lastSentAt viejo directo en Redis, para poder
      // pedir un otp nuevo con otra variante del mismo número sin esperar 60s reales.
      await app.redis.hset(`otp:${first.body.otpId}`, "lastSentAt", String(Date.now() - 61_000));

      const second = await sendOtp("+5493512220002");
      expect(second.response.statusCode).toBe(200);
      expect(captor.sentCodes.has("+5493512220002")).toBe(true);
    });

    it("teléfono con formato inválido devuelve 400 VALIDATION_FAILED", async () => {
      const { response, body } = await sendOtp("123");
      expect(response.statusCode).toBe(400);
      expect((body as unknown as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");
    });

    it("llamado de nuevo dentro del cooldown devuelve el mismo otpId sin mandar un SMS nuevo", async () => {
      const first = await sendOtp("3512220003");
      captor.sendCalls.length = 0;

      const second = await sendOtp("3512220003");

      expect(second.body.otpId).toBe(first.body.otpId);
      expect(second.body.cooldownSeconds).toBeGreaterThan(0);
      expect(second.body.cooldownSeconds).toBeLessThanOrEqual(60);
      expect(captor.sendCalls).toHaveLength(0);
    });

    it("con el cooldown vencido, genera un otpId nuevo e invalida el anterior", async () => {
      const first = await sendOtp("3512220004");
      await app.redis.hset(`otp:${first.body.otpId}`, "lastSentAt", String(Date.now() - 61_000));

      const second = await sendOtp("3512220004");
      expect(second.body.otpId).not.toBe(first.body.otpId);

      const verifyOld = await app.inject({
        method: "POST",
        url: "/auth/verify-otp",
        payload: { otpId: first.body.otpId, code: "000000" },
      });
      expect(verifyOld.statusCode).toBe(422);
      expect(JSON.parse(verifyOld.body).error.code).toBe("AUTH_OTP_EXPIRED");
    });
  });

  describe("POST /auth/verify-otp", () => {
    it("con el código correcto devuelve 200 y un phoneVerificationToken válido", async () => {
      const { otpId, code } = await sendAndCapture("3512220010", "+5493512220010");

      const response = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { otpId, code } });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { phoneVerificationToken: string };
      expect(body.phoneVerificationToken).toEqual(expect.any(String));

      const decoded = jwt.verify(body.phoneVerificationToken, "test-secret", { issuer: "movo" }) as jwt.JwtPayload;
      expect(decoded.sub).toBe("+5493512220010");
      expect(decoded.purpose).toBe("phone_verification");
      expect(decoded.jti).toEqual(expect.any(String));
    });

    it("el código nunca aparece en ningún body de respuesta, ni en éxito ni en error", async () => {
      const { otpId, code } = await sendAndCapture("3512220011", "+5493512220011");

      const ok = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { otpId, code } });
      expect(ok.body).not.toContain(code);

      const { otpId: otpId2, code: code2 } = await sendAndCapture("3512220012", "+5493512220012");
      const wrongCode = code2 === "000000" ? "111111" : "000000";
      const fail = await app.inject({
        method: "POST",
        url: "/auth/verify-otp",
        payload: { otpId: otpId2, code: wrongCode },
      });
      expect(fail.body).not.toContain(code2);
    });

    it("código incorrecto bajo el límite de intentos devuelve 401 AUTH_OTP_INVALID y el otpId sigue sirviendo", async () => {
      const { otpId, code } = await sendAndCapture("3512220013", "+5493512220013");
      const wrongCode = code === "000000" ? "111111" : "000000";

      const wrong = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { otpId, code: wrongCode } });
      expect(wrong.statusCode).toBe(401);
      expect(JSON.parse(wrong.body).error.code).toBe("AUTH_OTP_INVALID");

      const correct = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { otpId, code } });
      expect(correct.statusCode).toBe(200);
    });

    it("5 intentos fallidos seguidos dan 401, y una 6ta llamada con el código correcto real da 422", async () => {
      const { otpId, code } = await sendAndCapture("3512220014", "+5493512220014");
      const wrongCode = code === "000000" ? "111111" : "000000";

      for (let i = 0; i < 5; i++) {
        const attempt = await app.inject({
          method: "POST",
          url: "/auth/verify-otp",
          payload: { otpId, code: wrongCode },
        });
        expect(attempt.statusCode).toBe(401);
        expect(JSON.parse(attempt.body).error.code).toBe("AUTH_OTP_INVALID");
      }

      const sixth = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { otpId, code } });
      expect(sixth.statusCode).toBe(422);
      expect(JSON.parse(sixth.body).error.code).toBe("AUTH_OTP_EXPIRED");
    });

    it("un otpId nunca generado devuelve 422 AUTH_OTP_EXPIRED", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/verify-otp",
        payload: { otpId: "00000000-0000-4000-8000-000000000000", code: "123456" },
      });
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_OTP_EXPIRED");
    });

    it("otpId con formato inválido (no uuid) devuelve 400 VALIDATION_FAILED", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/verify-otp",
        payload: { otpId: "no-es-un-uuid", code: "123456" },
      });
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("code que no son 6 dígitos devuelve 400 VALIDATION_FAILED", async () => {
      const { otpId } = await sendAndCapture("3512220015", "+5493512220015");
      const response = await app.inject({
        method: "POST",
        url: "/auth/verify-otp",
        payload: { otpId, code: "12" },
      });
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("POST /auth/resend-otp", () => {
    it("con el cooldown vencido, genera un código nuevo bajo el mismo otpId", async () => {
      const first = await sendAndCapture("3512220020", "+5493512220020");
      await app.redis.hset(`otp:${first.otpId}`, "lastSentAt", String(Date.now() - 61_000));

      const response = await app.inject({
        method: "POST",
        url: "/auth/resend-otp",
        payload: { otpId: first.otpId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { resentAt: string; cooldownSeconds: number };
      expect(body.cooldownSeconds).toBe(60);
      expect(new Date(body.resentAt).toString()).not.toBe("Invalid Date");

      const newCode = captor.sentCodes.get("+5493512220020");
      expect(newCode).toBeDefined();
      expect(newCode).not.toBe(first.code);
    });

    it("reenvío inmediato (sin vencer el cooldown) devuelve 429 RATE_LIMIT_EXCEEDED", async () => {
      const first = await sendAndCapture("3512220021", "+5493512220021");

      const response = await app.inject({
        method: "POST",
        url: "/auth/resend-otp",
        payload: { otpId: first.otpId },
      });

      expect(response.statusCode).toBe(429);
      expect(JSON.parse(response.body).error.code).toBe("RATE_LIMIT_EXCEEDED");
    });

    it("otpId inexistente/vencido devuelve 422 AUTH_OTP_EXPIRED", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/resend-otp",
        payload: { otpId: "00000000-0000-4000-8000-000000000001" },
      });
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_OTP_EXPIRED");
    });

    it("después de un resend, el código viejo ya no verifica pero el nuevo sí", async () => {
      const first = await sendAndCapture("3512220022", "+5493512220022");
      await app.redis.hset(`otp:${first.otpId}`, "lastSentAt", String(Date.now() - 61_000));

      await app.inject({ method: "POST", url: "/auth/resend-otp", payload: { otpId: first.otpId } });
      const newCode = captor.sentCodes.get("+5493512220022")!;

      const oldAttempt = await app.inject({
        method: "POST",
        url: "/auth/verify-otp",
        payload: { otpId: first.otpId, code: first.code },
      });
      expect(oldAttempt.statusCode).toBe(401);
      expect(JSON.parse(oldAttempt.body).error.code).toBe("AUTH_OTP_INVALID");

      const newAttempt = await app.inject({
        method: "POST",
        url: "/auth/verify-otp",
        payload: { otpId: first.otpId, code: newCode },
      });
      expect(newAttempt.statusCode).toBe(200);
    });

    it("otpId con formato inválido (no uuid) devuelve 400 VALIDATION_FAILED", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/resend-otp",
        payload: { otpId: "no-es-un-uuid" },
      });
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("consumePhoneVerificationToken (casos borde probados directo contra el servicio; el camino feliz vía HTTP se cubre en auth.register.integration.test.ts, MOVO-72)", () => {
    it("consume un token válido una vez; el segundo consumo del mismo token es inválido", async () => {
      const { otpId, code } = await sendAndCapture("3512220030", "+5493512220030");
      const verify = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { otpId, code } });
      const { phoneVerificationToken } = JSON.parse(verify.body) as { phoneVerificationToken: string };

      const { createOtpRepository } = await import("../src/repositories/otp-repository");
      const { createOtpService } = await import("../src/services/otp-service");
      const { createPhoneVerificationService } = await import("../src/modules/auth/phone-verification.service");

      const service = createPhoneVerificationService(
        createOtpService(createOtpRepository(app.redis), captor.provider),
        app.redis,
        "test-secret"
      );

      const firstConsume = await service.consumePhoneVerificationToken(phoneVerificationToken, "3512220030");
      expect(firstConsume.phone).toBe("+5493512220030");

      await expect(
        service.consumePhoneVerificationToken(phoneVerificationToken, "3512220030")
      ).rejects.toMatchObject({ statusCode: 401, code: "AUTH_OTP_INVALID" });
    });

    it("rechaza el token si se lo consume contra un teléfono distinto", async () => {
      const { otpId, code } = await sendAndCapture("3512220031", "+5493512220031");
      const verify = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { otpId, code } });
      const { phoneVerificationToken } = JSON.parse(verify.body) as { phoneVerificationToken: string };

      const { createOtpRepository } = await import("../src/repositories/otp-repository");
      const { createOtpService } = await import("../src/services/otp-service");
      const { createPhoneVerificationService } = await import("../src/modules/auth/phone-verification.service");
      const service = createPhoneVerificationService(
        createOtpService(createOtpRepository(app.redis), captor.provider),
        app.redis,
        "test-secret"
      );

      await expect(
        service.consumePhoneVerificationToken(phoneVerificationToken, "3512229999")
      ).rejects.toMatchObject({ statusCode: 401, code: "AUTH_OTP_INVALID" });
    });

    it("rechaza un token vencido", async () => {
      const expired = jwt.sign(
        { sub: "+5493512220032", purpose: "phone_verification", jti: "jti-expired" },
        "test-secret",
        { expiresIn: "-1s", issuer: "movo" }
      );

      const { createOtpRepository } = await import("../src/repositories/otp-repository");
      const { createOtpService } = await import("../src/services/otp-service");
      const { createPhoneVerificationService } = await import("../src/modules/auth/phone-verification.service");
      const service = createPhoneVerificationService(
        createOtpService(createOtpRepository(app.redis), captor.provider),
        app.redis,
        "test-secret"
      );

      await expect(
        service.consumePhoneVerificationToken(expired, "3512220032")
      ).rejects.toMatchObject({ statusCode: 401, code: "AUTH_OTP_INVALID" });
    });
  });
});
