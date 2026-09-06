import { describe, it, expect, vi, afterEach } from "vitest";
import { ShipmentStatus, UserRole } from "@movo/shared";
import { createRatingsService } from "../src/modules/ratings/ratings.service";
import { ShipmentRepository } from "../src/repositories/shipment-repository";
import { DuplicateRatingError } from "../src/repositories/rating-repository";
import { Shipment, ShipmentEvent, PackageType } from "../src/models/shipment";
import { RatingRole } from "../src/models/rating";
import { createFakeRatingRepository, fakeRating } from "./fake-rating-repository";
import { createFakeNotificationsClient } from "./fake-notifications-client";

const SENDER_ID = "sender-id";
const RECEIVER_ID = "receiver-id";
const CARRIER_ID = "carrier-id";
const SHIPMENT_ID = "shipment-id";

afterEach(() => {
  vi.useRealTimers();
});

function fakeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: SHIPMENT_ID,
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

function fakeShipmentRepository(overrides: Partial<ShipmentRepository> = {}): ShipmentRepository {
  return {
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(fakeShipment()),
    updateStatus: vi.fn(),
    listEvents: vi.fn().mockResolvedValue([] as ShipmentEvent[]),
    addPhoto: vi.fn(),
    listPhotos: vi.fn(),
    existsPhotoByS3Key: vi.fn(),
    listByUser: vi.fn(),
    findExpiredAwaitingConfirmation: vi.fn(),
    hasActiveShipmentsForUser: vi.fn(),
    countCompletedTransactions: vi.fn().mockResolvedValue({ asSender: 0, asCarrier: 0 }),
    getUsageStatsByRole: vi.fn().mockResolvedValue({
      asSender: { cancelled: 0, avgPackageWeightKg: null },
      asCarrier: { cancelled: 0, avgPackageWeightKg: null },
    }),
    getSharedHistory: vi.fn().mockResolvedValue({ sharedShipmentCount: 0, lastSharedAt: null, allDelivered: false }),
    ...overrides,
  };
}

// El envío está `delivered` desde hace 1hs (dentro de la ventana de 72hs) por default.
const NOW = new Date("2030-01-05T01:00:00.000Z");
// deliveredAt + 73hs -- 1hs pasado el deadline de 72hs.
const AFTER_WINDOW = new Date("2030-01-08T01:00:00.001Z");

function freezeTime(at: Date): void {
  vi.useFakeTimers();
  vi.setSystemTime(at);
}

