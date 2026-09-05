import { webcrypto } from "node:crypto";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { ShipmentStatus } from "@movo/shared";
import { createHandshakeService, HandshakeRedisClient } from "../src/modules/handshake/handshake.service";
import { HandshakeRepository, ConfirmHandshakeInput } from "../src/repositories/handshake-repository";
import { ShipmentRepository } from "../src/repositories/shipment-repository";
import { HandshakeEvent } from "../src/models/handshake";
import { Shipment, PackageType } from "../src/models/shipment";
import { buildHandshakeCanonicalPayload } from "../src/domain/handshake-crypto";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakeFundsReleaseNotifier } from "./fake-funds-release-notifier";

const { subtle } = webcrypto;

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
}

async function exportPublicKeyBase64(publicKey: CryptoKey): Promise<string> {
  const raw = await subtle.exportKey("raw", publicKey);
  return Buffer.from(raw).toString("base64");
}

async function signPayload(privateKey: CryptoKey, payload: string): Promise<string> {
  const signature = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(payload));
  return Buffer.from(signature).toString("base64");
}

function fakeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: "shipment-1",
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
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4201,
    pickupLng: -64.1888,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.4353,
    deliveryLng: -64.1858,
    pickupDate: new Date("2030-01-01T00:00:00.000Z"),
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 2100,
    calculationMethod: "euclidean_linear_v1",
    agreedPriceArs: null,
    paymentMethod: null,
    status: ShipmentStatus.ASSIGNED,
    lastStatusChangedAt: null,
    deliveredAt: null,
    receiverConfirmationDeadline: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeHandshakeEvent(overrides: Partial<HandshakeEvent> = {}): HandshakeEvent {
  return {
    id: "event-1",
    shipmentId: "shipment-1",
    stage: "pickup",
    actorId: "carrier-1",
    counterpartyId: "sender-1",
    nonceHash: "hash",
    counterpartyLat: -31.4201,
    counterpartyLng: -64.1888,
    actorLat: -31.4201,
    actorLng: -64.1888,
    distanceM: 0,
    createdAt: new Date("2026-09-04T12:00:07.000Z"),
    ...overrides,
  };
}

function fakeShipmentRepository(overrides: Partial<ShipmentRepository> = {}): ShipmentRepository {
  return {
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(null),
    updateStatus: vi.fn(),
    listEvents: vi.fn(),
    addPhoto: vi.fn(),
    listPhotos: vi.fn(),
    existsPhotoByS3Key: vi.fn(),
    listByUser: vi.fn(),
    listAvailable: vi.fn(),
    findExpiredAwaitingConfirmation: vi.fn(),
    findPotentiallyExpiredPublished: vi.fn(),
    hasActiveShipmentsForUser: vi.fn(),
    countCompletedTransactions: vi.fn(),
    ...overrides,
  } as ShipmentRepository;
}

function fakeHandshakeRepository(overrides: Partial<HandshakeRepository> = {}): HandshakeRepository {
  return {
    confirmAndPersist: vi.fn((input: ConfirmHandshakeInput) =>
      Promise.resolve(
        fakeHandshakeEvent({
          shipmentId: input.shipmentId,
          stage: input.stage,
          actorId: input.actorId,
          counterpartyId: input.counterpartyId,
          nonceHash: input.nonceHash,
          distanceM: input.distanceM,
        })
      )
    ),
    ...overrides,
  };
}

function createFakeRedis(): HandshakeRedisClient & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async set(key: string, value: string): Promise<string> {
      store.set(key, value);
      return "OK";
    },
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async del(key: string): Promise<number> {
      const existed = store.delete(key);
      return existed ? 1 : 0;
    },
  };
}

