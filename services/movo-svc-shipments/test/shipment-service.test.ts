import { describe, it, expect, vi } from "vitest";
import { ApiError, OfferStatus, ShipmentStatus, UserRole } from "@movo/shared";
import { createShipmentsService, CreateShipmentServiceInput } from "../src/modules/shipments/shipments.service";
import { ShipmentRepository } from "../src/repositories/shipment-repository";
import { OfferRepository } from "../src/repositories/offer-repository";
import { UsersClient } from "../src/adapters/users-client";
import { NotificationsClient } from "../src/adapters/notifications-client";
import { Shipment, ShipmentEvent, PackageType } from "../src/models/shipment";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";
import { createFakeOfferRepository, fakeOffer } from "./fake-offer-repository";

/**
 * Wrapper de `createShipmentsService` para este archivo: los tests que no ejercitan
 * ofertas/notificaciones (la mayoría, preexistentes a MOVO-108) no tienen que pasar
 * esas dos dependencias nuevas a mano — usan el default (fakes no-op).
 */
function createTestShipmentsService(
  repository: ShipmentRepository,
  usersClient: UsersClient,
  offerRepository: OfferRepository = createFakeOfferRepository(),
  notificationsClient: NotificationsClient = createFakeNotificationsClient()
) {
  return createShipmentsService(repository, usersClient, offerRepository, notificationsClient);
}

function fakeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: "shipment-id",
    senderId: "sender-id",
    receiverId: "receiver-id",
    carrierId: null,
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
    deliveryLat: -31.4201,
    deliveryLng: -64.1888,
    pickupDate: new Date("2030-01-01T00:00:00.000Z"),
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 2100,
    agreedPriceArs: null,
    paymentMethod: null,
    status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
    lastStatusChangedAt: null,
    deliveredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeEvent(overrides: Partial<ShipmentEvent> = {}): ShipmentEvent {
  return {
    id: "event-id",
    shipmentId: "shipment-id",
    fromStatus: null,
    toStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
    actorId: "sender-id",
    reason: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function fakeRepository(overrides: Partial<ShipmentRepository> = {}): ShipmentRepository {
  return {
    create: vi.fn().mockResolvedValue(fakeShipment()),
    findById: vi.fn().mockResolvedValue(null),
    updateStatus: vi.fn(),
    listEvents: vi.fn(),
    addPhoto: vi.fn(),
    listPhotos: vi.fn(),
    listByUser: vi.fn(),
    ...overrides,
  };
}

// Pickup/delivery a ~1.04km entre sí (MOVO-126: ya no pueden ser el mismo punto, ver
// describe de más abajo) -> precio placeholder = 1500 base + 2kg*300 + 1.0423km*150 ≈ 2256.
const baseInput: CreateShipmentServiceInput = {
  senderId: "sender-id",
  receiverId: "receiver-id",
  packageType: PackageType.standard_package,
  weightKg: 2,
  lengthCm: 30,
  widthCm: 20,
  heightCm: 15,
  pickupAddress: "Av. Colón 1234, Córdoba",
  pickupLat: -31.4201,
  pickupLng: -64.1888,
  deliveryAddress: "Bv. San Juan 500, Córdoba",
  deliveryLat: -31.4135,
  deliveryLng: -64.181,
  pickupDate: "2030-01-01",
  pickupTimeWindowStart: "09:00",
  pickupTimeWindowEnd: "12:00",
};

describe("shipments.service — createShipment", () => {
  it("rechaza la auto-designación como receptor sin llamar al repositorio ni a svc-users", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({});
    const findPublicProfileSpy = vi.spyOn(usersClient, "findPublicProfile");
    const service = createTestShipmentsService(repository, usersClient);

    await expect(
      service.createShipment({ ...baseInput, senderId: "same-id", receiverId: "same-id" })
    ).rejects.toMatchObject({ statusCode: 422, code: "SHIPMENT_RECEIVER_IS_SENDER" });

    expect(repository.create).not.toHaveBeenCalled();
    expect(findPublicProfileSpy).not.toHaveBeenCalled();
  });

  it("rechaza una franja de retiro con fin anterior o igual al inicio", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({});
    const service = createTestShipmentsService(repository, usersClient);

    await expect(
      service.createShipment({ ...baseInput, pickupTimeWindowStart: "12:00", pickupTimeWindowEnd: "12:00" })
    ).rejects.toMatchObject({ statusCode: 422, code: "SHIPMENT_PICKUP_WINDOW_INVALID" });

    expect(repository.create).not.toHaveBeenCalled();
  });

  it("rechaza una franja de retiro en el pasado", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({});
    const service = createTestShipmentsService(repository, usersClient);

    await expect(
      service.createShipment({ ...baseInput, pickupDate: "2020-01-01", pickupTimeWindowStart: "09:00", pickupTimeWindowEnd: "10:00" })
    ).rejects.toMatchObject({ statusCode: 422, code: "SHIPMENT_PICKUP_WINDOW_IN_PAST" });

    expect(repository.create).not.toHaveBeenCalled();
  });

  it("acepta una franja de retiro futura en hora local aunque sea anterior al instante UTC actual", async () => {
    // Regresión: la hora de pared ("11:00") se ancla como si fuera UTC para persistir,
    // pero acá tiene que compararse como hora argentina real (UTC-3). "now" = 13:30 UTC
    // = 10:30 en Argentina; la franja empieza a las 11:00 ARG (14:00 UTC real) -> todavía
    // futura, aunque 11:00 (el valor anclado) sea "menor" que 13:30 en UTC naive.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T13:30:00.000Z"));
    try {
      const repository = fakeRepository();
      const usersClient = createFakeUsersClient({
        "receiver-id": fakePublicProfile({ id: "receiver-id", isVerified: true }),
      });
      const service = createTestShipmentsService(repository, usersClient);

      await expect(
        service.createShipment({ ...baseInput, pickupDate: "2030-01-01", pickupTimeWindowStart: "11:00", pickupTimeWindowEnd: "12:00" })
      ).resolves.toBeDefined();

      expect(repository.create).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("falla con 404 si el receptor no existe", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({});
    const service = createTestShipmentsService(repository, usersClient);

    await expect(service.createShipment(baseInput)).rejects.toMatchObject({
      statusCode: 404,
      code: "USER_NOT_FOUND",
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("falla con 422 si el receptor no tiene KYC de identidad aprobado", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({
      "receiver-id": fakePublicProfile({ id: "receiver-id", isVerified: false }),
    });
    const service = createTestShipmentsService(repository, usersClient);

    await expect(service.createShipment(baseInput)).rejects.toMatchObject({
      statusCode: 422,
      code: "SHIPMENT_RECEIVER_KYC_NOT_APPROVED",
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("propaga sin envolver un error de svc-users caído (502)", async () => {
    const repository = fakeRepository();
    const usersClient = {
      findPublicProfile: vi.fn().mockRejectedValue(new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "caído")),
    };
    const service = createTestShipmentsService(repository, usersClient);

    await expect(service.createShipment(baseInput)).rejects.toMatchObject({
      statusCode: 502,
      code: "USERS_SERVICE_UNAVAILABLE",
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("crea el envío con el precio placeholder calculado (happy path)", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({
      "receiver-id": fakePublicProfile({ id: "receiver-id", isVerified: true }),
    });
    const service = createTestShipmentsService(repository, usersClient);

    await service.createShipment(baseInput);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        senderId: "sender-id",
        receiverId: "receiver-id",
        suggestedPriceArs: 2256,
        pickupDate: new Date("2030-01-01T00:00:00.000Z"),
        pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
        pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      })
    );
  });

  it("rechaza retiro y entrega en exactamente la misma ubicación, sin llamar al repositorio ni a svc-users (MOVO-126)", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({});
    const findPublicProfileSpy = vi.spyOn(usersClient, "findPublicProfile");
    const service = createTestShipmentsService(repository, usersClient);

    await expect(
      service.createShipment({ ...baseInput, deliveryLat: baseInput.pickupLat, deliveryLng: baseInput.pickupLng })
    ).rejects.toMatchObject({ statusCode: 422, code: "SHIPMENT_PICKUP_DELIVERY_TOO_CLOSE" });

    expect(repository.create).not.toHaveBeenCalled();
    expect(findPublicProfileSpy).not.toHaveBeenCalled();
  });

  it("rechaza retiro y entrega a ~50m entre sí, por debajo del umbral de 100m (MOVO-126)", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({});
    const service = createTestShipmentsService(repository, usersClient);

    await expect(
      service.createShipment({ ...baseInput, deliveryLat: baseInput.pickupLat + 0.00045, deliveryLng: baseInput.pickupLng })
    ).rejects.toMatchObject({ statusCode: 422, code: "SHIPMENT_PICKUP_DELIVERY_TOO_CLOSE" });

    expect(repository.create).not.toHaveBeenCalled();
  });

  it("acepta retiro y entrega justo por encima del umbral de 100m (MOVO-126)", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({
      "receiver-id": fakePublicProfile({ id: "receiver-id", isVerified: true }),
    });
    const service = createTestShipmentsService(repository, usersClient);

    await expect(
      service.createShipment({ ...baseInput, deliveryLat: baseInput.pickupLat + 0.0011, deliveryLng: baseInput.pickupLng })
    ).resolves.toBeDefined();

    expect(repository.create).toHaveBeenCalled();
  });

  it("notifica al receptor tras crear el envío (AC1 de MOVO-108)", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({
      "receiver-id": fakePublicProfile({ id: "receiver-id", isVerified: true }),
    });
    const notificationsClient = createFakeNotificationsClient();
    const service = createTestShipmentsService(repository, usersClient, createFakeOfferRepository(), notificationsClient);

    await service.createShipment(baseInput);

    expect(notificationsClient.sendPush).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "receiver-id",
        data: { type: "shipment", shipmentId: "shipment-id" },
      })
    );
  });

  it("un fallo del cliente de notificaciones no bloquea la creación del envío (AC5)", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({
      "receiver-id": fakePublicProfile({ id: "receiver-id", isVerified: true }),
    });
    const notificationsClient = createFakeNotificationsClient({
      sendPush: vi.fn().mockRejectedValue(new Error("svc-users caído")),
    });
    const service = createTestShipmentsService(repository, usersClient, createFakeOfferRepository(), notificationsClient);

    await expect(service.createShipment(baseInput)).resolves.toBeDefined();
    expect(repository.create).toHaveBeenCalled();
  });
});

