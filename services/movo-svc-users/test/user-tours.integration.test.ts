import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";

describe("PUT /users/me/tours/:tourId y tours en GET /users/me (MOVO-169)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
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
      firstName: "Pauli",
      lastName: "Yorlano",
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

  function putTour(userId: string, tourId: string, payload: unknown) {
    return app.inject({
      method: "PUT",
      url: `/users/me/tours/${tourId}`,
      headers: { "x-user-id": userId },
      payload: payload as Record<string, unknown>,
    });
  }

  async function getTours(userId: string) {
    const response = await app.inject({ method: "GET", url: "/users/me", headers: { "x-user-id": userId } });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body).tours;
  }

  it("usuario nuevo: GET /users/me devuelve tours vacío", async () => {
    const user = await repo.create(buildInput());
    expect(await getTours(user.id)).toEqual([]);
  });

  it("registra un tour omitido y GET /users/me lo refleja", async () => {
    const user = await repo.create(buildInput());

    const response = await putTour(user.id, "first_steps", { version: 1, outcome: "skipped" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ tourId: "first_steps", version: 1, outcome: "skipped" });
    expect(await getTours(user.id)).toEqual([{ tourId: "first_steps", version: 1, outcome: "skipped" }]);
  });

  it("es idempotente: repetir el mismo PUT deja una sola fila con el mismo estado", async () => {
    const user = await repo.create(buildInput());

    await putTour(user.id, "carrier", { version: 1, outcome: "completed" });
    const before = await app.db.userTour.findFirstOrThrow({ where: { userId: user.id } });
    const second = await putTour(user.id, "carrier", { version: 1, outcome: "completed" });
    const after = await app.db.userTour.findFirstOrThrow({ where: { userId: user.id } });

    expect(after.recordedAt).toEqual(before.recordedAt);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body)).toEqual({ tourId: "carrier", version: 1, outcome: "completed" });
    const count = await app.db.userTour.count({ where: { userId: user.id } });
    expect(count).toBe(1);
  });

  it("una versión mayor actualiza versión, outcome y recorded_at", async () => {
    const user = await repo.create(buildInput());
    await putTour(user.id, "first_steps", { version: 1, outcome: "skipped" });
    const before = await app.db.userTour.findUniqueOrThrow({
      where: { userId_tourId: { userId: user.id, tourId: "first_steps" } },
    });

    const response = await putTour(user.id, "first_steps", { version: 2, outcome: "completed" });

    expect(JSON.parse(response.body)).toEqual({ tourId: "first_steps", version: 2, outcome: "completed" });
    const after = await app.db.userTour.findUniqueOrThrow({
      where: { userId_tourId: { userId: user.id, tourId: "first_steps" } },
    });
    expect(after.recordedAt.getTime()).toBeGreaterThanOrEqual(before.recordedAt.getTime());
    expect(await getTours(user.id)).toEqual([{ tourId: "first_steps", version: 2, outcome: "completed" }]);
  });

  it("una versión menor no pisa el registro y devuelve el vigente", async () => {
    const user = await repo.create(buildInput());
    await putTour(user.id, "first_steps", { version: 2, outcome: "completed" });

    const response = await putTour(user.id, "first_steps", { version: 1, outcome: "skipped" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ tourId: "first_steps", version: 2, outcome: "completed" });
    expect(await getTours(user.id)).toEqual([{ tourId: "first_steps", version: 2, outcome: "completed" }]);
  });

  it("los dos tours conviven y no se mezclan entre usuarios", async () => {
    const user = await repo.create(buildInput());
    const other = await repo.create(buildInput());

    await putTour(user.id, "first_steps", { version: 1, outcome: "completed" });
    await putTour(user.id, "carrier", { version: 1, outcome: "skipped" });

    expect(await getTours(user.id)).toEqual([
      { tourId: "carrier", version: 1, outcome: "skipped" },
      { tourId: "first_steps", version: 1, outcome: "completed" },
    ]);
    expect(await getTours(other.id)).toEqual([]);
  });

  it("dos PUT simultáneos del primer registro no fallan", async () => {
    const user = await repo.create(buildInput());

    const responses = await Promise.all([
      putTour(user.id, "first_steps", { version: 1, outcome: "completed" }),
      putTour(user.id, "first_steps", { version: 1, outcome: "completed" }),
    ]);

    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(await app.db.userTour.count({ where: { userId: user.id } })).toBe(1);
  });

  it.each([
    ["tourId desconocido", "onboarding", { version: 1, outcome: "completed" }],
    ["outcome inválido", "first_steps", { version: 1, outcome: "dismissed" }],
    ["version 0", "first_steps", { version: 0, outcome: "completed" }],
    ["version sobre el máximo del Int de Postgres", "first_steps", { version: 2147483648, outcome: "completed" }],
    ["version no entera", "first_steps", { version: 1.5, outcome: "completed" }],
    ["sin version", "first_steps", { outcome: "completed" }],
    ["sin outcome", "first_steps", { version: 1 }],
  ])("400 con %s", async (_label, tourId, payload) => {
    const user = await repo.create(buildInput());

    const response = await putTour(user.id, tourId, payload);

    expect(response.statusCode).toBe(400);
    expect(await app.db.userTour.count({ where: { userId: user.id } })).toBe(0);
  });

  it("401 sin x-user-id", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/users/me/tours/first_steps",
      payload: { version: 1, outcome: "completed" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("404 si el usuario del header no existe", async () => {
    const response = await putTour(randomUUID(), "first_steps", { version: 1, outcome: "completed" });
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe("USER_NOT_FOUND");
  });
});
