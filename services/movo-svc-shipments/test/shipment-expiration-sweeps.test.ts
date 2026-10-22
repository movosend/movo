import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ShipmentStatus } from "@movo/shared";
import { createShipmentsService } from "../src/modules/shipments/shipments.service";
import { ShipmentConcurrentModificationError, ShipmentRepository } from "../src/repositories/shipment-repository";
import { OfferRepository } from "../src/repositories/offer-repository";
import { Shipment, PackageType } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";
import { PickupEvidenceRepository } from "../src/repositories/pickup-evidence-repository";
import { PickupEvidenceSummary } from "../src/domain/pickup-attribution";
import { TripStatus } from "@movo/shared";

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
    transitAnomalyWarnedAt: null,
    cancellationPenaltyArs: null,
    cancellationPenaltyStatus: null,
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
    findFlaggedInTransitUnwarned: vi.fn().mockResolvedValue([]),
    markTransitAnomalyWarned: vi.fn().mockResolvedValue(true),
    findFlaggedInTransitBefore: vi.fn().mockResolvedValue([]),
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

    expect(result).toEqual({ expiredCount: 1, disputedCount: 0, errorsCount: 0 });
    expect(repository.findPotentiallyPickupMissed).toHaveBeenCalledWith(50);
    expect(repository.updateStatus).toHaveBeenCalledWith(
      "s-1",
      ShipmentStatus.CANCELLED,
      null,
      "El retiro no se realizó dentro del plazo (ventana de retiro más margen de gracia)",
      { expectedFrom: overdue.status, pickupMiss: { attribution: "none", carrierPenaltyArs: 0 } }
    );
    await vi.waitFor(() => expect(notifications.sendPush).toHaveBeenCalledTimes(3));
    const recipients = (notifications.sendPush as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].userId);
    expect(recipients.sort()).toEqual(["carrier-1", "receiver-1", "sender-1"]);
  });

  it("no cancela dentro del margen de gracia", async () => {
    const inGrace = shipment({ pickupDate: new Date("2026-09-25T00:00:00.000Z") }); // cierra hoy 12:00 AR
    const repository = repo({ findPotentiallyPickupMissed: vi.fn().mockResolvedValue([inGrace]) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    expect(await service.expireUnpickedAssignedShipments()).toEqual({ expiredCount: 0, disputedCount: 0, errorsCount: 0 });
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

    expect(await service.expireUnpickedAssignedShipments()).toEqual({ expiredCount: 1, disputedCount: 0, errorsCount: 1 });
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

describe("salida del in_transit demorado (MOVO-278, ADR-045)", () => {
  // NOW = 25/09 18:00Z. Marcado hace 13h: pasó el aviso (12h), no la disputa (24h).
  const flagged = (hoursAgo: number, overrides: Partial<Shipment> = {}) =>
    shipment({
      status: ShipmentStatus.IN_TRANSIT,
      transitAnomalyFlaggedAt: new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000),
      ...overrides,
    });

  describe("warnFlaggedInTransitShipments (AC8)", () => {
    it("avisa una vez al transportista pasado el plazo de aviso, marcando antes de mandar la push", async () => {
      const repository = repo({ findFlaggedInTransitUnwarned: vi.fn().mockResolvedValue([flagged(13)]) });
      const notifications = createFakeNotificationsClient();
      const service = createShipmentsService(repository, createFakeUsersClient({}), notifications);

      expect(await service.warnFlaggedInTransitShipments()).toEqual({ warnedCount: 1, errorsCount: 0 });
      // El cutoff es NOW - 12h (default).
      expect(repository.findFlaggedInTransitUnwarned).toHaveBeenCalledWith(
        100,
        new Date("2026-09-25T06:00:00.000Z")
      );
      expect(repository.markTransitAnomalyWarned).toHaveBeenCalledWith("s-1", NOW);
      expect(repository.updateStatus).not.toHaveBeenCalled();
      await vi.waitFor(() =>
        expect(notifications.sendPush).toHaveBeenCalledWith(
          expect.objectContaining({ userId: "carrier-1", category: "shipments", title: "Confirmá la entrega" })
        )
      );
    });

    it("no avisa si otra réplica ya lo marcó o el envío dejó de estar in_transit", async () => {
      const repository = repo({
        findFlaggedInTransitUnwarned: vi.fn().mockResolvedValue([flagged(13)]),
        markTransitAnomalyWarned: vi.fn().mockResolvedValue(false),
      });
      const notifications = createFakeNotificationsClient();
      const service = createShipmentsService(repository, createFakeUsersClient({}), notifications);

      expect((await service.warnFlaggedInTransitShipments()).warnedCount).toBe(0);
      expect(notifications.sendPush).not.toHaveBeenCalled();
    });

    it("si la push falla loguea un evento propio y el aviso queda marcado (no se reintenta)", async () => {
      const repository = repo({ findFlaggedInTransitUnwarned: vi.fn().mockResolvedValue([flagged(13)]) });
      const notifications = createFakeNotificationsClient();
      (notifications.sendPush as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("push caída"));
      const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
      const service = createShipmentsService(
        repository,
        createFakeUsersClient({}),
        notifications,
        logger as never
      );

      expect((await service.warnFlaggedInTransitShipments()).warnedCount).toBe(1);

      await vi.waitFor(() =>
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ event: "transit_anomaly_warning_push_failed", shipmentId: "s-1" }),
          expect.any(String)
        )
      );
    });

    it("respeta el plazo configurado", async () => {
      const repository = repo({ findFlaggedInTransitUnwarned: vi.fn().mockResolvedValue([flagged(13)]) });
      const service = createShipmentsService(repository, createFakeUsersClient({}), undefined, undefined, {
        transitAnomalyWarnAfterHours: 14,
      });

      expect((await service.warnFlaggedInTransitShipments()).warnedCount).toBe(0);
      expect(repository.markTransitAnomalyWarned).not.toHaveBeenCalled();
    });
  });

  describe("disputeOverdueFlaggedShipments (AC3)", () => {
    const warned = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000);

    it("pasa a disputed sin actor, con motivo y expectedFrom in_transit, y avisa a las tres partes", async () => {
      const repository = repo({
        findFlaggedInTransitBefore: vi
          .fn()
          .mockResolvedValue([flagged(25, { transitAnomalyWarnedAt: warned(13) })]),
      });
      const notifications = createFakeNotificationsClient();
      const service = createShipmentsService(repository, createFakeUsersClient({}), notifications);

      expect(await service.disputeOverdueFlaggedShipments()).toEqual({ disputedCount: 1, errorsCount: 0 });
      // Marcado hace 24h Y avisado hace 12h (dispute - warn): las horas que prometió la push.
      expect(repository.findFlaggedInTransitBefore).toHaveBeenCalledWith(
        100,
        new Date("2026-09-24T18:00:00.000Z"),
        new Date("2026-09-25T06:00:00.000Z")
      );
      expect(repository.updateStatus).toHaveBeenCalledWith(
        "s-1",
        ShipmentStatus.DISPUTED,
        null,
        expect.stringContaining("no se confirmó"),
        { expectedFrom: ShipmentStatus.IN_TRANSIT }
      );
      await vi.waitFor(() => expect(notifications.sendPush).toHaveBeenCalledTimes(3));
      const userIds = (notifications.sendPush as ReturnType<typeof vi.fn>).mock.calls.map(([input]) => input.userId);
      expect(userIds.sort()).toEqual(["carrier-1", "receiver-1", "sender-1"]);
    });

    it("no toca un envío marcado hace menos del plazo", async () => {
      const repository = repo({
        findFlaggedInTransitBefore: vi
          .fn()
          .mockResolvedValue([flagged(23, { transitAnomalyWarnedAt: warned(13) })]),
      });
      const service = createShipmentsService(repository, createFakeUsersClient({}));

      expect((await service.disputeOverdueFlaggedShipments()).disputedCount).toBe(0);
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });

    it("no disputa si el aviso es más reciente que el plazo prometido (backfill o barrido caído)", async () => {
      const repository = repo({
        findFlaggedInTransitBefore: vi
          .fn()
          .mockResolvedValue([flagged(30, { transitAnomalyWarnedAt: warned(0) }), flagged(30, { id: "s-2" })]),
      });
      const service = createShipmentsService(repository, createFakeUsersClient({}));

      expect(await service.disputeOverdueFlaggedShipments()).toEqual({ disputedCount: 0, errorsCount: 0 });
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });

    it("espera las pushes antes de seguir con el próximo candidato", async () => {
      const order: string[] = [];
      const repository = repo({
        findFlaggedInTransitBefore: vi.fn().mockResolvedValue([
          flagged(25, { transitAnomalyWarnedAt: warned(13) }),
          flagged(26, { id: "s-2", transitAnomalyWarnedAt: warned(13) }),
        ]),
        updateStatus: vi.fn().mockImplementation(async (id: string) => {
          order.push(`status:${id}`);
        }),
      });
      const notifications = createFakeNotificationsClient();
      (notifications.sendPush as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        // Microtareas, no `setTimeout`: este archivo usa timers falsos.
        for (let i = 0; i < 20; i++) await Promise.resolve();
        order.push("push");
      });
      const service = createShipmentsService(repository, createFakeUsersClient({}), notifications);

      await service.disputeOverdueFlaggedShipments();

      // Las 3 pushes del primer envío terminan antes de la transición del segundo.
      expect(order).toEqual(["status:s-1", "push", "push", "push", "status:s-2", "push", "push", "push"]);
    });

    it("una entrega concurrente gana: el conflicto no cuenta como error ni avisa (AC6)", async () => {
      const repository = repo({
        findFlaggedInTransitBefore: vi
          .fn()
          .mockResolvedValue([flagged(25, { transitAnomalyWarnedAt: warned(13) })]),
        updateStatus: vi.fn().mockRejectedValue(new ShipmentConcurrentModificationError("s-1")),
      });
      const notifications = createFakeNotificationsClient();
      const service = createShipmentsService(repository, createFakeUsersClient({}), notifications);

      expect(await service.disputeOverdueFlaggedShipments()).toEqual({ disputedCount: 0, errorsCount: 0 });
      expect(notifications.sendPush).not.toHaveBeenCalled();
    });

    it("cualquier otro error cuenta y no frena al resto del lote", async () => {
      const repository = repo({
        findFlaggedInTransitBefore: vi.fn().mockResolvedValue([
          flagged(25, { transitAnomalyWarnedAt: warned(13) }),
          flagged(26, { id: "s-2", transitAnomalyWarnedAt: warned(13) }),
        ]),
        updateStatus: vi.fn().mockRejectedValueOnce(new Error("db")).mockResolvedValueOnce(undefined),
      });
      const service = createShipmentsService(repository, createFakeUsersClient({}));

      expect(await service.disputeOverdueFlaggedShipments()).toEqual({ disputedCount: 1, errorsCount: 1 });
    });
  });
});

