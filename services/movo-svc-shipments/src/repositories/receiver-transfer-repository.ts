import {
  RECEIVER_TRANSFER_ALLOWED_SHIPMENT_STATUSES,
  ReceiverTransferCancelReason,
  ReceiverTransferStatus,
  ShipmentStatus,
} from "@movo/shared";
import {
  PrismaClient,
  ReceiverTransferRequest as ReceiverTransferRow,
  Shipment as ShipmentRow,
} from "../generated/prisma/client";
import {
  CreateReceiverTransferInput,
  ReceiverTransfer,
  ReceiverTransferLimitError,
  ReceiverTransferNotPendingError,
  ReceiverTransferPendingConflictError,
} from "../models/receiver-transfer";
import { ShipmentConcurrentModificationError } from "./shipment-repository";
import { emitShipmentStatusChanged } from "../realtime/shipment-status-events";
import { parseShipmentStatus } from "../models/shipment";

const PENDING: ReceiverTransferStatus = "pending_new_receiver";

/** Envío en el que una invitación sigue teniendo sentido: en un estado que admite el
 * cambio y sin la entrega empezada. Una invitación de un envío cancelado o entregado no
 * se lista ni bloquea la baja de cuenta (la cierra el barrido más tarde). */
const OPEN_FOR_TRANSFER = {
  status: { in: [...RECEIVER_TRANSFER_ALLOWED_SHIPMENT_STATUSES] },
  deliveryHandshakeStartedAt: null,
};

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function mapTransfer(row: ReceiverTransferRow): ReceiverTransfer {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    requestedBy: row.requestedBy,
    requesterName: row.requesterName,
    newReceiverId: row.newReceiverId,
    newReceiverName: row.newReceiverName,
    reason: row.reason,
    responseReason: row.responseReason,
    status: row.status,
    cancelReason: (row.cancelReason as ReceiverTransferCancelReason | null) ?? null,
    newReceiverDeadline: row.newReceiverDeadline,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
  };
}

/** Lo que la persona invitada ve del envío antes de aceptar (ver `ReceiverTransferInvitationShipment`). */
export interface ReceiverTransferShipmentContext {
  id: string;
  status: ShipmentStatus;
  senderId: string;
  receiverId: string;
  carrierId: string | null;
  packageType: string;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  description: string | null;
  deliveryAddress: string;
}

export type ReceiverTransferWithShipment = ReceiverTransfer & { shipment: ReceiverTransferShipmentContext };

function mapShipmentContext(row: ShipmentRow): ReceiverTransferShipmentContext {
  return {
    id: row.id,
    status: parseShipmentStatus(row.status, "status"),
    senderId: row.senderId,
    receiverId: row.receiverId,
    carrierId: row.carrierId,
    packageType: row.packageType,
    weightKg: row.weightKg.toNumber(),
    lengthCm: row.lengthCm.toNumber(),
    widthCm: row.widthCm.toNumber(),
    heightCm: row.heightCm.toNumber(),
    description: row.description,
    deliveryAddress: row.deliveryAddress,
  };
}

export interface CompleteReceiverTransferInput {
  transferId: string;
  shipmentId: string;
  /** Receptor que pidió la transferencia: el envío tiene que seguir siendo suyo. */
  expectedReceiverId: string;
  newReceiverId: string;
  /** Estados del envío en los que todavía se puede cambiar de receptor. */
  allowedShipmentStatuses: readonly ShipmentStatus[];
  now: Date;
}

export interface ResolveReceiverTransferInput {
  status: Exclude<ReceiverTransferStatus, "pending_new_receiver" | "completed">;
  resolvedBy: string | null;
  responseReason?: string | null;
  cancelReason?: ReceiverTransferCancelReason | null;
  now: Date;
}

