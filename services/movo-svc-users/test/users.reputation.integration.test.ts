import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { reputationCacheKey } from "../src/modules/users/users.service";
import { ShipmentsClient, UserReputationSummary, RawRecentRatingComment } from "../src/adapters/shipments-client";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";

interface ActiveShipmentsResult {
  hasActiveDispute: boolean;
  hasActiveShipments: boolean;
}

/**
 * MOVO-152: mismo patrón de fake inyectable que `createFakeShipmentsClient` de
 * `users.account-settings.integration.test.ts` (MOVO-134), sumando los dos métodos
 * nuevos con contadores de llamadas -- necesarios para verificar hit/miss de caché
 * (DoD) sin espiar sobre un mock de librería.
 */
function createFakeShipmentsClient() {
  const reputationResponses = new Map<string, UserReputationSummary>();
  const commentsResponses = new Map<string, RawRecentRatingComment[]>();
  const failingReputationUserIds = new Set<string>();
  let reputationCallCount = 0;
  let commentsCallCount = 0;

  const client: ShipmentsClient = {
    async hasActiveShipments(): Promise<ActiveShipmentsResult> {
      return { hasActiveDispute: false, hasActiveShipments: false };
    },
    async findReputation(userId: string): Promise<UserReputationSummary> {
      reputationCallCount += 1;
      if (failingReputationUserIds.has(userId)) {
        throw new Error("svc-shipments caído (simulado, MOVO-152 AC3)");
      }
      const summary = reputationResponses.get(userId);
      if (!summary) {
        throw new Error(`No hay reputación fake configurada para ${userId}`);
      }
      return summary;
    },
    async findRecentRatingComments(
      userId: string,
    ): Promise<{ items: RawRecentRatingComment[]; nextCursor: string | null }> {
      commentsCallCount += 1;
      return { items: commentsResponses.get(userId) ?? [], nextCursor: null };
    },
  };

  return {
    client,
    setReputation(userId: string, summary: UserReputationSummary) {
      // Setear una respuesta buena "recupera" al usuario si estaba marcado como
      // fallando -- necesario para el test de "no cachea un fallo" (simula que
      // svc-shipments volvió a responder).
      failingReputationUserIds.delete(userId);
      reputationResponses.set(userId, summary);
    },
    setComments(userId: string, comments: RawRecentRatingComment[]) {
      commentsResponses.set(userId, comments);
    },
    setFailing(userId: string) {
      failingReputationUserIds.add(userId);
    },
    getReputationCallCount: () => reputationCallCount,
    getCommentsCallCount: () => commentsCallCount,
  };
}

function buildSummary(overrides: Partial<UserReputationSummary> = {}): UserReputationSummary {
  return {
    reputationScore: 4.7,
    ratingCount: 12,
    isNewProfile: false,
    asSender: { reputationScore: 4.5, ratingCount: 5, isNewProfile: false },
    asCarrier: { reputationScore: 4.8, ratingCount: 7, isNewProfile: false },
    transactionCounts: { asSender: 5, asCarrier: 7 },
    ...overrides,
  };
}

