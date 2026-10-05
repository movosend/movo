import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { FastifyBaseLogger } from "fastify";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import { hash } from "@node-rs/argon2";
import { AccountStatus, ApiError, KycStatus, UserRole } from "@movo/shared";
import { PrismaClient } from "../src/generated/prisma/client";
import { User, UserConflictError } from "../src/models/user";
import { createUsersService } from "../src/modules/users/users.service";
import { createPasswordResetService, PASSWORD_RESET_TOKEN_PURPOSE } from "../src/modules/auth/password-reset.service";
import { StorageProvider } from "../src/adapters/storage-provider";
import { ShipmentsClient } from "../src/adapters/shipments-client";
import { OtpService } from "../src/services/otp-service";
import { EmailProvider } from "../src/adapters/email-provider";
import { SmsProvider } from "../src/adapters/sms-provider";
import { SessionRepository } from "../src/repositories/session-repository";

/**
 * MOVO-274: push de cuenta y seguridad (contraseña, teléfono, email). Unitario, sin base
 * ni red: el repositorio de usuarios, el de sesiones, Redis, el OTP y los proveedores son
 * fakes. Lo que se verifica es QUÉ se avisa y CUÁNDO (después de persistir, nunca si el
 * cambio falló) y que un push caído no rompe un cambio ya aplicado. Los tests de
 * integración de cada flujo (`users.account-settings`, `users.profile-edit`,
 * `auth.password-reset`) cubren la persistencia contra Postgres real.
 */
const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findByEmail: vi.fn(),
  updatePassword: vi.fn(),
  updatePhone: vi.fn(),
  updateEmail: vi.fn(),
  revokeAllForUser: vi.fn(),
  revokeAccessTokensIssuedBefore: vi.fn(),
  saveRefreshToken: vi.fn(),
}));

vi.mock("../src/repositories/user-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/repositories/user-repository")>()),
  createUserRepository: () => ({
    findById: mocks.findById,
    findByEmail: mocks.findByEmail,
    updatePassword: mocks.updatePassword,
    updatePhone: mocks.updatePhone,
    updateEmail: mocks.updateEmail,
  }),
}));
vi.mock("../src/repositories/session-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/repositories/session-repository")>()),
  createSessionRepository: () => fakeSessionRepository(),
}));

function fakeSessionRepository(): SessionRepository {
  return {
    revokeAllForUser: mocks.revokeAllForUser,
    revokeAccessTokensIssuedBefore: mocks.revokeAccessTokensIssuedBefore,
    saveRefreshToken: mocks.saveRefreshToken,
  } as unknown as SessionRepository;
}

const USER_ID = "user-1";
const OLD_PASSWORD = "ClaveVieja123!";
const NEW_PASSWORD = "ClaveNueva456!";
const JWT_SECRET = "test-secret";

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    email: "ana@example.com",
    phone: "+5493511234567",
    firstName: "Ana",
    lastName: "Gómez",
    passwordHash: "hash",
    dni: null,
    bio: null,
    termsAcceptedAt: null,
    termsVersion: null,
    privacyAcceptedAt: null,
    privacyVersion: null,
    phoneVerified: true,
    emailVerified: true,
    emailVerifiedAt: null,
    photoUrl: null,
    kycStatusIdentity: KycStatus.NOT_STARTED,
    kycStatusLicense: KycStatus.NOT_STARTED,
    status: AccountStatus.ACTIVE,
    bannedUntil: null,
    birthdate: null,
    roles: [UserRole.SENDER],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function fakeRedis() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    incr: vi.fn().mockResolvedValue(1),
    unlink: vi.fn().mockResolvedValue(1),
  } as unknown as Redis;
}

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const PASSWORD_CHANGED = {
  title: "Cambiaste tu contraseña",
  body: "La contraseña de tu cuenta se cambió. Por seguridad, cerramos tus otras sesiones.",
  category: "account_security",
  data: { type: "account_password_changed" },
};

