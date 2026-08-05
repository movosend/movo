import { randomInt } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { ApiError } from "@movo/shared";
import { OtpRepository, OTP_MAX_ATTEMPTS } from "../repositories/otp-repository";
import { SmsProvider } from "../adapters/sms-provider";

// @node-rs/argon2 exporta `Algorithm` como `const enum`, incompatible con
// `isolatedModules` (mismo motivo que auth.service.ts) — se usa el valor numérico
// de `Algorithm.Argon2id` directamente en vez de importar el enum.
const ARGON2ID = 2;

export const OTP_RESEND_COOLDOWN_SECONDS = 60; // AC5

const OTP_INVALID_OR_EXPIRED_MESSAGE = "El código ingresado es inválido o venció.";

/**
 * Motor genérico de OTP: no sabe que `target` es un teléfono (pedido explícito del
 * ticket, para poder reusarlo a futuro en el reset de contraseña de MOVO-64 sin
 * reescribir esta capa). La semántica de "es un teléfono" vive en
 * `phone-verification.service.ts`, no acá.
 */
export interface OtpService {
  generateOtp(target: string): Promise<{ otpId: string; cooldownSeconds: number }>;
  verifyOtp(otpId: string, code: string): Promise<{ target: string }>;
  resendOtp(otpId: string): Promise<{ resentAt: string; cooldownSeconds: number }>;
}

function generateNumericCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function cooldownSecondsRemaining(lastSentAt: number): number {
  const elapsedSeconds = Math.floor((Date.now() - lastSentAt) / 1000);
  return Math.max(0, OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds);
}

export function createOtpService(otpRepository: OtpRepository, smsProvider: SmsProvider): OtpService {
  return {
    async generateOtp(target: string) {
      // Dentro del cooldown de un OTP ya activo para este target, no se manda un SMS
      // nuevo ni se pisa el otpId — se devuelve el mismo otpId + cooldown restante.
      // Sin esto, llamar generateOtp en loop sería un bypass trivial del cooldown de
      // resendOtp (ver plan, punto 6: generateOtp nunca devuelve 429, solo resendOtp).
      const activeOtpId = await otpRepository.findActiveIdByTarget(target);
      if (activeOtpId) {
        const activeRecord = await otpRepository.findById(activeOtpId);
        if (activeRecord) {
          const remaining = cooldownSecondsRemaining(activeRecord.lastSentAt);
          if (remaining > 0) {
            return { otpId: activeOtpId, cooldownSeconds: remaining };
          }
        }
      }

      const code = generateNumericCode();
      const codeHash = await hash(code, { algorithm: ARGON2ID });
      const { otpId } = await otpRepository.create(target, codeHash);
      await smsProvider.send(target, code);

      return { otpId, cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS };
    },

    async verifyOtp(otpId: string, code: string) {
      const record = await otpRepository.findById(otpId);
      if (!record) {
        // Nunca existió, TTL vencido, ya usado, o ya invalidado por agotar intentos:
        // todos indistinguibles desde acá, todos mapean a "vencido" (AC6/AC3).
        throw new ApiError(422, "AUTH_OTP_EXPIRED", OTP_INVALID_OR_EXPIRED_MESSAGE);
      }

      const matches = await verify(record.codeHash, code);
      if (!matches) {
        const attempts = await otpRepository.incrementAttempts(otpId);
        if (attempts === null) {
          // La key expiró en la ventana entre el findById de arriba y este incremento.
          throw new ApiError(422, "AUTH_OTP_EXPIRED", OTP_INVALID_OR_EXPIRED_MESSAGE);
        }
        if (attempts >= OTP_MAX_ATTEMPTS) {
          // AC4: agotado el límite, el código se invalida — hay que pedir uno nuevo.
          await otpRepository.invalidate(otpId);
        }
        throw new ApiError(401, "AUTH_OTP_INVALID", OTP_INVALID_OR_EXPIRED_MESSAGE);
      }

      // Un solo uso: se invalida apenas se consume con éxito.
      await otpRepository.invalidate(otpId);
      return { target: record.target };
    },

    async resendOtp(otpId: string) {
      const record = await otpRepository.findById(otpId);
      if (!record) {
        throw new ApiError(422, "AUTH_OTP_EXPIRED", OTP_INVALID_OR_EXPIRED_MESSAGE);
      }

      const remaining = cooldownSecondsRemaining(record.lastSentAt);
      if (remaining > 0) {
        throw new ApiError(429, "RATE_LIMIT_EXCEEDED", `Esperá ${remaining}s antes de pedir un código nuevo.`);
      }

      // El código nunca se guarda en claro (AC2): el texto plano original ya no existe
      // en ningún lado, así que "reenviar" significa generar y mandar uno nuevo bajo el
      // mismo otpId (ver plan, punto 3).
      const code = generateNumericCode();
      const codeHash = await hash(code, { algorithm: ARGON2ID });
      await otpRepository.rotateCode(otpId, codeHash);
      await smsProvider.send(record.target, code);

      return { resentAt: new Date().toISOString(), cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS };
    },
  };
}
