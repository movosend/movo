import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { CreateOfferInput } from "../src/models/offer";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";

const PICKUP_DATE = new Date("2030-01-01T00:00:00.000Z");

// Mismo par de coordenadas que baseInput de los demás tests de shipments (~1.04km
// entre sí, comentario de MOVO-126) -- se usan acá como origen/destino "por defecto"
// del trayecto del transportista en la mayoría de los casos.
const ORIGIN_LAT = -31.4201;
const ORIGIN_LNG = -64.1888;
const DESTINATION_LAT = -31.4135;
const DESTINATION_LNG = -64.1811;

describe("GET /shipments/available (Postgres, MOVO-142)", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let offerRepo: OfferRepository;

  const verifiedCarrierId = randomUUID();
  const unverifiedCarrierId = randomUUID();

  function baseShipmentInput(overrides: Partial<CreateShipmentInput> = {}): CreateShipmentInput {
    return {
      senderId: randomUUID(),
      receiverId: randomUUID(),
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

  async function createPublishedShipment(overrides: Partial<CreateShipmentInput> = {}) {
    const created = await shipmentRepo.create(baseShipmentInput(overrides));
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    return shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, created.senderId);
  }

  function baseOfferInput(overrides: Partial<CreateOfferInput> & { shipmentId: string }): CreateOfferInput {
    return {
      carrierId: verifiedCarrierId,
      priceOffered: 5000,
      offeredDate: PICKUP_DATE,
      ...overrides,
    };
  }

  async function requestAvailable(userId: string, overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    const query = new URLSearchParams({
      originLat: String(ORIGIN_LAT),
      originLng: String(ORIGIN_LNG),
      destinationLat: String(DESTINATION_LAT),
      destinationLng: String(DESTINATION_LNG),
      ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, String(v)])),
    });
    return app.inject({
      method: "GET",
      url: `/shipments/available?${query.toString()}`,
      headers: { "x-user-id": userId, "x-user-roles": "carrier", ...headers },
    });
  }

  /** A diferencia de requestAvailable, no manda destinationLat/Lng -- para probar el
   * caso AC1 original (el caller no tiene un viaje planificado). */
  async function requestAvailableWithoutDestination(userId: string, overrides: Record<string, unknown> = {}) {
    const query = new URLSearchParams({
      originLat: String(ORIGIN_LAT),
      originLng: String(ORIGIN_LNG),
      ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, String(v)])),
    });
    return app.inject({
      method: "GET",
      url: `/shipments/available?${query.toString()}`,
      headers: { "x-user-id": userId, "x-user-roles": "carrier" },
    });
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    app = buildApp({
      usersClient: createFakeUsersClient({
        [verifiedCarrierId]: fakePublicProfile({ id: verifiedCarrierId, isVerified: true }),
        [unverifiedCarrierId]: fakePublicProfile({ id: unverifiedCarrierId, isVerified: false }),
      }),
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
    offerRepo = createOfferRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // CASCADE también vacía offers (FK a shipments.shipments).
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  describe("gating (AC6)", () => {
    it("403 CARRIER_NOT_VERIFIED sin rol carrier en el header", async () => {
      const response = await requestAvailable(verifiedCarrierId, {}, { "x-user-roles": "sender" });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("CARRIER_NOT_VERIFIED");
    });

    it("403 CARRIER_NOT_VERIFIED con rol carrier pero isVerified:false", async () => {
      const response = await requestAvailable(unverifiedCarrierId);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("CARRIER_NOT_VERIFIED");
    });

    it("200 con rol carrier + isVerified:true, sin datos de licencia (AC6: la licencia NO se exige)", async () => {
      // fakePublicProfile no incluye ningún campo de licencia -- el gate pasa igual.
      const response = await requestAvailable(verifiedCarrierId);
      expect(response.statusCode).toBe(200);
    });
  });

  describe("filtro y proyección", () => {
    it("solo devuelve envíos published", async () => {
      const published = await createPublishedShipment();
      const draft = await shipmentRepo.create(baseShipmentInput());

      const response = await requestAvailable(verifiedCarrierId);

      expect(response.statusCode).toBe(200);
      const ids = response.json().items.map((i: { id: string }) => i.id);
      expect(ids).toEqual([published.id]);
      expect(ids).not.toContain(draft.id);
    });

    it("excluye los envíos propios del caller (sender o receiver)", async () => {
      const ownAsSender = await createPublishedShipment({ senderId: verifiedCarrierId });
      const ownAsReceiver = await createPublishedShipment({ receiverId: verifiedCarrierId });
      const foreign = await createPublishedShipment();

      const response = await requestAvailable(verifiedCarrierId);

      const ids = response.json().items.map((i: { id: string }) => i.id);
      expect(ids).toEqual([foreign.id]);
      expect(ids).not.toContain(ownAsSender.id);
      expect(ids).not.toContain(ownAsReceiver.id);
    });

    it("AC9: la respuesta no incluye datos personales de emisor/receptor", async () => {
      await createPublishedShipment();
      const response = await requestAvailable(verifiedCarrierId);

      const item = response.json().items[0];
      expect(item).not.toHaveProperty("senderId");
      expect(item).not.toHaveProperty("receiverId");
      expect(item).not.toHaveProperty("carrierId");
      expect(item).not.toHaveProperty("agreedPriceArs");
      expect(item).not.toHaveProperty("paymentMethod");
    });

    it("AC9: la respuesta sí incluye direcciones, ventana horaria y las distancias", async () => {
      await createPublishedShipment();
      const response = await requestAvailable(verifiedCarrierId);

      const item = response.json().items[0];
      expect(item.pickupAddress).toBe("Av. Colón 1234, Córdoba");
      expect(item.deliveryAddress).toBe("Bv. San Juan 500, Córdoba");
      expect(item.pickupTimeWindowStart).toBe("09:00:00");
      expect(item.pickupTimeWindowEnd).toBe("12:00:00");
      expect(typeof item.pickupDistanceKm).toBe("number");
      expect(typeof item.deliveryDistanceKm).toBe("number");
      expect(typeof item.distanceKm).toBe("number");
      expect(typeof item.hasMyOffer).toBe("boolean");
    });
  });

  describe("hasMyOffer (AC5)", () => {
    it("true si el caller tiene una oferta pending sobre el envío", async () => {
      const shipment = await createPublishedShipment();
      await offerRepo.create(baseOfferInput({ shipmentId: shipment.id, carrierId: verifiedCarrierId }));

      const response = await requestAvailable(verifiedCarrierId);

      expect(response.json().items[0].hasMyOffer).toBe(true);
    });

    it("false si el caller no ofertó", async () => {
      await createPublishedShipment();
      const response = await requestAvailable(verifiedCarrierId);
      expect(response.json().items[0].hasMyOffer).toBe(false);
    });

    it("false si la única oferta del caller sobre ese envío está withdrawn", async () => {
      const shipment = await createPublishedShipment();
      const offer = await offerRepo.create(baseOfferInput({ shipmentId: shipment.id, carrierId: verifiedCarrierId }));
      await offerRepo.withdraw(offer.id);

      const response = await requestAvailable(verifiedCarrierId);

      expect(response.json().items[0].hasMyOffer).toBe(false);
    });

    it("no marca hasMyOffer con la oferta de OTRO transportista sobre el mismo envío", async () => {
      const shipment = await createPublishedShipment();
      await offerRepo.create(baseOfferInput({ shipmentId: shipment.id, carrierId: randomUUID() }));

      const response = await requestAvailable(verifiedCarrierId);

      expect(response.json().items[0].hasMyOffer).toBe(false);
    });
  });

  describe("paginación y validación", () => {
    it("responde con el contrato {items, page, limit, total}", async () => {
      await createPublishedShipment();
      const response = await requestAvailable(verifiedCarrierId);

      const body = response.json();
      expect(body).toHaveProperty("items");
      expect(body).toHaveProperty("page", 1);
      expect(body).toHaveProperty("limit", 20);
      expect(body).toHaveProperty("total", 1);
    });

    it("radiusKm por defecto es 50 -- un envío bien cerca aparece sin mandar el parámetro", async () => {
      await createPublishedShipment();
      const response = await requestAvailable(verifiedCarrierId);
      expect(response.statusCode).toBe(200);
      expect(response.json().items).toHaveLength(1);
    });

    it("radiusKm=500 rechaza con 400 (tope duro de 200)", async () => {
      const response = await requestAvailable(verifiedCarrierId, { radiusKm: 500 });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_FAILED");
    });

    it("faltan originLat/originLng (los únicos obligatorios) -> 400 VALIDATION_FAILED", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/shipments/available",
        headers: { "x-user-id": verifiedCarrierId, "x-user-roles": "carrier" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_FAILED");
    });

    it("destinationLat sin destinationLng (o viceversa) -> 400 VALIDATION_FAILED", async () => {
      const response = await requestAvailableWithoutDestination(verifiedCarrierId, { destinationLat: DESTINATION_LAT });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_FAILED");
    });
  });

  // MOVO-142 (corrección de diseño): el destino es opcional -- el transportista no
  // tiene por qué tener un viaje planificado para ver envíos cerca suyo (AC1
  // original).
  describe("sin destino (AC1 original: solo cerca del origen)", () => {
    it("200 sin mandar destinationLat/Lng -- filtra por cercanía del retiro al origen únicamente", async () => {
      const shipment = await createPublishedShipment();
      const response = await requestAvailableWithoutDestination(verifiedCarrierId);

      expect(response.statusCode).toBe(200);
      const ids = response.json().items.map((i: { id: string }) => i.id);
      expect(ids).toEqual([shipment.id]);
    });

    it("deliveryDistanceKm es null y distanceKm coincide con pickupDistanceKm", async () => {
      await createPublishedShipment();
      const response = await requestAvailableWithoutDestination(verifiedCarrierId);

      const item = response.json().items[0];
      expect(item.deliveryDistanceKm).toBeNull();
      expect(item.distanceKm).toBe(item.pickupDistanceKm);
    });

    it("un envío con retiro lejos del origen no aparece, aunque su entrega esté cerca de cualquier punto", async () => {
      const near = await createPublishedShipment();
      const far = await createPublishedShipment({ pickupLat: ORIGIN_LAT - 0.5, pickupLng: ORIGIN_LNG });

      const response = await requestAvailableWithoutDestination(verifiedCarrierId);

      const ids = response.json().items.map((i: { id: string }) => i.id);
      expect(ids).toEqual([near.id]);
      expect(ids).not.toContain(far.id);
    });

    it("hasMyOffer sigue funcionando igual sin destino", async () => {
      const shipment = await createPublishedShipment();
      await offerRepo.create(baseOfferInput({ shipmentId: shipment.id, carrierId: verifiedCarrierId }));

      const response = await requestAvailableWithoutDestination(verifiedCarrierId);

      expect(response.json().items[0].hasMyOffer).toBe(true);
    });
  });
});
