import { EventEmitter } from "node:events";
import { ShipmentStatus } from "@movo/shared";

export interface ShipmentStatusChangedEvent {
  shipmentId: string;
  to: ShipmentStatus;
}

/**
 * MOVO-201/AC4: notifica en el mismo proceso cuando `shipment-repository.ts#updateStatus()`
 * confirma una transición, para que el plugin `realtime.ts` pueda cerrar en el acto
 * cualquier socket de tracking abierto sobre ese envío -- sin esto, el cierre solo
 * pasaría en la próxima reconexión del cliente. No es un message broker (ADR-001 no
 * aplica: esto no cruza procesos) -- alcanza porque `svc-shipments` corre en una sola
 * réplica (ADR-006, sin auto-scaling) y `updateStatus()` es la única vía de escritura
 * de `status` (MOVO-104) que llega a los valores de `TRACKING_CLOSED_STATUSES`
 * (`acceptOffer()` en `offer-repository.ts` escribe `status` directo sin pasar por acá,
 * pero nunca hacia esos valores -- documentado en `shipment-repository.ts`).
 */
export const shipmentStatusEvents = new EventEmitter();

export const SHIPMENT_STATUS_CHANGED_EVENT = "shipment-status-changed";

export function emitShipmentStatusChanged(event: ShipmentStatusChangedEvent): void {
  shipmentStatusEvents.emit(SHIPMENT_STATUS_CHANGED_EVENT, event);
}

export function onShipmentStatusChanged(listener: (event: ShipmentStatusChangedEvent) => void): void {
  shipmentStatusEvents.on(SHIPMENT_STATUS_CHANGED_EVENT, listener);
}
