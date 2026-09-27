/**
 * MOVO-173: sub-categorías de una calificación post-entrega. El set depende del rol del
 * CALIFICADO en ese envío (no del rol de cuenta): a un transportista se lo califica en
 * puntualidad/cuidado del paquete/comunicación; al emisor y al receptor (las dos puntas
 * que califica el transportista) en el mismo set, puntualidad/comunicación.
 *
 * Fuente única de `key`/`label`/campo del wire contract: `svc-shipments` la usa para
 * validar y agregar, `movo-mobile` para dibujar los inputs de `RatingSheet`.
 */

/** Nombre de la columna/campo de cada categoría en `Rating` y en el body de alta/edición. */
export type RatingCategoryScoreField =
  | "punctualityScore"
  | "careScore"
  | "communicationScore";

export interface RatingCategoryDefinition {
  /** Identificador estable que viaja en `ReputationBreakdown.categories[].key`. */
  key: string;
  label: string;
  scoreField: RatingCategoryScoreField;
}

export const CARRIER_RATING_CATEGORIES: readonly RatingCategoryDefinition[] = [
  { key: "punctuality", label: "Puntualidad", scoreField: "punctualityScore" },
  { key: "care", label: "Cuidado del paquete", scoreField: "careScore" },
  { key: "communication", label: "Comunicación", scoreField: "communicationScore" },
];

/** Lo que el transportista califica del emisor (retiro) y del receptor (entrega). */
export const SENDER_RATING_CATEGORIES: readonly RatingCategoryDefinition[] = [
  { key: "punctuality", label: "Puntualidad", scoreField: "punctualityScore" },
  { key: "communication", label: "Comunicación", scoreField: "communicationScore" },
];

/** Mismo set que el emisor a propósito (decisión de producto): las dos contrapartes del transportista. */
export const RECEIVER_RATING_CATEGORIES: readonly RatingCategoryDefinition[] = SENDER_RATING_CATEGORIES;
