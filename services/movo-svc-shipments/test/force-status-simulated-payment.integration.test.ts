import { randomUUID } from "node:crypto";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";
import { FastifyInstance } from "fastify";
import { OfferStatus, ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import {
  createShipmentRepository,
  ShipmentRepository,
} from "../src/repositories/shipment-repository";
import { PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";
import {
  createFakePaymentsClient,
  FakePaymentsClient,
} from "./fake-payments-client";

/**
 * ADR-055, pago simulado: `force-status` con `simulatePayment` pasa un envío a `assigned` sin hold y lo marca.
 * Postgres y Redis reales. Se corre dos veces: con `ALLOW_SIMULATED_PAYMENTS` apagado (default) y encendido.
 */

const AGREED_PRICE = 1150;
const REASON =
  "El sandbox de Mercado Pago está caído y necesitamos probar el flujo completo";
const FAR_WINDOW = {
  pickupDate: new Date("2031-06-01T00:00:00.000Z"),
  pickupTimeWindowStart: new Date("1970-01-01T14:00:00.000Z"),
  pickupTimeWindowEnd: new Date("1970-01-01T18:00:00.000Z"),
};

const senderId = randomUUID();
const receiverId = randomUUID();
const carrierId = randomUUID();
const adminId = randomUUID();

function describeWith(allow: boolean) {
  describe(`pago simulado con ALLOW_SIMULATED_PAYMENTS=${allow}`, () => {
    let app: FastifyInstance;
    let repo: ShipmentRepository;
    let payments: FakePaymentsClient;
    const sendPush = vi.fn().mockResolvedValue(undefined);

    async function createShipment(
      status: ShipmentStatus,
      { withHold = false } = {},
    ) {
      const created = await repo.create({
        senderId,
        receiverId,
        packageType: PackageType.standard_package,
        weightKg: 2.5,
        lengthCm: 30,
        widthCm: 20,
        heightCm: 15,
        description: "Caja",
        pickupAddress: "Av. Colón 1234, Córdoba",
        pickupLat: -31.4201,
        pickupLng: -64.1888,
        deliveryAddress: "Bv. San Juan 500, Córdoba",
        deliveryLat: -31.4135,
        deliveryLng: -64.1811,
        ...FAR_WINDOW,
        suggestedPriceArs: 1000,
      });
      await repo.addPhoto(
        created.id,
        PhotoStage.creation,
        `shipments/${created.id}/creation/${randomUUID()}.jpg`,
      );
      await repo.addPhoto(
        created.id,
        PhotoStage.creation,
        `shipments/${created.id}/creation/${randomUUID()}.jpg`,
      );
      await app.db.shipment.update({
        where: { id: created.id },
        data: {
          status,
          lastStatusChangedAt: new Date(),
          carrierId,
          agreedPriceArs: AGREED_PRICE,
        },
      });
      await app.db.offer.create({
        data: {
          shipmentId: created.id,
          carrierId,
          priceOffered: AGREED_PRICE,
          offeredDate: FAR_WINDOW.pickupDate,
          status: OfferStatus.ACCEPTED,
          carrierNameAtOffer: "Juan P.",
        },
      });
      if (withHold) {
        await payments.createHold({
          shipmentId: created.id,
          carrierId,
          cardToken: "tok",
          amountArs: AGREED_PRICE,
          payerEmail: "emisor@example.com",
          payerUserId: senderId,
        });
      }
      return created.id;
    }

    const force = (id: string, payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/internal/admin/shipments/${id}/force-status`,
        payload: {
          reason: REASON,
          adminId,
          adminName: "Lucía Admin",
          idempotencyKey: randomUUID(),
          ...payload,
        },
      });
    const row = (id: string) =>
      app.db.shipment.findUniqueOrThrow({ where: { id } });

    beforeAll(async () => {
      process.env.JWT_SECRET = "test-secret";
      process.env.DATABASE_URL =
        process.env.DATABASE_URL ||
        "postgresql://movo:movo@localhost:5432/movo";
      process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
      process.env.ALLOW_SIMULATED_PAYMENTS = String(allow);
      payments = createFakePaymentsClient();
      app = buildApp({
        usersClient: createFakeUsersClient({}),
        notificationsClient: { sendPush },
        paymentsClient: payments,
        alertNotifier: { send: vi.fn().mockResolvedValue(undefined) },
        sweepEnabled: false,
      });
      await app.ready();
      repo = createShipmentRepository(app.db);
    });
    afterAll(async () => {
      delete process.env.ALLOW_SIMULATED_PAYMENTS;
      await app.close();
    });
    beforeEach(async () => {
      await app.db.$executeRawUnsafe(
        "TRUNCATE TABLE shipments.shipments, shipments.trips RESTART IDENTITY CASCADE",
      );
      payments.holds.clear();
      sendPush.mockClear();
    });

    const request = {
      targetStatus: ShipmentStatus.ASSIGNED,
      expectedStatus: ShipmentStatus.ASSIGNMENT_PENDING,
    };

    if (!allow) {
      it("403 PAYMENT_SIMULATION_DISABLED y el envío no cambia", async () => {
        const id = await createShipment(ShipmentStatus.ASSIGNMENT_PENDING);
        const response = await force(id, { ...request, simulatePayment: true });
        expect(response.statusCode).toBe(403);
        expect(response.json().error.code).toBe("PAYMENT_SIMULATION_DISABLED");
        const after = await row(id);
        expect(after.status).toBe(ShipmentStatus.ASSIGNMENT_PENDING);
        expect(after.paymentSimulated).toBe(false);
      });
      return;
    }

    it("assignment_pending -> assigned sin hold: asigna y marca el envío", async () => {
      const id = await createShipment(ShipmentStatus.ASSIGNMENT_PENDING);
      const response = await force(id, { ...request, simulatePayment: true });
      expect(response.statusCode).toBe(200);
      const after = await row(id);
      expect(after.status).toBe(ShipmentStatus.ASSIGNED);
      expect(after.paymentSimulated).toBe(true);
    });

    it("sin simulatePayment sigue exigiendo el hold (422 HOLD_NOT_AUTHORIZED) y no marca nada", async () => {
      const id = await createShipment(ShipmentStatus.ASSIGNMENT_PENDING);
      const response = await force(id, request);
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("HOLD_NOT_AUTHORIZED");
      expect((await row(id)).paymentSimulated).toBe(false);
    });

    it("409 HOLD_ALREADY_EXISTS si el envío ya tiene un hold real autorizado", async () => {
      const id = await createShipment(ShipmentStatus.ASSIGNMENT_PENDING, {
        withHold: true,
      });
      const response = await force(id, { ...request, simulatePayment: true });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("HOLD_ALREADY_EXISTS");
      expect((await row(id)).paymentSimulated).toBe(false);
    });

    it("422 si se pide simular el pago en una transición que no es a assigned", async () => {
      const id = await createShipment(ShipmentStatus.ASSIGNED);
      const response = await force(id, {
        targetStatus: ShipmentStatus.CANCELLED,
        expectedStatus: ShipmentStatus.ASSIGNED,
        simulatePayment: true,
      });
      expect(response.statusCode).toBe(422);
      expect((await row(id)).status).toBe(ShipmentStatus.ASSIGNED);
    });
  });
}

describeWith(false);
describeWith(true);
