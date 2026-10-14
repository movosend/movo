import type {
  MpConnectAuthorizationUrlResponse,
  MpConnectStatusResponse,
} from "@movo/shared/dist/types/mp-connect";
import type {
  CardsCheckoutDataResponse,
  CreateSavedCardRequest,
  SavedCard,
} from "@movo/shared/dist/types/saved-card";
import { httpClient } from "./http-client";

/**
 * Vinculación de la cuenta de Mercado Pago del transportista (MOVO-112), contra los
 * endpoints de `svc-payments` (MOVO-111). Mismo patrón cliente que `vehicle-client.ts`.
 */
export const paymentsClient = {
  /** `GET /payments/mp-connect/status` */
  getMpConnectStatus(): Promise<MpConnectStatusResponse> {
    return httpClient.get<MpConnectStatusResponse>("/payments/mp-connect/status");
  },
  /** `GET /payments/mp-connect/authorization-url` */
  getMpConnectAuthorizationUrl(): Promise<MpConnectAuthorizationUrlResponse> {
    return httpClient.get<MpConnectAuthorizationUrlResponse>("/payments/mp-connect/authorization-url");
  },
  /** `DELETE /payments/mp-connect`: idempotente, después el status es `unlinked`. */
  unlinkMpAccount(): Promise<void> {
    return httpClient.delete<void>("/payments/mp-connect");
  },
  /** `GET /payments/cards/checkout-data`: la `public_key` con la que se tokeniza en el dispositivo (MOVO-101). */
  getCardsCheckoutData(): Promise<CardsCheckoutDataResponse> {
    return httpClient.get<CardsCheckoutDataResponse>("/payments/cards/checkout-data");
  },
  /** `GET /payments/cards`: tarjetas vivas, la predeterminada primero. */
  listSavedCards(): Promise<SavedCard[]> {
    return httpClient.get<SavedCard[]>("/payments/cards");
  },
  /**
   * `POST /payments/cards`. Solo viaja el token de un solo uso (y el nombre de referencia):
   * número y CVV nunca llegan al backend. 200 si la tarjeta ya estaba guardada.
   */
  createSavedCard(body: CreateSavedCardRequest): Promise<SavedCard> {
    return httpClient.post<SavedCard>("/payments/cards", body);
  },
  /** `PATCH /payments/cards/:id/default` */
  setDefaultCard(id: string): Promise<SavedCard> {
    return httpClient.patch<SavedCard>(`/payments/cards/${id}/default`);
  },
  /** `PATCH /payments/cards/:id`: `null` quita el nombre de referencia. */
  updateCardAlias(id: string, alias: string | null): Promise<SavedCard> {
    return httpClient.patch<SavedCard>(`/payments/cards/${id}`, { alias });
  },
  /** `DELETE /payments/cards/:id`: 409 `CARD_IN_USE` si tiene una reserva de fondos viva. */
  deleteSavedCard(id: string): Promise<void> {
    return httpClient.delete<void>(`/payments/cards/${id}`);
  },
};
