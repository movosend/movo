import { vi } from "vitest";
import { RatingRepository } from "../src/repositories/rating-repository";
import { Rating, RatingRole } from "../src/models/rating";

/** Fake de `RatingRepository` para tests de `ratings.service.ts` -- mismo criterio que
 * `fake-offer-repository.ts`. Los tests del repositorio en sí corren contra Postgres
 * real (`ratings.integration.test.ts`). */
export function createFakeRatingRepository(overrides: Partial<RatingRepository> = {}): RatingRepository {
  return {
    create: vi.fn(),
    update: vi.fn(),
    findByPair: vi.fn().mockResolvedValue(null),
    listByShipment: vi.fn().mockResolvedValue([]),
    listRecentByRateePaginated: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listForReputation: vi.fn().mockResolvedValue([]),
    getGlobalAverageScore: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

export function fakeRating(overrides: Partial<Rating> & { shipmentId: string; raterId: string; rateeId: string }): Rating {
  return {
    id: "rating-id",
    role: RatingRole.receiver,
    score: 5,
    comment: null,
    createdAt: new Date(),
    ...overrides,
  };
}
