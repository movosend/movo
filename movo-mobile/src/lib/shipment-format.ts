import { ShipmentStatus } from "@movo/shared/dist/types/shipment";

/** Etiqueta en español de cada estado del ciclo de vida (`shipment-state-machine.ts`
 * en `movo-svc-shipments`, MOVO-105) — un valor nuevo en el enum obliga a decidir acá
 * también, el fallback (`status` crudo) es deliberadamente poco amigable para que se
 * note en QA si falta agregar la traducción. */
const STATUS_LABEL: Record<ShipmentStatus, string> = {
  [ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION]: "Esperando confirmación",
  [ShipmentStatus.REJECTED_BY_RECEIVER]: "Rechazado por el receptor",
  [ShipmentStatus.PUBLISHED]: "Publicado",
  [ShipmentStatus.ASSIGNMENT_PENDING]: "Buscando transportista",
  [ShipmentStatus.ASSIGNED]: "Transportista asignado",
  [ShipmentStatus.IN_TRANSIT]: "En camino",
  [ShipmentStatus.DELIVERED]: "Entregado",
  [ShipmentStatus.CANCELLED]: "Cancelado",
  [ShipmentStatus.DISPUTED]: "En disputa",
};

export function shipmentStatusLabel(status: ShipmentStatus): string {
  return STATUS_LABEL[status] ?? status;
}

/** Tono visual del estado, reusa la misma paleta semántica que `kyc-status-ui.tsx`. */
export function shipmentStatusTone(
  status: ShipmentStatus,
): "success" | "warning" | "danger" | "info" | "neutral" {
  switch (status) {
    case ShipmentStatus.DELIVERED:
      return "success";
    case ShipmentStatus.CANCELLED:
    case ShipmentStatus.REJECTED_BY_RECEIVER:
    case ShipmentStatus.DISPUTED:
      return "danger";
    case ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION:
    case ShipmentStatus.ASSIGNMENT_PENDING:
      return "warning";
    case ShipmentStatus.ASSIGNED:
    case ShipmentStatus.IN_TRANSIT:
      return "info";
    case ShipmentStatus.PUBLISHED:
    default:
      return "neutral";
  }
}

/** Agrupa el ciclo de vida en dos etapas para las tabs "En curso"/"Completados" de
 * "Mis Envíos" (MOVO-127) — patrón estándar de listados de pedidos/viajes (Uber,
 * apps de delivery). `DISPUTED` cuenta como "en curso": todavía espera una resolución,
 * no es un estado final desde la perspectiva del usuario. */
export function shipmentLifecycleStage(status: ShipmentStatus): "ongoing" | "past" {
  switch (status) {
    case ShipmentStatus.DELIVERED:
    case ShipmentStatus.CANCELLED:
    case ShipmentStatus.REJECTED_BY_RECEIVER:
      return "past";
    default:
      return "ongoing";
  }
}

/** Estado de confirmación del receptor (AC7 de MOVO-127, feedback post-QA) — derivado
 * de `ShipmentStatus`, no hay una columna separada: `awaiting_receiver_confirmation`/
 * `rejected_by_receiver` son los únicos dos estados donde el receptor todavía no dio
 * el visto bueno; cualquier estado posterior (`published` en adelante) implica que ya
 * confirmó, porque no hay transición posible sin pasar por esa confirmación. */
export function receiverConfirmationStatus(status: ShipmentStatus): "pending" | "confirmed" | "rejected" {
  if (status === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION) return "pending";
  if (status === ShipmentStatus.REJECTED_BY_RECEIVER) return "rejected";
  return "confirmed";
}

/** Nunca "$0" — un envío recién creado sin precio acordado todavía muestra la
 * sugerencia, nunca un número que parezca gratis. */
export function formatShipmentPrice(agreedPriceArs: number | null, suggestedPriceArs: number): string {
  const price = agreedPriceArs ?? suggestedPriceArs;
  if (price === null || price === undefined || Number.isNaN(price)) return "Precio a definir";
  return `$${price.toLocaleString("es-AR")}`;
}

/** Hermana de `formatShipmentPrice`, para el preview de precio del paso de resumen
 * del wizard de envíos (MOVO-83, AC7/AC8) — ahí no hay todavía un `ShipmentSummary`
 * real, solo un `number | null` de un `PricingProvider` (mock o real). `null`
 * significa "falta un dato requerido o el servicio de pricing no respondió". */
export function formatPriceArs(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "Precio a estimar";
  return `$${value.toLocaleString("es-AR")}`;
}

const PICKUP_DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "numeric",
  month: "long",
});

/** `pickupDate` viaja como string `"YYYY-MM-DD"` (wire format, sin hora) — se parsea
 * con año/mes/día explícitos, nunca `new Date(pickupDate)`, para no interpretarlo como
 * medianoche UTC y correr el día en zonas horarias negativas (Argentina, UTC-3). */
export function formatPickupDateLabel(pickupDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) return null;
  const [year, month, day] = pickupDate.split("-").map(Number);
  return PICKUP_DATE_FORMATTER.format(new Date(year, month - 1, day));
}

/** Título de un evento de la línea de tiempo (`GET /shipments/:id/events`, MOVO-128)
 * — narrativo y en pasado ("Transportista asignado"), a diferencia de
 * `shipmentStatusLabel`, que nombra el estado actual del envío ("Transportista
 * asignado" como situación). El evento inicial (`fromStatus === null`, único caso
 * garantizado por el backend) se muestra como "Envío creado" en vez de "Esperando
 * confirmación": lo que pasó ahí fue la creación, el estado es solo su consecuencia. */
