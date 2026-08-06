import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { UserRole, KycStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { UserConflictError, CreateUserInput } from "../src/models/user";

describe("user-repository (Postgres)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;

  const baseInput: CreateUserInput = {
    email: "dev@movo.test",
    phone: "+5493510000000",
    firstName: "Tomas",
    lastName: "Olmos",
    passwordHash: "hashed_password",
    roles: [UserRole.SENDER, UserRole.CARRIER],
    phoneVerified: false,
  };

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

  describe("create", () => {
    it("inserta el usuario y sus roles en una sola transacción", async () => {
      const user = await repo.create(baseInput);

      expect(user.id).toBeTruthy();
      expect(user.email).toBe(baseInput.email);
      expect(user.roles.sort()).toEqual([UserRole.CARRIER, UserRole.SENDER].sort());
      expect(user.kycStatusIdentity).toBe(KycStatus.NOT_STARTED);

      const rolesInDb = await app.db.userRoleGrant.findMany({ where: { userId: user.id } });
      expect(rolesInDb.map((r) => r.role).sort()).toEqual(["carrier", "sender"]);
    });

    it("devuelve el estado persistido y no los roles derivados del input", async () => {
      const created = await repo.create(baseInput);
      const reloaded = await repo.findById(created.id);

      // Si create() armara la respuesta desde el input en vez de releer la
      // fila, esto empezaría a divergir ante cualquier trigger/default nuevo.
      expect(created).toEqual(reloaded);
      expect([...created.roles].sort()).toEqual([...(reloaded?.roles ?? [])].sort());
    });

    it("rechaza un email duplicado con UserConflictError", async () => {
      await repo.create(baseInput);

      await expect(
        repo.create({ ...baseInput, phone: "+5493510000001" })
      ).rejects.toMatchObject(new UserConflictError("email"));
    });

    it("rechaza un phone duplicado con UserConflictError", async () => {
      await repo.create(baseInput);

      await expect(
        repo.create({ ...baseInput, email: "otro@movo.test" })
      ).rejects.toMatchObject(new UserConflictError("phone"));
    });

    it("no deja una fila huérfana en users.users si falla la inserción de un rol", async () => {
      await expect(
        repo.create({ ...baseInput, roles: ["not-a-role" as UserRole] })
      ).rejects.toThrow();

      const count = await app.db.user.count();
      expect(count).toBe(0);
    });
  });

  describe("findByEmail", () => {
    it("encuentra el usuario sin importar el casing del email", async () => {
      await repo.create(baseInput);

      const found = await repo.findByEmail("DEV@movo.TEST");
      expect(found?.email).toBe(baseInput.email);
    });

    it("devuelve null si no existe", async () => {
      expect(await repo.findByEmail("nadie@movo.test")).toBeNull();
    });
  });

  describe("findByPhone", () => {
    it("encuentra el usuario por teléfono", async () => {
      await repo.create(baseInput);
      const found = await repo.findByPhone(baseInput.phone);
      expect(found?.phone).toBe(baseInput.phone);
    });

    it("devuelve null si no existe", async () => {
      expect(await repo.findByPhone("+5493510009999")).toBeNull();
    });
  });

  describe("findById", () => {
    it("encuentra el usuario por id", async () => {
      const created = await repo.create(baseInput);
      const found = await repo.findById(created.id);
      expect(found?.id).toBe(created.id);
    });

    it("devuelve null si no existe", async () => {
      expect(await repo.findById("00000000-0000-0000-0000-000000000000")).toBeNull();
    });
  });

  describe("updateKycStatusIdentity / updateKycStatusLicense", () => {
    it("actualiza solo kyc_status_identity", async () => {
      const created = await repo.create(baseInput);

      const updated = await repo.updateKycStatusIdentity(created.id, KycStatus.APPROVED);

      expect(updated?.kycStatusIdentity).toBe(KycStatus.APPROVED);
      expect(updated?.kycStatusLicense).toBe(KycStatus.NOT_STARTED);
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    });

    it("actualiza solo kyc_status_license", async () => {
      const created = await repo.create(baseInput);

      const updated = await repo.updateKycStatusLicense(created.id, KycStatus.PENDING);

      expect(updated?.kycStatusLicense).toBe(KycStatus.PENDING);
      expect(updated?.kycStatusIdentity).toBe(KycStatus.NOT_STARTED);
    });

    it("devuelve null si el id no existe", async () => {
      const result = await repo.updateKycStatusIdentity(
        "00000000-0000-0000-0000-000000000000",
        KycStatus.APPROVED
      );
      expect(result).toBeNull();
    });
  });

  describe("count", () => {
    it("cuenta los usuarios existentes", async () => {
      expect(await repo.count()).toBe(0);
      await repo.create(baseInput);
      expect(await repo.count()).toBe(1);
    });
  });
});