describe("shipments.service — getShipmentDetail", () => {
  it("devuelve el envío al emisor", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createTestShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentDetail(shipment.id, "sender-id", [])).resolves.toBe(shipment);
  });

  it("devuelve el envío al receptor", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createTestShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentDetail(shipment.id, "receiver-id", [])).resolves.toBe(shipment);
  });

  it("devuelve el envío a un admin ajeno al envío", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createTestShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentDetail(shipment.id, "admin-id", [UserRole.ADMIN])).resolves.toBe(shipment);
  });

  it("rechaza con 403 (no 404) a un tercero sin rol admin", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createTestShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentDetail(shipment.id, "stranger-id", [])).rejects.toMatchObject({
      statusCode: 403,
      code: "AUTH_FORBIDDEN",
    });
  });

  it("responde 404 si el envío no existe", async () => {
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(null) });
    const service = createTestShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentDetail("unknown-id", "any-id", [])).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
  });
});

describe("shipments.service — getShipmentEvents", () => {
  it("devuelve la lista de eventos al emisor", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const events = [
      fakeEvent({ shipmentId: shipment.id, fromStatus: null, toStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION }),
      fakeEvent({
        id: "event-2",
        shipmentId: shipment.id,
        fromStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
        toStatus: ShipmentStatus.PUBLISHED,
        actorId: "receiver-id",
      }),
    ];
    const repository = fakeRepository({
      findById: vi.fn().mockResolvedValue(shipment),
      listEvents: vi.fn().mockResolvedValue(events),
    });
    const service = createTestShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentEvents(shipment.id, "sender-id", [])).resolves.toBe(events);
    expect(repository.listEvents).toHaveBeenCalledWith(shipment.id);
  });

  it("devuelve la lista de eventos al receptor", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const events = [fakeEvent({ shipmentId: shipment.id })];
    const repository = fakeRepository({
      findById: vi.fn().mockResolvedValue(shipment),
      listEvents: vi.fn().mockResolvedValue(events),
    });
    const service = createTestShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentEvents(shipment.id, "receiver-id", [])).resolves.toBe(events);
    expect(repository.listEvents).toHaveBeenCalledWith(shipment.id);
  });

  it("devuelve la lista de eventos a un admin ajeno al envío", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const events = [fakeEvent({ shipmentId: shipment.id })];
    const repository = fakeRepository({
      findById: vi.fn().mockResolvedValue(shipment),
      listEvents: vi.fn().mockResolvedValue(events),
    });
    const service = createTestShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentEvents(shipment.id, "admin-id", [UserRole.ADMIN])).resolves.toBe(events);
    expect(repository.listEvents).toHaveBeenCalledWith(shipment.id);
  });

  it("rechaza con 403 (no 404) a un tercero sin rol admin", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createTestShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentEvents(shipment.id, "stranger-id", [])).rejects.toMatchObject({
      statusCode: 403,
      code: "AUTH_FORBIDDEN",
    });
    expect(repository.listEvents).not.toHaveBeenCalled();
  });

  it("responde 404 si el envío no existe", async () => {
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(null) });
    const service = createTestShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentEvents("unknown-id", "any-id", [])).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
    expect(repository.listEvents).not.toHaveBeenCalled();
  });
});

