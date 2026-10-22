import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";

describe("POST /internal/users/deletion-status (MOVO-230)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({ orphanPhotoSweepEnabled: false, sanctionSweepEnabled: false, kycAbandonedSweepEnabled: false });
    await app.ready();
    repo = createUserRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
  });

  function buildInput(): CreateUserInput {
    return {
      email: `user-${randomUUID()}@movo.test`,
      phone: `+549351${Math.floor(1000000 + Math.random() * 8999999)}`,
      firstName: "Juan",
      lastName: "Bordino",
      passwordHash: "hashed_password",
      roles: [UserRole.SENDER],
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
    };
  }

  async function deletionStatus(ids: string[]) {
    return app.inject({ method: "POST", url: "/internal/users/deletion-status", payload: { ids } });
  }

  it("devuelve la fecha de baja de las cuentas dadas de baja y null para el resto", async () => {
    const active = await repo.create(buildInput());
    const deleted = await repo.create(buildInput());
    await repo.anonymizeAndDelete(deleted.id);
    const banned = await repo.create(buildInput());
    await app.db.user.update({ where: { id: banned.id }, data: { status: "banned" } });
    const unknown = randomUUID();

    const response = await deletionStatus([active.id, deleted.id, banned.id, unknown]);

    expect(response.statusCode).toBe(200);
    const { users } = JSON.parse(response.body) as { users: { id: string; deletedAt: string | null }[] };
    const byId = new Map(users.map((user) => [user.id, user.deletedAt]));
    const stored = await app.db.user.findUniqueOrThrow({ where: { id: deleted.id } });
    expect(byId.get(deleted.id)).toBe(stored.deletedAt?.toISOString());
    expect(byId.get(active.id)).toBeNull();
    // Una sanción no es una baja.
    expect(byId.get(banned.id)).toBeNull();
    expect(byId.get(unknown)).toBeNull();
  });

  it("una baja anterior a MOVO-294 (sin deletedAt) cae a updatedAt", async () => {
    const legacy = await repo.create(buildInput());
    await app.db.user.update({ where: { id: legacy.id }, data: { status: "deleted", deletedAt: null } });
    const stored = await app.db.user.findUniqueOrThrow({ where: { id: legacy.id } });

    const { users } = JSON.parse((await deletionStatus([legacy.id])).body);

    expect(users).toEqual([{ id: legacy.id, deletedAt: stored.updatedAt.toISOString() }]);
  });

  it("deduplica ids repetidos", async () => {
    const user = await repo.create(buildInput());

    const { users } = JSON.parse((await deletionStatus([user.id, user.id])).body);

    expect(users).toEqual([{ id: user.id, deletedAt: null }]);
  });

  it("rechaza ids que no son uuid y lotes de más de 500", async () => {
    expect((await deletionStatus(["no-es-un-uuid"])).statusCode).toBe(400);
    expect((await deletionStatus(Array.from({ length: 501 }, () => randomUUID()))).statusCode).toBe(400);
  });
});
