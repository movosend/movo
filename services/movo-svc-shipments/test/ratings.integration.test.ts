import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";

const PICKUP_DATE = new Date("2030-01-01T00:00:00.000Z");
const DELIVERED_AT_HOURS_AGO = 1; // dentro de la ventana de 72hs (AC8)

describe("Calificaciones post-entrega — /shipments/:id/ratings (Postgres) — MOVO-146", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  const sendPush = vi.fn().mockResolvedValue(undefined);

  const senderId = randomUUID();
  const receiverId = randomUUID();
  const carrierId = randomUUID();

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

  /** Lleva un envío hasta `delivered` bypaseando la máquina de estados vía repositorio
   * (fixture, no flujo real) -- mismo criterio que shipments-cancel.integration.test.ts.
   * Las 2 fotos de creation satisfacen el gate de AC6 de MOVO-81 para llegar a `published`. */
  async function createDeliveredShipment(deliveredHoursAgo = DELIVERED_AT_HOURS_AGO): Promise<string> {
    const created = await shipmentRepo.create(baseShipmentInput);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    await shipmentRepo.updateStatus(created.id, ShipmentStatus.ASSIGNMENT_PENDING, null);
    await shipmentRepo.updateStatus(created.id, ShipmentStatus.ASSIGNED, null);
    await shipmentRepo.updateStatus(created.id, ShipmentStatus.IN_TRANSIT, null);
    await shipmentRepo.updateStatus(created.id, ShipmentStatus.DELIVERED, null);

    // `updateStatus` persiste `deliveredAt = now()` -- se pisa a mano para poder probar
    // la ventana de 72hs (AC8) sin tener que mockear el reloj del proceso.
    await app.db.shipment.update({
      where: { id: created.id },
      data: { deliveredAt: new Date(Date.now() - deliveredHoursAgo * 60 * 60 * 1000) },
    });

    return created.id;
  }

  async function createNonDeliveredShipment(): Promise<string> {
    const created = await shipmentRepo.create(baseShipmentInput);
    return created.id;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    app = buildApp({
      usersClient: createFakeUsersClient({}),
      notificationsClient: { sendPush },
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // CASCADE también vacía shipments.ratings/shipments.offers (FK a shipments.shipments).
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
    sendPush.mockClear();
  });

  // Único carrier asignado -- se persiste vía updateStatus a `assigned` de arriba, que no
  // setea carrierId por sí solo. Se asigna a mano acá para simplificar el fixture.
  async function assignCarrier(shipmentId: string): Promise<void> {
    await app.db.shipment.update({ where: { id: shipmentId }, data: { carrierId } });
  }

  it("AC1/AC7: alta feliz -- persiste la calificación y dispara la push al calificado", async () => {
    const shipmentId = await createDeliveredShipment();
    await assignCarrier(shipmentId);

    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/ratings`,
      headers: { "x-user-id": senderId },
      payload: { rateeId: receiverId, score: 5, comment: "Todo perfecto" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      shipmentId,
      raterId: senderId,
      rateeId: receiverId,
      role: "receiver",
      score: 5,
      comment: "Todo perfecto",
    });
    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ userId: receiverId, data: { type: "rating_received", shipmentId } }),
    );
  });

  it("AC3: envío no entregado → rechazo (409 SHIPMENT_NOT_DELIVERED)", async () => {
    const shipmentId = await createNonDeliveredShipment();

    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/ratings`,
      headers: { "x-user-id": senderId },
      payload: { rateeId: receiverId, score: 5 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SHIPMENT_NOT_DELIVERED");
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("AC3: calificador ajeno al envío → 403", async () => {
    const shipmentId = await createDeliveredShipment();

    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/ratings`,
      headers: { "x-user-id": randomUUID() },
      payload: { rateeId: receiverId, score: 5 },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
  });

  it("AC3: autocalificación → 403", async () => {
    const shipmentId = await createDeliveredShipment();

    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/ratings`,
      headers: { "x-user-id": senderId },
      payload: { rateeId: senderId, score: 5 },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
  });

  it("AC2/AC5: doble calificación → 409 SHIPMENT_RATING_ALREADY_EXISTS", async () => {
    const shipmentId = await createDeliveredShipment();

    const first = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/ratings`,
      headers: { "x-user-id": senderId },
      payload: { rateeId: receiverId, score: 5 },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/ratings`,
      headers: { "x-user-id": senderId },
      payload: { rateeId: receiverId, score: 3 },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("SHIPMENT_RATING_ALREADY_EXISTS");
  });

  it("AC4: score fuera de rango → 400", async () => {
    const shipmentId = await createDeliveredShipment();

    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/ratings`,
      headers: { "x-user-id": senderId },
      payload: { rateeId: receiverId, score: 6 },
    });

    expect(response.statusCode).toBe(400);
  });

  it("AC8: ventana de 72hs vencida → 409 SHIPMENT_RATING_WINDOW_EXPIRED", async () => {
    const shipmentId = await createDeliveredShipment(73);

    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/ratings`,
      headers: { "x-user-id": senderId },
      payload: { rateeId: receiverId, score: 5 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SHIPMENT_RATING_WINDOW_EXPIRED");
  });

  it("AC9: disputa activa → 409 SHIPMENT_RATING_DISPUTE_ACTIVE", async () => {
    const shipmentId = await createDeliveredShipment();
    await shipmentRepo.updateStatus(shipmentId, ShipmentStatus.DISPUTED, null);

    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/ratings`,
      headers: { "x-user-id": senderId },
      payload: { rateeId: receiverId, score: 5 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SHIPMENT_RATING_DISPUTE_ACTIVE");
  });

  it("AC5: PATCH edita la fila existente en vez de crear una segunda", async () => {
    const shipmentId = await createDeliveredShipment();
    await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/ratings`,
      headers: { "x-user-id": senderId },
      payload: { rateeId: receiverId, score: 3, comment: "regular" },
    });

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/shipments/${shipmentId}/ratings/${receiverId}`,
      headers: { "x-user-id": senderId },
      payload: { score: 5, comment: "mejoró en la entrega" },
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json()).toMatchObject({ score: 5, comment: "mejoró en la entrega" });

    const listResponse = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/ratings`,
      headers: { "x-user-id": senderId },
    });
    expect(listResponse.json()).toHaveLength(1);
  });

  it("AC6: GET /shipments/:id/ratings devuelve las calificaciones a sus participantes", async () => {
    const shipmentId = await createDeliveredShipment();
    await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/ratings`,
      headers: { "x-user-id": senderId },
      payload: { rateeId: receiverId, score: 4 },
    });

    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/ratings`,
      headers: { "x-user-id": receiverId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
  });

  it("AC6: GET /shipments/:id/ratings responde 403 a un usuario ajeno", async () => {
    const shipmentId = await createDeliveredShipment();

    const response = await app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/ratings`,
      headers: { "x-user-id": randomUUID() },
    });

    expect(response.statusCode).toBe(403);
  });

  it("AC10: GET /internal/users/:id/ratings/recent devuelve las últimas calificaciones recibidas", async () => {
    const shipmentId = await createDeliveredShipment();
    await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/ratings`,
      headers: { "x-user-id": senderId },
      payload: { rateeId: receiverId, score: 4, comment: "buena onda" },
    });

    const response = await app.inject({
      method: "GET",
      url: `/internal/users/${receiverId}/ratings/recent`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // MOVO-170: paginado (`{items, nextCursor}`), antes un array plano.
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ rateeId: receiverId, score: 4, comment: "buena onda" });
    expect(body.nextCursor).toBeNull();
  });

  it("MOVO-170: pagina con cursor -- segunda página trae el resto, nextCursor null al agotarse", async () => {
    for (let i = 0; i < 3; i += 1) {
      const shipmentId = await createDeliveredShipment();
      await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/ratings`,
        headers: { "x-user-id": senderId },
        payload: { rateeId: receiverId, score: 4 },
      });
    }

    const firstPage = await app.inject({
      method: "GET",
      url: `/internal/users/${receiverId}/ratings/recent?limit=2`,
    });
    expect(firstPage.json().items).toHaveLength(2);
    expect(firstPage.json().nextCursor).not.toBeNull();

    const secondPage = await app.inject({
      method: "GET",
      url: `/internal/users/${receiverId}/ratings/recent?limit=2&cursor=${encodeURIComponent(firstPage.json().nextCursor)}`,
    });
    expect(secondPage.json().items).toHaveLength(1);
    expect(secondPage.json().nextCursor).toBeNull();

    const firstPageIds = firstPage.json().items.map((r: { id: string }) => r.id);
    const secondPageIds = secondPage.json().items.map((r: { id: string }) => r.id);
    expect(new Set([...firstPageIds, ...secondPageIds]).size).toBe(3);
  });

  describe("MOVO-147: GET /internal/users/:id/reputation", () => {
    it("sin calificaciones -- reputationScore null, isNewProfile true, transactionCounts en 0", async () => {
      const strangerId = randomUUID();

      const response = await app.inject({ method: "GET", url: `/internal/users/${strangerId}/reputation` });

      expect(response.statusCode).toBe(200);
      const noUsage = { delivered: 0, cancelled: 0, avgPackageWeightKg: null };
      expect(response.json()).toEqual({
        reputationScore: null,
        ratingCount: 0,
        isNewProfile: true,
        asSender: { reputationScore: null, ratingCount: 0, isNewProfile: true, usageStats: noUsage },
        asCarrier: { reputationScore: null, ratingCount: 0, isNewProfile: true, usageStats: noUsage },
        transactionCounts: { asSender: 0, asCarrier: 0 },
      });
    });

    it("AC2: con menos de 3 calificaciones, isNewProfile es true pero el score no es null", async () => {
      const shipmentId = await createDeliveredShipment();
      await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/ratings`,
        headers: { "x-user-id": receiverId },
        payload: { rateeId: senderId, score: 5 },
      });

      const response = await app.inject({ method: "GET", url: `/internal/users/${senderId}/reputation` });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ratingCount).toBe(1);
      expect(body.isNewProfile).toBe(true);
      expect(body.reputationScore).not.toBeNull();
    });

    it("AC2/AC3: con 3 calificaciones isNewProfile pasa a false, sin contaminar un rol nunca calificado", async () => {
      for (let i = 0; i < 3; i += 1) {
        const shipmentId = await createDeliveredShipment();
        await app.inject({
          method: "POST",
          url: `/shipments/${shipmentId}/ratings`,
          headers: { "x-user-id": receiverId },
          payload: { rateeId: senderId, score: 4 },
        });
      }

      const response = await app.inject({ method: "GET", url: `/internal/users/${senderId}/reputation` });
      const body = response.json();

      expect(body.ratingCount).toBe(3);
      expect(body.isNewProfile).toBe(false);
      // MOVO-170: las 3 calificaciones se hicieron sobre 3 envíos delivered creados con
      // senderId como sender (baseShipmentInput.weightKg fijo en 2.5) -- usageStats
      // refleja ese fixture, no las calificaciones en sí.
      expect(body.asSender).toEqual({
        reputationScore: body.reputationScore,
        ratingCount: 3,
        isNewProfile: false,
        usageStats: { delivered: 3, cancelled: 0, avgPackageWeightKg: 2.5 },
      });
      // senderId nunca fue calificado en rol carrier en este fixture -- ese bucket
      // queda intacto ("sin calificaciones"), no contaminado por las 3 de arriba.
      expect(body.asCarrier).toEqual({
        reputationScore: null,
        ratingCount: 0,
        isNewProfile: true,
        usageStats: { delivered: 0, cancelled: 0, avgPackageWeightKg: null },
      });
    });

    it("AC3/AC6: transactionCounts cuenta solo envíos delivered, separado por rol", async () => {
      const delivered1 = await createDeliveredShipment();
      await assignCarrier(delivered1);
      const delivered2 = await createDeliveredShipment();
      await assignCarrier(delivered2);
      await createNonDeliveredShipment(); // no debe contar -- no está delivered

      const senderResponse = await app.inject({ method: "GET", url: `/internal/users/${senderId}/reputation` });
      expect(senderResponse.json().transactionCounts).toEqual({ asSender: 2, asCarrier: 0 });

      const carrierResponse = await app.inject({ method: "GET", url: `/internal/users/${carrierId}/reputation` });
      expect(carrierResponse.json().transactionCounts).toEqual({ asSender: 0, asCarrier: 2 });
    });
  });
});
