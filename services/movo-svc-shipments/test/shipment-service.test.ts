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
import { createFakePricingClient } from "./fake-pricing-client";
import { PricingClient } from "../src/adapters/pricing-client";

/**
 * Wrapper de `createShipmentsService` para este archivo: los tests que no ejercitan
 * ofertas/notificaciones/pricing (la mayoría, preexistentes a MOVO-108/82) no tienen
 * que pasar esas dependencias nuevas a mano — usan el default (fakes no-op/deterministas).
 * `offerRepository`/`pricingClient` viajan en `opts` (no como parámetros posicionales
 * propios) porque `createShipmentsService` también lo usan MOVO-129/130, que nunca los
 * necesitan.
 */
function createTestShipmentsService(
  repository: ShipmentRepository,
  usersClient: UsersClient,
  offerRepository: OfferRepository = createFakeOfferRepository(),
  notificationsClient: NotificationsClient = createFakeNotificationsClient(),
  pricingClient: PricingClient = createFakePricingClient()
) {
  return createShipmentsService(repository, usersClient, notificationsClient, undefined, {
    offerRepository,
    pricingClient,
  });
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
    calculationMethod: "euclidean_linear_v1",
    agreedPriceArs: null,
    paymentMethod: null,
    status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
    lastStatusChangedAt: null,
    deliveredAt: null,
    receiverConfirmationDeadline: null,
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
    findExpiredAwaitingConfirmation: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

// Pickup/delivery a ~1.04km entre sí (MOVO-126: ya no pueden ser el mismo punto, ver
// describe de más abajo). El precio ya no lo calcula este servicio (MOVO-82) --
// `createTestShipmentsService` inyecta `createFakePricingClient()` por default, que
// devuelve un `suggestedPriceArs` fijo (2256) sin llamar a ningún servicio real.
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

  it("crea el envío con el precio sugerido que devuelve pricingClient (happy path, MOVO-82)", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({
      "receiver-id": fakePublicProfile({ id: "receiver-id", isVerified: true }),
    });
    const pricingClient = createFakePricingClient();
    const service = createTestShipmentsService(repository, usersClient, undefined, undefined, pricingClient);

    await service.createShipment(baseInput);

    expect(pricingClient.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        weightKg: baseInput.weightKg,
        lengthCm: baseInput.lengthCm,
        widthCm: baseInput.widthCm,
        heightCm: baseInput.heightCm,
        packageType: baseInput.packageType,
        originLat: baseInput.pickupLat,
        originLng: baseInput.pickupLng,
        destinationLat: baseInput.deliveryLat,
        destinationLng: baseInput.deliveryLng,
      })
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        senderId: "sender-id",
        receiverId: "receiver-id",
        suggestedPriceArs: 2256,
        calculationMethod: "euclidean_linear_v1",
        pickupDate: new Date("2030-01-01T00:00:00.000Z"),
        pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
        pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      })
    );
  });

  it("crea el envío con 'precio a estimar' si pricingClient falla (fallback, AC6 de MOVO-82)", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({
      "receiver-id": fakePublicProfile({ id: "receiver-id", isVerified: true }),
    });
    // Mismo contrato que el cliente real (pricing-client.ts) ante una falla real: nunca
    // rechaza, resuelve al fallback -- acá se simula directo el resultado ya resuelto.
    const pricingClient = createFakePricingClient({
      getQuote: vi.fn().mockResolvedValue({ suggestedPriceArs: null, calculationMethod: null }),
    });
    const service = createTestShipmentsService(repository, usersClient, undefined, undefined, pricingClient);

    await expect(service.createShipment(baseInput)).resolves.toBeDefined();

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedPriceArs: null, calculationMethod: null })
    );
  });

  it("crea el envío con 'precio a estimar' si no hay pricingClient inyectado (AC6 de MOVO-82)", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({
      "receiver-id": fakePublicProfile({ id: "receiver-id", isVerified: true }),
    });
    const service = createShipmentsService(repository, usersClient, undefined, undefined, {
      offerRepository: createFakeOfferRepository(),
    });

    await expect(service.createShipment(baseInput)).resolves.toBeDefined();

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedPriceArs: null, calculationMethod: null })
    );
  });

  it("asigna receiverConfirmationDeadline = now + timeout cuando la ventana de retiro es más lejana (MOVO-130 fix)", async () => {
    // baseInput tiene pickupDate "2030-01-01" con fin de ventana a las 12:00 UTC,
    // muy por encima de now + 24hs (2026) → gana el timeout.
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({
      "receiver-id": fakePublicProfile({ id: "receiver-id", isVerified: true }),
    });
    const service = createShipmentsService(repository, usersClient, undefined, undefined, {
      receiverConfirmationTimeoutHours: 24,
    });

    const before = Date.now();
    await service.createShipment(baseInput);
    const after = Date.now();

    const callArg = (repository.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const deadline: number = callArg.receiverConfirmationDeadline.getTime();
    expect(deadline).toBeGreaterThanOrEqual(before + 24 * 3600 * 1000);
    expect(deadline).toBeLessThanOrEqual(after + 24 * 3600 * 1000);
  });

  it("asigna receiverConfirmationDeadline = cierre de ventana de retiro cuando es anterior al timeout (MOVO-130 fix)", async () => {
    // Simula un envío creado hoy con retiro mañana a las 10:00 hora local argentina.
    // Con timeout de 48hs, el cierre de ventana (mañana 10:00 ART) gana sobre now + 48hs.
    vi.useFakeTimers();
    const now = new Date("2026-08-22T12:00:00.000Z");
    vi.setSystemTime(now);
    try {
      const repository = fakeRepository();
      const usersClient = createFakeUsersClient({
        "receiver-id": fakePublicProfile({ id: "receiver-id", isVerified: true }),
      });
      const service = createShipmentsService(repository, usersClient, undefined, undefined, {
        receiverConfirmationTimeoutHours: 48,
      });

      // Retiro: mañana 2026-08-23, ventana 09:00–10:00 hora local argentina
      await service.createShipment({
        ...baseInput,
        pickupDate: "2026-08-23",
        pickupTimeWindowStart: "09:00",
        pickupTimeWindowEnd: "10:00",
      });

      const callArg = (repository.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const deadline: Date = callArg.receiverConfirmationDeadline;

      // El deadline esperado es el instante real del cierre de ventana: 10:00 en
      // Argentina (UTC-3) es 2026-08-23T13:00:00.000Z, no 10:00Z.
      const expectedDeadline = new Date("2026-08-23T13:00:00.000Z");
      expect(deadline.getTime()).toBe(expectedDeadline.getTime());
    } finally {
      vi.useRealTimers();
    }
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

describe("shipments.service — shipment interactions (events, accept, reject)", () => {
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

  it("rechaza con 403 (no 404) a un tercero sin rol admin (events)", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createTestShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentEvents(shipment.id, "stranger-id", [])).rejects.toMatchObject({
      statusCode: 403,
      code: "AUTH_FORBIDDEN",
    });
    expect(repository.listEvents).not.toHaveBeenCalled();
  });

  it("responde 404 si el envío no existe (events)", async () => {
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(null) });
    const service = createTestShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentEvents("unknown-id", "any-id", [])).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
    expect(repository.listEvents).not.toHaveBeenCalled();
  });

  it("el receptor puede aceptar el envío y dispara push notification al emisor", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const updatedShipment = fakeShipment({ ...shipment, status: ShipmentStatus.PUBLISHED });
    const repository = fakeRepository({
      findById: vi.fn().mockResolvedValue(shipment),
      updateStatus: vi.fn().mockResolvedValue(updatedShipment),
    });
    const usersClient = createFakeUsersClient({
      "receiver-id": fakePublicProfile({ id: "receiver-id", fullName: "María" }),
    });
    const notificationsClient = createFakeNotificationsClient();
    const service = createShipmentsService(repository, usersClient, notificationsClient);

    const result = await service.acceptShipment(shipment.id, "receiver-id");

    expect(result.status).toBe(ShipmentStatus.PUBLISHED);
    expect(repository.updateStatus).toHaveBeenCalledWith(shipment.id, ShipmentStatus.PUBLISHED, "receiver-id");
    await vi.waitFor(() => {
      expect(notificationsClient.sendPush).toHaveBeenCalledWith({
        userId: "sender-id",
        title: "Envío aceptado",
        body: "María aceptó el envío, ya está publicado",
        data: { shipmentId: shipment.id, type: "shipment_accepted" },
      });
    });
  });

  it("el emisor recibe 403 al intentar aceptar", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.acceptShipment(shipment.id, "sender-id")).rejects.toMatchObject({
      statusCode: 403,
      code: "AUTH_FORBIDDEN",
    });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it("un admin recibe 403 al intentar aceptar", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.acceptShipment(shipment.id, "admin-id")).rejects.toMatchObject({
      statusCode: 403,
      code: "AUTH_FORBIDDEN",
    });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it("un tercero recibe 403 al intentar aceptar", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.acceptShipment(shipment.id, "stranger-id")).rejects.toMatchObject({
      statusCode: 403,
      code: "AUTH_FORBIDDEN",
    });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it("responde 404 si el envío no existe al aceptar", async () => {
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(null) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.acceptShipment("unknown-id", "receiver-id")).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it("si la notificación push falla, la aceptación se completa igual (best-effort)", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const updatedShipment = fakeShipment({ ...shipment, status: ShipmentStatus.PUBLISHED });
    const repository = fakeRepository({
      findById: vi.fn().mockResolvedValue(shipment),
      updateStatus: vi.fn().mockResolvedValue(updatedShipment),
    });
    const usersClient = createFakeUsersClient({});
    const notificationsClient = createFakeNotificationsClient({
      sendPush: vi.fn().mockRejectedValue(new Error("Push service down")),
    });
    const service = createShipmentsService(repository, usersClient, notificationsClient);

    const result = await service.acceptShipment(shipment.id, "receiver-id");
    expect(result.status).toBe(ShipmentStatus.PUBLISHED);
    expect(repository.updateStatus).toHaveBeenCalledWith(shipment.id, ShipmentStatus.PUBLISHED, "receiver-id");
  });

  it("falla con 409 si la deadline de confirmación del receptor ya expiró (MOVO-130 AC5)", async () => {
    const expiredDeadline = new Date(Date.now() - 60_000);
    const shipment = fakeShipment({
      senderId: "sender-id",
      receiverId: "receiver-id",
      receiverConfirmationDeadline: expiredDeadline,
    });
    const repository = fakeRepository({
      findById: vi.fn().mockResolvedValue(shipment),
    });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.acceptShipment(shipment.id, "receiver-id")).rejects.toMatchObject({
      statusCode: 409,
      code: "SHIPMENT_RECEIVER_CONFIRMATION_EXPIRED",
    });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it("si el envío ya no está en awaiting_receiver_confirmation, no lanza error de expiración aunque la deadline haya vencido", async () => {
    const expiredDeadline = new Date(Date.now() - 60_000);
    const shipment = fakeShipment({
      senderId: "sender-id",
      receiverId: "receiver-id",
      status: ShipmentStatus.PUBLISHED,
      receiverConfirmationDeadline: expiredDeadline,
    });
    const repository = fakeRepository({
      findById: vi.fn().mockResolvedValue(shipment),
      updateStatus: vi.fn().mockRejectedValue(new Error("Transición inválida")),
    });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.acceptShipment(shipment.id, "receiver-id")).rejects.toThrow("Transición inválida");
    expect(repository.updateStatus).toHaveBeenCalledWith(shipment.id, ShipmentStatus.PUBLISHED, "receiver-id");
  });

  it("el receptor puede rechazar el envío con motivo y dispara push notification al emisor", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const updatedShipment = fakeShipment({ ...shipment, status: ShipmentStatus.REJECTED_BY_RECEIVER });
    const repository = fakeRepository({
      findById: vi.fn().mockResolvedValue(shipment),
      updateStatus: vi.fn().mockResolvedValue(updatedShipment),
    });
    const usersClient = createFakeUsersClient({
      "receiver-id": fakePublicProfile({ id: "receiver-id", fullName: "Carlos" }),
    });
    const notificationsClient = createFakeNotificationsClient();
    const service = createShipmentsService(repository, usersClient, notificationsClient);

    const result = await service.rejectShipment(shipment.id, "receiver-id", "No lo pedí");

    expect(result.status).toBe(ShipmentStatus.REJECTED_BY_RECEIVER);
    expect(repository.updateStatus).toHaveBeenCalledWith(
      shipment.id,
      ShipmentStatus.REJECTED_BY_RECEIVER,
      "receiver-id",
      "No lo pedí"
    );
    await vi.waitFor(() => {
      expect(notificationsClient.sendPush).toHaveBeenCalledWith({
        userId: "sender-id",
        title: "Envío rechazado",
        body: "Carlos rechazó el envío",
        data: { shipmentId: shipment.id, type: "shipment_rejected" },
      });
    });
  });

  it("el receptor puede rechazar el envío sin motivo", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const updatedShipment = fakeShipment({ ...shipment, status: ShipmentStatus.REJECTED_BY_RECEIVER });
    const repository = fakeRepository({
      findById: vi.fn().mockResolvedValue(shipment),
      updateStatus: vi.fn().mockResolvedValue(updatedShipment),
    });
    const usersClient = createFakeUsersClient({});
    const notificationsClient = createFakeNotificationsClient();
    const service = createShipmentsService(repository, usersClient, notificationsClient);

    const result = await service.rejectShipment(shipment.id, "receiver-id");

    expect(result.status).toBe(ShipmentStatus.REJECTED_BY_RECEIVER);
    expect(repository.updateStatus).toHaveBeenCalledWith(
      shipment.id,
      ShipmentStatus.REJECTED_BY_RECEIVER,
      "receiver-id",
      undefined
    );
  });

  it("falla con 409 si la deadline de confirmación del receptor ya expiró al rechazar (MOVO-130 AC5)", async () => {
    const expiredDeadline = new Date(Date.now() - 60_000);
    const shipment = fakeShipment({
      senderId: "sender-id",
      receiverId: "receiver-id",
      receiverConfirmationDeadline: expiredDeadline,
    });
    const repository = fakeRepository({
      findById: vi.fn().mockResolvedValue(shipment),
    });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.rejectShipment(shipment.id, "receiver-id")).rejects.toMatchObject({
      statusCode: 409,
      code: "SHIPMENT_RECEIVER_CONFIRMATION_EXPIRED",
    });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it("si el envío ya no está en awaiting_receiver_confirmation al rechazar, no lanza error de expiración aunque la deadline haya vencido", async () => {
    const expiredDeadline = new Date(Date.now() - 60_000);
    const shipment = fakeShipment({
      senderId: "sender-id",
      receiverId: "receiver-id",
      status: ShipmentStatus.PUBLISHED,
      receiverConfirmationDeadline: expiredDeadline,
    });
    const repository = fakeRepository({
      findById: vi.fn().mockResolvedValue(shipment),
      updateStatus: vi.fn().mockRejectedValue(new Error("Transición inválida")),
    });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.rejectShipment(shipment.id, "receiver-id")).rejects.toThrow("Transición inválida");
    expect(repository.updateStatus).toHaveBeenCalledWith(
      shipment.id,
      ShipmentStatus.REJECTED_BY_RECEIVER,
      "receiver-id",
      undefined
    );
  });

  it("el emisor recibe 403 al intentar rechazar", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.rejectShipment(shipment.id, "sender-id")).rejects.toMatchObject({
      statusCode: 403,
      code: "AUTH_FORBIDDEN",
    });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it("un admin recibe 403 al intentar rechazar", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.rejectShipment(shipment.id, "admin-id")).rejects.toMatchObject({
      statusCode: 403,
      code: "AUTH_FORBIDDEN",
    });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it("un tercero recibe 403 al intentar rechazar", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.rejectShipment(shipment.id, "stranger-id")).rejects.toMatchObject({
      statusCode: 403,
      code: "AUTH_FORBIDDEN",
    });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it("responde 404 si el envío no existe al rechazar", async () => {
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(null) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.rejectShipment("unknown-id", "receiver-id")).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it("si la notificación push falla, el rechazo se completa igual (best-effort)", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const updatedShipment = fakeShipment({ ...shipment, status: ShipmentStatus.REJECTED_BY_RECEIVER });
    const repository = fakeRepository({
      findById: vi.fn().mockResolvedValue(shipment),
      updateStatus: vi.fn().mockResolvedValue(updatedShipment),
    });
    const usersClient = createFakeUsersClient({});
    const notificationsClient = createFakeNotificationsClient({
      sendPush: vi.fn().mockRejectedValue(new Error("Push service down")),
    });
    const service = createShipmentsService(repository, usersClient, notificationsClient);

    const result = await service.rejectShipment(shipment.id, "receiver-id");
    expect(result.status).toBe(ShipmentStatus.REJECTED_BY_RECEIVER);
    expect(repository.updateStatus).toHaveBeenCalledWith(
      shipment.id,
      ShipmentStatus.REJECTED_BY_RECEIVER,
      "receiver-id",
      undefined
    );
  });
});

