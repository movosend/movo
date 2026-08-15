import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";

describe("GET /users/search (MOVO-80)", () => {
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

  it("busca por substring de nombre, case-insensitive", async () => {
    const caller = await repo.create(buildInput());
    const target = await repo.create(buildInput({ firstName: "Juan Cruz", lastName: "Bordino" }));
    await repo.create(buildInput({ firstName: "Tomás", lastName: "Vergara" }));

    const response = await app.inject({
      method: "GET",
      url: "/users/search?q=juan",
      headers: { "x-user-id": caller.id },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(target.id);
    expect(body[0].fullName).toBe("Juan Cruz Bordino");
  });

  it("matchea nombre completo (nombre + apellido) en cualquier orden", async () => {
    const caller = await repo.create(buildInput());
    const target = await repo.create(buildInput({ firstName: "Pedro", lastName: "Yorlano" }));

    const response = await app.inject({
      method: "GET",
      url: "/users/search?q=Pedro Yorlano",
      headers: { "x-user-id": caller.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().map((u: { id: string }) => u.id)).toContain(target.id);
  });

  it("excluye al propio caller de los resultados", async () => {
    const caller = await repo.create(buildInput({ firstName: "Lucas", lastName: "Dalmagro" }));

    const response = await app.inject({
      method: "GET",
      url: "/users/search?q=Lucas",
      headers: { "x-user-id": caller.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("no matchea por email ni teléfono (evita enumeración)", async () => {
    const caller = await repo.create(buildInput());
    const target = await repo.create(buildInput());

    const response = await app.inject({
      method: "GET",
      url: `/users/search?q=${encodeURIComponent(target.email)}`,
      headers: { "x-user-id": caller.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("devuelve la proyección pública (sin email/teléfono)", async () => {
    const caller = await repo.create(buildInput());
    await repo.create(buildInput({ firstName: "Alena", lastName: "Ariza2" }));

    const response = await app.inject({
      method: "GET",
      url: "/users/search?q=Alena",
      headers: { "x-user-id": caller.id },
    });

    const [result] = response.json();
    expect(result).not.toHaveProperty("email");
    expect(result).not.toHaveProperty("phone");
    expect(result).toHaveProperty("isVerified");
  });

  it("excluye usuarios con baja lógica (status deleted), mismo criterio que GET /users/:id", async () => {
    const caller = await repo.create(buildInput());
    const deletedUser = await repo.create(buildInput({ firstName: "Marina", lastName: "Soft-Deleted" }));
    await app.db.$executeRawUnsafe(
      `UPDATE users.users SET status = 'deleted' WHERE id = '${deletedUser.id}'`
    );

    const response = await app.inject({
      method: "GET",
      url: "/users/search?q=Marina",
      headers: { "x-user-id": caller.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("incluye usuarios baneados (sanción reversible, no una baja voluntaria)", async () => {
    const caller = await repo.create(buildInput());
    const bannedUser = await repo.create(buildInput({ firstName: "Ramiro", lastName: "Baneado" }));
    await app.db.$executeRawUnsafe(`UPDATE users.users SET status = 'banned' WHERE id = '${bannedUser.id}'`);

    const response = await app.inject({
      method: "GET",
      url: "/users/search?q=Ramiro",
      headers: { "x-user-id": caller.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().map((u: { id: string }) => u.id)).toContain(bannedUser.id);
  });

  it("responde 400 con un término de búsqueda demasiado corto", async () => {
    const caller = await repo.create(buildInput());
    const response = await app.inject({
      method: "GET",
      url: "/users/search?q=a",
      headers: { "x-user-id": caller.id },
    });
    expect(response.statusCode).toBe(400);
  });

  it("responde 401 sin autenticación", async () => {
    const response = await app.inject({ method: "GET", url: "/users/search?q=alguien" });
    expect(response.statusCode).toBe(401);
  });
});
