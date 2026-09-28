import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createShipmentsService } from "../src/modules/shipments/shipments.service";
import { CreateShipmentInput, PackageType } from "../src/models/shipment";
import { UsersClient } from "../src/adapters/users-client";
import { NotificationsClient } from "../src/adapters/notifications-client";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";

/**
 * MOVO-253: elegir otro receptor tras un rechazo (`POST /shipments/:id/receiver`),
 * cancelar un envío rechazado, el barrido que cierra los rechazos vencidos y el filtro
 * por estado de `GET /shipments/mine`. Postgres real.
 */
describe("MOVO-253: elegir otro receptor tras un rechazo (Postgres)", () => {
  let app: FastifyInstance;
  let repo: ShipmentRepository;
  let usersClient: UsersClient;
  let notificationsClient: NotificationsClient;

  const senderId = randomUUID();
  const rejecterId = randomUUID();
  const newReceiverId = randomUUID();
  const otherReceiverId = randomUUID();
  const unverifiedId = randomUUID();
  const blockedId = randomUUID();

  const baseInput: CreateShipmentInput = {
    senderId,
    receiverId: rejecterId,
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
    pickupDate: new Date("2030-01-01T00:00:00.000Z"),
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 4500,
    calculationMethod: null,
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    usersClient = createFakeUsersClient(
      {
        [senderId]: fakePublicProfile({ id: senderId, fullName: "Tomás" }),
        [rejecterId]: fakePublicProfile({ id: rejecterId, fullName: "Lucía" }),
        [newReceiverId]: fakePublicProfile({ id: newReceiverId, fullName: "Pedro" }),
        [otherReceiverId]: fakePublicProfile({ id: otherReceiverId, fullName: "Alena" }),
        [unverifiedId]: fakePublicProfile({ id: unverifiedId, isVerified: false }),
        [blockedId]: fakePublicProfile({ id: blockedId, fullName: "Juan" }),
      },
      {},
      [[senderId, blockedId]]
    );
    notificationsClient = createFakeNotificationsClient();
    app = buildApp({ usersClient, notificationsClient, sweepEnabled: false });
    await app.ready();
    repo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  /** Crea un envío y lo rechaza por HTTP, así el plazo sale del flujo real. */
  async function createRejectedShipment(reason = "No estoy en la ciudad") {
    const shipment = await repo.create(baseInput);
    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipment.id}/reject`,
      headers: { "x-user-id": rejecterId },
      payload: { reason },
    });
    expect(response.statusCode).toBe(200);
    return shipment;
  }

  function redesignate(shipmentId: string, receiverId: string, callerId = senderId) {
    return app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/receiver`,
      headers: { "x-user-id": callerId },
      payload: { receiverId },
    });
  }

  describe("POST /shipments/:id/receiver", () => {
    it("AC1: el emisor elige otro receptor, el envío vuelve a esperar confirmación y el nuevo recibe la push", async () => {
      const shipment = await createRejectedShipment();
      vi.clearAllMocks();

      const before = Date.now();
      const response = await redesignate(shipment.id, newReceiverId);

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.status).toBe(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);
      expect(data.receiverId).toBe(newReceiverId);
      expect(data.receiverRedesignationDeadline).toBeNull();
      expect(data.rejectionReason).toBeNull();
      // Plazo de confirmación nuevo, a partir de ahora (48hs, la ventana de 2030 no lo topea).
      expect(new Date(data.receiverConfirmationDeadline).getTime()).toBeGreaterThanOrEqual(
        before + 47 * 60 * 60 * 1000
      );

      const events = await repo.listEvents(shipment.id);
      expect(events.at(-1)).toMatchObject({
        fromStatus: ShipmentStatus.REJECTED_BY_RECEIVER,
        toStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
        actorId: senderId,
      });

      await vi.waitFor(() => {
        expect(notificationsClient.sendPush).toHaveBeenCalledWith({
          userId: newReceiverId,
          title: "Tenés un envío nuevo para confirmar",
          body: "Tomás te envió un paquete. Tocá para revisar y confirmar el envío.",
          category: "shipments",
          data: { type: "shipment", shipmentId: shipment.id },
        });
      });
    });

    it("AC1: el receptor nuevo puede aceptar el envío con el plazo nuevo", async () => {
      const shipment = await createRejectedShipment();
      await redesignate(shipment.id, newReceiverId);

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/reject`,
        headers: { "x-user-id": newReceiverId },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe(ShipmentStatus.REJECTED_BY_RECEIVER);
    });

    it("AC9: el receptor que rechazó deja de ver el envío", async () => {
      const shipment = await createRejectedShipment();
      await redesignate(shipment.id, newReceiverId);

      const response = await app.inject({
        method: "GET",
        url: `/shipments/${shipment.id}`,
        headers: { "x-user-id": rejecterId },
      });
      expect(response.statusCode).toBe(403);
    });

    it("solo el emisor puede elegir otro receptor", async () => {
      const shipment = await createRejectedShipment();

      const response = await redesignate(shipment.id, newReceiverId, rejecterId);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
    });

    it("409 si el envío no está rechazado", async () => {
      const shipment = await repo.create(baseInput);

      const response = await redesignate(shipment.id, newReceiverId);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_INVALID_TRANSITION");
    });

    it("404 si el envío no existe", async () => {
      const response = await redesignate(randomUUID(), newReceiverId);
      expect(response.statusCode).toBe(404);
    });

    it("AC2: 409 con el plazo vencido, aunque el barrido no haya corrido", async () => {
      const shipment = await createRejectedShipment();
      await app.db.shipment.update({
        where: { id: shipment.id },
        data: { receiverRedesignationDeadline: new Date(Date.now() - 1000) },
      });

      const response = await redesignate(shipment.id, newReceiverId);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_REDESIGNATION_EXPIRED");
    });

    it("AC2: un rechazo anterior a MOVO-253 (plazo nulo) cuenta como vencido", async () => {
      const shipment = await repo.create(baseInput);
      await repo.updateStatus(shipment.id, ShipmentStatus.REJECTED_BY_RECEIVER, rejecterId);

      const response = await redesignate(shipment.id, newReceiverId);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_REDESIGNATION_EXPIRED");
    });

    it("AC2: no se puede elegir a uno mismo", async () => {
      const shipment = await createRejectedShipment();

      const response = await redesignate(shipment.id, senderId);
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("SHIPMENT_RECEIVER_IS_SENDER");
    });

    it("AC2: no se puede volver a elegir a quien ya rechazó el envío", async () => {
      const shipment = await createRejectedShipment();

      const response = await redesignate(shipment.id, rejecterId);
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("SHIPMENT_RECEIVER_ALREADY_REJECTED");
    });

    it("AC2: tampoco a quien rechazó en una vuelta anterior", async () => {
      const shipment = await createRejectedShipment();
      await redesignate(shipment.id, newReceiverId);
      await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/reject`,
        headers: { "x-user-id": newReceiverId },
      });

      const backToFirst = await redesignate(shipment.id, rejecterId);
      expect(backToFirst.statusCode).toBe(422);
      expect(backToFirst.json().error.code).toBe("SHIPMENT_RECEIVER_ALREADY_REJECTED");

      const toThird = await redesignate(shipment.id, otherReceiverId);
      expect(toThird.statusCode).toBe(200);
    });

    it("AC2: no se puede elegir a alguien sin KYC aprobado", async () => {
      const shipment = await createRejectedShipment();

      const response = await redesignate(shipment.id, unverifiedId);
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("SHIPMENT_RECEIVER_KYC_NOT_APPROVED");
    });

    it("404 si el receptor elegido no existe", async () => {
      const shipment = await createRejectedShipment();

      const response = await redesignate(shipment.id, randomUUID());
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("USER_NOT_FOUND");
    });

    it("AC2: no se puede elegir a alguien con un bloqueo (ADR-026)", async () => {
      const shipment = await createRejectedShipment();

      const response = await redesignate(shipment.id, blockedId);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("USER_BLOCKED");
    });

    it("dos elecciones concurrentes: una gana y la otra recibe 409", async () => {
      const shipment = await createRejectedShipment();

      const [first, second] = await Promise.all([
        redesignate(shipment.id, newReceiverId),
        redesignate(shipment.id, otherReceiverId),
      ]);
      const codes = [first.statusCode, second.statusCode].sort();
      expect(codes).toEqual([200, 409]);

      const events = await repo.listEvents(shipment.id);
      expect(events.filter((e) => e.fromStatus === ShipmentStatus.REJECTED_BY_RECEIVER)).toHaveLength(1);
    });

    it("400 si receiverId no es un uuid", async () => {
      const shipment = await createRejectedShipment();

      const response = await redesignate(shipment.id, "no-es-uuid");
      expect(response.statusCode).toBe(400);
    });
  });

  describe("AC4: POST /shipments/:id/cancel sobre un envío rechazado", () => {
    it("el emisor puede cancelarlo", async () => {
      const shipment = await createRejectedShipment();

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/cancel`,
        headers: { "x-user-id": senderId },
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe(ShipmentStatus.CANCELLED);
    });
  });

  describe("AC3: expireRejectedShipments (barrido)", () => {
    function buildService() {
      return createShipmentsService(repo, usersClient, notificationsClient);
    }

    it("cancela los rechazos con plazo vencido o nulo y deja los vigentes", async () => {
      const expired = await createRejectedShipment();
      await app.db.shipment.update({
        where: { id: expired.id },
        data: { receiverRedesignationDeadline: new Date(Date.now() - 60_000) },
      });
      const legacy = await repo.create(baseInput);
      await repo.updateStatus(legacy.id, ShipmentStatus.REJECTED_BY_RECEIVER, rejecterId);
      const current = await createRejectedShipment();
      vi.clearAllMocks();

      const result = await buildService().expireRejectedShipments();

      expect(result).toEqual({ expiredCount: 2, errorsCount: 0 });
      expect((await repo.findById(expired.id))?.status).toBe(ShipmentStatus.CANCELLED);
      expect((await repo.findById(legacy.id))?.status).toBe(ShipmentStatus.CANCELLED);
      expect((await repo.findById(current.id))?.status).toBe(ShipmentStatus.REJECTED_BY_RECEIVER);

      const events = await repo.listEvents(expired.id);
      expect(events.at(-1)).toMatchObject({
        fromStatus: ShipmentStatus.REJECTED_BY_RECEIVER,
        toStatus: ShipmentStatus.CANCELLED,
        actorId: null,
        reason: "El emisor no eligió otro receptor dentro del plazo",
      });

      await vi.waitFor(() => {
        expect(notificationsClient.sendPush).toHaveBeenCalledWith({
          userId: senderId,
          title: "Envío cancelado",
          body: "Tu envío se canceló: no elegiste otro receptor a tiempo",
          category: "shipments",
          data: { shipmentId: expired.id, type: "shipment_cancelled" },
        });
      });
    });

    it("sin candidatos no hace nada", async () => {
      await createRejectedShipment();

      const result = await buildService().expireRejectedShipments();
      expect(result).toEqual({ expiredCount: 0, errorsCount: 0 });
    });
  });

  describe("AC8: GET /shipments/mine?status=", () => {
    it("filtra por uno o varios estados", async () => {
      const rejected = await createRejectedShipment();
      const awaiting = await repo.create(baseInput);
      const cancelled = await repo.create(baseInput);
      await repo.updateStatus(cancelled.id, ShipmentStatus.CANCELLED, senderId);

      const one = await app.inject({
        method: "GET",
        url: "/shipments/mine?status=rejected_by_receiver",
        headers: { "x-user-id": senderId },
      });
      expect(one.statusCode).toBe(200);
      expect(one.json().items.map((s: { id: string }) => s.id)).toEqual([rejected.id]);
      expect(one.json().items[0].rejectionReason).toBe("No estoy en la ciudad");
      expect(one.json().total).toBe(1);

      const two = await app.inject({
        method: "GET",
        url: "/shipments/mine?status=rejected_by_receiver&status=awaiting_receiver_confirmation",
        headers: { "x-user-id": senderId },
      });
      expect(two.json().items.map((s: { id: string }) => s.id).sort()).toEqual([rejected.id, awaiting.id].sort());

      const all = await app.inject({
        method: "GET",
        url: "/shipments/mine",
        headers: { "x-user-id": senderId },
      });
      expect(all.json().total).toBe(3);
    });

    it("400 con un estado inválido", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/shipments/mine?status=no_existe",
        headers: { "x-user-id": senderId },
      });
      expect(response.statusCode).toBe(400);
    });
  });
});
