import type { PaymentSnapshot } from "../adapters/mercadopago-client";

const MP_FEE = "mercadopago_fee";

/** Centavos exactos y no negativos: lo que no cumple se descarta en vez de persistirse. */
const isMoney = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

/**
 * MOVO-285: comisión de Mercado Pago de un pago, tal como la informa MP. Antes de capturar sale de
 * `charges_details` (el hold); después, de `fee_details` (captura, webhook). Solo cuenta lo que descuenta
 * al vendedor (`fee_payer: collector` / cuenta `from: collector`); un cargo del pagador (financiación en
 * cuotas) no es del transportista. Si MP no trae el desglose, no devuelve nada: usarlo como parche no pisa
 * un valor que una lectura anterior ya había dejado.
 */
export function mpFeeFromPayment(payment: PaymentSnapshot): { mpFeeArs?: number } {
  const fromDetails = payment.fee_details?.filter(
    (fee) => fee.type === MP_FEE && (fee.fee_payer === undefined || fee.fee_payer === "collector")
  );
  if (fromDetails && fromDetails.length > 0) {
    if (!fromDetails.every((fee) => isMoney(fee.amount))) return {};
    return { mpFeeArs: round2(fromDetails.reduce((sum, fee) => sum + (fee.amount as number), 0)) };
  }
  const charges = payment.charges_details?.filter(
    (charge) => (charge.name === MP_FEE || charge.type === MP_FEE) && (charge.accounts?.from ?? "collector") === "collector"
  );
  if (!charges || charges.length === 0) return {};
  if (!charges.every((charge) => isMoney(charge.amounts?.original))) return {};
  const refunded = charges.reduce((sum, charge) => sum + (charge.amounts?.refunded ?? 0), 0);
  return { mpFeeArs: round2(charges.reduce((sum, charge) => sum + (charge.amounts?.original as number), 0) - refunded) };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