describe("handshake.service", () => {
  let keyPair: CryptoKeyPair;
  let publicKeyB64: string;

  beforeAll(async () => {
    keyPair = await generateKeyPair();
    publicKeyB64 = await exportPublicKeyBase64(keyPair.publicKey);
  });

  describe("generateHandshake", () => {
    it("404 si el envío no existe", async () => {
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(null) }),
        fakeHandshakeRepository(),
        createFakeUsersClient({}),
        createFakeRedis(),
        createFakeFundsReleaseNotifier()
      );

      await expect(
        service.generateHandshake({ shipmentId: "shipment-1", callerId: "sender-1", lat: 0, lng: 0 })
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("409 HANDSHAKE_INVALID_SHIPMENT_STATE si el envío no está en assigned/in_transit", async () => {
      const shipment = fakeShipment({ status: ShipmentStatus.PUBLISHED });
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        fakeHandshakeRepository(),
        createFakeUsersClient({}),
        createFakeRedis(),
        createFakeFundsReleaseNotifier()
      );

      await expect(
        service.generateHandshake({ shipmentId: shipment.id, callerId: shipment.senderId, lat: 0, lng: 0 })
      ).rejects.toMatchObject({ statusCode: 409, code: "HANDSHAKE_INVALID_SHIPMENT_STATE" });
    });

    it("403 si el caller no es el emisor en la etapa de retiro (assigned)", async () => {
      const shipment = fakeShipment({ status: ShipmentStatus.ASSIGNED });
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        fakeHandshakeRepository(),
        createFakeUsersClient({}),
        createFakeRedis(),
        createFakeFundsReleaseNotifier()
      );

      await expect(
        service.generateHandshake({ shipmentId: shipment.id, callerId: "otro-usuario", lat: 0, lng: 0 })
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("403 si el caller no es el transportista asignado en la etapa de entrega (in_transit)", async () => {
      const shipment = fakeShipment({ status: ShipmentStatus.IN_TRANSIT });
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        fakeHandshakeRepository(),
        createFakeUsersClient({}),
        createFakeRedis(),
        createFakeFundsReleaseNotifier()
      );

      await expect(
        service.generateHandshake({ shipmentId: shipment.id, callerId: shipment.senderId, lat: 0, lng: 0 })
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("el emisor genera el QR de retiro: persiste el desafío en Redis y devuelve el canonicalPayload", async () => {
      const shipment = fakeShipment({ status: ShipmentStatus.ASSIGNED });
      const redis = createFakeRedis();
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        fakeHandshakeRepository(),
        createFakeUsersClient({}),
        redis,
        createFakeFundsReleaseNotifier()
      );

      const result = await service.generateHandshake({
        shipmentId: shipment.id,
        callerId: shipment.senderId,
        lat: -31.42,
        lng: -64.18,
      });

      expect(result.stage).toBe("pickup");
      expect(result.ttlSeconds).toBe(15);
      expect(result.canonicalPayload).toBe(buildHandshakeCanonicalPayload(shipment.id, "pickup", result.nonce));

      const stored = redis.store.get(`handshake:pending:${shipment.id}`);
      expect(stored).toBeDefined();
      expect(JSON.parse(stored as string)).toMatchObject({
        nonce: result.nonce,
        cedenteId: shipment.senderId,
        cedenteLat: -31.42,
        cedenteLng: -64.18,
      });
    });

    it("el transportista genera el QR de entrega", async () => {
      const shipment = fakeShipment({ status: ShipmentStatus.IN_TRANSIT });
      const redis = createFakeRedis();
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        fakeHandshakeRepository(),
        createFakeUsersClient({}),
        redis,
        createFakeFundsReleaseNotifier()
      );

      const result = await service.generateHandshake({
        shipmentId: shipment.id,
        callerId: shipment.carrierId as string,
        lat: -31.43,
        lng: -64.19,
      });

      expect(result.stage).toBe("delivery");
      expect(redis.store.has(`handshake:pending:${shipment.id}`)).toBe(true);
    });

    it("un nuevo /generate invalida el nonce anterior (overwrite del mismo key)", async () => {
      const shipment = fakeShipment({ status: ShipmentStatus.ASSIGNED });
      const redis = createFakeRedis();
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        fakeHandshakeRepository(),
        createFakeUsersClient({}),
        redis,
        createFakeFundsReleaseNotifier()
      );

      const first = await service.generateHandshake({ shipmentId: shipment.id, callerId: shipment.senderId, lat: 0, lng: 0 });
      const second = await service.generateHandshake({ shipmentId: shipment.id, callerId: shipment.senderId, lat: 0, lng: 0 });

      expect(first.nonce).not.toBe(second.nonce);
      const stored = JSON.parse(redis.store.get(`handshake:pending:${shipment.id}`) as string);
      expect(stored.nonce).toBe(second.nonce);
    });
  });

  describe("confirmHandshake", () => {
    async function seedPendingChallenge(
      redis: HandshakeRedisClient,
      shipmentId: string,
      stage: "pickup" | "delivery",
      cedenteId: string,
      cedenteLat: number,
      cedenteLng: number
    ): Promise<{ nonce: string; signature: string }> {
      const nonce = "nonce-de-prueba";
      await redis.set(
        `handshake:pending:${shipmentId}`,
        JSON.stringify({ stage, nonce, cedenteId, cedenteLat, cedenteLng }),
        "PX",
        15000
      );
      const canonicalPayload = buildHandshakeCanonicalPayload(shipmentId, stage, nonce);
      const signature = await signPayload(keyPair.privateKey, canonicalPayload);
      return { nonce, signature };
    }

    it("404 si el envío no existe", async () => {
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(null) }),
        fakeHandshakeRepository(),
        createFakeUsersClient({}),
        createFakeRedis(),
        createFakeFundsReleaseNotifier()
      );

      await expect(
        service.confirmHandshake({ shipmentId: "shipment-1", callerId: "x", nonce: "n", signature: "s", lat: 0, lng: 0 })
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("410 HANDSHAKE_QR_EXPIRED si se confirma sin que nunca se haya generado un QR (independiente del status actual)", async () => {
      // Hallazgo real del test de concurrencia de más abajo: `confirmHandshake` ya no
      // valida el status del envío por sí solo -- sin un desafío pendiente en Redis no
      // hay nada que confirmar, sin importar en qué estado esté el envío. El caso
      // "envío en un estado sin handshake pendiente" real (AC del ticket) se valida en
      // `/generate`, ver el describe de arriba.
      const shipment = fakeShipment({ status: ShipmentStatus.DELIVERED });
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        fakeHandshakeRepository(),
        createFakeUsersClient({}),
        createFakeRedis(),
        createFakeFundsReleaseNotifier()
      );

      await expect(
        service.confirmHandshake({ shipmentId: shipment.id, callerId: "x", nonce: "n", signature: "s", lat: 0, lng: 0 })
      ).rejects.toMatchObject({ statusCode: 410, code: "HANDSHAKE_QR_EXPIRED" });
    });

    it("403 si en el retiro confirma alguien que no es el transportista asignado (con un QR real ya generado)", async () => {
      const shipment = fakeShipment({ status: ShipmentStatus.ASSIGNED });
      const redis = createFakeRedis();
      const { nonce, signature } = await seedPendingChallenge(redis, shipment.id, "pickup", shipment.senderId, 0, 0);
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        fakeHandshakeRepository(),
        createFakeUsersClient({}),
        redis,
        createFakeFundsReleaseNotifier()
      );

      await expect(
        service.confirmHandshake({
          shipmentId: shipment.id,
          callerId: shipment.senderId,
          nonce,
          signature,
          lat: 0,
          lng: 0,
        })
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("403 si en la entrega confirma alguien que no es el receptor (con un QR real ya generado)", async () => {
      const shipment = fakeShipment({ status: ShipmentStatus.IN_TRANSIT });
      const redis = createFakeRedis();
      const { nonce, signature } = await seedPendingChallenge(
        redis,
        shipment.id,
        "delivery",
        shipment.carrierId as string,
        0,
        0
      );
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        fakeHandshakeRepository(),
        createFakeUsersClient({}),
        redis,
        createFakeFundsReleaseNotifier()
      );

      await expect(
        service.confirmHandshake({
          shipmentId: shipment.id,
          callerId: shipment.carrierId as string,
          nonce,
          signature,
          lat: 0,
          lng: 0,
        })
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("410 HANDSHAKE_QR_EXPIRED si no hay ningún desafío pendiente", async () => {
      const shipment = fakeShipment({ status: ShipmentStatus.ASSIGNED });
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        fakeHandshakeRepository(),
        createFakeUsersClient({}),
        createFakeRedis(),
        createFakeFundsReleaseNotifier()
      );

      await expect(
        service.confirmHandshake({
          shipmentId: shipment.id,
          callerId: shipment.carrierId as string,
          nonce: "n",
          signature: "s",
          lat: 0,
          lng: 0,
        })
      ).rejects.toMatchObject({ statusCode: 410, code: "HANDSHAKE_QR_EXPIRED" });
    });

    it("410 HANDSHAKE_QR_EXPIRED si el nonce no coincide con el vigente (superado por uno nuevo)", async () => {
      const shipment = fakeShipment({ status: ShipmentStatus.ASSIGNED });
      const redis = createFakeRedis();
      const { signature } = await seedPendingChallenge(redis, shipment.id, "pickup", shipment.senderId, -31.42, -64.18);
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        fakeHandshakeRepository(),
        createFakeUsersClient({}),
        redis,
        createFakeFundsReleaseNotifier()
      );

      await expect(
        service.confirmHandshake({
          shipmentId: shipment.id,
          callerId: shipment.carrierId as string,
          nonce: "nonce-viejo-superado",
          signature,
          lat: -31.42,
          lng: -64.18,
        })
      ).rejects.toMatchObject({ statusCode: 410, code: "HANDSHAKE_QR_EXPIRED" });
    });

    it("usa el stage del desafío pendiente, no una relectura de shipment.status (regresión del bug de concurrencia)", async () => {
      // Reproduce en aislado (sin Postgres real) la carrera que encontró
      // handshake.integration.test.ts: el desafío se generó en pickup (shipment
      // todavía assigned), pero para cuando este /confirm corre, OTRO /confirm
      // concurrente ya ganó y el repositorio ya devuelve in_transit. Si el service
      // infiriera el stage de ese status en vivo, calcularía "delivery" y exigiría
      // assertIsReceiver -- el transportista (actor correcto de PICKUP) recibiría un
      // 403 incorrecto en vez de que el CAS de Postgres decida. Acá se verifica que,
      // aun con `findById` devolviendo `in_transit`, el actor exigido sigue siendo el
      // transportista (el del desafío real, "pickup") -- prueba de que el stage
      // nunca se releé del status actual dentro de confirmHandshake.
      const shipment = fakeShipment({ status: ShipmentStatus.IN_TRANSIT }); // ya avanzado por "otro" confirm
      const redis = createFakeRedis();
      const { nonce, signature } = await seedPendingChallenge(
        redis,
        shipment.id,
        "pickup",
        shipment.senderId,
        -31.42,
        -64.18
      );
      const handshakeRepository = fakeHandshakeRepository();
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        handshakeRepository,
        createFakeUsersClient({}, { [shipment.senderId]: { publicKey: publicKeyB64, registeredAt: new Date().toISOString() } }),
        redis,
        createFakeFundsReleaseNotifier()
      );

      // El transportista (actor correcto de un handshake de PICKUP) confirma -- si el
      // bug reapareciera, esto fallaría con 403 (asumiría stage "delivery" y exigiría
      // al receptor) en vez de completar con éxito.
      const result = await service.confirmHandshake({
        shipmentId: shipment.id,
        callerId: shipment.carrierId as string,
        nonce,
        signature,
        lat: -31.42,
        lng: -64.18,
      });

      expect(result.stage).toBe("pickup");
      expect(handshakeRepository.confirmAndPersist).toHaveBeenCalledWith(
        expect.objectContaining({ from: ShipmentStatus.ASSIGNED, to: ShipmentStatus.IN_TRANSIT, stage: "pickup" })
      );
    });

    it("409 HANDSHAKE_CEDENTE_KEY_MISSING si el cedente no tiene clave de dispositivo registrada", async () => {
      const shipment = fakeShipment({ status: ShipmentStatus.ASSIGNED });
      const redis = createFakeRedis();
      const { nonce, signature } = await seedPendingChallenge(
        redis,
        shipment.id,
        "pickup",
        shipment.senderId,
        -31.42,
        -64.18
      );
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        fakeHandshakeRepository(),
        createFakeUsersClient({}), // sin deviceKeys -- 404 real de svc-users
        redis,
        createFakeFundsReleaseNotifier()
      );

      await expect(
        service.confirmHandshake({
          shipmentId: shipment.id,
          callerId: shipment.carrierId as string,
          nonce,
          signature,
          lat: -31.42,
          lng: -64.18,
        })
      ).rejects.toMatchObject({ statusCode: 409, code: "HANDSHAKE_CEDENTE_KEY_MISSING" });
    });

    it("422 HANDSHAKE_INVALID_SIGNATURE si la firma no verifica contra la clave del cedente", async () => {
      const shipment = fakeShipment({ status: ShipmentStatus.ASSIGNED });
      const redis = createFakeRedis();
      const { nonce } = await seedPendingChallenge(redis, shipment.id, "pickup", shipment.senderId, -31.42, -64.18);
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        fakeHandshakeRepository(),
        createFakeUsersClient({}, { [shipment.senderId]: { publicKey: publicKeyB64, registeredAt: new Date().toISOString() } }),
        redis,
        createFakeFundsReleaseNotifier()
      );

      await expect(
        service.confirmHandshake({
          shipmentId: shipment.id,
          callerId: shipment.carrierId as string,
          nonce,
          signature: Buffer.from("firma-invalida").toString("base64"),
          lat: -31.42,
          lng: -64.18,
        })
      ).rejects.toMatchObject({ statusCode: 422, code: "HANDSHAKE_INVALID_SIGNATURE" });
    });

    it("422 HANDSHAKE_DISTANCE_EXCEEDED si el receptor está a más de 100m del cedente", async () => {
      const shipment = fakeShipment({ status: ShipmentStatus.ASSIGNED });
      const redis = createFakeRedis();
      const { nonce, signature } = await seedPendingChallenge(
        redis,
        shipment.id,
        "pickup",
        shipment.senderId,
        -31.4201,
        -64.1888
      );
      const handshakeRepository = fakeHandshakeRepository();
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        handshakeRepository,
        createFakeUsersClient({}, { [shipment.senderId]: { publicKey: publicKeyB64, registeredAt: new Date().toISOString() } }),
        redis,
        createFakeFundsReleaseNotifier()
      );

      // ~1.57km de distancia -- muy por encima del umbral de 100m.
      await expect(
        service.confirmHandshake({
          shipmentId: shipment.id,
          callerId: shipment.carrierId as string,
          nonce,
          signature,
          lat: -31.4353,
          lng: -64.1858,
        })
      ).rejects.toMatchObject({ statusCode: 422, code: "HANDSHAKE_DISTANCE_EXCEEDED" });

      expect(handshakeRepository.confirmAndPersist).not.toHaveBeenCalled();
      // El desafío pendiente NO se consume -- reintentable dentro del mismo TTL.
      expect(redis.store.has(`handshake:pending:${shipment.id}`)).toBe(true);
    });

    it("confirma el retiro (assigned -> in_transit): transportista=actor, emisor=counterparty, sin liberar fondos", async () => {
      const shipment = fakeShipment({ status: ShipmentStatus.ASSIGNED });
      const redis = createFakeRedis();
      const { nonce, signature } = await seedPendingChallenge(
        redis,
        shipment.id,
        "pickup",
        shipment.senderId,
        -31.4201,
        -64.1888
      );
      const handshakeRepository = fakeHandshakeRepository();
      const fundsReleaseNotifier = createFakeFundsReleaseNotifier();
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        handshakeRepository,
        createFakeUsersClient({}, { [shipment.senderId]: { publicKey: publicKeyB64, registeredAt: new Date().toISOString() } }),
        redis,
        fundsReleaseNotifier
      );

      const result = await service.confirmHandshake({
        shipmentId: shipment.id,
        callerId: shipment.carrierId as string,
        nonce,
        signature,
        lat: -31.4201,
        lng: -64.1888,
      });

      expect(result.previousStatus).toBe(ShipmentStatus.ASSIGNED);
      expect(result.status).toBe(ShipmentStatus.IN_TRANSIT);
      expect(result.stage).toBe("pickup");
      expect(handshakeRepository.confirmAndPersist).toHaveBeenCalledWith(
        expect.objectContaining({
          shipmentId: shipment.id,
          from: ShipmentStatus.ASSIGNED,
          to: ShipmentStatus.IN_TRANSIT,
          stage: "pickup",
          actorId: shipment.carrierId,
          counterpartyId: shipment.senderId,
        })
      );

      await vi.waitFor(() => {
        expect(redis.store.has(`handshake:pending:${shipment.id}`)).toBe(false);
      });
      expect(fundsReleaseNotifier.notify).not.toHaveBeenCalled();
    });

    it("confirma la entrega (in_transit -> delivered): receptor=actor, transportista=counterparty, libera fondos", async () => {
      const shipment = fakeShipment({ status: ShipmentStatus.IN_TRANSIT });
      const redis = createFakeRedis();
      const { nonce, signature } = await seedPendingChallenge(
        redis,
        shipment.id,
        "delivery",
        shipment.carrierId as string,
        -31.4353,
        -64.1858
      );
      const handshakeRepository = fakeHandshakeRepository();
      const fundsReleaseNotifier = createFakeFundsReleaseNotifier();
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        handshakeRepository,
        createFakeUsersClient({}, { [shipment.carrierId as string]: { publicKey: publicKeyB64, registeredAt: new Date().toISOString() } }),
        redis,
        fundsReleaseNotifier
      );

      const result = await service.confirmHandshake({
        shipmentId: shipment.id,
        callerId: shipment.receiverId,
        nonce,
        signature,
        lat: -31.4353,
        lng: -64.1858,
      });

      expect(result.previousStatus).toBe(ShipmentStatus.IN_TRANSIT);
      expect(result.status).toBe(ShipmentStatus.DELIVERED);
      expect(result.stage).toBe("delivery");
      expect(handshakeRepository.confirmAndPersist).toHaveBeenCalledWith(
        expect.objectContaining({
          from: ShipmentStatus.IN_TRANSIT,
          to: ShipmentStatus.DELIVERED,
          stage: "delivery",
          actorId: shipment.receiverId,
          counterpartyId: shipment.carrierId,
        })
      );

      await vi.waitFor(() => {
        expect(fundsReleaseNotifier.notify).toHaveBeenCalledWith({
          shipmentId: shipment.id,
          carrierId: shipment.carrierId,
        });
      });
    });

    it("409 SHIPMENT_CONCURRENT_MODIFICATION se propaga tal cual si el repositorio pierde el CAS", async () => {
      const shipment = fakeShipment({ status: ShipmentStatus.ASSIGNED });
      const redis = createFakeRedis();
      const { nonce, signature } = await seedPendingChallenge(
        redis,
        shipment.id,
        "pickup",
        shipment.senderId,
        -31.4201,
        -64.1888
      );
      class FakeConcurrentError extends Error {}
      const service = createHandshakeService(
        fakeShipmentRepository({ findById: vi.fn().mockResolvedValue(shipment) }),
        fakeHandshakeRepository({ confirmAndPersist: vi.fn().mockRejectedValue(new FakeConcurrentError("race")) }),
        createFakeUsersClient({}, { [shipment.senderId]: { publicKey: publicKeyB64, registeredAt: new Date().toISOString() } }),
        redis,
        createFakeFundsReleaseNotifier()
      );

      await expect(
        service.confirmHandshake({
          shipmentId: shipment.id,
          callerId: shipment.carrierId as string,
          nonce,
          signature,
          lat: -31.4201,
          lng: -64.1888,
        })
      ).rejects.toThrow("race");
    });
  });
});
