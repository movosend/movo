import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeNotificationsClient } from "./fake-notifications-client";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakePaymentsClient, FakePaymentsClient } from "./fake-payments-client";
import { createFundingService } from "../src/modules/funding/funding.service";

const DAY = 24 * 60 * 60 * 1000;

/** Día de calendario (`@db.Date`) a `days` días de hoy. */
function dateInDays(days: number): Date {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days));
}

describe("GET /shipments/:id → funding (MOVO-211, Postgres)", () => {
  let app: FastifyInstance;
  let offerRepo: OfferRepository;
  let shipmentRepo: ShipmentRepository;
  let paymentsClient: FakePaymentsClient;
  const senderId = randomUUID();
  const receiverId = randomUUID();
  const usersClient = createFakeUsersClient({}, {}, [], {}, { [senderId]: "emisor@movo.test" });

  function shipmentInput(pickupDate: Date): CreateShipmentInput {
    return {
      senderId,
      receiverId,
      packageType: PackageType.standard_package,
      weightKg: 2.5,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      pickupAddress: "Av. Colón 1234, Córdoba",
      pickupLat: -31.4201,
      pickupLng: -64.1888,
      deliveryAddress: "Bv. San Juan 500, Córdoba",
      deliveryLat: -31.4135,
      deliveryLng: -64.1811,
      pickupDate,
      pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      suggestedPriceArs: 4500,
    };
  }

  /** Envío publicado con retiro en `days` días y una oferta aceptada por HTTP. */
  async function acceptedShipment(days: number) {
    const pickupDate = dateInDays(days);
    const created = await shipmentRepo.create(shipmentInput(pickupDate));
    for (let i = 0; i < 2; i++) {
      await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    }
    await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    const offer = await offerRepo.create({
      shipmentId: created.id,
      carrierId: randomUUID(),
      priceOffered: 18400,
      offeredDate: pickupDate,
    });
    const accept = await app.inject({
      method: "POST",
      url: `/offers/${offer.id}/accept`,
      headers: { "x-user-id": senderId },
    });
    expect(accept.statusCode).toBe(200);
    return { shipmentId: created.id, carrierId: offer.carrierId, acceptBody: accept.json() };
  }

  async function detail(shipmentId: string, callerId: string) {
    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}`,
      headers: { "x-user-id": callerId, "x-user-roles": "sender,carrier" },
    });
    return response;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    paymentsClient = createFakePaymentsClient();
    app = buildApp({
      notificationsClient: createFakeNotificationsClient(),
      paymentsClient,
      usersClient,
      sweepEnabled: false,
      fundingSweepEnabled: false,
      pickupMissedSweepEnabled: false,
    });
    await app.ready();
    offerRepo = createOfferRepository(app.db);
    shipmentRepo = createShipmentRepository(app.db);
  });

  beforeEach(async () => {
    paymentsClient.holds.clear();
    Object.assign(paymentsClient.behavior, createFakePaymentsClient().behavior);
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("accept devuelve la ruta tomada: cercana sin apertura de ventana, lejana con la fecha", async () => {
    const near = await acceptedShipment(1);
    expect(near.acceptBody.assignment).toEqual({
      shipmentStatus: ShipmentStatus.ASSIGNMENT_PENDING,
      fundingRoute: "near",
      fundingWindowOpensAt: null,
    });

    const far = await acceptedShipment(10);
    expect(far.acceptBody.assignment).toMatchObject({
      shipmentStatus: ShipmentStatus.ASSIGNED_UNFUNDED,
      fundingRoute: "far",
    });
    const opensAt = new Date(far.acceptBody.assignment.fundingWindowOpensAt).getTime();
    // Retiro en 10 días a las 9:00 (AR) menos N = 3 días.
    expect(opensAt).toBeGreaterThan(Date.now() + 6 * DAY);
    expect(opensAt).toBeLessThan(Date.now() + 8 * DAY);
  });

  it("ruta cercana con un intento rechazado: el emisor ve motivo y tarjeta; el transportista solo que está pendiente; el receptor nada", async () => {
    const { shipmentId, carrierId } = await acceptedShipment(1);
    paymentsClient.behavior.nextHoldStatus = "rejected";
    paymentsClient.behavior.nextFailureReason = "insufficient_funds";
    const pay = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/funding`,
      headers: { "x-user-id": senderId },
      payload: { cardToken: "tok-1", paymentMethodId: "visa" },
    });
    expect(pay.json()).toMatchObject({ funded: false, failureReason: "insufficient_funds" });

    const sender = await detail(shipmentId, senderId);
    expect(sender.statusCode).toBe(200);
    expect(sender.json().funding).toMatchObject({
      viewer: "sender",
      phase: "payment_due",
      route: "near",
      amountArs: 18400,
      lastAttempt: "rejected",
      failureReason: "insufficient_funds",
      card: { brand: "visa", lastFour: "3704" },
      holdLost: false,
    });

    const carrier = (await detail(shipmentId, carrierId)).json().funding;
    expect(carrier).toEqual({ viewer: "carrier", phase: "sender_payment_pending", payUntil: expect.any(String) });

    expect((await detail(shipmentId, receiverId)).json().funding).toBeNull();
  });

  it("ruta lejana con la ventana cerrada: awaiting_window", async () => {
    const { shipmentId } = await acceptedShipment(10);
    expect((await detail(shipmentId, senderId)).json().funding).toMatchObject({
      viewer: "sender",
      phase: "awaiting_window",
      windowOpensAt: expect.any(String),
      payUntil: expect.any(String),
      amountArs: 18400,
    });
  });

  it("reservado: el emisor ve monto y tarjeta, el transportista solo que está reservado", async () => {
    const { shipmentId, carrierId } = await acceptedShipment(1);
    const pay = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/funding`,
      headers: { "x-user-id": senderId },
      payload: { cardToken: "tok-1" },
    });
    expect(pay.json()).toMatchObject({ funded: true, shipmentStatus: ShipmentStatus.ASSIGNED });

    expect((await detail(shipmentId, senderId)).json().funding).toEqual({
      viewer: "sender",
      phase: "held",
      amountArs: 18400,
      card: { brand: "visa", lastFour: "3704" },
    });
    expect((await detail(shipmentId, carrierId)).json().funding).toEqual({ viewer: "carrier", phase: "held" });
  });

  it("payments caído: el detalle responde 200 con la reserva sin el último intento", async () => {
    const { shipmentId } = await acceptedShipment(1);
    paymentsClient.behavior.lookupFails = true;
    const response = await detail(shipmentId, senderId);
    expect(response.statusCode).toBe(200);
    expect(response.json().funding).toMatchObject({ phase: "payment_due", lastAttempt: null, card: null });
  });

  it("asignación vencida: emisor y ex-transportista ven por qué se liberó; un tercero sigue con 403", async () => {
    const { shipmentId, carrierId } = await acceptedShipment(1);
    const saga = createFundingService({
      repository: shipmentRepo,
      offerRepository: offerRepo,
      usersClient,
      paymentsClient,
      config: { nearPickupDays: 3, paymentTimeoutMinutes: 30, releaseHoursBeforePickup: 24, reminderIntervalHours: 12 },
    });
    const { revertedCount } = await saga.expireUnpaidAssignmentPending(new Date(Date.now() + 2 * DAY));
    expect(revertedCount).toBe(1);

    expect((await detail(shipmentId, senderId)).json().funding).toMatchObject({
      viewer: "sender",
      phase: "lapsed",
      reason: "payment_timeout",
    });

    const former = await detail(shipmentId, carrierId);
    expect(former.statusCode).toBe(200);
    expect(former.json().funding).toMatchObject({ viewer: "former_carrier", phase: "lapsed", reason: "payment_timeout" });
    expect(former.json().offersSummary).toBeUndefined();

    // Un usuario sin KYC ni relación con el envío sigue sin poder verlo.
    const stranger = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}`,
      headers: { "x-user-id": randomUUID(), "x-user-roles": "sender" },
    });
    expect(stranger.statusCode).toBe(403);
  });
});
