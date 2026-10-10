import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { AccountStatus, KycStatus, UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";

describe("GET /internal/users/:id/kyc-status (MOVO-116)", () => {
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
      firstName: "Juan",
      lastName: "Bordino",
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

  it("devuelve los dos estados de KYC en crudo", async () => {
    const user = await repo.create(buildInput());
    await repo.updateKycStatusIdentity(user.id, KycStatus.APPROVED);
    await repo.updateKycStatusLicense(user.id, KycStatus.PENDING);

    const response = await app.inject({ method: "GET", url: `/internal/users/${user.id}/kyc-status` });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      kycStatusIdentity: KycStatus.APPROVED,
      kycStatusLicense: KycStatus.PENDING,
    });
  });

  it("un usuario recién creado tiene los dos estados en not_started", async () => {
    const user = await repo.create(buildInput());

    const response = await app.inject({ method: "GET", url: `/internal/users/${user.id}/kyc-status` });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      kycStatusIdentity: KycStatus.NOT_STARTED,
      kycStatusLicense: KycStatus.NOT_STARTED,
    });
  });

  it("404 USER_NOT_FOUND para un usuario inexistente", async () => {
    const response = await app.inject({ method: "GET", url: `/internal/users/${randomUUID()}/kyc-status` });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe("USER_NOT_FOUND");
  });

  it("404 USER_NOT_FOUND para una cuenta dada de baja", async () => {
    const user = await repo.create(buildInput());
    await repo.updateKycStatusLicense(user.id, KycStatus.APPROVED);
    await app.db.user.update({ where: { id: user.id }, data: { status: AccountStatus.DELETED } });

    const response = await app.inject({ method: "GET", url: `/internal/users/${user.id}/kyc-status` });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe("USER_NOT_FOUND");
  });

  it("400 si el id no es un uuid", async () => {
    const response = await app.inject({ method: "GET", url: "/internal/users/no-es-uuid/kyc-status" });

    expect(response.statusCode).toBe(400);
  });

  it("no se documenta en la Swagger pública", async () => {
    const spec = app.swagger() as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths)).not.toContain("/internal/users/{id}/kyc-status");
  });
});
