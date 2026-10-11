import {
  ApiError,
  NotificationTriggerKey,
  RECEIVER_TRANSFER_ALLOWED_SHIPMENT_STATUSES,
  ShipmentReceiverTransferSummary,
  UserRole,
  notificationTriggerCategory,
  renderNotificationTrigger,
} from "@movo/shared";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import {
  ReceiverTransferRepository,
  ReceiverTransferWithShipment,
} from "../../repositories/receiver-transfer-repository";
import { ReceiverTransfer, ReceiverTransferNotPendingError } from "../../models/receiver-transfer";
import { Shipment } from "../../models/shipment";
import { UsersClient } from "../../adapters/users-client";
import { NotificationsClient } from "../../adapters/notifications-client";
import { assertNotBlocked } from "../../utils/block-relations";
import { assertIsReceiver, hasShipmentAccess, isFormerReceiver } from "../shipments/assert-shipment-access";
import { HandshakeRedisClient, isDeliveryHandshakePending } from "../handshake/handshake.service";

type ReceiverTransfersLogger = { warn: (obj: unknown, msg?: string) => void; info?: (obj: unknown, msg?: string) => void };

export interface ReceiverTransfersServiceDeps {
  shipmentRepository: ShipmentRepository;
  transferRepository: ReceiverTransferRepository;
  usersClient: UsersClient;
  redis: Pick<HandshakeRedisClient, "get">;
  notificationsClient?: NotificationsClient;
  logger?: ReceiverTransfersLogger;
  /** Plazo de la persona invitada para aceptar (`RECEIVER_TRANSFER_TIMEOUT_HOURS`). */
  timeoutHours: number;
}

export interface RequestReceiverTransferInput {
  shipmentId: string;
  callerId: string;
  newReceiverId: string;
  reason?: string | null;
}

/** `data.type` de las push: la invitación abre su pantalla, el resto el detalle del envío. */
const INVITE_PUSH_TYPE = "receiver_transfer_invite";
const TRANSFER_PUSH_TYPE = "receiver_transfer";

const FALLBACK_NAME = "Un usuario de Movo";

function normalizeReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  return trimmed ? trimmed : null;
}

function isTransferAllowedStatus(shipment: Shipment): boolean {
  return RECEIVER_TRANSFER_ALLOWED_SHIPMENT_STATUSES.includes(shipment.status);
}

/**
 * MOVO-275 (ADR-038): transferencia de receptor. El receptor actual invita a otra
 * persona (KYC aprobado, sin bloqueo con el emisor) a recibir en su lugar; la invitada
 * acepta o rechaza dentro del plazo. El emisor y el transportista solo se enteran. Una
 * sola transferencia completada por envío; las rechazadas/vencidas/canceladas no
 * consumen el cupo.
 */
