import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ShipmentStatus } from "@movo/shared";
import { createShipmentsService } from "../src/modules/shipments/shipments.service";
import { ShipmentRepository } from "../src/repositories/shipment-repository";
import { OfferRepository } from "../src/repositories/offer-repository";
import { Shipment, PackageType } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";

const NOW = new Date("2026-09-25T18:00:00.000Z"); // 15:00 AR del 25/09

function shipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: "s-1",
    senderId: "sender-1",
    receiverId: "receiver-1",
    carrierId: "carrier-1",
    packageType: PackageType.standard_package,
    weightKg: 2,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: null,
    urgent: false,
    pickupAddress: "a",
    pickupLat: -31.4,
    pickupLng: -64.1,
    deliveryAddress: "b",
    deliveryLat: -31.5,
    deliveryLng: -64.2,
    pickupDate: new Date("2026-09-23T00:00:00.000Z"),
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 1000,
    calculationMethod: null,
    highDemand: null,
    agreedPriceArs: null,
    paymentMethod: null,
    status: ShipmentStatus.ASSIGNMENT_PENDING,
    lastStatusChangedAt: new Date("2026-09-23T13:00:00.000Z"),
    deliveredAt: null,
    receiverConfirmationDeadline: null,
    receiverRedesignationDeadline: null,
    transitAnomalyFlaggedAt: null,
    rejectionReason: null,
    createdAt: new Date("2026-09-20T00:00:00.000Z"),
    updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    estimatedDeliveryDate: null,
    estimatedDeliveryTimeWindowStart: null,
    estimatedDeliveryTimeWindowEnd: null,
    ...overrides,
  } as Shipment;
}

