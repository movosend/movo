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

/**
 * MOVO-225 (review de la PR #231): estimado de lo que MP descuenta por el pago. MP lo
 * cobra sobre el total de la transacción, o sea sobre el BRUTO que paga el emisor, no
 * sobre el neto del transportista. Es solo una referencia: el monto real lo informa MP
 * en `fee_details` de cada pago.
 */
export function estimateMpFeeArs(grossArs: number): number {
  return Math.round(grossArs * getClientMpTransactionFeeRate() * 100) / 100;
}

/**
 * Lo que el transportista recibiría aprox.: el neto (después de la comisión de Movo)
 * menos el estimado de MP. Nunca negativo.
 */
export function estimateReceivedArs(netArs: number, grossArs: number): number {
  return Math.max(
    0,
    Math.round((netArs - estimateMpFeeArs(grossArs)) * 100) / 100,
  );
}
