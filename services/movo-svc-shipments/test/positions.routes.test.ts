import Fastify, { FastifyInstance } from "fastify";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import errorHandlerPlugin from "../src/plugins/error-handler";
import positionsRoutes from "../src/modules/positions/positions.routes";
import { PositionService } from "../src/services/position-service";
import { ShipmentRepository } from "../src/repositories/shipment-repository";
import { ShipmentStatus } from "@movo/shared";
import { Shipment, PackageType } from "../src/models/shipment";

const SENDER_ID = "11111111-1111-1111-1111-111111111111";
const RECEIVER_ID = "22222222-2222-2222-2222-222222222222";
const CARRIER_ID = "33333333-3333-3333-3333-333333333333";
const STRANGER_ID = "44444444-4444-4444-4444-444444444444";
const SHIPMENT_ID = "55555555-5555-5555-5555-555555555555";

function mockShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: SHIPMENT_ID,
    senderId: SENDER_ID,
    receiverId: RECEIVER_ID,
    carrierId: CARRIER_ID,
    packageType: PackageType.standard_package,
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: "Caja de prueba",
    urgent: false,
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4201,
    pickupLng: -64.1888,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.4135,
    deliveryLng: -64.1811,
    pickupDate: new Date("2026-08-20T00:00:00.000Z"),
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 4500,
    calculationMethod: null,
    agreedPriceArs: 4500,
    paymentMethod: null,
    status: ShipmentStatus.IN_TRANSIT,
    lastStatusChangedAt: new Date(),
    deliveredAt: null,
    receiverConfirmationDeadline: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    estimatedDeliveryDate: null,
    estimatedDeliveryTimeWindowStart: null,
    estimatedDeliveryTimeWindowEnd: null,
    ...overrides,
  };
}

describe("GET /shipments/:id/positions/latest (HTTP Routes & ACs - MOVO-204 / Comment 25)", () => {
  let app: FastifyInstance;
  let mockShipmentRepo: Partial<ShipmentRepository>;
  let mockService: Partial<PositionService>;

  const samplePosition = {
    lat: -31.4201,
    lng: -64.1888,
    accuracyM: 8.5,
    capturedAt: new Date("2026-09-27T12:00:00.000Z"),
    recordedAt: new Date("2026-09-27T12:00:01.000Z"),
  };

  beforeEach(async () => {
    mockShipmentRepo = {
      findById: vi.fn().mockResolvedValue(mockShipment()),
    };

    mockService = {
      getLastKnownPosition: vi.fn().mockResolvedValue(samplePosition),
    };

    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    await app.register(positionsRoutes, {
      prefix: "/shipments",
      shipmentRepository: mockShipmentRepo as any,
      service: mockService as any,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("401 si falta el header x-user-id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/shipments/${SHIPMENT_ID}/positions/latest`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("404 si el shipment no existe", async () => {
    (mockShipmentRepo.findById as any).mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: `/shipments/${SHIPMENT_ID}/positions/latest`,
      headers: { "x-user-id": SENDER_ID },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("403 si el usuario no es participante (emisor, receptor ni transportista asignado)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/shipments/${SHIPMENT_ID}/positions/latest`,
      headers: { "x-user-id": STRANGER_ID },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("AUTH_FORBIDDEN");
  });

  it("200 con la última posición si existe cuando consulta el emisor", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/shipments/${SHIPMENT_ID}/positions/latest`,
      headers: { "x-user-id": SENDER_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lat).toBe(-31.4201);
    expect(body.lng).toBe(-64.1888);
    expect(body.accuracyM).toBe(8.5);
    expect(body.capturedAt).toBe("2026-09-27T12:00:00.000Z");
  });

  it("200 con la última posición si existe cuando consulta el receptor", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/shipments/${SHIPMENT_ID}/positions/latest`,
      headers: { "x-user-id": RECEIVER_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().lat).toBe(-31.4201);
  });

  it("200 con la última posición si existe cuando consulta el transportista", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/shipments/${SHIPMENT_ID}/positions/latest`,
      headers: { "x-user-id": CARRIER_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().lat).toBe(-31.4201);
  });

  it("200 con null si no tiene posiciones todavía", async () => {
    (mockService.getLastKnownPosition as any).mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: `/shipments/${SHIPMENT_ID}/positions/latest`,
      headers: { "x-user-id": SENDER_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });
});
