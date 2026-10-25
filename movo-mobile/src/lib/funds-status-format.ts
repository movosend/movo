import type {
  FundingLapseReason,
  ShipmentFundingView,
} from "@movo/shared/dist/types/funding";
import type { HoldFailureReason } from "@movo/shared/dist/types/hold";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { toArgentinaCalendarDateString, toArgentinaTimeOfDayString } from "@movo/shared/dist/utils/argentina-date";
import type { ShipmentSummary } from "../api/shipments-client";
import { formatPickupDayLabel } from "./shipment-format";
import { formatTimeOfDay } from "./time-format";

/**
 * MOVO-211: qué card de la reserva de fondos se muestra en el detalle del envío. La fase la
 * calcula `svc-shipments` (`ShipmentFundingView`); acá solo se elige la variante visual y el
 * copy. Regla de todo el archivo (AC7): ningún texto afirma un débito que no ocurrió. Una
 * reserva se describe como "reservado"/"retenido", nunca como "cobrado", hasta `captured`.
 */
export type FundsStatusVariant =
  // Emisor
  | "awaiting_window" // assigned_unfunded con la ventana cerrada
  | "confirm" // assigned_unfunded con la ventana abierta, sin intento
  | "processing" // MP está validando la tarjeta
  | "unfinished" // assignment_pending sin intento completo
  | "rejected" // último intento rechazado, con motivo
  | "held" // assigned
  | "held_in_transit" // in_transit
  | "held_delivered" // vista disponible para reutilizar la card; el detalle actual muestra PaymentBreakdown
  | "captured" // vista disponible para reutilizar la card; el detalle actual muestra PaymentBreakdown
  | "released" // cancelado con una reserva que se liberó
  | "lapsed" // volvió a published por falta de pago
  // Transportista
  | "carrier_pending"
  | "carrier_held"
  | "carrier_lapsed";

export function fundsStatusVariant(
  funding: ShipmentFundingView | null | undefined,
  status: ShipmentStatus,
): FundsStatusVariant | null {
  if (!funding) return null;
  if (funding.viewer === "carrier") {
    return funding.phase === "held" ? "carrier_held" : "carrier_pending";
  }
  if (funding.viewer === "former_carrier") return "carrier_lapsed";

  switch (funding.phase) {
    case "awaiting_window":
      return "awaiting_window";
    case "payment_due":
      if (funding.lastAttempt === "in_process") return "processing";
      if (funding.lastAttempt === "rejected") return "rejected";
      // Sin intento: en la ruta cercana el emisor ya empezó el flujo al aceptar, así que el
      // pago "quedó sin terminar"; en la lejana todavía no lo intentó. `null` (payments no
      // respondió) cae al estado genérico de confirmar, que siempre es cierto.
      return funding.route === "near" && funding.lastAttempt === "none" ? "unfinished" : "confirm";
    case "held":
      if (status === ShipmentStatus.IN_TRANSIT) return "held_in_transit";
      if (status === ShipmentStatus.DELIVERED) return "held_delivered";
      return "held";
    case "captured":
      return "captured";
    case "released":
      return "released";
    case "lapsed":
      return "lapsed";
  }
}

/** "10:00 h" en hora argentina (UTC-3 fijo, mismo criterio que el resto del dominio). */
function argentinaTimeOfDay(instant: Date): string {
  return formatTimeOfDay(toArgentinaTimeOfDayString(instant));
}

/** "mié 8 oct" / "Mañana" / "Hoy" para un instante ISO, en día calendario argentino. */
export function formatFundingDay(iso: string, now: Date = new Date()): string {
  return formatPickupDayLabel(toArgentinaCalendarDateString(iso), now);
}

/** Frase completa para el plazo: "el mié 8 oct a las 10:00 h" / "hoy a las 18:30 h". */
export function formatFundingDeadline(iso: string, now: Date = new Date()): string {
  const day = formatFundingDay(iso, now);
  const dayLabel = day === "Hoy" || day === "Mañana" ? day.toLowerCase() : day;
  return `${day === "Hoy" || day === "Mañana" ? "" : "el "}${dayLabel} a las ${argentinaTimeOfDay(new Date(iso))}`;
}

export function formatFundingDayWithArticle(iso: string, now: Date = new Date()): string {
  const day = formatFundingDay(iso, now);
  return day === "Hoy" || day === "Mañana" ? day.toLowerCase() : `el ${day}`;
}

/** AC5: motivo diferenciado del rechazo, con qué hacer. */
export function failureReasonCopy(reason: HoldFailureReason | null): { title: string; body: string } {
  switch (reason) {
    case "insufficient_funds":
      return {
        title: "Tu tarjeta no tiene fondos suficientes",
        body: "No alcanzó el saldo o el límite disponible para reservar el monto. Probá con otra tarjeta.",
      };
    case "invalid_data":
      return {
        title: "Los datos de la tarjeta no coinciden",
        body: "Revisá el número, el vencimiento o el código de seguridad, o probá con otra tarjeta.",
      };
    case "platform_error":
      return {
        title: "No pudimos procesar el pago",
        body: "Fue un problema de nuestro lado o de Mercado Pago, no de tu tarjeta. Probá de nuevo en unos minutos.",
      };
    case "card_rejected":
    default:
      return {
        title: "Tu banco rechazó la tarjeta",
        body: "Puede ser un bloqueo o un límite del banco. Probá con otra tarjeta o consultá con tu banco.",
      };
  }
}

/** AC6: por qué el envío volvió a publicarse, para cada parte. */
export function lapseReasonCopy(
  reason: FundingLapseReason,
  viewer: "sender" | "carrier",
): string {
  const who = "el transportista";
  if (viewer === "sender") {
    return reason === "window_expired"
      ? `No confirmaste el pago a tiempo, así que ${who} quedó liberado y el envío volvió a recibir ofertas.`
      : `Empezaste a confirmar el pago pero no se completó a tiempo, así que ${who} quedó liberado y el envío volvió a recibir ofertas.`;
  }
  return reason === "window_expired"
    ? "El emisor no confirmó el pago antes del plazo."
    : "El pago del emisor no se completó a tiempo.";
}

/** "Visa •••• 3704". La marca viene como `payment_method_id` de MP (`visa`, `master`, ...). */
export function formatFundingCard(card: { brand: string; lastFour: string }): string {
  const BRANDS: Record<string, string> = {
    visa: "Visa",
    debvisa: "Visa Débito",
    master: "Mastercard",
    debmaster: "Mastercard Débito",
    amex: "American Express",
    naranja: "Naranja",
    cabal: "Cabal",
    debcabal: "Cabal Débito",
    maestro: "Maestro",
  };
  const brand = BRANDS[card.brand] ?? card.brand.charAt(0).toUpperCase() + card.brand.slice(1);
  return `${brand} •••• ${card.lastFour}`;
}

/** Cada cuánto se refresca el detalle mientras Mercado Pago revisa el pago. */
export const FUNDING_PROCESSING_POLL_MS = 5000;

/**
 * `refetchInterval` del detalle: con un pago en revisión (`in_process`) se consulta seguido
 * para pasar a "reservado" (o al rechazo) sin que el emisor tenga que refrescar a mano.
 */
export function fundingProcessingPollInterval(shipment: ShipmentSummary | undefined): number | false {
  const funding = shipment?.funding;
  return funding?.viewer === "sender" && funding.phase === "payment_due" && funding.lastAttempt === "in_process"
    ? FUNDING_PROCESSING_POLL_MS
    : false;
}
