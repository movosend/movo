import type { ShipmentFundingResponse } from "@movo/shared/dist/types/funding";
import type { HoldFailureReason } from "@movo/shared/dist/types/hold";
import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { fundingClient } from "../api/funding-client";
import { CardTokenError, createSavedCardToken } from "./mp-card-tokenizer";

/**
 * Pago de un envío con una tarjeta guardada + CVV (MOVO-269, ADR-039). Función pura (sin React)
 * para testearla sin montar `useMutation`, que cuelga el worker de jest-expo (ver
 * `movo-mobile/CLAUDE.md`, MOVO-136).
 *
 * El CVV entra, se usa para pedirle a MP un token de un solo uso con la `public_key` del
 * transportista y no sale de acá: no se guarda, no se loguea y no se manda al backend (a
 * `POST /shipments/:id/funding` van solo `cardToken` y `savedCardId`).
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
  /** MP rechazó generar el token (CVV mal formado, tarjeta inexistente) o no hubo red. */
  | { kind: "token_error"; error: CardTokenError }
  /** Cualquier otro error del backend (502, tarjeta inexistente, transportista sin MP...). */
  | { kind: "error"; error: unknown };

export interface PayShipmentInput {
  funding: Pick<ShipmentFundingResponse, "shipmentId" | "carrierPublicKey">;
  card: Pick<SavedCard, "id" | "mpCardId">;
  cvv: string;
}

export async function payWithSavedCard({ funding, card, cvv }: PayShipmentInput): Promise<PayShipmentOutcome> {
  let cardToken: string;
  try {
    cardToken = await createSavedCardToken(funding.carrierPublicKey, { cardId: card.mpCardId, securityCode: cvv });
  } catch (err) {
    if (err instanceof CardTokenError) return { kind: "token_error", error: err };
    return { kind: "error", error: err };
  }

  try {
    const result = await fundingClient.fund(funding.shipmentId, { cardToken, savedCardId: card.id });
    if (result.funded) return { kind: "reserved" };
    if (result.failureReason) {
      return { kind: "rejected", reason: result.failureReason, payUntil: result.payUntil };
    }
    return { kind: "pending", payUntil: result.payUntil };
  } catch (err) {
    if (err instanceof ApiError && err.code === "SHIPMENT_FUNDING_NOT_AVAILABLE") {
      return { kind: "unavailable", error: err };
    }
    return { kind: "error", error: err };
  }
}
