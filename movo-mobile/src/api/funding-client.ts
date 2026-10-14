import type {
  ShipmentFundingRequest,
  ShipmentFundingResponse,
  ShipmentFundingResult,
} from "@movo/shared/dist/types/funding";
import { httpClient } from "./http-client";

/**
 * Pago del envío (MOVO-269, backend MOVO-210/282). Solo el emisor. El backend es idempotente
 * por envío: un doble tap o un reintento de red no crea dos reservas, así que no hay header
 * de idempotencia del lado del cliente.
 */
export const fundingClient = {
  /** `GET /shipments/:id/funding`: `carrierPublicKey`, monto y `payUntil`. 409 si ya no se puede pagar. */
  getFunding(shipmentId: string): Promise<ShipmentFundingResponse> {
    return httpClient.get<ShipmentFundingResponse>(`/shipments/${shipmentId}/funding`);
  },
  /**
   * `POST /shipments/:id/funding`. Solo viaja el token de un solo uso y el id de la tarjeta
   * guardada: ni el número ni el CVV llegan nunca al backend. Un rechazo de la tarjeta NO es un
   * error HTTP: vuelve 200 con `funded: false` y el motivo.
   */
  fund(shipmentId: string, body: ShipmentFundingRequest): Promise<ShipmentFundingResult> {
    return httpClient.post<ShipmentFundingResult>(`/shipments/${shipmentId}/funding`, body);
  },
};
