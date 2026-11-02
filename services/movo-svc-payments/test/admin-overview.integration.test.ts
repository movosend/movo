import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { argentinaDayBounds, toArgentinaCalendarDateString } from "@movo/shared";
import { buildApp } from "../src/app";

const HOUR_MS = 60 * 60 * 1000;

/** MOVO-342: la bandeja de pagos de la home del panel, contra Postgres real con fechas fijas. */
describe("bandeja de pagos de la home (Postgres) — MOVO-342", () => {
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
    await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.settlements, payments.payment_provider_events, payments.holds CASCADE");
  });

  const fromNow = (hours: number) => new Date(Date.now() + hours * HOUR_MS);

  async function hold(status: "authorized" | "captured" | "cancelled", expiresAt: Date | null, createdAt = fromNow(-1)) {
    return app.db.hold.create({
      data: {
        shipmentId: randomUUID(),
        attempt: 1,
        carrierId: randomUUID(),
        collectorId: "collector",
        amountArs: 1150,
        applicationFeeArs: 150,
        baseAmountArs: 1150,
        commissionArs: 150,
        status,
        expiresAt,
        createdAt,
      },
    });
  }

  async function settlement(status: "failed" | "escalated" | "credited" | "processing", hoursAgo = 1) {
    const row = await hold("captured", null);
    await app.db.settlement.create({
      data: {
        shipmentId: row.shipmentId,
        holdId: row.id,
        carrierId: row.carrierId,
        mpPaymentId: `mp-${randomUUID()}`,
        grossAmountArs: 1150,
        commissionArs: 150,
        status,
      },
    });
    // `updatedAt` lo fija Prisma al escribir: la antigüedad se fuerza por SQL.
    await app.db.$executeRaw`UPDATE payments.settlements SET updated_at = ${fromNow(-hoursAgo)} WHERE hold_id = ${row.id}::uuid`;
  }

  const overview = async () => {
    const response = await app.inject({ method: "GET", url: "/internal/payments/admin/overview" });
    expect(response.statusCode).toBe(200);
    return response.json();
  };

  /** Lo que falta para terminar el día de Argentina, para armar un vencimiento que sí caiga hoy. */
  const hoursLeftToday = () => (argentinaDayBounds(toArgentinaCalendarDateString(new Date())).end.getTime() - Date.now()) / HOUR_MS;

  it("vacía, todo en cero", async () => {
    expect(await overview()).toEqual({ count: 0, holdsExpiringToday: 0, overSla: false, oldestAt: null, yesterdayCount: null, breakdown: [] });
  });

  it("cuenta holds autorizados que vencen hoy y capturas trabadas; lo demás no entra", async () => {
    await hold("authorized", fromNow(hoursLeftToday() / 2));
    await hold("authorized", fromNow(hoursLeftToday() + 1)); // Vence mañana.
    await hold("authorized", fromNow(-1)); // Ya venció.
    await hold("cancelled", fromNow(hoursLeftToday() / 2));
    await settlement("failed");
    await settlement("failed");
    await settlement("escalated");
    await settlement("credited");
    await settlement("processing");

    const body = await overview();

    expect(body).toMatchObject({ count: 4, holdsExpiringToday: 1, yesterdayCount: null });
    expect(body.breakdown).toEqual([
      { key: "capture_failed", count: 2 },
      { key: "capture_escalated", count: 1 },
      { key: "hold_expiring", count: 1 },
    ]);
  });

  describe("fuera de plazo", () => {
    it("una captura trabada hace más de 6 h", async () => {
      await settlement("failed", 5);
      expect((await overview()).overSla).toBe(false);
      await settlement("escalated", 7);
      expect((await overview()).overSla).toBe(true);
    });

    it("un hold al que le quedan menos de 6 h, aunque se haya creado hace un rato", async () => {
      await hold("authorized", fromNow(Math.min(0.5, hoursLeftToday() / 2)), fromNow(-0.1));
      expect((await overview()).overSla).toBe(true);
    });
  });
});
