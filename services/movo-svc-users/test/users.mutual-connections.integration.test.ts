import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { ShipmentsClient } from "../src/adapters/shipments-client";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";

/**
 * MOVO-174: `GET /users/:id/mutual-connections`. Mismo patrón de `ShipmentsClient` fake
 * inyectable que `users.reputation.integration.test.ts` (MOVO-152), con registro de las
 * llamadas para verificar que mirar el propio perfil ni siquiera consulta a svc-shipments.
 */
function createFakeShipmentsClient() {
  const counts = new Map<string, number>();
  let failing = false;
  const calls: Array<{ viewerId: string; otherId: string }> = [];

  const client: ShipmentsClient = {
    async hasActiveShipments() {
      return { hasActiveDispute: false, hasActiveShipments: false };
    },
    async findReputation() {
      throw new Error("no implementado en este fake");
    },
    async findRecentRatingComments() {
      return { items: [], nextCursor: null };
    },
    async deleteCarrierPositions() {
      return 0;
    },
    async findMutualConnectionsCount(viewerId: string, otherId: string) {
      calls.push({ viewerId, otherId });
      if (failing) {
        throw new Error("svc-shipments caído (simulado)");
      }
      return counts.get(`${viewerId}:${otherId}`) ?? 0;
    },
  };

  return {
    client,
    calls,
    setCount(viewerId: string, otherId: string, count: number) {
      counts.set(`${viewerId}:${otherId}`, count);
    },
    setFailing(value: boolean) {
      failing = value;
    },
  };
}

describe("Conexiones mutuas en el perfil — GET /users/:id/mutual-connections (MOVO-174)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;
  let fake: ReturnType<typeof createFakeShipmentsClient>;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
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
    fake.calls.length = 0;
    fake.setFailing(false);
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

  async function getMutual(viewerId: string, targetId: string) {
    return app.inject({
      method: "GET",
      url: `/users/${targetId}/mutual-connections`,
      headers: { "x-user-id": viewerId },
    });
  }

  it.each([0, 1, 5])("devuelve el conteo de svc-shipments (%i conexiones mutuas), sin nombrar a nadie", async (count) => {
    const viewer = await repo.create(buildInput());
    const target = await repo.create(buildInput({ firstName: "Juan", lastName: "Perez" }));
    fake.setCount(viewer.id, target.id, count);

    const response = await getMutual(viewer.id, target.id);

    expect(response.statusCode).toBe(200);
    // Decisión de privacidad: `sampleFirstNames` viaja siempre vacío.
    expect(JSON.parse(response.body)).toEqual({ totalCount: count, sampleFirstNames: [] });
  });

  it("pregunta a svc-shipments con el viewer del header y el usuario visitado", async () => {
    const viewer = await repo.create(buildInput());
    const target = await repo.create(buildInput({ firstName: "Juan", lastName: "Perez" }));

    await getMutual(viewer.id, target.id);

    expect(fake.calls).toEqual([{ viewerId: viewer.id, otherId: target.id }]);
  });

  it("mirar el propio perfil da 0 y no consulta a svc-shipments (propio usuario excluido)", async () => {
    const viewer = await repo.create(buildInput());
    fake.setCount(viewer.id, viewer.id, 9);

    const response = await getMutual(viewer.id, viewer.id);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ totalCount: 0, sampleFirstNames: [] });
    expect(fake.calls).toHaveLength(0);
  });

  it("si svc-shipments falla, el perfil no se cae: degrada a 0", async () => {
    const viewer = await repo.create(buildInput());
    const target = await repo.create(buildInput({ firstName: "Juan", lastName: "Perez" }));
    fake.setCount(viewer.id, target.id, 3);
    fake.setFailing(true);

    const response = await getMutual(viewer.id, target.id);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ totalCount: 0, sampleFirstNames: [] });
  });

  it("404 USER_NOT_FOUND si el usuario visitado no existe", async () => {
    const viewer = await repo.create(buildInput());

    const response = await getMutual(viewer.id, randomUUID());

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe("USER_NOT_FOUND");
  });

  it("404 USER_NOT_FOUND si el usuario visitado fue dado de baja (deleted)", async () => {
    const viewer = await repo.create(buildInput());
    const target = await repo.create(buildInput({ firstName: "Juan", lastName: "Perez" }));
    await app.db.user.update({ where: { id: target.id }, data: { status: "deleted" } });

    const response = await getMutual(viewer.id, target.id);

    expect(response.statusCode).toBe(404);
    expect(fake.calls).toHaveLength(0);
  });

  it("401 sin x-user-id", async () => {
    const target = await repo.create(buildInput());

    const response = await app.inject({ method: "GET", url: `/users/${target.id}/mutual-connections` });

    expect(response.statusCode).toBe(401);
  });

  it("400 si el id no es un uuid", async () => {
    const viewer = await repo.create(buildInput());

    const response = await getMutual(viewer.id, "no-es-un-uuid");

    expect(response.statusCode).toBe(400);
  });
});
