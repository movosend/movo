import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository } from "../src/repositories/user-repository";
import { purgeAbandonedKycAttempts } from "../src/plugins/kyc-abandoned-sweep";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("purgeAbandonedKycAttempts (MOVO-230, Postgres)", () => {
  let app: FastifyInstance;
  const now = new Date("2026-10-21T12:00:00Z");
  const cutoff = new Date(now.getTime() - 30 * DAY_MS);

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({ orphanPhotoSweepEnabled: false, sanctionSweepEnabled: false, kycAbandonedSweepEnabled: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
  });

  async function createUser() {
    return createUserRepository(app.db).create({
      email: `user-${randomUUID()}@movo.test`,
      phone: `+549351${Math.floor(1000000 + Math.random() * 8999999)}`,
      firstName: "Lucas",
      lastName: "Dalmagro",
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
    });
  }

  async function createAttempt(userId: string, status: string, daysAgo: number, verificationType = "identity") {
    return app.db.kycVerification.create({
      data: {
        userId,
        verificationType: verificationType as "identity" | "license",
        provider: "didit",
        externalSessionId: `s-${randomUUID()}`,
        status: status as "pending",
        requestedAt: new Date(now.getTime() - daysAgo * DAY_MS),
      },
    });
  }

  it("borra los pending/expired de más de 30 días y conserva los recientes y los que tienen resultado", async () => {
    const user = await createUser();
    const oldPending = await createAttempt(user.id, "pending", 31);
    const oldExpired = await createAttempt(user.id, "expired", 90, "license");
    const recentPending = await createAttempt(user.id, "pending", 29, "license");
    const oldRejected = await createAttempt(user.id, "rejected", 400);
    const oldManualReview = await createAttempt(user.id, "manual_review", 400);

    const result = await purgeAbandonedKycAttempts(app.db, cutoff);

    expect(result.deleted).toBe(2);
    const remaining = (await app.db.kycVerification.findMany({ where: { userId: user.id } })).map((row) => row.id);
    expect(remaining.sort()).toEqual([recentPending.id, oldRejected.id, oldManualReview.id].sort());
    expect(remaining).not.toContain(oldPending.id);
    expect(remaining).not.toContain(oldExpired.id);
  });

  it("vuelve a not_started el caché que seguía en pending, y no toca uno que ya tiene resultado", async () => {
    const stuck = await createUser();
    await createAttempt(stuck.id, "pending", 45);
    await app.db.user.update({ where: { id: stuck.id }, data: { kycStatusIdentity: "pending" } });

    // Resuelto por otro intento posterior: el caché ya no apunta al pending viejo.
    const resolved = await createUser();
    await createAttempt(resolved.id, "expired", 45);
    await app.db.user.update({ where: { id: resolved.id }, data: { kycStatusIdentity: "rejected" } });

    const result = await purgeAbandonedKycAttempts(app.db, cutoff);

    expect(result).toEqual({ deleted: 2, cacheReset: 1 });
    expect((await app.db.user.findUniqueOrThrow({ where: { id: stuck.id } })).kycStatusIdentity).toBe("not_started");
    expect((await app.db.user.findUniqueOrThrow({ where: { id: resolved.id } })).kycStatusIdentity).toBe("rejected");
  });
});
