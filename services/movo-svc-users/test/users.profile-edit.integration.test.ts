import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole, KycStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";
import { SmsProvider } from "../src/adapters/sms-provider";
import { EmailBody, EmailProvider } from "../src/adapters/email-provider";

function createCaptorSmsProvider() {
  const sentCodes = new Map<string, string>();
  const provider: SmsProvider = {
    async send(toE164: string, code: string): Promise<void> {
      sentCodes.set(toE164, code);
    },
  };
  return { provider, sentCodes };
}

/** MOVO-139: mismo patrón que el captor de SMS -- el código nunca sale por HTTP, así
 * que los tests lo leen del mail que habría salido. `messages` guarda todo lo enviado
 * (incluido el aviso al email anterior, que no lleva código). */
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

describe("PATCH /users/me y cambio verificado de teléfono/email (MOVO-133)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;
  let captor: ReturnType<typeof createCaptorSmsProvider>;
  let emailCaptor: ReturnType<typeof createCaptorEmailProvider>;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    captor = createCaptorSmsProvider();
    emailCaptor = createCaptorEmailProvider();
    app = buildApp({ smsProvider: captor.provider, emailProvider: emailCaptor.provider });
    await app.ready();
    repo = createUserRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
    captor.sentCodes.clear();
    emailCaptor.sentCodes.clear();
    emailCaptor.messages.length = 0;

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
    return `+549351${(2000000 + phoneCounter).toString().padStart(7, "0")}`;
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

  describe("PATCH /users/me", () => {
    it("AC1: actualiza nombre y apellido y devuelve el PrivateProfile actualizado", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "PATCH",
        url: "/users/me",
        headers: { "x-user-id": user.id },
        payload: { firstName: "Juan Cruz", lastName: "Bordino" },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.firstName).toBe("Juan Cruz");
      expect(body.lastName).toBe("Bordino");
      expect(body.fullName).toBe("Juan Cruz Bordino");
    });

    it("acepta actualizar un solo campo", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "PATCH",
        url: "/users/me",
        headers: { "x-user-id": user.id },
        payload: { firstName: "Solonombre" },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.firstName).toBe("Solonombre");
      expect(body.lastName).toBe("Ariza");
    });

    it("AC2: email/phone/kycStatus/roles/photoUrl en el body -> 400 VALIDATION_FAILED, sin efecto", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "PATCH",
        url: "/users/me",
        headers: { "x-user-id": user.id },
        payload: { firstName: "Nuevo", email: "otro@movo.test" },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");

      const reloaded = await repo.findById(user.id);
      expect(reloaded?.firstName).toBe("Alena");
      expect(reloaded?.email).toBe(user.email);
    });

    it("body vacío {} -> 400 (nada que actualizar)", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "PATCH",
        url: "/users/me",
        headers: { "x-user-id": user.id },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("AC3: con kyc_status_identity=approved, un nombre distinto -> 409 PROFILE_NAME_LOCKED_BY_KYC", async () => {
      const user = await repo.create(buildInput());
      await repo.updateKycStatusIdentity(user.id, KycStatus.APPROVED);

      const response = await app.inject({
        method: "PATCH",
        url: "/users/me",
        headers: { "x-user-id": user.id },
        payload: { firstName: "Otro Nombre" },
      });

      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error.code).toBe("PROFILE_NAME_LOCKED_BY_KYC");

      const reloaded = await repo.findById(user.id);
      expect(reloaded?.firstName).toBe("Alena");
    });

    it("con kyc_status_identity=approved, reenviar el mismo nombre no tira 409 (no es un cambio)", async () => {
      const user = await repo.create(buildInput());
      await repo.updateKycStatusIdentity(user.id, KycStatus.APPROVED);

      const response = await app.inject({
        method: "PATCH",
        url: "/users/me",
        headers: { "x-user-id": user.id },
        payload: { firstName: "Alena", lastName: "Ariza" },
      });

      expect(response.statusCode).toBe(200);
    });

    it("devuelve 401 AUTH_TOKEN_INVALID sin header x-user-id", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/users/me",
        payload: { firstName: "Juan" },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_TOKEN_INVALID");
    });

    it("MOVO-133 (fix de review): firstName/lastName sin cota superior -> 400 con más de 80 caracteres", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "PATCH",
        url: "/users/me",
        headers: { "x-user-id": user.id },
        payload: { firstName: "a".repeat(81) },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");

      const reloaded = await repo.findById(user.id);
      expect(reloaded?.firstName).toBe("Alena");
    });

    it("firstName de exactamente 80 caracteres sí se acepta (límite inclusivo)", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "PATCH",
        url: "/users/me",
        headers: { "x-user-id": user.id },
        payload: { firstName: "a".repeat(80) },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("Cambio de teléfono (POST /users/me/phone/change/otp y /verify)", () => {
    async function requestPhoneChange(userId: string, phone: string) {
      const response = await app.inject({
        method: "POST",
        url: "/users/me/phone/change/otp",
        headers: { "x-user-id": userId },
        payload: { phone },
      });
      return { response, body: JSON.parse(response.body) };
    }

    it("AC4: sin verificar el OTP no modifica nada; verificado, actualiza phone y phoneVerified=true", async () => {
      const user = await repo.create(buildInput());
      const newPhone = nextPhone();

      const { response: otpResponse, body: otpBody } = await requestPhoneChange(user.id, newPhone);
      expect(otpResponse.statusCode).toBe(200);

      const reloadedBeforeVerify = await repo.findById(user.id);
      expect(reloadedBeforeVerify?.phone).toBe(user.phone);

      const code = captor.sentCodes.get(newPhone);
      expect(code).toMatch(/^\d{6}$/);

      const verifyResponse = await app.inject({
        method: "POST",
        url: "/users/me/phone/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: otpBody.otpId, code },
      });

      expect(verifyResponse.statusCode).toBe(200);
      const body = JSON.parse(verifyResponse.body);
      expect(body.phone).toBe(newPhone);

      const reloaded = await repo.findById(user.id);
      expect(reloaded?.phone).toBe(newPhone);
      expect(reloaded?.phoneVerified).toBe(true);
    });

    it("el teléfono nuevo es igual al actual -> 400", async () => {
      const user = await repo.create(buildInput());

      const { response } = await requestPhoneChange(user.id, user.phone);
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("AC5 paso 1: teléfono que ya pertenece a otro usuario -> 409 PHONE_ALREADY_IN_USE", async () => {
      const user = await repo.create(buildInput());
      const other = await repo.create(buildInput());

      const { response } = await requestPhoneChange(user.id, other.phone);
      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error.code).toBe("PHONE_ALREADY_IN_USE");
    });

    it("AC5 paso 2: la colisión aparece recién al verificar -> 409 PHONE_ALREADY_IN_USE, no 500", async () => {
      const user = await repo.create(buildInput());
      const other = await repo.create(buildInput());
      const contestedPhone = nextPhone();

      const { body: otpBody } = await requestPhoneChange(user.id, contestedPhone);
      const code = captor.sentCodes.get(contestedPhone);

      // La colisión aparece recién ahora, después del paso 1 de `user`.
      await repo.updatePhone(other.id, contestedPhone);

      const verifyResponse = await app.inject({
        method: "POST",
        url: "/users/me/phone/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: otpBody.otpId, code },
      });

      expect(verifyResponse.statusCode).toBe(409);
      expect(JSON.parse(verifyResponse.body).error.code).toBe("PHONE_ALREADY_IN_USE");
    });

    it("AC6: código inválido -> 401 AUTH_OTP_INVALID, el cooldown de reenvío sigue aplicando", async () => {
      const user = await repo.create(buildInput());
      const newPhone = nextPhone();

      const { body: otpBody } = await requestPhoneChange(user.id, newPhone);
      const code = captor.sentCodes.get(newPhone)!;
      const wrongCode = code === "000000" ? "111111" : "000000";

      const wrong = await app.inject({
        method: "POST",
        url: "/users/me/phone/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: otpBody.otpId, code: wrongCode },
      });
      expect(wrong.statusCode).toBe(401);
      expect(JSON.parse(wrong.body).error.code).toBe("AUTH_OTP_INVALID");

      const resend = await app.inject({
        method: "POST",
        url: "/auth/resend-otp",
        payload: { otpId: otpBody.otpId },
      });
      expect(resend.statusCode).toBe(429);
    });

    it("otpId vencido/inexistente -> 422 AUTH_OTP_EXPIRED", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "POST",
        url: "/users/me/phone/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: "00000000-0000-4000-8000-000000000099", code: "123456" },
      });

      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_OTP_EXPIRED");
    });

    it("AC6: reusar un otpId/code ya verificado con éxito -> 422 AUTH_OTP_EXPIRED, no aplica dos veces", async () => {
      const user = await repo.create(buildInput());
      const newPhone = nextPhone();

      const { body: otpBody } = await requestPhoneChange(user.id, newPhone);
      const code = captor.sentCodes.get(newPhone)!;

      const first = await app.inject({
        method: "POST",
        url: "/users/me/phone/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: otpBody.otpId, code },
      });
      expect(first.statusCode).toBe(200);

      const reused = await app.inject({
        method: "POST",
        url: "/users/me/phone/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: otpBody.otpId, code },
      });
      expect(reused.statusCode).toBe(422);
      expect(JSON.parse(reused.body).error.code).toBe("AUTH_OTP_EXPIRED");

      const reloaded = await repo.findById(user.id);
      expect(reloaded?.phone).toBe(newPhone);
    });

    it("AC7: exige JWT -> 401 sin header x-user-id", async () => {
      const otpResponse = await app.inject({
        method: "POST",
        url: "/users/me/phone/change/otp",
        payload: { phone: nextPhone() },
      });
      expect(otpResponse.statusCode).toBe(401);

      const verifyResponse = await app.inject({
        method: "POST",
        url: "/users/me/phone/change/verify",
        payload: { otpId: randomUUID(), code: "123456" },
      });
      expect(verifyResponse.statusCode).toBe(401);
    });
  });

  describe("Cambio de email (POST /users/me/email/change/otp y /verify)", () => {
    async function requestEmailChange(userId: string, email: string) {
      const response = await app.inject({
        method: "POST",
        url: "/users/me/email/change/otp",
        headers: { "x-user-id": userId },
        payload: { email },
      });
      return { response, body: JSON.parse(response.body) };
    }

    it("MOVO-139 AC4: verifica el OTP mandado al email NUEVO y persiste email + emailVerified juntos", async () => {
      const user = await repo.create(buildInput());
      const newEmail = `nuevo-${randomUUID()}@movo.test`;

      const { response: otpResponse, body: otpBody } = await requestEmailChange(user.id, newEmail);
      expect(otpResponse.statusCode).toBe(200);

      // El código va al email nuevo, no al teléfono actual (corrección de MOVO-133).
      expect(captor.sentCodes.get(user.phone)).toBeUndefined();
      const code = emailCaptor.sentCodes.get(newEmail);
      expect(code).toMatch(/^\d{6}$/);

      const reloadedBeforeVerify = await repo.findById(user.id);
      expect(reloadedBeforeVerify?.email).toBe(user.email);

      const verifyResponse = await app.inject({
        method: "POST",
        url: "/users/me/email/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: otpBody.otpId, code },
      });

      expect(verifyResponse.statusCode).toBe(200);
      const body = JSON.parse(verifyResponse.body);
      expect(body.email).toBe(newEmail);
      expect(body.emailVerified).toBe(true);

      const reloaded = await repo.findById(user.id);
      expect(reloaded?.email).toBe(newEmail);
      expect(reloaded?.emailVerified).toBe(true);
      expect(reloaded?.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it("MOVO-139 AC5: el cambio dispara un aviso al email ANTERIOR", async () => {
      const user = await repo.create(buildInput());
      const previousEmail = user.email;
      const newEmail = `nuevo-${randomUUID()}@movo.test`;

      const { body: otpBody } = await requestEmailChange(user.id, newEmail);
      const code = emailCaptor.sentCodes.get(newEmail)!;

      const verifyResponse = await app.inject({
        method: "POST",
        url: "/users/me/email/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: otpBody.otpId, code },
      });
      expect(verifyResponse.statusCode).toBe(200);

      const notice = emailCaptor.messages.find((m) => m.to === previousEmail);
      expect(notice).toBeDefined();
      expect(notice!.subject).toMatch(/email/i);
      // La dirección nueva viaja enmascarada: el aviso va a una casilla que ya no
      // pertenece a la cuenta.
      expect(notice!.body.text).not.toContain(newEmail);
    });

    it("MOVO-139: un fallo al notificar al email anterior no revierte el cambio ya persistido", async () => {
      const user = await repo.create(buildInput());
      const previousEmail = user.email;
      const newEmail = `nuevo-${randomUUID()}@movo.test`;

      const { body: otpBody } = await requestEmailChange(user.id, newEmail);
      const code = emailCaptor.sentCodes.get(newEmail)!;

      const originalSend = emailCaptor.provider.send;
      emailCaptor.provider.send = async (to, subject, body) => {
        if (to === previousEmail) {
          throw new Error("Resend caído");
        }
        await originalSend(to, subject, body);
      };

      try {
        const verifyResponse = await app.inject({
          method: "POST",
          url: "/users/me/email/change/verify",
          headers: { "x-user-id": user.id },
          payload: { otpId: otpBody.otpId, code },
        });
        expect(verifyResponse.statusCode).toBe(200);
      } finally {
        emailCaptor.provider.send = originalSend;
      }

      const reloaded = await repo.findById(user.id);
      expect(reloaded?.email).toBe(newEmail);
    });

    it("MOVO-133 (fix de review, TTL desync): un código reenviado sigue viendo el email pendiente correcto", async () => {
      // Regresión del bug real: antes, el email candidato vivía en una key Redis
      // paralela (`email-change-pending:{otpId}`) con su propio TTL fijo al `create()`
      // original -- un reenvío (POST /auth/resend-otp, público) refrescaba el TTL del
      // OTP pero nunca el de esa key paralela. Ahora el email candidato es metadata
      // del propio hash `otp:{otpId}` (mismo TTL, se refresca junto con el código en
      // cada reenvío) -- no hay dos lifetimes que puedan desincronizarse.
      const user = await repo.create(buildInput());
      const newEmail = `nuevo-${randomUUID()}@movo.test`;

      const { body: otpBody } = await requestEmailChange(user.id, newEmail);

      // Vence el cooldown de reenvío sin esperar 60s reales (mismo patrón que el resto
      // de la suite) y reenvía -- esto rota el código bajo el mismo otpId.
      await app.redis.hset(`otp:${otpBody.otpId}`, "lastSentAt", String(Date.now() - 61_000));
      const resend = await app.inject({ method: "POST", url: "/auth/resend-otp", payload: { otpId: otpBody.otpId } });
      expect(resend.statusCode).toBe(200);

      // AC7 de MOVO-139: el reenvío sale por el canal persistido en el registro
      // (email), no por SMS -- `resendOtp` solo recibe el otpId.
      const resentCode = emailCaptor.sentCodes.get(newEmail)!;
      expect(resentCode).toMatch(/^\d{6}$/);
      expect(captor.sentCodes.get(user.phone)).toBeUndefined();

      const verifyResponse = await app.inject({
        method: "POST",
        url: "/users/me/email/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: otpBody.otpId, code: resentCode },
      });

      expect(verifyResponse.statusCode).toBe(200);
      expect(JSON.parse(verifyResponse.body).email).toBe(newEmail);
    });

    it("el email nuevo es igual al actual (case-insensitive) -> 400", async () => {
      const user = await repo.create(buildInput({ email: "Fijo@Movo.test" }));

      const { response } = await requestEmailChange(user.id, "fijo@movo.test");
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("AC5 paso 1: email que ya pertenece a otro usuario (case-insensitive) -> 409 EMAIL_ALREADY_IN_USE", async () => {
      const other = await repo.create(buildInput({ email: "Existente@Movo.test" }));
      const user = await repo.create(buildInput());

      const { response } = await requestEmailChange(user.id, "existente@movo.test");
      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error.code).toBe("EMAIL_ALREADY_IN_USE");
    });

    it("AC5 paso 2: la colisión aparece recién al verificar -> 409 EMAIL_ALREADY_IN_USE, no 500", async () => {
      const user = await repo.create(buildInput());
      const other = await repo.create(buildInput());
      const contestedEmail = `contested-${randomUUID()}@movo.test`;

      const { body: otpBody } = await requestEmailChange(user.id, contestedEmail);
      const code = emailCaptor.sentCodes.get(contestedEmail);

      await repo.updateEmail(other.id, contestedEmail);

      const verifyResponse = await app.inject({
        method: "POST",
        url: "/users/me/email/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: otpBody.otpId, code },
      });

      expect(verifyResponse.statusCode).toBe(409);
      expect(JSON.parse(verifyResponse.body).error.code).toBe("EMAIL_ALREADY_IN_USE");
    });

    it("AC6: código inválido -> 401 AUTH_OTP_INVALID", async () => {
      const user = await repo.create(buildInput());
      const newEmail = `nuevo-${randomUUID()}@movo.test`;

      const { body: otpBody } = await requestEmailChange(user.id, newEmail);
      const code = emailCaptor.sentCodes.get(newEmail)!;
      const wrongCode = code === "000000" ? "111111" : "000000";

      const response = await app.inject({
        method: "POST",
        url: "/users/me/email/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: otpBody.otpId, code: wrongCode },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_OTP_INVALID");
    });

    it("AC6: reusar un otpId/code ya verificado con éxito -> 422 AUTH_OTP_EXPIRED, no aplica dos veces", async () => {
      const user = await repo.create(buildInput());
      const newEmail = `nuevo-${randomUUID()}@movo.test`;

      const { body: otpBody } = await requestEmailChange(user.id, newEmail);
      const code = emailCaptor.sentCodes.get(newEmail)!;

      const first = await app.inject({
        method: "POST",
        url: "/users/me/email/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: otpBody.otpId, code },
      });
      expect(first.statusCode).toBe(200);

      const reused = await app.inject({
        method: "POST",
        url: "/users/me/email/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: otpBody.otpId, code },
      });
      expect(reused.statusCode).toBe(422);
      expect(JSON.parse(reused.body).error.code).toBe("AUTH_OTP_EXPIRED");

      const reloaded = await repo.findById(user.id);
      expect(reloaded?.email).toBe(newEmail);
    });

    it("otpId vencido/inexistente -> 422 AUTH_OTP_EXPIRED", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "POST",
        url: "/users/me/email/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: "00000000-0000-4000-8000-000000000098", code: "123456" },
      });

      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_OTP_EXPIRED");
    });

    it("AC7: exige JWT -> 401 sin header x-user-id", async () => {
      const otpResponse = await app.inject({
        method: "POST",
        url: "/users/me/email/change/otp",
        payload: { email: `nuevo-${randomUUID()}@movo.test` },
      });
      expect(otpResponse.statusCode).toBe(401);

      const verifyResponse = await app.inject({
        method: "POST",
        url: "/users/me/email/change/verify",
        payload: { otpId: randomUUID(), code: "123456" },
      });
      expect(verifyResponse.statusCode).toBe(401);
    });
  });

  describe("Namespacing de OTP por flujo (MOVO-133, fix de review sobre PR #91)", () => {
    it("un OTP real de cambio de email no sirve para confirmar un cambio de teléfono (ni al revés)", async () => {
      // Escenario de tmvergara: el usuario arranca un cambio de email (OTP al email
      // nuevo desde MOVO-139) y, por confusión de pantalla/reintento del cliente, ese
      // otpId+code termina posteado contra /me/phone/change/verify. Antes de este fix,
      // el endpoint aceptaba cualquier OTP válido sin chequear para qué flujo se
      // emitió -- "cambiaba" el teléfono al mismo que la cuenta ya tenía y consumía en
      // el camino el OTP real del cambio de email, dejándolo muerto sin retorno.
      const user = await repo.create(buildInput());
      const newEmail = `nuevo-${randomUUID()}@movo.test`;

      const emailOtpResponse = await app.inject({
        method: "POST",
        url: "/users/me/email/change/otp",
        headers: { "x-user-id": user.id },
        payload: { email: newEmail },
      });
      const emailOtpBody = JSON.parse(emailOtpResponse.body);
      const code = emailCaptor.sentCodes.get(newEmail)!;

      const misroutedVerify = await app.inject({
        method: "POST",
        url: "/users/me/phone/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: emailOtpBody.otpId, code },
      });
      expect(misroutedVerify.statusCode).toBe(401);
      expect(JSON.parse(misroutedVerify.body).error.code).toBe("AUTH_OTP_INVALID");

      // El teléfono no cambió, y el OTP real del cambio de email sigue vivo -- el
      // mismatch de flujo no lo tocó (ni intentos, ni invalidación).
      const reloaded = await repo.findById(user.id);
      expect(reloaded?.phone).toBe(user.phone);

      const correctVerify = await app.inject({
        method: "POST",
        url: "/users/me/email/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: emailOtpBody.otpId, code },
      });
      expect(correctVerify.statusCode).toBe(200);
      expect(JSON.parse(correctVerify.body).email).toBe(newEmail);
    });

    it("un tercero sin autenticar no puede invalidar el OTP de cambio de teléfono de otro usuario llamando a POST /auth/send-otp con el mismo número", async () => {
      // Antes del namespacing por flujo, `otp-repository.ts#create` invalidaba
      // cualquier OTP previo para el mismo target sin importar quién lo pidió --
      // POST /auth/send-otp es pública y solo necesita el número. Repetible contra
      // cualquier cuenta cuyo teléfono nuevo (todavía no registrado por nadie) se
      // conozca.
      const user = await repo.create(buildInput());
      const newPhone = nextPhone();

      const phoneOtpResponse = await app.inject({
        method: "POST",
        url: "/users/me/phone/change/otp",
        headers: { "x-user-id": user.id },
        payload: { phone: newPhone },
      });
      const phoneOtpBody = JSON.parse(phoneOtpResponse.body);
      const code = captor.sentCodes.get(newPhone)!;

      // El "tercero" pide un OTP público para ese mismo número -- distinto flujo
      // ("register"), no debería tocar el OTP de cambio de teléfono de `user`.
      const publicSend = await app.inject({ method: "POST", url: "/auth/send-otp", payload: { phone: newPhone } });
      expect(publicSend.statusCode).toBe(200);

      const verifyResponse = await app.inject({
        method: "POST",
        url: "/users/me/phone/change/verify",
        headers: { "x-user-id": user.id },
        payload: { otpId: phoneOtpBody.otpId, code },
      });
      expect(verifyResponse.statusCode).toBe(200);
      expect(JSON.parse(verifyResponse.body).phone).toBe(newPhone);
    });
  });
});
