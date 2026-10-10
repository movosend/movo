import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ApiError, KycStatus, OfferStatus, ShipmentStatus, TripStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { createTripRepository, TripRepository } from "../src/repositories/trip-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { attachAcceptedPackage } from "./trip-package-fixture";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";
import { createFakePaymentsClient } from "./fake-payments-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";
import { createFakePricingClient } from "./fake-pricing-client";
import { createFakePricingLogisticsClient } from "./fake-pricing-logistics-client";

const PICKUP_DATE = new Date("2030-01-01T00:00:00.000Z");
const PICKUP_DATE_STR = "2030-01-01";

/**
 * MOVO-116 (ADR-036): bloqueo de operar como transportista sin licencia aprobada o sin
 * cuenta de Mercado Pago vinculada, de punta a punta por HTTP contra Postgres/Redis
 * reales. Cubre el criterio 7 (sin licencia / sin MP / sin ambos / con los dos) en
 * declarar viaje y ofertar, verificando que un rechazo no deja filas, más editar oferta,
 * iniciar viaje y aceptar oferta.
 */
describe("Requisitos habilitantes del transportista (Postgres, MOVO-116)", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let offerRepo: OfferRepository;
  let tripRepo: TripRepository;

  const senderId = randomUUID();
  const receiverId = randomUUID();
  const eligibleCarrier = randomUUID();
  const carrierWithoutLicense = randomUUID();
  const carrierWithoutMp = randomUUID();
  const carrierWithoutBoth = randomUUID();
  const carrierWithoutIdentity = randomUUID();

  const profiles = Object.fromEntries(
    [senderId, receiverId, eligibleCarrier, carrierWithoutLicense, carrierWithoutMp, carrierWithoutBoth].map((id) => [
      id,
      fakePublicProfile({ id, isVerified: true }),
    ]),
  );
  profiles[carrierWithoutIdentity] = fakePublicProfile({ id: carrierWithoutIdentity, isVerified: false });

  const kycStatuses = {
    [carrierWithoutLicense]: { kycStatusLicense: KycStatus.PENDING },
    [carrierWithoutBoth]: { kycStatusLicense: KycStatus.NOT_STARTED },
  };
  const unlinkedMpCarriers = [carrierWithoutMp, carrierWithoutBoth];

  function shipmentInput(overrides: Partial<CreateShipmentInput> = {}): CreateShipmentInput {
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
      pickupDate: PICKUP_DATE,
      pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      suggestedPriceArs: 4500,
      ...overrides,
    };
  }

  async function createPublishedShipment(repo: ShipmentRepository = shipmentRepo) {
    const created = await repo.create(shipmentInput());
    await repo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await repo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    return repo.updateStatus(created.id, ShipmentStatus.PUBLISHED, created.senderId);
  }

  function declareTrip(target: FastifyInstance, carrierId: string) {
    return target.inject({
      method: "POST",
      url: "/trips",
      headers: { "x-user-id": carrierId, "x-user-roles": "carrier" },
      payload: {
        originAddress: "Av. Colón 1234, Córdoba",
        originLat: -31.4201,
        originLng: -64.1888,
        destinationAddress: "Av. San Martín 100, Villa María",
        destinationLat: -32.4104,
        destinationLng: -63.2404,
        departureAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        vehicleType: "auto",
      },
    });
  }

  function createOffer(target: FastifyInstance, shipmentId: string, carrierId: string) {
    return target.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": carrierId, "x-user-roles": "carrier" },
      payload: { priceOfferedArs: 5000, offeredDate: PICKUP_DATE_STR },
    });
  }

  async function countTrips(carrierId: string) {
    return app.db.trip.count({ where: { carrierId } });
  }

  async function countOffers(carrierId: string) {
    return app.db.offer.count({ where: { carrierId } });
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    process.env.MOVO_COMMISSION_RATE = "0.15";
    app = buildApp({
      usersClient: createFakeUsersClient(profiles, {}, [], kycStatuses),
      paymentsClient: createFakePaymentsClient(unlinkedMpCarriers),
      notificationsClient: createFakeNotificationsClient(),
      pricingClient: createFakePricingClient(),
      pricingLogisticsClient: createFakePricingLogisticsClient(),
      sweepEnabled: false,
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
    offerRepo = createOfferRepository(app.db);
    tripRepo = createTripRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.trips RESTART IDENTITY CASCADE");
  });

  describe("POST /trips (criterio 7)", () => {
    it("sin licencia aprobada: 403 CARRIER_LICENSE_NOT_APPROVED y ningún viaje creado", async () => {
      const response = await declareTrip(app, carrierWithoutLicense);

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toMatchObject({
        code: "CARRIER_LICENSE_NOT_APPROVED",
        details: { missingRequirements: ["license"] },
      });
      expect(await countTrips(carrierWithoutLicense)).toBe(0);
    });

    it("sin cuenta de MP: 403 CARRIER_MP_ACCOUNT_NOT_LINKED y ningún viaje creado", async () => {
      const response = await declareTrip(app, carrierWithoutMp);

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toMatchObject({
        code: "CARRIER_MP_ACCOUNT_NOT_LINKED",
        details: { missingRequirements: ["mp_account"] },
      });
      expect(await countTrips(carrierWithoutMp)).toBe(0);
    });

    it("sin ninguno: code de la licencia, los dos en details y ningún viaje creado", async () => {
      const response = await declareTrip(app, carrierWithoutBoth);

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toMatchObject({
        code: "CARRIER_LICENSE_NOT_APPROVED",
        details: { missingRequirements: ["license", "mp_account"] },
      });
      expect(await countTrips(carrierWithoutBoth)).toBe(0);
    });

    it("sin identidad verificada: 403 CARRIER_NOT_VERIFIED, sin details", async () => {
      const response = await declareTrip(app, carrierWithoutIdentity);

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("CARRIER_NOT_VERIFIED");
      expect(response.json().error.details).toBeUndefined();
    });

    it("con los dos requisitos: 201", async () => {
      const response = await declareTrip(app, eligibleCarrier);

      expect(response.statusCode).toBe(201);
      expect(await countTrips(eligibleCarrier)).toBe(1);
    });
  });

  describe("POST /shipments/:id/offers (criterio 7)", () => {
    it("sin licencia aprobada: 403 CARRIER_LICENSE_NOT_APPROVED y ninguna oferta creada", async () => {
      const shipment = await createPublishedShipment();

      const response = await createOffer(app, shipment.id, carrierWithoutLicense);

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toMatchObject({
        code: "CARRIER_LICENSE_NOT_APPROVED",
        details: { missingRequirements: ["license"] },
      });
      expect(await countOffers(carrierWithoutLicense)).toBe(0);
    });

    it("sin cuenta de MP: 403 CARRIER_MP_ACCOUNT_NOT_LINKED y ninguna oferta creada", async () => {
      const shipment = await createPublishedShipment();

      const response = await createOffer(app, shipment.id, carrierWithoutMp);

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toMatchObject({
        code: "CARRIER_MP_ACCOUNT_NOT_LINKED",
        details: { missingRequirements: ["mp_account"] },
      });
      expect(await countOffers(carrierWithoutMp)).toBe(0);
    });

    it("sin ninguno: code de la licencia, los dos en details y ninguna oferta creada", async () => {
      const shipment = await createPublishedShipment();

      const response = await createOffer(app, shipment.id, carrierWithoutBoth);

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toMatchObject({
        code: "CARRIER_LICENSE_NOT_APPROVED",
        details: { missingRequirements: ["license", "mp_account"] },
      });
      expect(await countOffers(carrierWithoutBoth)).toBe(0);
    });

    it("con los dos requisitos: 201", async () => {
      const shipment = await createPublishedShipment();

      const response = await createOffer(app, shipment.id, eligibleCarrier);

      expect(response.statusCode).toBe(201);
      expect(await countOffers(eligibleCarrier)).toBe(1);
    });
  });

  describe("PATCH /offers/:id", () => {
    it("un transportista que perdió la cuenta de MP no puede editar su oferta pending", async () => {
      const shipment = await createPublishedShipment();
      const offer = await offerRepo.create({
        shipmentId: shipment.id,
        carrierId: carrierWithoutMp,
        priceOffered: 5750,
        offeredDate: PICKUP_DATE,
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/offers/${offer.id}`,
        headers: { "x-user-id": carrierWithoutMp, "x-user-roles": "carrier" },
        payload: { priceOfferedArs: 6000 },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("CARRIER_MP_ACCOUNT_NOT_LINKED");
      expect((await offerRepo.findById(offer.id))?.priceOffered).toBe(5750);
    });
  });

  describe("POST /trips/:id/start", () => {
    it("un viaje declared cuyo dueño no tiene licencia no arranca y sigue declared", async () => {
      const trip = await tripRepo.create({
        carrierId: carrierWithoutLicense,
        originAddress: "Av. Colón 1234, Córdoba",
        originLat: -31.4201,
        originLng: -64.1888,
        destinationAddress: "Av. San Martín 100, Villa María",
        destinationLat: -32.4104,
        destinationLng: -63.2404,
        departureAt: new Date(),
        vehicleType: "auto",
      });
      await attachAcceptedPackage(app.db, trip);

      const response = await app.inject({
        method: "POST",
        url: `/trips/${trip.id}/start`,
        headers: { "x-user-id": carrierWithoutLicense, "x-user-roles": "carrier" },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("CARRIER_LICENSE_NOT_APPROVED");
      expect((await tripRepo.findById(trip.id))?.status).toBe(TripStatus.DECLARED);
    });
  });

  describe("POST /offers/:id/accept", () => {
    it("409 OFFER_CARRIER_NOT_ELIGIBLE si el transportista ya no cumple, sin details, y la oferta sigue pending", async () => {
      const shipment = await createPublishedShipment();
      const offer = await offerRepo.create({
        shipmentId: shipment.id,
        carrierId: carrierWithoutBoth,
        priceOffered: 5750,
        offeredDate: PICKUP_DATE,
      });

      const response = await app.inject({
        method: "POST",
        url: `/offers/${offer.id}/accept`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("OFFER_CARRIER_NOT_ELIGIBLE");
      expect(response.json().error.details).toBeUndefined();
      expect((await offerRepo.findById(offer.id))?.status).toBe(OfferStatus.PENDING);
      expect((await shipmentRepo.findById(shipment.id))?.status).toBe(ShipmentStatus.PUBLISHED);
    });

    it("acepta la oferta de un transportista que cumple", async () => {
      const shipment = await createPublishedShipment();
      const offer = await offerRepo.create({
        shipmentId: shipment.id,
        carrierId: eligibleCarrier,
        priceOffered: 5750,
        offeredDate: PICKUP_DATE,
      });

      const response = await app.inject({
        method: "POST",
        url: `/offers/${offer.id}/accept`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe(OfferStatus.ACCEPTED);
    });
  });

  describe("svc-payments caído (falla cerrado)", () => {
    let failingApp: FastifyInstance;

    beforeAll(async () => {
      failingApp = buildApp({
        usersClient: createFakeUsersClient(profiles),
        paymentsClient: createFakePaymentsClient([], {
          getCarrierMpAccountStatus: async () => {
            throw new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "caído");
          },
        }),
        notificationsClient: createFakeNotificationsClient(),
        pricingClient: createFakePricingClient(),
        pricingLogisticsClient: createFakePricingLogisticsClient(),
        sweepEnabled: false,
      });
      await failingApp.ready();
    });

    afterAll(async () => {
      await failingApp.close();
    });

    it("declarar viaje responde 502 PAYMENTS_SERVICE_UNAVAILABLE y no crea nada", async () => {
      const response = await declareTrip(failingApp, eligibleCarrier);

      expect(response.statusCode).toBe(502);
      expect(response.json().error.code).toBe("PAYMENTS_SERVICE_UNAVAILABLE");
      expect(await countTrips(eligibleCarrier)).toBe(0);
    });

    it("ofertar responde 502 PAYMENTS_SERVICE_UNAVAILABLE y no crea nada", async () => {
      const shipment = await createPublishedShipment(createShipmentRepository(failingApp.db));

      const response = await createOffer(failingApp, shipment.id, eligibleCarrier);

      expect(response.statusCode).toBe(502);
      expect(response.json().error.code).toBe("PAYMENTS_SERVICE_UNAVAILABLE");
      expect(await countOffers(eligibleCarrier)).toBe(0);
    });
  });

  it("Swagger documenta el 502 y el campo details del error en los endpoints bloqueados (criterio 6)", async () => {
    const spec = app.swagger() as {
      paths: Record<string, Record<string, { description?: string; responses: Record<string, unknown> }>>;
    };
    const createOfferOp = spec.paths["/shipments/{id}/offers"].post;
    const declareTripOp = spec.paths["/trips/"]?.post ?? spec.paths["/trips"].post;

    for (const op of [createOfferOp, declareTripOp]) {
      expect(op.responses).toHaveProperty("502");
      expect(op.description).toContain("CARRIER_LICENSE_NOT_APPROVED");
      expect(op.description).toContain("CARRIER_MP_ACCOUNT_NOT_LINKED");
    }
    expect(JSON.stringify(createOfferOp.responses["403"])).toContain("details");
  });
});
