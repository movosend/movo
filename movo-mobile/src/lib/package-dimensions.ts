import { PACKAGE_DIMENSION_CM_MAX, PACKAGE_DIMENSION_CM_OPTIONS } from "@movo/shared/dist/config/package-dimensions";

/**
 * MOVO-317: valor que guarda el wizard en `lengthCm`/`widthCm`/`heightCm` cuando el emisor
 * elige "Más de 300 cm". No es una medida: se manda el tope (300) y `oversized: true`.
 */
export const OVERSIZED_DIMENSION = "oversized";

export const OVERSIZED_DIMENSION_LABEL = `Más de ${PACKAGE_DIMENSION_CM_MAX} cm`;

/** Opciones del desplegable, en el orden que se muestran: "10 cm" ... "300 cm", "Más de 300 cm". */
export const DIMENSION_OPTION_LABELS: readonly string[] = [
  ...PACKAGE_DIMENSION_CM_OPTIONS.map((cm) => `${cm} cm`),
  OVERSIZED_DIMENSION_LABEL,
];

/** Valor del wizard (`"40"`, `"oversized"` o `""`) → etiqueta del desplegable (`""` si no hay elegida). */
export function dimensionLabel(value: string): string {
  if (value === OVERSIZED_DIMENSION) return OVERSIZED_DIMENSION_LABEL;
  return value === "" ? "" : `${value} cm`;
}

/** Texto del campo cerrado: igual a la etiqueta salvo "Más de 300 cm", que no entra en un tercio del ancho. */
export function dimensionFieldText(value: string): string {
  return value === OVERSIZED_DIMENSION ? `+${PACKAGE_DIMENSION_CM_MAX} cm` : dimensionLabel(value);
}

/** Etiqueta del desplegable → valor del wizard. */
export function dimensionValueFromLabel(label: string): string {
  if (label === OVERSIZED_DIMENSION_LABEL) return OVERSIZED_DIMENSION;
  return label.replace(/\s*cm$/, "");
}

/** Medida abreviada para una fila de resumen: `"40"`, `"+300"` o `"—"` si falta. */
export function dimensionShort(value: string): string {
  if (value === OVERSIZED_DIMENSION) return `+${PACKAGE_DIMENSION_CM_MAX}`;
  return value === "" ? "—" : value;
}

/** Medida en cm que viaja al backend: el tope si es "Más de 300 cm", `null` si no hay una válida. */
export function dimensionToCm(value: string): number | null {
  if (value === OVERSIZED_DIMENSION) return PACKAGE_DIMENSION_CM_MAX;
  const cm = Number(value);
  return Number.isFinite(cm) && cm > 0 ? cm : null;
}

/** ¿Alguno de los tres lados es "Más de 300 cm"? */
export function hasOversizedDimension(...values: string[]): boolean {
  return values.some((value) => value === OVERSIZED_DIMENSION);
}

/**
 * Medidas para mostrar de un envío ya creado: `40 × 30 × 20 cm`, y con `oversized` el aviso de
 * que alguna es mayor al tope (el backend guarda el tope, no cuál lado se pasó).
 */
export function formatPackageDimensions(
  shipment: { lengthCm: number; widthCm: number; heightCm: number; oversized?: boolean },
): string {
  const base = `${shipment.lengthCm} × ${shipment.widthCm} × ${shipment.heightCm} cm`;
  return shipment.oversized ? `${base} · ${OVERSIZED_DIMENSION_LABEL}` : base;
}
