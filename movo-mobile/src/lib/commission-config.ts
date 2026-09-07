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
const DEFAULT_MOVO_COMMISSION_RATE = 0.15;
const DEFAULT_MP_TRANSACTION_FEE_RATE = 0.0499;

export function getClientCommissionRate(): number {
  return process.env.EXPO_PUBLIC_MOVO_COMMISSION_RATE
    ? Number(process.env.EXPO_PUBLIC_MOVO_COMMISSION_RATE)
    : DEFAULT_MOVO_COMMISSION_RATE;
}

export function getClientMpTransactionFeeRate(): number {
  return process.env.EXPO_PUBLIC_MP_TRANSACTION_FEE_RATE
    ? Number(process.env.EXPO_PUBLIC_MP_TRANSACTION_FEE_RATE)
    : DEFAULT_MP_TRANSACTION_FEE_RATE;
}
