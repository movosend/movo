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
