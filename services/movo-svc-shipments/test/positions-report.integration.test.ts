import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType } from "../src/models/shipment";
import { CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS } from "../src/services/position-service";

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
      // `lastStatusChangedAt` 1h atrás: el envío "entró" a este estado hace rato, así los
      // `capturedAt` recientes de los tests son posteriores al inicio del tránsito (MOVO-250/AC3).
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        status: status as any,
        lastStatusChangedAt: new Date(Date.now() - 60 * 60_000),
        ...(withCarrierId ? { carrierId: withCarrierId } : {}),
      },
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

    const capturedAt = new Date().toISOString();
    const first = await report(shipmentId, carrierId, { capturedAt });
    const second = await report(shipmentId, carrierId, { capturedAt });
    const third = await report(shipmentId, carrierId, { capturedAt });

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
  describe("MOVO-250", () => {
    const BUCKET_MS = CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS;

    function reportBatch(userId: string, positions: unknown[]) {
      return app.inject({
        method: "POST",
        url: "/shipments/positions",
        headers: { "x-user-id": userId },
        payload: { positions },
      });
    }

    function position(shipmentId: string, capturedAt: Date, extra: Record<string, unknown> = {}) {
      return { shipmentId, lat: -31.42, lng: -64.18, accuracyM: 10, capturedAt: capturedAt.toISOString(), ...extra };
    }

    it("AC1 (Redis real, Lua): reportar la posición actual y después una más vieja conserva la actual", async () => {
      const shipmentId = await createShipmentWithStatus("in_transit");
      const current = new Date(Date.now() - 1_000);
      const older = new Date(Date.now() - 10 * 60_000);

      await report(shipmentId, carrierId, { lat: -31.5, capturedAt: current.toISOString() });
      const response = await report(shipmentId, carrierId, { lat: -31.1, capturedAt: older.toISOString() });

      expect(response.statusCode).toBe(202);
      const lastKnown = await app.redis.hgetall(`position:last:${shipmentId}`);
      expect(Number(lastKnown.lat)).toBe(-31.5);
      expect(lastKnown.capturedAt).toBe(current.toISOString());
      // La vieja es de otro tramo: entra a la traza igual.
      expect(await app.db.carrierPosition.count({ where: { shipmentId } })).toBe(2);
    });

    it("AC1: dos reportes concurrentes con distinto capturedAt dejan siempre el más reciente", async () => {
      const shipmentId = await createShipmentWithStatus("in_transit");
      const newest = new Date(Date.now() - 1_000);

      await Promise.all(
        [30, 20, 10, 0].map((secondsAgo, i) =>
          report(shipmentId, carrierId, {
            lat: -31 - i,
            capturedAt: new Date(newest.getTime() - secondsAgo * 1_000 + (i === 3 ? 0 : -60_000)).toISOString(),
          })
        )
      );

      const lastKnown = await app.redis.hgetall(`position:last:${shipmentId}`);
      expect(lastKnown.capturedAt).toBe(newest.toISOString());
    });

    it("AC2: una tanda de 30 posiciones cada 5s de hace 3 minutos persiste una por tramo de 45s, sin importar el orden", async () => {
      const shipmentId = await createShipmentWithStatus("in_transit");
      const t0 = Math.floor((Date.now() - 4 * 60_000) / BUCKET_MS) * BUCKET_MS;
      const positions = Array.from({ length: 30 }, (_, i) => position(shipmentId, new Date(t0 + i * 5_000)));
      // Orden de llegada invertido: la más nueva primero.
      const response = await reportBatch(carrierId, positions.reverse());

      expect(response.statusCode).toBe(200);
      const results = response.json().results;
      expect(results).toHaveLength(30);
      expect(results.every((r: { status: string }) => r.status === "accepted")).toBe(true);
      const rows = await app.db.carrierPosition.findMany({ where: { shipmentId } });
      // 30 * 5s = 145s de traza -> 4 tramos de 45s.
      expect(rows).toHaveLength(4);
      expect(new Set(rows.map((r) => Math.floor(r.capturedAt.getTime() / BUCKET_MS))).size).toBe(4);
      // El marcador queda en la más reciente aunque haya llegado primero.
      const lastKnown = await app.redis.hgetall(`position:last:${shipmentId}`);
      expect(lastKnown.capturedAt).toBe(new Date(t0 + 29 * 5_000).toISOString());
    });

    it("AC2: reenviar el mismo lote no duplica la traza (idempotente)", async () => {
      const shipmentId = await createShipmentWithStatus("in_transit");
      const t0 = Math.floor((Date.now() - 4 * 60_000) / BUCKET_MS) * BUCKET_MS;
      const positions = Array.from({ length: 10 }, (_, i) => position(shipmentId, new Date(t0 + i * 5_000)));

      await reportBatch(carrierId, positions);
      const second = await reportBatch(carrierId, positions);

      expect(second.json().results.every((r: { persisted: boolean }) => r.persisted === false)).toBe(true);
      expect(await app.db.carrierPosition.count({ where: { shipmentId } })).toBe(2);
    });

    it("AC3: 422 INVALID_CAPTURED_AT con un capturedAt en el futuro (endpoint individual)", async () => {
      const shipmentId = await createShipmentWithStatus("in_transit");

      const response = await report(shipmentId, carrierId, {
        capturedAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("INVALID_CAPTURED_AT");
    });

    it("AC3: rechaza un capturedAt anterior al momento en que el envío pasó a in_transit", async () => {
      const shipmentId = await createShipmentWithStatus("in_transit");
      const inTransitSince = new Date(Date.now() - 60_000);
      await app.db.shipment.update({ where: { id: shipmentId }, data: { lastStatusChangedAt: inTransitSince } });

      const response = await reportBatch(carrierId, [
        position(shipmentId, new Date(inTransitSince.getTime() - 5_000)),
        position(shipmentId, new Date(inTransitSince.getTime() + 5_000)),
      ]);

      expect(response.json().results).toEqual([
        { index: 0, shipmentId, status: "rejected", code: "INVALID_CAPTURED_AT" },
        { index: 1, shipmentId, status: "accepted", persisted: true },
      ]);
    });

    it("AC4: lote mixto (en tránsito, entregado, ajeno, inexistente) -> un resultado por ítem", async () => {
      const inTransit = await createShipmentWithStatus("in_transit");
      const delivered = await createShipmentWithStatus("delivered");
      const foreign = await createShipmentWithStatus("in_transit", otherCarrierId);
      const missing = randomUUID();
      const now = new Date(Date.now() - 1_000);

      const response = await reportBatch(carrierId, [
        position(inTransit, now),
        position(delivered, now),
        position(foreign, now),
        position(missing, now),
      ]);

      expect(response.statusCode).toBe(200);
      expect(response.json().results).toEqual([
        { index: 0, shipmentId: inTransit, status: "accepted", persisted: true },
        { index: 1, shipmentId: delivered, status: "rejected", code: "SHIPMENT_NOT_IN_TRANSIT" },
        { index: 2, shipmentId: foreign, status: "rejected", code: "FORBIDDEN" },
        { index: 3, shipmentId: missing, status: "rejected", code: "NOT_FOUND" },
      ]);
      expect(await app.db.carrierPosition.count({ where: { shipmentId: foreign } })).toBe(0);
    });

    it("AC4: 400 con un lote vacío, con más de 100 posiciones o sin x-user-id (401)", async () => {
      const shipmentId = await createShipmentWithStatus("in_transit");
      const at = new Date(Date.now() - 1_000);

      expect((await reportBatch(carrierId, [])).statusCode).toBe(400);
      const tooMany = Array.from({ length: 101 }, () => position(shipmentId, at));
      expect((await reportBatch(carrierId, tooMany)).statusCode).toBe(400);
      const noAuth = await app.inject({
        method: "POST",
        url: "/shipments/positions",
        payload: { positions: [position(shipmentId, at)] },
      });
      expect(noAuth.statusCode).toBe(401);
    });

    it("confirmado que app.swagger() expone POST /shipments/positions", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spec = app.swagger() as any;
      expect(spec.paths["/shipments/positions"]?.post).toBeDefined();
    });
  });
});
