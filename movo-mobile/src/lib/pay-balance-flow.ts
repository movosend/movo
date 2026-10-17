import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import type { BalancePayDataResponse, BalancePayResponse } from "@movo/shared/dist/types/user-ledger";
import { paymentsClient } from "../api/payments-client";
import { createSavedCardToken } from "./mp-card-tokenizer";

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
