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

/**
 * Rol del CALIFICADO dentro de UN envío puntual (MOVO-146, `movo-svc-shipments`) — no
 * un rol de cuenta (`UserRole`). Primera vez que cruza a `@movo/shared` (MOVO-222):
 * antes vivía por separado como el enum Prisma `RatingRole` del backend
 * (`services/movo-svc-shipments/src/models/rating.ts`) y como un literal propio en
 * `movo-mobile/src/api/ratings-client.ts` — mismos 3 valores en los tres lados, sin
 * unificar hasta ahora porque ningún wire contract cruzaba el barrel compartido.
 */
export type RatingRole = "sender" | "carrier" | "receiver";

/**
 * Wire contract de `GET /shipments/pending-ratings` (`movo-svc-shipments`, MOVO-222):
 * envíos `delivered`/`completed` donde el usuario autenticado todavía tiene, dentro de
 * la ventana de 72hs (MOVO-146), alguna contraparte sin calificar — según la regla de
 * "interacción física" ya definida en MOVO-153 (emisor/receptor califican solo al
 * transportista; el transportista califica a ambos), sin cambiarla (fuera de alcance
 * explícito del ticket).
 *
 * Endpoint dedicado en vez de un campo en `ShipmentSummary`/`GET /shipments/mine`
 * (la alternativa que el propio ticket dejaba planteada): `/mine` nunca incluyó
 * envíos donde el usuario es solo `carrierId` (gap desde MOVO-80, "no hay asignación
 * automática este sprint" en ese momento) — el caso "transportista con 2
 * contrapartes" del DoD de MOVO-222 no es representable ahí sin ampliar el filtro de
 * `/mine` y afectar la paginación/orden de 3 pantallas mobile ya existentes
 * (`RecentShipmentsSection`, "Mis Envíos", `use-attention-tasks.ts`) que no están en
 * el alcance de este ticket. El endpoint nuevo escanea sender+receiver+carrier y
 * filtra server-side — `pendingRatingFor` nunca viaja vacío en un ítem de esta lista
 * (un envío sin nada pendiente simplemente no aparece), a diferencia del campo
 * `RatingRole[] | null` que evaluó primero el ticket para `ShipmentSummary`. Sin
 * paginación (mismo criterio que MOVO-192): el volumen realista — envíos entregados
 * en las últimas 72hs con algo pendiente — nunca es grande.
 *
 * `ratingDeadline` es el instante absoluto ya calculado por
 * `computeRatingWindowDeadline` (`movo-svc-shipments`, `deliveredAt` + 72hs
 * extendidas por cualquier freeze de disputa, MOVO-146 AC9) — mismo criterio que
 * `ActiveShipmentSummary.receiverConfirmationDeadline` (deadline resuelto en el
 * servidor, nunca timestamp crudo). Necesario porque el cliente no puede recomputar
 * el corte de 72hs a partir de solo `deliveredAt`: el freeze de disputa lo extiende
 * de forma variable y esa lógica vive únicamente del lado del backend.
 */
export interface PendingRatingShipment {
  id: string;
  status: ShipmentStatus.DELIVERED | ShipmentStatus.COMPLETED;
  deliveredAt: string;
  ratingDeadline: string;
  senderId: string;
  receiverId: string;
  carrierId: string;
  pendingRatingFor: RatingRole[];
}
