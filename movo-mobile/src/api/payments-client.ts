import type {
  MpConnectAuthorizationUrlResponse,
  MpConnectStatusResponse,
} from "@movo/shared/dist/types/mp-connect";
import type {
  CardsCheckoutDataResponse,
  CreateSavedCardRequest,
  SavedCard,
} from "@movo/shared/dist/types/saved-card";
import type { ShipmentSettlementResponse } from "@movo/shared/dist/types/settlement";
import type { TransactionListResponse } from "@movo/shared/dist/types/transaction";
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
  /**
   * `GET /shipments/:id/settlement` (MOVO-212 AC10, vive en `svc-shipments`): el pago de un
   * envío entregado, ya filtrado por rol. 404 `SETTLEMENT_NOT_FOUND` mientras la captura no
   * arrancó; 403 para el receptor.
   */
  getShipmentSettlement(shipmentId: string): Promise<ShipmentSettlementResponse> {
    return httpClient.get<ShipmentSettlementResponse>(`/shipments/${shipmentId}/settlement`);
  },
  /**
   * `GET /payments/transactions?role=sender&shipmentId=` (MOVO-303, filtro de MOVO-308): las
   * reservas que el emisor hizo para un envío, la más reciente primero, con la tarjeta usada.
   */
  listShipmentSenderTransactions(shipmentId: string): Promise<TransactionListResponse> {
    return httpClient.get<TransactionListResponse>(
      `/payments/transactions?role=sender&shipmentId=${encodeURIComponent(shipmentId)}`,
    );
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
