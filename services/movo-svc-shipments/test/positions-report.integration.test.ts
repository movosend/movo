import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType } from "../src/models/shipment";

describe("POST /shipments/:id/positions (Postgres, MOVO-202)", () => {
  let app: FastifyInstance;
  let repo: ShipmentRepository;

  const senderId = randomUUID();
  const receiverId = randomUUID();
  const carrierId = randomUUID();
  const otherCarrierId = randomUUID();

  const baseInput: CreateShipmentInput = {
    senderId,
    receiverId,
    packageType: PackageType.standard_package,
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: null,
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
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
    await app.ready();
    repo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  async function createShipmentWithStatus(status: string, withCarrierId: string | null = carrierId): Promise<string> {
    const created = await repo.create(baseInput);
    await app.db.shipment.update({
      where: { id: created.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { status: status as any, ...(withCarrierId ? { carrierId: withCarrierId } : {}) },
    });
    return created.id;
  }

  function report(shipmentId: string, userId: string, body: Record<string, unknown> = {}) {
    return app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/positions`,
      headers: { "x-user-id": userId },
      payload: {
        lat: -31.42,
        lng: -64.18,
        accuracyM: 10,
        capturedAt: new Date().toISOString(),
        ...body,
      },
    });
  }

  it("AC1/AC2: el transportista asignado reporta sobre un envío in_transit -> 202, se persiste y actualiza la última posición", async () => {
    const shipmentId = await createShipmentWithStatus("in_transit");

    const response = await report(shipmentId, carrierId, { lat: -31.5, lng: -64.5, accuracyM: 7 });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ persisted: true });

    const rows = await app.db.carrierPosition.findMany({ where: { shipmentId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].lat.toNumber()).toBe(-31.5);
    expect(rows[0].accuracyM.toNumber()).toBe(7);
  });

  it("AC4: reportes seguidos (cada pocos segundos) descartan la persistencia salvo el primero", async () => {
    const shipmentId = await createShipmentWithStatus("in_transit");

    const first = await report(shipmentId, carrierId);
    const second = await report(shipmentId, carrierId);
    const third = await report(shipmentId, carrierId);

    expect(first.json()).toEqual({ persisted: true });
    expect(second.json()).toEqual({ persisted: false });
    expect(third.json()).toEqual({ persisted: false });
    expect(await app.db.carrierPosition.count({ where: { shipmentId } })).toBe(1);
  });

  it("AC2: 403 AUTH_FORBIDDEN si el caller no es el transportista asignado", async () => {
    const shipmentId = await createShipmentWithStatus("in_transit");

    const response = await report(shipmentId, otherCarrierId);

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
  });

  it("AC2: 403 AUTH_FORBIDDEN si el caller es el emisor o el receptor (no el transportista)", async () => {
    const shipmentId = await createShipmentWithStatus("in_transit");

    const asSender = await report(shipmentId, senderId);
    const asReceiver = await report(shipmentId, receiverId);

    expect(asSender.statusCode).toBe(403);
    expect(asReceiver.statusCode).toBe(403);
  });

  it.each(["assigned", "assigned_unfunded", "delivered", "completed", "cancelled"])(
    "AC2: 403 SHIPMENT_NOT_IN_TRANSIT si el envío está en '%s'",
    async (status) => {
      const shipmentId = await createShipmentWithStatus(status);

      const response = await report(shipmentId, carrierId);

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("SHIPMENT_NOT_IN_TRANSIT");
    }
  );

  it("404 NOT_FOUND sobre un envío inexistente", async () => {
    const response = await report(randomUUID(), carrierId);
    expect(response.statusCode).toBe(404);
  });

  it("401 sin x-user-id", async () => {
    const shipmentId = await createShipmentWithStatus("in_transit");
    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/positions`,
      payload: { lat: -31.42, lng: -64.18, accuracyM: 10, capturedAt: new Date().toISOString() },
    });
    expect(response.statusCode).toBe(401);
  });

  it("400 con capturedAt no parseable como fecha (AJV, format: date-time)", async () => {
    const shipmentId = await createShipmentWithStatus("in_transit");
    const response = await report(shipmentId, carrierId, { capturedAt: "no-es-una-fecha" });
    expect(response.statusCode).toBe(400);
  });

  it("400 con lat/lng fuera de rango (AJV)", async () => {
    const shipmentId = await createShipmentWithStatus("in_transit");
    const response = await report(shipmentId, carrierId, { lat: 200 });
    expect(response.statusCode).toBe(400);
  });

  it("confirmado que app.swagger() expone POST /shipments/{id}/positions", async () => {
    const swagger = app.swagger() as { paths: Record<string, unknown> };
    expect(swagger.paths["/shipments/{id}/positions"]).toBeDefined();
  });
});