export function createReceiverTransfersService(deps: ReceiverTransfersServiceDeps) {
  const { shipmentRepository, transferRepository, usersClient, redis, notificationsClient, logger } = deps;

  async function resolveName(userId: string): Promise<string | null> {
    try {
      const profile = await usersClient.findPublicProfile(userId, userId);
      return profile?.fullName ?? null;
    } catch (err) {
      logger?.warn({ err, event: "receiver_transfer_name_lookup_failed", userId }, "No se pudo resolver el nombre");
      return null;
    }
  }

  async function push(
    userId: string | null,
    triggerKey: NotificationTriggerKey,
    params: unknown,
    data: Record<string, unknown>
  ): Promise<void> {
    if (!notificationsClient || !userId) {
      return;
    }
    try {
      const { title, body } = renderNotificationTrigger(triggerKey, params as never);
      await notificationsClient.sendPush({
        userId,
        title,
        body,
        category: notificationTriggerCategory(triggerKey),
        data,
      });
    } catch (err) {
      logger?.warn(
        { err, event: "notification_dispatch_failed", triggerKey, userId },
        "No se pudo enviar la push de transferencia de receptor"
      );
    }
  }

  function names(transfer: ReceiverTransfer) {
    return {
      requesterName: transfer.requesterName ?? FALLBACK_NAME,
      newReceiverName: transfer.newReceiverName ?? FALLBACK_NAME,
    };
  }

  async function assertDeliveryNotStarted(shipmentId: string): Promise<void> {
    if (await isDeliveryHandshakePending(redis, shipmentId)) {
      throw new ApiError(
        409,
        "SHIPMENT_RECEIVER_TRANSFER_NOT_ALLOWED",
        "La entrega ya empezó: no se puede cambiar quién recibe."
      );
    }
  }

  async function loadTransfer(transferId: string): Promise<ReceiverTransferWithShipment> {
    const transfer = await transferRepository.findByIdWithShipment(transferId);
    if (!transfer) {
      throw new ApiError(404, "RECEIVER_TRANSFER_NOT_FOUND", "Solicitud no encontrada.");
    }
    return transfer;
  }

  function assertPending(transfer: ReceiverTransfer): void {
    if (transfer.status !== "pending_new_receiver") {
      throw new ApiError(409, "RECEIVER_TRANSFER_NOT_PENDING", "Esta solicitud ya no está vigente.");
    }
  }

  return {
    /** AC1: el receptor actual pide que otra persona reciba en su lugar. */
    async requestTransfer(input: RequestReceiverTransferInput): Promise<ReceiverTransfer> {
      const shipment = await shipmentRepository.findById(input.shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      assertIsReceiver(shipment, input.callerId, "Solo el receptor del envío puede pedir que lo reciba otra persona.");

      if (!isTransferAllowedStatus(shipment)) {
        throw new ApiError(
          409,
          "SHIPMENT_RECEIVER_TRANSFER_NOT_ALLOWED",
          "En el estado actual del envío no se puede cambiar quién recibe."
        );
      }
      await assertDeliveryNotStarted(shipment.id);

      if (await transferRepository.findCompletedByShipment(shipment.id)) {
        throw new ApiError(409, "SHIPMENT_RECEIVER_TRANSFER_LIMIT", "Este envío ya cambió de receptor una vez.");
      }
      if (await transferRepository.findPendingByShipment(shipment.id)) {
        throw new ApiError(
          409,
          "SHIPMENT_RECEIVER_TRANSFER_PENDING",
          "Ya hay una solicitud para que otra persona reciba este envío."
        );
      }

      const invalidTarget =
        input.newReceiverId === shipment.receiverId
          ? { reason: "self", message: "Ya sos el receptor de este envío. Elegí a otra persona." }
          : input.newReceiverId === shipment.senderId
            ? { reason: "sender", message: "El emisor no puede ser el receptor de su propio envío." }
            : shipment.carrierId && input.newReceiverId === shipment.carrierId
              ? { reason: "carrier", message: "El transportista del envío no puede recibirlo." }
              : null;
      if (invalidTarget) {
        throw new ApiError(422, "SHIPMENT_RECEIVER_TRANSFER_INVALID_TARGET", invalidTarget.message, {
          reason: invalidTarget.reason,
        });
      }

      const newReceiver = await usersClient.findPublicProfile(input.newReceiverId, input.callerId);
      if (!newReceiver) {
        throw new ApiError(404, "USER_NOT_FOUND", "La persona elegida no existe.");
      }
      if (!newReceiver.isVerified) {
        throw new ApiError(
          422,
          "SHIPMENT_RECEIVER_KYC_NOT_APPROVED",
          "La persona elegida todavía no tiene su identidad verificada."
        );
      }

      // ADR-026: el bloqueo se mira contra el emisor, que es quien le manda el paquete.
      await assertNotBlocked(usersClient, shipment.senderId, [input.newReceiverId]);

      const now = new Date();
      const transfer = await transferRepository.create({
        shipmentId: shipment.id,
        requestedBy: input.callerId,
        requesterName: await resolveName(input.callerId),
        newReceiverId: input.newReceiverId,
        newReceiverName: newReceiver.fullName ?? null,
        reason: normalizeReason(input.reason),
        newReceiverDeadline: new Date(now.getTime() + deps.timeoutHours * 60 * 60 * 1000),
      });

      const { requesterName, newReceiverName } = names(transfer);
      void push(
        transfer.newReceiverId,
        "receiverTransferInvited",
        { requesterName, deadlineHours: deps.timeoutHours },
        { type: INVITE_PUSH_TYPE, transferId: transfer.id, shipmentId: shipment.id }
      );
      void push(
        shipment.senderId,
        "receiverTransferRequested",
        { requesterName, newReceiverName },
        { type: TRANSFER_PUSH_TYPE, shipmentId: shipment.id }
      );

      return transfer;
    },

    /** AC2/AC3: la persona invitada acepta; el envío cambia de receptor atómicamente. */
    async acceptTransfer(transferId: string, callerId: string): Promise<ReceiverTransfer> {
      const transfer = await loadTransfer(transferId);
      if (transfer.newReceiverId !== callerId) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "Solo la persona invitada puede aceptar esta solicitud.");
      }
      assertPending(transfer);

      // Mismo criterio que MOVO-130 AC5: el plazo manda aunque el barrido no haya corrido.
      const now = new Date();
      if (transfer.newReceiverDeadline <= now) {
        throw new ApiError(409, "SHIPMENT_RECEIVER_TRANSFER_EXPIRED", "Venció el plazo para aceptar esta invitación.");
      }

      if (!RECEIVER_TRANSFER_ALLOWED_SHIPMENT_STATUSES.includes(transfer.shipment.status)) {
        throw new ApiError(
          409,
          "SHIPMENT_RECEIVER_TRANSFER_NOT_ALLOWED",
          "En el estado actual del envío ya no se puede cambiar quién recibe."
        );
      }
      await assertDeliveryNotStarted(transfer.shipmentId);
      await assertNotBlocked(usersClient, transfer.shipment.senderId, [callerId]);

      const completed = await transferRepository.complete({
        transferId,
        shipmentId: transfer.shipmentId,
        expectedReceiverId: transfer.requestedBy,
        newReceiverId: callerId,
        allowedShipmentStatuses: RECEIVER_TRANSFER_ALLOWED_SHIPMENT_STATUSES,
        now,
      });

      const { requesterName, newReceiverName } = names(completed);
      const data = { type: TRANSFER_PUSH_TYPE, shipmentId: completed.shipmentId };
      void push(completed.requestedBy, "receiverTransferCompletedRequester", { newReceiverName }, data);
      void push(transfer.shipment.senderId, "receiverTransferCompletedSender", { requesterName, newReceiverName }, data);
      void push(transfer.shipment.carrierId, "receiverTransferCompletedCarrier", { newReceiverName }, data);

      return completed;
    },

    /** AC2: la persona invitada rechaza; el envío sigue con el receptor anterior. */
    async rejectTransfer(transferId: string, callerId: string, reason?: string | null): Promise<ReceiverTransfer> {
      const transfer = await loadTransfer(transferId);
      if (transfer.newReceiverId !== callerId) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "Solo la persona invitada puede rechazar esta solicitud.");
      }
      assertPending(transfer);

      const rejected = await transferRepository.resolve(transferId, {
        status: "rejected_by_new_receiver",
        resolvedBy: callerId,
        responseReason: normalizeReason(reason),
        now: new Date(),
      });

      const { requesterName, newReceiverName } = names(rejected);
      const data = { type: TRANSFER_PUSH_TYPE, shipmentId: rejected.shipmentId };
      void push(rejected.requestedBy, "receiverTransferRejectedRequester", { newReceiverName }, data);
      void push(transfer.shipment.senderId, "receiverTransferRejectedSender", { requesterName, newReceiverName }, data);

      return rejected;
    },

    /** AC6: quien la pidió la cancela mientras está pendiente. */
    async cancelTransfer(transferId: string, callerId: string): Promise<ReceiverTransfer> {
      const transfer = await loadTransfer(transferId);
      if (transfer.requestedBy !== callerId) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "Solo quien pidió la transferencia puede cancelarla.");
      }
      assertPending(transfer);

      const cancelled = await transferRepository.resolve(transferId, {
        status: "cancelled",
        resolvedBy: callerId,
        cancelReason: "requester",
        now: new Date(),
      });

      void push(
        cancelled.newReceiverId,
        "receiverTransferCancelled",
        { requesterName: names(cancelled).requesterName },
        { type: INVITE_PUSH_TYPE, transferId: cancelled.id, shipmentId: cancelled.shipmentId }
      );

      return cancelled;
    },

    /**
     * Pantalla de la invitación. La ven la persona invitada (en cualquier estado, para
     * mostrar "ya no está vigente"), quien la pidió y el emisor.
     */
    async getTransfer(transferId: string, callerId: string, callerRoles: UserRole[]): Promise<ReceiverTransferWithShipment> {
      const transfer = await loadTransfer(transferId);
      const allowed =
        callerId === transfer.newReceiverId ||
        callerId === transfer.requestedBy ||
        callerId === transfer.shipment.senderId ||
        callerRoles.includes(UserRole.ADMIN);
      if (!allowed) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "No tenés permiso para ver esta solicitud.");
      }
      return transfer;
    },

    /** AC8: invitaciones vigentes para "Requiere tu atención" de la persona invitada. */
    async listMyInvitations(callerId: string): Promise<ReceiverTransferWithShipment[]> {
      return transferRepository.listPendingForNewReceiver(callerId, new Date());
    },

    /**
     * AC7: solicitudes del envío para la línea de tiempo, según quién mira. El emisor y
     * quien pidió cada solicitud las ven todas; el resto (transportista, receptor
     * vigente) solo la completada.
     */
    async listForShipment(shipmentId: string, callerId: string, callerRoles: UserRole[]): Promise<ReceiverTransfer[]> {
      const shipment = await shipmentRepository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }
      if (!hasShipmentAccess(shipment, callerId, callerRoles)) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "No tenés permiso para ver este envío.");
      }
      const seesAll = callerId === shipment.senderId || callerRoles.includes(UserRole.ADMIN);
      const transfers = await transferRepository.listByShipment(shipmentId);
      return transfers.filter((t) => seesAll || t.requestedBy === callerId || t.status === "completed");
    },

    /** Resumen para el detalle del envío (banner del ex-receptor, solicitud pendiente). */
    async summaryForShipment(shipment: Shipment, callerId: string): Promise<ShipmentReceiverTransferSummary> {
      const transfers = await transferRepository.listByShipment(shipment.id);
      const pending = transfers.find((t) => t.status === "pending_new_receiver") ?? null;
      const completed = transfers.find((t) => t.status === "completed") ?? null;
      const seesPending = pending !== null && (callerId === pending.requestedBy || callerId === shipment.senderId);
      return {
        viewerIsFormerReceiver: isFormerReceiver(shipment, callerId),
        pending: seesPending ? toTransferDto(pending) : null,
        completed: completed ? toTransferDto(completed) : null,
      };
    },

    /** Batch para `GET /shipments/mine`: la completada de cada envío de la página. */
    async completedByShipmentIds(shipmentIds: readonly string[]): Promise<Map<string, ReceiverTransfer>> {
      return transferRepository.findCompletedByShipmentIds(shipmentIds);
    },

    /** Barrido: cierra las solicitudes con el plazo vencido (AC2). */
    async expireOverdueTransfers(batchSize = 100): Promise<{ expiredCount: number; errorsCount: number }> {
      const now = new Date();
      const candidates = await transferRepository.findExpiredPending(now, batchSize);
      let expiredCount = 0;
      let errorsCount = 0;
      for (const candidate of candidates) {
        try {
          const expired = await transferRepository.resolve(candidate.id, { status: "expired", resolvedBy: null, now });
          expiredCount += 1;
          const shipment = await shipmentRepository.findById(expired.shipmentId);
          const { requesterName, newReceiverName } = names(expired);
          const data = { type: TRANSFER_PUSH_TYPE, shipmentId: expired.shipmentId };
          void push(expired.requestedBy, "receiverTransferExpiredRequester", { newReceiverName }, data);
          void push(shipment?.senderId ?? null, "receiverTransferExpiredSender", { requesterName, newReceiverName }, data);
        } catch (err) {
          // Otra vía (aceptar, rechazar, cancelar) la resolvió entre la lectura y el CAS.
          if (err instanceof ReceiverTransferNotPendingError) {
            continue;
          }
          errorsCount += 1;
          logger?.warn({ err, event: "receiver_transfer_expire_failed", transferId: candidate.id }, "No se pudo vencer la solicitud");
        }
      }
      if (expiredCount > 0 || errorsCount > 0) {
        logger?.info?.({ event: "receiver_transfer_sweep", expiredCount, errorsCount }, "Barrido de transferencias de receptor");
      }
      return { expiredCount, errorsCount };
    },

    /**
     * AC6: el transportista empezó el handshake de entrega. Una solicitud pendiente se
     * cancela y la entrega sigue con el receptor vigente.
     */
    async cancelPendingForDelivery(shipmentId: string): Promise<void> {
      const pending = await transferRepository.findPendingByShipment(shipmentId);
      if (!pending) {
        return;
      }
      try {
        const cancelled = await transferRepository.resolve(pending.id, {
          status: "cancelled",
          resolvedBy: null,
          cancelReason: "delivery_started",
          now: new Date(),
        });
        void push(
          cancelled.newReceiverId,
          "receiverTransferCancelled",
          { requesterName: names(cancelled).requesterName },
          { type: INVITE_PUSH_TYPE, transferId: cancelled.id, shipmentId }
        );
      } catch (err) {
        if (!(err instanceof ReceiverTransferNotPendingError)) {
          throw err;
        }
      }
    },
  };
}

