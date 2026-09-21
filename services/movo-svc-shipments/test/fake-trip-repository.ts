import { vi } from "vitest";
import { TripStatus } from "@movo/shared";
import { TripRepository } from "../src/repositories/trip-repository";
import { Trip } from "../src/models/trip";

/**
 * Fake de `TripRepository` para tests de `shipments.service.ts` (MOVO-179) — mismo
 * criterio que `fake-offer-repository.ts`. Los tests de `trip-repository.ts` en sí
 * siguen corriendo contra Postgres real (`trip-repository.integration.test.ts`), esto
 * es solo para aislar `dispatchTripMatchPushes` de esa capa.
 */
export function createFakeTripRepository(overrides: Partial<TripRepository> = {}): TripRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    countAcceptedOffers: vi.fn().mockResolvedValue(0),
    listByCarrier: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    update: vi.fn(),
    delete: vi.fn(),
    findActiveTripsMatchingShipment: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

export function fakeTrip(overrides: Partial<Trip> & { carrierId: string }): Trip {
  return {
    id: "trip-id",
    originAddress: "Av. Colón 1234, Córdoba",
    originLat: -31.4201,
    originLng: -64.1888,
    destinationAddress: "Av. Vélez Sarsfield 1000, Córdoba",
    destinationLat: -31.4353,
    destinationLng: -64.1858,
    departureAt: new Date("2030-01-01T09:00:00.000Z"),
    vehicleType: "car",
    status: TripStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
