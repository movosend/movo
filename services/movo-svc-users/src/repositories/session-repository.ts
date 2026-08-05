import Redis from "ioredis";

export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days (7776000s), ADR-013

export interface SessionRepository {
  saveRefreshToken(
    userId: string,
    tokenId: string,
    payload?: string | Record<string, unknown>,
    ttlSeconds?: number
  ): Promise<void>;
  findRefreshToken(userId: string, tokenId: string): Promise<string | null>;
  revokeRefreshToken(userId: string, tokenId: string): Promise<boolean>;
  revokeAllForUser(userId: string): Promise<number>;
}

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