describe("ratings.service — createRating (MOVO-146)", () => {
  it("AC1: alta feliz -- persiste el rol del calificado y dispara la push", async () => {
    const ratingRepository = createFakeRatingRepository({
      create: vi.fn().mockResolvedValue(
        fakeRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: RECEIVER_ID, role: RatingRole.receiver, score: 5 }),
      ),
    });
    const notificationsClient = createFakeNotificationsClient();
    const service = createRatingsService(fakeShipmentRepository(), ratingRepository, notificationsClient);

    freezeTime(NOW);
    const result = await service.createRating({
      shipmentId: SHIPMENT_ID,
      raterId: SENDER_ID,
      rateeId: RECEIVER_ID,
      score: 5,
    });

    expect(result.role).toBe(RatingRole.receiver);
    expect(ratingRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: RECEIVER_ID, role: RatingRole.receiver, score: 5 }),
    );
    expect(notificationsClient.sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ userId: RECEIVER_ID, data: { type: "rating_received", shipmentId: SHIPMENT_ID } }),
    );
  });

  it("resuelve el rol correcto según quién calificó a quién (carrier calificado por sender)", async () => {
    const ratingRepository = createFakeRatingRepository({
      create: vi.fn().mockImplementation((input) => Promise.resolve(fakeRating(input))),
    });
    const service = createRatingsService(fakeShipmentRepository(), ratingRepository, createFakeNotificationsClient());

    freezeTime(NOW);
    await service.createRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: CARRIER_ID, score: 4 });

    expect(ratingRepository.create).toHaveBeenCalledWith(expect.objectContaining({ role: RatingRole.carrier }));
  });

  it("404 si el envío no existe", async () => {
    const shipmentRepository = fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(null) });
    const service = createRatingsService(shipmentRepository, createFakeRatingRepository());

    await expect(
      service.createRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: RECEIVER_ID, score: 5 }),
    ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
  });

  it("AC3: 403 si quien califica no participó del envío", async () => {
    const service = createRatingsService(fakeShipmentRepository(), createFakeRatingRepository());

    await expect(
      service.createRating({ shipmentId: SHIPMENT_ID, raterId: "ajeno-id", rateeId: RECEIVER_ID, score: 5 }),
    ).rejects.toMatchObject({ statusCode: 403, code: "AUTH_FORBIDDEN" });
  });

  it("AC3: 403 si el calificado no participó del envío", async () => {
    const service = createRatingsService(fakeShipmentRepository(), createFakeRatingRepository());

    await expect(
      service.createRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: "ajeno-id", score: 5 }),
    ).rejects.toMatchObject({ statusCode: 403, code: "AUTH_FORBIDDEN" });
  });

  it("AC3: 403 en autocalificación", async () => {
    const service = createRatingsService(fakeShipmentRepository(), createFakeRatingRepository());

    await expect(
      service.createRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: SENDER_ID, score: 5 }),
    ).rejects.toMatchObject({ statusCode: 403, code: "AUTH_FORBIDDEN" });
  });

  it("AC3: 409 SHIPMENT_NOT_DELIVERED si el envío no está delivered", async () => {
    const shipmentRepository = fakeShipmentRepository({
      findById: vi.fn().mockResolvedValue(fakeShipment({ status: ShipmentStatus.IN_TRANSIT, deliveredAt: null })),
    });
    const service = createRatingsService(shipmentRepository, createFakeRatingRepository());

    await expect(
      service.createRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: RECEIVER_ID, score: 5 }),
    ).rejects.toMatchObject({ statusCode: 409, code: "SHIPMENT_NOT_DELIVERED" });
  });

  it("AC9: 409 SHIPMENT_RATING_DISPUTE_ACTIVE si el envío está disputed", async () => {
    const shipmentRepository = fakeShipmentRepository({
      findById: vi.fn().mockResolvedValue(fakeShipment({ status: ShipmentStatus.DISPUTED })),
    });
    const service = createRatingsService(shipmentRepository, createFakeRatingRepository());

    await expect(
      service.createRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: RECEIVER_ID, score: 5 }),
    ).rejects.toMatchObject({ statusCode: 409, code: "SHIPMENT_RATING_DISPUTE_ACTIVE" });
  });

  it("AC8: 409 SHIPMENT_RATING_WINDOW_EXPIRED pasadas las 72hs de la entrega", async () => {
    const service = createRatingsService(fakeShipmentRepository(), createFakeRatingRepository());

    freezeTime(AFTER_WINDOW);
    await expect(
      service.createRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: RECEIVER_ID, score: 5 }),
    ).rejects.toMatchObject({ statusCode: 409, code: "SHIPMENT_RATING_WINDOW_EXPIRED" });
  });

  it("AC2/AC5: propaga DuplicateRatingError si el repositorio choca con el constraint único", async () => {
    const ratingRepository = createFakeRatingRepository({
      create: vi.fn().mockRejectedValue(new DuplicateRatingError(SHIPMENT_ID, SENDER_ID, RECEIVER_ID)),
    });
    const service = createRatingsService(fakeShipmentRepository(), ratingRepository);

    freezeTime(NOW);
    await expect(
      service.createRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: RECEIVER_ID, score: 5 }),
    ).rejects.toBeInstanceOf(DuplicateRatingError);
  });

  it("AC7: un fallo de la push no revierte el alta ya commiteada", async () => {
    const created = fakeRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: RECEIVER_ID });
    const ratingRepository = createFakeRatingRepository({ create: vi.fn().mockResolvedValue(created) });
    const notificationsClient = createFakeNotificationsClient({ sendPush: vi.fn().mockRejectedValue(new Error("caído")) });
    const logger = { warn: vi.fn() };
    const service = createRatingsService(fakeShipmentRepository(), ratingRepository, notificationsClient, logger);

    freezeTime(NOW);
    const result = await service.createRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: RECEIVER_ID, score: 5 });

    expect(result).toEqual(created);
  });
});

