import type { ShipmentFundingResponse } from "@movo/shared/dist/types/funding";
import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { PayShipmentOutcome } from "../lib/pay-shipment-flow";

/**
 * Datos de prueba de la pantalla de pago (MOVO-269) para verla en la sección de desarrolladores
 * sin un envío `assignment_pending`, un transportista con Mercado Pago ni tarjetas guardadas.
 * Solo se usan con `?demo=` y en `__DEV__`: nada de esto toca el backend.
 */
export const PAY_DEMO_SHIPMENT_ID = "00000000-0000-4000-8000-000000004269";

export type PayDemoScenario = "form" | "empty" | "resumed" | "expired";

export const PAY_DEMO_SCENARIOS: { id: PayDemoScenario; label: string; hint: string }[] = [
  { id: "form", label: "Elegir tarjeta + CVV", hint: "Tres tarjetas (Visa, Mastercard, Amex) y una vencida" },
  { id: "resumed", label: "Pago retomado", hint: "Con el aviso de que hay que volver a escribir el código" },
  { id: "empty", label: "Sin tarjetas guardadas", hint: "Estado vacío y hoja de alta" },
  { id: "expired", label: "Plazo vencido", hint: "El envío volvió a publicarse" },
];

const card = (over: Partial<SavedCard>): SavedCard => ({
  id: "demo-visa",
  mpCardId: "demo-mp-visa",
  alias: "Personal",
  brand: "visa",
  last4: "3704",
  expMonth: 11,
  expYear: 2099,
  issuerName: "Banco Galicia",
  paymentType: "credit_card",
  isDefault: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

export const PAY_DEMO_CARDS: SavedCard[] = [
  card({}),
  card({ id: "demo-master", mpCardId: "demo-mp-master", alias: "Cuenta sueldo", brand: "master", last4: "8812", issuerName: "Banco Santander", paymentType: "debit_card", isDefault: false }),
  card({ id: "demo-amex", mpCardId: "demo-mp-amex", alias: null, brand: "amex", last4: "1005", issuerName: null, isDefault: false }),
  card({ id: "demo-expired", mpCardId: "demo-mp-expired", alias: null, last4: "0001", expYear: 2020, isDefault: false }),
];

export function payDemoFunding(): ShipmentFundingResponse {
  return {
    shipmentId: PAY_DEMO_SHIPMENT_ID,
    route: "near",
    carrierPublicKey: "TEST-demo",
    amountArs: 18400,
    priceArs: 18400,
    pendingBalanceArs: 0,
    totalArs: 18400,
    payUntil: new Date(Date.now() + 23 * 3600_000 + 60_000).toISOString(),
  };
}

export const PAY_DEMO_SHIPMENT = {
  id: PAY_DEMO_SHIPMENT_ID,
  status: ShipmentStatus.PUBLISHED,
  carrierId: null,
};

/** Resultado simulado según el CVV, como el prototipo: 132 → código incorrecto, 000 → sin fondos,
 * 111 → tarjeta rechazada, 999 → error de plataforma; cualquier otro reserva. */
export function payDemoOutcome(cvv: string): PayShipmentOutcome {
  switch (cvv) {
    case "132":
      return { kind: "rejected", reason: "invalid_data", payUntil: null };
    case "000":
      return { kind: "rejected", reason: "insufficient_funds", payUntil: null };
    case "111":
      return { kind: "rejected", reason: "card_rejected", payUntil: null };
    case "999":
      return { kind: "rejected", reason: "platform_error", payUntil: null };
    default:
      return { kind: "reserved" };
  }
}
