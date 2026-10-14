import { ChatDeliveryStatus } from "@movo/shared";

/** Hasta dónde recibió y leyó el chat un integrante (los dos instantes solo avanzan). */
export interface ChatReceiptState {
  userId: string;
  lastDeliveredAt: Date | null;
  lastReadAt: Date | null;
}

/**
 * Los tildes de un mensaje propio: `read` si todos los demás integrantes lo leyeron, `delivered` si todos
 * lo recibieron, `sent` en cualquier otro caso. `others` son los demás integrantes que cuentan: no entran
 * quienes tienen un bloqueo con el autor (no ven el mensaje, no pueden "no leerlo"). Sin nadie más,
 * el mensaje queda en `sent`.
 */
export function computeDeliveryStatus(
  messageCreatedAt: Date,
  others: readonly ChatReceiptState[]
): ChatDeliveryStatus {
  if (others.length === 0) return "sent";
  const at = messageCreatedAt.getTime();
  if (others.every((o) => o.lastReadAt !== null && o.lastReadAt.getTime() >= at)) return "read";
  if (others.every((o) => o.lastDeliveredAt !== null && o.lastDeliveredAt.getTime() >= at)) return "delivered";
  return "sent";
}
