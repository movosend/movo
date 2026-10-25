import type { ShipmentFundingResponse } from "@movo/shared/dist/types/funding";
import type { HoldFailureReason } from "@movo/shared/dist/types/hold";
import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { fundingClient } from "../api/funding-client";
import { CardTokenError, createSavedCardToken } from "./mp-card-tokenizer";

/**
 * Pago de un envío con una tarjeta guardada + CVV (MOVO-269, DD-039). Función pura (sin React)
 * para testearla sin montar `useMutation`, que cuelga el worker de jest-expo (ver
 * `movo-mobile/CLAUDE.md`, MOVO-136).
 *
 * Dos pasos separados a propósito: `tokenizeSavedCard` es el único que ve el CVV (se lo manda a
 * MP y devuelve un token de un solo uso) y corre FUERA de `useMutation`, porque React Query
 * retiene las variables de cada mutación en el `MutationCache`. `fundWithToken` es lo que se
 * pasa a la mutación: solo el token y los ids, nunca el CVV. Al backend (`POST
 * /shipments/:id/funding`) van el token, la tarjeta y el total que el emisor confirmó.
 */
export type PayShipmentOutcome =
  /** Fondos reservados: el envío pasó a `assigned`. */
  | { kind: "reserved" }
  /** La tarjeta fue rechazada: el envío sigue pagable mientras no venza el plazo. */
  | { kind: "rejected"; reason: HoldFailureReason; payUntil: string | null }
  /** MP todavía no resolvió (`funded: false` sin motivo): se reconcilia por webhook. */
  | { kind: "pending"; payUntil: string | null }
  /** El plazo venció o el envío cambió de estado: ya no se puede pagar. */
  | { kind: "unavailable"; error: ApiError }
  /** La deuda cambió: hay que mostrar el nuevo total y pedir otra confirmación. */
  | { kind: "amount_changed" }
  /** MP rechazó generar el token (CVV mal formado, tarjeta inexistente) o no hubo red. */
  | { kind: "token_error"; error: CardTokenError }
  /** Cualquier otro error del backend (502, tarjeta inexistente, transportista sin MP...). */
  | { kind: "error"; error: unknown };

export type TokenizeOutcome =
  | { kind: "token"; cardToken: string }
  | Extract<PayShipmentOutcome, { kind: "token_error" | "error" }>;

export interface TokenizeSavedCardInput {
  funding: Pick<ShipmentFundingResponse, "carrierPublicKey">;
  card: Pick<SavedCard, "mpCardId">;
  cvv: string;
}

/** Pide a MP el token de un solo uso (`card_id` + CVV, `public_key` del transportista). */
export async function tokenizeSavedCard({ funding, card, cvv }: TokenizeSavedCardInput): Promise<TokenizeOutcome> {
  try {
    const cardToken = await createSavedCardToken(funding.carrierPublicKey, { cardId: card.mpCardId, securityCode: cvv });
    return { kind: "token", cardToken };
  } catch (err) {
    if (err instanceof CardTokenError) return { kind: "token_error", error: err };
    return { kind: "error", error: err };
  }
}

/** Entrada de la mutación: sin CVV, solo el token ya generado y los identificadores. */
export interface FundWithTokenInput {
  shipmentId: string;
  cardToken: string;
  savedCardId: string;
  expectedTotalArs: number;
}

export async function fundWithToken({ shipmentId, cardToken, savedCardId, expectedTotalArs }: FundWithTokenInput): Promise<PayShipmentOutcome> {
  try {
    const result = await fundingClient.fund(shipmentId, { cardToken, savedCardId, expectedTotalArs });
    if (result.funded) return { kind: "reserved" };
    if (result.failureReason) {
      return { kind: "rejected", reason: result.failureReason, payUntil: result.payUntil };
    }
    return { kind: "pending", payUntil: result.payUntil };
  } catch (err) {
    if (err instanceof ApiError && err.code === "HOLD_AMOUNT_CHANGED") {
      return { kind: "amount_changed" };
    }
    if (err instanceof ApiError && err.code === "SHIPMENT_FUNDING_NOT_AVAILABLE") {
      return { kind: "unavailable", error: err };
    }
    return { kind: "error", error: err };
  }
}
