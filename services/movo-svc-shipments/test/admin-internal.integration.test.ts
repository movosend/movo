import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";

describe("Partes de un envío y de un reporte de chat (Postgres) — MOVO-288", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;

  function baseInput(senderId: string, receiverId: string): CreateShipmentInput {
    return {
      senderId,
      receiverId,
      packageType: PackageType.standard_package,
      weightKg: 2.5,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      description: "Caja",
      pickupAddress: "Av. Colón 1234, Córdoba",
      pickupLat: -31.4201,
      pickupLng: -64.1888,
      deliveryAddress: "Bv. San Juan 500, Córdoba",
      deliveryLat: -31.4135,
      deliveryLng: -64.1811,
      pickupDate: new Date("2030-01-01T00:00:00.000Z"),
      pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      suggestedPriceArs: 4500,
    };
  }

  /** Fixture: crea el envío y fuerza el transportista directo en la base (no es el flujo real). */
  async function createShipment(carrierId: string | null = randomUUID()) {
    const senderId = randomUUID();
    const receiverId = randomUUID();
    const created = await shipmentRepo.create(baseInput(senderId, receiverId));
    await app.db.shipment.update({ where: { id: created.id }, data: { carrierId, status: "in_transit" } });
    return { shipmentId: created.id, senderId, receiverId, carrierId };
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    app = buildApp({
      usersClient: createFakeUsersClient({}),
      notificationsClient: { sendPush: async () => undefined },
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /internal/shipments/:id/parties", () => {
    it("devuelve emisor, transportista y receptor", async () => {
      const s = await createShipment();

      const response = await app.inject({ method: "GET", url: `/internal/shipments/${s.shipmentId}/parties` });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        shipmentId: s.shipmentId,
        senderId: s.senderId,
        carrierId: s.carrierId,
        receiverId: s.receiverId,
        formerReceiverIds: [],
      });
    });

    it("sin transportista asignado lo devuelve null", async () => {
      const s = await createShipment(null);

      const response = await app.inject({ method: "GET", url: `/internal/shipments/${s.shipmentId}/parties` });

      expect(response.json().carrierId).toBeNull();
    });

    it("incluye a quien transfirió el envío (ADR-038) y a quien lo rechazó antes de una redesignación (ADR-027)", async () => {
      const s = await createShipment();
      const transferred = randomUUID();
      const rejected = randomUUID();
      await app.db.receiverTransferRequest.create({
        data: {
          shipmentId: s.shipmentId,
          requestedBy: transferred,
          newReceiverId: s.receiverId,
          status: "completed",
          newReceiverDeadline: new Date(Date.now() + 3600_000),
          resolvedAt: new Date(),
        },
      });
      await app.db.shipmentEvent.create({
        data: {
          shipmentId: s.shipmentId,
          fromStatus: "awaiting_receiver_confirmation",
          toStatus: "rejected_by_receiver",
          actorId: rejected,
        },
      });

      const response = await app.inject({ method: "GET", url: `/internal/shipments/${s.shipmentId}/parties` });

      expect(response.json().formerReceiverIds.sort()).toEqual([transferred, rejected].sort());
    });

    it("un envío inexistente da 404", async () => {
      const response = await app.inject({ method: "GET", url: `/internal/shipments/${randomUUID()}/parties` });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /internal/chat-reports/:id/parties", () => {
    it("devuelve quien reportó y todas las partes del envío", async () => {
      const s = await createShipment();
      const report = await app.db.chatReport.create({ data: { shipmentId: s.shipmentId, reporterId: s.receiverId } });

      const response = await app.inject({ method: "GET", url: `/internal/chat-reports/${report.id}/parties` });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({ reportId: report.id, shipmentId: s.shipmentId, reporterId: s.receiverId });
      expect(body.partyIds.sort()).toEqual([s.senderId, s.receiverId, s.carrierId].sort());
    });

    it("un reporte inexistente da 404", async () => {
      const response = await app.inject({ method: "GET", url: `/internal/chat-reports/${randomUUID()}/parties` });

      expect(response.statusCode).toBe(404);
    });
  });
});
