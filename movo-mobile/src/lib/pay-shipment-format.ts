import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { HoldFailureReason } from "@movo/shared/dist/types/hold";
import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { cardBrandKey } from "./card-brand";
import { friendlyErrorMessage } from "./error-messages";
import type { PayShipmentOutcome } from "./pay-shipment-flow";
import { isCardExpired, sortSavedCards } from "./saved-cards";
import { formatRelativeDuration } from "./time-format";

/**
 * Presentación pura del pago con tarjeta guardada + CVV (MOVO-269). Los textos salen del
 * prototipo de Claude Design "MOVO-269 Pago con tarjeta v3".
 */

/** Largo del código de seguridad: 4 en American Express, 3 en el resto. */
export function cvvLengthFor(card: Pick<SavedCard, "brand">): number {
  return cardBrandKey(card.brand) === "amex" ? 4 : 3;
}

/** La predeterminada si se puede usar; si no, la primera vigente. `null` si ninguna sirve. */
export function defaultPayableCard(cards: SavedCard[], now: Date = new Date()): SavedCard | null {
  return sortSavedCards(cards, now).find((card) => !isCardExpired(card, now)) ?? null;
}

/** "Quedan 23 h" / "Quedan 45 min" / "Vence en instantes". `null` sin plazo o ya vencido. */
export function formatPayTimeLeft(payUntil: string | null | undefined, now: Date = new Date()): string | null {
  if (!payUntil) return null;
  const ms = new Date(payUntil).getTime() - now.getTime();
  if (Number.isNaN(ms) || ms <= 0) return null;
  const minutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `Quedan ${formatRelativeDuration(minutes)}`;
  return `Quedan ${Math.floor(hours / 24)} días`;
}

export interface PayFailureCopy {
  title: string;
  body: string;
  /** El problema está en el código (se resalta el campo); el resto sugiere otra tarjeta. */
  field: "cvv" | null;
  /** Se sugiere elegir otra tarjeta. */
  suggestOtherCard: boolean;
}

/** "Visa •••• 3704" para el cuerpo de los rechazos. */
export function rejectionCopy(reason: HoldFailureReason, amountLabel: string, cardTitle: string): PayFailureCopy {
  switch (reason) {
    case "insufficient_funds":
      return {
        title: "Tu tarjeta no tiene fondos suficientes",
        body: `No pudimos retener ${amountLabel} en tu ${cardTitle}. No se cobró nada. Elegí otra tarjeta o probá de nuevo.`,
        field: null,
        suggestOtherCard: true,
      };
    case "card_rejected":
      return {
        title: "Tu banco rechazó la tarjeta",
        body: "Puede ser un límite, un bloqueo del banco o que la tarjeta esté vencida. No se cobró nada. Probá con otra tarjeta.",
        field: null,
        suggestOtherCard: true,
      };
    case "invalid_data":
      return {
        title: "Revisá el código de seguridad",
        body: "El código no coincide con la tarjeta. No se cobró nada.",
        field: "cvv",
        suggestOtherCard: false,
      };
    case "platform_error":
    default:
      return {
        title: "No pudimos reservar los fondos",
        body: "Hubo un problema de nuestro lado. No se cobró nada: probá de nuevo en unos minutos.",
        field: null,
        suggestOtherCard: false,
      };
  }
}

/** Mensaje de un fallo que no es un rechazo de la tarjeta (token, red, backend). */
export function payErrorMessage(outcome: Extract<PayShipmentOutcome, { kind: "token_error" | "error" }>): PayFailureCopy {
  if (outcome.kind === "token_error") {
    const { reason } = outcome.error.failure;
    if (reason === "network") {
      return {
        title: "No pudimos conectarnos con Mercado Pago",
        body: "Revisá tu conexión y probá de nuevo. No se cobró nada.",
        field: null,
        suggestOtherCard: false,
      };
    }
    return {
      title: "Revisá el código de seguridad",
      body: "Mercado Pago no aceptó el código o la tarjeta. No se cobró nada: revisá el código o elegí otra tarjeta.",
      field: "cvv",
      suggestOtherCard: true,
    };
  }
  return {
    title: "No pudimos reservar los fondos",
    body: friendlyErrorMessage(outcome.error, "Probá de nuevo en unos minutos. No se cobró nada.", {
      // En el mapa global este código es del transportista ("vinculá tu cuenta"); acá lo ve el emisor.
      CARRIER_MP_ACCOUNT_NOT_LINKED:
        "El transportista no puede recibir pagos en este momento. No se cobró nada: probá más tarde o elegí otra oferta.",
    }),
    field: null,
    suggestOtherCard: false,
  };
}

/** Qué mostrar cuando `GET/POST /funding` responde que ya no se puede pagar (409). */
export type UnavailableKind = "released" | "already_funded" | "unavailable";

export function unavailableKind(status: ShipmentStatus | undefined): UnavailableKind {
  switch (status) {
    case ShipmentStatus.PUBLISHED:
    case ShipmentStatus.CANCELLED:
      return "released";
    case ShipmentStatus.ASSIGNED:
    case ShipmentStatus.IN_TRANSIT:
    case ShipmentStatus.DELIVERED:
    case ShipmentStatus.COMPLETED:
      return "already_funded";
    default:
      return "unavailable";
  }
}

/**
 * ¿Hay que reconciliar el estado del envío tras este resultado? Un error del backend que no es de
 * validación (409 `HOLD_CONFLICT`, timeout, 5xx) puede venir con el hold ya creado o con monto,
 * transportista o plazo viejos: sin refrescar, el usuario reintenta sobre un envío que ya cambió.
 */
export function shouldReconcileAfterPayError(outcome: PayShipmentOutcome): boolean {
  if (outcome.kind !== "error") return false;
  const { error } = outcome;
  if (error instanceof ApiError && (error.statusCode === 400 || error.statusCode === 422)) return false;
  return true;
}