describe("ratings.service — updateRating (MOVO-146 AC5)", () => {
  it("edita la fila existente sin crear una segunda", async () => {
    const existing = fakeRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: RECEIVER_ID, score: 3 });
    const updated = { ...existing, score: 4, comment: "mejoró" };
    const ratingRepository = createFakeRatingRepository({
      findByPair: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockResolvedValue(updated),
    });
    const service = createRatingsService(fakeShipmentRepository(), ratingRepository);

    freezeTime(NOW);
    const result = await service.updateRating({
      shipmentId: SHIPMENT_ID,
      raterId: SENDER_ID,
      rateeId: RECEIVER_ID,
      score: 4,
      comment: "mejoró",
    });

    expect(ratingRepository.create).not.toHaveBeenCalled();
    expect(ratingRepository.update).toHaveBeenCalledWith(SHIPMENT_ID, SENDER_ID, RECEIVER_ID, 4, "mejoró");
    expect(result).toEqual(updated);
  });

  it("404 si el envío no existe", async () => {
    const shipmentRepository = fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(null) });
    const service = createRatingsService(shipmentRepository, createFakeRatingRepository());

    await expect(
      service.updateRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: RECEIVER_ID, score: 4 }),
    ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
  });

  it("404 SHIPMENT_RATING_NOT_FOUND si el caller no calificó todavía a esa persona", async () => {
    const ratingRepository = createFakeRatingRepository({ findByPair: vi.fn().mockResolvedValue(null) });
    const service = createRatingsService(fakeShipmentRepository(), ratingRepository);

    await expect(
      service.updateRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: RECEIVER_ID, score: 4 }),
    ).rejects.toMatchObject({ statusCode: 404, code: "SHIPMENT_RATING_NOT_FOUND" });
  });

  it("409 SHIPMENT_RATING_WINDOW_EXPIRED si la ventana ya cerró", async () => {
    const existing = fakeRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: RECEIVER_ID });
    const ratingRepository = createFakeRatingRepository({ findByPair: vi.fn().mockResolvedValue(existing) });
    const service = createRatingsService(fakeShipmentRepository(), ratingRepository);

    freezeTime(AFTER_WINDOW);
    await expect(
      service.updateRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: RECEIVER_ID, score: 4 }),
    ).rejects.toMatchObject({ statusCode: 409, code: "SHIPMENT_RATING_WINDOW_EXPIRED" });
  });
});

describe("ratings.service — listShipmentRatings (MOVO-146 AC6)", () => {
  it("una parte del envío puede listar sus calificaciones", async () => {
    const ratings = [fakeRating({ shipmentId: SHIPMENT_ID, raterId: SENDER_ID, rateeId: RECEIVER_ID })];
    const ratingRepository = createFakeRatingRepository({ listByShipment: vi.fn().mockResolvedValue(ratings) });
    const service = createRatingsService(fakeShipmentRepository(), ratingRepository);

    const result = await service.listShipmentRatings(SHIPMENT_ID, RECEIVER_ID, []);
    expect(result).toEqual(ratings);
  });

  it("404 si el envío no existe", async () => {
    const shipmentRepository = fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(null) });
    const service = createRatingsService(shipmentRepository, createFakeRatingRepository());

    await expect(service.listShipmentRatings(SHIPMENT_ID, SENDER_ID, [])).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
  });

  it("un admin puede listar aunque no sea parte del envío", async () => {
    const ratingRepository = createFakeRatingRepository();
    const service = createRatingsService(fakeShipmentRepository(), ratingRepository);

    await expect(service.listShipmentRatings(SHIPMENT_ID, "admin-id", [UserRole.ADMIN])).resolves.toEqual([]);
  });

  it("403 para un usuario ajeno sin rol admin", async () => {
    const service = createRatingsService(fakeShipmentRepository(), createFakeRatingRepository());

    await expect(service.listShipmentRatings(SHIPMENT_ID, "ajeno-id", [])).rejects.toMatchObject({
      statusCode: 403,
      code: "AUTH_FORBIDDEN",
    });
  });
});

