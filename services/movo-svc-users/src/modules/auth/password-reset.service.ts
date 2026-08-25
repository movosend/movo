import { randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import jwt, { JwtPayload } from "jsonwebtoken";
import Redis from "ioredis";
import { FastifyBaseLogger } from "fastify";
import { ApiError, AccountStatus } from "@movo/shared";
import { PrismaClient } from "../../generated/prisma/client";
import { createUserRepository } from "../../repositories/user-repository";
import { SessionRepository } from "../../repositories/session-repository";
import { OtpService } from "../../services/otp-service";
import { OtpChannel } from "../../repositories/otp-repository";
import { SmsProvider, buildPasswordChangedMessage } from "../../adapters/sms-provider";
import { EmailProvider, buildPasswordChangedNotice } from "../../adapters/email-provider";
import { normalizePhoneToE164Ar } from "./auth.service";

export const PASSWORD_RESET_TOKEN_PURPOSE = "password_reset" as const;
const PASSWORD_RESET_TOKEN_TTL_SECONDS = 15 * 60; // AC6
const PASSWORD_RESET_TOKEN_ISSUER = "movo";

// MOVO-133: namespacea el índice otp:target:* de esta US aparte de "register" y de los
// flujos de cambio de teléfono/email -- ver otp-service.ts.
const PASSWORD_RESET_OTP_FLOW = "password-reset";

// Mismo mensaje/código que phone-verification.service.ts (AC8: "no reusar el
// phoneVerificationToken de MOVO-71, son propósitos distintos a propósito") -- el
// patrón completo (JWT con purpose+jti, single-use vía SET NX) se copia de ese archivo.
const TOKEN_INVALID_MESSAGE = "El token de recuperación de contraseña es inválido, venció o ya fue usado.";
const OTP_INVALID_MESSAGE = "El código ingresado es inválido o venció.";

// @node-rs/argon2 exporta `Algorithm` como `const enum`, incompatible con
// `isolatedModules` -- mismo motivo que auth.service.ts/otp-service.ts.
const ARGON2ID = 2;

interface PasswordResetTokenClaims {
  sub: string; // userId
  purpose: typeof PASSWORD_RESET_TOKEN_PURPOSE;
  jti: string;
}

export interface PasswordResetService {
  /** AC1-AC5: nunca revela si la cuenta existe -- siempre 200 con el mismo shape. */
  forgotPassword(identifier: string): Promise<{ otpId: string; cooldownSeconds: number; channel: OtpChannel }>;
  /** AC6-AC8: código correcto -> passwordResetToken de un solo uso, 15min TTL. */
  verifyResetOtp(otpId: string, code: string): Promise<{ passwordResetToken: string }>;
  /** AC9-AC13: consume el token, persiste la contraseña, revoca sesiones, avisa. */
  resetPassword(passwordResetToken: string, newPassword: string): Promise<void>;
}

/** AC1: el canal se infiere por el formato del identificador -- el schema (`anyOf`
 * email/teléfono) ya garantizó que matchea uno de los dos antes de llegar acá. */
function detectChannel(identifier: string): OtpChannel {
  return identifier.includes("@") ? "email" : "sms";
}

function normalizeTarget(identifier: string, channel: OtpChannel): string {
  // Mismo criterio que auth.service.ts:181 (AC1): trim + lowercase para email.
  return channel === "email" ? identifier.trim().toLowerCase() : normalizePhoneToE164Ar(identifier);
}

export function createPasswordResetService(
  db: PrismaClient,
  redis: Redis,
  sessionRepository: SessionRepository,
  otpService: OtpService,
  smsProvider: SmsProvider,
  emailProvider: EmailProvider,
  jwtSecret: string,
  logger: FastifyBaseLogger
): PasswordResetService {
  const userRepository = createUserRepository(db);

  return {
    async forgotPassword(identifier: string) {
      const channel = detectChannel(identifier);
      const target = normalizeTarget(identifier, channel);

      // AC4: la consulta a la DB se hace SIEMPRE, antes de decidir señuelo o no --
      // mismo criterio que el DUMMY_HASH de login() (MOVO-74). El costo del hash
      // Argon2id del código ya es idéntico en los dos caminos (otp-service.ts lo hace
      // incondicionalmente); sin esta consulta acá, el camino señuelo sería más
      // rápido y la latencia delataría la cuenta.
      const user = channel === "email" ? await userRepository.findByEmail(target) : await userRepository.findByPhone(target);

      const isEligible =
        !!user &&
        user.status !== AccountStatus.BANNED &&
        user.status !== AccountStatus.DELETED &&
        (channel !== "email" || user.emailVerified);

      // meta.userId es lo que verifyResetOtp necesita para emitir el token -- un
      // señuelo no lleva userId real (no hay cuenta legítima a la que atarlo).
      const meta = isEligible ? { userId: (user as NonNullable<typeof user>).id } : {};

      const { otpId, cooldownSeconds } = await otpService.generateOtp(
        PASSWORD_RESET_OTP_FLOW,
        target,
        meta,
        channel,
        !isEligible
      );

      return { otpId, cooldownSeconds, channel };
    },

    async verifyResetOtp(otpId: string, code: string) {
      const { meta } = await otpService.verifyOtp(otpId, code, PASSWORD_RESET_OTP_FLOW);

      // Inalcanzable en la práctica para un señuelo (el código nunca salió por ningún
      // canal, así que adivinarlo es 1 en un millón por intento, con máximo 5
      // intentos) -- se resuelve igual con el mismo 401 genérico en vez de asumir que
      // no puede pasar.
      const userId = meta.userId;
      if (!userId) {
        throw new ApiError(401, "AUTH_OTP_INVALID", OTP_INVALID_MESSAGE);
      }

      const claims: PasswordResetTokenClaims = {
        sub: userId,
        purpose: PASSWORD_RESET_TOKEN_PURPOSE,
        jti: randomUUID(),
      };
      const passwordResetToken = jwt.sign(claims, jwtSecret, {
        expiresIn: PASSWORD_RESET_TOKEN_TTL_SECONDS,
        issuer: PASSWORD_RESET_TOKEN_ISSUER,
      });

      return { passwordResetToken };
    },

    async resetPassword(passwordResetToken: string, newPassword: string) {
      let decoded: JwtPayload;
      try {
        const result = jwt.verify(passwordResetToken, jwtSecret, { issuer: PASSWORD_RESET_TOKEN_ISSUER });
        if (typeof result === "string") {
          throw new Error("unexpected string payload");
        }
        decoded = result;
      } catch {
        throw new ApiError(401, "AUTH_OTP_INVALID", TOKEN_INVALID_MESSAGE);
      }

      if (decoded.purpose !== PASSWORD_RESET_TOKEN_PURPOSE || !decoded.jti || !decoded.exp || !decoded.sub) {
        throw new ApiError(401, "AUTH_OTP_INVALID", TOKEN_INVALID_MESSAGE);
      }

      const userId = decoded.sub;

      // MOVO-140 (fix de review, Pedro): el token se emite en verifyResetOtp() a
      // partir del estado de la cuenta EN ESE MOMENTO -- nada impide que quede
      // baneada/eliminada entre esa emisión (TTL 15min) y el canje acá. Sin este
      // chequeo, `updatePassword()` no valida `status` (solo hace el UPDATE por id) y
      // el cambio se persistía igual sobre una cuenta suspendida. Mismo criterio que
      // login()/refresh() (MOVO-74/75): usuario inexistente -> 401 genérico (no
      // confirma si la cuenta existió); baneada/eliminada -> 403 ACCOUNT_SUSPENDED.
      const user = await userRepository.findById(userId);
      if (!user) {
        throw new ApiError(401, "AUTH_OTP_INVALID", TOKEN_INVALID_MESSAGE);
      }
      if (user.status === AccountStatus.BANNED || user.status === AccountStatus.DELETED) {
        throw new ApiError(403, "ACCOUNT_SUSPENDED", "La cuenta se encuentra suspendida o inhabilitada.");
      }

      // Single-use (AC9): SET NX atómico, mismo patrón que
      // phone-verification.service.ts#consumePhoneVerificationToken. TTL igual al
      // tiempo de vida restante del token, para no acumular keys de "usado" para
      // siempre.
      const remainingTtlSeconds = Math.max(1, decoded.exp - Math.floor(Date.now() / 1000));
      const marked = await redis.set(`password-reset-used:${decoded.jti}`, "1", "EX", remainingTtlSeconds, "NX");
      if (marked === null) {
        throw new ApiError(401, "AUTH_OTP_INVALID", TOKEN_INVALID_MESSAGE);
      }

      const passwordHash = await hash(newPassword, { algorithm: ARGON2ID });
      const updated = await userRepository.updatePassword(userId, passwordHash);
      if (!updated) {
        // Carrera de baja entre el chequeo de arriba y este UPDATE -- 401 genérico,
        // no 404 (no hay que confirmarle a quien tiene el token que la cuenta ya no existe).
        throw new ApiError(401, "AUTH_OTP_INVALID", TOKEN_INVALID_MESSAGE);
      }

      // AC12: todas las sesiones activas, en todos los dispositivos -- refresh tokens
      // (revokeAllForUser) y access tokens ya emitidos (revokeAccessTokensIssuedBefore,
      // el gateway lo chequea en plugins/auth.ts), mismo mecanismo que
      // users.service.ts#changePassword (MOVO-134).
      await sessionRepository.revokeAllForUser(userId);
      await sessionRepository.revokeAccessTokensIssuedBefore(userId);

      // AC13: aviso por TODOS los canales verificados de la cuenta, no solo el usado
      // para recuperar -- SMS siempre (el teléfono siempre está verificado, se exige
      // al registrarse), email además si emailVerified. Best-effort: se manda después
      // de que el cambio ya está persistido, así que un fallo de entrega no revierte
      // nada ni cambia el 204 -- se loguea y sigue.
      try {
        await smsProvider.sendText(updated.phone, buildPasswordChangedMessage());
      } catch (err) {
        logger.error({ err }, "No se pudo enviar el aviso de contraseña cambiada por SMS");
      }
      if (updated.emailVerified) {
        const { subject, text, html } = buildPasswordChangedNotice();
        try {
          await emailProvider.send(updated.email, subject, { text, html });
        } catch (err) {
          logger.error({ err }, "No se pudo enviar el aviso de contraseña cambiada por email");
        }
      }
    },
  };
}
