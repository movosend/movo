import { Prisma } from "../generated/prisma/client";
import type { PaymentSnapshot } from "../adapters/mercadopago-client";

const { Decimal } = Prisma;
type Decimal = Prisma.Decimal;

const MP_FEE = "mercadopago_fee";

export const toMoney = (value: number): Decimal => new Decimal(value).toDecimalPlaces(2);

/** Centavos exactos y no negativos: lo que no cumple se descarta en vez de persistirse. */
const isMoney = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

/**
 * La única regla para leer `fee_details` (MOVO-285: la usan la liquidación y el hold, así la misma columna no
 * queda con dos definiciones). Solo cuenta lo que descuenta al TRANSPORTISTA: una entrada sin `fee_payer`
 * (respuestas viejas) es del vendedor; una que declara otro pagador (la financiación en cuotas del comprador) queda
 * afuera. La comisión de Movo es el `application_fee`; la de MP es todo el resto. `null` si falta algún monto.
 * Aritmética en `Decimal`: es plata, nada de floats.
 */
export function splitCollectorFees(
  fees: NonNullable<PaymentSnapshot["fee_details"]>
): { mpFee: Decimal; commission: Decimal | null } | null {
  let mpFee = new Decimal(0);
  let commission: Decimal | null = null;
  for (const fee of fees) {
    if (fee.amount === undefined) return null;
    if (fee.fee_payer !== undefined && fee.fee_payer !== "collector") continue;
    if (fee.type === "application_fee") {
      commission = (commission ?? new Decimal(0)).plus(toMoney(fee.amount));
    } else {
      mpFee = mpFee.plus(toMoney(fee.amount));
    }
  }
  return { mpFee, commission };
}

/**
 * MOVO-285: comisión de Mercado Pago de un pago, tal como la informa MP. Antes de capturar sale de
 * `charges_details` (el hold, `amounts.original`: es la comisión del pago, no lo que se devuelva después);
 * después, de `fee_details` (captura, webhook) con la regla de `splitCollectorFees`. Si MP no trae el desglose,
 * no devuelve nada: usarlo como parche no pisa un valor que una lectura anterior ya había dejado.
 */
export function mpFeeFromPayment(payment: PaymentSnapshot): { mpFeeArs?: number } {
  if (payment.fee_details && payment.fee_details.length > 0) {
    const split = splitCollectorFees(payment.fee_details);
    return split ? { mpFeeArs: split.mpFee.toNumber() } : {};
  }
  const charges = payment.charges_details?.filter(
    (charge) => (charge.name === MP_FEE || charge.type === MP_FEE) && (charge.accounts?.from ?? "collector") === "collector"
  );
  if (!charges || charges.length === 0) return {};
  if (!charges.every((charge) => isMoney(charge.amounts?.original))) return {};
  return { mpFeeArs: charges.reduce((sum, charge) => sum.plus(toMoney(charge.amounts?.original as number)), new Decimal(0)).toNumber() };
}

/**
 * MOVO-285: completa la comisión de MP de un hold que todavía no la tenía (uno anterior a MOVO-285, o cuya
 * respuesta de creación no trajo `charges_details`). Mismo criterio que `missingCardFields`: solo agrega lo que
 * falta, sin tocar el estado.
 */
export function missingFeeField(current: { mpFeeArs?: unknown }, payment: PaymentSnapshot): { mpFeeArs?: number } {
  return current.mpFeeArs == null ? mpFeeFromPayment(payment) : {};
}
