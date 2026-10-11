import { ReceiverTransferCancelReason, ReceiverTransferStatus } from "@movo/shared";

/**
 * MOVO-275 (ADR-038): solicitud de transferencia de receptor. Mismo shape que el wire
 * contract de `@movo/shared` (`ReceiverTransferRequest`) pero con `Date` en vez de
 * strings -- la serialización la hace el DTO de la ruta.
 */
export interface ReceiverTransfer {
  id: string;
  shipmentId: string;
  requestedBy: string;
  requesterName: string | null;
  newReceiverId: string;
  newReceiverName: string | null;
  reason: string | null;
  responseReason: string | null;
  status: ReceiverTransferStatus;
  cancelReason: ReceiverTransferCancelReason | null;
  newReceiverDeadline: Date;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

export interface CreateReceiverTransferInput {
  shipmentId: string;
  requestedBy: string;
  requesterName: string | null;
  newReceiverId: string;
  newReceiverName: string | null;
  reason: string | null;
  newReceiverDeadline: Date;
}

/** Ya hay una solicitud pendiente para el envío (índice único parcial). */
export class ReceiverTransferPendingConflictError extends Error {
  constructor(public readonly shipmentId: string) {
    super(`El envío ${shipmentId} ya tiene una transferencia de receptor pendiente.`);
    this.name = "ReceiverTransferPendingConflictError";
  }
}

/** El envío ya tuvo una transferencia completada (índice único parcial). */
export class ReceiverTransferLimitError extends Error {
  constructor(public readonly shipmentId: string) {
    super(`El envío ${shipmentId} ya cambió de receptor una vez.`);
    this.name = "ReceiverTransferLimitError";
  }
}

/** La solicitud dejó de estar pendiente entre la lectura y la escritura. */
export class ReceiverTransferNotPendingError extends Error {
  constructor(public readonly transferId: string) {
    super(`La transferencia ${transferId} ya no está pendiente.`);
    this.name = "ReceiverTransferNotPendingError";
  }
}