export function shipmentEventTitle(toStatus: ShipmentStatus, fromStatus: ShipmentStatus | null): string {
  if (fromStatus === null) return "Envío creado";

  switch (toStatus) {
    case ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION:
      return "Esperando confirmación del receptor";
    case ShipmentStatus.REJECTED_BY_RECEIVER:
      return "El receptor rechazó el envío";
    case ShipmentStatus.PUBLISHED:
      return "Publicado para transportistas";
    case ShipmentStatus.ASSIGNMENT_PENDING:
      return "Buscando transportista";
    case ShipmentStatus.ASSIGNED:
      return "Transportista asignado";
    case ShipmentStatus.IN_TRANSIT:
      return "El paquete salió en camino";
    case ShipmentStatus.DELIVERED:
      return "Paquete entregado";
    case ShipmentStatus.CANCELLED:
      return "Envío cancelado";
    case ShipmentStatus.DISPUTED:
      return "Envío en disputa";
    default:
      return shipmentStatusLabel(toStatus);
  }
}

/** Camino feliz del ciclo de vida, en orden — el mismo grafo de
 * `shipment-state-machine.ts` (`svc-shipments`, MOVO-105) recorrido por su rama sin
 * incidentes. Los estados terminales por excepción (`cancelled`,
 * `rejected_by_receiver`, `disputed`) quedan afuera a propósito: no son "el próximo
 * paso" de nada, son salidas. `assignment_pending` sí entra — es un estado que el
 * usuario efectivamente ve mientras se reservan los fondos, no un detalle interno. */
const HAPPY_PATH: readonly ShipmentStatus[] = [
  ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
  ShipmentStatus.PUBLISHED,
  ShipmentStatus.ASSIGNMENT_PENDING,
  ShipmentStatus.ASSIGNED,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.DELIVERED,
];

/**
 * Pasos que todavía faltan para llegar a la entrega, para pintarlos en gris apagado
 * al final de la línea de tiempo. Es una proyección, no historial: nunca lleva
 * timestamp ni actor, y un envío que salió del camino feliz (cancelado, rechazado, en
 * disputa) devuelve lista vacía — no tiene sentido prometer "Entrega" debajo de un
 * envío cancelado. `assignment_pending` puede volver a `published` si falla el hold de
 * fondos; buscar el índice del estado actual (en vez de contar transiciones ocurridas)
 * hace que el retroceso vuelva a listar los pasos correctos sin lógica extra.
 */
export function remainingLifecycleSteps(currentStatus: ShipmentStatus): ShipmentStatus[] {
  const index = HAPPY_PATH.indexOf(currentStatus);
  if (index === -1) return [];
  return HAPPY_PATH.slice(index + 1);
}

/** Etiqueta de un paso que todavía no ocurrió — en infinitivo/sustantivo ("Retiro del
 * paquete") en vez del pasado de `shipmentEventTitle` ("El paquete salió en camino"):
 * un paso futuro descrito en pasado se lee como algo que ya pasó. */
export function shipmentPendingStepLabel(status: ShipmentStatus): string {
  switch (status) {
    case ShipmentStatus.PUBLISHED:
      return "Publicación para transportistas";
    case ShipmentStatus.ASSIGNMENT_PENDING:
      return "Búsqueda de transportista";
    case ShipmentStatus.ASSIGNED:
      return "Asignación del transportista";
    case ShipmentStatus.IN_TRANSIT:
      return "Retiro del paquete";
    case ShipmentStatus.DELIVERED:
      return "Entrega al receptor";
    default:
      return shipmentStatusLabel(status);
  }
}

const EVENT_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** `createdAt` de un evento viaja como ISO datetime completo (con offset), a
 * diferencia de `pickupDate` — acá sí se parsea con `new Date` y se muestra en la
 * zona horaria del dispositivo, que es la correcta para "cuándo pasó esto". Devuelve
 * `null` ante una fecha inválida para que el caller decida qué mostrar, nunca
 * "Invalid Date". */
export function formatEventTimestamp(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return EVENT_TIMESTAMP_FORMATTER.format(date);
}

/** Quién disparó la transición, resuelto contra los ids que ya tiene el envío en vez
 * de pedir el perfil de `actorId` (`GET /users/:id`) — el rol es lo informativo en una
 * línea de tiempo, y el nombre de la contraparte ya se muestra en `CounterpartCard`.
 * `null` = sin actor humano (transición automática del sistema) o un actor que no es
 * ninguna de las tres partes (un admin resolviendo una disputa). */
export function shipmentActorLabel(
  actorId: string | null,
  parties: { senderId: string; receiverId: string; carrierId: string | null },
  currentUserId: string | null,
): string | null {
  if (actorId === null) return null;
  if (currentUserId !== null && actorId === currentUserId) return "Vos";
  if (actorId === parties.senderId) return "El emisor";
  if (actorId === parties.receiverId) return "El receptor";
  if (parties.carrierId !== null && actorId === parties.carrierId) return "El transportista";
  return "Equipo Movo";
}

/** Recorta una dirección completa a su primer segmento, antes de la primera coma —
 * "Av. Colón 1234, Córdoba" → "Av. Colón 1234" (MOVO-127, card de `ShipmentCard`). El
 * modelo no tiene un campo de barrio separado, así que la calle es el identificador
 * más corto y reconocible disponible para una mini-ruta de dos puntos. */
export function shortAddressLabel(address: string): string {
  return address.split(",")[0].trim();
}

/** Ventana horaria de retiro formateada para la card de listado (MOVO-127) — deja el
 * rango explícito ("09:00 a 12:00") en vez de inventar frases relativas tipo "antes de
 * las 15h", que requerirían comparar `pickupDate` contra "hoy" y reabrir el mismo
 * riesgo de desfasaje de huso horario que ya documenta `formatPickupDateLabel`. */
export function formatPickupWindowLabel(start: string, end: string): string {
  return `${start} a ${end}`;
}
