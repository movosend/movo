import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { OfferStatus, ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateOfferInput } from "../src/models/offer";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";

const PICKUP_DATE = new Date("2026-08-20T00:00:00.000Z");

describe("GET /offers/:id (Postgres)", () => {
  let app: FastifyInstance;
  let offerRepo: OfferRepository;
  let shipmentRepo: ShipmentRepository;

  const baseShipmentInput: CreateShipmentInput = {
    senderId: randomUUID(),
    receiverId: randomUUID(),
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

  /** Mismo fixture que offers-mine.integration.test.ts: bypasea la máquina de
   * estados de Shipment a propósito, no es el objeto bajo prueba acá. */
  async function createPublishedShipment(): Promise<string> {
    const created = await shipmentRepo.create(baseShipmentInput);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    const published = await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    return published.id;
  }

  function requestDetail(offerId: string, carrierId: string) {
    return app.inject({
      method: "GET",
      url: `/offers/${offerId}`,
      headers: { "x-user-id": carrierId },
    });
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
    await app.ready();
    offerRepo = createOfferRepository(app.db);
    shipmentRepo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // CASCADE también vacía shipments.offers (FK a shipments.shipments).
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  it("detalle feliz: mismo shape enriquecido que un ítem de GET /offers/mine", async () => {
    const carrierId = randomUUID();
    const shipmentId = await createPublishedShipment();
    const created = await offerRepo.create(baseOfferInput({ shipmentId, carrierId, priceOffered: 1150 }));

    const response = await requestDetail(created.id, carrierId);

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.id).toBe(created.id);
    expect(data.carrierId).toBe(carrierId);
    expect(data.status).toBe(OfferStatus.PENDING);
    expect(data.priceOffered).toBe(1150);
    expect(data.priceNetArs).toBe(1000);
    expect(data.commissionAmountArs).toBe(150);
    expect(data.shipment).toMatchObject({
      id: shipmentId,
      status: ShipmentStatus.PUBLISHED,
      pickupAddress: baseShipmentInput.pickupAddress,
      deliveryAddress: baseShipmentInput.deliveryAddress,
      packageType: baseShipmentInput.packageType,
      weightKg: baseShipmentInput.weightKg,
      description: null,
    });
    expect(data.shipment.pickupDate).toBe("2026-08-20");
    expect(data.shipment.pickupLat).toBeUndefined();
    expect(data.shipment.pickupLng).toBeUndefined();
    // Único ofertante -- rankeable (pending + shipment published).
    expect(data.competitiveRank).toEqual({
      rank: 1,
      total: 1,
      lowestPriceNetArs: 1000,
      highestPriceNetArs: 1000,
    });
    expect(data.viewedAtBySender).toBeNull();
  });

  it("403 AUTH_FORBIDDEN sobre una oferta de otro transportista", async () => {
    const carrierId = randomUUID();
    const otherCarrierId = randomUUID();
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId, carrierId }));

    const response = await requestDetail(offer.id, otherCarrierId);

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
  });

  it("404 OFFER_NOT_FOUND sobre un id inexistente", async () => {
    const response = await requestDetail(randomUUID(), randomUUID());
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("OFFER_NOT_FOUND");
  });

  it("una pending vencida (expiresAt en el pasado, nunca persistida como expired) se reporta expired en el detalle", async () => {
    const carrierId = randomUUID();
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(
      baseOfferInput({ shipmentId, carrierId, expiresAt: new Date(Date.now() - 60_000) })
    );

    const response = await requestDetail(offer.id, carrierId);

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe(OfferStatus.EXPIRED);
    // La fila en base sigue pending -- expired es puramente derivado (AC11).
    const persisted = await offerRepo.findById(offer.id);
    expect(persisted?.status).toBe(OfferStatus.EXPIRED);
    expect(response.json().competitiveRank).toBeNull();
  });

  it("competitiveRank: null cuando el envío ya no acepta ofertas (cancelado), aunque la oferta siga pending en base", async () => {
    const carrierId = randomUUID();
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId, carrierId }));
    // cancelShipment (MOVO-108) no toca las filas de offers, solo el envío.
    await shipmentRepo.updateStatus(shipmentId, ShipmentStatus.CANCELLED, null);

    const response = await requestDetail(offer.id, carrierId);

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe(OfferStatus.PENDING);
    expect(response.json().shipment.status).toBe(ShipmentStatus.CANCELLED);
    expect(response.json().competitiveRank).toBeNull();
  });

  it("competitiveRank: null sobre una oferta ya accepted", async () => {
    const carrierId = randomUUID();
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId, carrierId }));
    await offerRepo.acceptOffer(offer.id, null);

    const response = await requestDetail(offer.id, carrierId);

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe(OfferStatus.ACCEPTED);
    expect(response.json().shipment.status).toBe(ShipmentStatus.ASSIGNMENT_PENDING);
    expect(response.json().competitiveRank).toBeNull();
  });

  it("responde 401 sin x-user-id", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId }));
    const response = await app.inject({ method: "GET", url: `/offers/${offer.id}` });
    expect(response.statusCode).toBe(401);
  });
});
