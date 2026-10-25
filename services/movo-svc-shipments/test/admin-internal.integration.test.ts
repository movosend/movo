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

    it("incluye a quien transfirió el envío (DD-038) y a quien lo rechazó antes de una redesignación (DD-027)", async () => {
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

  describe("secciones de la ficha de un usuario (MOVO-294)", () => {
    async function shipmentWith(parties: { senderId?: string; carrierId?: string | null; receiverId?: string }, status = "published") {
      const created = await shipmentRepo.create(baseInput(parties.senderId ?? randomUUID(), parties.receiverId ?? randomUUID()));
      await app.db.shipment.update({
        where: { id: created.id },
        data: { carrierId: parties.carrierId ?? null, status: status as "published", agreedPriceArs: parties.carrierId ? 6000 : null },
      });
      return created.id;
    }

    it("lista los envíos del usuario con su rol, los ids de las partes y los conteos por rol", async () => {
      const userId = randomUUID();
      const asSender = await shipmentWith({ senderId: userId });
      const asCarrier = await shipmentWith({ carrierId: userId }, "in_transit");
      await shipmentWith({ receiverId: userId }, "in_transit");
      await shipmentWith({});

      const response = await app.inject({ method: "GET", url: `/internal/admin/users/${userId}/shipments?pageSize=2` });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(3);
      expect(body.items).toHaveLength(2);
      expect(body.counts).toEqual({ sender: 1, carrier: 1, receiver: 1 });

      const all = (await app.inject({ method: "GET", url: `/internal/admin/users/${userId}/shipments?pageSize=10` })).json();
      const carried = all.items.find((item: { id: string }) => item.id === asCarrier);
      expect(carried).toMatchObject({ userRole: "carrier", carrierId: userId, priceArs: 6000, shortId: asCarrier.slice(0, 8).toUpperCase() });
      expect(all.items.find((item: { id: string }) => item.id === asSender)).toMatchObject({ userRole: "sender", carrierId: null, priceArs: 4500 });
    });

    it("filtra por rol y por estado", async () => {
      const userId = randomUUID();
      await shipmentWith({ senderId: userId });
      const inTransit = await shipmentWith({ senderId: userId }, "in_transit");
      await shipmentWith({ receiverId: userId }, "in_transit");

      const bySender = (await app.inject({ method: "GET", url: `/internal/admin/users/${userId}/shipments?role=sender&status=in_transit` })).json();
      expect(bySender.items.map((item: { id: string }) => item.id)).toEqual([inTransit]);
      expect(bySender.counts).toEqual({ sender: 1, carrier: 0, receiver: 1 });

      const invalid = await app.inject({ method: "GET", url: `/internal/admin/users/${userId}/shipments?role=admin` });
      expect(invalid.statusCode).toBe(400);
    });

    it("lista los viajes del transportista, con la recurrencia, del más lejano al más cercano", async () => {
      const carrierId = randomUUID();
      const trip = (departureAt: string, recurrenceWeekdays: number[] = []) =>
        app.db.trip.create({
          data: {
            carrierId,
            originAddress: "Córdoba",
            originLat: -31.42,
            originLng: -64.19,
            destinationAddress: "Rosario",
            destinationLat: -32.95,
            destinationLng: -60.66,
            departureAt: new Date(departureAt),
            vehicleType: "car",
            recurrenceWeekdays,
          },
        });
      const older = await trip("2030-01-01T10:00:00Z");
      const newer = await trip("2030-02-01T10:00:00Z", [1, 3]);

      const body = (await app.inject({ method: "GET", url: `/internal/admin/users/${carrierId}/trips` })).json();
      expect(body.total).toBe(2);
      expect(body.items.map((item: { id: string }) => item.id)).toEqual([newer.id, older.id]);
      expect(body.items[0]).toMatchObject({ status: "declared", recurring: true, originAddress: "Córdoba" });
      expect(body.items[1].recurring).toBe(false);

      const filtered = (await app.inject({ method: "GET", url: `/internal/admin/users/${carrierId}/trips?status=active` })).json();
      expect(filtered.total).toBe(0);
    });

    it("devuelve las calificaciones recibidas con el promedio de todas", async () => {
      const rateeId = randomUUID();
      const raterId = randomUUID();
      for (const score of [5, 4, 2]) {
        const shipmentId = await shipmentWith({ carrierId: rateeId }, "completed");
        await app.db.rating.create({ data: { shipmentId, raterId, rateeId, role: "carrier", score, comment: score === 2 ? "Llegó tarde" : null } });
      }

      const body = (await app.inject({ method: "GET", url: `/internal/admin/users/${rateeId}/ratings?pageSize=2` })).json();
      expect(body.count).toBe(3);
      expect(body.average).toBe(3.67);
      expect(body.items).toHaveLength(2);
      expect(body.items[0]).toMatchObject({ raterId, roleOfRated: "carrier" });
    });

    it("un usuario sin actividad devuelve listas vacías", async () => {
      const userId = randomUUID();
      const ratings = (await app.inject({ method: "GET", url: `/internal/admin/users/${userId}/ratings` })).json();
      expect(ratings).toEqual({ average: null, count: 0, items: [], page: 1, pageSize: 5 });
      const shipments = (await app.inject({ method: "GET", url: `/internal/admin/users/${userId}/shipments` })).json();
      expect(shipments).toMatchObject({ items: [], total: 0, counts: { sender: 0, carrier: 0, receiver: 0 } });
    });
  });
});