function repo(overrides: Partial<ShipmentRepository> = {}): ShipmentRepository {
  return {
    updateStatus: vi.fn().mockResolvedValue(shipment()),
    findPotentiallyExpiredPublished: vi.fn().mockResolvedValue([]),
    findPotentiallyPickupMissed: vi.fn().mockResolvedValue([]),
    findInTransitUnflagged: vi.fn().mockResolvedValue([]),
    flagTransitAnomaly: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as ShipmentRepository;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("expireUnpickedAssignedShipments (MOVO-258, D1)", () => {
  it("cancela los vencidos más allá del margen de gracia y avisa a las tres partes", async () => {
    const overdue = shipment(); // cerró 23/09 12:00 AR, gracia 24h -> venció 24/09 12:00 AR
    const repository = repo({ findPotentiallyPickupMissed: vi.fn().mockResolvedValue([overdue]) });
    const notifications = createFakeNotificationsClient();
    const service = createShipmentsService(repository, createFakeUsersClient({}), notifications);

    const result = await service.expireUnpickedAssignedShipments(50);

    expect(result).toEqual({ expiredCount: 1, errorsCount: 0 });
    expect(repository.findPotentiallyPickupMissed).toHaveBeenCalledWith(50);
    expect(repository.updateStatus).toHaveBeenCalledWith(
      "s-1",
      ShipmentStatus.CANCELLED,
      null,
      "El retiro no se realizó dentro del plazo (ventana de retiro más margen de gracia)",
      { expectedFrom: overdue.status }
    );
    await vi.waitFor(() => expect(notifications.sendPush).toHaveBeenCalledTimes(3));
    const recipients = (notifications.sendPush as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].userId);
    expect(recipients.sort()).toEqual(["carrier-1", "receiver-1", "sender-1"]);
  });

  it("no cancela dentro del margen de gracia", async () => {
    const inGrace = shipment({ pickupDate: new Date("2026-09-25T00:00:00.000Z") }); // cierra hoy 12:00 AR
    const repository = repo({ findPotentiallyPickupMissed: vi.fn().mockResolvedValue([inGrace]) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    expect(await service.expireUnpickedAssignedShipments()).toEqual({ expiredCount: 0, errorsCount: 0 });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it("respeta un margen de gracia configurado", async () => {
    const candidate = shipment({ pickupDate: new Date("2026-09-25T00:00:00.000Z") });
    const repository = repo({ findPotentiallyPickupMissed: vi.fn().mockResolvedValue([candidate]) });
    const service = createShipmentsService(repository, createFakeUsersClient({}), undefined, undefined, {
      pickupMissedGraceHours: 1,
    });

    expect((await service.expireUnpickedAssignedShipments()).expiredCount).toBe(1);
  });

  it("sigue con el resto del lote si falla uno", async () => {
    const repository = repo({
      findPotentiallyPickupMissed: vi
        .fn()
        .mockResolvedValue([shipment({ id: "s-1" }), shipment({ id: "s-2", carrierId: null })]),
      updateStatus: vi.fn().mockRejectedValueOnce(new Error("DB")).mockResolvedValueOnce(shipment()),
    });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    expect(await service.expireUnpickedAssignedShipments()).toEqual({ expiredCount: 1, errorsCount: 1 });
  });
});

describe("expireOverduePublishedShipments con ofertas vigentes (MOVO-258, D6)", () => {
  // Retiro HOY (25/09 AR) con la franja ya cerrada (09-12): el único día en que se avisa.
  const overduePublished = shipment({
    status: ShipmentStatus.PUBLISHED,
    carrierId: null,
    pickupDate: new Date("2026-09-25T00:00:00.000Z"),
  });

  function offerRepo(pending: number): OfferRepository {
    return {
      countPendingOffersByShipmentIds: vi.fn().mockResolvedValue(new Map([["s-1", pending]])),
    } as unknown as OfferRepository;
  }

  it("no cancela un envío con ofertas vigentes y avisa al emisor una sola vez", async () => {
    const repository = repo({ findPotentiallyExpiredPublished: vi.fn().mockResolvedValue([overduePublished]) });
    const notifications = createFakeNotificationsClient();
    const claimed = new Set<string>();
    const claimNotificationOnce = vi.fn(async (key: string) => !claimed.has(key) && !!claimed.add(key));
    const service = createShipmentsService(repository, createFakeUsersClient({}), notifications, undefined, {
      offerRepository: offerRepo(2),
      claimNotificationOnce,
    });

    const first = await service.expireOverduePublishedShipments();
    await service.expireOverduePublishedShipments();

    expect(first).toEqual({ expiredCount: 0, errorsCount: 0, keptForOffersCount: 1 });
    expect(repository.updateStatus).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(claimNotificationOnce).toHaveBeenCalledTimes(2));
    expect(notifications.sendPush).toHaveBeenCalledTimes(1);
    expect(notifications.sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "sender-1", title: "Tenés ofertas para revisar" })
    );
  });

  it("no avisa si el día de retiro ya pasó (el texto dice 'hoy'), pero igual conserva el envío", async () => {
    const lateDay = shipment({
      status: ShipmentStatus.PUBLISHED,
      carrierId: null,
      pickupDate: new Date("2026-09-23T00:00:00.000Z"),
    });
    const repository = repo({ findPotentiallyExpiredPublished: vi.fn().mockResolvedValue([lateDay]) });
    const notifications = createFakeNotificationsClient();
    const claimNotificationOnce = vi.fn().mockResolvedValue(true);
    const service = createShipmentsService(repository, createFakeUsersClient({}), notifications, undefined, {
      offerRepository: offerRepo(1),
      claimNotificationOnce,
    });

    expect(await service.expireOverduePublishedShipments()).toEqual({
      expiredCount: 0,
      errorsCount: 0,
      keptForOffersCount: 1,
    });
    await Promise.resolve();
    expect(claimNotificationOnce).not.toHaveBeenCalled();
    expect(notifications.sendPush).not.toHaveBeenCalled();
  });

  it("si la push falla libera la clave de dedupe para que el próximo barrido reintente", async () => {
    const repository = repo({ findPotentiallyExpiredPublished: vi.fn().mockResolvedValue([overduePublished]) });
    const notifications = createFakeNotificationsClient();
    vi.mocked(notifications.sendPush).mockRejectedValueOnce(new Error("notifications caído"));
    const claimed = new Set<string>();
    const claimNotificationOnce = vi.fn(async (key: string) => !claimed.has(key) && !!claimed.add(key));
    const releaseNotificationClaim = vi.fn(async (key: string) => {
      claimed.delete(key);
    });
    const service = createShipmentsService(repository, createFakeUsersClient({}), notifications, undefined, {
      offerRepository: offerRepo(1),
      claimNotificationOnce,
      releaseNotificationClaim,
    });

    await service.expireOverduePublishedShipments();
    await vi.waitFor(() => expect(releaseNotificationClaim).toHaveBeenCalledWith("offers-need-review:s-1"));

    await service.expireOverduePublishedShipments();
    await vi.waitFor(() => expect(notifications.sendPush).toHaveBeenCalledTimes(2));
  });

  it("pagina con cursor: un lote lleno no deja afuera a los candidatos que vienen después", async () => {
    const page1 = [shipment({ id: "s-1", status: ShipmentStatus.PUBLISHED }), shipment({ id: "s-2", status: ShipmentStatus.PUBLISHED })];
    const page2 = [shipment({ id: "s-3", status: ShipmentStatus.PUBLISHED })];
    const findPage = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const repository = repo({ findPotentiallyExpiredPublished: findPage });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    const result = await service.expireOverduePublishedShipments(2);

    expect(findPage).toHaveBeenNthCalledWith(1, 2);
    expect(findPage).toHaveBeenNthCalledWith(2, 2, "s-2");
    expect(result.expiredCount).toBe(3);
  });

  it("cancela cuando ya no queda ninguna oferta vigente", async () => {
    const repository = repo({ findPotentiallyExpiredPublished: vi.fn().mockResolvedValue([overduePublished]) });
    const service = createShipmentsService(repository, createFakeUsersClient({}), undefined, undefined, {
      offerRepository: offerRepo(0),
    });

    expect((await service.expireOverduePublishedShipments()).expiredCount).toBe(1);
  });

  it("sin claimNotificationOnce no manda el aviso (evita repetirlo en cada vuelta)", async () => {
    const repository = repo({ findPotentiallyExpiredPublished: vi.fn().mockResolvedValue([overduePublished]) });
    const notifications = createFakeNotificationsClient();
    const service = createShipmentsService(repository, createFakeUsersClient({}), notifications, undefined, {
      offerRepository: offerRepo(1),
    });

    await service.expireOverduePublishedShipments();
    await Promise.resolve();

    expect(notifications.sendPush).not.toHaveBeenCalled();
  });
});

describe("flagAnomalousInTransitShipments (MOVO-258, D4)", () => {
  const inTransit = (overrides: Partial<Shipment> = {}) =>
    shipment({
      status: ShipmentStatus.IN_TRANSIT,
      lastStatusChangedAt: new Date("2026-09-23T13:00:00.000Z"),
      estimatedDeliveryDate: new Date("2026-09-23T00:00:00.000Z"),
      estimatedDeliveryTimeWindowEnd: "18:00:00", // umbral 24/09 01:00Z
      ...overrides,
    });

  it("marca el envío y pregunta al transportista, sin cancelarlo", async () => {
    const repository = repo({ findInTransitUnflagged: vi.fn().mockResolvedValue([inTransit()]) });
    const notifications = createFakeNotificationsClient();
    const service = createShipmentsService(repository, createFakeUsersClient({}), notifications);

    expect(await service.flagAnomalousInTransitShipments()).toEqual({ flaggedCount: 1, errorsCount: 0 });
    // El prefiltro SQL necesita el plazo fijo y el instante de la corrida.
    expect(repository.findInTransitUnflagged).toHaveBeenCalledWith(100, { now: NOW, fallbackHours: 48 });
    expect(repository.flagTransitAnomaly).toHaveBeenCalledWith("s-1", NOW);
    expect(repository.updateStatus).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(notifications.sendPush).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "carrier-1", title: "¿Todo bien con tu entrega?" })
      )
    );
  });

  it("no marca uno que todavía está dentro del plazo", async () => {
    const early = inTransit({ estimatedDeliveryDate: new Date("2026-09-26T00:00:00.000Z") });
    const repository = repo({ findInTransitUnflagged: vi.fn().mockResolvedValue([early]) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    expect((await service.flagAnomalousInTransitShipments()).flaggedCount).toBe(0);
    expect(repository.flagTransitAnomaly).not.toHaveBeenCalled();
  });

  it("no cuenta ni avisa si otra réplica ya lo había marcado", async () => {
    const repository = repo({
      findInTransitUnflagged: vi.fn().mockResolvedValue([inTransit()]),
      flagTransitAnomaly: vi.fn().mockResolvedValue(false),
    });
    const notifications = createFakeNotificationsClient();
    const service = createShipmentsService(repository, createFakeUsersClient({}), notifications);

    expect((await service.flagAnomalousInTransitShipments()).flaggedCount).toBe(0);
    expect(notifications.sendPush).not.toHaveBeenCalled();
  });

  it("sin entrega estimada usa el plazo fijo desde el retiro", async () => {
    const noEstimate = inTransit({ estimatedDeliveryDate: null, estimatedDeliveryTimeWindowEnd: null });
    // retiro 23/09 13:00Z + 48h = 25/09 13:00Z < NOW (25/09 18:00Z)
    const repository = repo({ findInTransitUnflagged: vi.fn().mockResolvedValue([noEstimate]) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    expect((await service.flagAnomalousInTransitShipments()).flaggedCount).toBe(1);
  });
});
