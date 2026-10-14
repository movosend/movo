import type Redis from "ioredis";
import type { RefreshedTokensData } from "../../repositories/carrier-mp-account-repository";
import type { TokenCipher } from "../../utils/token-cipher";

/** Cuánto se conserva un respaldo: sobra para que la base vuelva y corra el barrido horario. */
export const MP_PENDING_TOKENS_TTL_SECONDS = 24 * 60 * 60;

const pendingKey = (userId: string) => `mp_refresh_pending:${userId}`;

export interface PendingTokens {
  /** El `refresh_token` cifrado (de la base) con el que se pidió la renovación. */
  version: string;
  tokens: RefreshedTokensData;
}

/**
 * MOVO-243: respaldo de los tokens que MP ya rotó cuando fallan todos los intentos de
 * guardarlos en la base. Sin esto el `refresh_token` nuevo se perdería, el viejo ya no sirve
 * y la cuenta terminaría revocada. Va cifrado con la misma key que la base (nunca un token
 * en claro en Redis) y la corrida siguiente lo persiste antes de volver a llamar a MP.
 */
export interface PendingTokensStore {
  save(userId: string, pending: PendingTokens): Promise<void>;
  /** `null` si no hay respaldo, venció o no se puede leer. */
  find(userId: string): Promise<PendingTokens | null>;
  clear(userId: string): Promise<void>;
}

export function createPendingTokensStore(redis: Redis, cipher: TokenCipher): PendingTokensStore {
  return {
    async save(userId, pending) {
      const payload = JSON.stringify({
        version: pending.version,
        accessToken: pending.tokens.accessToken,
        refreshToken: pending.tokens.refreshToken,
        scope: pending.tokens.scope,
        tokenExpiresAt: pending.tokens.tokenExpiresAt.toISOString(),
      });
      await redis.set(pendingKey(userId), cipher.encrypt(payload), "EX", MP_PENDING_TOKENS_TTL_SECONDS);
    },

    async find(userId) {
      const raw = await redis.get(pendingKey(userId));
      if (!raw) return null;
      try {
        const parsed = JSON.parse(cipher.decrypt(raw)) as Record<string, unknown>;
        const { version, accessToken, refreshToken, scope, tokenExpiresAt } = parsed;
        if (
          typeof version !== "string" ||
          typeof accessToken !== "string" ||
          typeof refreshToken !== "string" ||
          typeof tokenExpiresAt !== "string"
        ) {
          return null;
        }
        return {
          version,
          tokens: {
            accessToken,
            refreshToken,
            scope: typeof scope === "string" ? scope : null,
            tokenExpiresAt: new Date(tokenExpiresAt),
          },
        };
      } catch {
        return null;
      }
    },

    async clear(userId) {
      await redis.del(pendingKey(userId));
    },
  };
}
