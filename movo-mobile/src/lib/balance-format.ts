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
