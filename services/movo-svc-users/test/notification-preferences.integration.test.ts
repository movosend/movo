import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole, IMPLEMENTED_NOTIFICATION_CATEGORY_IDS } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";

describe("GET/PUT /users/me/notification-preferences (MOVO-245)", () => {
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

  describe("GET", () => {
    it("AC5: usuario que nunca tocó nada resuelve a todo habilitado, horario de silencio apagado", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "GET",
        url: "/users/me/notification-preferences",
        headers: { "x-user-id": user.id },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.pushEnabled).toBe(true);
      expect(body.quietHours).toEqual({ enabled: false, from: "23:00", to: "08:00" });
      expect(body.categories).toHaveLength(IMPLEMENTED_NOTIFICATION_CATEGORY_IDS.length);
      expect(body.categories.every((c: { enabled: boolean }) => c.enabled === true)).toBe(true);
    });

    it("401 sin x-user-id", async () => {
      const response = await app.inject({ method: "GET", url: "/users/me/notification-preferences" });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("PUT", () => {
    it("apaga el toggle maestro y lo persiste (AC4: sobrevive una nueva request)", async () => {
      const user = await repo.create(buildInput());

      const putResponse = await app.inject({
        method: "PUT",
        url: "/users/me/notification-preferences",
        headers: { "x-user-id": user.id },
        payload: { pushEnabled: false },
      });
      expect(putResponse.statusCode).toBe(200);
      expect(JSON.parse(putResponse.body).pushEnabled).toBe(false);

      const getResponse = await app.inject({
        method: "GET",
        url: "/users/me/notification-preferences",
        headers: { "x-user-id": user.id },
      });
      expect(JSON.parse(getResponse.body).pushEnabled).toBe(false);
    });

    it("apaga una categoría puntual sin tocar las demás", async () => {
      const user = await repo.create(buildInput());

      await app.inject({
        method: "PUT",
        url: "/users/me/notification-preferences",
        headers: { "x-user-id": user.id },
        payload: { categories: { offers: false } },
      });

      const response = await app.inject({
        method: "GET",
        url: "/users/me/notification-preferences",
        headers: { "x-user-id": user.id },
      });
      const categories: { id: string; enabled: boolean }[] = JSON.parse(response.body).categories;
      expect(categories.find((c) => c.id === "offers")?.enabled).toBe(false);
      expect(categories.filter((c) => c.id !== "offers").every((c) => c.enabled)).toBe(true);
    });

    it("volver a prender una categoría BORRA la fila (tabla sparse) -- no queda un valor 'true' persistido", async () => {
      const user = await repo.create(buildInput());

      await app.inject({
        method: "PUT",
        url: "/users/me/notification-preferences",
        headers: { "x-user-id": user.id },
        payload: { categories: { offers: false } },
      });
      await app.inject({
        method: "PUT",
        url: "/users/me/notification-preferences",
        headers: { "x-user-id": user.id },
        payload: { categories: { offers: true } },
      });

      const rows = await app.db.notificationCategoryPreference.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(0);
    });

    it("configura horario de silencio (activar + franja)", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "PUT",
        url: "/users/me/notification-preferences",
        headers: { "x-user-id": user.id },
        payload: { quietHours: { enabled: true, from: "22:00", to: "07:30" } },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).quietHours).toEqual({ enabled: true, from: "22:00", to: "07:30" });
    });

    it("400 con una categoría desconocida (ej. una 'Pronto' del catálogo de MOVO-240)", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "PUT",
        url: "/users/me/notification-preferences",
        headers: { "x-user-id": user.id },
        payload: { categories: { kyc: false } },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("400 con un formato de hora inválido", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "PUT",
        url: "/users/me/notification-preferences",
        headers: { "x-user-id": user.id },
        payload: { quietHours: { from: "25:99" } },
      });

      expect(response.statusCode).toBe(400);
    });

    it("no toca las preferencias de otro usuario", async () => {
      const userA = await repo.create(buildInput());
      const userB = await repo.create(buildInput());

      await app.inject({
        method: "PUT",
        url: "/users/me/notification-preferences",
        headers: { "x-user-id": userA.id },
        payload: { pushEnabled: false },
      });

      const responseB = await app.inject({
        method: "GET",
        url: "/users/me/notification-preferences",
        headers: { "x-user-id": userB.id },
      });
      expect(JSON.parse(responseB.body).pushEnabled).toBe(true);
    });

    it("401 sin x-user-id", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/users/me/notification-preferences",
        payload: { pushEnabled: false },
      });
      expect(response.statusCode).toBe(401);
    });
  });
});
