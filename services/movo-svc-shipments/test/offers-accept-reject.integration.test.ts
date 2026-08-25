import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { OfferStatus, ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateOfferInput } from "../src/models/offer";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeNotificationsClient } from "./fake-notifications-client";
import { NotificationsClient } from "../src/adapters/notifications-client";

const PICKUP_DATE = new Date("2026-08-20T00:00:00.000Z");

describe("POST /offers/:id/accept y POST /offers/:id/reject (Postgres)", () => {
  let app: FastifyInstance;
  let offerRepo: OfferRepository;
  let shipmentRepo: ShipmentRepository;
  let notificationsClient: NotificationsClient;
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

  function baseOfferInput(overrides: Partial<CreateOfferInput> = {}): CreateOfferInput {
    return {
      shipmentId: overrides.shipmentId ?? "",
      carrierId: randomUUID(),
      priceOffered: 5000,
      offeredDate: PICKUP_DATE,
      ...overrides,
    };
  }

  /** Mismo helper que offer-repository.integration.test.ts: bypasea la máquina de
   * estados de Shipment a propósito, es fixture de test. */
  async function createPublishedShipment(): Promise<string> {
    const created = await shipmentRepo.create(baseShipmentInput);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    const published = await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    return published.id;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    notificationsClient = createFakeNotificationsClient();
    app = buildApp({ notificationsClient, sweepEnabled: false });
    await app.ready();
    offerRepo = createOfferRepository(app.db);
    shipmentRepo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // CASCADE también vacía shipments.offers (FK a shipments.shipments).
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  describe("POST /offers/:id/accept", () => {
    it("el emisor puede aceptar una oferta (AC6/AC7): envío a assignment_pending con carrierId, otras ofertas superseded", async () => {
      const shipmentId = await createPublishedShipment();
      const winner = await offerRepo.create(
        baseOfferInput({ shipmentId, priceOffered: 4000, carrierNameAtOffer: "Juan", carrierRatingAtOffer: 4.9 })
      );
      const loser = await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 4500 }));

      const response = await app.inject({
        method: "POST",
        url: `/offers/${winner.id}/accept`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.id).toBe(winner.id);
      expect(data.status).toBe(OfferStatus.ACCEPTED);

      const updatedShipment = await shipmentRepo.findById(shipmentId);
      expect(updatedShipment?.status).toBe(ShipmentStatus.ASSIGNMENT_PENDING);
      expect(updatedShipment?.carrierId).toBe(winner.carrierId);

      const updatedLoser = await offerRepo.findById(loser.id);
      expect(updatedLoser?.status).toBe(OfferStatus.SUPERSEDED);

      await vi.waitFor(() => {
        expect(notificationsClient.sendPush).toHaveBeenCalledWith({
          userId: winner.carrierId,
          title: "Tu oferta fue aceptada",
          body: "El emisor eligió tu oferta para este envío.",
          data: { type: "offer_accepted", shipmentId, offerId: winner.id },
        });
        expect(notificationsClient.sendPush).toHaveBeenCalledWith({
          userId: loser.carrierId,
          title: "Tu oferta ya no está disponible",
          body: "El emisor eligió otra oferta para este envío.",
          data: { type: "offer_superseded", shipmentId, offerId: loser.id },
        });
      });
    });

    it("falla con 409 al aceptar una oferta vencida", async () => {
      const shipmentId = await createPublishedShipment();
      const expired = await offerRepo.create(
        baseOfferInput({ shipmentId, expiresAt: new Date(Date.now() - 60_000) })
      );

      const response = await app.inject({
        method: "POST",
        url: `/offers/${expired.id}/accept`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("OFFER_INVALID_TRANSITION");
    });

    it("bajo doble aceptación concurrente, una gana y la otra falla con 409", async () => {
      const shipmentId = await createPublishedShipment();
      const offerA = await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 4000 }));
      const offerB = await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 4500 }));

      const [resultA, resultB] = await Promise.allSettled([
        app.inject({ method: "POST", url: `/offers/${offerA.id}/accept`, headers: { "x-user-id": senderId } }),
        app.inject({ method: "POST", url: `/offers/${offerB.id}/accept`, headers: { "x-user-id": senderId } }),
      ]);

      const statusCodes = [resultA, resultB].map((result) =>
        result.status === "fulfilled" ? result.value.statusCode : null
      );
      expect(statusCodes).toContain(200);
      expect(statusCodes).toContain(409);
    });

    it("el receptor recibe 403 al intentar aceptar", async () => {
      const shipmentId = await createPublishedShipment();
      const offer = await offerRepo.create(baseOfferInput({ shipmentId }));

      const response = await app.inject({
        method: "POST",
        url: `/offers/${offer.id}/accept`,
        headers: { "x-user-id": receiverId },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
    });

    it("un admin recibe 403 al intentar aceptar (solo el emisor puede)", async () => {
      const shipmentId = await createPublishedShipment();
      const offer = await offerRepo.create(baseOfferInput({ shipmentId }));
      const adminId = randomUUID();

      const response = await app.inject({
        method: "POST",
        url: `/offers/${offer.id}/accept`,
        headers: { "x-user-id": adminId, "x-user-roles": "admin" },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
    });

    it("responde 404 para una oferta inexistente", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/offers/${randomUUID()}/accept`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("OFFER_NOT_FOUND");
    });

    it("responde 401 sin x-user-id", async () => {
      const shipmentId = await createPublishedShipment();
      const offer = await offerRepo.create(baseOfferInput({ shipmentId }));

      const response = await app.inject({ method: "POST", url: `/offers/${offer.id}/accept` });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /offers/:id/reject", () => {
    it("el emisor puede rechazar una oferta puntual (AC8): el envío sigue published", async () => {
      const shipmentId = await createPublishedShipment();
      const offer = await offerRepo.create(baseOfferInput({ shipmentId }));

      const response = await app.inject({
        method: "POST",
        url: `/offers/${offer.id}/reject`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.id).toBe(offer.id);
      expect(data.status).toBe(OfferStatus.REJECTED);

      const updatedShipment = await shipmentRepo.findById(shipmentId);
      expect(updatedShipment?.status).toBe(ShipmentStatus.PUBLISHED);

      await vi.waitFor(() => {
        expect(notificationsClient.sendPush).toHaveBeenCalledWith({
          userId: offer.carrierId,
          title: "Tu oferta fue rechazada",
          body: "El emisor rechazó tu oferta para este envío.",
          data: { type: "offer_rejected", shipmentId, offerId: offer.id },
        });
      });
    });

    it("el mismo transportista puede volver a ofertar tras un rechazo (AC8, fila nueva)", async () => {
      const shipmentId = await createPublishedShipment();
      const offer = await offerRepo.create(baseOfferInput({ shipmentId }));

      await app.inject({
        method: "POST",
        url: `/offers/${offer.id}/reject`,
        headers: { "x-user-id": senderId },
      });

      const secondOffer = await offerRepo.create(
        baseOfferInput({ shipmentId, carrierId: offer.carrierId, priceOffered: 4200 })
      );
      expect(secondOffer.status).toBe(OfferStatus.PENDING);
    });

    it("el receptor recibe 403 al intentar rechazar", async () => {
      const shipmentId = await createPublishedShipment();
      const offer = await offerRepo.create(baseOfferInput({ shipmentId }));

      const response = await app.inject({
        method: "POST",
        url: `/offers/${offer.id}/reject`,
        headers: { "x-user-id": receiverId },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
    });

    it("responde 404 para una oferta inexistente", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/offers/${randomUUID()}/reject`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("OFFER_NOT_FOUND");
    });

    it("falla con 409 al rechazar una oferta ya resuelta", async () => {
      const shipmentId = await createPublishedShipment();
      const offer = await offerRepo.create(baseOfferInput({ shipmentId }));
      await offerRepo.reject(offer.id);

      const response = await app.inject({
        method: "POST",
        url: `/offers/${offer.id}/reject`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("OFFER_INVALID_TRANSITION");
    });

    it("responde 401 sin x-user-id", async () => {
      const shipmentId = await createPublishedShipment();
      const offer = await offerRepo.create(baseOfferInput({ shipmentId }));

      const response = await app.inject({ method: "POST", url: `/offers/${offer.id}/reject` });
      expect(response.statusCode).toBe(401);
    });
  });
});
