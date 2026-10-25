/**
 * MOVO-317: opciones de peso y medidas del wizard de publicar envío. El tamaño ya no tiene
 * topes duros (sale el 422 `PACKAGE_LIMITS_EXCEEDED` de DD-041): lo decide cada transportista
 * viendo las medidas. Estas constantes solo definen qué puede elegir el emisor.
 *
 * "Más de 300 cm" no es una medida: el mobile manda el tope (`PACKAGE_DIMENSION_CM_MAX`) en
 * ese lado y `oversized: true` en el envío.
 */

/** Peso mínimo y paso del control de peso (kg). */
export const PACKAGE_WEIGHT_KG_MIN = 0.5;
export const PACKAGE_WEIGHT_KG_STEP = 0.5;

/** Medidas del desplegable: de 10 a 300 cm, de a 10, más la opción "Más de 300 cm". */
export const PACKAGE_DIMENSION_CM_MIN = 10;
export const PACKAGE_DIMENSION_CM_STEP = 10;
export const PACKAGE_DIMENSION_CM_MAX = 300;

/**
 * Tope de cordura (kg y cm) que aceptan `svc-shipments` y `svc-pricing-logistics` en el peso y en cada
 * medida. No es un límite de negocio (el tamaño real lo decide cada transportista): solo evita que un
 * cliente directo mande 1e9 y desborde el precio. Pricing lo replica en `app/models/quote.py`
 * (`PACKAGE_INPUT_SANITY_MAX`): si cambia acá, cambiarlo allá.
 */
export const PACKAGE_INPUT_SANITY_MAX = 10_000;

/** Opciones numéricas de una medida, en cm: 10, 20, ..., 300. */
export const PACKAGE_DIMENSION_CM_OPTIONS: readonly number[] = Array.from(
  { length: (PACKAGE_DIMENSION_CM_MAX - PACKAGE_DIMENSION_CM_MIN) / PACKAGE_DIMENSION_CM_STEP + 1 },
  (_, i) => PACKAGE_DIMENSION_CM_MIN + i * PACKAGE_DIMENSION_CM_STEP
);

/** Redondea al múltiplo de `PACKAGE_WEIGHT_KG_STEP` más cercano (mitades hacia arriba), mínimo `PACKAGE_WEIGHT_KG_MIN`. */
export function roundPackageWeightKg(weightKg: number): number {
  const steps = Math.floor(weightKg / PACKAGE_WEIGHT_KG_STEP + 0.5);
  return Math.max(PACKAGE_WEIGHT_KG_MIN, steps * PACKAGE_WEIGHT_KG_STEP);
}
