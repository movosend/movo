import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole, KycStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";

describe("GET /users/me y GET /users/:id (MOVO-77)", () => {
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

  describe("GET /users/me", () => {
    it("devuelve el perfil privado completo del usuario autenticado", async () => {
      const user = await repo.create(buildInput());

      const response = await app.inject({
        method: "GET",
        url: "/users/me",
        headers: { "x-user-id": user.id },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        id: user.id,
        firstName: "Alena",
        lastName: "Ariza",
        fullName: "Alena Ariza",
        email: user.email,
        phone: user.phone,
        photoUrl: null,
        kycStatus: KycStatus.NOT_STARTED,
        licenseKycStatus: KycStatus.NOT_STARTED,
        accountStatus: "active",
        badges: [],
        transactionCounts: { asSender: 0, asCarrier: 0 },
        reputationScore: null,
      });
      expect(body.roles.sort()).toEqual([UserRole.CARRIER, UserRole.SENDER].sort());
    });

    it("incluye la insignia kyc_verified cuando el KYC de identidad está aprobado", async () => {
      const user = await repo.create(buildInput());
      await repo.updateKycStatusIdentity(user.id, KycStatus.APPROVED);

      const response = await app.inject({
        method: "GET",
        url: "/users/me",
        headers: { "x-user-id": user.id },
      });

      const body = JSON.parse(response.body);
      expect(body.kycStatus).toBe(KycStatus.APPROVED);
      expect(body.badges).toEqual(["kyc_verified"]);
    });

    it("incluye la insignia license_verified cuando kyc_status_license está aprobado (MOVO-15)", async () => {
      const user = await repo.create(buildInput());
      await repo.updateKycStatusLicense(user.id, KycStatus.APPROVED);

      const response = await app.inject({
        method: "GET",
        url: "/users/me",
        headers: { "x-user-id": user.id },
      });

      const body = JSON.parse(response.body);
      expect(body.licenseKycStatus).toBe(KycStatus.APPROVED);
      expect(body.kycStatus).toBe(KycStatus.NOT_STARTED);
      expect(body.badges).toEqual(["license_verified"]);
    });

    it("incluye ambas insignias cuando identidad y licencia están aprobadas", async () => {
      const user = await repo.create(buildInput());
      await repo.updateKycStatusIdentity(user.id, KycStatus.APPROVED);
      await repo.updateKycStatusLicense(user.id, KycStatus.APPROVED);

      const response = await app.inject({
        method: "GET",
        url: "/users/me",
        headers: { "x-user-id": user.id },
      });

      const body = JSON.parse(response.body);
      expect(body.badges.sort()).toEqual(["kyc_verified", "license_verified"]);
    });

    it("devuelve 401 AUTH_TOKEN_INVALID sin header x-user-id", async () => {
      const response = await app.inject({ method: "GET", url: "/users/me" });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_TOKEN_INVALID");
    });

    it("devuelve 404 USER_NOT_FOUND si el x-user-id no corresponde a ningún usuario", async () => {
      // Caso borde defensivo: un x-user-id bien formado (UUID) pero de una cuenta que
      // ya no existe (p. ej. borrada después de emitido el JWT) — no debería pasar en
      // el camino feliz vía gateway, pero el service lo trata igual que MOVO-77 exige
      // para GET /users/:id, en vez de un 500 genérico.
      const response = await app.inject({
        method: "GET",
        url: "/users/me",
        headers: { "x-user-id": randomUUID() },
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe("USER_NOT_FOUND");
    });
  });

  describe("GET /users/:id", () => {
    it("devuelve la proyección pública sin email, phone ni accountStatus", async () => {
      const caller = await repo.create(buildInput());
      const target = await repo.create(buildInput({ firstName: "Juan", lastName: "Perez" }));
      await repo.updateKycStatusIdentity(target.id, KycStatus.APPROVED);

      const response = await app.inject({
        method: "GET",
        url: `/users/${target.id}`,
        headers: { "x-user-id": caller.id },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // DoD explícito de MOVO-77: la respuesta pública nunca puede tener estas claves.
      expect(body).not.toHaveProperty("email");
      expect(body).not.toHaveProperty("phone");
      expect(body).not.toHaveProperty("accountStatus");
      expect(body).not.toHaveProperty("kycStatus");

      expect(body).toMatchObject({
        id: target.id,
        fullName: "Juan Perez",
        photoUrl: null,
        isVerified: true,
        badges: ["kyc_verified"],
        transactionCounts: { asSender: 0, asCarrier: 0 },
        reputationScore: null,
      });
    });

    it("isVerified es false y badges está vacío cuando el KYC no está aprobado", async () => {
      const caller = await repo.create(buildInput());
      const target = await repo.create(buildInput());

      const response = await app.inject({
        method: "GET",
        url: `/users/${target.id}`,
        headers: { "x-user-id": caller.id },
      });

      const body = JSON.parse(response.body);
      expect(body.isVerified).toBe(false);
      expect(body.badges).toEqual([]);
    });

    it("devuelve 404 USER_NOT_FOUND para un id inexistente", async () => {
      const caller = await repo.create(buildInput());

      const response = await app.inject({
        method: "GET",
        url: `/users/${randomUUID()}`,
        headers: { "x-user-id": caller.id },
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe("USER_NOT_FOUND");
    });

    it("devuelve 401 AUTH_TOKEN_INVALID sin header x-user-id", async () => {
      const target = await repo.create(buildInput());

      const response = await app.inject({ method: "GET", url: `/users/${target.id}` });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_TOKEN_INVALID");
    });

    it("devuelve 404 USER_NOT_FOUND para una cuenta deleted (review de PR #55: baja lógica, tratada como inexistente)", async () => {
      const caller = await repo.create(buildInput());
      const target = await repo.create(buildInput());
      await app.db.user.update({ where: { id: target.id }, data: { status: "deleted" } });

      const response = await app.inject({
        method: "GET",
        url: `/users/${target.id}`,
        headers: { "x-user-id": caller.id },
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe("USER_NOT_FOUND");
    });

    it("sigue devolviendo el perfil para una cuenta banned (review de PR #55: sanción reversible, no baja voluntaria)", async () => {
      const caller = await repo.create(buildInput());
      const target = await repo.create(buildInput({ firstName: "Juan", lastName: "Perez" }));
      await app.db.user.update({ where: { id: target.id }, data: { status: "banned" } });

      const response = await app.inject({
        method: "GET",
        url: `/users/${target.id}`,
        headers: { "x-user-id": caller.id },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.fullName).toBe("Juan Perez");
      expect(body).not.toHaveProperty("accountStatus");
    });
  });
});
