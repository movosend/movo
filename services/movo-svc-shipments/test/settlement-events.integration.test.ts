import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { PackageType } from "../src/models/shipment";
import { NotificationsClient } from "../src/adapters/notifications-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";
import { createFakePaymentsClient, FakePaymentsClient } from "./fake-payments-client";

// MOVO-213: `POST /internal/shipments/:id/settlement-events`, el aviso de svc-payments cuando el cobro de un
// envío entregado quedó demorado (escalado) o lo acreditó un reintento. Postgres y Redis reales.

describe("aviso interno de la liquidación (MOVO-213)", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let notificationsClient: NotificationsClient;
  let paymentsClient: FakePaymentsClient;
  const senderId = randomUUID();
  const carrierId = randomUUID();

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    notificationsClient = createFakeNotificationsClient();
    paymentsClient = createFakePaymentsClient();
    app = buildApp({
      notificationsClient,
      paymentsClient,
      sweepEnabled: false,
      fundingSweepEnabled: false,
      pickupMissedSweepEnabled: false,
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    // Un envío `completed` que quede en la base rompe `migration-reversibility` (recrea el enum con 9 valores).
    await app.db.shipment.deleteMany({ where: { senderId } });
    await app.close();
  });

  beforeEach(() => {
    vi.mocked(notificationsClient.sendPush).mockClear();
  });

  async function deliveredShipment(): Promise<string> {
    const created = await shipmentRepo.create({
      senderId,
      receiverId: randomUUID(),
      packageType: PackageType.standard_package,
      weightKg: 2,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      pickupAddress: "Av. Colón 1234, Córdoba",
      pickupLat: -31.4201,
      pickupLng: -64.1888,
      deliveryAddress: "Bv. San Juan 500, Córdoba",
      deliveryLat: -31.4135,
      deliveryLng: -64.1811,
      pickupDate: new Date(),
      pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      suggestedPriceArs: 4500,
    });
    await app.db.shipment.update({ where: { id: created.id }, data: { status: ShipmentStatus.DELIVERED, carrierId } });
    return created.id;
  }

  const post = (id: string, payload: unknown) =>
    app.inject({ method: "POST", url: `/internal/shipments/${id}/settlement-events`, payload: payload as object });

  it("delayed: le avisa al transportista una sola vez y deja el envío entregado", async () => {
    const id = await deliveredShipment();

    const first = await post(id, { event: "delayed" });
    const second = await post(id, { event: "delayed" });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ handled: true, outcome: "carrier_notified" });
    expect(second.json()).toEqual({ handled: false, outcome: "already_notified" });
    const pushes = vi.mocked(notificationsClient.sendPush).mock.calls.map((c) => c[0]);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ userId: carrierId, title: "Tu cobro está demorado", category: "payments" });
    expect((await shipmentRepo.findById(id))?.status).toBe(ShipmentStatus.DELIVERED);
  });

  it("credited: completa el envío con la liquidación acreditada", async () => {
    const id = await deliveredShipment();
    paymentsClient.holds.set(id, {
      id: randomUUID(), shipmentId: id, carrierId, attempt: 1, mpPaymentId: "mp-1", collectorId: "1000000001",
      amountArs: 1000, applicationFeeArs: 150, baseAmountArs: 1000, commissionArs: 150, debtOffsetArs: 0,
      debtSurchargeArs: 0, status: "authorized", statusDetail: "pending_capture", failureReason: null, expiresAt: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });

    const response = await post(id, { event: "credited" });

    expect(response.json()).toEqual({ handled: true, outcome: "completed" });
    expect((await shipmentRepo.findById(id))?.status).toBe(ShipmentStatus.COMPLETED);
  });

  it("un evento desconocido responde 400 y un envío inexistente 404", async () => {
    const id = await deliveredShipment();

    expect((await post(id, { event: "otro" })).statusCode).toBe(400);
    expect((await post(randomUUID(), { event: "delayed" })).statusCode).toBe(404);
  });
});
