import { describe, it, expect, vi, afterEach } from "vitest";
import { ShipmentStatus } from "@movo/shared";
import { createShipmentsService } from "../src/modules/shipments/shipments.service";
import { ShipmentRepository } from "../src/repositories/shipment-repository";
import { RatingRepository } from "../src/repositories/rating-repository";
import { RATING_WINDOW_HOURS } from "../src/domain/rating-window";
import { Shipment, ShipmentEvent, PackageType } from "../src/models/shipment";
import { RatingRole } from "../src/models/rating";
import { fakeRating } from "./fake-rating-repository";

const SENDER_ID = "sender-id";
const RECEIVER_ID = "receiver-id";
const CARRIER_ID = "carrier-id";

function fakeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: "shipment-id",
    senderId: SENDER_ID,
    receiverId: RECEIVER_ID,
    carrierId: CARRIER_ID,
    packageType: PackageType.standard_package,
    weightKg: 2,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: null,
    urgent: false,
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4201,
    pickupLng: -64.1888,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.4135,
    deliveryLng: -64.181,
    pickupDate: new Date("2030-01-01T00:00:00.000Z"),
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 2100,
    calculationMethod: "euclidean_linear_v1",
    agreedPriceArs: null,
    paymentMethod: null,
    status: ShipmentStatus.DELIVERED,
    lastStatusChangedAt: null,
    deliveredAt: new Date("2030-01-05T00:00:00.000Z"),
    receiverConfirmationDeadline: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("shipments.service — listPendingRatings (MOVO-222)", () => {
  it("sin ratingRepository inyectado, degrada a lista vacía sin tocar el repositorio de envíos", async () => {
    const findPendingRatingCandidates = vi.fn();
    const repository = { findPendingRatingCandidates } as unknown as ShipmentRepository;
    const service = createShipmentsService(repository, {} as any, undefined, undefined, {});

    const result = await service.listPendingRatings(SENDER_ID);

    expect(result).toEqual([]);
    expect(findPendingRatingCandidates).not.toHaveBeenCalled();
  });

  it("sin candidatos, devuelve lista vacía sin consultar calificaciones ya hechas", async () => {
    const findPendingRatingCandidates = vi.fn().mockResolvedValue([]);
    const listByRaterForShipments = vi.fn();
    const repository = { findPendingRatingCandidates } as unknown as ShipmentRepository;
    const ratingRepository = { listByRaterForShipments } as unknown as RatingRepository;
    const service = createShipmentsService(repository, {} as any, undefined, undefined, { ratingRepository });

    const result = await service.listPendingRatings(SENDER_ID);

    expect(result).toEqual([]);
    expect(listByRaterForShipments).not.toHaveBeenCalled();
  });

  it("acota la ventana de candidatos a las últimas RATING_WINDOW_HOURS", async () => {
    vi.useFakeTimers();
    const now = new Date("2030-02-01T12:00:00.000Z");
    vi.setSystemTime(now);

    const findPendingRatingCandidates = vi.fn().mockResolvedValue([]);
    const repository = { findPendingRatingCandidates } as unknown as ShipmentRepository;
    const ratingRepository = { listByRaterForShipments: vi.fn() } as unknown as RatingRepository;
    const service = createShipmentsService(repository, {} as any, undefined, undefined, { ratingRepository });

    await service.listPendingRatings(SENDER_ID);

    const expectedSince = new Date(now.getTime() - RATING_WINDOW_HOURS * 60 * 60 * 1000);
    expect(findPendingRatingCandidates).toHaveBeenCalledWith(SENDER_ID, expectedSince);
  });

  it("filtra los candidatos que ya no tienen nada pendiente y mapea los que sí", async () => {
    const pending = fakeShipment({ id: "pending-shipment" });
    const alreadyRated = fakeShipment({ id: "already-rated-shipment" });
    const findPendingRatingCandidates = vi.fn().mockResolvedValue([pending, alreadyRated]);
    const listEvents = vi.fn().mockResolvedValue([] as ShipmentEvent[]);
    const repository = { findPendingRatingCandidates, listEvents } as unknown as ShipmentRepository;

    // El emisor solo tiene pendiente calificar al transportista (MOVO-153) -- en
    // "already-rated-shipment" ya lo calificó, en "pending-shipment" todavía no.
    const listByRaterForShipments = vi
      .fn()
      .mockResolvedValue([
        fakeRating({ shipmentId: "already-rated-shipment", raterId: SENDER_ID, rateeId: CARRIER_ID, role: RatingRole.carrier }),
      ]);
    const ratingRepository = { listByRaterForShipments } as unknown as RatingRepository;

    const service = createShipmentsService(repository, {} as any, undefined, undefined, { ratingRepository });
    const result = await service.listPendingRatings(SENDER_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "pending-shipment",
      status: ShipmentStatus.DELIVERED,
      deliveredAt: pending.deliveredAt,
      senderId: SENDER_ID,
      receiverId: RECEIVER_ID,
      carrierId: CARRIER_ID,
      pendingRatingFor: [RatingRole.carrier],
    });
    expect(listByRaterForShipments).toHaveBeenCalledWith(SENDER_ID, ["pending-shipment", "already-rated-shipment"]);
  });

  it("DoD: transportista con 2 contrapartes calificado parcialmente -- solo la que falta queda pendiente", async () => {
    const shipment = fakeShipment({ id: "s1" });
    const findPendingRatingCandidates = vi.fn().mockResolvedValue([shipment]);
    const listEvents = vi.fn().mockResolvedValue([] as ShipmentEvent[]);
    const repository = { findPendingRatingCandidates, listEvents } as unknown as ShipmentRepository;

    // El transportista ya calificó al emisor, todavía le falta el receptor.
    const listByRaterForShipments = vi
      .fn()
      .mockResolvedValue([fakeRating({ shipmentId: "s1", raterId: CARRIER_ID, rateeId: SENDER_ID, role: RatingRole.sender })]);
    const ratingRepository = { listByRaterForShipments } as unknown as RatingRepository;

    const service = createShipmentsService(repository, {} as any, undefined, undefined, { ratingRepository });
    const result = await service.listPendingRatings(CARRIER_ID);

    expect(result).toHaveLength(1);
    expect(result[0]!.pendingRatingFor).toEqual([RatingRole.receiver]);
  });
});
