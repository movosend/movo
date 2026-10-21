import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { KycStatus, UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";
import { ShipmentsClient } from "../src/adapters/shipments-client";

describe("GET /internal/users/party-cards (MOVO-325)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;
  let reputationDown = false;

  const shipmentsClient = {
    async findReputation() {
      if (reputationDown) throw new Error("svc-shipments caído");
      return { reputationScore: 4.6, ratingCount: 9 };
    },
  } as unknown as ShipmentsClient;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({ shipmentsClient });
    await app.ready();
    repo = createUserRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  const buildInput = (overrides: Partial<CreateUserInput> = {}): CreateUserInput => ({
    email: `user-${randomUUID()}@movo.test`,
    phone: `+549351${Math.floor(1000000 + Math.random() * 8999999)}`,
    firstName: "Juan",
    lastName: "Bordino",
    passwordHash: "hashed_password",
    roles: [UserRole.SENDER, UserRole.CARRIER],
    phoneVerified: true,
    address: { street: "Av. Colón", number: "1234", city: "Córdoba", province: "Córdoba", zip: "5000", lat: -31.4201, long: -64.1888 },
    ...overrides,
  });

  it("devuelve verificación y reputación de cada persona, y deja afuera a las inexistentes", async () => {
    const verified = await repo.create(buildInput());
    await repo.updateKycStatusIdentity(verified.id, KycStatus.APPROVED);
    await repo.updateKycStatusLicense(verified.id, KycStatus.APPROVED);
    const unverified = await repo.create(buildInput({ firstName: "Ana", lastName: "Gómez" }));

    const response = await app.inject({
      method: "GET",
      url: `/internal/users/party-cards?ids=${verified.id},${unverified.id},${randomUUID()}`,
    });

    expect(response.statusCode).toBe(200);
    const cards = response.json() as Array<Record<string, unknown>>;
    expect(cards).toHaveLength(2);
    expect(cards.find((card) => card.id === verified.id)).toEqual({
      id: verified.id,
      fullName: "Juan Bordino",
      photoUrl: null,
      accountStatus: "active",
      identityVerified: true,
      licenseVerified: true,
      reputationScore: 4.6,
      ratingCount: 9,
    });
    expect(cards.find((card) => card.id === unverified.id)).toMatchObject({ identityVerified: false, licenseVerified: false });
  });

  it("si svc-shipments no responde, la reputación viaja en null y la ficha se devuelve igual", async () => {
    const user = await repo.create(buildInput());
    reputationDown = true;
    try {
      const response = await app.inject({ method: "GET", url: `/internal/users/party-cards?ids=${user.id}` });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([expect.objectContaining({ id: user.id, reputationScore: null, ratingCount: 0 })]);
    } finally {
      reputationDown = false;
    }
  });

  it("rechaza ids inválidos o demasiados con 400", async () => {
    const invalid = await app.inject({ method: "GET", url: "/internal/users/party-cards?ids=no-es-un-uuid-pero-tiene-treinta-y-seis" });
    expect(invalid.statusCode).toBe(400);
    const tooMany = Array.from({ length: 6 }, () => randomUUID()).join(",");
    expect((await app.inject({ method: "GET", url: `/internal/users/party-cards?ids=${tooMany}` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/internal/users/party-cards" })).statusCode).toBe(400);
  });
});
