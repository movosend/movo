/**
 * Estado del ciclo de vida de un envío.
 *
 * Set canónico del proyecto (MOVO-79, criterio 6; extendido a 11 valores por
 * MOVO-208): estos 11 valores y ningún otro. Alineado 1:1 con el enum
 * `status` de `shipments.shipments` (MOVO-104/MOVO-79A) y con las
 * transiciones que define la máquina de estados de dominio
 * (`shipment-state-machine.ts` en `movo-svc-shipments`, MOVO-105) — agregar
 * un valor nuevo obliga a actualizar, en el mismo PR, ambos lados más el AC3
 * de MOVO-19.
 *
 * `ASSIGNED_UNFUNDED`/`COMPLETED` (MOVO-208): consecuencia de la decisión de
 * arquitectura del hold de MOVO-12 (opción B, hold anclado cerca del retiro,
 * no en la aceptación) y de separar "entregado" de "entregado y cobrado".
 * Ninguna de las dos transiciones se dispara todavía — MOVO-210 (saga de
 * asignación) y MOVO-212 (captura y split) las disparan, ambos bloqueados
 * por Mercado Pago.
 */
export enum ShipmentStatus {
  AWAITING_RECEIVER_CONFIRMATION = "awaiting_receiver_confirmation",
  REJECTED_BY_RECEIVER = "rejected_by_receiver",
  PUBLISHED = "published",
  ASSIGNMENT_PENDING = "assignment_pending",
  ASSIGNED_UNFUNDED = "assigned_unfunded",
  ASSIGNED = "assigned",
  IN_TRANSIT = "in_transit",
  DELIVERED = "delivered",
  COMPLETED = "completed",
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

/**
 * Subconjunto "activo" de `ShipmentStatus` para `GET /shipments/sending|transporting|
 * receiving` (MOVO-192): transportista ya comprometido con el envío, hasta la entrega
 * (exclusive). Ni `published`/`assignment_pending` (sin compromiso firme de un
 * transportista todavía) ni ningún estado terminal caen en este subconjunto.
 */
export type ActiveShipmentStatus = ShipmentStatus.ASSIGNED_UNFUNDED | ShipmentStatus.ASSIGNED | ShipmentStatus.IN_TRANSIT;

/**
 * Nombre e iniciales de la contraparte relevante para el rol consultado (AC5 de
 * MOVO-192) — nunca el id crudo ni datos de contacto, mismo criterio de exposición
 * mínima que `Offer.carrierNameAtOffer`.
 */
export interface ActiveShipmentCounterparty {
  name: string;
  initials: string;
}

/**
 * Wire contract de `GET /shipments/sending` / `GET /shipments/transporting` /
 * `GET /shipments/receiving` (`movo-svc-shipments`, MOVO-192) — DTO de resumen
 * deliberadamente sin `senderId`/`receiverId`/`carrierId` ni datos de contacto (AC5):
 * el rol ya lo fija el endpoint consultado, y la identidad de la contraparte viaja
 * resuelta en `counterparty`, no como id crudo. Sin paginación (fuera de alcance del
 * ticket) y sin ningún campo de ETA/proximidad — esa señal es tracking en vivo
 * (MOVO-203/MOVO-11), todavía sin empezar. `isToday`/`pickupWindowExpired` los calcula
 * siempre el backend (AC6), nunca el cliente, para que el badge sea consistente entre
 * dispositivos con reloj o zona horaria distintos. `agreedPriceArs` es `number | null`
 * (no solo `number`, a diferencia del contrato propuesto en el comentario del ticket
 * de Linear): la columna real sigue siendo nullable y ningún flujo la puebla todavía
 * al aceptar una oferta (gap preexistente, ver `services/movo-svc-shipments/CLAUDE.md`
 * — MOVO-192).
 */
export interface ActiveShipmentSummary {
  id: string;
  status: ActiveShipmentStatus;
  pickupDate: string;
  pickupTimeWindowStart: string;
  pickupTimeWindowEnd: string;
  pickupAddress: string;
  deliveryAddress: string;
  agreedPriceArs: number | null;
  counterparty: ActiveShipmentCounterparty;
  isToday: boolean;
  pickupWindowExpired: boolean;
}
