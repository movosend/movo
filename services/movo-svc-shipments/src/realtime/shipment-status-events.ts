import { EventEmitter } from "node:events";
import { ShipmentStatus } from "@movo/shared";

export interface ShipmentStatusChangedEvent {
  shipmentId: string;
  to: ShipmentStatus;
}

/**
 * MOVO-201/AC4: notifica en el mismo proceso cuando se confirma una transición de
 * `status`, para que el plugin `realtime.ts` pueda cerrar en el acto cualquier socket
 * de tracking abierto sobre ese envío -- sin esto, el cierre solo pasaría en la
 * próxima reconexión del cliente. No es un message broker (ADR-001 no aplica: esto no
 * cruza procesos) -- alcanza porque `svc-shipments` corre en una sola réplica
 * (ADR-006, sin auto-scaling). Dos emisores, ambos después de que su propio
 * `$transaction` confirma (nunca antes -- un rollback no debe cerrar ningún socket):
 * `shipment-repository.ts#updateStatus()` (MOVO-104, la vía general) y
 * `handshake-repository.ts#confirmAndPersist()` (MOVO-158, la única vía de
 * `in_transit -> delivered` -- fix de review, PR #174: quedó sin emitir hasta
 * entonces, así que una entrega real vía handshake no cerraba el socket). `acceptOffer()`
 * en `offer-repository.ts` escribe `status` directo sin pasar por ninguno de los dos,
 * pero nunca hacia un valor de `TRACKING_CLOSED_STATUSES` -- documentado en
 * `shipment-repository.ts`.
 */
export const shipmentStatusEvents = new EventEmitter();

export const SHIPMENT_STATUS_CHANGED_EVENT = "shipment-status-changed";

export function emitShipmentStatusChanged(event: ShipmentStatusChangedEvent): void {
  shipmentStatusEvents.emit(SHIPMENT_STATUS_CHANGED_EVENT, event);
}

export function onShipmentStatusChanged(listener: (event: ShipmentStatusChangedEvent) => void): void {
  shipmentStatusEvents.on(SHIPMENT_STATUS_CHANGED_EVENT, listener);
}
