import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createTripRepository, TripRepository } from "../src/repositories/trip-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { CreateTripInput } from "../src/models/trip";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";
import { createFakePricingLogisticsClient } from "./fake-pricing-logistics-client";
import { NotificationsClient } from "../src/adapters/notifications-client";
import { PricingLogisticsClient } from "../src/adapters/pricing-logistics-client";

describe("POST /shipments/:id/accept y POST /shipments/:id/reject (Postgres)", () => {
  let app: FastifyInstance;
  let repo: ShipmentRepository;
  let tripRepo: TripRepository;
  let notificationsClient: NotificationsClient;
  let pricingLogisticsClient: PricingLogisticsClient;
  const senderId = randomUUID();
  const receiverId = randomUUID();

  const baseInput: CreateShipmentInput = {
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
    pickupDate: new Date("2030-01-01T00:00:00.000Z"),
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 4500,
  };

  async function addTwoCreationPhotos(shipmentId: string): Promise<void> {
    await repo.addPhoto(shipmentId, PhotoStage.creation, `shipments/${shipmentId}/creation/${randomUUID()}.jpg`);
    await repo.addPhoto(shipmentId, PhotoStage.creation, `shipments/${shipmentId}/creation/${randomUUID()}.jpg`);
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    notificationsClient = createFakeNotificationsClient();
    // MOVO-179 (decisión de equipo, Peter): sin esto, `dispatchTripMatchPushes`
    // llamaría al `svc-pricing-logistics` REAL (no levantado en este entorno de test)
    // y cada evaluación de viabilidad fallaría por conexión, degradando siempre a "no
    // notifica" -- el fake resuelve `feasible: true` por default para no correr el
    // matching inverso a ciegas.
    pricingLogisticsClient = createFakePricingLogisticsClient();
    app = buildApp({
      usersClient: createFakeUsersClient({
        [receiverId]: fakePublicProfile({ id: receiverId, fullName: "Lucía" }),
      }),
      notificationsClient,
      pricingLogisticsClient,
      sweepEnabled: false,
    });
    await app.ready();
    repo = createShipmentRepository(app.db);
    tripRepo = createTripRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
    // shipments.trips no tiene FK hacia shipments.shipments (ADR-003, sin FK real entre
    // entidades de distinto dueño) -- el TRUNCATE de arriba no lo alcanza, así que se
    // trunca aparte para los tests de MOVO-179 (matching envío->viaje) más abajo.
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.trips RESTART IDENTITY CASCADE");
  });

  /** Trip cuyo corredor coincide EXACTO con el retiro/entrega de `baseInput` -- corredor
   * trivialmente dentro del radio de desvío default, sin depender de la geometría del
   * corredor en sí (ya cubierta por trip-repository.integration.test.ts). */
  function baseTripInput(overrides: Partial<CreateTripInput> = {}): CreateTripInput {
    return {
      carrierId: randomUUID(),
      originAddress: "Av. Colón 1234, Córdoba",
      originLat: baseInput.pickupLat,
      originLng: baseInput.pickupLng,
      destinationAddress: "Bv. San Juan 500, Córdoba",
      destinationLat: baseInput.deliveryLat,
      destinationLng: baseInput.deliveryLng,
      departureAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      vehicleType: "auto",
      ...overrides,
    };
  }

  /**
   * MOVO-221 (merge posterior a MOVO-179): `tripRepo.create()` ahora nace `declared`,
   * no `active` -- `findActiveTripsMatchingShipment` solo mira `active` (AC1), así que
   * cada trip de este describe necesita pasar por `start()` explícito para seguir
   * probando lo que dice probar, en vez de no-matchear por casualidad de status.
   */
  async function createActiveTrip(overrides: Partial<CreateTripInput> = {}) {
    const trip = await tripRepo.create(baseTripInput(overrides));
    return tripRepo.start(trip.id);
  }

  describe("POST /shipments/:id/accept", () => {
    it("el receptor puede aceptar el envío (transiciona a published)", async () => {
      const shipment = await repo.create(baseInput);
      await addTwoCreationPhotos(shipment.id);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/accept`,
        headers: { "x-user-id": receiverId },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.id).toBe(shipment.id);
      expect(data.status).toBe(ShipmentStatus.PUBLISHED);

      const updated = await repo.findById(shipment.id);
      expect(updated?.status).toBe(ShipmentStatus.PUBLISHED);

      const events = await repo.listEvents(shipment.id);
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        shipmentId: shipment.id,
        fromStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
        toStatus: ShipmentStatus.PUBLISHED,
        actorId: receiverId,
      });

      await vi.waitFor(() => {
        expect(notificationsClient.sendPush).toHaveBeenCalledWith({
          userId: senderId,
          title: "Envío aceptado",
          body: "Lucía aceptó el envío, ya está publicado",
          data: { shipmentId: shipment.id, type: "shipment_accepted" },
        });
      });
    });

    it.each([
      ["con payload {}", {} as unknown],
      ["sin body", undefined],
    ])("el receptor puede aceptar con header Content-Type application/json %s", async (_caso, payload) => {
      const shipment = await repo.create(baseInput);
      await addTwoCreationPhotos(shipment.id);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/accept`,
        headers: { "x-user-id": receiverId, "content-type": "application/json" },
        ...(payload === undefined ? {} : { payload }),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe(ShipmentStatus.PUBLISHED);
    });

    it("ignora los campos que el receptor mande en el body al aceptar (no puede editar el envío)", async () => {
      const shipment = await repo.create(baseInput);
      await addTwoCreationPhotos(shipment.id);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/accept`,
        headers: { "x-user-id": receiverId },
        payload: { weightKg: 10, deliveryAddress: "Otra dirección 999" },
      });

      // 200 y no 400: Fastify trae `removeAdditional: true` como default de AJV, así que
      // `additionalProperties: false` descarta los campos de más en vez de rechazar el
      // request. Lo que importa para el AC es que no lleguen al envío persistido.
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe(ShipmentStatus.PUBLISHED);

      const persisted = await repo.findById(shipment.id);
      expect(persisted?.weightKg).toBe(baseInput.weightKg);
      expect(persisted?.deliveryAddress).toBe(baseInput.deliveryAddress);
    });

    it("falla con 400 si el body no es JSON válido", async () => {
      const shipment = await repo.create(baseInput);
      await addTwoCreationPhotos(shipment.id);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/accept`,
        headers: { "x-user-id": receiverId, "content-type": "application/json" },
        payload: "{roto",
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_FAILED");
    });

    it("falla con 409 si faltan fotos de creación requeridas", async () => {
      const shipment = await repo.create(baseInput);
      // Sin fotos cargadas

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/accept`,
        headers: { "x-user-id": receiverId },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_INSUFFICIENT_CREATION_PHOTOS");
    });

    it("falla con 409 si el envío ya fue aceptado (doble tap)", async () => {
      const shipment = await repo.create(baseInput);
      await addTwoCreationPhotos(shipment.id);
      await repo.updateStatus(shipment.id, ShipmentStatus.PUBLISHED, receiverId);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/accept`,
        headers: { "x-user-id": receiverId },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_INVALID_TRANSITION");
    });

    it("el emisor recibe 403 al intentar aceptar", async () => {
      const shipment = await repo.create(baseInput);
      await addTwoCreationPhotos(shipment.id);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/accept`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
    });

    it("un admin recibe 403 al intentar aceptar", async () => {
      const shipment = await repo.create(baseInput);
      await addTwoCreationPhotos(shipment.id);
      const adminId = randomUUID();

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/accept`,
        headers: { "x-user-id": adminId, "x-user-roles": "admin" },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
    });

    it("un tercero recibe 403 al intentar aceptar", async () => {
      const shipment = await repo.create(baseInput);
      await addTwoCreationPhotos(shipment.id);
      const strangerId = randomUUID();

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/accept`,
        headers: { "x-user-id": strangerId },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
    });

    it("responde 404 para un envío inexistente", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/shipments/${randomUUID()}/accept`,
        headers: { "x-user-id": receiverId },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("NOT_FOUND");
    });

    it("falla con 409 si la deadline de confirmación del receptor ya expiró (MOVO-130 AC5)", async () => {
      const pastDeadline = new Date(Date.now() - 60_000);
      const shipment = await repo.create({
        ...baseInput,
        receiverConfirmationDeadline: pastDeadline,
      });
      await addTwoCreationPhotos(shipment.id);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/accept`,
        headers: { "x-user-id": receiverId },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_RECEIVER_CONFIRMATION_EXPIRED");
    });

    it("responde 401 sin x-user-id", async () => {
      const shipment = await repo.create(baseInput);
      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/accept`,
      });
      expect(response.statusCode).toBe(401);
    });

    // MOVO-179 (DoD): test de integración de punta a punta -- aceptar un envío con un
    // viaje activo compatible ya sembrado dispara exactamente una llamada a
    // notifications-client.ts con el payload esperado.
    describe("MOVO-179: push de envío compatible con viaje activo (trip_match)", () => {
      it("dispara exactamente una push trip_match al transportista con un viaje active compatible", async () => {
        const shipment = await repo.create(baseInput);
        await addTwoCreationPhotos(shipment.id);
        const trip = await createActiveTrip();

        const response = await app.inject({
          method: "POST",
          url: `/shipments/${shipment.id}/accept`,
          headers: { "x-user-id": receiverId },
        });

        expect(response.statusCode).toBe(200);
        await vi.waitFor(() => {
          const tripMatchCalls = (notificationsClient.sendPush as ReturnType<typeof vi.fn>).mock.calls.filter(
            ([input]) => input.data?.type === "trip_match"
          );
          expect(tripMatchCalls).toHaveLength(1);
        });
        expect(notificationsClient.sendPush).toHaveBeenCalledWith({
          userId: trip.carrierId,
          title: "Nuevo paquete compatible",
          body: expect.stringContaining("Hay un envío compatible con tu viaje"),
          data: { type: "trip_match", tripId: trip.id, shipmentId: shipment.id },
        });
      });

      it("no dispara ninguna push trip_match si ningún viaje active matchea", async () => {
        const shipment = await repo.create(baseInput);
        await addTwoCreationPhotos(shipment.id);
        // Viaje MUY lejos del retiro/entrega del envío -- fuera de cualquier radio de
        // desvío razonable.
        await createActiveTrip({
          originLat: baseInput.pickupLat - 5,
          originLng: baseInput.pickupLng - 5,
          destinationLat: baseInput.deliveryLat - 5,
          destinationLng: baseInput.deliveryLng - 5,
        });

        const response = await app.inject({
          method: "POST",
          url: `/shipments/${shipment.id}/accept`,
          headers: { "x-user-id": receiverId },
        });

        expect(response.statusCode).toBe(200);
        // Deja pasar el best-effort fire-and-forget antes de aserir la ausencia.
        await new Promise((resolve) => setTimeout(resolve, 50));
        const tripMatchCalls = (notificationsClient.sendPush as ReturnType<typeof vi.fn>).mock.calls.filter(
          ([input]) => input.data?.type === "trip_match"
        );
        expect(tripMatchCalls).toHaveLength(0);
      });

      it("no dispara push si el viaje matchea geométricamente pero pricing-logistics lo marca no viable (decisión de equipo, Peter)", async () => {
        const shipment = await repo.create(baseInput);
        await addTwoCreationPhotos(shipment.id);
        await createActiveTrip();
        (pricingLogisticsClient.evaluateCandidates as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
          directDistanceKm: 10,
          directDurationMinutes: 15,
          calculationMethod: "or_tools_v1",
          evaluations: [
            { candidateId: shipment.id, feasible: false, detourDistanceKm: null, detourDurationMinutes: null },
          ],
        });

        const response = await app.inject({
          method: "POST",
          url: `/shipments/${shipment.id}/accept`,
          headers: { "x-user-id": receiverId },
        });

        expect(response.statusCode).toBe(200);
        await vi.waitFor(() => {
          expect(pricingLogisticsClient.evaluateCandidates).toHaveBeenCalledTimes(1);
        });
        const tripMatchCalls = (notificationsClient.sendPush as ReturnType<typeof vi.fn>).mock.calls.filter(
          ([input]) => input.data?.type === "trip_match"
        );
        expect(tripMatchCalls).toHaveLength(0);
      });

      // MOVO-221 (merge posterior a MOVO-179, decisión con el usuario): el escenario
      // original de AC4 -- un mismo transportista con DOS viajes `active` compatibles
      // -- dejó de ser alcanzable vía la API real. `trips_carrier_active_unique` fuerza
      // como máximo un `active` por carrier -- un segundo `start()` para el mismo
      // carrier lanza `TripAlreadyHasActiveTripError`, ya cubierto en
      // `trip-lifecycle.integration.test.ts` ("start() lanza TripAlreadyHasActiveTripError
      // si el transportista ya tiene otro viaje active"), no duplicado acá. El dedup por
      // `carrierId` de `dispatchTripMatchPushes` en sí sigue cubierto a nivel unitario
      // contra un `tripRepository` mockeado (`shipment-service.test.ts`, "AC4, dedup por
      // carrierId"), que no depende de este constraint real.
    });
  });

  describe("POST /shipments/:id/reject", () => {
    it("el receptor puede rechazar el envío con motivo (transiciona a rejected_by_receiver)", async () => {
      const shipment = await repo.create(baseInput);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/reject`,
        headers: { "x-user-id": receiverId },
        payload: { reason: "No estoy en la ciudad" },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.id).toBe(shipment.id);
      expect(data.status).toBe(ShipmentStatus.REJECTED_BY_RECEIVER);

      const updated = await repo.findById(shipment.id);
      expect(updated?.status).toBe(ShipmentStatus.REJECTED_BY_RECEIVER);

      const events = await repo.listEvents(shipment.id);
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        shipmentId: shipment.id,
        fromStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
        toStatus: ShipmentStatus.REJECTED_BY_RECEIVER,
        actorId: receiverId,
        reason: "No estoy en la ciudad",
      });

      await vi.waitFor(() => {
        expect(notificationsClient.sendPush).toHaveBeenCalledWith({
          userId: senderId,
          title: "Envío rechazado",
          body: "Lucía rechazó el envío",
          data: { shipmentId: shipment.id, type: "shipment_rejected" },
        });
      });
    });

    it("el receptor puede rechazar el envío sin motivo", async () => {
      const shipment = await repo.create(baseInput);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/reject`,
        headers: { "x-user-id": receiverId },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe(ShipmentStatus.REJECTED_BY_RECEIVER);
    });

    it("el emisor recibe 403 al intentar rechazar", async () => {
      const shipment = await repo.create(baseInput);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/reject`,
        headers: { "x-user-id": senderId },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
    });

    it("un admin recibe 403 al intentar rechazar", async () => {
      const shipment = await repo.create(baseInput);
      const adminId = randomUUID();

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/reject`,
        headers: { "x-user-id": adminId, "x-user-roles": "admin" },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
    });

    it("un tercero recibe 403 al intentar rechazar", async () => {
      const shipment = await repo.create(baseInput);
      const strangerId = randomUUID();

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/reject`,
        headers: { "x-user-id": strangerId },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
    });

    it("responde 404 para un envío inexistente", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/shipments/${randomUUID()}/reject`,
        headers: { "x-user-id": receiverId },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("NOT_FOUND");
    });

    it("falla con 409 si el envío ya fue cancelado o rechazado", async () => {
      const shipment = await repo.create(baseInput);
      await repo.updateStatus(shipment.id, ShipmentStatus.CANCELLED, senderId);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/reject`,
        headers: { "x-user-id": receiverId },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_INVALID_TRANSITION");
    });

    it("falla con 409 si la deadline de confirmación del receptor ya expiró (MOVO-130 AC5)", async () => {
      const pastDeadline = new Date(Date.now() - 60_000);
      const shipment = await repo.create({
        ...baseInput,
        receiverConfirmationDeadline: pastDeadline,
      });

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/reject`,
        headers: { "x-user-id": receiverId },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_RECEIVER_CONFIRMATION_EXPIRED");
    });

    it("responde 401 sin x-user-id", async () => {
      const shipment = await repo.create(baseInput);
      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/reject`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("responde 400 si el motivo excede 500 caracteres", async () => {
      const shipment = await repo.create(baseInput);
      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/reject`,
        headers: { "x-user-id": receiverId },
        payload: { reason: "a".repeat(501) },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_FAILED");
    });
  });
});