describe("ratings.service — getReputationSummary (MOVO-147 AC3)", () => {
  const REPUTATION_CONFIG = { confidenceConstant: 5, decayHalfLifeDays: 180 };

  it("sin calificaciones -- null, ratingCount 0, isNewProfile true, sin pisar transactionCounts", async () => {
    const ratingRepository = createFakeRatingRepository();
    const shipmentRepository = fakeShipmentRepository({
      countCompletedTransactions: vi.fn().mockResolvedValue({ asSender: 3, asCarrier: 1 }),
    });
    const service = createRatingsService(shipmentRepository, ratingRepository, undefined, undefined, REPUTATION_CONFIG);

    const summary = await service.getReputationSummary(RECEIVER_ID);

    expect(summary).toEqual({
      reputationScore: null,
      ratingCount: 0,
      isNewProfile: true,
      asSender: {
        reputationScore: null,
        ratingCount: 0,
        isNewProfile: true,
        usageStats: { delivered: 3, cancelled: 0, avgPackageWeightKg: null },
      },
      asCarrier: {
        reputationScore: null,
        ratingCount: 0,
        isNewProfile: true,
        usageStats: { delivered: 1, cancelled: 0, avgPackageWeightKg: null },
      },
      transactionCounts: { asSender: 3, asCarrier: 1 },
    });
    // AC6: sin calificaciones propias no hay nada que shrinkear hacia `m` -- no vale la
    // pena pagar el agregado SQL de la media global.
    expect(ratingRepository.getGlobalAverageScore).not.toHaveBeenCalled();
  });

  it("AC3: el desglose por rol no mezcla calificaciones de sender con las de carrier", async () => {
    const ratingRepository = createFakeRatingRepository({
      listForReputation: vi.fn().mockResolvedValue([
        { score: 5, createdAt: new Date(), role: RatingRole.sender },
        { score: 1, createdAt: new Date(), role: RatingRole.carrier },
      ]),
      getGlobalAverageScore: vi.fn().mockResolvedValue(3),
    });
    const service = createRatingsService(fakeShipmentRepository(), ratingRepository, undefined, undefined, REPUTATION_CONFIG);

    const summary = await service.getReputationSummary(RECEIVER_ID);

    expect(summary.ratingCount).toBe(2);
    expect(summary.asSender.ratingCount).toBe(1);
    expect(summary.asCarrier.ratingCount).toBe(1);
    // La de 5 (sender) empuja su bucket para arriba, la de 1 (carrier) para abajo --
    // si se mezclaran, ambos buckets darían el mismo valor.
    expect(summary.asSender.reputationScore).toBeGreaterThan(summary.asCarrier.reputationScore as number);
  });

  it("propaga transactionCounts del shipmentRepository sin tocarlo", async () => {
    const shipmentRepository = fakeShipmentRepository({
      countCompletedTransactions: vi.fn().mockResolvedValue({ asSender: 12, asCarrier: 7 }),
    });
    const service = createRatingsService(shipmentRepository, createFakeRatingRepository(), undefined, undefined, REPUTATION_CONFIG);

    const summary = await service.getReputationSummary(RECEIVER_ID);

    expect(summary.transactionCounts).toEqual({ asSender: 12, asCarrier: 7 });
  });

  it("MOVO-170: usageStats combina delivered (transactionCounts) con cancelled/avgPackageWeightKg por rol", async () => {
    const shipmentRepository = fakeShipmentRepository({
      countCompletedTransactions: vi.fn().mockResolvedValue({ asSender: 12, asCarrier: 7 }),
      getUsageStatsByRole: vi.fn().mockResolvedValue({
        asSender: { cancelled: 2, avgPackageWeightKg: 3.5 },
        asCarrier: { cancelled: 1, avgPackageWeightKg: null },
      }),
    });
    const service = createRatingsService(shipmentRepository, createFakeRatingRepository(), undefined, undefined, REPUTATION_CONFIG);

    const summary = await service.getReputationSummary(RECEIVER_ID);

    expect(summary.asSender.usageStats).toEqual({ delivered: 12, cancelled: 2, avgPackageWeightKg: 3.5 });
    expect(summary.asCarrier.usageStats).toEqual({ delivered: 7, cancelled: 1, avgPackageWeightKg: null });
  });

  it("sin reputationConfig inyectado, usa el mismo default que envSchema (C=5, semivida=180)", async () => {
    const ratingRepository = createFakeRatingRepository({
      listForReputation: vi.fn().mockResolvedValue([{ score: 5, createdAt: new Date(), role: RatingRole.sender }]),
      getGlobalAverageScore: vi.fn().mockResolvedValue(3),
    });
    // Sin 5to argumento -- mismo criterio que el resto de los tests de este archivo,
    // que tampoco pasan reputationConfig hoy.
    const service = createRatingsService(fakeShipmentRepository(), ratingRepository);

    const summary = await service.getReputationSummary(RECEIVER_ID);

    // (5*3 + 5) / (5 + 1) = 20/6 = 3.33... -> 3.3
    expect(summary.reputationScore).toBe(3.3);
  });
});
