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

describe("GET /shipments/:id/offers (Postgres)", () => {
  let app: FastifyInstance;
  let offerRepo: OfferRepository;
  let shipmentRepo: ShipmentRepository;
  const senderId = randomUUID();
  const receiverId = randomUUID();
  const carrierId = randomUUID();

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

    app = buildApp({ sweepEnabled: false });
    await app.ready();
    offerRepo = createOfferRepository(app.db);
    shipmentRepo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  it("el emisor ve las ofertas vigentes con los snapshots del transportista (AC1/AC2)", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(
      baseOfferInput({
        shipmentId,
        carrierId,
        priceOffered: 4000,
        message: "Puedo retirar a la mañana",
        carrierNameAtOffer: "Juan Pérez",
        carrierRatingAtOffer: 4.8,
      })
    );

    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": senderId },
    });

    expect(response.statusCode).toBe(200);
    const items = response.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: offer.id,
      carrierId,
      priceOffered: 4000,
      message: "Puedo retirar a la mañana",
      carrierNameAtOffer: "Juan Pérez",
      carrierRatingAtOffer: 4.8,
      status: "pending",
    });
    // MOVO-182 (feedback de review, PR #164): offeredDate sale como YYYY-MM-DD, no
    // como instante completo -- mismo fix de schema que offers.schema.ts, este
    // endpoint tiene su propio offerResponse autocontenido en shipments.schema.ts.
    expect(items[0].offeredDate).toBe(PICKUP_DATE.toISOString().slice(0, 10));
  });

  it("el receptor recibe 403 (AC1)", async () => {
    const shipmentId = await createPublishedShipment();

    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": receiverId },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
  });

  it("un transportista (tercero) recibe 403 (AC1)", async () => {
    const shipmentId = await createPublishedShipment();

    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": carrierId },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
  });

  it("un admin puede ver la lista (AC1)", async () => {
    const shipmentId = await createPublishedShipment();
    await offerRepo.create(baseOfferInput({ shipmentId }));
    const adminId = randomUUID();

    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": adminId, "x-user-roles": "admin" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
  });

  it("ordena por precio ascendente por defecto (AC4)", async () => {
    const shipmentId = await createPublishedShipment();
    await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 5000 }));
    await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 3000 }));
    await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 4000 }));

    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": senderId },
    });

    const prices = response.json().map((offer: { priceOffered: number }) => offer.priceOffered);
    expect(prices).toEqual([3000, 4000, 5000]);
  });

  it("ordena por rating descendente con ?sort=rating, nulls al final (AC4)", async () => {
    const shipmentId = await createPublishedShipment();
    await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 100, carrierRatingAtOffer: 3.5 }));
    await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 200, carrierRatingAtOffer: null }));
    await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 300, carrierRatingAtOffer: 4.9 }));

    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers?sort=rating`,
      headers: { "x-user-id": senderId },
    });

    const ratings = response.json().map((offer: { carrierRatingAtOffer: number | null }) => offer.carrierRatingAtOffer);
    expect(ratings).toEqual([4.9, 3.5, null]);
  });

  it("por defecto solo devuelve ofertas vigentes; ?includeResolved=true suma el historial (AC5)", async () => {
    const shipmentId = await createPublishedShipment();
    const pending = await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 100 }));
    const rejected = await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 200 }));
    await offerRepo.reject(rejected.id);

    const defaultResponse = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": senderId },
    });
    expect(defaultResponse.json()).toHaveLength(1);
    expect(defaultResponse.json()[0].id).toBe(pending.id);

    const withResolved = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers?includeResolved=true`,
      headers: { "x-user-id": senderId },
    });
    expect(withResolved.json()).toHaveLength(2);
  });

  it("una oferta pending de un envío ya cancelado no aparece como vigente, pero sí con ?includeResolved=true (hallazgo de review PR #105)", async () => {
    const shipmentId = await createPublishedShipment();
    const pending = await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 100 }));
    // `cancelShipment` solo notifica a los transportistas, nunca transiciona las
    // filas de `offers` -- la oferta sigue `pending` en base pese a que el envío
    // ya no acepta asignaciones (ver shipments.service.ts#cancelShipment).
    await shipmentRepo.updateStatus(shipmentId, ShipmentStatus.CANCELLED, senderId, "cancelado por el emisor");

    const defaultResponse = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": senderId },
    });
    expect(defaultResponse.json()).toHaveLength(0);

    const withResolved = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers?includeResolved=true`,
      headers: { "x-user-id": senderId },
    });
    expect(withResolved.json()).toHaveLength(1);
    expect(withResolved.json()[0].id).toBe(pending.id);
  });

  it("MOVO-189 (AC1): la primera lectura del emisor marca viewedAtBySender, la segunda no lo cambia", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId }));

    const first = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": senderId },
    });
    expect(first.json()[0].viewedAtBySender).not.toBeNull();

    const afterFirstRead = await offerRepo.findById(offer.id);
    const viewedAtFirstRead = afterFirstRead?.viewedAtBySender?.getTime();

    const second = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": senderId },
    });
    expect(second.json()[0].viewedAtBySender).toBe(first.json()[0].viewedAtBySender);

    const afterSecondRead = await offerRepo.findById(offer.id);
    expect(afterSecondRead?.viewedAtBySender?.getTime()).toBe(viewedAtFirstRead);
  });

  it("MOVO-189 (AC1): una oferta creada después de la primera lectura aparece null hasta la próxima", async () => {
    const shipmentId = await createPublishedShipment();
    await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 1000 }));

    await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": senderId },
    });

    const lateOffer = await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 2000 }));
    const stillUnread = await offerRepo.findById(lateOffer.id);
    expect(stillUnread?.viewedAtBySender).toBeNull();

    const nextRead = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": senderId },
    });
    const lateItem = nextRead.json().find((item: { id: string }) => item.id === lateOffer.id);
    expect(lateItem.viewedAtBySender).not.toBeNull();
  });

  it("MOVO-189 (AC3): un admin que ve la lista no marca la oferta como vista por el emisor", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId }));

    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": randomUUID(), "x-user-roles": "admin" },
    });
    expect(response.json()[0].viewedAtBySender).toBeNull();

    const stored = await offerRepo.findById(offer.id);
    expect(stored?.viewedAtBySender).toBeNull();
  });

  it("MOVO-189 (AC4): una oferta ya resuelta conserva el viewedAtBySender que tenía al resolverse", async () => {
    const shipmentId = await createPublishedShipment();
    const toReject = await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 1000 }));

    await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": senderId },
    });
    const viewedAt = (await offerRepo.findById(toReject.id))?.viewedAtBySender?.getTime();
    expect(viewedAt).toBeDefined();

    await offerRepo.reject(toReject.id);

    const afterResolution = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/offers?includeResolved=true`,
      headers: { "x-user-id": senderId },
    });
    const rejectedItem = afterResolution.json().find((item: { id: string }) => item.id === toReject.id);
    expect(new Date(rejectedItem.viewedAtBySender).getTime()).toBe(viewedAt);
  });

  it("responde 404 para un envío inexistente", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/shipments/${randomUUID()}/offers`,
      headers: { "x-user-id": senderId },
    });

    expect(response.statusCode).toBe(404);
  });

  it("responde 401 sin x-user-id", async () => {
    const shipmentId = await createPublishedShipment();
    const response = await app.inject({ method: "GET", url: `/shipments/${shipmentId}/offers` });
    expect(response.statusCode).toBe(401);
  });
});
