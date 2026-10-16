import { decomposeOfferGrossPrice, getCommissionConfig } from "@movo/shared";

/**
 * MOVO-311: cuánto de la deuda de la cuenta corriente se cobra en un hold y cómo queda el pago.
 *
 * - Transportista (cobrador) con deuda: el `application_fee` sube en `debtOffsetArs`. El emisor paga lo
 *   mismo y el transportista recibe menos.
 * - Emisor (pagador) con deuda: el monto sube en `debtSurchargeArs`, y el `application_fee` en ese recargo
 *   MENOS el estimado de la comisión de MP sobre él (MP la cobra sobre todo el monto y se la descuenta al
 *   transportista): Movo la absorbe, así el transportista recibe lo mismo que sin recargo. Al emisor se le
 *   acredita el recargo completo.
 *
 * Cada uno con un tope de `capRate` del precio; lo que no entra queda para la próxima operación. Montos en
 * centavos enteros para no arrastrar error de punto flotante.
 */
export interface DebtCollectionInput {
  /** Precio acordado del envío (bruto que ve el emisor). */
  priceArs: number;
  /** Saldo de la cuenta corriente del transportista (positivo = debe). */
  carrierBalanceArs: number;
  /** Saldo del emisor. */
  payerBalanceArs: number;
  /** `DEBT_COLLECTION_MAX_RATE`. */
  capRate: number;
  /** Estimado de la comisión de MP (`MP_TRANSACTION_FEE_RATE`). */
  mpFeeRate?: number;
  /** Comisión de Movo; por defecto la de `@movo/shared` sobre el precio. */
  commissionArs?: number;
}

export interface DebtCollection {
  /** Precio acordado. */
  baseAmountArs: number;
  /** Comisión de Movo sobre el precio. */
  commissionArs: number;
  /** Deuda del transportista que se descuenta de lo que cobra. */
  debtOffsetArs: number;
  /** Deuda del emisor que se le suma al pago. */
  debtSurchargeArs: number;
  /** `transaction_amount`: precio + recargo. */
  amountArs: number;
  /** `application_fee`: comisión + descuento + recargo menos la comisión de MP que absorbe Movo. */
  applicationFeeArs: number;
}

const toCents = (ars: number): number => Math.round(ars * 100);
const toArs = (cents: number): number => cents / 100;

export function computeDebtCollection(input: DebtCollectionInput): DebtCollection {
  const price = toCents(input.priceArs);
  const commission = toCents(input.commissionArs ?? decomposeOfferGrossPrice(input.priceArs).commissionAmountArs);
  const mpFeeRate = input.mpFeeRate ?? getCommissionConfig().mpTransactionFeeRate;
  const cap = Math.max(0, Math.floor(price * input.capRate));

  // Con el tope acotado a 0.5 nunca hace falta, pero MP rechaza un `application_fee` >= monto (4038): el
  // descuento al transportista se recorta para que comisión + descuento quede por debajo del precio.
  const offset = Math.min(Math.max(0, toCents(input.carrierBalanceArs)), cap, Math.max(0, price - commission - 1));
  const surcharge = Math.min(Math.max(0, toCents(input.payerBalanceArs)), cap);
  const surchargeFee = surcharge - Math.round(surcharge * mpFeeRate);

  return {
    baseAmountArs: toArs(price),
    commissionArs: toArs(commission),
    debtOffsetArs: toArs(offset),
    debtSurchargeArs: toArs(surcharge),
    amountArs: toArs(price + surcharge),
    applicationFeeArs: toArs(commission + offset + surchargeFee),
  };
}
