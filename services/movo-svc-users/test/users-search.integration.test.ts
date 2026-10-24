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

  describe("MOVO-340: insensible a tildes", () => {
    async function searchIds(callerId: string, q: string): Promise<string[]> {
      const response = await app.inject({
        method: "GET",
        url: `/users/search?q=${encodeURIComponent(q)}`,
        headers: { "x-user-id": callerId },
      });
      expect(response.statusCode).toBe(200);
      return (response.json() as Array<{ id: string }>).map((user) => user.id);
    }

    it.each(["tomas", "Tomas", "TOMÁS", "tomás", "TOMAS"])("%j encuentra a Tomás", async (q) => {
      const caller = await repo.create(buildInput());
      const target = await repo.create(buildInput({ firstName: "Tomás", lastName: "Vergara" }));

      expect(await searchIds(caller.id, q)).toEqual([target.id]);
    });

    it("con tilde encuentra un nombre cargado sin tilde", async () => {
      const caller = await repo.create(buildInput());
      const target = await repo.create(buildInput({ firstName: "Jose", lastName: "Perez" }));

      expect(await searchIds(caller.id, "José Pérez")).toEqual([target.id]);
    });

    it("las palabras matchean en cualquier orden, también con nombres de más de dos palabras", async () => {
      const caller = await repo.create(buildInput());
      const tomas = await repo.create(buildInput({ firstName: "Tomás Ignacio", lastName: "Vergara" }));
      await repo.create(buildInput({ firstName: "Tomás", lastName: "Pérez" }));

      expect(await searchIds(caller.id, "vergara tomas")).toEqual([tomas.id]);
      expect(await searchIds(caller.id, "ignacio vergara")).toEqual([tomas.id]);
    });

    it("la ñ se busca como n", async () => {
      const caller = await repo.create(buildInput());
      const target = await repo.create(buildInput({ firstName: "Lucía", lastName: "Peña" }));

      expect(await searchIds(caller.id, "pena")).toEqual([target.id]);
      expect(await searchIds(caller.id, "peña")).toEqual([target.id]);
    });

    it("los comodines de LIKE se buscan literales", async () => {
      const caller = await repo.create(buildInput());
      await repo.create(buildInput({ firstName: "Tomás", lastName: "Vergara" }));

      expect(await searchIds(caller.id, "to%as")).toEqual([]);
      expect(await searchIds(caller.id, "t_mas")).toEqual([]);
    });

    it("sigue excluyendo al propio caller y a los usuarios bloqueados", async () => {
      const caller = await repo.create(buildInput({ firstName: "Tomás", lastName: "Ariza" }));
      const blocked = await repo.create(buildInput({ firstName: "Tomás", lastName: "Bordino" }));
      const visible = await repo.create(buildInput({ firstName: "Tomás", lastName: "Vergara" }));
      await app.db.userBlock.create({ data: { blockerId: blocked.id, blockedId: caller.id } });

      expect(await searchIds(caller.id, "tomas")).toEqual([visible.id]);
    });
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

  it("MOVO-171: nunca incluye bio, aunque el usuario la haya completado", async () => {
    const caller = await repo.create(buildInput());
    const target = await repo.create(buildInput({ firstName: "Alena", lastName: "Ariza2" }));
    await repo.updateProfile(target.id, { bio: "No debería aparecer en la búsqueda" });

    const response = await app.inject({
      method: "GET",
      url: "/users/search?q=Alena",
      headers: { "x-user-id": caller.id },
    });

    const [result] = response.json();
    expect(result).not.toHaveProperty("bio");
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
