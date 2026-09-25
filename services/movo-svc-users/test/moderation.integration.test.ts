import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { AccountStatus, UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { ShipmentsClient } from "../src/adapters/shipments-client";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";
import { REPORT_RATE_LIMIT_MAX, reportRateLimitKey } from "../src/modules/moderation/moderation.service";

// Reputación "caída" (misma degradación que AC3 de MOVO-152) y sin envíos activos:
// esta suite no ejercita nada de svc-shipments, solo necesita que `GET /users/:id` y
// `DELETE /users/me` no salgan a la red.
const shipmentsClient: ShipmentsClient = {
  async hasActiveShipments() {
    return { hasActiveDispute: false, hasActiveShipments: false };
  },
  async findReputation() {
    throw new Error("fuera de alcance de esta suite");
  },
  async findRecentRatingComments() {
    throw new Error("fuera de alcance de esta suite");
  },
  async deleteCarrierPositions() {
    return 0;
  },
};

describe("Reportar y bloquear usuarios (MOVO-175)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({ shipmentsClient });
    await app.ready();
    repo = createUserRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
    const keys = await app.redis.keys("user-report-attempts:*");
    if (keys.length > 0) {
      await app.redis.del(...keys);
    }
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

  function report(callerId: string, targetId: string, payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: `/users/${targetId}/report`,
      headers: { "x-user-id": callerId },
      payload,
    });
  }

  function block(callerId: string, targetId: string) {
    return app.inject({ method: "POST", url: `/users/${targetId}/block`, headers: { "x-user-id": callerId } });
  }

  function unblock(callerId: string, targetId: string) {
    return app.inject({ method: "DELETE", url: `/users/${targetId}/block`, headers: { "x-user-id": callerId } });
  }

  function blockRelations(userId: string) {
    return app.inject({ method: "GET", url: `/internal/users/${userId}/block-relations` });
  }

  describe("POST /users/:id/report", () => {
    it("crea el reporte en pending (201) con el detalle recortado", async () => {
      const a = await repo.create(buildInput());
      const b = await repo.create(buildInput());

      const response = await report(a.id, b.id, { reason: "harassment", details: "  me insultó  " });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({ reportedId: b.id, reason: "harassment", details: "me insultó", status: "pending" });
    });

    it("idempotente: un segundo reporte del mismo par devuelve 200 con el mismo reporte", async () => {
      const a = await repo.create(buildInput());
      const b = await repo.create(buildInput());

      const first = JSON.parse((await report(a.id, b.id, { reason: "no_show" })).body);
      const second = await report(a.id, b.id, { reason: "other" });

      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.body).id).toBe(first.id);
      expect(await app.db.userReport.count()).toBe(1);
    });

    it("details vacío se persiste como null", async () => {
      const a = await repo.create(buildInput());
      const b = await repo.create(buildInput());

      const response = await report(a.id, b.id, { reason: "other", details: "   " });

      expect(JSON.parse(response.body).details).toBeNull();
    });

    it("400 CANNOT_MODERATE_SELF al reportarse a uno mismo", async () => {
      const a = await repo.create(buildInput());

      const response = await report(a.id, a.id, { reason: "other" });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("CANNOT_MODERATE_SELF");
    });

    it("404 USER_NOT_FOUND con un usuario inexistente o dado de baja", async () => {
      const a = await repo.create(buildInput());
      const deleted = await repo.create(buildInput());
      await repo.anonymizeAndDelete(deleted.id);

      expect((await report(a.id, randomUUID(), { reason: "other" })).statusCode).toBe(404);
      const response = await report(a.id, deleted.id, { reason: "other" });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe("USER_NOT_FOUND");
    });

    it("400 VALIDATION_FAILED con un motivo inválido o details demasiado largo", async () => {
      const a = await repo.create(buildInput());
      const b = await repo.create(buildInput());

      expect((await report(a.id, b.id, { reason: "spam" })).statusCode).toBe(400);
      expect((await report(a.id, b.id, { reason: "other", details: "x".repeat(501) })).statusCode).toBe(400);
    });

    it("429 RATE_LIMIT_EXCEEDED al pasar el máximo diario de reportes nuevos", async () => {
      const a = await repo.create(buildInput());
      const b = await repo.create(buildInput());
      await app.redis.set(reportRateLimitKey(a.id), REPORT_RATE_LIMIT_MAX, "EX", 60);

      const response = await report(a.id, b.id, { reason: "other" });

      expect(response.statusCode).toBe(429);
      expect(JSON.parse(response.body).error.code).toBe("RATE_LIMIT_EXCEEDED");
    });

    it("401 sin x-user-id", async () => {
      const response = await app.inject({ method: "POST", url: `/users/${randomUUID()}/report`, payload: { reason: "other" } });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST/DELETE /users/:id/block", () => {
    it("bloquear es idempotente (204 dos veces, una sola fila)", async () => {
      const a = await repo.create(buildInput());
      const b = await repo.create(buildInput());

      expect((await block(a.id, b.id)).statusCode).toBe(204);
      expect((await block(a.id, b.id)).statusCode).toBe(204);
      expect(await app.db.userBlock.count()).toBe(1);
    });

    it("desbloquear es idempotente, también sin bloqueo previo", async () => {
      const a = await repo.create(buildInput());
      const b = await repo.create(buildInput());
      await block(a.id, b.id);

      expect((await unblock(a.id, b.id)).statusCode).toBe(204);
      expect((await unblock(a.id, b.id)).statusCode).toBe(204);
      expect(await app.db.userBlock.count()).toBe(0);
    });

    it("400 CANNOT_MODERATE_SELF al bloquearse a uno mismo", async () => {
      const a = await repo.create(buildInput());

      const response = await block(a.id, a.id);

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("CANNOT_MODERATE_SELF");
    });

    it("404 al bloquear a un usuario inexistente", async () => {
      const a = await repo.create(buildInput());
      expect((await block(a.id, randomUUID())).statusCode).toBe(404);
    });
  });

  describe("GET /users/me/blocked", () => {
    it("lista solo los bloqueos propios, del más reciente al más viejo", async () => {
      const a = await repo.create(buildInput());
      const b = await repo.create(buildInput({ firstName: "Pedro", lastName: "Yorlano" }));
      const c = await repo.create(buildInput({ firstName: "Lucas", lastName: "Dalmagro" }));
      const d = await repo.create(buildInput());
      await block(a.id, b.id);
      await block(a.id, c.id);
      await block(d.id, a.id); // quién me bloqueó a mí nunca se expone

      const response = await app.inject({ method: "GET", url: "/users/me/blocked", headers: { "x-user-id": a.id } });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.map((u: { id: string }) => u.id)).toEqual([c.id, b.id]);
      expect(body[0]).toMatchObject({ fullName: "Lucas Dalmagro", photoUrl: null });
      expect(typeof body[0].blockedAt).toBe("string");
    });
  });

  describe("GET /users/:id (isBlockedByMe)", () => {
    it("true solo si el caller bloqueó al perfil; nunca revela la dirección inversa", async () => {
      const a = await repo.create(buildInput());
      const b = await repo.create(buildInput());
      await block(a.id, b.id);

      const asBlocker = JSON.parse(
        (await app.inject({ method: "GET", url: `/users/${b.id}`, headers: { "x-user-id": a.id } })).body,
      );
      const asBlocked = await app.inject({ method: "GET", url: `/users/${a.id}`, headers: { "x-user-id": b.id } });

      expect(asBlocker.isBlockedByMe).toBe(true);
      expect(asBlocked.statusCode).toBe(200);
      expect(JSON.parse(asBlocked.body).isBlockedByMe).toBe(false);
    });

    it("ausente en el perfil propio", async () => {
      const a = await repo.create(buildInput());

      const body = JSON.parse(
        (await app.inject({ method: "GET", url: `/users/${a.id}`, headers: { "x-user-id": a.id } })).body,
      );

      expect(body).not.toHaveProperty("isBlockedByMe");
    });
  });

  describe("GET /users/search", () => {
    it("excluye usuarios con un bloqueo en cualquier dirección", async () => {
      const a = await repo.create(buildInput());
      const blockedByA = await repo.create(buildInput({ firstName: "Juan", lastName: "Uno" }));
      const blockerOfA = await repo.create(buildInput({ firstName: "Juan", lastName: "Dos" }));
      const free = await repo.create(buildInput({ firstName: "Juan", lastName: "Tres" }));
      await block(a.id, blockedByA.id);
      await block(blockerOfA.id, a.id);

      const response = await app.inject({ method: "GET", url: "/users/search?q=Juan", headers: { "x-user-id": a.id } });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).map((u: { id: string }) => u.id)).toEqual([free.id]);
      expect(JSON.parse(response.body)[0]).not.toHaveProperty("isBlockedByMe");
    });
  });

  describe("GET /internal/users/:id/block-relations", () => {
    it("devuelve la unión simétrica de bloqueos", async () => {
      const a = await repo.create(buildInput());
      const b = await repo.create(buildInput());
      const c = await repo.create(buildInput());
      const unrelated = await repo.create(buildInput());
      await block(a.id, b.id);
      await block(c.id, a.id);
      await block(b.id, unrelated.id);

      const response = await blockRelations(a.id);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).userIds.sort()).toEqual([b.id, c.id].sort());
      expect(JSON.parse((await blockRelations(b.id)).body).userIds.sort()).toEqual([a.id, unrelated.id].sort());
    });

    it("no se documenta en la Swagger pública", async () => {
      const spec = app.swagger() as { paths: Record<string, unknown> };
      expect(Object.keys(spec.paths).some((p) => p.includes("block-relations"))).toBe(false);
      expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(["/users/{id}/block", "/users/me/blocked"]));
    });
  });

  describe("DELETE /users/me (baja de cuenta)", () => {
    it("borra los bloqueos en ambas direcciones y conserva los reportes", async () => {
      const a = await repo.create(buildInput({ passwordHash: await hash("Password1") }));
      const b = await repo.create(buildInput());
      const c = await repo.create(buildInput());
      await block(a.id, b.id);
      await block(c.id, a.id);
      await block(b.id, c.id);
      await report(a.id, b.id, { reason: "other" });
      await report(b.id, a.id, { reason: "other" });

      const response = await app.inject({
        method: "DELETE",
        url: "/users/me",
        headers: { "x-user-id": a.id },
        payload: { password: "Password1" },
      });

      expect(response.statusCode).toBe(204);
      expect((await repo.findById(a.id))?.status).toBe(AccountStatus.DELETED);
      expect(await app.db.userBlock.count()).toBe(1);
      expect(await app.db.userReport.count()).toBe(2);
    });
  });
});
