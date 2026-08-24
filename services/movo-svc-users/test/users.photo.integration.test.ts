import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";
import { createMockStorageProvider, MockStorageProvider } from "../src/adapters/mock-storage-provider";
import { PENDING_PHOTOS_REDIS_KEY } from "../src/modules/users/users.service";

describe("Foto de perfil: POST /users/me/photo/upload-url, PUT /users/me/photo, DELETE /users/me/photo (MOVO-97)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;
  let storage: MockStorageProvider;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    storage = createMockStorageProvider();
    app = buildApp({ storageProvider: storage });
    await app.ready();
    repo = createUserRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
    await app.redis.del(PENDING_PHOTOS_REDIS_KEY);
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

  async function requestUploadUrl(userId: string, overrides: Record<string, unknown> = {}) {
    return app.inject({
      method: "POST",
      url: "/users/me/photo/upload-url",
      headers: { "x-user-id": userId },
      payload: { contentType: "image/jpeg", contentLength: 1024, ...overrides },
    });
  }

  describe("POST /users/me/photo/upload-url", () => {
    it("emite una presigned URL con objectKey bajo profile-photos/{userId}/ (AC1/AC3)", async () => {
      const user = await repo.create(buildInput());

      const response = await requestUploadUrl(user.id);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.objectKey).toMatch(new RegExp(`^profile-photos/${user.id}/[0-9a-f-]+\\.jpg$`));
      expect(typeof body.uploadUrl).toBe("string");
      expect(body.expiresIn).toBe(300);

      // MOVO-124: la key queda trackeada como "pendiente" en Redis apenas se presigna.
      const score = await app.redis.zscore(PENDING_PHOTOS_REDIS_KEY, body.objectKey);
      expect(score).not.toBeNull();
    });

    it("rechaza un contentType fuera de la whitelist con 400 VALIDATION_FAILED (AC2)", async () => {
      const user = await repo.create(buildInput());

      const response = await requestUploadUrl(user.id, { contentType: "image/gif" });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("rechaza un contentLength mayor a 5 MB con 400 VALIDATION_FAILED (AC2)", async () => {
      const user = await repo.create(buildInput());

      const response = await requestUploadUrl(user.id, { contentLength: 5 * 1024 * 1024 + 1 });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("devuelve 401 AUTH_TOKEN_INVALID sin header x-user-id", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/users/me/photo/upload-url",
        payload: { contentType: "image/jpeg", contentLength: 1024 },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_TOKEN_INVALID");
    });
  });

  describe("PUT /users/me/photo", () => {
    it("confirma una subida feliz: persiste photo_url y lo refleja en GET /users/me (AC4/AC5)", async () => {
      const user = await repo.create(buildInput());
      const uploadUrlResponse = await requestUploadUrl(user.id);
      const { objectKey } = JSON.parse(uploadUrlResponse.body);
      storage.__simulateUpload(objectKey, { contentType: "image/jpeg", contentLength: 1024 });

      const confirmResponse = await app.inject({
        method: "PUT",
        url: "/users/me/photo",
        headers: { "x-user-id": user.id },
        payload: { objectKey },
      });

      expect(confirmResponse.statusCode).toBe(200);
      const { photoUrl } = JSON.parse(confirmResponse.body);
      expect(typeof photoUrl).toBe("string");

      // MOVO-124: al confirmar, la key sale del tracking de pendientes de Redis.
      const score = await app.redis.zscore(PENDING_PHOTOS_REDIS_KEY, objectKey);
      expect(score).toBeNull();

      const profileResponse = await app.inject({
        method: "GET",
        url: "/users/me",
        headers: { "x-user-id": user.id },
      });
      expect(JSON.parse(profileResponse.body).photoUrl).toBe(photoUrl);
    });

    it("rechaza un objectKey que no le pertenece al usuario con 403 PHOTO_FORBIDDEN_KEY (AC3)", async () => {
      const user = await repo.create(buildInput());
      const otherUserId = randomUUID();

      const response = await app.inject({
        method: "PUT",
        url: "/users/me/photo",
        headers: { "x-user-id": user.id },
        payload: { objectKey: `profile-photos/${otherUserId}/${randomUUID()}.jpg` },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error.code).toBe("PHOTO_FORBIDDEN_KEY");
    });

    it("rechaza confirmar un objeto que nunca se subió con 422 PHOTO_OBJECT_NOT_FOUND (AC4)", async () => {
      const user = await repo.create(buildInput());
      const uploadUrlResponse = await requestUploadUrl(user.id);
      const { objectKey } = JSON.parse(uploadUrlResponse.body);
      // Nunca se llama a storage.__simulateUpload(objectKey, ...) -- el objeto no existe.

      const response = await app.inject({
        method: "PUT",
        url: "/users/me/photo",
        headers: { "x-user-id": user.id },
        payload: { objectKey },
      });

      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error.code).toBe("PHOTO_OBJECT_NOT_FOUND");
    });

    it("al reemplazar la foto, borra el objeto anterior de S3 (AC6)", async () => {
      const user = await repo.create(buildInput());

      const firstUploadUrl = await requestUploadUrl(user.id);
      const { objectKey: firstKey } = JSON.parse(firstUploadUrl.body);
      storage.__simulateUpload(firstKey, { contentType: "image/jpeg", contentLength: 1024 });
      const firstConfirm = await app.inject({
        method: "PUT",
        url: "/users/me/photo",
        headers: { "x-user-id": user.id },
        payload: { objectKey: firstKey },
      });
      expect(firstConfirm.statusCode).toBe(200);

      const secondUploadUrl = await requestUploadUrl(user.id);
      const { objectKey: secondKey } = JSON.parse(secondUploadUrl.body);
      storage.__simulateUpload(secondKey, { contentType: "image/jpeg", contentLength: 2048 });
      const secondConfirm = await app.inject({
        method: "PUT",
        url: "/users/me/photo",
        headers: { "x-user-id": user.id },
        payload: { objectKey: secondKey },
      });
      expect(secondConfirm.statusCode).toBe(200);
      expect(JSON.parse(secondConfirm.body).photoUrl).toBe(JSON.parse(firstConfirm.body).photoUrl.replace(firstKey, secondKey));

      const oldHead = await storage.headObject(firstKey);
      expect(oldHead.exists).toBe(false);
      const newHead = await storage.headObject(secondKey);
      expect(newHead.exists).toBe(true);
    });
  });

  describe("DELETE /users/me/photo", () => {
    it("deja photo_url en null, borra el objeto de S3 y es idempotente (AC7)", async () => {
      const user = await repo.create(buildInput());
      const uploadUrlResponse = await requestUploadUrl(user.id);
      const { objectKey } = JSON.parse(uploadUrlResponse.body);
      storage.__simulateUpload(objectKey, { contentType: "image/jpeg", contentLength: 1024 });
      await app.inject({
        method: "PUT",
        url: "/users/me/photo",
        headers: { "x-user-id": user.id },
        payload: { objectKey },
      });

      const firstDelete = await app.inject({
        method: "DELETE",
        url: "/users/me/photo",
        headers: { "x-user-id": user.id },
      });
      expect(firstDelete.statusCode).toBe(204);

      const profileResponse = await app.inject({
        method: "GET",
        url: "/users/me",
        headers: { "x-user-id": user.id },
      });
      expect(JSON.parse(profileResponse.body).photoUrl).toBeNull();

      const head = await storage.headObject(objectKey);
      expect(head.exists).toBe(false);

      const secondDelete = await app.inject({
        method: "DELETE",
        url: "/users/me/photo",
        headers: { "x-user-id": user.id },
      });
      expect(secondDelete.statusCode).toBe(204);
    });

    it("devuelve 204 idempotente cuando el usuario nunca tuvo foto", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "DELETE",
        url: "/users/me/photo",
        headers: { "x-user-id": user.id },
      });

      expect(response.statusCode).toBe(204);
    });
  });
});
