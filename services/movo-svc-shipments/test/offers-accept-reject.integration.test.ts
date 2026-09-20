import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { OfferStatus, ShipmentStatus, TripStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createTripRepository, TripRepository } from "../src/repositories/trip-repository";
import { CreateOfferInput } from "../src/models/offer";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeNotificationsClient } from "./fake-notifications-client";
import { NotificationsClient } from "../src/adapters/notifications-client";
import { UsersClient } from "../src/adapters/users-client";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";

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

    it("MOVO-180: propaga la entrega estimada de la oferta ganadora al envío, sin tocarla en las perdedoras", async () => {
      const shipmentId = await createPublishedShipment();
      const winner = await offerRepo.create(
        baseOfferInput({
          shipmentId,
          priceOffered: 4000,
          estimatedDeliveryDate: new Date("2026-08-21T00:00:00.000Z"),
          estimatedDeliveryTimeWindowStart: "15:00:00",
          estimatedDeliveryTimeWindowEnd: "19:00:00",
        })
      );
      const loser = await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 4500 }));

      const response = await app.inject({
        method: "POST",
        url: `/offers/${winner.id}/accept`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(200);
      const updatedShipment = await shipmentRepo.findById(shipmentId);
      expect(updatedShipment?.estimatedDeliveryDate?.toISOString()).toBe("2026-08-21T00:00:00.000Z");
      expect(updatedShipment?.estimatedDeliveryTimeWindowStart).toBe("15:00:00");
      expect(updatedShipment?.estimatedDeliveryTimeWindowEnd).toBe("19:00:00");

      const updatedLoser = await offerRepo.findById(loser.id);
      expect(updatedLoser?.estimatedDeliveryDate).toBeNull();

      // Ida y vuelta completa por HTTP: confirma que el DTO de GET /shipments/:id
      // (toShipmentDto) formatea estimatedDeliveryDate como date-only, sin el
      // corrimiento de timezone del gotcha de asDate (ver shipments.routes.ts).
      const detail = await app.inject({
        method: "GET",
        url: `/shipments/${shipmentId}`,
        headers: { "x-user-id": senderId },
      });
      expect(detail.json().estimatedDeliveryDate).toBe("2026-08-21");
      expect(detail.json().estimatedDeliveryTimeWindowStart).toBe("15:00:00");
      expect(detail.json().estimatedDeliveryTimeWindowEnd).toBe("19:00:00");
    });

    it("MOVO-180: si la oferta ganadora nunca declaró entrega estimada, el envío queda con los tres campos null", async () => {
      const shipmentId = await createPublishedShipment();
      const winner = await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 4000 }));

      const response = await app.inject({
        method: "POST",
        url: `/offers/${winner.id}/accept`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(200);
      const updatedShipment = await shipmentRepo.findById(shipmentId);
      expect(updatedShipment?.estimatedDeliveryDate).toBeNull();
      expect(updatedShipment?.estimatedDeliveryTimeWindowStart).toBeNull();
      expect(updatedShipment?.estimatedDeliveryTimeWindowEnd).toBeNull();
    });

    it("MOVO-186: la respuesta desglosa priceNetArs/commissionAmountArs a partir de priceOffered (bruto), tasa 15% default", async () => {
      const shipmentId = await createPublishedShipment();
      const winner = await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 1150 }));

      const response = await app.inject({
        method: "POST",
        url: `/offers/${winner.id}/accept`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.priceOffered).toBe(1150);
      expect(data.priceNetArs).toBe(1000);
      expect(data.commissionAmountArs).toBe(150);
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

    it("MOVO-186: la respuesta desglosa priceNetArs/commissionAmountArs a partir de priceOffered (bruto), tasa 15% default", async () => {
      const shipmentId = await createPublishedShipment();
      const offer = await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 1150 }));

      const response = await app.inject({
        method: "POST",
        url: `/offers/${offer.id}/reject`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.priceOffered).toBe(1150);
      expect(data.priceNetArs).toBe(1000);
      expect(data.commissionAmountArs).toBe(150);
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

  describe("MOVO-234: auto-crear Trip al aceptar una oferta sin viaje asociado", () => {
    let appWithVehicle: FastifyInstance;
    let notificationsClientWithVehicle: NotificationsClient;
    let tripRepo: TripRepository;
    const carrierWithVehicleId = randomUUID();

    const usersClientWithVehicle: UsersClient = createFakeUsersClient({
      [carrierWithVehicleId]: fakePublicProfile({
        id: carrierWithVehicleId,
        vehicle: { brand: "Toyota", model: "Hilux", cargoCapacityLabel: "Grande", licensePlate: "AB123CD" },
      }),
    });

    beforeAll(async () => {
      notificationsClientWithVehicle = createFakeNotificationsClient();
      appWithVehicle = buildApp({
        notificationsClient: notificationsClientWithVehicle,
        usersClient: usersClientWithVehicle,
        sweepEnabled: false,
      });
      await appWithVehicle.ready();
      tripRepo = createTripRepository(appWithVehicle.db);
    });

    afterAll(async () => {
      await appWithVehicle.close();
    });

    it("crea un Trip declared a partir del envío (origen/destino/departureAt) y asocia Offer.tripId", async () => {
      const shipmentId = await createPublishedShipment();
      const offer = await offerRepo.create(baseOfferInput({ shipmentId, carrierId: carrierWithVehicleId }));

      const response = await appWithVehicle.inject({
        method: "POST",
        url: `/offers/${offer.id}/accept`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.tripId).not.toBeNull();

      const trip = await tripRepo.findById(data.tripId);
      expect(trip).not.toBeNull();
      expect(trip?.carrierId).toBe(carrierWithVehicleId);
      expect(trip?.status).toBe(TripStatus.DECLARED);
      expect(trip?.originAddress).toBe(baseShipmentInput.pickupAddress);
      expect(trip?.destinationAddress).toBe(baseShipmentInput.deliveryAddress);
      expect(trip?.vehicleType).toBe("Toyota Hilux");
      // offeredDate == pickupDate (2026-08-20), sin franja propuesta -> usa la ventana
      // original del envío (09:00 ARG == 12:00 UTC, ver acceptedOfferPickupWindowStartInstant).
      expect(trip?.departureAt.toISOString()).toBe("2026-08-20T12:00:00.000Z");
    });

    it("usa la franja horaria propuesta por el transportista (MOVO-177) para departureAt, no la original del envío", async () => {
      const shipmentId = await createPublishedShipment();
      const offer = await offerRepo.create(
        baseOfferInput({
          shipmentId,
          carrierId: carrierWithVehicleId,
          offeredDate: new Date("2026-08-22T00:00:00.000Z"),
          offeredPickupTimeWindowStart: "14:30:00",
          offeredPickupTimeWindowEnd: "17:00:00",
        })
      );

      const response = await appWithVehicle.inject({
        method: "POST",
        url: `/offers/${offer.id}/accept`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(200);
      const trip = await tripRepo.findById(response.json().tripId);
      expect(trip?.departureAt.toISOString()).toBe("2026-08-22T17:30:00.000Z");
    });

    it("no crea un Trip nuevo si la oferta ya venía asociada a un viaje (Offer.tripId preexistente)", async () => {
      // Carrier propio de este caso (no `carrierWithVehicleId`, reusado por otros tests
      // de este describe): así el conteo de "no creó un Trip nuevo" no se contamina con
      // viajes que otros tests ya crearon para ese mismo carrier -- `shipments.trips`
      // no se trunca entre tests (solo `shipments.shipments`, CASCADE no llega ahí,
      // `Offer.trip` es `onDelete: SetNull`), mismo motivo por el que el resto del
      // archivo usa un `carrierId` fresco por test.
      const ownCarrierId = randomUUID();
      const existingTrip = await tripRepo.create({
        carrierId: ownCarrierId,
        originAddress: "Origen declarado a mano",
        originLat: -31.42,
        originLng: -64.18,
        destinationAddress: "Destino declarado a mano",
        destinationLat: -31.41,
        destinationLng: -64.17,
        departureAt: new Date("2026-08-25T12:00:00.000Z"),
        vehicleType: "Toyota Hilux",
      });
      const shipmentId = await createPublishedShipment();
      const offer = await offerRepo.create(
        baseOfferInput({ shipmentId, carrierId: ownCarrierId, tripId: existingTrip.id })
      );

      const response = await appWithVehicle.inject({
        method: "POST",
        url: `/offers/${offer.id}/accept`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().tripId).toBe(existingTrip.id);

      const { total } = await tripRepo.listByCarrier(ownCarrierId, 1, 50);
      expect(total).toBe(1);
    });

    it("notifica al transportista sobre el viaje auto-creado (AC3)", async () => {
      const shipmentId = await createPublishedShipment();
      const offer = await offerRepo.create(baseOfferInput({ shipmentId, carrierId: carrierWithVehicleId }));

      const response = await appWithVehicle.inject({
        method: "POST",
        url: `/offers/${offer.id}/accept`,
        headers: { "x-user-id": senderId },
      });
      const tripId = response.json().tripId;

      await vi.waitFor(() => {
        expect(notificationsClientWithVehicle.sendPush).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: carrierWithVehicleId,
            data: { type: "trip_auto_created", tripId },
          })
        );
      });
    });

    it("sin ficha de vehículo cargada, el Trip auto-creado queda con el placeholder", async () => {
      const carrierWithoutVehicleId = randomUUID();
      const shipmentId = await createPublishedShipment();
      const offer = await offerRepo.create(baseOfferInput({ shipmentId, carrierId: carrierWithoutVehicleId }));

      const response = await appWithVehicle.inject({
        method: "POST",
        url: `/offers/${offer.id}/accept`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(200);
      const trip = await tripRepo.findById(response.json().tripId);
      expect(trip?.vehicleType).toBe("Vehículo sin especificar");
    });
  });
});