describe("expireUnpickedAssignedShipments: atribución del no-retiro (MOVO-270, ADR-052)", () => {
  const assigned = () => shipment({ status: ShipmentStatus.ASSIGNED, agreedPriceArs: 1000 });

  function evidenceRepo(summary: PickupEvidenceSummary | null): PickupEvidenceRepository {
    return { record: vi.fn(), find: vi.fn().mockResolvedValue(summary) };
  }

  function setup(options: {
    trip: { status: TripStatus; startedAt: Date | null } | null;
    evidence: PickupEvidenceSummary | null;
    ratingInvite?: boolean;
  }) {
    const repository = repo({
      findPotentiallyPickupMissed: vi.fn().mockResolvedValue([assigned()]),
      findAcceptedOfferTrip: vi.fn().mockResolvedValue({
        offerId: "offer-1",
        trip: options.trip ? { id: "trip-1", ...options.trip } : null,
      }),
    });
    const notifications = createFakeNotificationsClient();
    const paymentsClient = { releaseHold: vi.fn().mockResolvedValue(undefined) };
    const registerWithdrawalPenalty = vi.fn().mockResolvedValue("debt");
    const service = createShipmentsService(repository, createFakeUsersClient({}), notifications, undefined, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- solo se usa `releaseHold`
      paymentsClient: paymentsClient as any,
      pickupEvidenceRepository: evidenceRepo(options.evidence),
      registerWithdrawalPenalty,
      pickupNoShowRatingInviteEnabled: options.ratingInvite ?? false,
    });
    return { service, repository, notifications, paymentsClient, registerWithdrawalPenalty };
  }

  const noEvidence: PickupEvidenceSummary = { arrivedAt: null, farPositionsInWindow: 0, grayPositionsInWindow: 0 };

  it("AC8: viaje nunca iniciado -> cancela atribuido al transportista, con la penalidad de baja", async () => {
    const { service, repository, paymentsClient, registerWithdrawalPenalty, notifications } = setup({
      trip: { status: TripStatus.DECLARED, startedAt: null },
      evidence: null,
    });

    expect(await service.expireUnpickedAssignedShipments()).toEqual({ expiredCount: 1, disputedCount: 0, errorsCount: 0 });
    expect(paymentsClient.releaseHold).toHaveBeenCalledWith("s-1");
    expect(repository.updateStatus).toHaveBeenCalledWith(
      "s-1",
      ShipmentStatus.CANCELLED,
      null,
      expect.stringContaining("no se presentó"),
      { expectedFrom: ShipmentStatus.ASSIGNED, pickupMiss: { attribution: "carrier", carrierPenaltyArs: 250 } }
    );
    expect(registerWithdrawalPenalty).toHaveBeenCalledWith("offer-1");
    await vi.waitFor(() => expect(notifications.sendPush).toHaveBeenCalledTimes(3));
    const toSender = (notifications.sendPush as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0].userId === "sender-1")![0];
    expect(toSender.body).toContain("no se presentó");
    expect(toSender.data.rateCarrier).toBeUndefined();
  });

  it("AC8: 3 posiciones lejanas sin zona gris -> no llegó; AC12: con el flag invita a calificar", async () => {
    const { service, repository, notifications } = setup({
      trip: { status: TripStatus.ACTIVE, startedAt: new Date("2026-09-23T10:00:00.000Z") },
      evidence: { ...noEvidence, farPositionsInWindow: 3 },
      ratingInvite: true,
    });

    await service.expireUnpickedAssignedShipments();

    expect(vi.mocked(repository.updateStatus).mock.calls[0][4]).toMatchObject({ pickupMiss: { attribution: "carrier" } });
    await vi.waitFor(() => expect(notifications.sendPush).toHaveBeenCalledTimes(3));
    const toSender = (notifications.sendPush as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0].userId === "sender-1")![0];
    expect(toSender.data.rateCarrier).toBe(true);
  });

  it("AC9: llegó y no hubo handshake -> libera el hold y pasa a disputa, sin cobrar nada", async () => {
    const { service, repository, paymentsClient, registerWithdrawalPenalty, notifications } = setup({
      trip: { status: TripStatus.ACTIVE, startedAt: new Date("2026-09-23T10:00:00.000Z") },
      evidence: { ...noEvidence, arrivedAt: new Date("2026-09-23T13:30:00.000Z") },
    });

    expect(await service.expireUnpickedAssignedShipments()).toEqual({ expiredCount: 0, disputedCount: 1, errorsCount: 0 });
    expect(paymentsClient.releaseHold).toHaveBeenCalledWith("s-1");
    expect(repository.updateStatus).toHaveBeenCalledWith("s-1", ShipmentStatus.DISPUTED, null, expect.any(String), {
      expectedFrom: ShipmentStatus.ASSIGNED,
    });
    expect(registerWithdrawalPenalty).not.toHaveBeenCalled();
    expect(notifications.sendPush).toHaveBeenCalledTimes(3);
  });

  it("AC9: si no se puede liberar el hold no transiciona (se reintenta en la próxima corrida)", async () => {
    const { service, repository, paymentsClient } = setup({
      trip: { status: TripStatus.ACTIVE, startedAt: new Date("2026-09-23T10:00:00.000Z") },
      evidence: { ...noEvidence, arrivedAt: new Date("2026-09-23T13:30:00.000Z") },
    });
    paymentsClient.releaseHold.mockRejectedValueOnce(new Error("payments caído"));

    expect(await service.expireUnpickedAssignedShipments()).toEqual({ expiredCount: 0, disputedCount: 0, errorsCount: 1 });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["viaje activo sin posiciones", { status: TripStatus.ACTIVE, startedAt: new Date("2026-09-23T10:00:00.000Z") }, noEvidence],
    ["una posición en zona gris", { status: TripStatus.ACTIVE, startedAt: new Date("2026-09-23T10:00:00.000Z") }, { ...noEvidence, farPositionsInWindow: 5, grayPositionsInWindow: 1 }],
    ["viaje iniciado antes de MOVO-270 (startedAt null)", { status: TripStatus.ACTIVE, startedAt: null }, noEvidence],
  ])("AC10: %s -> sin evidencia, cancela sin culpables", async (_label, trip, evidence) => {
    const { service, repository, registerWithdrawalPenalty } = setup({ trip, evidence });

    await service.expireUnpickedAssignedShipments();

    expect(vi.mocked(repository.updateStatus).mock.calls[0][4]).toMatchObject({
      pickupMiss: { attribution: "none", carrierPenaltyArs: 0 },
    });
    expect(registerWithdrawalPenalty).not.toHaveBeenCalled();
  });

  it("un retiro concurrente gana: el envío se saltea sin contar como error", async () => {
    const { service, repository } = setup({
      trip: { status: TripStatus.ACTIVE, startedAt: new Date("2026-09-23T10:00:00.000Z") },
      evidence: { ...noEvidence, arrivedAt: new Date("2026-09-23T13:30:00.000Z") },
    });
    vi.mocked(repository.updateStatus).mockRejectedValueOnce(new ShipmentConcurrentModificationError("s-1"));

    expect(await service.expireUnpickedAssignedShipments()).toEqual({ expiredCount: 0, disputedCount: 0, errorsCount: 0 });
  });
});
