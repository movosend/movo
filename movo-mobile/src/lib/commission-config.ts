import {
  DEFAULT_MOVO_COMMISSION_RATE,
  DEFAULT_MP_TRANSACTION_FEE_RATE,
  estimateMpFeeArs as sharedEstimateMpFeeArs,
  computeNetFromGross,
  estimateReceivedArs as sharedEstimateReceivedArs,
  parseRate,
} from "@movo/shared/dist/config/commission";

/**
 * Fix de review (PR #136, JcBordino4): `getCommissionConfig()` de `@movo/shared` lee
 * `process.env.MOVO_COMMISSION_RATE`/`MP_TRANSACTION_FEE_RATE` sin prefijo -- esas vars
 * nunca llegan al bundle de Expo (solo `EXPO_PUBLIC_*` se embebe en build time), así
 * que en mobile siempre resolvían a los defaults hardcodeados de `@movo/shared` sin
 * que ninguna configuración de ambiente pudiera cambiarlos. Este wrapper lee las
 * variantes `EXPO_PUBLIC_` (mismo default que `@movo/shared`, para no cambiar el
 * comportamiento actual hasta que se cargue una real) y sigue delegando el cálculo en
 * sí a `computeOfferGrossPrice`/`@movo/shared` pasando la tasa explícita.
 */
export function getClientCommissionRate(): number {
  return parseRate(
    process.env.EXPO_PUBLIC_MOVO_COMMISSION_RATE,
    DEFAULT_MOVO_COMMISSION_RATE,
  );
}

export function getClientMpTransactionFeeRate(): number {
  return parseRate(
    process.env.EXPO_PUBLIC_MP_TRANSACTION_FEE_RATE,
    DEFAULT_MP_TRANSACTION_FEE_RATE,
  );
}

/**
 * MOVO-225: estimado de MP sobre el bruto, con la tasa `EXPO_PUBLIC_`. La fórmula vive
 * en `@movo/shared` (`estimateMpFeeArs`).
 */
export function estimateMpFeeArs(grossArs: number): number {
  return sharedEstimateMpFeeArs(grossArs, getClientMpTransactionFeeRate());
}

/**
 * MOVO-225: lo que el transportista recibe aprox. (neto menos el estimado de MP). Es el
 * único monto que la app muestra como "lo que recibís", en todas las pantallas.
 */
export function estimateReceivedArs(netArs: number, grossArs: number): number {
  return sharedEstimateReceivedArs(
    netArs,
    grossArs,
    getClientMpTransactionFeeRate(),
  );
}

/**
 * MOVO-285: lo que el transportista recibe sobre un bruto, antes de su descuento por deuda. Con el
 * `mercadopago_fee` real que MP informó al crear el hold es el monto exacto (neto menos ese fee); sin
 * él cae al estimado de `estimateReceivedArs`. Quien lo muestra rotula "aprox." solo en el segundo caso.
 */
export function carrierReceivedBeforeDebtArs(
  grossArs: number,
  realMpFeeArs?: number | null,
): number {
  const netArs = computeNetFromGross(grossArs, getClientCommissionRate());
  if (realMpFeeArs == null) return estimateReceivedArs(netArs, grossArs);
  return Math.max(0, Math.round((netArs - realMpFeeArs) * 100) / 100);
}
