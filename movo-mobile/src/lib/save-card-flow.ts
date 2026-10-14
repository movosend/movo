import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { paymentsClient } from "../api/payments-client";
import { type CardTokenInput, createCardToken } from "./mp-card-tokenizer";

export interface SaveCardInput {
  publicKey: string;
  card: CardTokenInput;
  /** Lo devuelve el BIN de MP; si no se pudo consultar, el backend lo infiere del token. */
  paymentMethodId: string | null;
  alias: string | null;
  /** "Usar como predeterminada" (o forzado: es la primera tarjeta vigente). */
  makeDefault: boolean;
}

export interface SaveCardResult {
  card: SavedCard;
  /** La tarjeta quedó guardada, pero marcarla como predeterminada falló: se avisa, no se reintenta el alta. */
  defaultFailed: boolean;
}

/**
 * Alta de una tarjeta guardada (MOVO-101): tokeniza en el dispositivo, manda solo el token
 * a `POST /payments/cards` y, si se pidió y el backend no la dejó predeterminada (ya había
 * otra), la marca. Si ese segundo paso falla la tarjeta ya está guardada: se devuelve igual con
 * `defaultFailed`, para no hacer reintentar (y duplicar) un alta que salió bien. Función pura (sin React) para testearla sin montar `useMutation`
 * (cuelga el worker de jest-expo, ver `movo-mobile/CLAUDE.md`, MOVO-136).
 *
 * Los datos de la tarjeta no salen de acá: no se guardan, no se loguean y no se devuelven.
 */
export async function saveNewCard(input: SaveCardInput): Promise<SaveCardResult> {
  const cardToken = await createCardToken(input.publicKey, input.card);
  const saved = await paymentsClient.createSavedCard({
    cardToken,
    ...(input.paymentMethodId ? { paymentMethodId: input.paymentMethodId } : {}),
    ...(input.alias ? { alias: input.alias } : {}),
  });
  if (input.makeDefault && !saved.isDefault) {
    try {
      return { card: await paymentsClient.setDefaultCard(saved.id), defaultFailed: false };
    } catch {
      return { card: saved, defaultFailed: true };
    }
  }
  return { card: saved, defaultFailed: false };
}
