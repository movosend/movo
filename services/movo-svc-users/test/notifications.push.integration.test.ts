import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";
import { createMockPushProvider, MockPushProvider } from "../src/adapters/mock-push-provider";

describe("Endpoint interno POST /internal/notifications/push (MOVO-106 AC6)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;
  let pushProvider: MockPushProvider;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    pushProvider = createMockPushProvider();
    app = buildApp({ pushProvider });
    await app.ready();
    repo = createUserRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
    pushProvider.__sentNotifications.length = 0;
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

  async function registerToken(userId: string, deviceId: string, expoPushToken: string) {
    await app.inject({
      method: "POST",
      url: "/users/me/push-token",
      headers: { "x-user-id": userId },
      payload: { expoPushToken, deviceId, platform: "ios" },
    });
  }

  it("204 y no envía nada con un usuario sin tokens registrados", async () => {
    const user = await repo.create(buildInput());

    const response = await app.inject({
      method: "POST",
      url: "/internal/notifications/push",
      payload: { userId: user.id, title: "Hola", body: "Tenés una oferta" },
    });

    expect(response.statusCode).toBe(204);
    expect(pushProvider.__sentNotifications).toHaveLength(0);
  });

  it("envía a un usuario con un solo token registrado", async () => {
    const user = await repo.create(buildInput());
    await registerToken(user.id, "device-1", "ExponentPushToken[abc]");

    const response = await app.inject({
      method: "POST",
      url: "/internal/notifications/push",
      payload: { userId: user.id, title: "Nueva oferta", body: "Tenés una oferta nueva", data: { type: "shipment", shipmentId: "s1" } },
    });

    expect(response.statusCode).toBe(204);
    expect(pushProvider.__sentNotifications).toEqual([
      {
        expoPushToken: "ExponentPushToken[abc]",
        title: "Nueva oferta",
        body: "Tenés una oferta nueva",
        data: { type: "shipment", shipmentId: "s1" },
      },
    ]);
  });

  it("envía a todos los dispositivos de un usuario con N tokens registrados", async () => {
    const user = await repo.create(buildInput());
    await registerToken(user.id, "device-1", "ExponentPushToken[a]");
    await registerToken(user.id, "device-2", "ExponentPushToken[b]");
    await registerToken(user.id, "device-3", "ExponentPushToken[c]");

    const response = await app.inject({
      method: "POST",
      url: "/internal/notifications/push",
      payload: { userId: user.id, title: "t", body: "b" },
    });

    expect(response.statusCode).toBe(204);
    expect(pushProvider.__sentNotifications).toHaveLength(3);
  });

  it("un token que falla no aborta el envío al resto (AC6)", async () => {
    const user = await repo.create(buildInput());
    await registerToken(user.id, "device-ok", "ExponentPushToken[ok]");
    await registerToken(user.id, "device-fail", "ExponentPushToken[FAIL]");

    const failingProvider = createMockPushProvider();
    const originalSend = failingProvider.send.bind(failingProvider);
    failingProvider.send = async (input) => {
      if (input.expoPushToken === "ExponentPushToken[FAIL]") {
        throw new Error("token inválido");
      }
      return originalSend(input);
    };

    const localApp = buildApp({ pushProvider: failingProvider });
    await localApp.ready();

    const response = await localApp.inject({
      method: "POST",
      url: "/internal/notifications/push",
      payload: { userId: user.id, title: "t", body: "b" },
    });

    expect(response.statusCode).toBe(204);
    expect(failingProvider.__sentNotifications).toHaveLength(1);
    expect(failingProvider.__sentNotifications[0].expoPushToken).toBe("ExponentPushToken[ok]");

    await localApp.close();
  });

  it("no se documenta en la Swagger pública (AC7)", async () => {
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const swagger = JSON.parse(response.body);
    expect(swagger.paths["/internal/notifications/push"]).toBeUndefined();
  });
});
