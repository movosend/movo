import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { CreateOfferInput } from "../src/models/offer";
import { createFakeUsersClient } from "./fake-users-client";

const PICKUP_DATE = new Date("2030-01-01T00:00:00.000Z");

describe("POST /shipments/:id/cancel (Postgres) — MOVO-29/MOVO-108", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let offerRepo: OfferRepository;
  const sendPush = vi.fn().mockResolvedValue(undefined);

  const senderId = randomUUID();
  const receiverId = randomUUID();

  const baseShipmentInput: CreateShipmentInput = {
    senderId,
    receiverId,
    packageType: PackageType.standard_package,
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: "Caja con libros",
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4201,
    pickupLng: -64.1888,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.4135,
    deliveryLng: -64.1811,
    pickupDate: PICKUP_DATE,
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 4500,
  };

  /** Bypasea la máquina de estados a propósito (fixture, no flujo real) -- mismo
   * criterio que offer-repository.integration.test.ts. Las 2 fotos de creation
   * satisfacen el gate de AC6 de MOVO-81 para poder llegar a `published`. */
  async function createShipmentAt(status: ShipmentStatus): Promise<string> {
    const created = await shipmentRepo.create(baseShipmentInput);
    if (status === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION) {
      return created.id;
    }

    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    if (status === ShipmentStatus.PUBLISHED) {
      return created.id;
    }

    await shipmentRepo.updateStatus(created.id, ShipmentStatus.ASSIGNMENT_PENDING, null);
    if (status === ShipmentStatus.ASSIGNMENT_PENDING) {
      return created.id;
    }

    await shipmentRepo.updateStatus(created.id, ShipmentStatus.ASSIGNED, null);
    return created.id;
  }

  function baseOfferInput(overrides: Partial<CreateOfferInput> & { shipmentId: string }): CreateOfferInput {
    return {
      carrierId: randomUUID(),
      priceOffered: 5000,
      offeredDate: PICKUP_DATE,
      ...overrides,
    };
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    app = buildApp({
      usersClient: createFakeUsersClient({}),
      notificationsClient: { sendPush },
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
    offerRepo = createOfferRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // CASCADE también vacía shipments.offers (FK a shipments.shipments).
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
    sendPush.mockClear();
  });

  it("cancela desde awaiting_receiver_confirmation y persiste el motivo en el historial", async () => {
    const shipmentId = await createShipmentAt(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);

    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/cancel`,
      headers: { "x-user-id": senderId },
      payload: { reason: "me equivoqué de receptor" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe(ShipmentStatus.CANCELLED);

    const events = await shipmentRepo.listEvents(shipmentId);
    const cancelEvent = events.find((e) => e.toStatus === ShipmentStatus.CANCELLED);
    expect(cancelEvent?.reason).toBe("me equivoqué de receptor");
    expect(cancelEvent?.actorId).toBe(senderId);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("responde 401 sin x-user-id", async () => {
    const shipmentId = await createShipmentAt(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);

    const response = await app.inject({ method: "POST", url: `/shipments/${shipmentId}/cancel` });
    expect(response.statusCode).toBe(401);
  });

  it("responde 403 si quien cancela no es el emisor", async () => {
    const shipmentId = await createShipmentAt(ShipmentStatus.PUBLISHED);

    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/cancel`,
      headers: { "x-user-id": receiverId },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
  });

  it("responde 404 si el envío no existe", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/shipments/${randomUUID()}/cancel`,
      headers: { "x-user-id": senderId },
    });

    expect(response.statusCode).toBe(404);
  });

  it("responde 409 SHIPMENT_CANCELLATION_PENALTY_NOT_SUPPORTED al cancelar desde assigned", async () => {
    const shipmentId = await createShipmentAt(ShipmentStatus.ASSIGNED);

    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/cancel`,
      headers: { "x-user-id": senderId },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SHIPMENT_CANCELLATION_PENALTY_NOT_SUPPORTED");
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("responde 409 SHIPMENT_INVALID_TRANSITION al cancelar un envío ya cancelado", async () => {
    const shipmentId = await createShipmentAt(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);
    await shipmentRepo.updateStatus(shipmentId, ShipmentStatus.CANCELLED, senderId);

    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/cancel`,
      headers: { "x-user-id": senderId },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SHIPMENT_INVALID_TRANSITION");
  });

  it("AC7: cancelar desde published notifica a cada transportista con oferta pending, no a los demás", async () => {
    const shipmentId = await createShipmentAt(ShipmentStatus.PUBLISHED);
    const pendingOffer1 = await offerRepo.create(baseOfferInput({ shipmentId }));
    const pendingOffer2 = await offerRepo.create(baseOfferInput({ shipmentId }));
    const rejectedOffer = await offerRepo.create(baseOfferInput({ shipmentId }));
    await offerRepo.reject(rejectedOffer.id);

    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/cancel`,
      headers: { "x-user-id": senderId },
    });

    expect(response.statusCode).toBe(200);
    expect(sendPush).toHaveBeenCalledTimes(2);
    const notifiedCarriers = sendPush.mock.calls.map((call) => call[0].userId);
    expect(notifiedCarriers).toEqual(expect.arrayContaining([pendingOffer1.carrierId, pendingOffer2.carrierId]));
    expect(notifiedCarriers).not.toContain(rejectedOffer.carrierId);
  });

  it("AC7: cancelar desde assignment_pending también notifica a los transportistas con oferta pending", async () => {
    const shipmentId = await createShipmentAt(ShipmentStatus.ASSIGNMENT_PENDING);
    const pendingOffer = await offerRepo.create(baseOfferInput({ shipmentId }));

    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/cancel`,
      headers: { "x-user-id": senderId },
    });

    expect(response.statusCode).toBe(200);
    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ userId: pendingOffer.carrierId, data: { type: "shipment", shipmentId } })
    );
  });

  it("un fallo del cliente de notificaciones no bloquea la cancelación (AC5)", async () => {
    sendPush.mockRejectedValueOnce(new Error("svc-users caído"));
    const shipmentId = await createShipmentAt(ShipmentStatus.PUBLISHED);
    await offerRepo.create(baseOfferInput({ shipmentId }));

    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/cancel`,
      headers: { "x-user-id": senderId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe(ShipmentStatus.CANCELLED);
  });

  it("no consulta ofertas al cancelar desde awaiting_receiver_confirmation (no puede tener ninguna)", async () => {
    const shipmentId = await createShipmentAt(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);

    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/cancel`,
      headers: { "x-user-id": senderId },
    });

    expect(response.statusCode).toBe(200);
    expect(sendPush).not.toHaveBeenCalled();
  });
});
