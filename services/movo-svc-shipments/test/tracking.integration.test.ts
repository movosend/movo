import { randomUUID, webcrypto } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { signAccessToken, ShipmentStatus, UserRole, KycStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { TRACKING_STATUS_CLOSED_WS_CODE } from "../src/plugins/realtime";
import { createFakeUsersClient } from "./fake-users-client";
import { DeviceKey } from "../src/adapters/users-client";

const { subtle } = webcrypto;

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

  /** Setup del handshake de entrega real (MOVO-158), reusado por el test de fix de
   * review de abajo -- el transportista es el cedente en la entrega, necesita su
   * device key registrada (`usersClient.findDeviceKey`) para que `/handshake/confirm`
   * pueda verificar la firma. */
  async function generateCarrierKeyPair(): Promise<CryptoKeyPair> {
    return subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
  }

  async function exportDeviceKey(publicKey: CryptoKey): Promise<DeviceKey> {
    const raw = await subtle.exportKey("raw", publicKey);
    return { publicKey: Buffer.from(raw).toString("base64"), registeredAt: new Date().toISOString() };
  }

  async function signCanonicalPayload(privateKey: CryptoKey, canonicalPayload: string): Promise<string> {
    const signature = await subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      new TextEncoder().encode(canonicalPayload)
    );
    return Buffer.from(signature).toString("base64");
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

  const handshakeCarrierId = randomUUID();
  let handshakeCarrierKeyPair: CryptoKeyPair;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    handshakeCarrierKeyPair = await generateCarrierKeyPair();
    app = buildApp({
      usersClient: createFakeUsersClient(
        {},
        { [handshakeCarrierId]: await exportDeviceKey(handshakeCarrierKeyPair.publicKey) }
      ),
    });
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

  it("MOVO-202/AC3: si ya hay una última posición conocida en Redis, se manda apenas se conecta un suscriptor nuevo", async () => {
    const carrierId = randomUUID();
    const shipmentId = await createInTransitShipment(carrierId);
    await app.redis.hset(`position:last:${shipmentId}`, {
      lat: "-31.5",
      lng: "-64.5",
      accuracyM: "9",
      capturedAt: "2026-09-20T12:00:00.000Z",
      recordedAt: "2026-09-20T12:00:01.000Z",
    });

    const ws = connect(shipmentId, issueToken(carrierId));

    const connected = await waitForMessage(ws);
    expect(connected).toEqual({ type: "connected", shipmentId });
    const position = await waitForMessage(ws);
    expect(position).toEqual({
      type: "position",
      shipmentId,
      lat: -31.5,
      lng: -64.5,
      accuracyM: 9,
      capturedAt: "2026-09-20T12:00:00.000Z",
      recordedAt: "2026-09-20T12:00:01.000Z",
    });

    ws.close();
    await waitForClose(ws);
  });

  it("MOVO-202/AC3: sin última posición conocida, no manda ningún mensaje de más además de 'connected'", async () => {
    const carrierId = randomUUID();
    const shipmentId = await createInTransitShipment(carrierId);
    const ws = connect(shipmentId, issueToken(carrierId));

    const connected = await waitForMessage(ws);
    expect(connected).toEqual({ type: "connected", shipmentId });

    let receivedExtra = false;
    ws.once("message", () => {
      receivedExtra = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(receivedExtra).toBe(false);

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

  it("fix de review PR #174: cierra automáticamente al confirmarse la entrega vía el handshake real (no `repo.updateStatus`)", async () => {
    const shipmentId = await createInTransitShipment(handshakeCarrierId);
    await repo.addPhoto(
      shipmentId,
      PhotoStage.delivery,
      `shipments/${shipmentId}/delivery/${randomUUID()}.jpg`
    );
    const shipment = await repo.findById(shipmentId);
    if (!shipment) {
      throw new Error("el envío recién creado no se encontró");
    }

    const ws = connect(shipmentId, issueToken(handshakeCarrierId));
    await waitForMessage(ws);
    const closed = waitForClose(ws);

    const generateResponse = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/handshake/generate`,
      headers: { "x-user-id": handshakeCarrierId },
      payload: { lat: shipment.deliveryLat, lng: shipment.deliveryLng },
    });
    expect(generateResponse.statusCode).toBe(200);
    const { nonce, canonicalPayload } = generateResponse.json();
    const signature = await signCanonicalPayload(handshakeCarrierKeyPair.privateKey, canonicalPayload);

    const confirmResponse = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/handshake/confirm`,
      headers: { "x-user-id": shipment.receiverId },
      payload: { nonce, signature, lat: shipment.deliveryLat, lng: shipment.deliveryLng },
    });
    expect(confirmResponse.statusCode).toBe(200);
    expect(confirmResponse.json()).toMatchObject({ status: "delivered" });

    const { code } = await closed;
    expect(code).toBe(TRACKING_STATUS_CLOSED_WS_CODE);
  });
});