describe("shipments.service — cancelShipment (MOVO-29/MOVO-108)", () => {
  it("responde 404 si el envío no existe", async () => {
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(null) });
    const service = createTestShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.cancelShipment("unknown-id", "sender-id")).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it("rechaza con 403 a quien no sea el emisor (ni el receptor ni un tercero)", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id", status: ShipmentStatus.PUBLISHED });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createTestShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.cancelShipment(shipment.id, "receiver-id")).rejects.toMatchObject({
      statusCode: 403,
      code: "AUTH_FORBIDDEN",
    });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it("rechaza con 409 SHIPMENT_CANCELLATION_PENALTY_NOT_SUPPORTED cancelar desde assigned", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", status: ShipmentStatus.ASSIGNED });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createTestShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.cancelShipment(shipment.id, "sender-id")).rejects.toMatchObject({
      statusCode: 409,
      code: "SHIPMENT_CANCELLATION_PENALTY_NOT_SUPPORTED",
    });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it("cancela desde awaiting_receiver_confirmation sin consultar ofertas (no puede tener ninguna)", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION });
    const cancelled = { ...shipment, status: ShipmentStatus.CANCELLED };
    const repository = fakeRepository({
      findById: vi.fn().mockResolvedValue(shipment),
      updateStatus: vi.fn().mockResolvedValue(cancelled),
    });
    const offerRepository = createFakeOfferRepository();
    const service = createTestShipmentsService(repository, createFakeUsersClient({}), offerRepository);

    await expect(service.cancelShipment(shipment.id, "sender-id", "me equivoqué")).resolves.toBe(cancelled);

    expect(repository.updateStatus).toHaveBeenCalledWith(
      shipment.id,
      ShipmentStatus.CANCELLED,
      "sender-id",
      "me equivoqué"
    );
    expect(offerRepository.listByShipment).not.toHaveBeenCalled();
  });

  it.each([ShipmentStatus.PUBLISHED, ShipmentStatus.ASSIGNMENT_PENDING])(
    "cancelar desde %s notifica solo a los transportistas con oferta pending (AC7)",
    async (status) => {
      const shipment = fakeShipment({ id: "shipment-1", senderId: "sender-id", status });
      const cancelled = { ...shipment, status: ShipmentStatus.CANCELLED };
      const repository = fakeRepository({
        findById: vi.fn().mockResolvedValue(shipment),
        updateStatus: vi.fn().mockResolvedValue(cancelled),
      });
      const offers = [
        fakeOffer({ id: "offer-pending-1", shipmentId: shipment.id, carrierId: "carrier-1", status: OfferStatus.PENDING }),
        fakeOffer({ id: "offer-pending-2", shipmentId: shipment.id, carrierId: "carrier-2", status: OfferStatus.PENDING }),
        fakeOffer({ id: "offer-rejected", shipmentId: shipment.id, carrierId: "carrier-3", status: OfferStatus.REJECTED }),
      ];
      const offerRepository = createFakeOfferRepository({ listByShipment: vi.fn().mockResolvedValue(offers) });
      const notificationsClient = createFakeNotificationsClient();
      const service = createTestShipmentsService(
        repository,
        createFakeUsersClient({}),
        offerRepository,
        notificationsClient
      );

      await service.cancelShipment(shipment.id, "sender-id");

      expect(offerRepository.listByShipment).toHaveBeenCalledWith(shipment.id);
      expect(notificationsClient.sendPush).toHaveBeenCalledTimes(2);
      expect(notificationsClient.sendPush).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "carrier-1", data: { type: "shipment", shipmentId: shipment.id } })
      );
      expect(notificationsClient.sendPush).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "carrier-2", data: { type: "shipment", shipmentId: shipment.id } })
      );
      expect(notificationsClient.sendPush).not.toHaveBeenCalledWith(expect.objectContaining({ userId: "carrier-3" }));
    }
  );

  it("un fallo del cliente de notificaciones no bloquea la cancelación", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", status: ShipmentStatus.PUBLISHED });
    const cancelled = { ...shipment, status: ShipmentStatus.CANCELLED };
    const repository = fakeRepository({
      findById: vi.fn().mockResolvedValue(shipment),
      updateStatus: vi.fn().mockResolvedValue(cancelled),
    });
    const offerRepository = createFakeOfferRepository({
      listByShipment: vi
        .fn()
        .mockResolvedValue([fakeOffer({ shipmentId: shipment.id, carrierId: "carrier-1", status: OfferStatus.PENDING })]),
    });
    const notificationsClient = createFakeNotificationsClient({
      sendPush: vi.fn().mockRejectedValue(new Error("svc-users caído")),
    });
    const service = createTestShipmentsService(
      repository,
      createFakeUsersClient({}),
      offerRepository,
      notificationsClient
    );

    await expect(service.cancelShipment(shipment.id, "sender-id")).resolves.toBe(cancelled);
  });
});
