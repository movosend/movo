import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { NotificationsClient, SendPushNotificationInput } from "../src/adapters/notifications-client";
import { buildReceiverTransfersService } from "../src/modules/receiver-transfers/receiver-transfers.routes";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";

/**
 * MOVO-275 (ADR-038): transferencia de receptor contra Postgres y Redis reales (AC9):
 * cada validación, aceptar/rechazar/cancelar, el límite de una transferencia, la carrera
 * con el handshake de entrega, el vencimiento, el acceso de solo lectura del receptor
 * original y el filtrado de la línea de tiempo por quien mira.
 */
describe("MOVO-275: transferencia de receptor (Postgres + Redis)", () => {
  let app: FastifyInstance;
  let repo: ShipmentRepository;
  let notificationsClient: NotificationsClient;

  const senderId = randomUUID();
  const receiverId = randomUUID();
  const carrierId = randomUUID();
  const invitedId = randomUUID();
  const otherInvitedId = randomUUID();
  const unverifiedId = randomUUID();
  const blockedWithSenderId = randomUUID();
  const strangerId = randomUUID();

  const baseInput: CreateShipmentInput = {
    senderId,
    receiverId,
    packageType: PackageType.standard_package,
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    pickupAddress: "Bv. San Juan 850, Córdoba",
    pickupLat: -31.4201,
    pickupLng: -64.1888,
    deliveryAddress: "Av. Colón 1234, Córdoba",
    deliveryLat: -31.4135,
    deliveryLng: -64.1811,
    pickupDate: new Date("2030-01-01T00:00:00.000Z"),
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 8400,
    calculationMethod: null,
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    const usersClient = createFakeUsersClient(
      {
        [senderId]: fakePublicProfile({ id: senderId, fullName: "Juan Pérez" }),
        [receiverId]: fakePublicProfile({ id: receiverId, fullName: "Lucía Gómez" }),
        [carrierId]: fakePublicProfile({ id: carrierId, fullName: "Diego Sosa" }),
        [invitedId]: fakePublicProfile({ id: invitedId, fullName: "Martín López" }),
        [otherInvitedId]: fakePublicProfile({ id: otherInvitedId, fullName: "Carla Ruiz" }),
        [unverifiedId]: fakePublicProfile({ id: unverifiedId, isVerified: false }),
        [blockedWithSenderId]: fakePublicProfile({ id: blockedWithSenderId, fullName: "Ana" }),
        [strangerId]: fakePublicProfile({ id: strangerId, fullName: "Otro" }),
      },
      {},
      [[senderId, blockedWithSenderId]]
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

  /** Lleva un envío a `in_transit` por repositorio (no hay flujo real que llegue a
   * `assigned` hasta MOVO-210), mismo criterio que `handshake.integration.test.ts`. */
  async function createShipment(status: ShipmentStatus = ShipmentStatus.IN_TRANSIT): Promise<string> {
    const created = await repo.create(baseInput);
    if (status === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION) {
      return created.id;
    }
    await repo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await repo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await repo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    if (status === ShipmentStatus.PUBLISHED) {
      return created.id;
    }
    await repo.updateStatus(created.id, ShipmentStatus.ASSIGNMENT_PENDING, null);
    await app.db.shipment.update({ where: { id: created.id }, data: { carrierId } });
    await repo.updateStatus(created.id, ShipmentStatus.ASSIGNED, null);
    if (status === ShipmentStatus.ASSIGNED) {
      return created.id;
    }
    await repo.updateStatus(created.id, ShipmentStatus.IN_TRANSIT, carrierId);
    if (status === ShipmentStatus.IN_TRANSIT) {
      return created.id;
    }
    await repo.updateStatus(created.id, ShipmentStatus.DELIVERED, receiverId);
    return created.id;
  }

  function requestTransfer(shipmentId: string, newReceiverId: string, callerId = receiverId, reason?: string) {
    return app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/receiver-transfer`,
      headers: { "x-user-id": callerId },
      payload: { newReceiverId, ...(reason ? { reason } : {}) },
    });
  }

  function act(transferId: string, action: "accept" | "reject" | "cancel", callerId: string, payload?: object) {
    return app.inject({
      method: "POST",
      url: `/receiver-transfers/${transferId}/${action}`,
      headers: { "x-user-id": callerId },
      ...(payload ? { payload } : {}),
    });
  }

  function pushesTo(userId: string): SendPushNotificationInput[] {
    return vi
      .mocked(notificationsClient.sendPush)
      .mock.calls.map(([input]) => input)
      .filter((input) => input.userId === userId);
  }

  async function settle() {
    // Las push son fire-and-forget: esperar a que se resuelvan antes de mirar el mock.
    await new Promise((resolve) => setImmediate(resolve));
  }

  describe("POST /shipments/:id/receiver-transfer (AC1)", () => {
    it("el receptor pide la transferencia con el paquete en camino; invitada y emisor reciben la push", async () => {
      const shipmentId = await createShipment();

      const response = await requestTransfer(shipmentId, invitedId, receiverId, "Esa semana estoy de viaje");

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data).toMatchObject({
        shipmentId,
        requestedBy: receiverId,
        requesterName: "Lucía Gómez",
        newReceiverId: invitedId,
        newReceiverName: "Martín López",
        reason: "Esa semana estoy de viaje",
        status: "pending_new_receiver",
        cancelReason: null,
        resolvedAt: null,
      });
      const deadlineMs = new Date(data.newReceiverDeadline).getTime();
      expect(deadlineMs - Date.now()).toBeGreaterThan(5.9 * 3600_000);
      expect(deadlineMs - Date.now()).toBeLessThanOrEqual(6 * 3600_000);

      const shipment = await repo.findById(shipmentId);
      expect(shipment?.receiverId).toBe(receiverId);
      expect(shipment?.status).toBe(ShipmentStatus.IN_TRANSIT);

      await settle();
      expect(pushesTo(invitedId)).toHaveLength(1);
      expect(pushesTo(invitedId)[0].data).toMatchObject({ type: "receiver_transfer_invite", transferId: data.id });
      expect(pushesTo(senderId)).toHaveLength(1);
      expect(pushesTo(senderId)[0].body).toContain("Martín López");
    });

    it("solo el receptor actual puede pedirla (403)", async () => {
      const shipmentId = await createShipment();
      for (const callerId of [senderId, carrierId, strangerId]) {
        const response = await requestTransfer(shipmentId, invitedId, callerId);
        expect(response.statusCode).toBe(403);
      }
    });

    it("antes de que el receptor acepte el envío no se puede (409 NOT_ALLOWED)", async () => {
      const shipmentId = await createShipment(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);
      const response = await requestTransfer(shipmentId, invitedId);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_RECEIVER_TRANSFER_NOT_ALLOWED");
    });

    it("con el envío entregado no se puede (409 NOT_ALLOWED)", async () => {
      const shipmentId = await createShipment(ShipmentStatus.DELIVERED);
      const response = await requestTransfer(shipmentId, invitedId);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_RECEIVER_TRANSFER_NOT_ALLOWED");
    });

    it("se puede desde que está publicado", async () => {
      const shipmentId = await createShipment(ShipmentStatus.PUBLISHED);
      const response = await requestTransfer(shipmentId, invitedId);
      expect(response.statusCode).toBe(201);
    });

    it("rechaza al receptor actual, al emisor y al transportista (422 INVALID_TARGET)", async () => {
      const shipmentId = await createShipment();
      for (const [target, reason] of [
        [receiverId, "self"],
        [senderId, "sender"],
        [carrierId, "carrier"],
      ] as const) {
        const response = await requestTransfer(shipmentId, target);
        expect(response.statusCode).toBe(422);
        expect(response.json().error).toMatchObject({
          code: "SHIPMENT_RECEIVER_TRANSFER_INVALID_TARGET",
          details: { reason },
        });
      }
    });

    it("la persona elegida tiene que existir y tener KYC aprobado", async () => {
      const shipmentId = await createShipment();
      expect((await requestTransfer(shipmentId, randomUUID())).statusCode).toBe(404);
      const unverified = await requestTransfer(shipmentId, unverifiedId);
      expect(unverified.statusCode).toBe(422);
      expect(unverified.json().error.code).toBe("SHIPMENT_RECEIVER_KYC_NOT_APPROVED");
    });

    it("un bloqueo entre la persona elegida y el emisor da 403 USER_BLOCKED", async () => {
      const shipmentId = await createShipment();
      const response = await requestTransfer(shipmentId, blockedWithSenderId);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("USER_BLOCKED");
    });

    it("AC5: como máximo una solicitud pendiente, también con dos pedidos concurrentes", async () => {
      const shipmentId = await createShipment();
      const results = await Promise.all([
        requestTransfer(shipmentId, invitedId),
        requestTransfer(shipmentId, otherInvitedId),
      ]);
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes).toEqual([201, 409]);
      const conflict = results.find((r) => r.statusCode === 409)!;
      expect(conflict.json().error.code).toBe("SHIPMENT_RECEIVER_TRANSFER_PENDING");
      expect(await app.db.receiverTransferRequest.count({ where: { shipmentId } })).toBe(1);
    });

    it("con el handshake de entrega en curso no se puede (409 NOT_ALLOWED)", async () => {
      const shipmentId = await createShipment();
      await app.redis.set(`handshake:pending:${shipmentId}`, JSON.stringify({ stage: "delivery" }), "PX", 15000);
      const response = await requestTransfer(shipmentId, invitedId);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_RECEIVER_TRANSFER_NOT_ALLOWED");
      await app.redis.del(`handshake:pending:${shipmentId}`);
    });
  });

  describe("aceptar (AC3)", () => {
    it("cambia el receptor de forma atómica y avisa a transportista, emisor y receptor original", async () => {
      const shipmentId = await createShipment();
      const transferId = (await requestTransfer(shipmentId, invitedId)).json().id;
      vi.clearAllMocks();

      const response = await act(transferId, "accept", invitedId);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: "completed", resolvedBy: invitedId });
      const shipment = await repo.findById(shipmentId);
      expect(shipment?.receiverId).toBe(invitedId);
      expect(shipment?.status).toBe(ShipmentStatus.IN_TRANSIT);
      expect(shipment?.formerReceiverId).toBe(receiverId);

      await settle();
      expect(pushesTo(carrierId)).toHaveLength(1);
      expect(pushesTo(senderId)).toHaveLength(1);
      expect(pushesTo(receiverId)).toHaveLength(1);
      expect(pushesTo(receiverId)[0].title).toContain("Martín López");
    });

    it("solo la persona invitada puede aceptar (403)", async () => {
      const shipmentId = await createShipment();
      const transferId = (await requestTransfer(shipmentId, invitedId)).json().id;
      for (const callerId of [receiverId, senderId, carrierId, strangerId]) {
        expect((await act(transferId, "accept", callerId)).statusCode).toBe(403);
      }
    });

    it("fuera de plazo responde 409 aunque el barrido no haya corrido", async () => {
      const shipmentId = await createShipment();
      const transferId = (await requestTransfer(shipmentId, invitedId)).json().id;
      await app.db.receiverTransferRequest.update({
        where: { id: transferId },
        data: { newReceiverDeadline: new Date(Date.now() - 60_000) },
      });

      const response = await act(transferId, "accept", invitedId);

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_RECEIVER_TRANSFER_EXPIRED");
      expect((await repo.findById(shipmentId))?.receiverId).toBe(receiverId);
    });

    it("con el handshake de entrega en curso no se puede aceptar (409)", async () => {
      const shipmentId = await createShipment();
      const transferId = (await requestTransfer(shipmentId, invitedId)).json().id;
      await app.redis.set(`handshake:pending:${shipmentId}`, JSON.stringify({ stage: "delivery" }), "PX", 15000);

      const response = await act(transferId, "accept", invitedId);

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_RECEIVER_TRANSFER_NOT_ALLOWED");
      await app.redis.del(`handshake:pending:${shipmentId}`);
    });

    it("AC5: después de una transferencia completada no se puede pedir otra (409 LIMIT)", async () => {
      const shipmentId = await createShipment();
      const transferId = (await requestTransfer(shipmentId, invitedId)).json().id;
      expect((await act(transferId, "accept", invitedId)).statusCode).toBe(200);

      const response = await requestTransfer(shipmentId, otherInvitedId, invitedId);

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_RECEIVER_TRANSFER_LIMIT");
    });

    it("aceptar dos veces da 409 NOT_PENDING", async () => {
      const shipmentId = await createShipment();
      const transferId = (await requestTransfer(shipmentId, invitedId)).json().id;
      expect((await act(transferId, "accept", invitedId)).statusCode).toBe(200);
      const again = await act(transferId, "accept", invitedId);
      expect(again.statusCode).toBe(409);
      expect(again.json().error.code).toBe("RECEIVER_TRANSFER_NOT_PENDING");
    });
  });

  describe("rechazar y cancelar (AC2, AC6)", () => {
    it("la invitada rechaza: el envío sigue con el receptor anterior, que puede volver a intentar", async () => {
      const shipmentId = await createShipment();
      const transferId = (await requestTransfer(shipmentId, invitedId)).json().id;
      vi.clearAllMocks();

      const response = await act(transferId, "reject", invitedId, { reason: "Ese día trabajo" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: "rejected_by_new_receiver", responseReason: "Ese día trabajo" });
      expect((await repo.findById(shipmentId))?.receiverId).toBe(receiverId);
      await settle();
      expect(pushesTo(receiverId)).toHaveLength(1);
      expect(pushesTo(senderId)).toHaveLength(1);

      // No consume el cupo.
      expect((await requestTransfer(shipmentId, otherInvitedId)).statusCode).toBe(201);
    });

    it("rechazar con body vacío funciona", async () => {
      const shipmentId = await createShipment();
      const transferId = (await requestTransfer(shipmentId, invitedId)).json().id;
      const response = await app.inject({
        method: "POST",
        url: `/receiver-transfers/${transferId}/reject`,
        headers: { "x-user-id": invitedId, "content-type": "application/json" },
        payload: "",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().responseReason).toBeNull();
    });

    it("quien la pidió la cancela; la invitada recibe el aviso y ya no puede aceptar", async () => {
      const shipmentId = await createShipment();
      const transferId = (await requestTransfer(shipmentId, invitedId)).json().id;
      expect((await act(transferId, "cancel", senderId)).statusCode).toBe(403);
      vi.clearAllMocks();

      const response = await act(transferId, "cancel", receiverId);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: "cancelled", cancelReason: "requester" });
      await settle();
      expect(pushesTo(invitedId)).toHaveLength(1);
      expect((await act(transferId, "accept", invitedId)).statusCode).toBe(409);
    });

    it("AC6: el handshake de entrega cancela la solicitud pendiente y valida contra el receptor vigente", async () => {
      const shipmentId = await createShipment();
      await repo.addPhoto(shipmentId, PhotoStage.delivery, `shipments/${shipmentId}/delivery/${randomUUID()}.jpg`);
      const transferId = (await requestTransfer(shipmentId, invitedId)).json().id;

      const generate = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/handshake/generate`,
        headers: { "x-user-id": carrierId },
        payload: { lat: -31.4135, lng: -64.1811 },
      });

      expect(generate.statusCode).toBe(200);
      const transfer = await app.db.receiverTransferRequest.findUniqueOrThrow({ where: { id: transferId } });
      expect(transfer.status).toBe("cancelled");
      expect(transfer.cancelReason).toBe("delivery_started");
      expect((await repo.findById(shipmentId))?.receiverId).toBe(receiverId);
      expect((await act(transferId, "accept", invitedId)).statusCode).toBe(409);
      await app.redis.del(`handshake:pending:${shipmentId}`);
    });
  });

  describe("barrido de vencimiento (AC2)", () => {
    it("vence las solicitudes con plazo cumplido y avisa a quien la pidió y al emisor", async () => {
      const shipmentId = await createShipment();
      const transferId = (await requestTransfer(shipmentId, invitedId)).json().id;
      const liveShipmentId = await createShipment();
      const liveTransferId = (await requestTransfer(liveShipmentId, otherInvitedId)).json().id;
      await app.db.receiverTransferRequest.update({
        where: { id: transferId },
        data: { newReceiverDeadline: new Date(Date.now() - 60_000) },
      });
      vi.clearAllMocks();

      const service = buildReceiverTransfersService(app, { notificationsClient });
      const result = await service.expireOverdueTransfers();

      expect(result).toEqual({ expiredCount: 1, errorsCount: 0 });
      const expired = await app.db.receiverTransferRequest.findUniqueOrThrow({ where: { id: transferId } });
      expect(expired.status).toBe("expired");
      const live = await app.db.receiverTransferRequest.findUniqueOrThrow({ where: { id: liveTransferId } });
      expect(live.status).toBe("pending_new_receiver");
      await settle();
      expect(pushesTo(receiverId).length).toBeGreaterThanOrEqual(1);
      expect(pushesTo(senderId)).toHaveLength(1);
    });
  });

  describe("acceso del receptor original y línea de tiempo (AC7, AC10)", () => {
    async function completedTransferWithPreviousRejection() {
      const shipmentId = await createShipment();
      const rejectedId = (await requestTransfer(shipmentId, otherInvitedId)).json().id;
      await act(rejectedId, "reject", otherInvitedId, { reason: "No puedo" });
      const completedId = (await requestTransfer(shipmentId, invitedId, receiverId, "De viaje")).json().id;
      await act(completedId, "accept", invitedId);
      return { shipmentId, rejectedId, completedId };
    }

    function listTimeline(shipmentId: string, callerId: string) {
      return app.inject({
        method: "GET",
        url: `/shipments/${shipmentId}/receiver-transfers`,
        headers: { "x-user-id": callerId },
      });
    }

    it("el receptor original ve el detalle en solo lectura, con el resumen de la transferencia", async () => {
      const { shipmentId, completedId } = await completedTransferWithPreviousRejection();

      const detail = await app.inject({
        method: "GET",
        url: `/shipments/${shipmentId}`,
        headers: { "x-user-id": receiverId },
      });

      expect(detail.statusCode).toBe(200);
      const data = detail.json();
      expect(data.receiverId).toBe(invitedId);
      expect(data.receiverTransfer).toMatchObject({
        viewerIsFormerReceiver: true,
        pending: null,
        completed: { id: completedId, newReceiverName: "Martín López", reason: "De viaje" },
      });

      const events = await app.inject({
        method: "GET",
        url: `/shipments/${shipmentId}/events`,
        headers: { "x-user-id": receiverId },
      });
      expect(events.statusCode).toBe(200);
    });

    it("el receptor original no puede actuar sobre el envío", async () => {
      const { shipmentId } = await completedTransferWithPreviousRejection();
      const again = await requestTransfer(shipmentId, otherInvitedId, receiverId);
      expect(again.statusCode).toBe(403);
    });

    it("el envío sigue en la lista del receptor original con transferredByMe", async () => {
      const { shipmentId } = await completedTransferWithPreviousRejection();

      const mine = await app.inject({ method: "GET", url: "/shipments/mine", headers: { "x-user-id": receiverId } });

      expect(mine.statusCode).toBe(200);
      const item = mine.json().items.find((s: { id: string }) => s.id === shipmentId);
      expect(item.transferredByMe).toMatchObject({ newReceiverId: invitedId, newReceiverName: "Martín López" });

      const senderMine = await app.inject({ method: "GET", url: "/shipments/mine", headers: { "x-user-id": senderId } });
      expect(senderMine.json().items[0].transferredByMe).toBeNull();
    });

    it("emisor y receptor original ven todas las solicitudes; transportista y receptor vigente solo la completada", async () => {
      const { shipmentId, rejectedId, completedId } = await completedTransferWithPreviousRejection();

      for (const callerId of [senderId, receiverId]) {
        const ids = (await listTimeline(shipmentId, callerId)).json().map((t: { id: string }) => t.id);
        expect(ids).toEqual([rejectedId, completedId]);
      }
      for (const callerId of [carrierId, invitedId]) {
        const ids = (await listTimeline(shipmentId, callerId)).json().map((t: { id: string }) => t.id);
        expect(ids).toEqual([completedId]);
      }
      expect((await listTimeline(shipmentId, otherInvitedId)).statusCode).toBe(403);
    });

    it("la solicitud pendiente solo aparece en el detalle de quien la pidió y del emisor", async () => {
      const shipmentId = await createShipment();
      await requestTransfer(shipmentId, invitedId);

      const forViewer = async (callerId: string) =>
        (
          await app.inject({ method: "GET", url: `/shipments/${shipmentId}`, headers: { "x-user-id": callerId } })
        ).json().receiverTransfer;

      expect((await forViewer(receiverId)).pending).not.toBeNull();
      expect((await forViewer(senderId)).pending).not.toBeNull();
      expect((await forViewer(carrierId)).pending).toBeNull();
    });
  });

  describe("invitaciones y baja de cuenta (AC8)", () => {
    it("la invitada ve sus invitaciones vigentes con lo mínimo del envío", async () => {
      const shipmentId = await createShipment();
      const transferId = (await requestTransfer(shipmentId, invitedId)).json().id;

      const response = await app.inject({
        method: "GET",
        url: "/receiver-transfers/invitations",
        headers: { "x-user-id": invitedId },
      });

      expect(response.statusCode).toBe(200);
      const [invitation] = response.json();
      expect(invitation).toMatchObject({
        id: transferId,
        shipment: { id: shipmentId, deliveryAddress: "Av. Colón 1234, Córdoba", senderId, carrierId },
      });
      expect(invitation.shipment.receiverId).toBeUndefined();

      const detail = await app.inject({
        method: "GET",
        url: `/receiver-transfers/${transferId}`,
        headers: { "x-user-id": strangerId },
      });
      expect(detail.statusCode).toBe(403);
    });

    it("una invitación pendiente cuenta como actividad para la baja de cuenta", async () => {
      const shipmentId = await createShipment();
      await requestTransfer(shipmentId, invitedId);

      const response = await app.inject({
        method: "GET",
        url: `/internal/account-deletion/users/${invitedId}/active-shipments`,
      });

      expect(response.json()).toMatchObject({ hasActiveShipments: true });
    });
  });
});
