import type Redis from "ioredis";

/**
 * Dedupe de avisos push con `SET NX` en Redis: un solo lugar para el prefijo `notified:` y la
 * convención de TTL en segundos, compartido por los barridos y la saga de pagos (antes cada uno
 * copiaba el par set/del a mano).
 */
export interface NotificationClaims {
  /** `true` si este caller ganó el claim (el aviso todavía no se mandó). */
  claimNotificationOnce: (key: string, ttlSeconds: number) => Promise<boolean>;
  /** Deshace el claim cuando el push falló, para que la próxima vuelta lo reintente. */
  releaseNotificationClaim: (key: string) => Promise<void>;
}

export const NOTIFICATION_CLAIM_PREFIX = "notified:";

export function createNotificationClaims(redis: Pick<Redis, "set" | "del">): NotificationClaims {
  return {
    claimNotificationOnce: async (key, ttlSeconds) =>
      (await redis.set(`${NOTIFICATION_CLAIM_PREFIX}${key}`, "1", "EX", ttlSeconds, "NX")) === "OK",
    releaseNotificationClaim: async (key) => {
      await redis.del(`${NOTIFICATION_CLAIM_PREFIX}${key}`);
    },
  };
}