beforeAll(() => {
  process.env.JWT_SECRET = JWT_SECRET;
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
  mocks.revokeAllForUser.mockResolvedValue(undefined);
  mocks.revokeAccessTokensIssuedBefore.mockResolvedValue(undefined);
  mocks.saveRefreshToken.mockResolvedValue(undefined);
});

describe("Push de cuenta y seguridad (MOVO-274)", () => {
  function buildUsersService(options: { verifyOtp?: OtpService["verifyOtp"] } = {}) {
    const logger = fakeLogger();
    const notifications = { sendPushToUser: vi.fn().mockResolvedValue(undefined) };
    const emailProvider: EmailProvider = { send: vi.fn().mockResolvedValue(undefined) } as unknown as EmailProvider;
    const otpService = { verifyOtp: options.verifyOtp ?? vi.fn() } as unknown as OtpService;
    // `findReputation` rechaza a propósito: el perfil que devuelven phone/email degrada a
    // "sin reputación" (AC3 de MOVO-152), sin necesitar svc-shipments.
    const shipmentsClient = { findReputation: vi.fn().mockRejectedValue(new Error("sin svc-shipments")) } as unknown as ShipmentsClient;
    const service = createUsersService(
      {} as unknown as PrismaClient,
      {} as unknown as StorageProvider,
      logger as unknown as FastifyBaseLogger,
      fakeRedis(),
      shipmentsClient,
      otpService,
      emailProvider,
      notifications
    );
    return { service, notifications, logger, emailProvider };
  }

  describe("cambio de contraseña logueado (POST /users/me/password)", () => {
    it("avisa una vez, a todos los dispositivos de la cuenta, con la categoría account_security", async () => {
      const passwordHash = await hash(OLD_PASSWORD, { algorithm: 2 });
      mocks.findById.mockResolvedValue(fakeUser({ passwordHash }));
      mocks.updatePassword.mockResolvedValue(fakeUser({ passwordHash: "nuevo" }));
      const { service, notifications } = buildUsersService();

      const session = await service.changePassword(USER_ID, OLD_PASSWORD, NEW_PASSWORD);

      expect(session.accessToken).toEqual(expect.any(String));
      expect(notifications.sendPushToUser).toHaveBeenCalledTimes(1);
      expect(notifications.sendPushToUser).toHaveBeenCalledWith(USER_ID, PASSWORD_CHANGED);
    });

    it("el push sale DESPUÉS de revocar las sesiones", async () => {
      const passwordHash = await hash(OLD_PASSWORD, { algorithm: 2 });
      mocks.findById.mockResolvedValue(fakeUser({ passwordHash }));
      mocks.updatePassword.mockResolvedValue(fakeUser());
      const { service, notifications } = buildUsersService();

      await service.changePassword(USER_ID, OLD_PASSWORD, NEW_PASSWORD);

      const lastRevoke = Math.max(
        mocks.revokeAllForUser.mock.invocationCallOrder[0] ?? Infinity,
        mocks.revokeAccessTokensIssuedBefore.mock.invocationCallOrder[0] ?? Infinity
      );
      const pushed = notifications.sendPushToUser.mock.invocationCallOrder[0] ?? -Infinity;
      expect(pushed).toBeGreaterThan(lastRevoke);
    });

    it("con la contraseña actual incorrecta no cambia nada y no avisa", async () => {
      const passwordHash = await hash(OLD_PASSWORD, { algorithm: 2 });
      mocks.findById.mockResolvedValue(fakeUser({ passwordHash }));
      const { service, notifications } = buildUsersService();

      await expect(service.changePassword(USER_ID, "otra-clave", NEW_PASSWORD)).rejects.toMatchObject({
        statusCode: 401,
      });

      expect(mocks.updatePassword).not.toHaveBeenCalled();
      expect(notifications.sendPushToUser).not.toHaveBeenCalled();
    });

    it("con una contraseña nueva igual a la actual no cambia nada y no avisa", async () => {
      const passwordHash = await hash(OLD_PASSWORD, { algorithm: 2 });
      mocks.findById.mockResolvedValue(fakeUser({ passwordHash }));
      const { service, notifications } = buildUsersService();

      await expect(service.changePassword(USER_ID, OLD_PASSWORD, OLD_PASSWORD)).rejects.toMatchObject({
        statusCode: 400,
      });

      expect(notifications.sendPushToUser).not.toHaveBeenCalled();
    });

    it("un push caído no rompe el cambio ya aplicado: devuelve la sesión nueva y loguea", async () => {
      const passwordHash = await hash(OLD_PASSWORD, { algorithm: 2 });
      mocks.findById.mockResolvedValue(fakeUser({ passwordHash }));
      mocks.updatePassword.mockResolvedValue(fakeUser());
      const { service, notifications, logger } = buildUsersService();
      notifications.sendPushToUser.mockRejectedValue(new Error("expo caído"));

      const session = await service.changePassword(USER_ID, OLD_PASSWORD, NEW_PASSWORD);

      expect(session.accessToken).toEqual(expect.any(String));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "password_changed_push_failed", userId: USER_ID }),
        expect.any(String)
      );
    });
  });

  describe("cambio de teléfono (paso 2, verificación del OTP)", () => {
    const PHONE_CHANGED = {
      title: "Cambiaste tu teléfono",
      body: "El teléfono de tu cuenta se actualizó correctamente.",
      category: "account_security",
      data: { type: "account_phone_changed" },
    };

    it("avisa una vez después de persistir, sin incluir el número nuevo", async () => {
      const verifyOtp = vi.fn().mockResolvedValue({ target: "+5493517654321", meta: {} });
      mocks.updatePhone.mockResolvedValue(fakeUser({ phone: "+5493517654321" }));
      const { service, notifications } = buildUsersService({ verifyOtp });

      const profile = await service.verifyPhoneChange(USER_ID, "otp-1", "123456");

      expect(profile.phone).toBe("+5493517654321");
      expect(notifications.sendPushToUser).toHaveBeenCalledTimes(1);
      expect(notifications.sendPushToUser).toHaveBeenCalledWith(USER_ID, PHONE_CHANGED);
      const pushed = JSON.stringify(notifications.sendPushToUser.mock.calls[0]);
      expect(pushed).not.toContain("7654321");
    });

    it("si el teléfono ya lo tomó otra cuenta (409), no avisa", async () => {
      const verifyOtp = vi.fn().mockResolvedValue({ target: "+5493517654321", meta: {} });
      mocks.updatePhone.mockRejectedValue(new UserConflictError("phone"));
      const { service, notifications } = buildUsersService({ verifyOtp });

      await expect(service.verifyPhoneChange(USER_ID, "otp-1", "123456")).rejects.toMatchObject({
        statusCode: 409,
        code: "PHONE_ALREADY_IN_USE",
      });

      expect(notifications.sendPushToUser).not.toHaveBeenCalled();
    });

    it("con un OTP inválido no cambia nada y no avisa", async () => {
      const verifyOtp = vi.fn().mockRejectedValue(new ApiError(401, "AUTH_OTP_INVALID", "inválido"));
      const { service, notifications } = buildUsersService({ verifyOtp });

      await expect(service.verifyPhoneChange(USER_ID, "otp-1", "000000")).rejects.toMatchObject({ statusCode: 401 });

      expect(mocks.updatePhone).not.toHaveBeenCalled();
      expect(notifications.sendPushToUser).not.toHaveBeenCalled();
    });

    it("un push caído no rompe el cambio ya aplicado", async () => {
      const verifyOtp = vi.fn().mockResolvedValue({ target: "+5493517654321", meta: {} });
      mocks.updatePhone.mockResolvedValue(fakeUser({ phone: "+5493517654321" }));
      const { service, notifications, logger } = buildUsersService({ verifyOtp });
      notifications.sendPushToUser.mockRejectedValue(new Error("expo caído"));

      await expect(service.verifyPhoneChange(USER_ID, "otp-1", "123456")).resolves.toMatchObject({
        phone: "+5493517654321",
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "phone_changed_push_failed", userId: USER_ID }),
        expect.any(String)
      );
    });
  });

  describe("cambio de email (paso 2, verificación del OTP)", () => {
    const EMAIL_CHANGED = {
      title: "Cambiaste tu email",
      body: "El email de tu cuenta se actualizó correctamente.",
      category: "account_security",
      data: { type: "account_email_changed" },
    };
    const NEW_EMAIL = "nuevo@example.com";

    function otpForNewEmail() {
      return vi.fn().mockResolvedValue({ target: NEW_EMAIL, meta: { pendingEmail: NEW_EMAIL } });
    }

    it("avisa una vez además del mail al email anterior, sin incluir el email nuevo", async () => {
      mocks.findById.mockResolvedValue(fakeUser());
      mocks.findByEmail.mockResolvedValue(null);
      mocks.updateEmail.mockResolvedValue(fakeUser({ email: NEW_EMAIL }));
      const { service, notifications, emailProvider } = buildUsersService({ verifyOtp: otpForNewEmail() });

      const profile = await service.verifyEmailChange(USER_ID, "otp-1", "123456");

      expect(profile.email).toBe(NEW_EMAIL);
      expect(emailProvider.send).toHaveBeenCalledTimes(1);
      expect(notifications.sendPushToUser).toHaveBeenCalledTimes(1);
      expect(notifications.sendPushToUser).toHaveBeenCalledWith(USER_ID, EMAIL_CHANGED);
      expect(JSON.stringify(notifications.sendPushToUser.mock.calls[0])).not.toContain("nuevo@");
    });

    it("si el email ya lo usa otra cuenta (409), no avisa", async () => {
      mocks.findById.mockResolvedValue(fakeUser());
      mocks.findByEmail.mockResolvedValue(fakeUser({ id: "otro-usuario", email: NEW_EMAIL }));
      const { service, notifications } = buildUsersService({ verifyOtp: otpForNewEmail() });

      await expect(service.verifyEmailChange(USER_ID, "otp-1", "123456")).rejects.toMatchObject({
        statusCode: 409,
        code: "EMAIL_ALREADY_IN_USE",
      });

      expect(mocks.updateEmail).not.toHaveBeenCalled();
      expect(notifications.sendPushToUser).not.toHaveBeenCalled();
    });

    it("un fallo del mail al email anterior no impide el push", async () => {
      mocks.findById.mockResolvedValue(fakeUser());
      mocks.findByEmail.mockResolvedValue(null);
      mocks.updateEmail.mockResolvedValue(fakeUser({ email: NEW_EMAIL }));
      const { service, notifications, emailProvider } = buildUsersService({ verifyOtp: otpForNewEmail() });
      (emailProvider.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("resend caído"));

      await service.verifyEmailChange(USER_ID, "otp-1", "123456");

      expect(notifications.sendPushToUser).toHaveBeenCalledTimes(1);
    });

    it("un push caído no rompe el cambio ya aplicado", async () => {
      mocks.findById.mockResolvedValue(fakeUser());
      mocks.findByEmail.mockResolvedValue(null);
      mocks.updateEmail.mockResolvedValue(fakeUser({ email: NEW_EMAIL }));
      const { service, notifications, logger } = buildUsersService({ verifyOtp: otpForNewEmail() });
      notifications.sendPushToUser.mockRejectedValue(new Error("expo caído"));

      await expect(service.verifyEmailChange(USER_ID, "otp-1", "123456")).resolves.toMatchObject({ email: NEW_EMAIL });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "email_changed_push_failed", userId: USER_ID }),
        expect.any(String)
      );
    });
  });

  describe("cambio de contraseña por recuperación (POST /auth/reset-password)", () => {
    function resetToken() {
      return jwt.sign({ sub: USER_ID, purpose: PASSWORD_RESET_TOKEN_PURPOSE, jti: randomUUID() }, JWT_SECRET, {
        expiresIn: 900,
        issuer: "movo",
      });
    }

    function buildResetService(options: { tokenAlreadyUsed?: boolean } = {}) {
      const logger = fakeLogger();
      const notifications = { sendPushToUser: vi.fn().mockResolvedValue(undefined) };
      const sms: SmsProvider = { send: vi.fn(), sendText: vi.fn().mockResolvedValue(undefined) } as unknown as SmsProvider;
      const email: EmailProvider = { send: vi.fn().mockResolvedValue(undefined) } as unknown as EmailProvider;
      const redis = {
        // SET NX: "OK" si el token se canjea por primera vez, null si ya estaba usado.
        set: vi.fn().mockResolvedValue(options.tokenAlreadyUsed ? null : "OK"),
      } as unknown as Redis;
      const service = createPasswordResetService(
        {} as unknown as PrismaClient,
        redis,
        fakeSessionRepository(),
        {} as unknown as OtpService,
        sms,
        email,
        notifications,
        JWT_SECRET,
        logger as unknown as FastifyBaseLogger
      );
      return { service, notifications, logger, sms, email };
    }

    it("avisa una vez, después de revocar las sesiones, junto al SMS y el mail de siempre", async () => {
      mocks.findById.mockResolvedValue(fakeUser());
      mocks.updatePassword.mockResolvedValue(fakeUser());
      const { service, notifications, sms, email } = buildResetService();

      await service.resetPassword(resetToken(), NEW_PASSWORD);

      expect(sms.sendText).toHaveBeenCalledTimes(1);
      expect(email.send).toHaveBeenCalledTimes(1);
      expect(notifications.sendPushToUser).toHaveBeenCalledTimes(1);
      expect(notifications.sendPushToUser).toHaveBeenCalledWith(USER_ID, PASSWORD_CHANGED);
      const lastRevoke = Math.max(
        mocks.revokeAllForUser.mock.invocationCallOrder[0] ?? Infinity,
        mocks.revokeAccessTokensIssuedBefore.mock.invocationCallOrder[0] ?? Infinity
      );
      expect(notifications.sendPushToUser.mock.invocationCallOrder[0] ?? -Infinity).toBeGreaterThan(lastRevoke);
    });

    it("con un token ya usado no cambia nada y no avisa", async () => {
      mocks.findById.mockResolvedValue(fakeUser());
      const { service, notifications } = buildResetService({ tokenAlreadyUsed: true });

      await expect(service.resetPassword(resetToken(), NEW_PASSWORD)).rejects.toMatchObject({ statusCode: 401 });

      expect(mocks.updatePassword).not.toHaveBeenCalled();
      expect(notifications.sendPushToUser).not.toHaveBeenCalled();
    });

    it("una cuenta baneada después de emitir el token no puede canjearlo y no avisa", async () => {
      mocks.findById.mockResolvedValue(fakeUser({ status: AccountStatus.BANNED }));
      const { service, notifications } = buildResetService();

      await expect(service.resetPassword(resetToken(), NEW_PASSWORD)).rejects.toMatchObject({
        statusCode: 403,
        code: "ACCOUNT_SUSPENDED",
      });

      expect(notifications.sendPushToUser).not.toHaveBeenCalled();
    });

    it("un push caído no rompe el cambio ya aplicado (sigue sin lanzar, como los otros avisos)", async () => {
      mocks.findById.mockResolvedValue(fakeUser());
      mocks.updatePassword.mockResolvedValue(fakeUser());
      const { service, notifications, logger } = buildResetService();
      notifications.sendPushToUser.mockRejectedValue(new Error("expo caído"));

      await expect(service.resetPassword(resetToken(), NEW_PASSWORD)).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "password_changed_push_failed", userId: USER_ID }),
        expect.any(String)
      );
    });
  });
});
