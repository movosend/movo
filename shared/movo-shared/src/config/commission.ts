export interface CommissionConfig {
  /**
   * AC6 de MOVO-143: comisión de Movo sobre el neto que ingresa el transportista al
   * ofertar. Confirmado con el equipo: 15% (`MOVO_COMMISSION_RATE`, default 0.15).
   */
  movoCommissionRate: number;
  /**
   * Comisión que cobra MercadoPago por operar la transacción (Auth & Capture /
   * Marketplace Split Payments). No se descuenta en la creación de la oferta —
   * `movo-svc-payments` todavía no implementa el split real (ver su CLAUDE.md) — se
   * centraliza acá para que ese servicio y las estadísticas de `movo-svc-admin` no
   * dupliquen el valor cuando lo necesiten. Valor real pendiente de confirmar con el
   * contrato/homologación de MP.
   */
  mpTransactionFeeRate: number;
}

let cached: CommissionConfig | undefined;

const DEFAULT_MOVO_COMMISSION_RATE = 0.15;
// TODO: placeholder hasta confirmar la tasa real contratada con MercadoPago.
const DEFAULT_MP_TRANSACTION_FEE_RATE = 0.0499;

/**
 * Lee la config de comisiones desde variables de entorno.
 *
 * Lectura perezosa y memoizada, mismo criterio que `getJwtConfig()`
 * (`auth/config.ts`): un servicio que no calcula ninguna comisión no necesita tener
 * estas vars seteadas para poder importar el resto de `@movo/shared`.
 */
export function getCommissionConfig(): CommissionConfig {
  if (cached) return cached;

  const movoCommissionRate = process.env.MOVO_COMMISSION_RATE
    ? Number(process.env.MOVO_COMMISSION_RATE)
    : DEFAULT_MOVO_COMMISSION_RATE;
  const mpTransactionFeeRate = process.env.MP_TRANSACTION_FEE_RATE
    ? Number(process.env.MP_TRANSACTION_FEE_RATE)
    : DEFAULT_MP_TRANSACTION_FEE_RATE;

  cached = { movoCommissionRate, mpTransactionFeeRate };
  return cached;
}

export interface OfferGrossPriceBreakdown {
  netArs: number;
  commissionAmountArs: number;
  grossArs: number;
}

/**
 * AC6 de MOVO-143: el transportista ingresa el NETO, el servidor calcula el BRUTO
 * (lo que persiste `Offer.priceOffered` y lo que ve el emisor). Redondeado a 2
 * decimales (moneda) para no arrastrar error de punto flotante al DTO/DB.
 */
export function computeOfferGrossPrice(
  netArs: number,
  rate: number = getCommissionConfig().movoCommissionRate,
): OfferGrossPriceBreakdown {
  const commissionAmountArs = Math.round(netArs * rate * 100) / 100;
  const grossArs = Math.round((netArs + commissionAmountArs) * 100) / 100;
  return { netArs, commissionAmountArs, grossArs };
}

/** Solo para tests: resetea la config memoizada entre casos. */
export function __resetCommissionConfigForTests(): void {
  cached = undefined;
}
