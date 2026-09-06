/**
 * Estado del ciclo de vida de un envío.
 *
 * Set canónico del proyecto (MOVO-79, criterio 6): estos 9 valores y ningún
 * otro. Alineado 1:1 con el enum `status` de `shipments.shipments`
 * (MOVO-104/MOVO-79A) y con las transiciones que define la máquina de
 * estados de dominio (`shipment-state-machine.ts` en `movo-svc-shipments`,
 * MOVO-105) — agregar un valor nuevo obliga a actualizar, en el mismo PR,
 * ambos lados más el AC3 de MOVO-19.
 */
export enum ShipmentStatus {
  AWAITING_RECEIVER_CONFIRMATION = "awaiting_receiver_confirmation",
  REJECTED_BY_RECEIVER = "rejected_by_receiver",
  PUBLISHED = "published",
  ASSIGNMENT_PENDING = "assignment_pending",
  ASSIGNED = "assigned",
  IN_TRANSIT = "in_transit",
  DELIVERED = "delivered",
  CANCELLED = "cancelled",
  DISPUTED = "disputed",
}

/**
 * MOVO-170: historial de envíos compartido entre el usuario autenticado (viewer) y
 * otro usuario cualquiera, sin importar en qué rol haya participado cada uno
 * (emisor/receptor/transportista) en cada envío — wire contract de
 * `GET /shipments/history-with/:userId` (`movo-svc-shipments`). `lastSharedAt` es
 * `null` únicamente sin ningún envío en común. `allDelivered` es `false` también sin
 * historial (`sharedShipmentCount: 0`) — no hay "todos entregados" sin envíos.
 */
export interface SharedHistory {
  sharedShipmentCount: number;
  lastSharedAt: string | null;
  allDelivered: boolean;
}
