import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";

describe("Clave pública de dispositivo: POST /users/me/device-key, GET /internal/users/:id/device-key (MOVO-157)", () => {
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

  // Base64 de 65 bytes -- shape realista de una clave pública EC (P-256) sin
  // comprimir, aunque el endpoint acepta cualquier base64 dentro del límite de
  // longitud (no interpreta el contenido, solo lo persiste).
  const SAMPLE_PUBLIC_KEY_A =
    "BBl2s3IuDMHrIsvHYXjRvbb+jTs6VwSivJXTMbo6BvKsELdJUV1kX3IEXXQtMFo1P+DGMjr1RQhrTKu7yAYPk8Y=";
  const SAMPLE_PUBLIC_KEY_B =
    "BEuVDkFyv+3jSGDaaBs4YsC5DfNlp6MfMY2VTqQi1LR8xY2gA9d7ZUAOwzCyXt9O5RxLJdCkzu53W/x3nRz7Fmc=";

  describe("POST /users/me/device-key", () => {
    it("registra una clave nueva (AC2) y GET /internal la resuelve (AC3)", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "POST",
        url: "/users/me/device-key",
        headers: { "x-user-id": user.id },
        payload: { publicKey: SAMPLE_PUBLIC_KEY_A },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.registeredAt).toEqual(expect.any(String));

      const rows = await app.db.deviceKey.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].publicKey).toBe(SAMPLE_PUBLIC_KEY_A);

      const internalResponse = await app.inject({
        method: "GET",
        url: `/internal/users/${user.id}/device-key`,
      });
      expect(internalResponse.statusCode).toBe(200);
      expect(JSON.parse(internalResponse.body)).toEqual({
        publicKey: SAMPLE_PUBLIC_KEY_A,
        registeredAt: body.registeredAt,
      });
    });

    it("rotar la clave (AC5) reemplaza la anterior -- nunca queda más de una fila por usuario", async () => {
      const user = await repo.create(buildInput());
      const register = (publicKey: string) =>
        app.inject({
          method: "POST",
          url: "/users/me/device-key",
          headers: { "x-user-id": user.id },
          payload: { publicKey },
        });

      await register(SAMPLE_PUBLIC_KEY_A);
      const second = await register(SAMPLE_PUBLIC_KEY_B);

      expect(second.statusCode).toBe(200);
      const rows = await app.db.deviceKey.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].publicKey).toBe(SAMPLE_PUBLIC_KEY_B);

      const internalResponse = await app.inject({
        method: "GET",
        url: `/internal/users/${user.id}/device-key`,
      });
      expect(JSON.parse(internalResponse.body).publicKey).toBe(SAMPLE_PUBLIC_KEY_B);
    });

    it("no toca la clave de otro usuario", async () => {
      const userA = await repo.create(buildInput());
      const userB = await repo.create(buildInput());

      await app.inject({
        method: "POST",
        url: "/users/me/device-key",
        headers: { "x-user-id": userA.id },
        payload: { publicKey: SAMPLE_PUBLIC_KEY_A },
      });
      await app.inject({
        method: "POST",
        url: "/users/me/device-key",
        headers: { "x-user-id": userB.id },
        payload: { publicKey: SAMPLE_PUBLIC_KEY_B },
      });

      const rowsA = await app.db.deviceKey.findMany({ where: { userId: userA.id } });
      const rowsB = await app.db.deviceKey.findMany({ where: { userId: userB.id } });
      expect(rowsA).toHaveLength(1);
      expect(rowsA[0].publicKey).toBe(SAMPLE_PUBLIC_KEY_A);
      expect(rowsB).toHaveLength(1);
      expect(rowsB[0].publicKey).toBe(SAMPLE_PUBLIC_KEY_B);
    });

    it("401 sin x-user-id", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/users/me/device-key",
        payload: { publicKey: SAMPLE_PUBLIC_KEY_A },
      });
      expect(response.statusCode).toBe(401);
    });

    it("404 con un x-user-id que no corresponde a ningún usuario existente", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/users/me/device-key",
        headers: { "x-user-id": randomUUID() },
        payload: { publicKey: SAMPLE_PUBLIC_KEY_A },
      });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe("USER_NOT_FOUND");
    });

    it("400 con publicKey vacío", async () => {
      const user = await repo.create(buildInput());
      const response = await app.inject({
        method: "POST",
        url: "/users/me/device-key",
        headers: { "x-user-id": user.id },
        payload: { publicKey: "" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("400 con publicKey que no es base64 válido", async () => {
      const user = await repo.create(buildInput());
      const response = await app.inject({
        method: "POST",
        url: "/users/me/device-key",
        headers: { "x-user-id": user.id },
        payload: { publicKey: "no es base64 !!" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("400 sin el campo publicKey", async () => {
      const user = await repo.create(buildInput());
      const response = await app.inject({
        method: "POST",
        url: "/users/me/device-key",
        headers: { "x-user-id": user.id },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });

    // MOVO-157 (review de PedroYorlano, PR #119): sin este chequeo, un x-user-id de
    // una cuenta ya eliminada (pero todavía existente en la fila, ver deleteAccount)
    // podía seguir registrando/rotando una clave de dispositivo.
    it("404 USER_NOT_FOUND con un x-user-id de una cuenta eliminada (deleted)", async () => {
      const user = await repo.create(buildInput());
      await app.db.user.update({ where: { id: user.id }, data: { status: "deleted" } });

      const response = await app.inject({
        method: "POST",
        url: "/users/me/device-key",
        headers: { "x-user-id": user.id },
        payload: { publicKey: SAMPLE_PUBLIC_KEY_A },
      });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe("USER_NOT_FOUND");
    });
  });

  describe("GET /internal/users/:id/device-key", () => {
    it("404 explícito DEVICE_KEY_NOT_FOUND si el usuario no tiene clave registrada (AC4)", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "GET",
        url: `/internal/users/${user.id}/device-key`,
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe("DEVICE_KEY_NOT_FOUND");
    });

    it("404 con un userId que no existe", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/internal/users/${randomUUID()}/device-key`,
      });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe("DEVICE_KEY_NOT_FOUND");
    });

    it("no se documenta en la Swagger pública", async () => {
      const response = await app.inject({ method: "GET", url: "/docs/json" });
      const swagger = JSON.parse(response.body);
      expect(swagger.paths["/internal/users/{id}/device-key"]).toBeUndefined();
    });
  });
});
