import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";

describe("Push token: POST /users/me/push-token, DELETE /users/me/push-token (MOVO-106)", () => {
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

  describe("POST /users/me/push-token", () => {
    it("registra un token nuevo (AC1/AC2)", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "POST",
        url: "/users/me/push-token",
        headers: { "x-user-id": user.id },
        payload: { expoPushToken: "ExponentPushToken[abc]", deviceId: "device-1", platform: "ios" },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ deviceId: "device-1", platform: "ios" });

      const rows = await app.db.pushToken.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].expoPushToken).toBe("ExponentPushToken[abc]");
    });

    it("hace upsert por (user_id, device_id) — repetir el mismo deviceId no crea una fila nueva", async () => {
      const user = await repo.create(buildInput());
      const register = (expoPushToken: string) =>
        app.inject({
          method: "POST",
          url: "/users/me/push-token",
          headers: { "x-user-id": user.id },
          payload: { expoPushToken, deviceId: "device-1", platform: "ios" },
        });

      await register("ExponentPushToken[old]");
      const second = await register("ExponentPushToken[new]");

      expect(second.statusCode).toBe(200);
      const rows = await app.db.pushToken.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].expoPushToken).toBe("ExponentPushToken[new]");
    });

    it("permite multi-dispositivo — dos deviceId distintos crean dos filas", async () => {
      const user = await repo.create(buildInput());
      const register = (deviceId: string, platform: string) =>
        app.inject({
          method: "POST",
          url: "/users/me/push-token",
          headers: { "x-user-id": user.id },
          payload: { expoPushToken: `ExponentPushToken[${deviceId}]`, deviceId, platform },
        });

      await register("device-1", "ios");
      await register("device-2", "android");

      const rows = await app.db.pushToken.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(2);
    });

    it("401 sin x-user-id", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/users/me/push-token",
        payload: { expoPushToken: "ExponentPushToken[abc]", deviceId: "device-1", platform: "ios" },
      });
      expect(response.statusCode).toBe(401);
    });

    it("400 con platform fuera del enum", async () => {
      const user = await repo.create(buildInput());
      const response = await app.inject({
        method: "POST",
        url: "/users/me/push-token",
        headers: { "x-user-id": user.id },
        payload: { expoPushToken: "ExponentPushToken[abc]", deviceId: "device-1", platform: "web" },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("DELETE /users/me/push-token", () => {
    it("borra el token del dispositivo (AC3)", async () => {
      const user = await repo.create(buildInput());
      await app.inject({
        method: "POST",
        url: "/users/me/push-token",
        headers: { "x-user-id": user.id },
        payload: { expoPushToken: "ExponentPushToken[abc]", deviceId: "device-1", platform: "ios" },
      });

      const response = await app.inject({
        method: "DELETE",
        url: "/users/me/push-token",
        headers: { "x-user-id": user.id },
        payload: { deviceId: "device-1" },
      });

      expect(response.statusCode).toBe(204);
      const rows = await app.db.pushToken.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(0);
    });

    it("es idempotente — sin token previo también responde 204", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "DELETE",
        url: "/users/me/push-token",
        headers: { "x-user-id": user.id },
        payload: { deviceId: "device-never-registered" },
      });

      expect(response.statusCode).toBe(204);
    });

    it("no borra el token de otro usuario con el mismo deviceId", async () => {
      const userA = await repo.create(buildInput());
      const userB = await repo.create(buildInput());
      await app.inject({
        method: "POST",
        url: "/users/me/push-token",
        headers: { "x-user-id": userA.id },
        payload: { expoPushToken: "ExponentPushToken[a]", deviceId: "shared-device-id", platform: "ios" },
      });
      await app.inject({
        method: "POST",
        url: "/users/me/push-token",
        headers: { "x-user-id": userB.id },
        payload: { expoPushToken: "ExponentPushToken[b]", deviceId: "shared-device-id", platform: "android" },
      });

      await app.inject({
        method: "DELETE",
        url: "/users/me/push-token",
        headers: { "x-user-id": userA.id },
        payload: { deviceId: "shared-device-id" },
      });

      const rowsB = await app.db.pushToken.findMany({ where: { userId: userB.id } });
      expect(rowsB).toHaveLength(1);
    });

    it("401 sin x-user-id", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/users/me/push-token",
        payload: { deviceId: "device-1" },
      });
      expect(response.statusCode).toBe(401);
    });
  });
});
