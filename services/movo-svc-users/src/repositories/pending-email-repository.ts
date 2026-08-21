import Redis from "ioredis";
import { OTP_TTL_SECONDS } from "./otp-repository";

/**
 * MOVO-133: el motor de OTP (`otp-service.ts`) es genérico por `target` -- en el flujo
 * de cambio de email, `target` es siempre el teléfono YA verificado del usuario (el
 * OTP prueba que sigue teniendo acceso a la cuenta, no que es dueño del email nuevo --
 * decisión de refinamiento documentada en `services/movo-svc-users/CLAUDE.md`, no hay
 * `EmailProvider` en el proyecto). El email candidato que el usuario pidió cambiar
 * viaja atado al `otpId` acá, con el mismo TTL que el OTP.
 */
export interface PendingEmailRepository {
  set(otpId: string, email: string): Promise<void>;
  get(otpId: string): Promise<string | null>;
  delete(otpId: string): Promise<void>;
}

export function createPendingEmailRepository(redis: Redis): PendingEmailRepository {
  const key = (otpId: string): string => `email-change-pending:${otpId}`;

  return {
    async set(otpId: string, email: string): Promise<void> {
      await redis.set(key(otpId), email, "EX", OTP_TTL_SECONDS);
    },

    async get(otpId: string): Promise<string | null> {
      return redis.get(key(otpId));
    },

    async delete(otpId: string): Promise<void> {
      await redis.unlink(key(otpId));
    },
  };
}
