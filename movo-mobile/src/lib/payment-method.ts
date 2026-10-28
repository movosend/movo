import type { ShipmentPaymentMethod } from "../api/shipments-client";

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

/**
 * Desglose de una oferta en efectivo: el transportista cobra el bruto en mano y la comisión de Movo (bruto − neto)
 * queda como deuda. Sin fee de Mercado Pago, porque no pasa plata por MP.
 */
export function cashOfferBreakdown(grossArs: number, netArs: number): { inHandArs: number; commissionArs: number } {
  return { inHandArs: grossArs, commissionArs: Math.max(0, grossArs - netArs) };
}