describe("Reputación real en el perfil (MOVO-152)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;
  let fake: ReturnType<typeof createFakeShipmentsClient>;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    fake = createFakeShipmentsClient();
    app = buildApp({ shipmentsClient: fake.client });
    await app.ready();
    repo = createUserRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
  });

  function buildInput(overrides: Partial<CreateUserInput> = {}): CreateUserInput {
    return {
      email: `user-${randomUUID()}@movo.test`,
      phone: `+549351${Math.floor(1000000 + Math.random() * 8999999)}`,
      firstName: "Alena",
      lastName: "Ariza",
      passwordHash: "hashed_password",
      roles: [UserRole.SENDER, UserRole.CARRIER],
      phoneVerified: true,
      address: {
        street: "Av. Colón",
        number: "1234",
        city: "Córdoba",
        province: "Córdoba",
        zip: "5000",
        lat: -31.4201,
        long: -64.1888,
      },
      ...overrides,
    };
  }

  describe("GET /users/me", () => {
    it("AC1: devuelve reputationScore y transactionCounts reales, leídos de svc-shipments", async () => {
      const user = await repo.create(buildInput());
      fake.setReputation(user.id, buildSummary({ reputationScore: 4.2, transactionCounts: { asSender: 3, asCarrier: 1 } }));

      const response = await app.inject({ method: "GET", url: "/users/me", headers: { "x-user-id": user.id } });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.reputationScore).toBe(4.2);
      expect(body.transactionCounts).toEqual({ asSender: 3, asCarrier: 1 });
      // AC2: el desglose por rol/isNewProfile/comentarios NO se agregan a PrivateProfile.
      expect(body).not.toHaveProperty("asSender");
      expect(body).not.toHaveProperty("asCarrier");
      expect(body).not.toHaveProperty("recentRatingComments");
    });

    it("AC3: si svc-shipments falla, el perfil se devuelve igual con reputationScore null y contadores en cero", async () => {
      const user = await repo.create(buildInput());
      fake.setFailing(user.id);

      const response = await app.inject({ method: "GET", url: "/users/me", headers: { "x-user-id": user.id } });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.reputationScore).toBeNull();
      expect(body.transactionCounts).toEqual({ asSender: 0, asCarrier: 0 });
    });
  });

  describe("GET /users/:id (perfil completo)", () => {
    it("AC2: incluye el desglose por rol, isNewProfile y los comentarios recientes", async () => {
      const caller = await repo.create(buildInput());
      const target = await repo.create(buildInput({ firstName: "Juan", lastName: "Perez" }));
      const rater = randomUUID();
      fake.setReputation(target.id, buildSummary());
      fake.setComments(target.id, [
        { id: randomUUID(), raterId: rater, score: 5, comment: "Excelente transportista", createdAt: new Date().toISOString() },
      ]);

      const response = await app.inject({
        method: "GET",
        url: `/users/${target.id}`,
        headers: { "x-user-id": caller.id },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.reputationScore).toBe(4.7);
      expect(body.ratingCount).toBe(12);
      expect(body.isNewProfile).toBe(false);
      expect(body.asSender).toEqual({ reputationScore: 4.5, ratingCount: 5, isNewProfile: false });
      expect(body.asCarrier).toEqual({ reputationScore: 4.8, ratingCount: 7, isNewProfile: false });
      expect(body.recentRatingComments).toHaveLength(1);
      expect(body.recentRatingComments[0]).toMatchObject({ raterId: rater, score: 5, comment: "Excelente transportista" });
      // MOVO-170: `rater` es un UUID al azar, sin fila real en `users.users` -- cae al
      // label genérico en vez de romper el batch de nombres.
      expect(body.recentRatingComments[0].raterName).toBe("Usuario de Movo");
    });

    it("MOVO-170: resuelve raterName contra la tabla local cuando el rater es un usuario real", async () => {
      const caller = await repo.create(buildInput());
      const target = await repo.create(buildInput({ firstName: "Juan", lastName: "Perez" }));
      const rater = await repo.create(buildInput({ firstName: "Ana", lastName: "Gomez" }));
      fake.setReputation(target.id, buildSummary());
      fake.setComments(target.id, [
        { id: randomUUID(), raterId: rater.id, score: 5, comment: null, createdAt: new Date().toISOString() },
      ]);

      const response = await app.inject({
        method: "GET",
        url: `/users/${target.id}`,
        headers: { "x-user-id": caller.id },
      });

      expect(JSON.parse(response.body).recentRatingComments[0].raterName).toBe("Ana Gomez");
    });

    it("MOVO-170: memberSince/phoneVerified/emailVerified viajan en el perfil público", async () => {
      const caller = await repo.create(buildInput());
      const target = await repo.create(buildInput());
      fake.setReputation(target.id, buildSummary());

      const response = await app.inject({
        method: "GET",
        url: `/users/${target.id}`,
        headers: { "x-user-id": caller.id },
      });

      const body = JSON.parse(response.body);
      expect(body.memberSince).toEqual(expect.any(String));
      // `buildInput()` default: phoneVerified true (MOVO-71), emailVerified false (sin
      // EmailProvider hasta MOVO-139 -- este fixture nunca lo verifica).
      expect(body.phoneVerified).toBe(true);
      expect(body.emailVerified).toBe(false);
    });

    it("AC2: isNewProfile en true con menos de 3 calificaciones -- el score igual viaja", async () => {
      const caller = await repo.create(buildInput());
      const target = await repo.create(buildInput({ firstName: "Nuevo", lastName: "Transportista" }));
      fake.setReputation(
        target.id,
        buildSummary({
          reputationScore: 5,
          ratingCount: 1,
          isNewProfile: true,
          asSender: { reputationScore: null, ratingCount: 0, isNewProfile: true },
          asCarrier: { reputationScore: 5, ratingCount: 1, isNewProfile: true },
        })
      );

      const response = await app.inject({
        method: "GET",
        url: `/users/${target.id}`,
        headers: { "x-user-id": caller.id },
      });

      const body = JSON.parse(response.body);
      expect(body.isNewProfile).toBe(true);
      expect(body.reputationScore).toBe(5);
      expect(body.asSender).toEqual({ reputationScore: null, ratingCount: 0, isNewProfile: true });
    });

    it("AC3: si svc-shipments falla, el perfil público también cae a los valores por defecto sin romper", async () => {
      const caller = await repo.create(buildInput());
      const target = await repo.create(buildInput());
      fake.setFailing(target.id);

      const response = await app.inject({
        method: "GET",
        url: `/users/${target.id}`,
        headers: { "x-user-id": caller.id },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.reputationScore).toBeNull();
      expect(body.ratingCount).toBe(0);
      expect(body.isNewProfile).toBe(true);
      expect(body.asSender).toEqual({ reputationScore: null, ratingCount: 0, isNewProfile: true });
      expect(body.asCarrier).toEqual({ reputationScore: null, ratingCount: 0, isNewProfile: true });
      expect(body.recentRatingComments).toEqual([]);
    });
  });

  describe("GET /users/search", () => {
    it("AC2: no pide los comentarios recientes (composición liviana)", async () => {
      const caller = await repo.create(buildInput());
      const target = await repo.create(buildInput({ firstName: "Buscable", lastName: "Persona" }));
      fake.setReputation(target.id, buildSummary());
      fake.setComments(target.id, [
        { id: randomUUID(), raterId: randomUUID(), score: 5, comment: "no debería pedirse", createdAt: new Date().toISOString() },
      ]);

      const callsBefore = fake.getCommentsCallCount();
      const response = await app.inject({
        method: "GET",
        url: "/users/search?q=Buscable",
        headers: { "x-user-id": caller.id },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveLength(1);
      expect(body[0].recentRatingComments).toEqual([]);
      expect(body[0].asSender).toEqual({ reputationScore: 4.5, ratingCount: 5, isNewProfile: false });
      expect(fake.getCommentsCallCount()).toBe(callsBefore);
    });
  });

  describe("Caché en Redis del agregado (AC5)", () => {
    it("segunda lectura del mismo perfil es un hit de caché -- no vuelve a llamar a svc-shipments", async () => {
      const user = await repo.create(buildInput());
      fake.setReputation(user.id, buildSummary());

      const callsBefore = fake.getReputationCallCount();
      const first = await app.inject({ method: "GET", url: "/users/me", headers: { "x-user-id": user.id } });
      expect(first.statusCode).toBe(200);
      expect(fake.getReputationCallCount()).toBe(callsBefore + 1);

      const second = await app.inject({ method: "GET", url: "/users/me", headers: { "x-user-id": user.id } });
      expect(second.statusCode).toBe(200);
      // Miss + hit: la segunda lectura no dispara una segunda llamada HTTP.
      expect(fake.getReputationCallCount()).toBe(callsBefore + 1);
      expect(JSON.parse(second.body).reputationScore).toBe(JSON.parse(first.body).reputationScore);
    });

    it("cachea el agregado con TTL positivo acotado a REPUTATION_CACHE_TTL_SECONDS", async () => {
      const user = await repo.create(buildInput());
      fake.setReputation(user.id, buildSummary());

      await app.inject({ method: "GET", url: "/users/me", headers: { "x-user-id": user.id } });

      const ttl = await app.redis.ttl(reputationCacheKey(user.id));
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(app.config.REPUTATION_CACHE_TTL_SECONDS);
    });

    it("no cachea un fallo -- una recuperación posterior de svc-shipments se refleja sin esperar el TTL", async () => {
      const user = await repo.create(buildInput());
      fake.setFailing(user.id);

      const callsBefore = fake.getReputationCallCount();
      const failed = await app.inject({ method: "GET", url: "/users/me", headers: { "x-user-id": user.id } });
      expect(JSON.parse(failed.body).reputationScore).toBeNull();

      // "Recupera" el servicio -- ya no está en el set de fallas, ahora responde bien.
      fake.setReputation(user.id, buildSummary({ reputationScore: 3.9 }));
      const recovered = await app.inject({ method: "GET", url: "/users/me", headers: { "x-user-id": user.id } });
      expect(JSON.parse(recovered.body).reputationScore).toBe(3.9);
      expect(fake.getReputationCallCount()).toBe(callsBefore + 2);
    });
  });

  describe("GET /users/:id/ratings (MOVO-170)", () => {
    it("devuelve items con raterName resuelto y propaga nextCursor", async () => {
      const caller = await repo.create(buildInput());
      const target = await repo.create(buildInput());
      const rater = await repo.create(buildInput({ firstName: "Ana", lastName: "Gomez" }));
      fake.setComments(target.id, [
        { id: randomUUID(), raterId: rater.id, score: 5, comment: null, createdAt: new Date().toISOString() },
      ]);

      const response = await app.inject({
        method: "GET",
        url: `/users/${target.id}/ratings`,
        headers: { "x-user-id": caller.id },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].raterName).toBe("Ana Gomez");
      expect(body.nextCursor).toBeNull();
    });

    it("404 USER_NOT_FOUND con un id inexistente", async () => {
      const caller = await repo.create(buildInput());

      const response = await app.inject({
        method: "GET",
        url: `/users/${randomUUID()}/ratings`,
        headers: { "x-user-id": caller.id },
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe("USER_NOT_FOUND");
    });
  });
});
