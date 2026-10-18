import type { UserLedgerEntry } from "@movo/shared/dist/types/user-ledger";
import { formatPriceArs } from "./shipment-format";

const LABELS: Record<UserLedgerEntry["type"], string> = {
  cancellation_penalty: "Penalidad",
  penalty_capture: "Cobro de penalidad",
  cash_commission: "Comisión",
  fee_offset: "Descuento",
  payment_surcharge: "Recargo",
  voluntary_payment: "Pago",
  manual_adjustment: "Ajuste",
};

export function balanceEntryLabel(entry: UserLedgerEntry): string {
  return LABELS[entry.type];
}

export function balanceEntryAmount(entry: UserLedgerEntry): string {
  // En la cuenta corriente un positivo aumenta lo que se debe; para el usuario se muestra
  // como salida de dinero. Un pago negativo se muestra como entrada que baja la deuda.
  const sign = entry.amountArs > 0 ? "−" : "+";
  return `${sign}${formatPriceArs(Math.abs(entry.amountArs))}`;
}

export function balanceEntryRole(entry: UserLedgerEntry): string | null {
  return entry.roleAtOrigin === "carrier" ? "Como transportista" : entry.roleAtOrigin === "sender" ? "Como emisor" : null;
}

export function balanceEntryOrigin(entry: UserLedgerEntry): string {
  if (entry.originLabel) return entry.originLabel;
  if (entry.shipmentId) return `Envío #${entry.shipmentId.slice(0, 8)}`;
  if (entry.type === "voluntary_payment") return "Pago de saldo";
  return "Cuenta corriente";
}

/**
 * "Otro monto" del pago de saldo: solo pesos enteros, agrupados con punto mientras se escribe
 * ("2500" → "2.500"). Sin decimales a propósito: con el punto de miles no hay forma de
 * distinguir "2.500" de "2,5" en un teclado que según el idioma escribe uno u otro.
 */
export function formatBalanceAmountInput(text: string): string {
  const digits = text.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9);
  return digits ? Number(digits).toLocaleString("es-AR") : "";
}

/** Inversa de `formatBalanceAmountInput`; `NaN` si está vacío. */
export function parseBalanceAmountInput(text: string): number {
  const digits = text.replace(/\D/g, "");
  return digits ? Number(digits) : NaN;
}
