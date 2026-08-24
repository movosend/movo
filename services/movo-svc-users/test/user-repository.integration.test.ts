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
    address: {
      street: "Av. Colón",
      number: "1234",
      city: "Córdoba",
      province: "Córdoba",
      zip: "5000",
      lat: -31.4201,
      long: -64.1888,
    },
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

  describe("updateEmail", () => {
    it("MOVO-133 (fix de review de tmvergara sobre PR #91): una colisión que difiere solo en casing lanza UserConflictError, no un P2002 crudo", async () => {
      // Reproduce el hallazgo real: `users_email_lower_idx` (MOVO-93) es un UNIQUE
      // INDEX de EXPRESIÓN sobre LOWER(email) -- Postgres sí lo hace cumplir. Cuando
      // choca, el driver adapter de Prisma 7 no devuelve `fields: ["email"]` limpio
      // como para un unique constraint de columna simple: devuelve el nombre de la
      // expresión truncado (`["lower(email::text"]`, verificado empíricamente contra
      // Postgres real). Un `.includes("email")` exacto no matchea eso -- antes de
      // este fix, el P2002 se repropagaba crudo (500) en vez de traducirse a
      // UserConflictError (409).
      const other = await repo.create({ ...baseInput, email: `case-${Date.now()}@movo.test`, phone: "+5493510000002" });
      const user = await repo.create({ ...baseInput, email: `throwaway-${Date.now()}@movo.test`, phone: "+5493510000003" });

      await expect(repo.updateEmail(user.id, other.email.toUpperCase())).rejects.toMatchObject(
        new UserConflictError("email")
      );
    });

    it("colisión de mismo casing exacto (users_email_key) también lanza UserConflictError", async () => {
      const other = await repo.create({ ...baseInput, email: `exact-${Date.now()}@movo.test`, phone: "+5493510000004" });
      const user = await repo.create({ ...baseInput, email: `throwaway2-${Date.now()}@movo.test`, phone: "+5493510000005" });

      await expect(repo.updateEmail(user.id, other.email)).rejects.toMatchObject(new UserConflictError("email"));
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
