import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError, ShipmentStatus, UserRole } from "@movo/shared";
import { createTripsService } from "../src/modules/trips/trips.service";
import {
  TripRepository,
  TripNotFoundError,
  TripNotDeclaredError,
  TripAlreadyHasActiveTripError,
} from "../src/repositories/trip-repository";
import { ShipmentRepository } from "../src/repositories/shipment-repository";
import { OfferRepository } from "../src/repositories/offer-repository";
import { UsersClient } from "../src/adapters/users-client";
import { PricingLogisticsClient } from "../src/adapters/pricing-logistics-client";
import { Trip, TripStatus } from "../src/models/trip";
import { createFakeOfferRepository } from "./fake-offer-repository";
import { toArgentinaCalendarDate } from "../src/domain/pickup-window";

const CARRIER_ID = "carrier-123";
const OTHER_USER_ID = "other-user-456";
const TRIP_ID = "trip-789";

function fakeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_ID,
    carrierId: CARRIER_ID,
    originAddress: "Córdoba Capital",
    originLat: -31.4201,
    originLng: -64.1888,
    destinationAddress: "Villa María",
    destinationLat: -32.4075,
    destinationLng: -63.2402,
    departureAt: new Date(Date.now() + 86400000), // Mañana
    vehicleType: "auto",
    status: TripStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("TripsService (MOVO-161 / MOVO-219)", () => {
  let tripRepo: TripRepository;
  let shipmentRepo: ShipmentRepository;
  let offerRepo: OfferRepository;
  let usersClient: UsersClient;
  let pricingLogisticsClient: PricingLogisticsClient;

  function buildService(overrides: Partial<Parameters<typeof createTripsService>[0]> = {}) {
    return createTripsService({
      tripRepository: tripRepo,
      shipmentRepository: shipmentRepo,
      offerRepository: offerRepo,
      usersClient,
      pricingLogisticsClient,
      defaultMaxDetourKm: 15,
      ...overrides,
    });
  }

  let trip: Trip;

  beforeEach(() => {
    trip = fakeTrip();
    tripRepo = {
      create: vi.fn().mockImplementation(async (input) => fakeTrip(input)),
      findById: vi.fn().mockImplementation(async (id) => (id === TRIP_ID ? trip : null)),
      countAcceptedOffers: vi.fn().mockResolvedValue(0),
      listByCarrier: vi.fn().mockResolvedValue({ items: [fakeTrip()], total: 1 }),
      update: vi.fn().mockImplementation(async (id, input) => fakeTrip({ id, ...input })),
      delete: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockImplementation(async (id) => fakeTrip({ id, status: TripStatus.ACTIVE })),
    };

    shipmentRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      updateStatus: vi.fn(),
      recordEvent: vi.fn(),
      listEventsByShipment: vi.fn(),
      listExpiredReceiverConfirmations: vi.fn(),
      listMine: vi.fn(),
      listAvailable: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      hasActiveShipmentsForUser: vi.fn(),
      checkActiveDisputesForUser: vi.fn(),
      listActiveShipments: vi.fn().mockResolvedValue([]),
    };

    offerRepo = createFakeOfferRepository();

    usersClient = {
      findPublicProfile: vi.fn().mockResolvedValue({
        id: CARRIER_ID,
        fullName: "Test Carrier",
        profilePhotoUrl: null,
        isVerified: true,
        createdAt: "2026-01-01T00:00:00Z",
      }),
    };

    pricingLogisticsClient = {
      evaluateCandidates: vi.fn().mockImplementation(async (input) => ({
        directDistanceKm: 145,
        directDurationMinutes: 110,
        evaluations: input.candidates.map((c: any) => ({
          candidateId: c.id,
          feasible: true,
          detourDistanceKm: 5,
          detourDurationMinutes: 10,
        })),
        calculationMethod: "haversine_vrptw_v1",
      })),
      optimizeRoute: vi.fn().mockResolvedValue({
        stops: [],
        totalDistanceKm: 0,
        totalDurationMinutes: 0,
        status: "optimal",
        calculationMethod: "or_tools_v1",
        disclaimer: "",
      }),
    };
  });

  describe("createTrip", () => {
    it("falla con 403 CARRIER_NOT_VERIFIED si el usuario no tiene rol CARRIER", async () => {
      const service = buildService();

      await expect(
        service.createTrip({
          callerId: CARRIER_ID,
          callerRoles: [UserRole.SENDER],
          input: {
            originAddress: "Córdoba",
            originLat: -31.42,
            originLng: -64.18,
            destinationAddress: "Villa María",
            destinationLat: -32.4,
            destinationLng: -63.24,
            departureAt: new Date(Date.now() + 100000),
            vehicleType: "auto",
          },
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "CARRIER_NOT_VERIFIED",
      });
    });

    it("falla con 403 CARRIER_NOT_VERIFIED si el usuario no tiene KYC aprobado", async () => {
      (usersClient.findPublicProfile as any).mockResolvedValue({
        id: CARRIER_ID,
        fullName: "Test Carrier",
        profilePhotoUrl: null,
        isVerified: false,
        createdAt: "2026-01-01T00:00:00Z",
      });

      const service = buildService();

      await expect(
        service.createTrip({
          callerId: CARRIER_ID,
          callerRoles: [UserRole.CARRIER],
          input: {
            originAddress: "Córdoba",
            originLat: -31.42,
            originLng: -64.18,
            destinationAddress: "Villa María",
            destinationLat: -32.4,
            destinationLng: -63.24,
            departureAt: new Date(Date.now() + 100000),
            vehicleType: "auto",
          },
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "CARRIER_NOT_VERIFIED",
      });
    });

    it("falla con 400 TRIP_DEPARTURE_IN_PAST si la fecha de salida es en el pasado", async () => {
      const service = buildService();

      await expect(
        service.createTrip({
          callerId: CARRIER_ID,
          callerRoles: [UserRole.CARRIER],
          input: {
            originAddress: "Córdoba",
            originLat: -31.42,
            originLng: -64.18,
            destinationAddress: "Villa María",
            destinationLat: -32.4,
            destinationLng: -63.24,
            departureAt: new Date(Date.now() - 100000),
            vehicleType: "auto",
          },
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "TRIP_DEPARTURE_IN_PAST",
      });
    });

    it("falla con 400 TRIP_ORIGIN_DESTINATION_TOO_CLOSE si origen y destino están a menos de 100 metros", async () => {
      const service = buildService();

      await expect(
        service.createTrip({
          callerId: CARRIER_ID,
          callerRoles: [UserRole.CARRIER],
          input: {
            originAddress: "Punto A",
            originLat: -31.420001,
            originLng: -64.180001,
            destinationAddress: "Punto B",
            destinationLat: -31.420002,
            destinationLng: -64.180002,
            departureAt: new Date(Date.now() + 100000),
            vehicleType: "auto",
          },
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "TRIP_ORIGIN_DESTINATION_TOO_CLOSE",
      });
    });

    it("crea el viaje exitosamente con datos válidos", async () => {
      const service = buildService();

      const departureAt = new Date(Date.now() + 100000);
      const trip = await service.createTrip({
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
        input: {
          originAddress: "Córdoba",
          originLat: -31.42,
          originLng: -64.18,
          destinationAddress: "Villa María",
          destinationLat: -32.4,
          destinationLng: -63.24,
          departureAt,
          vehicleType: "auto",
        },
      });

      expect(tripRepo.create).toHaveBeenCalledWith({
        carrierId: CARRIER_ID,
        originAddress: "Córdoba",
        originLat: -31.42,
        originLng: -64.18,
        destinationAddress: "Villa María",
        destinationLat: -32.4,
        destinationLng: -63.24,
        departureAt,
        vehicleType: "auto",
      });
      expect(trip.id).toBe(TRIP_ID);
    });
  });

  describe("getTrip", () => {
    it("falla con 404 TRIP_NOT_FOUND si el viaje no existe", async () => {
      const service = buildService();

      await expect(
        service.getTrip({
          tripId: "non-existent",
          callerId: CARRIER_ID,
          callerRoles: [UserRole.CARRIER],
        }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "TRIP_NOT_FOUND",
      });
    });

    it("falla con 403 AUTH_FORBIDDEN si el usuario no es el dueño ni admin", async () => {
      const service = buildService();

      await expect(
        service.getTrip({
          tripId: TRIP_ID,
          callerId: OTHER_USER_ID,
          callerRoles: [UserRole.CARRIER],
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "AUTH_FORBIDDEN",
      });
    });

    it("devuelve el viaje con hasAcceptedPackages: false si no tiene ofertas aceptadas", async () => {
      const service = buildService();

      const result = await service.getTrip({
        tripId: TRIP_ID,
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
      });

      expect(result.id).toBe(TRIP_ID);
      expect(result.hasAcceptedPackages).toBe(false);
    });

    it("devuelve el viaje con hasAcceptedPackages: true si tiene ofertas aceptadas", async () => {
      (tripRepo.countAcceptedOffers as any).mockResolvedValue(2);

      const service = buildService();

      const result = await service.getTrip({
        tripId: TRIP_ID,
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
      });

      expect(result.hasAcceptedPackages).toBe(true);
    });

    it("permite ver el viaje a un ADMIN aunque no sea el dueño", async () => {
      const service = buildService();

      const result = await service.getTrip({
        tripId: TRIP_ID,
        callerId: OTHER_USER_ID,
        callerRoles: [UserRole.ADMIN],
      });

      expect(result.id).toBe(TRIP_ID);
    });
  });

  describe("updateTrip", () => {
    it("falla con 409 TRIP_HAS_ACCEPTED_PACKAGES si el viaje ya tiene paquetes aceptados", async () => {
      (tripRepo.countAcceptedOffers as any).mockResolvedValue(1);

      const service = buildService();

      await expect(
        service.updateTrip({
          tripId: TRIP_ID,
          callerId: CARRIER_ID,
          callerRoles: [UserRole.CARRIER],
          input: { vehicleType: "camioneta" },
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "TRIP_HAS_ACCEPTED_PACKAGES",
      });
    });

    it("actualiza el viaje si no tiene paquetes aceptados", async () => {
      const service = buildService();

      const updated = await service.updateTrip({
        tripId: TRIP_ID,
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
        input: { vehicleType: "camioneta" },
      });

      expect(tripRepo.update).toHaveBeenCalledWith(TRIP_ID, { vehicleType: "camioneta" });
      expect(updated.vehicleType).toBe("camioneta");
    });
  });

  describe("deleteTrip", () => {
    it("falla con 409 TRIP_HAS_ACCEPTED_PACKAGES si el viaje tiene paquetes aceptados", async () => {
      (tripRepo.countAcceptedOffers as any).mockResolvedValue(1);

      const service = buildService();

      await expect(
        service.deleteTrip({
          tripId: TRIP_ID,
          callerId: CARRIER_ID,
          callerRoles: [UserRole.CARRIER],
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "TRIP_HAS_ACCEPTED_PACKAGES",
      });
    });

    it("elimina el viaje exitosamente si no tiene paquetes aceptados", async () => {
      const service = buildService();

      await service.deleteTrip({
        tripId: TRIP_ID,
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
      });

      expect(tripRepo.delete).toHaveBeenCalledWith(TRIP_ID);
    });
  });

  describe("startTrip (MOVO-221)", () => {
    it("falla con 404 TRIP_NOT_FOUND si el viaje no existe", async () => {
      const service = buildService();

      await expect(
        service.startTrip({
          tripId: "non-existent",
          callerId: CARRIER_ID,
          callerRoles: [UserRole.CARRIER],
        }),
      ).rejects.toMatchObject({ statusCode: 404, code: "TRIP_NOT_FOUND" });
      expect(tripRepo.start).not.toHaveBeenCalled();
    });

    it("falla con 403 AUTH_FORBIDDEN si el usuario no es el dueño ni admin", async () => {
      const service = buildService();

      await expect(
        service.startTrip({
          tripId: TRIP_ID,
          callerId: OTHER_USER_ID,
          callerRoles: [UserRole.CARRIER],
        }),
      ).rejects.toMatchObject({ statusCode: 403, code: "AUTH_FORBIDDEN" });
      expect(tripRepo.start).not.toHaveBeenCalled();
    });

    it("permite a un ADMIN iniciar un viaje ajeno", async () => {
      const service = buildService();

      const result = await service.startTrip({
        tripId: TRIP_ID,
        callerId: OTHER_USER_ID,
        callerRoles: [UserRole.ADMIN],
      });

      expect(result.status).toBe(TripStatus.ACTIVE);
      expect(tripRepo.start).toHaveBeenCalledWith(TRIP_ID);
    });

    it("transiciona declared -> active y devuelve el viaje actualizado", async () => {
      const service = buildService();

      const result = await service.startTrip({
        tripId: TRIP_ID,
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
      });

      expect(tripRepo.start).toHaveBeenCalledWith(TRIP_ID);
      expect(result.status).toBe(TripStatus.ACTIVE);
    });

    it("falla con 409 TRIP_NOT_DECLARED si el viaje ya no está declared (repo lo rechaza)", async () => {
      (tripRepo.start as any).mockRejectedValue(new TripNotDeclaredError(TRIP_ID, TripStatus.ACTIVE));
      const service = buildService();

      await expect(
        service.startTrip({
          tripId: TRIP_ID,
          callerId: CARRIER_ID,
          callerRoles: [UserRole.CARRIER],
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: "TRIP_NOT_DECLARED" });
    });

    it("falla con 409 TRIP_ALREADY_HAS_ACTIVE_TRIP si el transportista ya tiene otro viaje active", async () => {
      (tripRepo.start as any).mockRejectedValue(new TripAlreadyHasActiveTripError(CARRIER_ID));
      const service = buildService();

      await expect(
        service.startTrip({
          tripId: TRIP_ID,
          callerId: CARRIER_ID,
          callerRoles: [UserRole.CARRIER],
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: "TRIP_ALREADY_HAS_ACTIVE_TRIP" });
    });

    it("propaga TripNotFoundError del repo como 404 (carrera: el viaje se borró entre el findById y el start)", async () => {
      (tripRepo.start as any).mockRejectedValue(new TripNotFoundError(TRIP_ID));
      const service = buildService();

      await expect(
        service.startTrip({
          tripId: TRIP_ID,
          callerId: CARRIER_ID,
          callerRoles: [UserRole.CARRIER],
        }),
      ).rejects.toMatchObject({ statusCode: 404, code: "TRIP_NOT_FOUND" });
    });

    it("dispara el warm-up del motor VRPTW best-effort sin bloquear la respuesta ni fallar si el solver no está disponible", async () => {
      (shipmentRepo.listActiveShipments as any).mockResolvedValue([]);
      (pricingLogisticsClient.optimizeRoute as any).mockRejectedValue(new Error("solver caído"));
      const service = buildService();

      const result = await service.startTrip({
        tripId: TRIP_ID,
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
      });

      expect(result.status).toBe(TripStatus.ACTIVE);
    });

    describe("push de 'viaje iniciado' (ajuste post-MOVO-245)", () => {
      function fakeAssignedShipment(overrides: Partial<any> = {}) {
        return {
          id: "shipment-1",
          senderId: "sender-1",
          receiverId: "receiver-1",
          carrierId: CARRIER_ID,
          status: ShipmentStatus.ASSIGNED,
          pickupLat: -31.42,
          pickupLng: -64.19,
          deliveryLat: -31.5,
          deliveryLng: -64.2,
          ...overrides,
        };
      }

      it("avisa al emisor (con ETA) y al receptor (sin ETA) de cada envío de este viaje todavía sin retirar", async () => {
        const shipment = fakeAssignedShipment();
        (shipmentRepo.listActiveShipments as any).mockResolvedValue([shipment]);
        const notificationsClient = { sendPush: vi.fn().mockResolvedValue(undefined) };
        const routesProvider = {
          getRoute: vi.fn().mockResolvedValue({ polyline: "abc", distanceMeters: 3000, durationSeconds: 600 }),
        };
        const service = buildService({ notificationsClient, routesProvider });

        await service.startTrip({ tripId: TRIP_ID, callerId: CARRIER_ID, callerRoles: [UserRole.CARRIER] });

        expect(shipmentRepo.listActiveShipments).toHaveBeenCalledWith("carrierId", CARRIER_ID, TRIP_ID);

        await vi.waitFor(() => {
          expect(routesProvider.getRoute).toHaveBeenCalledWith({
            origin: { lat: trip.originLat, lng: trip.originLng },
            destination: { lat: shipment.pickupLat, lng: shipment.pickupLng },
          });
          expect(notificationsClient.sendPush).toHaveBeenCalledTimes(2);
          expect(notificationsClient.sendPush).toHaveBeenCalledWith({
            userId: shipment.senderId,
            title: "Tu transportista salió de viaje",
            body: "Test Carrier inició su viaje. Llega a retirar tu paquete en aprox. 10 min. Seguilo desde la app.",
            category: "custody",
            data: { type: "trip_started", tripId: TRIP_ID, shipmentId: shipment.id },
          });
          expect(notificationsClient.sendPush).toHaveBeenCalledWith({
            userId: shipment.receiverId,
            title: "Salieron a buscar tu paquete",
            body: "Test Carrier inició su viaje camino a retirar tu paquete. Te avisamos cuando esté en camino a vos.",
            category: "custody",
            data: { type: "trip_started", tripId: TRIP_ID, shipmentId: shipment.id },
          });
        });
      });

      it("un envío de este viaje ya IN_TRANSIT no recibe este push (ya avisó el handshake de retiro)", async () => {
        (shipmentRepo.listActiveShipments as any).mockResolvedValue([
          fakeAssignedShipment({ id: "shipment-2", status: ShipmentStatus.IN_TRANSIT }),
        ]);
        const notificationsClient = { sendPush: vi.fn().mockResolvedValue(undefined) };
        const service = buildService({ notificationsClient });

        await service.startTrip({ tripId: TRIP_ID, callerId: CARRIER_ID, callerRoles: [UserRole.CARRIER] });

        expect(notificationsClient.sendPush).not.toHaveBeenCalled();
      });

      it("sin routesProvider, avisa al emisor igual pero sin ETA", async () => {
        (shipmentRepo.listActiveShipments as any).mockResolvedValue([fakeAssignedShipment()]);
        const notificationsClient = { sendPush: vi.fn().mockResolvedValue(undefined) };
        const service = buildService({ notificationsClient });

        await service.startTrip({ tripId: TRIP_ID, callerId: CARRIER_ID, callerRoles: [UserRole.CARRIER] });

        await vi.waitFor(() => {
          expect(notificationsClient.sendPush).toHaveBeenCalledWith(
            expect.objectContaining({
              userId: "sender-1",
              body: "Test Carrier inició su viaje camino a retirar tu paquete. Seguilo desde la app.",
            }),
          );
        });
      });

      it("sin notificationsClient inyectado, no notifica y no rompe", async () => {
        (shipmentRepo.listActiveShipments as any).mockResolvedValue([fakeAssignedShipment()]);
        const service = buildService();

        const result = await service.startTrip({
          tripId: TRIP_ID,
          callerId: CARRIER_ID,
          callerRoles: [UserRole.CARRIER],
        });

        expect(result.status).toBe(TripStatus.ACTIVE);
      });
    });
  });

  describe("getTripMatches", () => {
    it("llama a shipmentRepository.listAvailable con el corredor y radio por defecto", async () => {
      const service = buildService();

      const result = await service.getTripMatches({
        tripId: TRIP_ID,
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
        page: 1,
        limit: 20,
      });

      expect(shipmentRepo.listAvailable).toHaveBeenCalledWith({
        originLat: -31.4201,
        originLng: -64.1888,
        destinationLat: -32.4075,
        destinationLng: -63.2402,
        radiusKm: 15,
        pickupDate: toArgentinaCalendarDate(trip.departureAt),
        excludeUserId: CARRIER_ID,
        page: 1,
        limit: 20,
      });
      expect(result.radiusKm).toBe(15);
      expect(result.tripId).toBe(TRIP_ID);
    });

    it("filtra por el día calendario argentino de departureAt, no por el día UTC crudo (bug reportado en producción)", async () => {
      // 01:30 UTC del 9 sept es 22:30 del 8 sept en Argentina (UTC-3) -- si se comparara
      // el día UTC crudo, el filtro pediría el 9 sept en vez del 8, y un envío con
      // ventana el 8 sept quedaría afuera por error.
      trip.departureAt = new Date("2026-09-09T01:30:00.000Z");
      const service = buildService();

      await service.getTripMatches({
        tripId: TRIP_ID,
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
        page: 1,
        limit: 20,
      });

      expect(shipmentRepo.listAvailable).toHaveBeenCalledWith(
        expect.objectContaining({
          pickupDate: new Date("2026-09-08T00:00:00.000Z"),
        }),
      );
    });

    it("respeta el radio de desvío custom si es provisto", async () => {
      const service = buildService();

      const result = await service.getTripMatches({
        tripId: TRIP_ID,
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
        radiusKm: 25,
        page: 2,
        limit: 10,
      });

      expect(shipmentRepo.listAvailable).toHaveBeenCalledWith(
        expect.objectContaining({
          radiusKm: 25,
          page: 2,
          limit: 10,
        }),
      );
      expect(result.radiusKm).toBe(25);
    });

    it("calcula hasMyOffer: true cuando el transportista ya ofertó al envío, y false cuando no", async () => {
      const fakeItem1 = { id: "shipment-1" } as any;
      const fakeItem2 = { id: "shipment-2" } as any;
      (shipmentRepo.listAvailable as any).mockResolvedValue({
        items: [fakeItem1, fakeItem2],
        total: 2,
      });
      (offerRepo.listPendingOfferedShipmentIds as any).mockResolvedValue(new Set(["shipment-1"]));

      const service = buildService();

      const result = await service.getTripMatches({
        tripId: TRIP_ID,
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
        page: 1,
        limit: 20,
      });

      expect(offerRepo.listPendingOfferedShipmentIds).toHaveBeenCalledWith(CARRIER_ID, [
        "shipment-1",
        "shipment-2",
      ]);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].hasMyOffer).toBe(true);
      expect(result.items[1].hasMyOffer).toBe(false);
    });

    it("falla con 404 TRIP_NOT_FOUND si el viaje no existe", async () => {
      const service = buildService();

      await expect(
        service.getTripMatches({
          tripId: "non-existent",
          callerId: CARRIER_ID,
          callerRoles: [UserRole.CARRIER],
          page: 1,
          limit: 20,
        }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "TRIP_NOT_FOUND",
      });
    });

    it("falla con 403 AUTH_FORBIDDEN si el usuario no es el dueño ni admin", async () => {
      const service = buildService();

      await expect(
        service.getTripMatches({
          tripId: TRIP_ID,
          callerId: OTHER_USER_ID,
          callerRoles: [UserRole.CARRIER],
          page: 1,
          limit: 20,
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "AUTH_FORBIDDEN",
      });
    });

    it("falla con 403 CARRIER_NOT_VERIFIED si el transportista no tiene rol CARRIER", async () => {
      const service = buildService();

      await expect(
        service.getTripMatches({
          tripId: TRIP_ID,
          callerId: CARRIER_ID,
          callerRoles: [UserRole.SENDER],
          page: 1,
          limit: 20,
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "CARRIER_NOT_VERIFIED",
      });
    });

    it("falla con 403 CARRIER_NOT_VERIFIED si el transportista no tiene KYC aprobado", async () => {
      (usersClient.findPublicProfile as any).mockResolvedValue({
        id: CARRIER_ID,
        fullName: "Test Carrier",
        profilePhotoUrl: null,
        isVerified: false,
        createdAt: "2026-01-01T00:00:00Z",
      });

      const service = buildService();

      await expect(
        service.getTripMatches({
          tripId: TRIP_ID,
          callerId: CARRIER_ID,
          callerRoles: [UserRole.CARRIER],
          page: 1,
          limit: 20,
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "CARRIER_NOT_VERIFIED",
      });
    });

    it("permite a un ADMIN consultar los matches de un viaje ajeno sin rol CARRIER ni KYC", async () => {
      const service = buildService();

      const result = await service.getTripMatches({
        tripId: TRIP_ID,
        callerId: OTHER_USER_ID,
        callerRoles: [UserRole.ADMIN],
        page: 1,
        limit: 20,
      });

      expect(result.tripId).toBe(TRIP_ID);
      expect(shipmentRepo.listAvailable).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeUserId: CARRIER_ID,
        }),
      );
      expect(offerRepo.listPendingOfferedShipmentIds).toHaveBeenCalledWith(
        CARRIER_ID,
        expect.any(Array),
      );
    });

    it("si el prefiltro no devuelve candidatos, retorna lista vacía inmediatamente sin llamar a svc-pricing-logistics (MOVO-219)", async () => {
      (shipmentRepo.listAvailable as any).mockResolvedValue({
        items: [],
        total: 0,
      });

      const service = buildService();

      const result = await service.getTripMatches({
        tripId: TRIP_ID,
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
        page: 1,
        limit: 20,
      });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(pricingLogisticsClient.evaluateCandidates).not.toHaveBeenCalled();
    });

    it("enriquece los paquetes compatibles con detourDistanceKm/detourDurationMinutes y ordena por menor desvío ascendente (MOVO-219)", async () => {
      const itemA = { id: "shipment-A", pickupLat: -31.5, pickupLng: -64.0, deliveryLat: -32.1, deliveryLng: -63.5 } as any;
      const itemB = { id: "shipment-B", pickupLat: -31.6, pickupLng: -63.9, deliveryLat: -32.2, deliveryLng: -63.4 } as any;
      const itemC = { id: "shipment-C", pickupLat: -31.7, pickupLng: -63.8, deliveryLat: -32.3, deliveryLng: -63.3 } as any;

      (shipmentRepo.listAvailable as any).mockResolvedValue({
        items: [itemA, itemB, itemC],
        total: 3,
      });

      (pricingLogisticsClient.evaluateCandidates as any).mockResolvedValue({
        directDistanceKm: 145,
        directDurationMinutes: 110,
        evaluations: [
          { candidateId: "shipment-A", feasible: true, detourDistanceKm: 18.2, detourDurationMinutes: 25 },
          { candidateId: "shipment-B", feasible: true, detourDistanceKm: 4.1, detourDurationMinutes: 7 },
          { candidateId: "shipment-C", feasible: true, detourDistanceKm: 11.0, detourDurationMinutes: 15 },
        ],
        calculationMethod: "haversine_vrptw_v1",
      });

      const service = buildService();

      const result = await service.getTripMatches({
        tripId: TRIP_ID,
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
        page: 1,
        limit: 20,
      });

      expect(pricingLogisticsClient.evaluateCandidates).toHaveBeenCalledWith({
        trip: expect.objectContaining({
          id: TRIP_ID,
          originLat: trip.originLat,
          originLng: trip.originLng,
          destinationLat: trip.destinationLat,
          destinationLng: trip.destinationLng,
        }),
        candidates: expect.arrayContaining([
          expect.objectContaining({ id: "shipment-A" }),
          expect.objectContaining({ id: "shipment-B" }),
          expect.objectContaining({ id: "shipment-C" }),
        ]),
      });

      expect(result.items).toHaveLength(3);
      // Orden ascendente por menor desvío: B (4.1 km) -> C (11.0 km) -> A (18.2 km)
      expect(result.items[0].id).toBe("shipment-B");
      expect(result.items[0].detourDistanceKm).toBe(4.1);
      expect(result.items[0].detourDurationMinutes).toBe(7);

      expect(result.items[1].id).toBe("shipment-C");
      expect(result.items[1].detourDistanceKm).toBe(11.0);
      expect(result.items[1].detourDurationMinutes).toBe(15);

      expect(result.items[2].id).toBe("shipment-A");
      expect(result.items[2].detourDistanceKm).toBe(18.2);
      expect(result.items[2].detourDurationMinutes).toBe(25);
    });

    it("descarta candidatos con feasible: false calculados por OR-Tools (MOVO-219)", async () => {
      const itemFeasible = { id: "shipment-ok" } as any;
      const itemInfeasible = { id: "shipment-late" } as any;

      (shipmentRepo.listAvailable as any).mockResolvedValue({
        items: [itemFeasible, itemInfeasible],
        total: 2,
      });

      (pricingLogisticsClient.evaluateCandidates as any).mockResolvedValue({
        directDistanceKm: 145,
        directDurationMinutes: 110,
        evaluations: [
          { candidateId: "shipment-ok", feasible: true, detourDistanceKm: 6.0, detourDurationMinutes: 8 },
          { candidateId: "shipment-late", feasible: false, detourDistanceKm: null, detourDurationMinutes: null },
        ],
        calculationMethod: "haversine_vrptw_v1",
      });

      const service = buildService();

      const result = await service.getTripMatches({
        tripId: TRIP_ID,
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
        page: 1,
        limit: 20,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("shipment-ok");
      expect(result.total).toBe(2);
    });

    it("fail-safe No-Fallback: descarta candidatos omitidos en la evaluación sin asumir factibilidad ni desvío 0 (MOVO-219)", async () => {
      const itemWithEval = { id: "shipment-with-eval" } as any;
      const itemOmitted = { id: "shipment-missing-from-eval" } as any;

      (shipmentRepo.listAvailable as any).mockResolvedValue({
        items: [itemWithEval, itemOmitted],
        total: 50,
      });

      (pricingLogisticsClient.evaluateCandidates as any).mockResolvedValue({
        directDistanceKm: 145,
        directDurationMinutes: 110,
        evaluations: [
          // Solo se incluye shipment-with-eval, shipment-missing-from-eval se omite
          { candidateId: "shipment-with-eval", feasible: true, detourDistanceKm: 5.5, detourDurationMinutes: 8 },
        ],
        calculationMethod: "haversine_vrptw_v1",
      });

      const service = buildService();

      const result = await service.getTripMatches({
        tripId: TRIP_ID,
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
        page: 1,
        limit: 20,
      });

      // El omitido NO debe entrar al feed ni asumirse con 0 km de desvío
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("shipment-with-eval");
      expect(result.items[0].detourDistanceKm).toBe(5.5);
      // El total de la paginación refleja la cantidad real en DB (50)
      expect(result.total).toBe(50);
    });

    it("falla con 409 TRIP_NOT_AVAILABLE si el viaje está cancelled (MOVO-221 -- gap real, antes no chequeaba status)", async () => {
      trip.status = TripStatus.CANCELLED;
      const service = buildService();

      await expect(
        service.getTripMatches({
          tripId: TRIP_ID,
          callerId: CARRIER_ID,
          callerRoles: [UserRole.CARRIER],
          page: 1,
          limit: 20,
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: "TRIP_NOT_AVAILABLE" });
      expect(shipmentRepo.listAvailable).not.toHaveBeenCalled();
    });

    it("falla con 409 TRIP_NOT_AVAILABLE si el viaje está completed", async () => {
      trip.status = TripStatus.COMPLETED;
      const service = buildService();

      await expect(
        service.getTripMatches({
          tripId: TRIP_ID,
          callerId: CARRIER_ID,
          callerRoles: [UserRole.CARRIER],
          page: 1,
          limit: 20,
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: "TRIP_NOT_AVAILABLE" });
    });

    it("sigue funcionando con el viaje todavía declared (no arrancado)", async () => {
      trip.status = TripStatus.DECLARED;
      const service = buildService();

      const result = await service.getTripMatches({
        tripId: TRIP_ID,
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
        page: 1,
        limit: 20,
      });

      expect(result.tripId).toBe(TRIP_ID);
    });

    it("política No-Fallback: si svc-pricing-logistics falla (502/503), propaga el error (MOVO-219)", async () => {
      const item = { id: "shipment-1" } as any;
      (shipmentRepo.listAvailable as any).mockResolvedValue({
        items: [item],
        total: 1,
      });

      (pricingLogisticsClient.evaluateCandidates as any).mockRejectedValue(
        new ApiError(502, "ROUTING_SERVICE_ERROR", "Error en proveedor de rutas")
      );

      const service = buildService();

      await expect(
        service.getTripMatches({
          tripId: TRIP_ID,
          callerId: CARRIER_ID,
          callerRoles: [UserRole.CARRIER],
          page: 1,
          limit: 20,
        })
      ).rejects.toMatchObject({
        statusCode: 502,
        code: "ROUTING_SERVICE_ERROR",
      });
    });

    it("serializa pickupWindowStart y pickupWindowEnd combinando pickupDate con la hora de ventana en UTC real (+3h ART)", async () => {
      const item = {
        id: "shipment-window-test",
        pickupLat: -31.42,
        pickupLng: -64.18,
        deliveryLat: -31.91,
        deliveryLng: -63.68,
        pickupDate: new Date("2026-09-17T00:00:00.000Z"),
        pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
        pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      } as any;

      (shipmentRepo.listAvailable as any).mockResolvedValue({
        items: [item],
        total: 1,
      });

      (pricingLogisticsClient.evaluateCandidates as any).mockResolvedValue({
        directDistanceKm: 145,
        directDurationMinutes: 110,
        evaluations: [
          { candidateId: "shipment-window-test", feasible: true, detourDistanceKm: 2.0, detourDurationMinutes: 5 },
        ],
        calculationMethod: "haversine_vrptw_v1",
      });

      const service = buildService();

      await service.getTripMatches({
        tripId: TRIP_ID,
        callerId: CARRIER_ID,
        callerRoles: [UserRole.CARRIER],
        page: 1,
        limit: 20,
      });

      // 09:00 y 12:00 ART deben viajar como 12:00:00.000Z y 15:00:00.000Z del 17 de sept de 2026
      // NUNCA como "1970-01-01T..." que causaría que el evaluador lo marque como inviable
      expect(pricingLogisticsClient.evaluateCandidates).toHaveBeenCalledWith(
        expect.objectContaining({
          candidates: [
            expect.objectContaining({
              id: "shipment-window-test",
              pickupWindowStart: "2026-09-17T12:00:00.000Z",
              pickupWindowEnd: "2026-09-17T15:00:00.000Z",
            }),
          ],
        })
      );
    });
  });
});
