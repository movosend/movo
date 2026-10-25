export interface CommissionConfig {
  /**
   * AC6 de MOVO-143: comisión de Movo sobre el neto que ingresa el transportista al
   * ofertar. Confirmado con el equipo: 15% (`MOVO_COMMISSION_RATE`, default 0.15).
   */
  movoCommissionRate: number;
  /**
   * ESTIMADO de la comisión que cobra MercadoPago por la transacción, solo para
   * mostrarle al transportista una referencia antes de ofertar. No es un valor a
   * confirmar con MP (MOVO-225): MP la descuenta de la cuenta del transportista (en
   * `fee_details` la informa como `fee_payer: collector`; Movo no envía ese campo), se
   * aplica sobre el BRUTO del pago, y su porcentaje depende de las tarifas vigentes, del
   * medio de pago del emisor y del plazo de liberación del dinero que cada
   * transportista configura en su cuenta. El monto real de cada pago sale de
   * `fee_details` (`mercadopago_fee`) de MP, nunca de esta tasa.
   */
  mpTransactionFeeRate: number;
}

let cached: CommissionConfig | undefined;

export const DEFAULT_MOVO_COMMISSION_RATE = 0.15;
// Estimado conservador, a validar con pagos reales: por encima del 4,1% observado en
// sandbox (MOVO-49), única observación que tenemos. Ver `mpTransactionFeeRate` arriba.
export const DEFAULT_MP_TRANSACTION_FEE_RATE = 0.0499;

/**
 * Parsea una tasa leída de una env var. Ausente, vacía o no numérica (`"4,99%"`) cae al
 * default: un typo de configuración no puede terminar mostrando `$NaN` como monto
 * principal (review de Pedro, PR #231). Tampoco se aceptan tasas negativas.
 */
export function parseRate(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const rate = Number(raw);
  return Number.isFinite(rate) && rate >= 0 ? rate : fallback;
}

/**
 * Lee la config de comisiones desde variables de entorno.
 *
 * Lectura perezosa y memoizada, mismo criterio que `getJwtConfig()`
 * (`auth/config.ts`): un servicio que no calcula ninguna comisión no necesita tener
 * estas vars seteadas para poder importar el resto de `@movo/shared`.
 */
export function getCommissionConfig(): CommissionConfig {
  if (cached) return cached;

  const movoCommissionRate = parseRate(
    process.env.MOVO_COMMISSION_RATE,
    DEFAULT_MOVO_COMMISSION_RATE,
  );
  const mpTransactionFeeRate = parseRate(
    process.env.MP_TRANSACTION_FEE_RATE,
    DEFAULT_MP_TRANSACTION_FEE_RATE,
  );

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

/**
 * Inversa de `computeOfferGrossPrice`: dado el BRUTO ya persistido (`Offer.priceOffered`),
 * el neto que le queda al transportista. MOVO-188 (fix de review, PR #142): antes vivía
 * duplicada como `toNetArs` en `offers.service.ts` y, ya desde MOVO-180, inline en
 * `shipments.service.ts#computeOffersSummaryForCarrier` -- centralizada acá (mismo
 * criterio que `computeOfferGrossPrice`) para que un cambio futuro de redondeo/fórmula
 * no dependa de actualizar las dos copias a mano. Redondeado a 2 decimales, mismo
 * criterio que el resto de los montos en ARS.
 */
export function computeNetFromGross(
  grossArs: number,
  rate: number = getCommissionConfig().movoCommissionRate,
): number {
  return Math.round((grossArs / (1 + rate)) * 100) / 100;
}

/**
 * MOVO-186: desglose completo (neto/comisión/bruto) a partir del BRUTO ya persistido
 * (`Offer.priceOffered`), para las respuestas de oferta que hoy solo exponen ese bruto
 * (`offerResponse`/`myOfferResponse` en `movo-svc-shipments`). Reusa
 * `computeNetFromGross` para el neto -- `commissionAmountArs` sale de la resta contra
 * el bruto (ya redondeado) en vez de recalcularlo con su propia fórmula, para que los
 * tres valores sean siempre consistentes entre sí (`netArs + commissionAmountArs ===
 * grossArs`) incluso en los bordes de redondeo.
 */
export function decomposeOfferGrossPrice(
  grossArs: number,
  rate: number = getCommissionConfig().movoCommissionRate,
): OfferGrossPriceBreakdown {
  const netArs = computeNetFromGross(grossArs, rate);
  const commissionAmountArs = Math.round((grossArs - netArs) * 100) / 100;
  return { netArs, commissionAmountArs, grossArs };
}

/**
 * MOVO-225: estimado de lo que MP descuenta por el pago. MP lo cobra sobre el total de
 * la transacción, o sea sobre el BRUTO que paga el emisor, no sobre el neto del
 * transportista. Es solo una referencia: el monto real lo informa MP en `fee_details`
 * (`mercadopago_fee`) de cada pago.
 */
export function estimateMpFeeArs(
  grossArs: number,
  rate: number = getCommissionConfig().mpTransactionFeeRate,
): number {
  return Math.round(grossArs * rate * 100) / 100;
}

/**
 * MOVO-225: lo que el transportista recibiría aprox. -- el neto (después de la comisión
 * de Movo) menos el estimado de MP. Es el único monto que la app muestra como "lo que
 * recibís". Nunca negativo.
 */
export function estimateReceivedArs(
  netArs: number,
  grossArs: number,
  mpRate: number = getCommissionConfig().mpTransactionFeeRate,
): number {
  return Math.max(
    0,
    Math.round((netArs - estimateMpFeeArs(grossArs, mpRate)) * 100) / 100,
  );
}

/**
 * MOVO-311: el cobro tal como lo ve el transportista cuando el emisor pagó un recargo por su deuda. El
 * recargo no es del transportista: entra al bruto y sale por el `application_fee` (`debtSurchargeFeeArs`) y por
 * la comisión de MP sobre él (el resto). Mostrarlo revelaría la deuda del emisor y el desglose no cerraría,
 * así que se saca de los dos lados: bruto = bruto − recargo y fee de MP = fee de MP − (recargo −
 * `debtSurchargeFeeArs`). Con eso `bruto − fee MP − comisión − deuda propia = neto real`. Si la comisión real de
 * MP sobre el recargo difiere del estimado, la diferencia queda en la línea del fee de MP.
 */
export function carrierPaymentView(input: {
  grossAmountArs: number;
  mpFeeArs: number | null;
  debtSurchargeArs: number;
  debtSurchargeFeeArs: number;
}): { grossAmountArs: number; mpFeeArs: number | null } {
  const absorbedMpFee = input.debtSurchargeArs - input.debtSurchargeFeeArs;
  return {
    grossAmountArs: Math.round((input.grossAmountArs - input.debtSurchargeArs) * 100) / 100,
    // Nunca negativo (MOVO-285): con un fee real chico y un recargo grande la resta puede pasarse de 0.
    mpFeeArs: input.mpFeeArs === null ? null : Math.max(0, Math.round((input.mpFeeArs - absorbedMpFee) * 100) / 100),
  };
}

/** Solo para tests: resetea la config memoizada entre casos. */
export function __resetCommissionConfigForTests(): void {
  cached = undefined;
}
