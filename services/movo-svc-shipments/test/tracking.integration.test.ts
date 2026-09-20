import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { signAccessToken, ShipmentStatus, UserRole, KycStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { TRACKING_STATUS_CLOSED_WS_CODE } from "../src/plugins/realtime";

/**
 * MOVO-201, DoD: los 3 caminos de conexión (token válido + envío propio -> acepta,
 * token válido + envío ajeno -> rechaza, sin token -> rechaza) más el cierre automático
 * al pasar a `delivered`. Usa un servidor TCP real (`app.listen`) y un cliente `ws` real
 * en vez de `app.inject`/`injectWS` -- mismo motivo que documentó la PoC de MOVO-200: el
 * test double de `@fastify/websocket` para WS tiene un problema de timing propio al
 * mandar un mensaje inmediatamente después del upgrade, sin relación con el código de
 * la ruta.
 */
describe("GET /shipments/:id/track (WS)", () => {
  let app: FastifyInstance;
  let repo: ShipmentRepository;
  let baseUrl: string;

  const baseInput: CreateShipmentInput = {
    senderId: randomUUID(),
    receiverId: randomUUID(),
    packageType: PackageType.standard_package,
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: "Caja con libros",
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

  function issueToken(sub: string): string {
    return signAccessToken({ sub, roles: [UserRole.SENDER], kycStatus: KycStatus.NOT_STARTED });
  }

  function connect(shipmentId: string, token?: string): WebSocket {
    return new WebSocket(`${baseUrl}/shipments/${shipmentId}/track`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
    return new Promise((resolve) => {
      ws.on("close", (code: number, reason: Buffer) => resolve({ code, reason: reason.toString() }));
    });
  }

  function waitForMessage(ws: WebSocket): Promise<unknown> {
    return new Promise((resolve, reject) => {
      ws.once("message", (data: Buffer) => resolve(JSON.parse(data.toString())));
      ws.once("close", (code: number, reason: Buffer) =>
        reject(new Error(`socket se cerró antes de mandar un mensaje: ${code} ${reason.toString()}`))
      );
    });
  }

  /** Recorre transiciones reales hasta `in_transit`, con transportista asignado --
   * estado desde el que tiene sentido estar mirando el tracking en producción. */
  async function createInTransitShipment(carrierId: string): Promise<string> {
    const shipment = await repo.create(baseInput);
    await repo.addPhoto(shipment.id, PhotoStage.creation, `shipments/${shipment.id}/creation/${randomUUID()}.jpg`);
    await repo.addPhoto(shipment.id, PhotoStage.creation, `shipments/${shipment.id}/creation/${randomUUID()}.jpg`);
    await repo.updateStatus(shipment.id, ShipmentStatus.PUBLISHED, shipment.senderId);
    await app.db.shipment.update({ where: { id: shipment.id }, data: { carrierId } });
    await repo.updateStatus(shipment.id, ShipmentStatus.ASSIGNMENT_PENDING, carrierId);
    await repo.updateStatus(shipment.id, ShipmentStatus.ASSIGNED, carrierId);
    await repo.updateStatus(shipment.id, ShipmentStatus.IN_TRANSIT, carrierId);
    return shipment.id;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("El servidor de test no devolvió una dirección TCP");
    }
    baseUrl = `ws://127.0.0.1:${address.port}`;
    repo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  it("token válido + envío propio: acepta la conexión", async () => {
    const shipment = await repo.create(baseInput);
    const ws = connect(shipment.id, issueToken(shipment.senderId));

    const message = await waitForMessage(ws);
    expect(message).toEqual({ type: "connected", shipmentId: shipment.id });

    ws.close();
    await waitForClose(ws);
  });

  it("token válido + envío ajeno: rechaza la conexión (4003)", async () => {
    const shipment = await repo.create(baseInput);
    const ws = connect(shipment.id, issueToken(randomUUID()));

    const { code } = await waitForClose(ws);
    expect(code).toBe(4003);
  });

  it("sin token: rechaza la conexión (4001)", async () => {
    const shipment = await repo.create(baseInput);
    const ws = connect(shipment.id);

    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it("token malformado (no es un JWT válido): rechaza la conexión (4001)", async () => {
    const shipment = await repo.create(baseInput);
    const ws = connect(shipment.id, "esto-no-es-un-jwt");

    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it("envío inexistente: rechaza la conexión (4004)", async () => {
    const ws = connect(randomUUID(), issueToken(randomUUID()));

    const { code } = await waitForClose(ws);
    expect(code).toBe(4004);
  });

  it("el transportista asignado también puede conectarse, aunque no sea sender ni receiver", async () => {
    const carrierId = randomUUID();
    const shipmentId = await createInTransitShipment(carrierId);
    const ws = connect(shipmentId, issueToken(carrierId));

    const message = await waitForMessage(ws);
    expect(message).toEqual({ type: "connected", shipmentId });

    ws.close();
    await waitForClose(ws);
  });

  it("un envío ya delivered rechaza la conexión al conectar (4009)", async () => {
    const carrierId = randomUUID();
    const shipmentId = await createInTransitShipment(carrierId);
    await repo.updateStatus(shipmentId, ShipmentStatus.DELIVERED, carrierId);

    const ws = connect(shipmentId, issueToken(carrierId));
    const { code } = await waitForClose(ws);
    expect(code).toBe(TRACKING_STATUS_CLOSED_WS_CODE);
  });

  it("AC4: cierra automáticamente una conexión abierta cuando el envío pasa a delivered", async () => {
    const carrierId = randomUUID();
    const shipmentId = await createInTransitShipment(carrierId);
    const ws = connect(shipmentId, issueToken(carrierId));
    await waitForMessage(ws);

    const closed = waitForClose(ws);
    await repo.updateStatus(shipmentId, ShipmentStatus.DELIVERED, carrierId);

    const { code } = await closed;
    expect(code).toBe(TRACKING_STATUS_CLOSED_WS_CODE);
  });
});
