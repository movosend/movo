import { OfferStatus } from "@movo/shared";

/** Estado inicial de toda oferta nueva (AC1). */
export const INITIAL_OFFER_STATUS = OfferStatus.PENDING;

/**
 * Transición rechazada por la máquina de estados — mismo criterio que
 * `InvalidShipmentTransitionError` (`shipment-state-machine.ts`, MOVO-105):
 * ni `from` ni `to` son necesariamente inválidos por sí solos, la
 * combinación no está permitida.
 */
export class InvalidOfferTransitionError extends Error {
  constructor(
    public readonly from: OfferStatus,
    public readonly to: OfferStatus,
  ) {
    super(`Transición de oferta inválida: '${from}' -> '${to}'`);
    this.name = "InvalidOfferTransitionError";
  }
}

/**
 * Grafo de transiciones válidas de la oferta (AC6, mismo patrón que
 * `shipment-state-machine.ts`) — DTE de MOVO-102
 * (`docs/shipments/offer-state-diagram.md`). Una sola ronda de negociación
 * (sin contraoferta): el transportista oferta, el emisor acepta o rechaza.
 *
 * `expired` es deliberadamente INALCANZABLE desde `transition()`: es un
 * estado derivado, calculado en cada lectura (AC11) —
 * ver `models/offer.ts#deriveEffectiveOfferStatus`. Ningún método de
 * `offer-repository.ts` ejecuta jamás `transition(pending, expired)`; la
 * clave existe acá solo por completitud (mismo estilo que
 * `shipment-state-machine.ts`, que lista incluso sus estados terminales).
 *
 * `rejected`/`withdrawn`/`expired`/`superseded` no tienen salida: son
 * terminales. Un rechazo previo no bloquea una oferta nueva (AC7) — pero
 * eso es una fila nueva, no una transición de ésta.
 */
const VALID_TRANSITIONS: Readonly<Record<OfferStatus, ReadonlySet<OfferStatus>>> = {
  [OfferStatus.PENDING]: new Set([
    OfferStatus.ACCEPTED, // el emisor la elige (AC8)
    OfferStatus.REJECTED, // el emisor la rechaza explícitamente
    OfferStatus.WITHDRAWN, // el transportista la retira antes de respuesta
    OfferStatus.SUPERSEDED, // el emisor aceptó otra oferta del mismo envío (batch, AC8)
  ]),
  [OfferStatus.ACCEPTED]: new Set(),
  [OfferStatus.REJECTED]: new Set(),
  [OfferStatus.WITHDRAWN]: new Set(),
  [OfferStatus.EXPIRED]: new Set(),
  [OfferStatus.SUPERSEDED]: new Set(),
};

/** Solo lectura — no muta el estado, es para consultas (ej. habilitar/deshabilitar una acción en UI). */
export function canTransition(from: OfferStatus, to: OfferStatus): boolean {
  return VALID_TRANSITIONS[from].has(to);
}

/**
 * Única vía de transición válida del ciclo de vida de la oferta (AC6): todo
 * repositorio que escriba `status` pasa por acá antes del `UPDATE`, nunca lo
 * hace directo. Devuelve `to` si la transición es válida; lanza
 * `InvalidOfferTransitionError` si no.
 */
export function transition(from: OfferStatus, to: OfferStatus): OfferStatus {
  if (!canTransition(from, to)) {
    throw new InvalidOfferTransitionError(from, to);
  }
  return to;
}
