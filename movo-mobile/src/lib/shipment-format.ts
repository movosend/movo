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

/** Nunca "$0" — un envío recién creado sin precio acordado todavía muestra la
 * sugerencia, nunca un número que parezca gratis. */
export function formatShipmentPrice(agreedPriceArs: number | null, suggestedPriceArs: number): string {
  const price = agreedPriceArs ?? suggestedPriceArs;
  if (price === null || price === undefined || Number.isNaN(price)) return "Precio a definir";
  return `$${price.toLocaleString("es-AR")}`;
}
