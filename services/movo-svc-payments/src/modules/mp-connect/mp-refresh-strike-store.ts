import { createHash } from "node:crypto";
import type Redis from "ioredis";

/** Cuánto se recuerda un `invalid_grant`: de sobra para cubrir la corrida horaria siguiente. */
export const MP_REFRESH_STRIKE_TTL_SECONDS = 7 * 24 * 60 * 60;

const strikeKey = (userId: string) => `mp_refresh_invalid_grant:${userId}`;

/**
 * MOVO-243: `invalid_grant` también aparece cuando otra corrida o réplica ya canjeó el
 * `refresh_token` (no solo cuando el transportista revocó el acceso). Para no marcar
 * revocada una cuenta sana, hace falta ver el MISMO token rechazado en dos corridas
 * seguidas: si en el medio otra corrida lo rotó, el token cambia y el conteo arranca de
 * cero. Estado en Redis (sin migración); si se pierde, solo se necesita un rechazo más.
 */
export interface RefreshStrikeStore {
  /**
   * Registra un `invalid_grant` sobre el token `version`. Devuelve 1 la primera vez y 2 si
   * ya se había registrado el mismo token (confirmado: corresponde revocar).
   */
  strike(userId: string, version: string): Promise<1 | 2>;
  clear(userId: string): Promise<void>;
}

export function createRefreshStrikeStore(redis: Redis): RefreshStrikeStore {
  // Se guarda un hash del token cifrado, nunca el token ni el cifrado en sí.
  const fingerprint = (version: string) => createHash("sha256").update(version).digest("hex");
  return {
    async strike(userId, version) {
      const fp = fingerprint(version);
      if ((await redis.get(strikeKey(userId))) === fp) return 2;
      await redis.set(strikeKey(userId), fp, "EX", MP_REFRESH_STRIKE_TTL_SECONDS);
      return 1;
    },
    async clear(userId) {
      await redis.del(strikeKey(userId));
    },
  };
}
