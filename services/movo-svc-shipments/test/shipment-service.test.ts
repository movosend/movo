import { describe, it, expect, vi } from "vitest";
import { ApiError, ShipmentStatus, UserRole } from "@movo/shared";
import { createShipmentsService, CreateShipmentServiceInput } from "../src/modules/shipments/shipments.service";
import { ShipmentRepository } from "../src/repositories/shipment-repository";
import { Shipment, PackageType } from "../src/models/shipment";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";

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

// Pickup/delivery en el mismo punto -> distancia haversine 0, aísla el cálculo del
// placeholder de precio a solo la parte de peso (1500 base + 2kg*300 = 2100).
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
  deliveryLat: -31.4201,
  deliveryLng: -64.1888,
  pickupDate: "2030-01-01",
  pickupTimeWindowStart: "09:00",
  pickupTimeWindowEnd: "12:00",
};

describe("shipments.service — createShipment", () => {
  it("rechaza la auto-designación como receptor sin llamar al repositorio ni a svc-users", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({});
    const findPublicProfileSpy = vi.spyOn(usersClient, "findPublicProfile");
    const service = createShipmentsService(repository, usersClient);

    await expect(
      service.createShipment({ ...baseInput, senderId: "same-id", receiverId: "same-id" })
    ).rejects.toMatchObject({ statusCode: 422, code: "SHIPMENT_RECEIVER_IS_SENDER" });

    expect(repository.create).not.toHaveBeenCalled();
    expect(findPublicProfileSpy).not.toHaveBeenCalled();
  });

  it("rechaza una franja de retiro con fin anterior o igual al inicio", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({});
    const service = createShipmentsService(repository, usersClient);

    await expect(
      service.createShipment({ ...baseInput, pickupTimeWindowStart: "12:00", pickupTimeWindowEnd: "12:00" })
    ).rejects.toMatchObject({ statusCode: 422, code: "SHIPMENT_PICKUP_WINDOW_INVALID" });

    expect(repository.create).not.toHaveBeenCalled();
  });

  it("rechaza una franja de retiro en el pasado", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({});
    const service = createShipmentsService(repository, usersClient);

    await expect(
      service.createShipment({ ...baseInput, pickupDate: "2020-01-01", pickupTimeWindowStart: "09:00", pickupTimeWindowEnd: "10:00" })
    ).rejects.toMatchObject({ statusCode: 422, code: "SHIPMENT_PICKUP_WINDOW_IN_PAST" });

    expect(repository.create).not.toHaveBeenCalled();
  });

  it("falla con 404 si el receptor no existe", async () => {
    const repository = fakeRepository();
    const usersClient = createFakeUsersClient({});
    const service = createShipmentsService(repository, usersClient);

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
    const service = createShipmentsService(repository, usersClient);

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
    const service = createShipmentsService(repository, usersClient);

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
    const service = createShipmentsService(repository, usersClient);

    await service.createShipment(baseInput);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        senderId: "sender-id",
        receiverId: "receiver-id",
        suggestedPriceArs: 2100,
        pickupDate: new Date("2030-01-01T00:00:00.000Z"),
        pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
        pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      })
    );
  });
});

describe("shipments.service — getShipmentDetail", () => {
  it("devuelve el envío al emisor", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentDetail(shipment.id, "sender-id", [])).resolves.toBe(shipment);
  });

  it("devuelve el envío al receptor", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentDetail(shipment.id, "receiver-id", [])).resolves.toBe(shipment);
  });

  it("devuelve el envío a un admin ajeno al envío", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentDetail(shipment.id, "admin-id", [UserRole.ADMIN])).resolves.toBe(shipment);
  });

  it("rechaza con 403 (no 404) a un tercero sin rol admin", async () => {
    const shipment = fakeShipment({ senderId: "sender-id", receiverId: "receiver-id" });
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(shipment) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentDetail(shipment.id, "stranger-id", [])).rejects.toMatchObject({
      statusCode: 403,
      code: "AUTH_FORBIDDEN",
    });
  });

  it("responde 404 si el envío no existe", async () => {
    const repository = fakeRepository({ findById: vi.fn().mockResolvedValue(null) });
    const service = createShipmentsService(repository, createFakeUsersClient({}));

    await expect(service.getShipmentDetail("unknown-id", "any-id", [])).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
  });
});
