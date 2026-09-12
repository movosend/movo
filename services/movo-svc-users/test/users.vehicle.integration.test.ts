import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";

describe("Ficha de vehículo del transportista: PUT/GET /users/me/vehicle (MOVO-172)", () => {
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

  const VEHICLE_A = {
    brand: "Renault",
    model: "Kangoo",
    cargoCapacityLabel: "Baúl mediano · hasta 15 kg",
    licensePlate: "AB123CD",
  };
  const VEHICLE_B = {
    brand: "Fiat",
    model: "Fiorino",
    cargoCapacityLabel: "Baúl grande · hasta 30 kg",
    licensePlate: "AC456DE",
  };

  describe("PUT /users/me/vehicle", () => {
    it("registra una ficha nueva y la devuelve completa", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "PUT",
        url: "/users/me/vehicle",
        headers: { "x-user-id": user.id },
        payload: VEHICLE_A,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(VEHICLE_A);

      const rows = await app.db.vehicleProfile.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject(VEHICLE_A);
    });

    it("rotar la ficha (upsert) reemplaza la anterior -- nunca queda más de una fila por usuario", async () => {
      const user = await repo.create(buildInput());
      const upsert = (payload: typeof VEHICLE_A) =>
        app.inject({
          method: "PUT",
          url: "/users/me/vehicle",
          headers: { "x-user-id": user.id },
          payload,
        });

      await upsert(VEHICLE_A);
      const second = await upsert(VEHICLE_B);

      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.body)).toEqual(VEHICLE_B);

      const rows = await app.db.vehicleProfile.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject(VEHICLE_B);
    });

    it("no toca la ficha de otro usuario", async () => {
      const userA = await repo.create(buildInput());
      const userB = await repo.create(buildInput());

      await app.inject({
        method: "PUT",
        url: "/users/me/vehicle",
        headers: { "x-user-id": userA.id },
        payload: VEHICLE_A,
      });
      await app.inject({
        method: "PUT",
        url: "/users/me/vehicle",
        headers: { "x-user-id": userB.id },
        payload: VEHICLE_B,
      });

      const rowsA = await app.db.vehicleProfile.findMany({ where: { userId: userA.id } });
      const rowsB = await app.db.vehicleProfile.findMany({ where: { userId: userB.id } });
      expect(rowsA).toHaveLength(1);
      expect(rowsA[0]).toMatchObject(VEHICLE_A);
      expect(rowsB).toHaveLength(1);
      expect(rowsB[0]).toMatchObject(VEHICLE_B);
    });

    it("401 sin x-user-id", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/users/me/vehicle",
        payload: VEHICLE_A,
      });
      expect(response.statusCode).toBe(401);
    });

    it("404 con un x-user-id que no corresponde a ningún usuario existente", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/users/me/vehicle",
        headers: { "x-user-id": randomUUID() },
        payload: VEHICLE_A,
      });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe("USER_NOT_FOUND");
    });

    it("404 USER_NOT_FOUND con un x-user-id de una cuenta eliminada (deleted)", async () => {
      const user = await repo.create(buildInput());
      await app.db.user.update({ where: { id: user.id }, data: { status: "deleted" } });

      const response = await app.inject({
        method: "PUT",
        url: "/users/me/vehicle",
        headers: { "x-user-id": user.id },
        payload: VEHICLE_A,
      });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe("USER_NOT_FOUND");
    });

    it("400 con brand vacío", async () => {
      const user = await repo.create(buildInput());
      const response = await app.inject({
        method: "PUT",
        url: "/users/me/vehicle",
        headers: { "x-user-id": user.id },
        payload: { ...VEHICLE_A, brand: "" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("400 sin licensePlate", async () => {
      const user = await repo.create(buildInput());
      const { licensePlate: _licensePlate, ...withoutLicensePlate } = VEHICLE_A;
      const response = await app.inject({
        method: "PUT",
        url: "/users/me/vehicle",
        headers: { "x-user-id": user.id },
        payload: withoutLicensePlate,
      });
      expect(response.statusCode).toBe(400);
    });

    // AJV con `removeAdditional:true` global (ver users.schema.ts#patchProfileBody,
    // MOVO-133) descarta en silencio un campo no declarado en vez de rechazarlo --
    // mismo comportamiento que registerDeviceKeyBody, sin un preValidation dedicado
    // que no está en el alcance de este ticket.
    it("ignora en silencio un campo extra no declarado (no lo persiste)", async () => {
      const user = await repo.create(buildInput());
      const response = await app.inject({
        method: "PUT",
        url: "/users/me/vehicle",
        headers: { "x-user-id": user.id },
        payload: { ...VEHICLE_A, color: "rojo" },
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(VEHICLE_A);
    });
  });

  describe("GET /users/me/vehicle", () => {
    it("200 con body null si el usuario todavía no cargó ficha", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "GET",
        url: "/users/me/vehicle",
        headers: { "x-user-id": user.id },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe("null");
    });

    it("200 con la ficha cargada", async () => {
      const user = await repo.create(buildInput());
      await app.inject({
        method: "PUT",
        url: "/users/me/vehicle",
        headers: { "x-user-id": user.id },
        payload: VEHICLE_A,
      });

      const response = await app.inject({
        method: "GET",
        url: "/users/me/vehicle",
        headers: { "x-user-id": user.id },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(VEHICLE_A);
    });

    it("401 sin x-user-id", async () => {
      const response = await app.inject({ method: "GET", url: "/users/me/vehicle" });
      expect(response.statusCode).toBe(401);
    });

    it("404 con un x-user-id que no corresponde a ningún usuario existente", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/users/me/vehicle",
        headers: { "x-user-id": randomUUID() },
      });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe("USER_NOT_FOUND");
    });

    it("404 USER_NOT_FOUND con un x-user-id de una cuenta eliminada (deleted)", async () => {
      const user = await repo.create(buildInput());
      await app.db.user.update({ where: { id: user.id }, data: { status: "deleted" } });

      const response = await app.inject({
        method: "GET",
        url: "/users/me/vehicle",
        headers: { "x-user-id": user.id },
      });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe("USER_NOT_FOUND");
    });
  });

  describe("DoD -- perfil público con y sin vehículo cargado", () => {
    it("GET /users/:id trae vehicle con el objeto cuando el transportista cargó ficha", async () => {
      const user = await repo.create(buildInput());
      const viewer = await repo.create(buildInput());
      await app.inject({
        method: "PUT",
        url: "/users/me/vehicle",
        headers: { "x-user-id": user.id },
        payload: VEHICLE_A,
      });

      const response = await app.inject({
        method: "GET",
        url: `/users/${user.id}`,
        headers: { "x-user-id": viewer.id },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).vehicle).toEqual(VEHICLE_A);
    });

    it("GET /users/:id trae vehicle: null cuando no cargó ficha", async () => {
      const user = await repo.create(buildInput());
      const viewer = await repo.create(buildInput());

      const response = await app.inject({
        method: "GET",
        url: `/users/${user.id}`,
        headers: { "x-user-id": viewer.id },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).vehicle).toBeNull();
    });

    it("GET /users/search no expone la clave vehicle (se descarta a nivel de schema, mismo criterio que bio)", async () => {
      const user = await repo.create(buildInput({ firstName: "Vehiculado" }));
      const viewer = await repo.create(buildInput());
      await app.inject({
        method: "PUT",
        url: "/users/me/vehicle",
        headers: { "x-user-id": user.id },
        payload: VEHICLE_A,
      });

      const response = await app.inject({
        method: "GET",
        url: "/users/search?q=Vehiculado",
        headers: { "x-user-id": viewer.id },
      });

      expect(response.statusCode).toBe(200);
      const results = JSON.parse(response.body);
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.vehicle).toBeUndefined();
      }
    });
  });
});
