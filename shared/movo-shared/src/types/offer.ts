/**
 * Estado del ciclo de vida de una oferta de un transportista sobre un envío.
 *
 * Set canónico de MOVO-102 (criterio 5): estos 6 valores y ningún otro.
 * Alineado 1:1 con el enum `status` de `shipments.offers`
 * (`shipments.offer_status_enum`, movo-svc-shipments) y con las transiciones
 * que define `offer-state-machine.ts` (MOVO-102) — agregar un valor nuevo
 * obliga a actualizar ambos lados en el mismo PR.
 *
 * `EXPIRED` es un estado DERIVADO (AC11, expiración perezosa, sin
 * scheduler): ningún código escribe jamás un `UPDATE` a `expired` — se
 * calcula en cada lectura cuando `expiresAt` ya pasó y el valor persistido
 * sigue siendo `pending`. Ver `deriveEffectiveOfferStatus` en
 * `movo-svc-shipments/src/models/offer.ts`.
 */
export enum OfferStatus {
  PENDING = "pending",
  ACCEPTED = "accepted",
  REJECTED = "rejected",
  WITHDRAWN = "withdrawn",
  EXPIRED = "expired",
  SUPERSEDED = "superseded",
}
