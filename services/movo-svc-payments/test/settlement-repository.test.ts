import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createHoldRepository } from "../src/repositories/hold-repository";
import { createSettlementRepository } from "../src/repositories/settlement-repository";

// Integración contra Postgres real: la carrera de `findOrCreateProcessing` no se reproduce con un mock.

const SHIPMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARRIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("settlement-repository#findOrCreateProcessing (contrato, Postgres real)", () => {
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

  // Test de contrato: pasa también con el `upsert` original (la carrera no se reproduce en un solo proceso). El que fuerza
  // el P2002 es el de abajo.
  it("varias llamadas a la vez devuelven la MISMA fila y ninguna falla", async () => {
    const hold = await createHoldRepository(app.db).createAttempt({
      shipmentId: SHIPMENT,
      attempt: 1,
      carrierId: CARRIER,
      collectorId: "1000000001",
      plan: () => ({
        baseAmountArs: 1000,
        commissionArs: 150,
        debtOffsetArs: 0,
        debtSurchargeArs: 0,
        amountArs: 1000,
        applicationFeeArs: 150,
      }),
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

describe("settlement-repository#findOrCreateProcessing ante P2002 (unitario)", () => {
  const data = {
    shipmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    holdId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    carrierId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    mpPaymentId: "1",
    grossAmountArs: 1000,
    commissionArs: 150,
  };

  function repoWith(db: { create: () => Promise<unknown>; findUnique: () => Promise<unknown> }) {
    return createSettlementRepository({ settlement: db } as never);
  }

  it("si el create pierde la carrera (P2002) devuelve la fila que ganó", async () => {
    const winner = { id: "ganadora", ...data, status: "processing" };
    const repo = repoWith({
      create: async () => Promise.reject(Object.assign(new Error("Unique constraint failed"), { code: "P2002" })),
      findUnique: async () => winner,
    });

    await expect(repo.findOrCreateProcessing(data)).resolves.toBe(winner);
  });

  it("un P2002 sin fila existente, o cualquier otro error, se propaga", async () => {
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    await expect(repoWith({ create: async () => Promise.reject(p2002), findUnique: async () => null }).findOrCreateProcessing(data)).rejects.toBe(p2002);

    const other = Object.assign(new Error("connection"), { code: "P1001" });
    await expect(repoWith({ create: async () => Promise.reject(other), findUnique: async () => ({}) }).findOrCreateProcessing(data)).rejects.toBe(other);
  });
});

// MOVO-213: lo que usa el barrido de reintentos y la consulta del proceso manual.
describe("settlement-repository: reintentos (MOVO-213, Postgres real)", () => {
  let app: FastifyInstance;
  const MIN = 60_000;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    app = buildApp({ captureRetrySweepEnabled: false, mpTokenRefreshSweepEnabled: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.settlements, payments.holds CASCADE");
  });

  let seq = 0;
  async function seed(overrides: {
    status?: "failed" | "escalated" | "processing" | "credited";
    kind?: "delivery" | "cancellation_penalty";
    nextAttemptAt?: Date | null;
  } = {}) {
    seq += 1;
    const shipmentId = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
    const hold = await app.db.hold.create({
      data: {
        shipmentId, attempt: 1, carrierId: CARRIER, collectorId: "1", mpPaymentId: `p${seq}`, amountArs: 1000,
        applicationFeeArs: 150, baseAmountArs: 1000, commissionArs: 150, status: "authorized",
      },
    });
    return app.db.settlement.create({
      data: {
        shipmentId, holdId: hold.id, carrierId: CARRIER, mpPaymentId: `p${seq}`, grossAmountArs: 1000, commissionArs: 150,
        status: overrides.status ?? "failed", kind: overrides.kind ?? "delivery",
        nextAttemptAt: overrides.nextAttemptAt === undefined ? new Date(Date.now() - MIN) : overrides.nextAttemptAt,
      },
    });
  }

  it("findDueForRetry trae solo entregas `failed` con la hora cumplida, las más atrasadas primero", async () => {
    const late = await seed({ nextAttemptAt: new Date(Date.now() - 10 * MIN) });
    const recent = await seed({ nextAttemptAt: new Date(Date.now() - MIN) });
    await seed({ nextAttemptAt: new Date(Date.now() + 10 * MIN) }); // todavía no toca
    await seed({ nextAttemptAt: null }); // sin reintento programado
    await seed({ status: "escalated" });
    await seed({ status: "processing" });
    await seed({ kind: "cancellation_penalty" }); // la penalidad la maneja shipments

    const due = await createSettlementRepository(app.db).findDueForRetry(new Date(), 10);

    expect(due.map((s) => s.id)).toEqual([late.id, recent.id]);
    expect(await createSettlementRepository(app.db).findDueForRetry(new Date(), 1)).toHaveLength(1);
  });

  it("claimRetry: de varias réplicas a la vez, exactamente una se queda con la liquidación", async () => {
    const repo = createSettlementRepository(app.db);
    const row = await seed();
    const lease = new Date(Date.now() + 10 * MIN);

    const results = await Promise.all(Array.from({ length: 5 }, () => repo.claimRetry(row.id, row.nextAttemptAt!, lease)));

    expect(results.filter(Boolean)).toHaveLength(1);
    const after = await app.db.settlement.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.nextAttemptAt!.getTime()).toBe(lease.getTime());
    // Con el lease puesto, ya no figura como vencida.
    expect(await repo.findDueForRetry(new Date(), 10)).toEqual([]);
  });

  it("claimRetry no toma una liquidación que cambió de estado o de hora desde que se leyó", async () => {
    const repo = createSettlementRepository(app.db);
    const row = await seed();
    await app.db.settlement.update({ where: { id: row.id }, data: { status: "credited" } });

    expect(await repo.claimRetry(row.id, row.nextAttemptAt!, new Date(Date.now() + MIN))).toBe(false);
  });

  it("listByStatus filtra por estado y respeta el cursor (updated_at, id)", async () => {
    const repo = createSettlementRepository(app.db);
    const a = await seed({ status: "escalated" });
    const b = await seed({ status: "escalated" });
    await seed({ status: "failed" });
    await app.db.$executeRawUnsafe(
      "UPDATE payments.settlements SET updated_at = now() - interval '1 hour' WHERE id = $1::uuid", a.id
    );

    const first = await repo.listByStatus("escalated", 1);
    expect(first.map((s) => s.id)).toEqual([b.id]);
    expect(first[0].hold.expiresAt).toBeNull();
    const second = await repo.listByStatus("escalated", 5, { updatedAt: first[0].updatedAt, id: first[0].id });
    expect(second.map((s) => s.id)).toEqual([a.id]);
  });

  it("replaceFailed reemplaza solo una liquidación failed y limpia el intento anterior", async () => {
    const hold = await createHoldRepository(app.db).createAttempt({
      shipmentId: SHIPMENT,
      attempt: 1,
      carrierId: CARRIER,
      collectorId: "1000000001",
      plan: () => ({
        baseAmountArs: 1000,
        commissionArs: 150,
        debtOffsetArs: 0,
        debtSurchargeArs: 0,
        amountArs: 1000,
        applicationFeeArs: 150,
      }),
      requestFingerprint: "fp",
      savedCardId: null,
      payerId: null,
    });
    const repo = createSettlementRepository(app.db);
    const data = {
      shipmentId: SHIPMENT,
      kind: "cancellation_penalty" as const,
      holdId: hold.id,
      carrierId: CARRIER,
      mpPaymentId: "1352823085",
      grossAmountArs: 250,
      commissionArs: 150,
    };
    const created = await repo.findOrCreateProcessing(data);
    const other = { ...data, kind: "delivery" as const, grossAmountArs: 1000 };

    // En `processing` no se toca.
    expect(await repo.replaceFailed(created.id, other)).toBe(false);

    await repo.update(created.id, { status: "failed", failureReason: "provider_error", attempts: 2, lastError: "boom" });
    expect(await repo.replaceFailed(created.id, other)).toBe(true);

    const row = await repo.findByShipment(SHIPMENT);
    expect(row).toMatchObject({ id: created.id, kind: "delivery", status: "processing", failureReason: null, attempts: 0, lastError: null });
    expect(row?.grossAmountArs.toNumber()).toBe(1000);
  });
});
