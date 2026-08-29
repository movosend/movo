import { vi } from "vitest";
import { OfferStatus } from "@movo/shared";
import { OfferRepository } from "../src/repositories/offer-repository";
import { Offer } from "../src/models/offer";

/**
 * Fake de `OfferRepository` para tests de `shipments.service.ts` — mismo criterio que
 * `fake-users-client.ts`. Los tests de `offer-repository.ts` en sí siguen corriendo
 * contra Postgres real (`offer-repository.integration.test.ts`), esto es solo para
 * aislar la orquestación de `cancelShipment` (MOVO-108/AC7) de esa capa.
 */
export function createFakeOfferRepository(overrides: Partial<OfferRepository> = {}): OfferRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    listByShipment: vi.fn().mockResolvedValue([]),
    withdraw: vi.fn(),
    reject: vi.fn(),
    acceptOffer: vi.fn(),
    listByCarrier: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    listPendingOfferedShipmentIds: vi.fn().mockResolvedValue(new Set()),
    ...overrides,
  };
}

export function fakeOffer(overrides: Partial<Offer> & { shipmentId: string; carrierId: string }): Offer {
  return {
    id: "offer-id",
    priceOffered: 5000,
    offeredDate: new Date("2030-01-01T00:00:00.000Z"),
    message: null,
    carrierRatingAtOffer: null,
    carrierNameAtOffer: null,
    status: OfferStatus.PENDING,
    expiresAt: null,
    createdAt: new Date(),
    respondedAt: null,
    ...overrides,
  };
}
