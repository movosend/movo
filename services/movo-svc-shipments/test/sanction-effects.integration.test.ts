import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import {
  createShipmentRepository,
  ShipmentConcurrentModificationError,
  ShipmentRepository,
} from "../src/repositories/shipment-repository";
import { createShipmentsService } from "../src/modules/shipments/shipments.service";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";

const PICKUP_DATE = new Date("2030-01-01T00:00:00.000Z");

describe("Efectos de una sanción (Postgres) — MOVO-297", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let offerRepo: OfferRepository;
  const pushes: Array<{ userId: string; title: string; body: string }> = [];

  const userId = randomUUID();

  function shipmentInput(senderId: string, receiverId: string): CreateShipmentInput {
    return {
      senderId,
      receiverId,
      packageType: PackageType.standard_package,
      weightKg: 2.5,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
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
  }

  async function publishedShipment(senderId: string, receiverId = randomUUID()): Promise<string> {
    const created = await shipmentRepo.create(shipmentInput(senderId, receiverId));
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    return (await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null)).id;
  }

  /** Fixture: fuerza el estado y el transportista directo en la base (no es el flujo real). */
  async function shipmentIn(status: string, roles: { senderId?: string; carrierId?: string; receiverId?: string }) {
    const receiverId = roles.receiverId ?? randomUUID();
    const carrierId = roles.carrierId ?? randomUUID();
    const created = await shipmentRepo.create(shipmentInput(roles.senderId ?? randomUUID(), receiverId));
    await app.db.shipment.update({ where: { id: created.id }, data: { status: status as never, carrierId } });
    return { id: created.id, senderId: created.senderId, carrierId, receiverId };
  }

  function declaredTrip(carrierId: string) {
    return app.db.trip.create({
      data: {
        carrierId,
        originAddress: "Córdoba",
        originLat: -31.42,
        originLng: -64.19,
        destinationAddress: "Rosario",
        destinationLat: -32.95,
        destinationLng: -60.66,
        departureAt: new Date("2030-01-01T10:00:00Z"),
        vehicleType: "car",
      },
    });
  }

  const withdraw = (sanctionId?: string) =>
    app.inject({
      method: "POST",
      url: `/internal/users/${userId}/withdraw-open-activity`,
      ...(sanctionId ? { payload: { sanctionId } } : {}),
    });

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    app = buildApp({
      sweepEnabled: false,
      usersClient: createFakeUsersClient({}),
      notificationsClient: {
        sendPush: async ({ userId: to, title, body }) => {
          pushes.push({ userId: to, title, body });
        },
      },
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
    offerRepo = createOfferRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    pushes.length = 0;
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments, shipments.trips RESTART IDENTITY CASCADE");
    const keys = await app.redis.keys(`sanction-notice:${userId}:*`);
    if (keys.length > 0) await app.redis.del(...keys);
  });

  describe("GET /internal/users/:id/in-progress-shipments", () => {
    it("lista los envíos en curso como emisor, transportista o receptor y deja afuera el resto", async () => {
      const asSender = await shipmentIn("assignment_pending", { senderId: userId });
      const asCarrier = await shipmentIn("assigned", { carrierId: userId });
      const asReceiver = await shipmentIn("in_transit", { receiverId: userId });
      await shipmentIn("assigned_unfunded", { senderId: userId });
      await shipmentIn("delivered", { senderId: userId });
      await shipmentIn("cancelled", { carrierId: userId });
      await publishedShipment(userId);

      const response = await app.inject({ method: "GET", url: `/internal/users/${userId}/in-progress-shipments` });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Array<{ id: string; userRole: string; status: string }>;
      expect(body).toHaveLength(4);
      expect(body.find((s) => s.id === asSender.id)).toMatchObject({ userRole: "sender", status: "assignment_pending" });
      expect(body.find((s) => s.id === asCarrier.id)).toMatchObject({ userRole: "carrier", status: "assigned" });
      expect(body.find((s) => s.id === asReceiver.id)).toMatchObject({ userRole: "receiver", status: "in_transit" });
    });

    it("sin envíos en curso devuelve una lista vacía", async () => {
      const response = await app.inject({ method: "GET", url: `/internal/users/${randomUUID()}/in-progress-shipments` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });
  });

  describe("POST /internal/users/:id/withdraw-open-activity", () => {
    async function seed() {
      const published = await publishedShipment(userId);
      const foreignShipment = await publishedShipment(randomUUID());
      const offer = await offerRepo.create({ shipmentId: foreignShipment, carrierId: userId, priceOffered: 5000, offeredDate: PICKUP_DATE });
      const trip = await declaredTrip(userId);
      const inTransit = await shipmentIn("in_transit", { senderId: userId });
      return { published, offer, trip, inTransit };
    }

    it("deja al usuario solo con lo comprometido: retira publicado, oferta y viaje, y no toca lo en tránsito", async () => {
      const { published, offer, trip, inTransit } = await seed();

      const response = await withdraw();

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        cancelledShipmentIds: [published],
        withdrawnOfferIds: [offer.id],
        cancelledTripIds: [trip.id],
      });
      expect((await shipmentRepo.findById(published))?.status).toBe("cancelled");
      expect((await offerRepo.findById(offer.id))?.status).toBe("withdrawn");
      expect((await app.db.trip.findUnique({ where: { id: trip.id } }))?.status).toBe("cancelled");
      expect((await shipmentRepo.findById(inTransit.id))?.status).toBe("in_transit");

      const inProgress = await app.inject({ method: "GET", url: `/internal/users/${userId}/in-progress-shipments` });
      expect((inProgress.json() as Array<{ id: string }>).map((s) => s.id)).toEqual([inTransit.id]);
    });

    it("el envío cancelado queda en la línea de tiempo con el motivo 'cuenta suspendida'", async () => {
      const { published } = await seed();

      await withdraw();

      const events = await app.db.shipmentEvent.findMany({ where: { shipmentId: published, toStatus: "cancelled" } });
      expect(events).toHaveLength(1);
      expect(events[0]?.reason).toBe("cuenta suspendida");
    });

    it("no avisa al sancionado de cada cosa retirada", async () => {
      await seed();
      await withdraw();
      expect(pushes.filter((p) => p.userId === userId)).toEqual([]);
    });

    it("llamarlo dos veces no falla ni duplica eventos ni avisos", async () => {
      const { published } = await seed();

      const first = await withdraw();
      const pushesAfterFirst = pushes.length;
      const second = await withdraw();

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({
        cancelledShipmentIds: [],
        withdrawnOfferIds: [],
        cancelledTripIds: [],
        stoppedRecurrenceTripIds: [],
        notifiedCounterpartyCount: 0,
        failures: [],
      });
      expect(await app.db.shipmentEvent.count({ where: { shipmentId: published, toStatus: "cancelled" } })).toBe(1);
      expect(pushes.length).toBe(pushesAfterFirst);
    });

    it("avisa a las contrapartes de los envíos en curso con el texto genérico, sin el motivo", async () => {
      const carrierId = randomUUID();
      const receiverId = randomUUID();
      await shipmentIn("assigned", { senderId: userId, carrierId, receiverId });

      const response = await withdraw();

      expect(response.json().notifiedCounterpartyCount).toBe(2);
      expect(pushes.map((p) => p.userId).sort()).toEqual([carrierId, receiverId].sort());
      for (const push of pushes) {
        expect(push.body).toBe(
          "Esta persona no puede tomar nuevos envíos por ahora. Tu envío sigue en curso; si preferís, podés cancelarlo."
        );
        expect(push.body).not.toMatch(/suspend|sanci/i);
      }
    });

    it("un viaje con un paquete aceptado no se cancela", async () => {
      const trip = await declaredTrip(userId);
      const accepted = await shipmentIn("assigned", { carrierId: userId });
      await app.db.offer.create({
        data: {
          shipmentId: accepted.id,
          carrierId: userId,
          tripId: trip.id,
          priceOffered: 5000,
          offeredDate: PICKUP_DATE,
          status: "accepted",
        },
      });

      const response = await withdraw();

      expect(response.json().cancelledTripIds).toEqual([]);
      expect((await app.db.trip.findUnique({ where: { id: trip.id } }))?.status).toBe("declared");
    });

    it("las ofertas que recibió un envío cancelado quedan como shipment_cancelled y no se retiran a mano", async () => {
      const published = await publishedShipment(userId);
      const received = await offerRepo.create({ shipmentId: published, carrierId: randomUUID(), priceOffered: 5000, offeredDate: PICKUP_DATE });

      const response = await withdraw();

      expect(response.json().withdrawnOfferIds).toEqual([]);
      expect((await offerRepo.findById(received.id))?.status).toBe("shipment_cancelled");
    });
    it("cancela también los envíos que esperan al receptor y los rechazados por él", async () => {
      const awaiting = await shipmentRepo.create(shipmentInput(userId, randomUUID()));
      const rejected = await shipmentRepo.create(shipmentInput(userId, randomUUID()));
      await app.db.shipment.update({ where: { id: rejected.id }, data: { status: "rejected_by_receiver" } });

      const response = await withdraw();

      expect([...response.json().cancelledShipmentIds].sort()).toEqual([awaiting.id, rejected.id].sort());
      expect((await shipmentRepo.findById(awaiting.id))?.status).toBe("cancelled");
      expect((await shipmentRepo.findById(rejected.id))?.status).toBe("cancelled");
    });

    it("corta la serie recurrente de un viaje en curso sin cancelarlo", async () => {
      const active = await app.db.trip.create({
        data: {
          carrierId: userId,
          status: "active",
          originAddress: "Córdoba",
          originLat: -31.42,
          originLng: -64.19,
          destinationAddress: "Rosario",
          destinationLat: -32.95,
          destinationLng: -60.66,
          departureAt: new Date("2030-01-01T10:00:00Z"),
          vehicleType: "car",
          recurrenceWeekdays: [1, 3],
        },
      });

      const body = (await withdraw()).json();

      expect(body.stoppedRecurrenceTripIds).toEqual([active.id]);
      expect(body.cancelledTripIds).toEqual([]);
      const persisted = await app.db.trip.findUnique({ where: { id: active.id } });
      expect(persisted?.status).toBe("active");
      expect(persisted?.recurrenceWeekdays).toEqual([]);
    });

    it("con otro sanctionId vuelve a avisar a las contrapartes; con el mismo no", async () => {
      await shipmentIn("assigned", { senderId: userId, carrierId: randomUUID(), receiverId: randomUUID() });
      const first = randomUUID();

      expect((await withdraw(first)).json().notifiedCounterpartyCount).toBe(2);
      expect((await withdraw(first)).json().notifiedCounterpartyCount).toBe(0);
      expect((await withdraw(randomUUID())).json().notifiedCounterpartyCount).toBe(2);
    });

    it("rechaza un sanctionId que no es un uuid", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/internal/users/${userId}/withdraw-open-activity`,
        payload: { sanctionId: "no-es-uuid" },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("cancelShipment con onlyFrom", () => {
    it("no cancela un envío que se comprometió entre el listado y la cancelación", async () => {
      const shipmentId = await publishedShipment(userId);
      // Un pago o una aceptación lo pasó a `assignment_pending` después de listarlo.
      await app.db.shipment.update({ where: { id: shipmentId }, data: { status: "assignment_pending", carrierId: randomUUID() } });
      const service = createShipmentsService(shipmentRepo, createFakeUsersClient({}), undefined, undefined, { offerRepository: offerRepo });

      await expect(
        service.cancelShipment(shipmentId, userId, "cuenta suspendida", undefined, { onlyFrom: [ShipmentStatus.PUBLISHED] })
      ).rejects.toBeInstanceOf(ShipmentConcurrentModificationError);

      expect((await shipmentRepo.findById(shipmentId))?.status).toBe("assignment_pending");
    });
  });
});
