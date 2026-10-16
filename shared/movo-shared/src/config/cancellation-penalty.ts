import { ShipmentStatus } from "../types/shipment";

/**
 * MOVO-307 (MOVO-226, ADR-047): penalidad por cancelar un envío `assigned`. Regla única,
 * compartida entre `movo-svc-shipments` (cotiza y cobra) y `movo-mobile` (muestra el monto
 * antes de confirmar), así los dos calculan lo mismo.
 *
 * Tramos, medidos contra el inicio de la ventana de retiro ACORDADA (la del envío después
 * de aceptar la oferta, MOVO-258 D3):
 * - faltan 12 h o más: sin cargo;
 * - faltan menos de 12 h y la ventana sigue abierta: 25 % del precio acordado;
 * - la ventana ya cerró: sin cargo (el que faltó fue el transportista).
 */
export const CANCELLATION_PENALTY_FREE_HOURS = 12;

/** Fracción del precio acordado que se cobra como penalidad. */
export const CANCELLATION_PENALTY_RATE = 0.25;

/**
 * - `not_assigned`: el envío no está `assigned` (todavía no hay fondos reservados): sin cargo.
 * - `before_free_deadline`: faltan 12 h o más para el retiro: sin cargo.
 * - `late_cancellation`: faltan menos de 12 h y la ventana sigue abierta: hay penalidad.
 * - `pickup_window_closed`: la ventana de retiro ya cerró: sin cargo.
 */
export type CancellationPenaltyReason =
  | "not_assigned"
  | "before_free_deadline"
  | "late_cancellation"
  | "pickup_window_closed";

export interface CancellationPenaltyInput {
  status: ShipmentStatus;
  /** Precio acordado con el transportista. `null` si el envío no tiene asignación. */
  agreedPriceArs: number | null;
  /** Inicio de la ventana de retiro acordada (instante real). */
  pickupWindowStart: Date;
  /** Fin de la ventana de retiro acordada (instante real). */
  pickupWindowEnd: Date;
  now?: Date;
}

export interface CancellationPenaltyQuote {
  /** Monto de la penalidad en ARS con 2 decimales; `0` si no corresponde. */
  penaltyArs: number;
  reason: CancellationPenaltyReason;
  /** Hasta cuándo (inclusive) se puede cancelar sin cargo (instante real). `null` si el envío no está `assigned`. */
  freeUntil: Date | null;
}

/**
 * `GET /shipments/:id/cancellation-quote` (`svc-shipments`): lo que el emisor pagaría si
 * cancela ahora. El mobile lo muestra y lo devuelve como `expectedPenaltyArs` al cancelar.
 */
export interface CancellationQuoteResponse {
  penaltyArs: number;
  reason: CancellationPenaltyReason;
  /** ISO. `null` si el envío no está `assigned`. */
  freeUntil: string | null;
}

/** Penalidad que correspondería si el emisor cancela en `now`. Función pura. */
export function computeCancellationPenalty(input: CancellationPenaltyInput): CancellationPenaltyQuote {
  const now = input.now ?? new Date();
  if (input.status !== ShipmentStatus.ASSIGNED || input.agreedPriceArs === null) {
    return { penaltyArs: 0, reason: "not_assigned", freeUntil: null };
  }

  const freeUntil = new Date(input.pickupWindowStart.getTime() - CANCELLATION_PENALTY_FREE_HOURS * 60 * 60 * 1000);
  // "12 h o más" es sin cargo: justo a las 12 h todavía no se cobra.
  if (now <= freeUntil) return { penaltyArs: 0, reason: "before_free_deadline", freeUntil };
  if (now > input.pickupWindowEnd) return { penaltyArs: 0, reason: "pickup_window_closed", freeUntil };

  const penaltyArs = Math.round(input.agreedPriceArs * CANCELLATION_PENALTY_RATE * 100) / 100;
  return { penaltyArs, reason: "late_cancellation", freeUntil };
}
