import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createHoldRepository } from "../src/repositories/hold-repository";
import { createSettlementRepository } from "../src/repositories/settlement-repository";

// Integración contra Postgres real: la carrera de `findOrCreateProcessing` no se reproduce con un mock.

const SHIPMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARRIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("settlement-repository#findOrCreateProcessing", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.settlements, payments.holds CASCADE");
  });

  it("varias llamadas a la vez devuelven la MISMA fila y ninguna falla", async () => {
    const hold = await createHoldRepository(app.db).createAttempt({
      shipmentId: SHIPMENT,
      attempt: 1,
      carrierId: CARRIER,
      collectorId: "1000000001",
      amountArs: 1000,
      applicationFeeArs: 150,
      requestFingerprint: "fp",
      savedCardId: null,
      payerId: null,
    });
    const repo = createSettlementRepository(app.db);
    const data = {
      shipmentId: SHIPMENT,
      holdId: hold.id,
      carrierId: CARRIER,
      mpPaymentId: "1352823085",
      grossAmountArs: 1000,
      commissionArs: 150,
    };

    const rows = await Promise.all(Array.from({ length: 40 }, () => repo.findOrCreateProcessing(data)));

    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(await app.db.settlement.count()).toBe(1);
  });
});