export function createReceiverTransferRepository(db: PrismaClient) {
  return {
    /** Crea la solicitud pendiente. Una segunda pendiente del mismo envío choca con el
     * índice único parcial y lanza `ReceiverTransferPendingConflictError`. */
    async create(input: CreateReceiverTransferInput): Promise<ReceiverTransfer> {
      try {
        const row = await db.receiverTransferRequest.create({
          data: {
            shipmentId: input.shipmentId,
            requestedBy: input.requestedBy,
            requesterName: input.requesterName,
            newReceiverId: input.newReceiverId,
            newReceiverName: input.newReceiverName,
            reason: input.reason,
            newReceiverDeadline: input.newReceiverDeadline,
          },
        });
        return mapTransfer(row);
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new ReceiverTransferPendingConflictError(input.shipmentId);
        }
        throw error;
      }
    },

    async findById(id: string): Promise<ReceiverTransfer | null> {
      const row = await db.receiverTransferRequest.findUnique({ where: { id } });
      return row ? mapTransfer(row) : null;
    },

    async findByIdWithShipment(id: string): Promise<ReceiverTransferWithShipment | null> {
      const row = await db.receiverTransferRequest.findUnique({ where: { id }, include: { shipment: true } });
      return row ? { ...mapTransfer(row), shipment: mapShipmentContext(row.shipment) } : null;
    },

    async findPendingByShipment(shipmentId: string): Promise<ReceiverTransfer | null> {
      const row = await db.receiverTransferRequest.findFirst({ where: { shipmentId, status: PENDING } });
      return row ? mapTransfer(row) : null;
    },

    async findCompletedByShipment(shipmentId: string): Promise<ReceiverTransfer | null> {
      const row = await db.receiverTransferRequest.findFirst({ where: { shipmentId, status: "completed" } });
      return row ? mapTransfer(row) : null;
    },

    /** Batch para `GET /shipments/mine`: la transferencia completada de cada envío. */
    async findCompletedByShipmentIds(shipmentIds: readonly string[]): Promise<Map<string, ReceiverTransfer>> {
      if (shipmentIds.length === 0) {
        return new Map();
      }
      const rows = await db.receiverTransferRequest.findMany({
        where: { shipmentId: { in: [...shipmentIds] }, status: "completed" },
      });
      return new Map(rows.map((row) => [row.shipmentId, mapTransfer(row)]));
    },

    async listByShipment(shipmentId: string): Promise<ReceiverTransfer[]> {
      const rows = await db.receiverTransferRequest.findMany({
        where: { shipmentId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(mapTransfer);
    },

    /** Invitaciones vigentes de la persona invitada (no vencidas por plazo). */
    async listPendingForNewReceiver(userId: string, now: Date): Promise<ReceiverTransferWithShipment[]> {
      const rows = await db.receiverTransferRequest.findMany({
        where: {
          newReceiverId: userId,
          status: PENDING,
          newReceiverDeadline: { gt: now },
          shipment: OPEN_FOR_TRANSFER,
        },
        include: { shipment: true },
        orderBy: { newReceiverDeadline: "asc" },
      });
      return rows.map((row) => ({ ...mapTransfer(row), shipment: mapShipmentContext(row.shipment) }));
    },

    async hasPendingForNewReceiver(userId: string, now: Date = new Date()): Promise<boolean> {
      const row = await db.receiverTransferRequest.findFirst({
        where: { newReceiverId: userId, status: PENDING, newReceiverDeadline: { gt: now }, shipment: OPEN_FOR_TRANSFER },
        select: { id: true },
      });
      return row !== null;
    },

    async findExpiredPending(now: Date, limit: number): Promise<ReceiverTransfer[]> {
      const rows = await db.receiverTransferRequest.findMany({
        where: { status: PENDING, newReceiverDeadline: { lte: now } },
        orderBy: { newReceiverDeadline: "asc" },
        take: limit,
      });
      return rows.map(mapTransfer);
    },

    /**
     * AC3: la persona invitada acepta. En una sola transacción la solicitud pasa a
     * `completed` (compare-and-swap contra `pending` y el plazo) y el envío cambia de
     * `receiverId` (compare-and-swap contra el receptor que la pidió y un estado que
     * todavía admite el cambio). Cualquiera de los dos que no aplique revierte todo.
     */
    async complete(input: CompleteReceiverTransferInput): Promise<ReceiverTransfer> {
      let shipmentStatus: ShipmentStatus;
      let row: ReceiverTransferRow;
      try {
        row = await db.$transaction(async (tx) => {
          const transfer = await tx.receiverTransferRequest.updateMany({
            where: { id: input.transferId, status: PENDING, newReceiverDeadline: { gt: input.now } },
            data: { status: "completed", resolvedAt: input.now, resolvedBy: input.newReceiverId },
          });
          if (transfer.count === 0) {
            throw new ReceiverTransferNotPendingError(input.transferId);
          }

          const shipment = await tx.shipment.updateMany({
            where: {
              id: input.shipmentId,
              receiverId: input.expectedReceiverId,
              status: { in: [...input.allowedShipmentStatuses] },
              // Si el transportista generó el QR de entrega entre el chequeo y este UPDATE,
              // la entrega ya empezó y el receptor no cambia.
              deliveryHandshakeStartedAt: null,
            },
            data: { receiverId: input.newReceiverId },
          });
          if (shipment.count === 0) {
            throw new ShipmentConcurrentModificationError(input.shipmentId);
          }

          const current = await tx.shipment.findUniqueOrThrow({
            where: { id: input.shipmentId },
            select: { status: true },
          });
          shipmentStatus = parseShipmentStatus(current.status, "status");
          return tx.receiverTransferRequest.findUniqueOrThrow({ where: { id: input.transferId } });
        });
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new ReceiverTransferLimitError(input.shipmentId);
        }
        throw error;
      }

      // Mismo criterio que `redesignateReceiver` (MOVO-253): todo escritor del envío
      // fuera de `updateStatus` avisa al canal de tiempo real. El estado no cambia, pero
      // los clientes suscriptos refrescan el detalle con el receptor nuevo.
      emitShipmentStatusChanged({ shipmentId: input.shipmentId, to: shipmentStatus! });

      return mapTransfer(row);
    },

    /**
     * Cierra una solicitud pendiente sin cambiar el receptor (rechazo, vencimiento o
     * cancelación). Compare-and-swap contra `pending`: si ya se resolvió, lanza
     * `ReceiverTransferNotPendingError`.
     */
    async resolve(id: string, input: ResolveReceiverTransferInput): Promise<ReceiverTransfer> {
      const updated = await db.receiverTransferRequest.updateMany({
        where: { id, status: PENDING },
        data: {
          status: input.status,
          resolvedAt: input.now,
          resolvedBy: input.resolvedBy,
          responseReason: input.responseReason ?? null,
          cancelReason: input.cancelReason ?? null,
        },
      });
      if (updated.count === 0) {
        throw new ReceiverTransferNotPendingError(id);
      }
      const row = await db.receiverTransferRequest.findUniqueOrThrow({ where: { id } });
      return mapTransfer(row);
    },
  };
}

export type ReceiverTransferRepository = ReturnType<typeof createReceiverTransferRepository>;
