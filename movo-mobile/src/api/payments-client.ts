import type {
  MpConnectAuthorizationUrlResponse,
  MpConnectStatusResponse,
} from "@movo/shared/dist/types/mp-connect";
import type { ShipmentSettlementResponse } from "@movo/shared/dist/types/settlement";
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
};
