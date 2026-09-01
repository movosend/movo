import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRole } from "@movo/shared";
import { createTripsService } from "../src/modules/trips/trips.service";
import { TripRepository, TripNotFoundError, TripHasAcceptedPackagesError } from "../src/repositories/trip-repository";
import { ShipmentRepository } from "../src/repositories/shipment-repository";
import { OfferRepository } from "../src/repositories/offer-repository";
import { UsersClient } from "../src/adapters/users-client";
import { Trip, TripStatus } from "../src/models/trip";
import { createFakeOfferRepository } from "./fake-offer-repository";

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

describe("TripsService (MOVO-161)", () => {
  let tripRepo: TripRepository;
  let shipmentRepo: ShipmentRepository;
  let offerRepo: OfferRepository;
  let usersClient: UsersClient;

  function buildService() {
    return createTripsService({
      tripRepository: tripRepo,
      shipmentRepository: shipmentRepo,
      offerRepository: offerRepo,
      usersClient,
      defaultMaxDetourKm: 15,
    });
  }

  beforeEach(() => {
    tripRepo = {
      create: vi.fn().mockImplementation(async (input) => fakeTrip(input)),
      findById: vi.fn().mockImplementation(async (id) => (id === TRIP_ID ? fakeTrip() : null)),
      countAcceptedOffers: vi.fn().mockResolvedValue(0),
      listByCarrier: vi.fn().mockResolvedValue({ items: [fakeTrip()], total: 1 }),
      update: vi.fn().mockImplementation(async (id, input) => fakeTrip({ id, ...input })),
      delete: vi.fn().mockResolvedValue(undefined),
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
        excludeUserId: CARRIER_ID,
        page: 1,
        limit: 20,
      });
      expect(result.radiusKm).toBe(15);
      expect(result.tripId).toBe(TRIP_ID);
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
  });
});
