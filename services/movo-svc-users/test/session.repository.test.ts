import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Redis from "ioredis";
import {
  createSessionRepository,
  SessionRepository,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
} from "../src/repositories/session-repository";

describe("Session Repository (Redis)", () => {
  let redis: Redis;
  let sessionRepo: SessionRepository;

  beforeAll(() => {
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    redis = new Redis(redisUrl, { lazyConnect: false });
    sessionRepo = createSessionRepository(redis);
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    // Clean up test keys matching refresh:* pattern before each test
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "refresh:*", "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  });

  it("guarda y recupera un refresh token con TTL de 7 días por defecto (ADR-004)", async () => {
    const userId = "usr-uuid-001";
    const tokenId = "tok-uuid-101";

    await sessionRepo.saveRefreshToken(userId, tokenId);

    const tokenVal = await sessionRepo.findRefreshToken(userId, tokenId);
    expect(tokenVal).toBe("true");

    const ttl = await redis.ttl(`refresh:${userId}:${tokenId}`);
    expect(ttl).toBeGreaterThan(604700);
    expect(ttl).toBeLessThanOrEqual(DEFAULT_REFRESH_TOKEN_TTL_SECONDS);
  });

  it("guarda un refresh token con payload JSON y TTL personalizado", async () => {
    const userId = "usr-uuid-002";
    const tokenId = "tok-uuid-102";
    const payload = { device: "iPhone 15", ip: "192.168.1.1" };
    const customTtl = 3600; // 1 hour

    await sessionRepo.saveRefreshToken(userId, tokenId, payload, customTtl);

    const rawVal = await sessionRepo.findRefreshToken(userId, tokenId);
    expect(rawVal).not.toBeNull();
    expect(JSON.parse(rawVal!)).toEqual(payload);

    const ttl = await redis.ttl(`refresh:${userId}:${tokenId}`);
    expect(ttl).toBeGreaterThan(3500);
    expect(ttl).toBeLessThanOrEqual(customTtl);
  });

  it("devuelve null cuando el token no existe o ha sido expirado", async () => {
    const result = await sessionRepo.findRefreshToken("non-existent-user", "non-existent-token");
    expect(result).toBeNull();
  });

  it("revoca un refresh token individualmente y devuelve true si existía", async () => {
    const userId = "usr-uuid-003";
    const tokenId = "tok-uuid-103";

    await sessionRepo.saveRefreshToken(userId, tokenId);
    const revoked = await sessionRepo.revokeRefreshToken(userId, tokenId);
    expect(revoked).toBe(true);

    const found = await sessionRepo.findRefreshToken(userId, tokenId);
    expect(found).toBeNull();

    const revokedAgain = await sessionRepo.revokeRefreshToken(userId, tokenId);
    expect(revokedAgain).toBe(false);
  });

  it("revoca todas las sesiones de un usuario usando el prefijo refresh:{userId}:* sin afectar a otros usuarios", async () => {
    const userA = "usr-uuid-A";
    const userB = "usr-uuid-B";

    await sessionRepo.saveRefreshToken(userA, "tok-a1");
    await sessionRepo.saveRefreshToken(userA, "tok-a2");
    await sessionRepo.saveRefreshToken(userA, "tok-a3");

    await sessionRepo.saveRefreshToken(userB, "tok-b1");
    await sessionRepo.saveRefreshToken(userB, "tok-b2");

    const countRevoked = await sessionRepo.revokeAllForUser(userA);
    expect(countRevoked).toBe(3);

    expect(await sessionRepo.findRefreshToken(userA, "tok-a1")).toBeNull();
    expect(await sessionRepo.findRefreshToken(userA, "tok-a2")).toBeNull();
    expect(await sessionRepo.findRefreshToken(userA, "tok-a3")).toBeNull();

    expect(await sessionRepo.findRefreshToken(userB, "tok-b1")).toBe("true");
    expect(await sessionRepo.findRefreshToken(userB, "tok-b2")).toBe("true");

    const secondRevokeCount = await sessionRepo.revokeAllForUser(userA);
    expect(secondRevokeCount).toBe(0);
  });

  it("valida parámetros obligatorios al guardar", async () => {
    await expect(sessionRepo.saveRefreshToken("", "tok-1")).rejects.toThrow("userId and tokenId are required");
    await expect(sessionRepo.saveRefreshToken("usr-1", "")).rejects.toThrow("userId and tokenId are required");
  });

  it("escapa caracteres especiales glob en userId al revocar todas las sesiones", async () => {
    const userStar = "usr*wildcard";
    const userNormal = "usr123";

    await sessionRepo.saveRefreshToken(userStar, "tok-s1");
    await sessionRepo.saveRefreshToken(userNormal, "tok-n1");

    const count = await sessionRepo.revokeAllForUser(userStar);
    expect(count).toBe(1);
    expect(await sessionRepo.findRefreshToken(userStar, "tok-s1")).toBeNull();
    expect(await sessionRepo.findRefreshToken(userNormal, "tok-n1")).toBe("true");
  });
});
