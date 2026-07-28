/**
 * Estado del ciclo de vida de un envío.
 *
 * Provisorio: el DER (`Movo_DER_1.0.md`) define `Shipment.status` como
 * `string` libre, sin enumerar valores — la máquina de estados formal es
 * responsabilidad de MOVO-79 ("[svc-shipments] Schema, migraciones y
 * máquina de estados del ciclo de vida del envío"), que todavía no se
 * implementó. No usar estos valores como contrato final; ver comentario
 * en MOVO-67 en Linear.
 */
export enum ShipmentStatus {
  CREATED = "created",
  MATCHED = "matched",
  IN_TRANSIT = "in_transit",
  DELIVERED = "delivered",
  CANCELLED = "cancelled",
}
