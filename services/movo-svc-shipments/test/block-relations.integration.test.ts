import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { ApiError, OfferStatus, ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { UsersClient } from "../src/adapters/users-client";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";
import { createFakePricingClient } from "./fake-pricing-client";

const PICKUP_DATE = new Date("2030-01-01T00:00:00.000Z");
const PICKUP_DATE_STR = "2030-01-01";
const ORIGIN_LAT = -31.4201;
const ORIGIN_LNG = -64.1888;
const DESTINATION_LAT = -31.4135;
const DESTINATION_LNG = -64.1811;

/**
 * MOVO-175 (ADR-026): efecto del bloqueo entre usuarios sobre envíos/ofertas. El
 * bloqueo es simétrico: cualquier dirección separa a los dos.
 */
describe("Bloqueo de usuarios en svc-shipments (Postgres, MOVO-175)", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let offerRepo: OfferRepository;

  const senderId = randomUUID();
  const receiverId = randomUUID();
  /** El emisor lo bloqueó. */
  const carrierBlockedBySender = randomUUID();
  /** Él bloqueó al receptor (la dirección inversa también cuenta). */
  const carrierWhoBlockedReceiver = randomUUID();
  const freeCarrier = randomUUID();
  /** Bloqueó al emisor: no puede ser designado receptor por él. */
  const receiverWhoBlockedSender = randomUUID();

  const blocks: Array<[string, string]> = [
    [senderId, carrierBlockedBySender],
    [carrierWhoBlockedReceiver, receiverId],
    [receiverWhoBlockedSender, senderId],
  ];

  const profiles = Object.fromEntries(
    [senderId, receiverId, carrierBlockedBySender, carrierWhoBlockedReceiver, freeCarrier, receiverWhoBlockedSender].map(
      (id) => [id, fakePublicProfile({ id, isVerified: true })],
    ),
  );

  function baseShipmentInput(overrides: Partial<CreateShipmentInput> = {}): CreateShipmentInput {
    return {
      senderId,
      receiverId,
      packageType: PackageType.standard_package,
      weightKg: 2.5,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      pickupAddress: "Av. Colón 1234, Córdoba",
      pickupLat: ORIGIN_LAT,
      pickupLng: ORIGIN_LNG,
      deliveryAddress: "Bv. San Juan 500, Córdoba",
      deliveryLat: DESTINATION_LAT,
      deliveryLng: DESTINATION_LNG,
      pickupDate: PICKUP_DATE,
      pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      suggestedPriceArs: 4500,
      ...overrides,
    };
  }

  async function createPublishedShipment(repo: ShipmentRepository = shipmentRepo) {
    const created = await repo.create(baseShipmentInput());
    await repo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await repo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    return repo.updateStatus(created.id, ShipmentStatus.PUBLISHED, created.senderId);
  }

  function requestAvailable(target: FastifyInstance, carrierId: string) {
    const query = new URLSearchParams({
      originLat: String(ORIGIN_LAT),
      originLng: String(ORIGIN_LNG),
      destinationLat: String(DESTINATION_LAT),
      destinationLng: String(DESTINATION_LNG),
    });
    return target.inject({
      method: "GET",
      url: `/shipments/available?${query.toString()}`,
      headers: { "x-user-id": carrierId, "x-user-roles": "carrier" },
    });
  }

  function requestCreateOffer(target: FastifyInstance, shipmentId: string, carrierId: string) {
    return target.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": carrierId, "x-user-roles": "carrier" },
      payload: { priceOfferedArs: 5000, offeredDate: PICKUP_DATE_STR },
    });
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    process.env.MOVO_COMMISSION_RATE = "0.15";

    app = buildApp({
      usersClient: createFakeUsersClient(profiles, {}, blocks),
      notificationsClient: createFakeNotificationsClient(),
      pricingClient: createFakePricingClient(),
      sweepEnabled: false,
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
    offerRepo = createOfferRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  describe("GET /shipments/available", () => {
    it("oculta el envío si el emisor o el receptor tienen un bloqueo con el transportista, con el total consistente", async () => {
      const shipment = await createPublishedShipment();

      for (const carrierId of [carrierBlockedBySender, carrierWhoBlockedReceiver]) {
        const response = await requestAvailable(app, carrierId);
        expect(response.statusCode).toBe(200);
        expect(response.json().items).toHaveLength(0);
        expect(response.json().total).toBe(0);
      }

      const free = await requestAvailable(app, freeCarrier);
      expect(free.json().items.map((i: { id: string }) => i.id)).toEqual([shipment.id]);
      expect(free.json().total).toBe(1);
    });
  });

  describe("POST /shipments/:id/offers", () => {
    it("403 USER_BLOCKED en cualquier dirección del bloqueo", async () => {
      const shipment = await createPublishedShipment();

      for (const carrierId of [carrierBlockedBySender, carrierWhoBlockedReceiver]) {
        const response = await requestCreateOffer(app, shipment.id, carrierId);
        expect(response.statusCode).toBe(403);
        expect(response.json().error.code).toBe("USER_BLOCKED");
      }
      expect((await requestCreateOffer(app, shipment.id, freeCarrier)).statusCode).toBe(201);
    });
  });

  describe("GET /shipments/:id/offers", () => {
    it("el emisor no ve ofertas pendientes de un transportista bloqueado (hechas antes del bloqueo)", async () => {
      const shipment = await createPublishedShipment();
      const visible = await offerRepo.create({
        shipmentId: shipment.id,
        carrierId: freeCarrier,
        priceOffered: 5000,
        offeredDate: PICKUP_DATE,
      });
      await offerRepo.create({
        shipmentId: shipment.id,
        carrierId: carrierBlockedBySender,
        priceOffered: 4000,
        offeredDate: PICKUP_DATE,
      });

      const response = await app.inject({
        method: "GET",
        url: `/shipments/${shipment.id}/offers`,
        headers: { "x-user-id": senderId, "x-user-roles": "sender" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().map((o: { id: string }) => o.id)).toEqual([visible.id]);
    });
  });

  describe("POST /offers/:id/accept", () => {
    it("403 USER_BLOCKED al aceptar la oferta de un transportista bloqueado; el envío sigue published", async () => {
      const shipment = await createPublishedShipment();
      const offer = await offerRepo.create({
        shipmentId: shipment.id,
        carrierId: carrierBlockedBySender,
        priceOffered: 4000,
        offeredDate: PICKUP_DATE,
      });

      const response = await app.inject({
        method: "POST",
        url: `/offers/${offer.id}/accept`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("USER_BLOCKED");
      expect((await shipmentRepo.findById(shipment.id))?.status).toBe(ShipmentStatus.PUBLISHED);
      expect((await offerRepo.findById(offer.id))?.status).toBe(OfferStatus.PENDING);
    });
  });

  describe("PATCH /offers/:id", () => {
    it("403 USER_BLOCKED al editar una oferta hecha antes del bloqueo; la oferta no cambia", async () => {
      const shipment = await createPublishedShipment();
      const offer = await offerRepo.create({
        shipmentId: shipment.id,
        carrierId: carrierBlockedBySender,
        priceOffered: 4000,
        offeredDate: PICKUP_DATE,
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/offers/${offer.id}`,
        headers: { "x-user-id": carrierBlockedBySender, "x-user-roles": "carrier" },
        payload: { priceOfferedArs: 3000 },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("USER_BLOCKED");
      expect((await offerRepo.findById(offer.id))?.priceOffered).toBe(offer.priceOffered);
    });
  });

  describe("POST /shipments", () => {
    const body = {
      packageType: "standard_package",
      weightKg: 2.5,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      description: "Caja con libros",
      pickupAddress: "Av. Colón 1234, Córdoba",
      pickupLat: ORIGIN_LAT,
      pickupLng: ORIGIN_LNG,
      deliveryAddress: "Bv. San Juan 500, Córdoba",
      deliveryLat: DESTINATION_LAT,
      deliveryLng: DESTINATION_LNG,
      pickupDate: PICKUP_DATE_STR,
      pickupTimeWindowStart: "09:00",
      pickupTimeWindowEnd: "12:00",
    };

    it("403 USER_BLOCKED al designar como receptor a alguien con un bloqueo", async () => {
      const blocked = await app.inject({
        method: "POST",
        url: "/shipments",
        headers: { "x-user-id": senderId },
        payload: { ...body, receiverId: receiverWhoBlockedSender },
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error.code).toBe("USER_BLOCKED");

      const ok = await app.inject({
        method: "POST",
        url: "/shipments",
        headers: { "x-user-id": senderId },
        payload: { ...body, receiverId },
      });
      expect(ok.statusCode).toBe(201);
    });
  });

  describe("svc-users caído", () => {
    let failingApp: FastifyInstance;

    beforeAll(async () => {
      const base = createFakeUsersClient(profiles);
      const usersClient: UsersClient = {
        ...base,
        listBlockRelatedUserIds: vi
          .fn()
          .mockRejectedValue(new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "caído")),
      };
      failingApp = buildApp({
        usersClient,
        notificationsClient: createFakeNotificationsClient(),
        pricingClient: createFakePricingClient(),
        sweepEnabled: false,
      });
      await failingApp.ready();
    });

    afterAll(async () => {
      await failingApp.close();
    });

    it("el feed falla abierto: se muestra sin filtrar", async () => {
      const shipment = await createPublishedShipment();

      const response = await requestAvailable(failingApp, carrierBlockedBySender);

      expect(response.statusCode).toBe(200);
      expect(response.json().items.map((i: { id: string }) => i.id)).toEqual([shipment.id]);
    });

    it("crear oferta falla cerrado: 502 USERS_SERVICE_UNAVAILABLE", async () => {
      const shipment = await createPublishedShipment();

      const response = await requestCreateOffer(failingApp, shipment.id, freeCarrier);

      expect(response.statusCode).toBe(502);
      expect(response.json().error.code).toBe("USERS_SERVICE_UNAVAILABLE");
    });
  });
});
