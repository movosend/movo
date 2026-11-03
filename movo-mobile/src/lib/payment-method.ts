import type { ShipmentPaymentMethod } from "../api/shipments-client";
import { estimateReceivedArs } from "./commission-config";

/**
 * MOVO-37: un envío pagado en efectivo. El emisor le paga el monto acordado completo al transportista, en mano, al
 * retiro: no hay hold, ni `assigned_unfunded`, ni liquidación (`/settlement` responde 404). La comisión de Movo le
 * queda al transportista como deuda en su cuenta corriente al entregar. Sin el campo (backend anterior) es tarjeta.
 */
export function isCashShipment(shipment: { paymentMethod?: ShipmentPaymentMethod } | null | undefined): boolean {
  return shipment?.paymentMethod === "cash";
}

export const PAYMENT_METHOD_LABEL: Record<ShipmentPaymentMethod, string> = {
  card: "Tarjeta",
  cash: "Efectivo",
};

export interface CarrierPriceBreakdown {
  /** Lo que cobra antes de descontar deuda: el bruto en mano (efectivo) o el neto menos el estimado de MP. */
  beforeDebtArs: number;
  /** Lo que cobra al final: `beforeDebtArs` menos el descuento por deuda (en efectivo no hay cobro del que descontar). */
  receivedArs: number;
  /** Comisión de Movo (bruto − neto), salvo que ya venga calculada. En efectivo queda como deuda al entregar. */
  commissionArs: number;
}

/**
 * Único lugar donde se decide "cuánto recibe el transportista" según la modalidad. Efectivo: cobra el bruto en mano,
 * sin fee de Mercado Pago (no pasa plata por MP) ni descuento por deuda. Tarjeta: el neto menos el estimado de MP
 * (`estimateReceivedArs`) y menos el descuento por deuda que informe el backend. Un cambio de regla se hace acá.
 */
export function carrierPriceBreakdown(input: {
  grossArs: number;
  netArs: number;
  cash: boolean;
  debtDiscountArs?: number;
  /** `offer.commissionAmountArs`, cuando ya existe: evita recalcular `gross − net`. */
  commissionArs?: number;
}): CarrierPriceBreakdown {
  const { grossArs, netArs, cash, debtDiscountArs = 0, commissionArs } = input;
  const beforeDebtArs = cash ? grossArs : estimateReceivedArs(netArs, grossArs);
  return {
    beforeDebtArs,
    receivedArs: cash ? grossArs : Math.max(0, beforeDebtArs - debtDiscountArs),
    commissionArs: commissionArs ?? Math.max(0, grossArs - netArs),
  };
}
