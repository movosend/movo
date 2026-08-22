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
 *
 * MOVO-133 (review de tmvergara sobre PR #91, ambos flujos de cambio de teléfono/
 * email): `flow` namespacea el par (otpId, target) por caso de uso -- sin esto, dos
 * flujos sobre el mismo target se pisaban entre sí (ej. `/auth/send-otp`, pública, y
 * un cambio de teléfono/email autenticado sobre el mismo número). `verifyOtp` exige
 * el flujo esperado y rechaza cualquier otro sin tocar el OTP -- si el mismatch fuera
 * "un usuario contestó el paso 2 equivocado", el OTP real sigue vivo para su flujo
 * verdadero en vez de quedar consumido/invalidado por el intento fallido.
 */
export interface OtpService {
  generateOtp(
    flow: string,
    target: string,
    meta?: Record<string, string>
  ): Promise<{ otpId: string; cooldownSeconds: number; sent: boolean }>;
  verifyOtp(otpId: string, code: string, flow: string): Promise<{ target: string; meta: Record<string, string> }>;
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
    async generateOtp(flow: string, target: string, meta: Record<string, string> = {}) {
      // Dentro del cooldown de un OTP ya activo para este (flow, target), no se manda
      // un SMS nuevo ni se pisa el otpId — se devuelve el mismo otpId + cooldown
      // restante. Sin esto, llamar generateOtp en loop sería un bypass trivial del
      // cooldown de resendOtp (ver plan, punto 6: generateOtp nunca devuelve 429,
      // solo resendOtp). `sent:false` (MOVO-133) le da al caller forma de distinguir
      // "mandé un código nuevo" de "reusá el que ya tenés" -- antes ambos casos
      // devolvían la misma forma y el mobile no podía mostrar un mensaje honesto.
      const activeOtpId = await otpRepository.findActiveIdByTarget(flow, target);
      if (activeOtpId) {
        const activeRecord = await otpRepository.findById(activeOtpId);
        if (activeRecord) {
          const remaining = cooldownSecondsRemaining(activeRecord.lastSentAt);
          if (remaining > 0) {
            // La metadata puede haber cambiado respecto de la que generó este OTP
            // (ej. el usuario pidió el cambio de email a una dirección distinta
            // mientras el OTP anterior seguía en cooldown) -- se actualiza igual,
            // sin mandar SMS ni pisar el otpId/código.
            await otpRepository.setMeta(activeOtpId, meta);
            return { otpId: activeOtpId, cooldownSeconds: remaining, sent: false };
          }
        }
      }

      const code = generateNumericCode();
      const codeHash = await hash(code, { algorithm: ARGON2ID });
      const { otpId } = await otpRepository.create(flow, target, codeHash, meta);
      await smsProvider.send(target, code);

      return { otpId, cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS, sent: true };
    },

    async verifyOtp(otpId: string, code: string, flow: string) {
      const record = await otpRepository.findById(otpId);
      if (!record) {
        // Nunca existió, TTL vencido, ya usado, o ya invalidado por agotar intentos:
        // todos indistinguibles desde acá, todos mapean a "vencido" (AC6/AC3).
        throw new ApiError(422, "AUTH_OTP_EXPIRED", OTP_INVALID_OR_EXPIRED_MESSAGE);
      }

      if (record.flow !== flow) {
        // Este otpId es real, pero para OTRO flujo (ver docstring de la interfaz) --
        // no se toca ni el contador de intentos ni la invalidación: sigue siendo
        // válido para su flujo verdadero, esto no cuenta como un intento fallido de
        // adivinar el código.
        throw new ApiError(401, "AUTH_OTP_INVALID", OTP_INVALID_OR_EXPIRED_MESSAGE);
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
      return { target: record.target, meta: record.meta };
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
