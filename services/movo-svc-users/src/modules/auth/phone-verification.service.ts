import { randomUUID } from "node:crypto";
import jwt, { JwtPayload } from "jsonwebtoken";
import Redis from "ioredis";
import { ApiError } from "@movo/shared";
import { OtpService } from "../../services/otp-service";
import { normalizePhoneToE164Ar } from "./auth.service";

export const PHONE_VERIFICATION_TOKEN_PURPOSE = "phone_verification" as const;
const PHONE_VERIFICATION_TOKEN_TTL_SECONDS = 15 * 60; // AC3: 15-30 min
const PHONE_VERIFICATION_TOKEN_ISSUER = "movo";

interface PhoneVerificationTokenClaims {
  sub: string;
  purpose: typeof PHONE_VERIFICATION_TOKEN_PURPOSE;
  jti: string;
}

const TOKEN_INVALID_MESSAGE = "El token de verificación de teléfono es inválido, venció o ya fue usado.";

/**
 * Capa específica de teléfono sobre el motor genérico de `otp-service.ts` (que no sabe
 * que `target` es un teléfono, ver ese archivo). Acá viven: la normalización a E.164 y
 * la emisión/consumo del `phoneVerificationToken` que viaja a `POST /auth/register`
 * (MOVO-70).
 */
export interface PhoneVerificationService {
  sendOtp(phone: string): Promise<{ otpId: string; cooldownSeconds: number }>;
  verifyOtp(otpId: string, code: string): Promise<{ phoneVerificationToken: string }>;
  resendOtp(otpId: string): Promise<{ resentAt: string; cooldownSeconds: number }>;
  /**
   * Consumida por MOVO-70 durante el registro (no por esta US): valida firma,
   * propósito, expiración y que el teléfono coincida, y marca el token como usado
   * (single-use — AC6). Cualquier falla mapea al mismo `401 AUTH_OTP_INVALID`, sin
   * distinguir el motivo ("reutilizarlo devuelve AUTH_OTP_INVALID"). Devuelve el `jti`
   * para que el caller pueda "devolver" el uso vía `releasePhoneVerificationToken` si
   * el registro termina fallando por una causa ajena al teléfono.
   */
  consumePhoneVerificationToken(token: string, phone: string): Promise<{ phone: string; jti: string }>;
  /**
   * Revierte el consumo de `consumePhoneVerificationToken` (borra la key
   * `phone-verification-used:{jti}` de Redis) — usada cuando el registro consumió el
   * token pero la creación del usuario falló después, por cualquier motivo ajeno al
   * teléfono: un conflicto de email/teléfono (PR #51, revisión de tmvergara) o un error
   * de DB / de la escritura de la dirección (PR #52, revisión de JcBordino4). Sin esto,
   * un typo en el email —o una caída puntual de la DB— obligaba a rehacer todo el flujo
   * de OTP para reintentar, aunque el teléfono siguiera verificado.
   */
  releasePhoneVerificationToken(jti: string): Promise<void>;
}

export function createPhoneVerificationService(
  otpService: OtpService,
  redis: Redis,
  jwtSecret: string
): PhoneVerificationService {
  return {
    async sendOtp(phone: string) {
      const normalizedPhone = normalizePhoneToE164Ar(phone);
      return otpService.generateOtp(normalizedPhone);
    },

    async verifyOtp(otpId: string, code: string) {
      const { target: phone } = await otpService.verifyOtp(otpId, code);

      const claims: PhoneVerificationTokenClaims = {
        sub: phone,
        purpose: PHONE_VERIFICATION_TOKEN_PURPOSE,
        jti: randomUUID(),
      };
      const phoneVerificationToken = jwt.sign(claims, jwtSecret, {
        expiresIn: PHONE_VERIFICATION_TOKEN_TTL_SECONDS,
        issuer: PHONE_VERIFICATION_TOKEN_ISSUER,
      });

      return { phoneVerificationToken };
    },

    async resendOtp(otpId: string) {
      return otpService.resendOtp(otpId);
    },

    async consumePhoneVerificationToken(token: string, phone: string) {
      let decoded: JwtPayload;
      try {
        const result = jwt.verify(token, jwtSecret, { issuer: PHONE_VERIFICATION_TOKEN_ISSUER });
        if (typeof result === "string") {
          throw new Error("unexpected string payload");
        }
        decoded = result;
      } catch {
        throw new ApiError(401, "AUTH_OTP_INVALID", TOKEN_INVALID_MESSAGE);
      }

      if (decoded.purpose !== PHONE_VERIFICATION_TOKEN_PURPOSE || !decoded.jti || !decoded.exp || !decoded.sub) {
        throw new ApiError(401, "AUTH_OTP_INVALID", TOKEN_INVALID_MESSAGE);
      }

      const normalizedPhone = normalizePhoneToE164Ar(phone);
      if (decoded.sub !== normalizedPhone) {
        throw new ApiError(401, "AUTH_OTP_INVALID", TOKEN_INVALID_MESSAGE);
      }

      // Single-use (AC6): SET NX atómico — si la key ya existía, el token ya fue
      // consumido por un registro anterior. TTL igual al tiempo de vida restante del
      // token, para no acumular keys de "usado" para siempre.
      const remainingTtlSeconds = Math.max(1, decoded.exp - Math.floor(Date.now() / 1000));
      const marked = await redis.set(
        `phone-verification-used:${decoded.jti}`,
        "1",
        "EX",
        remainingTtlSeconds,
        "NX"
      );
      if (marked === null) {
        throw new ApiError(401, "AUTH_OTP_INVALID", TOKEN_INVALID_MESSAGE);
      }

      return { phone: normalizedPhone, jti: decoded.jti };
    },

    async releasePhoneVerificationToken(jti: string) {
      await redis.del(`phone-verification-used:${jti}`);
    },
  };
}
