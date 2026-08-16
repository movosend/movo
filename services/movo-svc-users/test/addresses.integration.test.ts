import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import {
  createUserRepository,
  UserRepository,
} from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";

describe("Direcciones guardadas: GET/POST /addresses, PATCH/DELETE /addresses/:id (MOVO-119)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
    await app.ready();
    repo = createUserRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe(
      "TRUNCATE TABLE users.users RESTART IDENTITY CASCADE",
    );
  });

  function buildInput(
    overrides: Partial<CreateUserInput> = {},
  ): CreateUserInput {
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

  function createBody(overrides: Record<string, unknown> = {}) {
    return {
      street: "Bv. San Juan",
      streetNumber: "500",
      city: "Córdoba",
      province: "Córdoba",
      postalCode: "5000",
      country: "AR",
      lat: -31.42,
      long: -64.18,
      ...overrides,
    };
  }

  describe("GET /addresses", () => {
    it("devuelve la dirección de registro, marcada default (backfill de MOVO-119)", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "GET",
        url: "/addresses",
        headers: { "x-user-id": user.id },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveLength(1);
      expect(body[0].isDefault).toBe(true);
      expect(body[0].street).toBe("Av. Colón");
    });

    it("ordena default primero, luego por createdAt descendente", async () => {
      const user = await repo.create(buildInput());
      await app.db.address.deleteMany({ where: { userId: user.id } });

      const post = (label: string, isDefault?: boolean) =>
        app.inject({
          method: "POST",
          url: "/addresses",
          headers: { "x-user-id": user.id },
          payload: createBody({
            label,
            ...(isDefault !== undefined ? { isDefault } : {}),
          }),
        });

      await post("primera"); // count=0 -> forzada default
      await post("segunda", false);
      await post("tercera", false);

      const response = await app.inject({
        method: "GET",
        url: "/addresses",
        headers: { "x-user-id": user.id },
      });
      const body = JSON.parse(response.body);
      expect(body.map((a: { label: string }) => a.label)).toEqual([
        "primera",
        "tercera",
        "segunda",
      ]);
      expect(body[0].isDefault).toBe(true);
      expect(body[1].isDefault).toBe(false);
      expect(body[2].isDefault).toBe(false);
    });

    it("401 sin x-user-id", async () => {
      const response = await app.inject({ method: "GET", url: "/addresses" });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /addresses", () => {
    it("fuerza isDefault:true en la primera dirección del usuario, sin importar el body", async () => {
      const user = await repo.create(buildInput());
      await app.db.address.deleteMany({ where: { userId: user.id } });

      const response = await app.inject({
        method: "POST",
        url: "/addresses",
        headers: { "x-user-id": user.id },
        payload: createBody({ isDefault: false }),
      });

      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body).isDefault).toBe(true);
    });

    it("una segunda dirección con isDefault:true desmarca la default anterior", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "POST",
        url: "/addresses",
        headers: { "x-user-id": user.id },
        payload: createBody({ isDefault: true }),
      });

      expect(response.statusCode).toBe(201);
      const rows = await app.db.address.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
      });
      expect(rows).toHaveLength(2);
      expect(rows[0].isDefault).toBe(false);
      expect(rows[1].isDefault).toBe(true);
    });

    it("una segunda dirección sin isDefault no toca la default existente", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "POST",
        url: "/addresses",
        headers: { "x-user-id": user.id },
        payload: createBody(),
      });

      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body).isDefault).toBe(false);
      const rows = await app.db.address.findMany({
        where: { userId: user.id },
      });
      expect(rows.filter((r) => r.isDefault)).toHaveLength(1);
    });

    it("401 sin x-user-id", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/addresses",
        payload: createBody(),
      });
      expect(response.statusCode).toBe(401);
    });

    it("400 sin un campo requerido", async () => {
      const user = await repo.create(buildInput());
      const { street: _street, ...withoutStreet } = createBody();
      const response = await app.inject({
        method: "POST",
        url: "/addresses",
        headers: { "x-user-id": user.id },
        payload: withoutStreet,
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("PATCH /addresses/:id", () => {
    it("actualiza campos parciales sin tocar isDefault", async () => {
      const user = await repo.create(buildInput());
      const [existing] = await app.db.address.findMany({
        where: { userId: user.id },
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/addresses/${existing.id}`,
        headers: { "x-user-id": user.id },
        payload: { city: "Villa Carlos Paz" },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.city).toBe("Villa Carlos Paz");
      expect(body.isDefault).toBe(true);
    });

    it("isDefault:true hace el swap atómico con la default anterior", async () => {
      const user = await repo.create(buildInput());
      const created = await app.inject({
        method: "POST",
        url: "/addresses",
        headers: { "x-user-id": user.id },
        payload: createBody(),
      });
      const secondId = JSON.parse(created.body).id;

      const response = await app.inject({
        method: "PATCH",
        url: `/addresses/${secondId}`,
        headers: { "x-user-id": user.id },
        payload: { isDefault: true },
      });

      expect(response.statusCode).toBe(200);
      const rows = await app.db.address.findMany({
        where: { userId: user.id },
      });
      expect(rows.filter((r) => r.isDefault)).toHaveLength(1);
      expect(rows.find((r) => r.id === secondId)?.isDefault).toBe(true);
    });

    it("403 sobre una dirección de otro usuario (nunca 404 filtrado)", async () => {
      const owner = await repo.create(buildInput());
      const stranger = await repo.create(buildInput());
      const [address] = await app.db.address.findMany({
        where: { userId: owner.id },
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/addresses/${address.id}`,
        headers: { "x-user-id": stranger.id },
        payload: { city: "Otra ciudad" },
      });

      expect(response.statusCode).toBe(403);
    });

    it("404 sobre un id inexistente", async () => {
      const user = await repo.create(buildInput());
      const response = await app.inject({
        method: "PATCH",
        url: `/addresses/${randomUUID()}`,
        headers: { "x-user-id": user.id },
        payload: { city: "Otra ciudad" },
      });
      expect(response.statusCode).toBe(404);
    });

    it("401 sin x-user-id", async () => {
      const user = await repo.create(buildInput());
      const [address] = await app.db.address.findMany({
        where: { userId: user.id },
      });
      const response = await app.inject({
        method: "PATCH",
        url: `/addresses/${address.id}`,
        payload: { city: "Otra ciudad" },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("DELETE /addresses/:id", () => {
    it("borra una dirección no-default sin afectar la default", async () => {
      const user = await repo.create(buildInput());
      const created = await app.inject({
        method: "POST",
        url: "/addresses",
        headers: { "x-user-id": user.id },
        payload: createBody(),
      });
      const secondId = JSON.parse(created.body).id;

      const response = await app.inject({
        method: "DELETE",
        url: `/addresses/${secondId}`,
        headers: { "x-user-id": user.id },
      });

      expect(response.statusCode).toBe(204);
      const rows = await app.db.address.findMany({
        where: { userId: user.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].isDefault).toBe(true);
    });

    it("al borrar la default con otras restantes, promueve la más reciente", async () => {
      const user = await repo.create(buildInput());
      const [original] = await app.db.address.findMany({
        where: { userId: user.id },
      });
      const created = await app.inject({
        method: "POST",
        url: "/addresses",
        headers: { "x-user-id": user.id },
        payload: createBody(),
      });
      const secondId = JSON.parse(created.body).id;

      const response = await app.inject({
        method: "DELETE",
        url: `/addresses/${original.id}`,
        headers: { "x-user-id": user.id },
      });

      expect(response.statusCode).toBe(204);
      const rows = await app.db.address.findMany({
        where: { userId: user.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(secondId);
      expect(rows[0].isDefault).toBe(true);
    });

    it("al borrar la única dirección no queda ninguna default (sin error)", async () => {
      const user = await repo.create(buildInput());
      const [original] = await app.db.address.findMany({
        where: { userId: user.id },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/addresses/${original.id}`,
        headers: { "x-user-id": user.id },
      });

      expect(response.statusCode).toBe(204);
      const rows = await app.db.address.findMany({
        where: { userId: user.id },
      });
      expect(rows).toHaveLength(0);
    });

    it("403 sobre una dirección de otro usuario (nunca 404 filtrado)", async () => {
      const owner = await repo.create(buildInput());
      const stranger = await repo.create(buildInput());
      const [address] = await app.db.address.findMany({
        where: { userId: owner.id },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/addresses/${address.id}`,
        headers: { "x-user-id": stranger.id },
      });

      expect(response.statusCode).toBe(403);
      const rows = await app.db.address.findMany({
        where: { userId: owner.id },
      });
      expect(rows).toHaveLength(1);
    });

    it("404 sobre un id inexistente", async () => {
      const user = await repo.create(buildInput());
      const response = await app.inject({
        method: "DELETE",
        url: `/addresses/${randomUUID()}`,
        headers: { "x-user-id": user.id },
      });
      expect(response.statusCode).toBe(404);
    });

    it("401 sin x-user-id", async () => {
      const user = await repo.create(buildInput());
      const [address] = await app.db.address.findMany({
        where: { userId: user.id },
      });
      const response = await app.inject({
        method: "DELETE",
        url: `/addresses/${address.id}`,
      });
      expect(response.statusCode).toBe(401);
    });
  });
});
