import { randomUUID, webcrypto } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakeFundsReleaseNotifier } from "./fake-funds-release-notifier";
import { DeviceKey } from "../src/adapters/users-client";

const { subtle } = webcrypto;

const PICKUP_DATE = new Date("2030-01-01T00:00:00.000Z");

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
}

async function exportDeviceKey(publicKey: CryptoKey): Promise<DeviceKey> {
  const raw = await subtle.exportKey("raw", publicKey);
  return { publicKey: Buffer.from(raw).toString("base64"), registeredAt: new Date().toISOString() };
}

async function sign(privateKey: CryptoKey, canonicalPayload: string): Promise<string> {
  const signature = await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(canonicalPayload)
  );
  return Buffer.from(signature).toString("base64");
}

describe("Handshake criptográfico — /shipments/:id/handshake (Postgres + Redis) — MOVO-158", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  const fundsReleaseNotifier = createFakeFundsReleaseNotifier();

  const senderId = randomUUID();
  const receiverId = randomUUID();
  const carrierId = randomUUID();

  let senderKeyPair: CryptoKeyPair;
  let carrierKeyPair: CryptoKeyPair;

  const baseShipmentInput: CreateShipmentInput = {
    senderId,
    receiverId,
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
    pickupDate: PICKUP_DATE,
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 4500,
  };

  /** Lleva un envío hasta `assigned` (con `carrierId` ya seteado) bypaseando la máquina
   * de estados vía repositorio -- no hay ningún flujo real que hoy llegue a `assigned`
   * (el hold de fondos de MOVO-12 sigue sin implementar), mismo criterio de fixture que
   * `ratings.integration.test.ts#createDeliveredShipment`. Las 2 fotos de creation
   * satisfacen el gate de AC6 de MOVO-81 para llegar a `published`. */
  async function createAssignedShipment(overrides: Partial<CreateShipmentInput> = {}): Promise<string> {
    const created = await shipmentRepo.create({ ...baseShipmentInput, ...overrides });
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    await shipmentRepo.updateStatus(created.id, ShipmentStatus.ASSIGNMENT_PENDING, null);
    await app.db.shipment.update({ where: { id: created.id }, data: { carrierId } });
    await shipmentRepo.updateStatus(created.id, ShipmentStatus.ASSIGNED, null);
    return created.id;
  }

  async function createInTransitShipment(): Promise<string> {
    const id = await createAssignedShipment();
    await shipmentRepo.updateStatus(id, ShipmentStatus.IN_TRANSIT, carrierId);
    return id;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    senderKeyPair = await generateKeyPair();
    carrierKeyPair = await generateKeyPair();

    app = buildApp({
      usersClient: createFakeUsersClient(
        {},
        {
          [senderId]: await exportDeviceKey(senderKeyPair.publicKey),
          [carrierId]: await exportDeviceKey(carrierKeyPair.publicKey),
        }
      ),
      fundsReleaseNotifier,
      sweepEnabled: false,
      orphanPhotoSweepEnabled: false,
      pickupExpirySweepEnabled: false,
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // CASCADE también vacía shipments.shipment_events/shipments.handshake_events.
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
    vi.mocked(fundsReleaseNotifier.notify).mockClear();
  });

  describe("Retiro (pickup) — assigned -> in_transit", () => {
    it("flujo feliz: el emisor genera, el transportista confirma, persiste el evento y transiciona", async () => {
      const shipmentId = await createAssignedShipment();

      const generateResponse = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/generate`,
        headers: { "x-user-id": senderId },
        payload: { lat: -31.4201, lng: -64.1888 },
      });
      expect(generateResponse.statusCode).toBe(200);
      const { nonce, canonicalPayload, stage, ttlSeconds } = generateResponse.json();
      expect(stage).toBe("pickup");
      expect(ttlSeconds).toBe(15);
      expect(canonicalPayload).toBe(`${shipmentId}:pickup:${nonce}`);

      const signature = await sign(senderKeyPair.privateKey, canonicalPayload);

      const confirmResponse = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/confirm`,
        headers: { "x-user-id": carrierId },
        payload: { nonce, signature, lat: -31.4201, lng: -64.1888 },
      });

      expect(confirmResponse.statusCode).toBe(200);
      const body = confirmResponse.json();
      expect(body).toMatchObject({
        shipmentId,
        stage: "pickup",
        previousStatus: "assigned",
        status: "in_transit",
        distanceM: 0,
      });

      const shipment = await shipmentRepo.findById(shipmentId);
      expect(shipment?.status).toBe(ShipmentStatus.IN_TRANSIT);

      const events = await shipmentRepo.listEvents(shipmentId);
      const lastEvent = events[events.length - 1];
      expect(lastEvent).toMatchObject({
        fromStatus: ShipmentStatus.ASSIGNED,
        toStatus: ShipmentStatus.IN_TRANSIT,
        actorId: carrierId,
      });

      const handshakeEvents = await app.db.handshakeEvent.findMany({ where: { shipmentId } });
      expect(handshakeEvents).toHaveLength(1);
      expect(handshakeEvents[0]).toMatchObject({
        stage: "pickup",
        actorId: carrierId,
        counterpartyId: senderId,
      });
      expect(handshakeEvents[0].nonceHash).not.toBe(nonce);

      expect(fundsReleaseNotifier.notify).not.toHaveBeenCalled();
    });

    it("403 si alguien que no es el emisor intenta generar el QR de retiro", async () => {
      const shipmentId = await createAssignedShipment();

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/generate`,
        headers: { "x-user-id": receiverId },
        payload: { lat: -31.4201, lng: -64.1888 },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
    });

    it("403 si alguien que no es el transportista asignado intenta confirmar el retiro", async () => {
      const shipmentId = await createAssignedShipment();
      const generateResponse = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/generate`,
        headers: { "x-user-id": senderId },
        payload: { lat: -31.4201, lng: -64.1888 },
      });
      const { nonce, canonicalPayload } = generateResponse.json();
      const signature = await sign(senderKeyPair.privateKey, canonicalPayload);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/confirm`,
        headers: { "x-user-id": receiverId },
        payload: { nonce, signature, lat: -31.4201, lng: -64.1888 },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
    });

    it("409 HANDSHAKE_INVALID_SHIPMENT_STATE si el envío todavía está published", async () => {
      const created = await shipmentRepo.create(baseShipmentInput);
      await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
      await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
      await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${created.id}/handshake/generate`,
        headers: { "x-user-id": senderId },
        payload: { lat: -31.4201, lng: -64.1888 },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("HANDSHAKE_INVALID_SHIPMENT_STATE");
    });

    it("410 HANDSHAKE_QR_EXPIRED si se confirma con un nonce ya superado por uno más nuevo", async () => {
      const shipmentId = await createAssignedShipment();

      const firstGenerate = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/generate`,
        headers: { "x-user-id": senderId },
        payload: { lat: -31.4201, lng: -64.1888 },
      });
      const stale = firstGenerate.json();
      const staleSignature = await sign(senderKeyPair.privateKey, stale.canonicalPayload);

      // Nuevo QR -- invalida el nonce anterior (AC5).
      await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/generate`,
        headers: { "x-user-id": senderId },
        payload: { lat: -31.4201, lng: -64.1888 },
      });

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/confirm`,
        headers: { "x-user-id": carrierId },
        payload: { nonce: stale.nonce, signature: staleSignature, lat: -31.4201, lng: -64.1888 },
      });

      expect(response.statusCode).toBe(410);
      expect(response.json().error.code).toBe("HANDSHAKE_QR_EXPIRED");
    });

    it("422 HANDSHAKE_INVALID_SIGNATURE si la firma no verifica", async () => {
      const shipmentId = await createAssignedShipment();
      const generateResponse = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/generate`,
        headers: { "x-user-id": senderId },
        payload: { lat: -31.4201, lng: -64.1888 },
      });
      const { nonce } = generateResponse.json();

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/confirm`,
        headers: { "x-user-id": carrierId },
        payload: { nonce, signature: Buffer.from("no-es-una-firma-real").toString("base64"), lat: -31.4201, lng: -64.1888 },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("HANDSHAKE_INVALID_SIGNATURE");

      const shipment = await shipmentRepo.findById(shipmentId);
      expect(shipment?.status).toBe(ShipmentStatus.ASSIGNED);
    });

    it("422 HANDSHAKE_DISTANCE_EXCEEDED si el transportista está a más de 100m del emisor", async () => {
      const shipmentId = await createAssignedShipment();
      const generateResponse = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/generate`,
        headers: { "x-user-id": senderId },
        payload: { lat: -31.4201, lng: -64.1888 },
      });
      const { nonce, canonicalPayload } = generateResponse.json();
      const signature = await sign(senderKeyPair.privateKey, canonicalPayload);

      // Nueva Córdoba, ~1.6km del punto de generación.
      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/confirm`,
        headers: { "x-user-id": carrierId },
        payload: { nonce, signature, lat: -31.4353, lng: -64.1858 },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("HANDSHAKE_DISTANCE_EXCEEDED");

      const shipment = await shipmentRepo.findById(shipmentId);
      expect(shipment?.status).toBe(ShipmentStatus.ASSIGNED);

      // El desafío sigue vigente -- reintentable dentro del mismo TTL.
      const retry = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/confirm`,
        headers: { "x-user-id": carrierId },
        payload: { nonce, signature, lat: -31.4201, lng: -64.1888 },
      });
      expect(retry.statusCode).toBe(200);
    });

    it("409 HANDSHAKE_CEDENTE_KEY_MISSING si el cedente no tiene clave de dispositivo registrada", async () => {
      const senderWithoutKey = randomUUID();
      const shipmentId = await createAssignedShipment({ senderId: senderWithoutKey });

      const generateResponse = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/generate`,
        headers: { "x-user-id": senderWithoutKey },
        payload: { lat: -31.4201, lng: -64.1888 },
      });
      const { nonce } = generateResponse.json();

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/confirm`,
        headers: { "x-user-id": carrierId },
        payload: { nonce, signature: Buffer.from("firma").toString("base64"), lat: -31.4201, lng: -64.1888 },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("HANDSHAKE_CEDENTE_KEY_MISSING");
    });

    it("dos /confirm concurrentes con el mismo nonce válido: exactamente uno gana", async () => {
      const shipmentId = await createAssignedShipment();
      const generateResponse = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/generate`,
        headers: { "x-user-id": senderId },
        payload: { lat: -31.4201, lng: -64.1888 },
      });
      const { nonce, canonicalPayload } = generateResponse.json();
      const signature = await sign(senderKeyPair.privateKey, canonicalPayload);
      const confirmOnce = () =>
        app.inject({
          method: "POST",
          url: `/shipments/${shipmentId}/handshake/confirm`,
          headers: { "x-user-id": carrierId },
          payload: { nonce, signature, lat: -31.4201, lng: -64.1888 },
        });

      const [first, second] = await Promise.all([confirmOnce(), confirmOnce()]);
      const statusCodes = [first.statusCode, second.statusCode].sort();

      // Una gana (200); la otra pierde el CAS de Postgres (409) o, si llegó después de
      // que la primera ya consumió/borró el desafío de Redis, 410 -- cualquiera de las
      // dos es una exclusión mutua correcta, nunca dos 200.
      expect(statusCodes[0]).toBe(200);
      expect([409, 410]).toContain(statusCodes[1]);

      const handshakeEvents = await app.db.handshakeEvent.findMany({ where: { shipmentId } });
      expect(handshakeEvents).toHaveLength(1);
    });
  });

  describe("Entrega (delivery) — in_transit -> delivered", () => {
    it("flujo feliz: el transportista genera, el receptor confirma y se libera el pago", async () => {
      const shipmentId = await createInTransitShipment();

      const generateResponse = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/generate`,
        headers: { "x-user-id": carrierId },
        payload: { lat: -31.4135, lng: -64.1811 },
      });
      expect(generateResponse.statusCode).toBe(200);
      const { nonce, canonicalPayload, stage } = generateResponse.json();
      expect(stage).toBe("delivery");

      const signature = await sign(carrierKeyPair.privateKey, canonicalPayload);

      const confirmResponse = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/confirm`,
        headers: { "x-user-id": receiverId },
        payload: { nonce, signature, lat: -31.4135, lng: -64.1811 },
      });

      expect(confirmResponse.statusCode).toBe(200);
      expect(confirmResponse.json()).toMatchObject({
        stage: "delivery",
        previousStatus: "in_transit",
        status: "delivered",
      });

      const shipment = await shipmentRepo.findById(shipmentId);
      expect(shipment?.status).toBe(ShipmentStatus.DELIVERED);
      expect(shipment?.deliveredAt).not.toBeNull();

      const handshakeEvents = await app.db.handshakeEvent.findMany({ where: { shipmentId } });
      expect(handshakeEvents).toHaveLength(1);
      expect(handshakeEvents[0]).toMatchObject({ stage: "delivery", actorId: receiverId, counterpartyId: carrierId });

      await vi.waitFor(() => {
        expect(fundsReleaseNotifier.notify).toHaveBeenCalledWith({ shipmentId, carrierId });
      });
    });

    it("403 si alguien que no es el transportista asignado intenta generar el QR de entrega", async () => {
      const shipmentId = await createInTransitShipment();

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/generate`,
        headers: { "x-user-id": senderId },
        payload: { lat: -31.4135, lng: -64.1811 },
      });

      expect(response.statusCode).toBe(403);
    });

    it("403 si alguien que no es el receptor intenta confirmar la entrega", async () => {
      const shipmentId = await createInTransitShipment();
      const generateResponse = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/generate`,
        headers: { "x-user-id": carrierId },
        payload: { lat: -31.4135, lng: -64.1811 },
      });
      const { nonce, canonicalPayload } = generateResponse.json();
      const signature = await sign(carrierKeyPair.privateKey, canonicalPayload);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/confirm`,
        headers: { "x-user-id": senderId },
        payload: { nonce, signature, lat: -31.4135, lng: -64.1811 },
      });

      expect(response.statusCode).toBe(403);
    });
  });
});