describe("shipments.service — expireOverdueShipments (MOVO-130)", () => {
  it("cancela los envíos vencidos con actorId null y envía push notification al emisor", async () => {
    const expired1 = fakeShipment({ id: "s-1", senderId: "sender-1", receiverId: "receiver-1" });
    const expired2 = fakeShipment({ id: "s-2", senderId: "sender-2", receiverId: "receiver-2" });
    const repository = fakeRepository({
      findExpiredAwaitingConfirmation: vi.fn().mockResolvedValue([expired1, expired2]),
      updateStatus: vi.fn().mockResolvedValue(fakeShipment()),
    });
    const usersClient = createFakeUsersClient({
      "receiver-1": fakePublicProfile({ id: "receiver-1", fullName: "Ana García" }),
      "receiver-2": fakePublicProfile({ id: "receiver-2", fullName: "Bruno Díaz" }),
    });
    const notificationsClient = createFakeNotificationsClient();
    const service = createShipmentsService(repository, usersClient, notificationsClient);

    const result = await service.expireOverdueShipments(50);

    expect(result.expiredCount).toBe(2);
    expect(result.errorsCount).toBe(0);
    expect(repository.findExpiredAwaitingConfirmation).toHaveBeenCalledWith(expect.any(Date), 50);
    expect(repository.updateStatus).toHaveBeenCalledWith(
      "s-1",
      ShipmentStatus.CANCELLED,
      null,
      "El receptor no confirmó dentro del plazo"
    );
    expect(repository.updateStatus).toHaveBeenCalledWith(
      "s-2",
      ShipmentStatus.CANCELLED,
      null,
      "El receptor no confirmó dentro del plazo"
    );
    await vi.waitFor(() => {
      expect(notificationsClient.sendPush).toHaveBeenCalledWith({
        userId: "sender-1",
        title: "Envío cancelado",
        body: "Tu envío se canceló: Ana García no lo confirmó a tiempo",
        data: { shipmentId: "s-1", type: "shipment_cancelled" },
      });
      expect(notificationsClient.sendPush).toHaveBeenCalledWith({
        userId: "sender-2",
        title: "Envío cancelado",
        body: "Tu envío se canceló: Bruno Díaz no lo confirmó a tiempo",
        data: { shipmentId: "s-2", type: "shipment_cancelled" },
      });
    });
  });

  it("continúa cancelando el lote si falla la notificación push (best-effort)", async () => {
    const expired1 = fakeShipment({ id: "s-1", senderId: "sender-1", receiverId: "receiver-1" });
    const expired2 = fakeShipment({ id: "s-2", senderId: "sender-2", receiverId: "receiver-2" });
    const repository = fakeRepository({
      findExpiredAwaitingConfirmation: vi.fn().mockResolvedValue([expired1, expired2]),
      updateStatus: vi.fn().mockResolvedValue(fakeShipment()),
    });
    const usersClient = createFakeUsersClient({
      "receiver-1": fakePublicProfile({ id: "receiver-1", fullName: "Ana García" }),
      "receiver-2": fakePublicProfile({ id: "receiver-2", fullName: "Bruno Díaz" }),
    });
    const notificationsClient = createFakeNotificationsClient({
      sendPush: vi.fn().mockRejectedValueOnce(new Error("Push error")).mockResolvedValueOnce(undefined),
    });
    const service = createShipmentsService(repository, usersClient, notificationsClient);

    const result = await service.expireOverdueShipments();

    expect(result.expiredCount).toBe(2);
    expect(result.errorsCount).toBe(0);
    expect(repository.updateStatus).toHaveBeenCalledTimes(2);
  });

  it("continúa cancelando el resto del lote si la actualización de un envío falla", async () => {
    const expired1 = fakeShipment({ id: "s-1" });
    const expired2 = fakeShipment({ id: "s-2" });
    const repository = fakeRepository({
      findExpiredAwaitingConfirmation: vi.fn().mockResolvedValue([expired1, expired2]),
      updateStatus: vi
        .fn()
        .mockRejectedValueOnce(new Error("DB error"))
        .mockResolvedValueOnce(fakeShipment()),
    });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    const result = await service.expireOverdueShipments();

    expect(result.expiredCount).toBe(1);
    expect(result.errorsCount).toBe(1);
    expect(repository.updateStatus).toHaveBeenCalledTimes(2);
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
