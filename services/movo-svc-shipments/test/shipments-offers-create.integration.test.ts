import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus, TripStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { createTripRepository, TripRepository } from "../src/repositories/trip-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { CreateTripInput } from "../src/models/trip";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";
import { NotificationsClient } from "../src/adapters/notifications-client";

const PICKUP_DATE = new Date("2030-01-01T00:00:00.000Z");
const PICKUP_DATE_STR = "2030-01-01";

describe("POST /shipments/:id/offers (Postgres, MOVO-143)", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let offerRepo: OfferRepository;
  let tripRepo: TripRepository;
  let notificationsClient: NotificationsClient;

  const senderId = randomUUID();
  const receiverId = randomUUID();
  const verifiedCarrierId = randomUUID();
  const unverifiedCarrierId = randomUUID();

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

  async function createPublishedShipment(overrides: Partial<CreateShipmentInput> = {}) {
    const created = await shipmentRepo.create(baseShipmentInput(overrides));
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    return shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, created.senderId);
  }

  async function requestCreateOffer(
    shipmentId: string,
    userId: string,
    body: Record<string, unknown> = {},
    headers: Record<string, string> = {}
  ) {
    return app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/offers`,
      headers: { "x-user-id": userId, "x-user-roles": "carrier", ...headers },
      payload: {
        priceOfferedArs: 5000,
        offeredDate: PICKUP_DATE_STR,
        ...body,
      },
    });
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    process.env.MOVO_COMMISSION_RATE = "0.15";

    notificationsClient = createFakeNotificationsClient();
    app = buildApp({
      usersClient: createFakeUsersClient({
        [verifiedCarrierId]: fakePublicProfile({ id: verifiedCarrierId, fullName: "Juan Transportista", isVerified: true }),
        [unverifiedCarrierId]: fakePublicProfile({ id: unverifiedCarrierId, isVerified: false }),
        [senderId]: fakePublicProfile({ id: senderId, isVerified: true }),
        [receiverId]: fakePublicProfile({ id: receiverId, isVerified: true }),
      }),
      notificationsClient,
      sweepEnabled: false,
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
    offerRepo = createOfferRepository(app.db);
    tripRepo = createTripRepository(app.db);
  });

  function baseTripInput(overrides: Partial<CreateTripInput> = {}): CreateTripInput {
    return {
      carrierId: verifiedCarrierId,
      originAddress: "Av. Colón 1234, Córdoba",
      originLat: -31.4201,
      originLng: -64.1888,
      destinationAddress: "Av. San Martín 100, Villa María",
      destinationLat: -32.4104,
      destinationLng: -63.2404,
      departureAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      vehicleType: "auto",
      ...overrides,
    };
  }

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // CASCADE también vacía shipments.offers (FK a shipments.shipments). shipments.trips
    // no tiene FK hacia shipments, se trunca aparte (MOVO-162: tests de tripId).
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.trips RESTART IDENTITY CASCADE");
  });

  it("AC1/AC6/AC9: crea la oferta con el bruto calculado, desglosa neto/comisión/bruto y notifica al emisor", async () => {
    const shipment = await createPublishedShipment();

    const response = await requestCreateOffer(shipment.id, verifiedCarrierId, { priceOfferedArs: 5000 });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.priceNetArs).toBe(5000);
    expect(body.commissionAmountArs).toBe(750); // 5000 * 0.15
    expect(body.priceOffered).toBe(5750); // bruto persistido
    expect(body.status).toBe("pending");
    expect(body.carrierNameAtOffer).toBe("Juan Transportista");

    const persisted = await offerRepo.findById(body.id);
    expect(persisted?.priceOffered).toBe(5750);

    await vi.waitFor(() => {
      expect(notificationsClient.sendPush).toHaveBeenCalledWith(
        expect.objectContaining({ userId: shipment.senderId, data: expect.objectContaining({ type: "offer_created" }) })
      );
    });
  });

  it("AC2: 403 CARRIER_NOT_VERIFIED sin rol carrier en el header", async () => {
    const shipment = await createPublishedShipment();
    const response = await requestCreateOffer(shipment.id, verifiedCarrierId, {}, { "x-user-roles": "sender" });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("CARRIER_NOT_VERIFIED");
  });

  it("AC2: 403 CARRIER_NOT_VERIFIED sin KYC de identidad aprobado", async () => {
    const shipment = await createPublishedShipment();
    const response = await requestCreateOffer(shipment.id, unverifiedCarrierId);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("CARRIER_NOT_VERIFIED");
  });

  it("AC1: 409 SHIPMENT_NOT_AVAILABLE_FOR_OFFER sobre un envío que no está published", async () => {
    const created = await shipmentRepo.create(baseShipmentInput());
    const response = await requestCreateOffer(created.id, verifiedCarrierId);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SHIPMENT_NOT_AVAILABLE_FOR_OFFER");
  });

  it("AC3: 403 AUTH_FORBIDDEN si el emisor intenta ofertar sobre su propio envío", async () => {
    const shipment = await createPublishedShipment();
    const response = await requestCreateOffer(shipment.id, senderId);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
  });

  it("AC3: 403 AUTH_FORBIDDEN si el receptor intenta ofertar sobre el mismo envío", async () => {
    const shipment = await createPublishedShipment();
    const response = await requestCreateOffer(shipment.id, receiverId);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
  });

  it("AC4: 409 OFFER_DUPLICATE_ACTIVE si el transportista ya tiene una oferta activa sobre el mismo envío", async () => {
    const shipment = await createPublishedShipment();
    const first = await requestCreateOffer(shipment.id, verifiedCarrierId);
    expect(first.statusCode).toBe(201);

    const second = await requestCreateOffer(shipment.id, verifiedCarrierId);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("OFFER_DUPLICATE_ACTIVE");
  });

  it("AC4: reofertar tras un rechazo es válido (fila nueva)", async () => {
    const shipment = await createPublishedShipment();
    const first = await requestCreateOffer(shipment.id, verifiedCarrierId);
    await offerRepo.reject(first.json().id);

    const second = await requestCreateOffer(shipment.id, verifiedCarrierId);
    expect(second.statusCode).toBe(201);
    expect(second.json().id).not.toBe(first.json().id);
  });

  it("AC5: 422 OFFER_DATE_OUT_OF_RANGE si offeredDate es anterior a la fecha de retiro del envío", async () => {
    const shipment = await createPublishedShipment();
    const response = await requestCreateOffer(shipment.id, verifiedCarrierId, { offeredDate: "2029-12-31" });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("OFFER_DATE_OUT_OF_RANGE");
  });

  it("422 OFFER_DATE_OUT_OF_RANGE si offeredDate supera el máximo de 3 días después del retiro (MOVO-177)", async () => {
    const shipment = await createPublishedShipment();
    const response = await requestCreateOffer(shipment.id, verifiedCarrierId, { offeredDate: "2030-01-05" });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("OFFER_DATE_OUT_OF_RANGE");
  });

  it("MOVO-177: 201 con offeredDate hasta 3 días después del retiro y franja horaria propuesta", async () => {
    const shipment = await createPublishedShipment();
    const response = await requestCreateOffer(shipment.id, verifiedCarrierId, {
      offeredDate: "2030-01-03",
      offeredPickupTimeWindowStart: "15:00",
      offeredPickupTimeWindowEnd: "19:00",
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().offeredPickupTimeWindowStart).toBe("15:00");
    expect(response.json().offeredPickupTimeWindowEnd).toBe("19:00");
  });

  it("422 VALIDATION_FAILED si solo se manda un extremo de la franja horaria propuesta", async () => {
    const shipment = await createPublishedShipment();
    const response = await requestCreateOffer(shipment.id, verifiedCarrierId, {
      offeredDate: "2030-01-02",
      offeredPickupTimeWindowStart: "15:00",
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("422 OFFER_PICKUP_WINDOW_INVALID si la franja horaria propuesta termina antes de empezar", async () => {
    const shipment = await createPublishedShipment();
    const response = await requestCreateOffer(shipment.id, verifiedCarrierId, {
      offeredDate: "2030-01-02",
      offeredPickupTimeWindowStart: "19:00",
      offeredPickupTimeWindowEnd: "15:00",
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("OFFER_PICKUP_WINDOW_INVALID");
  });

  it("AC7: carrierRatingAtOffer queda null si el transportista todavía no tiene calificaciones", async () => {
    const shipment = await createPublishedShipment();
    const response = await requestCreateOffer(shipment.id, verifiedCarrierId);
    expect(response.statusCode).toBe(201);
    expect(response.json().carrierRatingAtOffer).toBeNull();
  });

  it("400 VALIDATION_FAILED con precio ofertado <= 0", async () => {
    const shipment = await createPublishedShipment();
    const response = await requestCreateOffer(shipment.id, verifiedCarrierId, { priceOfferedArs: 0 });
    expect(response.statusCode).toBe(400);
  });

  it("404 NOT_FOUND sobre un envío inexistente", async () => {
    const response = await requestCreateOffer(randomUUID(), verifiedCarrierId);
    expect(response.statusCode).toBe(404);
  });

  describe("MOVO-162: tripId opcional", () => {
    it("crea la oferta con el tripId de un viaje propio y activo", async () => {
      const shipment = await createPublishedShipment();
      const trip = await tripRepo.create(baseTripInput());

      const response = await requestCreateOffer(shipment.id, verifiedCarrierId, { tripId: trip.id });

      expect(response.statusCode).toBe(201);
      expect(response.json().tripId).toBe(trip.id);
      const persisted = await offerRepo.findById(response.json().id);
      expect(persisted?.tripId).toBe(trip.id);
    });

    it("sin tripId, la oferta queda con tripId null (caso general, sin regresión)", async () => {
      const shipment = await createPublishedShipment();
      const response = await requestCreateOffer(shipment.id, verifiedCarrierId);
      expect(response.statusCode).toBe(201);
      expect(response.json().tripId).toBeNull();
    });

    it("404 TRIP_NOT_FOUND si el tripId no existe", async () => {
      const shipment = await createPublishedShipment();
      const response = await requestCreateOffer(shipment.id, verifiedCarrierId, { tripId: randomUUID() });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("TRIP_NOT_FOUND");
    });

    it("403 AUTH_FORBIDDEN si el tripId es de otro transportista", async () => {
      const shipment = await createPublishedShipment();
      const otherCarrierId = randomUUID();
      const trip = await tripRepo.create(baseTripInput({ carrierId: otherCarrierId }));

      const response = await requestCreateOffer(shipment.id, verifiedCarrierId, { tripId: trip.id });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
    });

    it("409 TRIP_NOT_ACTIVE si el viaje ya está cancelado", async () => {
      const shipment = await createPublishedShipment();
      const trip = await tripRepo.create(baseTripInput());
      await tripRepo.update(trip.id, { status: TripStatus.CANCELLED });

      const response = await requestCreateOffer(shipment.id, verifiedCarrierId, { tripId: trip.id });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("TRIP_NOT_ACTIVE");
    });

    it("no persiste nada si la validación de tripId falla (rollback completo)", async () => {
      const shipment = await createPublishedShipment();
      const response = await requestCreateOffer(shipment.id, verifiedCarrierId, { tripId: randomUUID() });
      expect(response.statusCode).toBe(404);
      expect(await offerRepo.listByShipment(shipment.id)).toHaveLength(0);
    });
  });
});