export type ReceiverTransfersService = ReturnType<typeof createReceiverTransfersService>;

/** Serializa al wire contract (`ReceiverTransferRequest` de @movo/shared). */
export function toTransferDto(transfer: ReceiverTransfer) {
  return {
    id: transfer.id,
    shipmentId: transfer.shipmentId,
    requestedBy: transfer.requestedBy,
    requesterName: transfer.requesterName,
    newReceiverId: transfer.newReceiverId,
    newReceiverName: transfer.newReceiverName,
    reason: transfer.reason,
    responseReason: transfer.responseReason,
    status: transfer.status,
    cancelReason: transfer.cancelReason,
    newReceiverDeadline: transfer.newReceiverDeadline.toISOString(),
    createdAt: transfer.createdAt.toISOString(),
    resolvedAt: transfer.resolvedAt ? transfer.resolvedAt.toISOString() : null,
    resolvedBy: transfer.resolvedBy,
  };
}

/** Serializa una invitación (solicitud + lo mínimo del envío). */
export function toInvitationDto(transfer: ReceiverTransferWithShipment) {
  const s = transfer.shipment;
  return {
    ...toTransferDto(transfer),
    // Sin `receiverId`: la invitada todavía no es parte del envío.
    shipment: {
      id: s.id,
      status: s.status,
      senderId: s.senderId,
      carrierId: s.carrierId,
      packageType: s.packageType,
      weightKg: s.weightKg,
      lengthCm: s.lengthCm,
      widthCm: s.widthCm,
      heightCm: s.heightCm,
      description: s.description,
      deliveryAddress: s.deliveryAddress,
    },
  };
}
