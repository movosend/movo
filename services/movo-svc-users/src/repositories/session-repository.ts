import Redis from "ioredis";

export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days (7776000s), ADR-013

export type ConsumeRefreshTokenResult = "ok" | "already-used" | "hash-mismatch" | "not-found";

export interface SessionRepository {
  saveRefreshToken(
    userId: string,
    tokenId: string,
    payload?: string | Record<string, unknown>,
    ttlSeconds?: number
  ): Promise<void>;
  findRefreshToken(userId: string, tokenId: string): Promise<string | null>;
  /**
   * Lee el registro `{ hash, used }` de `refresh:{userId}:{tokenId}` y, si
   * `expectedHash` matchea y todavía no fue usado, lo marca `used: true` —
   * todo en una sola operación Redis (script Lua, mismo patrón que
   * `otp-repository.ts#incrementAttempts`). Sin esto, un `findRefreshToken` +
   * chequeo de `used` + `saveRefreshToken` separados dejan una carrera: dos
   * refresh concurrentes con el mismo token válido pueden pasar el chequeo
   * `used === false` antes de que cualquiera escriba `used: true`, y ninguno
   * dispara la detección de reuso del AC3.
   */
  consumeRefreshToken(userId: string, tokenId: string, expectedHash: string): Promise<ConsumeRefreshTokenResult>;
  revokeRefreshToken(userId: string, tokenId: string): Promise<boolean>;
  revokeAllForUser(userId: string): Promise<number>;
}

// GET + cjson.decode + chequeo de `used` + SET atómico: sin esto, leer y escribir por
// llamadas Redis separadas deja una ventana entre el chequeo `used === false` y la
// escritura donde dos refresh concurrentes con el mismo token pueden pasar los dos.
// KEEPTTL preserva el TTL de 90 días (ADR-013) — un SET sin esa opción lo resetearía.
const CONSUME_REFRESH_TOKEN_SCRIPT = `
local val = redis.call("GET", KEYS[1])
if not val then
  return "not-found"
end
local record = cjson.decode(val)
if record.hash ~= ARGV[1] then
  return "hash-mismatch"
end
if record.used then
  return "already-used"
end
record.used = true
redis.call("SET", KEYS[1], cjson.encode(record), "KEEPTTL")
return "ok"
`;

export function createSessionRepository(redis: Redis): SessionRepository {
  const validateIds = (userId: string, tokenId: string): void => {
    if (userId.includes(":") || tokenId.includes(":")) {
      throw new Error("userId and tokenId cannot contain colons");
    }
  };

  const buildKey = (userId: string, tokenId: string): string => `refresh:${userId}:${tokenId}`;

  return {
    async saveRefreshToken(
      userId: string,
      tokenId: string,
      payload: string | Record<string, unknown> = "true",
      ttlSeconds: number = DEFAULT_REFRESH_TOKEN_TTL_SECONDS
    ): Promise<void> {
      if (!userId || !tokenId) {
        throw new Error("userId and tokenId are required to save refresh token");
      }
      validateIds(userId, tokenId);

      const key = buildKey(userId, tokenId);
      const val = typeof payload === "object" ? JSON.stringify(payload) : payload;
      const validTtl = Math.max(1, Math.floor(ttlSeconds));

      await redis.set(key, val, "EX", validTtl);
    },

    async findRefreshToken(userId: string, tokenId: string): Promise<string | null> {
      if (!userId || !tokenId) {
        return null;
      }
      if (userId.includes(":") || tokenId.includes(":")) {
        return null;
      }
      const key = buildKey(userId, tokenId);
      return await redis.get(key);
    },

    async consumeRefreshToken(
      userId: string,
      tokenId: string,
      expectedHash: string
    ): Promise<ConsumeRefreshTokenResult> {
      if (!userId || !tokenId) {
        return "not-found";
      }
      validateIds(userId, tokenId);

      const key = buildKey(userId, tokenId);
      const result = await redis.eval(CONSUME_REFRESH_TOKEN_SCRIPT, 1, key, expectedHash);
      return result as ConsumeRefreshTokenResult;
    },

    async revokeRefreshToken(userId: string, tokenId: string): Promise<boolean> {
      if (!userId || !tokenId) {
        return false;
      }
      if (userId.includes(":") || tokenId.includes(":")) {
        return false;
      }
      const key = buildKey(userId, tokenId);
      const count = await redis.unlink(key);
      return count > 0;
    },

    async revokeAllForUser(userId: string): Promise<number> {
      if (!userId) {
        return 0;
      }
      if (userId.includes(":")) {
        throw new Error("userId cannot contain colons");
      }

      // Escape special glob pattern characters in userId (\, *, ?, [, ]) to prevent glob injection
      const sanitizedUserId = userId.replace(/[\*?\[\]\\]/g, "\\$&");
      const pattern = `refresh:${sanitizedUserId}:*`;

      let cursor = "0";
      let totalDeleted = 0;

      do {
        const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = nextCursor;

        if (keys.length > 0) {
          const count = await redis.unlink(...keys);
          totalDeleted += count;
        }
      } while (cursor !== "0");

      return totalDeleted;
    },
  };
}
