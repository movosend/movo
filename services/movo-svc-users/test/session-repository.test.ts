import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Redis from "ioredis";
import { PANEL_ACCESS_TOKEN_TTL_SECONDS } from "@movo/shared";
import {
  createSessionRepository,
  SessionRepository,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  ACCESS_TOKEN_TTL_SECONDS,
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
    // Clean up test keys matching refresh:* and user-revoked-at:* before each test
    for (const pattern of ["refresh:*", "panel-refresh:*", "user-revoked-at:*", "panel-revoked-at:*"]) {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== "0");
    }
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

  it("rechaza userId o tokenId que contengan dos puntos (:) para evitar colisiones de keys", async () => {
    await expect(sessionRepo.saveRefreshToken("user:id", "tok1")).rejects.toThrow("userId and tokenId cannot contain colons");
    await expect(sessionRepo.saveRefreshToken("user1", "tok:en")).rejects.toThrow("userId and tokenId cannot contain colons");
    await expect(sessionRepo.revokeAllForUser("user:id")).rejects.toThrow("userId cannot contain colons");
  });

  it("escapa caracteres especiales glob en userId (incluyendo backslash + metacarácter)", async () => {
    const userStar = "usr*wildcard";
    const userBackslashStar = "usr\\*wildcard";
    const userNormal = "usr123";

    await sessionRepo.saveRefreshToken(userStar, "tok-s1");
    await sessionRepo.saveRefreshToken(userBackslashStar, "tok-bs1");
    await sessionRepo.saveRefreshToken(userNormal, "tok-n1");

    // Revocar para userBackslashStar sólo debe revocar userBackslashStar
    const countBackslash = await sessionRepo.revokeAllForUser(userBackslashStar);
    expect(countBackslash).toBe(1);
    expect(await sessionRepo.findRefreshToken(userBackslashStar, "tok-bs1")).toBeNull();
    expect(await sessionRepo.findRefreshToken(userStar, "tok-s1")).toBe("true");
    expect(await sessionRepo.findRefreshToken(userNormal, "tok-n1")).toBe("true");

    // Revocar para userStar sólo debe revocar userStar
    const countStar = await sessionRepo.revokeAllForUser(userStar);
    expect(countStar).toBe(1);
    expect(await sessionRepo.findRefreshToken(userStar, "tok-s1")).toBeNull();
    expect(await sessionRepo.findRefreshToken(userNormal, "tok-n1")).toBe("true");
  });

  it("sella user-revoked-at:{userId} con el instante actual en segundos Unix y TTL de ACCESS_TOKEN_TTL_SECONDS", async () => {
    const userId = "usr-uuid-revoke";
    const beforeSeconds = Math.floor(Date.now() / 1000);

    await sessionRepo.revokeAccessTokensIssuedBefore(userId);

    const raw = await redis.get(`user-revoked-at:${userId}`);
    expect(raw).not.toBeNull();
    const revokedAt = Number(raw);
    expect(revokedAt).toBeGreaterThanOrEqual(beforeSeconds);
    expect(revokedAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));

    const ttl = await redis.ttl(`user-revoked-at:${userId}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ACCESS_TOKEN_TTL_SECONDS);
  });

  it("rechaza userId vacío o con dos puntos al sellar la revocación", async () => {
    await expect(sessionRepo.revokeAccessTokensIssuedBefore("")).rejects.toThrow(
      "userId is required and cannot contain colons"
    );
    await expect(sessionRepo.revokeAccessTokensIssuedBefore("user:id")).rejects.toThrow(
      "userId is required and cannot contain colons"
    );
  });

  describe("sesiones de panel (MOVO-287)", () => {
    const nowSeconds = (): number => Math.floor(Date.now() / 1000);

    it("guarda en panel-refresh:* con TTL igual a lo que le queda a la sesión", async () => {
      const absoluteExpiresAt = nowSeconds() + 3600;
      await sessionRepo.savePanelRefreshToken("usr-panel", "tok-p1", { hash: "h1", absoluteExpiresAt });

      const raw = await redis.get("panel-refresh:usr-panel:tok-p1");
      expect(JSON.parse(raw!)).toEqual({ hash: "h1", used: false, absoluteExpiresAt });
      const ttl = await redis.ttl("panel-refresh:usr-panel:tok-p1");
      expect(ttl).toBeGreaterThan(3590);
      expect(ttl).toBeLessThanOrEqual(3600);
      // No se mezcla con las sesiones de la app.
      expect(await sessionRepo.findRefreshToken("usr-panel", "tok-p1")).toBeNull();
    });

    it("rechaza guardar una sesión de panel ya vencida", async () => {
      await expect(
        sessionRepo.savePanelRefreshToken("usr-panel", "tok-p1", { hash: "h1", absoluteExpiresAt: nowSeconds() - 1 })
      ).rejects.toThrow("panel session already expired");
    });

    it("consume una sola vez y devuelve el vencimiento absoluto", async () => {
      const absoluteExpiresAt = nowSeconds() + 3600;
      await sessionRepo.savePanelRefreshToken("usr-panel", "tok-p1", { hash: "h1", absoluteExpiresAt });

      expect(await sessionRepo.consumePanelRefreshToken("usr-panel", "tok-p1", "otro")).toEqual({
        status: "hash-mismatch",
      });
      expect(await sessionRepo.consumePanelRefreshToken("usr-panel", "tok-p1", "h1")).toEqual({
        status: "ok",
        absoluteExpiresAt,
      });
      expect(await sessionRepo.consumePanelRefreshToken("usr-panel", "tok-p1", "h1")).toEqual({
        status: "already-used",
      });
      expect(await sessionRepo.consumePanelRefreshToken("usr-panel", "tok-nope", "h1")).toEqual({
        status: "not-found",
      });
    });

    it("un refresh de la app no se consume como de panel ni al revés", async () => {
      await sessionRepo.saveRefreshToken("usr-panel", "tok-app", { hash: "h1", used: false });
      await sessionRepo.savePanelRefreshToken("usr-panel", "tok-p1", {
        hash: "h1",
        absoluteExpiresAt: nowSeconds() + 3600,
      });

      expect(await sessionRepo.consumePanelRefreshToken("usr-panel", "tok-app", "h1")).toEqual({
        status: "not-found",
      });
      expect(await sessionRepo.consumeRefreshToken("usr-panel", "tok-p1", "h1")).toBe("not-found");
    });

    it("revokePanelSessionsForUser borra solo las de panel y sella panel-revoked-at", async () => {
      const absoluteExpiresAt = nowSeconds() + 3600;
      await sessionRepo.saveRefreshToken("usr-panel", "tok-app");
      await sessionRepo.savePanelRefreshToken("usr-panel", "tok-p1", { hash: "h1", absoluteExpiresAt });
      await sessionRepo.savePanelRefreshToken("usr-panel", "tok-p2", { hash: "h2", absoluteExpiresAt });
      await sessionRepo.savePanelRefreshToken("usr-other", "tok-p3", { hash: "h3", absoluteExpiresAt });
      const beforeSeconds = nowSeconds();

      expect(await sessionRepo.revokePanelSessionsForUser("usr-panel")).toBe(2);

      expect(await redis.exists("panel-refresh:usr-panel:tok-p1", "panel-refresh:usr-panel:tok-p2")).toBe(0);
      expect(await redis.exists("panel-refresh:usr-other:tok-p3")).toBe(1);
      expect(await sessionRepo.findRefreshToken("usr-panel", "tok-app")).toBe("true");
      expect(await redis.exists("user-revoked-at:usr-panel")).toBe(0);

      const revokedAt = Number(await redis.get("panel-revoked-at:usr-panel"));
      expect(revokedAt).toBeGreaterThanOrEqual(beforeSeconds);
      const ttl = await redis.ttl("panel-revoked-at:usr-panel");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(PANEL_ACCESS_TOKEN_TTL_SECONDS);
    });

    it("revokeAllForUser también borra las sesiones de panel", async () => {
      await sessionRepo.saveRefreshToken("usr-panel", "tok-app");
      await sessionRepo.savePanelRefreshToken("usr-panel", "tok-p1", {
        hash: "h1",
        absoluteExpiresAt: nowSeconds() + 3600,
      });

      expect(await sessionRepo.revokeAllForUser("usr-panel")).toBe(2);
      expect(await redis.exists("panel-refresh:usr-panel:tok-p1")).toBe(0);
    });

    it("revokePanelRefreshToken borra solo esa sesión", async () => {
      const absoluteExpiresAt = nowSeconds() + 3600;
      await sessionRepo.savePanelRefreshToken("usr-panel", "tok-p1", { hash: "h1", absoluteExpiresAt });
      await sessionRepo.savePanelRefreshToken("usr-panel", "tok-p2", { hash: "h2", absoluteExpiresAt });

      expect(await sessionRepo.revokePanelRefreshToken("usr-panel", "tok-p1")).toBe(true);
      expect(await sessionRepo.revokePanelRefreshToken("usr-panel", "tok-p1")).toBe(false);
      expect(await redis.exists("panel-refresh:usr-panel:tok-p2")).toBe(1);
    });
  });
});
