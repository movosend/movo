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
