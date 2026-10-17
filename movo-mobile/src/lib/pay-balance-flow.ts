import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import type { BalancePayDataResponse, BalancePayResponse } from "@movo/shared/dist/types/user-ledger";
import { paymentsClient } from "../api/payments-client";
import type { HoldFailureReason } from "@movo/shared/dist/types/hold";
import { createSavedCardToken } from "./mp-card-tokenizer";

/** Copy del rechazo de un pago de saldo: es un cobro directo, no una reserva como en los envíos. */
export function balanceRejectionCopy(reason: HoldFailureReason, cardTitle: string): { body: string; field: "cvv" | null } {
  switch (reason) {
    case "insufficient_funds":
      return { body: `Tu ${cardTitle} no tiene fondos suficientes. No se cobró nada: elegí otra tarjeta o probá con un monto menor.`, field: null };
    case "invalid_data":
      return { body: "El código de seguridad no coincide con la tarjeta. No se cobró nada.", field: "cvv" };
    case "platform_error":
      return { body: "Hubo un problema de nuestro lado. No se cobró nada: probá de nuevo en unos minutos.", field: null };
    case "card_rejected":
    default:
      return { body: "Tu banco rechazó la tarjeta. No se cobró nada: probá con otra tarjeta.", field: null };
  }
}

/** El CVV solo existe en esta llamada local a MP; a Movo va el token de un solo uso. */
export async function payBalanceWithSavedCard(input: {
  payData: BalancePayDataResponse;
  card: Pick<SavedCard, "id" | "mpCardId">;
  cvv: string;
  amountArs: number;
}): Promise<BalancePayResponse> {
  const cardToken = await createSavedCardToken(input.payData.publicKey, {
    cardId: input.card.mpCardId,
    securityCode: input.cvv,
  });
  return paymentsClient.payBalance({ amountArs: input.amountArs, cardToken, savedCardId: input.card.id });
}
