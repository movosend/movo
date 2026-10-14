import type { MpConnectStatus } from "@movo/shared/dist/types/mp-connect";
import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { hasUsableCard } from "./saved-cards";

/** Lo que hay que resolver en "Pagos y cobros", o `null` si está todo en orden. */
export type PaymentsAttention = "mp_invalid" | "cards_expired";

/**
 * Decide si la fila "Pagos y cobros" de Perfil → Configuración muestra un aviso. Solo se
 * avisa un problema real: no tener Mercado Pago vinculado o no tener tarjetas es normal para
 * quien solo envía o paga cargando la tarjeta al momento, y no se marca. Si pasan las dos
 * cosas gana Mercado Pago, que impide cobrar. Sin datos (cargando o con error) no avisa.
 */
export function paymentsAttention(
  mpStatus: MpConnectStatus | undefined,
  cards: SavedCard[] | undefined,
  now: Date = new Date(),
): PaymentsAttention | null {
  if (mpStatus === "invalid") return "mp_invalid";
  if (cards && cards.length > 0 && !hasUsableCard(cards, now)) return "cards_expired";
  return null;
}
