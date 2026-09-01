import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateOfferInput } from "../src/models/offer";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";

const PICKUP_DATE = new Date("2026-08-20T00:00:00.000Z");

describe("POST /offers/:id/withdraw (Postgres, MOVO-143)", () => {
  let app: FastifyInstance;
  let offerRepo: OfferRepository;
  let shipmentRepo: ShipmentRepository;
  const senderId = randomUUID();
  const receiverId = randomUUID();
  const carrierId = randomUUID();
  const otherCarrierId = randomUUID();

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
      carrierId,
      priceOffered: 5000,
      offeredDate: PICKUP_DATE,
      ...overrides,
    };
  }

  async function createPublishedShipment(): Promise<string> {
    const created = await shipmentRepo.create(baseShipmentInput);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    const published = await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    return published.id;
  }

  async function requestWithdraw(offerId: string, userId: string) {
    return app.inject({
      method: "POST",
      url: `/offers/${offerId}/withdraw`,
      headers: { "x-user-id": userId },
    });
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    app = buildApp({ sweepEnabled: false });
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

  it("AC8: el transportista dueño retira su oferta pending -> withdrawn", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId }));

    const response = await requestWithdraw(offer.id, carrierId);

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("withdrawn");

    const persisted = await offerRepo.findById(offer.id);
    expect(persisted?.status).toBe("withdrawn");
  });

  it("AC8: 403 AUTH_FORBIDDEN si quien retira no es el dueño de la oferta", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId }));

    const response = await requestWithdraw(offer.id, otherCarrierId);

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AUTH_FORBIDDEN");

    const persisted = await offerRepo.findById(offer.id);
    expect(persisted?.status).toBe("pending");
  });

  it("AC8: 409 OFFER_INVALID_TRANSITION sobre una oferta ya aceptada", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId }));
    await offerRepo.acceptOffer(offer.id, senderId);

    const response = await requestWithdraw(offer.id, carrierId);

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("OFFER_INVALID_TRANSITION");
  });

  it("404 OFFER_NOT_FOUND sobre una oferta inexistente", async () => {
    const response = await requestWithdraw(randomUUID(), carrierId);
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("OFFER_NOT_FOUND");
  });
});
