import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { OfferStatus, ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateOfferInput } from "../src/models/offer";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";

const PICKUP_DATE = new Date("2026-08-20T00:00:00.000Z");

describe("GET /offers/mine (Postgres)", () => {
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

  /** Mismo fixture que offer-repository.integration.test.ts: bypasea la máquina de
   * estados de Shipment a propósito, no es el objeto bajo prueba acá. */
  async function createPublishedShipment(): Promise<string> {
    const created = await shipmentRepo.create(baseShipmentInput);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    const published = await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    return published.id;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://user:password@localhost:5432/movo";
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

  it("AC1: lista solo las ofertas del transportista autenticado, nunca las de otro", async () => {
    const shipmentId = await createPublishedShipment();
    const carrierA = randomUUID();
    const carrierB = randomUUID();
    await offerRepo.create(baseOfferInput({ shipmentId, carrierId: carrierA }));
    await offerRepo.create(baseOfferInput({ shipmentId, carrierId: carrierB }));

    const response = await app.inject({
      method: "GET",
      url: "/offers/mine",
      headers: { "x-user-id": carrierA },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].carrierId).toBe(carrierA);
  });

  it("ignora cualquier carrierId mandado por query param -- siempre usa el del header", async () => {
    const shipmentId = await createPublishedShipment();
    const carrierA = randomUUID();
    const carrierB = randomUUID();
    await offerRepo.create(baseOfferInput({ shipmentId, carrierId: carrierB }));

    const response = await app.inject({
      method: "GET",
      url: `/offers/mine?carrierId=${carrierB}`,
      headers: { "x-user-id": carrierA },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(0);
  });

  it("AC3: filtra por status efectivo -- una pending vencida sale como expired sin filtro explícito y bajo ?status=expired", async () => {
    const carrierId = randomUUID();
    const shipmentVigente = await createPublishedShipment();
    await offerRepo.create(baseOfferInput({ shipmentId: shipmentVigente, carrierId }));
    const shipmentVencido = await createPublishedShipment();
    await offerRepo.create(
      baseOfferInput({ shipmentId: shipmentVencido, carrierId, expiresAt: new Date(Date.now() - 60_000) }),
    );

    const expiredResponse = await app.inject({
      method: "GET",
      url: "/offers/mine?status=expired",
      headers: { "x-user-id": carrierId },
    });
    expect(expiredResponse.statusCode).toBe(200);
    expect(expiredResponse.json().total).toBe(1);
    expect(expiredResponse.json().items[0].status).toBe(OfferStatus.EXPIRED);

    const pendingResponse = await app.inject({
      method: "GET",
      url: "/offers/mine?status=pending",
      headers: { "x-user-id": carrierId },
    });
    expect(pendingResponse.json().total).toBe(1);
  });

  it("AC4: cada ítem trae el contexto mínimo del envío", async () => {
    const carrierId = randomUUID();
    const shipmentId = await createPublishedShipment();
    await offerRepo.create(baseOfferInput({ shipmentId, carrierId }));

    const response = await app.inject({
      method: "GET",
      url: "/offers/mine",
      headers: { "x-user-id": carrierId },
    });

    const item = response.json().items[0];
    expect(item.shipment).toMatchObject({
      id: shipmentId,
      status: ShipmentStatus.PUBLISHED,
      pickupAddress: baseShipmentInput.pickupAddress,
      deliveryAddress: baseShipmentInput.deliveryAddress,
      // MOVO-185: resumen del paquete, sin lat/lng crudos.
      packageType: baseShipmentInput.packageType,
      weightKg: baseShipmentInput.weightKg,
      description: null,
    });
    expect(item.shipment.pickupDate).toBe("2026-08-20");
    expect(typeof item.shipment.distanceKm).toBe("number");
    expect(item.shipment.pickupLat).toBeUndefined();
    expect(item.shipment.pickupLng).toBeUndefined();
  });

  it("AC5: una oferta accepted expone el status real del envío (assignment_pending)", async () => {
    const carrierId = randomUUID();
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId, carrierId }));
    await offerRepo.acceptOffer(offer.id, null);

    const response = await app.inject({
      method: "GET",
      url: "/offers/mine",
      headers: { "x-user-id": carrierId },
    });

    const item = response.json().items[0];
    expect(item.status).toBe(OfferStatus.ACCEPTED);
    expect(item.shipment.status).toBe(ShipmentStatus.ASSIGNMENT_PENDING);
  });

  it("pagina correctamente", async () => {
    const carrierId = randomUUID();
    for (let i = 0; i < 5; i++) {
      const shipmentId = await createPublishedShipment();
      await offerRepo.create(baseOfferInput({ shipmentId, carrierId }));
    }

    const page1 = await app.inject({
      method: "GET",
      url: "/offers/mine?page=1&limit=2",
      headers: { "x-user-id": carrierId },
    });
    const page2 = await app.inject({
      method: "GET",
      url: "/offers/mine?page=2&limit=2",
      headers: { "x-user-id": carrierId },
    });

    expect(page1.json().items).toHaveLength(2);
    expect(page2.json().items).toHaveLength(2);
    expect(page1.json().total).toBe(5);
    const page1Ids = page1.json().items.map((o: { id: string }) => o.id);
    const page2Ids = page2.json().items.map((o: { id: string }) => o.id);
    expect(page1Ids).not.toEqual(page2Ids);
  });

  it("responde 401 sin x-user-id", async () => {
    const response = await app.inject({ method: "GET", url: "/offers/mine" });
    expect(response.statusCode).toBe(401);
  });

  describe("MOVO-188: competitiveRank", () => {
    it("AC1-AC3: 3 transportistas ofertando el mismo envío ven su propio rank correcto", async () => {
      const shipmentId = await createPublishedShipment();
      const carrierLow = randomUUID();
      const carrierMid = randomUUID();
      const carrierHigh = randomUUID();
      // Brutos elegidos para que el neto (rate 0.15 default) dé exacto: /1.15.
      await offerRepo.create(baseOfferInput({ shipmentId, carrierId: carrierLow, priceOffered: 4600 }));
      await offerRepo.create(baseOfferInput({ shipmentId, carrierId: carrierMid, priceOffered: 5750 }));
      await offerRepo.create(baseOfferInput({ shipmentId, carrierId: carrierHigh, priceOffered: 6900 }));

      const [lowRes, midRes, highRes] = await Promise.all(
        [carrierLow, carrierMid, carrierHigh].map((carrierId) =>
          app.inject({ method: "GET", url: "/offers/mine", headers: { "x-user-id": carrierId } })
        )
      );

      const expectedBounds = { total: 3, lowestPriceNetArs: 4000, highestPriceNetArs: 6000 };
      expect(lowRes.json().items[0].competitiveRank).toEqual({ rank: 1, ...expectedBounds });
      expect(midRes.json().items[0].competitiveRank).toEqual({ rank: 2, ...expectedBounds });
      expect(highRes.json().items[0].competitiveRank).toEqual({ rank: 3, ...expectedBounds });
    });

    it("una oferta accepted/rejected/expired/withdrawn/superseded expone competitiveRank: null", async () => {
      const carrierAccepted = randomUUID();
      const shipmentAccepted = await createPublishedShipment();
      const accepted = await offerRepo.create(baseOfferInput({ shipmentId: shipmentAccepted, carrierId: carrierAccepted }));
      await offerRepo.acceptOffer(accepted.id, null);

      const carrierRejected = randomUUID();
      const shipmentRejected = await createPublishedShipment();
      const rejected = await offerRepo.create(baseOfferInput({ shipmentId: shipmentRejected, carrierId: carrierRejected }));
      await offerRepo.reject(rejected.id);

      const carrierExpired = randomUUID();
      const shipmentExpired = await createPublishedShipment();
      await offerRepo.create(
        baseOfferInput({ shipmentId: shipmentExpired, carrierId: carrierExpired, expiresAt: new Date(Date.now() - 60_000) }),
      );

      const carrierWithdrawn = randomUUID();
      const shipmentWithdrawn = await createPublishedShipment();
      const withdrawn = await offerRepo.create(baseOfferInput({ shipmentId: shipmentWithdrawn, carrierId: carrierWithdrawn }));
      await offerRepo.withdraw(withdrawn.id);

      const carrierSuperseded = randomUUID();
      const shipmentSuperseded = await createPublishedShipment();
      await offerRepo.create(baseOfferInput({ shipmentId: shipmentSuperseded, carrierId: carrierSuperseded }));
      const winningOffer = await offerRepo.create(baseOfferInput({ shipmentId: shipmentSuperseded, carrierId: randomUUID() }));
      await offerRepo.acceptOffer(winningOffer.id, null);

      for (const carrierId of [carrierAccepted, carrierRejected, carrierExpired, carrierWithdrawn, carrierSuperseded]) {
        const response = await app.inject({
          method: "GET",
          url: "/offers/mine",
          headers: { "x-user-id": carrierId },
        });
        expect(response.json().items[0].competitiveRank).toBeNull();
      }
    });

    it("una oferta pending sobre un envío ya cancelado (que no toca las ofertas) expone competitiveRank: null", async () => {
      const shipmentId = await createPublishedShipment();
      const carrierId = randomUUID();
      await offerRepo.create(baseOfferInput({ shipmentId, carrierId }));
      await shipmentRepo.updateStatus(shipmentId, ShipmentStatus.CANCELLED, null);

      const response = await app.inject({
        method: "GET",
        url: "/offers/mine",
        headers: { "x-user-id": carrierId },
      });

      const item = response.json().items[0];
      expect(item.status).toBe(OfferStatus.PENDING);
      expect(item.shipment.status).toBe(ShipmentStatus.CANCELLED);
      expect(item.competitiveRank).toBeNull();
    });

    it("AC5: resuelve el ranking de varios envíos en una sola query batch, sin N+1", async () => {
      const carrierId = randomUUID();
      for (let i = 0; i < 3; i++) {
        const shipmentId = await createPublishedShipment();
        await offerRepo.create(baseOfferInput({ shipmentId, carrierId }));
        // Otro competidor en el mismo envío -- si no hubiera nadie más, no habría
        // nada nuevo que ir a buscar en la query batch para ese shipmentId.
        await offerRepo.create(baseOfferInput({ shipmentId, carrierId: randomUUID() }));
      }

      const findManySpy = vi.spyOn(app.db.offer, "findMany");
      const response = await app.inject({
        method: "GET",
        url: "/offers/mine?limit=10",
        headers: { "x-user-id": carrierId },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().items).toHaveLength(3);
      // Una query para listByCarrier (los ítems) + una para el batch de
      // competitiveRank -- nunca una por shipmentId (serían 4 con N+1 acá).
      expect(findManySpy).toHaveBeenCalledTimes(2);
      findManySpy.mockRestore();
    });

    describe("fix de review (PR #142): desempate a igual priceOffered", () => {
      it("gana quien tiene mejor reputación asCarrier", async () => {
        const shipmentId = await createPublishedShipment();
        const carrierBetterRated = randomUUID();
        const carrierWorseRated = randomUUID();
        await offerRepo.create(baseOfferInput({ shipmentId, carrierId: carrierBetterRated, priceOffered: 5000 }));
        await offerRepo.create(baseOfferInput({ shipmentId, carrierId: carrierWorseRated, priceOffered: 5000 }));

        // Envío de contexto solo para satisfacer la FK de `Rating.shipmentId` -- no
        // importa que estos carriers no hayan participado de verdad, es un fixture.
        const ratingContextShipment = await createPublishedShipment();
        await app.db.rating.create({
          data: { shipmentId: ratingContextShipment, raterId: randomUUID(), rateeId: carrierBetterRated, role: "carrier", score: 5 },
        });
        await app.db.rating.create({
          data: { shipmentId: ratingContextShipment, raterId: randomUUID(), rateeId: carrierWorseRated, role: "carrier", score: 1 },
        });

        const [betterRes, worseRes] = await Promise.all([
          app.inject({ method: "GET", url: "/offers/mine", headers: { "x-user-id": carrierBetterRated } }),
          app.inject({ method: "GET", url: "/offers/mine", headers: { "x-user-id": carrierWorseRated } }),
        ]);

        expect(betterRes.json().items[0].competitiveRank.rank).toBe(1);
        expect(worseRes.json().items[0].competitiveRank.rank).toBe(2);
      });

      it("a igual reputación (sin calificaciones), gana quien entregó más envíos como transportista", async () => {
        const shipmentId = await createPublishedShipment();
        const carrierWithHistory = randomUUID();
        const carrierWithoutHistory = randomUUID();
        await offerRepo.create(baseOfferInput({ shipmentId, carrierId: carrierWithHistory, priceOffered: 5000 }));
        await offerRepo.create(baseOfferInput({ shipmentId, carrierId: carrierWithoutHistory, priceOffered: 5000 }));

        const deliveredShipment = await createPublishedShipment();
        await app.db.shipment.update({
          where: { id: deliveredShipment },
          data: { status: ShipmentStatus.DELIVERED, carrierId: carrierWithHistory },
        });

        const [withHistoryRes, withoutHistoryRes] = await Promise.all([
          app.inject({ method: "GET", url: "/offers/mine", headers: { "x-user-id": carrierWithHistory } }),
          app.inject({ method: "GET", url: "/offers/mine", headers: { "x-user-id": carrierWithoutHistory } }),
        ]);

        expect(withHistoryRes.json().items[0].competitiveRank.rank).toBe(1);
        expect(withoutHistoryRes.json().items[0].competitiveRank.rank).toBe(2);
      });

      it("a igual reputación y envíos entregados, gana la oferta más antigua (piso determinístico, ya no depende del orden de Postgres)", async () => {
        const shipmentId = await createPublishedShipment();
        const earlierCarrier = randomUUID();
        const laterCarrier = randomUUID();
        await offerRepo.create(baseOfferInput({ shipmentId, carrierId: earlierCarrier, priceOffered: 5000 }));
        await new Promise((resolve) => setTimeout(resolve, 5));
        await offerRepo.create(baseOfferInput({ shipmentId, carrierId: laterCarrier, priceOffered: 5000 }));

        const [earlierRes, laterRes] = await Promise.all([
          app.inject({ method: "GET", url: "/offers/mine", headers: { "x-user-id": earlierCarrier } }),
          app.inject({ method: "GET", url: "/offers/mine", headers: { "x-user-id": laterCarrier } }),
        ]);

        expect(earlierRes.json().items[0].competitiveRank.rank).toBe(1);
        expect(laterRes.json().items[0].competitiveRank.rank).toBe(2);
      });
    });
  });
});
