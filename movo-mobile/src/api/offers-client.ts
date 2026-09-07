import type { OfferStatus } from "@movo/shared/dist/types/offer";
import { httpClient } from "./http-client";

export type OfferSortOption = "price" | "rating" | "createdAt";

/**
 * DTO tal cual lo devuelve `GET /shipments/:id/offers`, `POST /offers/:id/accept`
 * y `POST /offers/:id/reject` (`offerResponse` en `offers.schema.ts`, `movo-svc-shipments`,
 * MOVO-144).
 */
export interface OfferSummary {
  id: string;
  shipmentId: string;
  carrierId: string;
  priceOffered: number;
  offeredDate: string;
  /** MOVO-177: franja horaria alternativa de retiro ("HH:mm"), solo si el transportista
   * propuso un día/horario distinto al pedido — null cuando la oferta usa la ventana del
   * envío tal cual. */
  offeredPickupTimeWindowStart: string | null;
  offeredPickupTimeWindowEnd: string | null;
  message: string | null;
  carrierRatingAtOffer: number | null;
  carrierNameAtOffer: string | null;
  status: OfferStatus;
  expiresAt: string | null;
  createdAt: string;
  respondedAt: string | null;
  tripId?: string | null;
}

export interface ListShipmentOffersParams {
  [key: string]: string | number | boolean | undefined;
  sort?: OfferSortOption;
  includeResolved?: boolean;
}

/**
 * Body de `POST /shipments/:id/offers` (MOVO-143 / MOVO-149).
 * `priceOfferedArs` es el monto NETO que el transportista quiere cobrar.
 */
export interface CreateOfferRequest {
  priceOfferedArs: number;
  offeredDate: string;
  /** MOVO-177: solo cuando se propone un día/horario de retiro distinto al pedido por
   * el emisor — both o ninguno. */
  offeredPickupTimeWindowStart?: string;
  offeredPickupTimeWindowEnd?: string;
  message?: string;
  tripId?: string;
}

/**
 * DTO devuelto por `POST /shipments/:id/offers` (MOVO-143 / MOVO-149).
 * Desglosa neto, comisión y bruto calculados por el servidor.
 */
export interface CreateOfferResponse extends OfferSummary {
  priceNetArs: number;
  commissionAmountArs: number;
}

export interface MyOfferShipmentContext {
  id: string;
  status: string;
  pickupAddress: string;
  pickupDate: string;
  deliveryAddress: string;
}

export interface MyOfferSummary extends OfferSummary {
  shipment: MyOfferShipmentContext;
}

export interface ListMyOffersParams {
  [key: string]: string | number | boolean | undefined;
  status?: OfferStatus | `${OfferStatus}`;
  page?: number;
  limit?: number;
}

export interface ListMyOffersResponse {
  items: MyOfferSummary[];
  page: number;
  limit: number;
  total: number;
}

export const offersClient = {
  /**
   * `GET /shipments/:id/offers` (MOVO-144 / MOVO-150)
   * Lista las ofertas de un envío para que el emisor elija un transportista.
   */
  listShipmentOffers(shipmentId: string, params?: ListShipmentOffersParams): Promise<OfferSummary[]> {
    return httpClient.get<OfferSummary[]>(`/shipments/${shipmentId}/offers`, params);
  },

  /**
   * `POST /offers/:id/accept` (MOVO-144 / MOVO-150)
   * El emisor acepta la oferta; el envío pasa a `assignment_pending` con el transportista
   * asignado y las demás ofertas pasan a `superseded`.
   */
  acceptOffer(offerId: string): Promise<OfferSummary> {
    return httpClient.post<OfferSummary>(`/offers/${offerId}/accept`);
  },

  /**
   * `POST /offers/:id/reject` (MOVO-144 / MOVO-150)
   * El emisor rechaza puntualmente una oferta; la oferta queda `rejected` y el envío
   * continúa `published`.
   */
  rejectOffer(offerId: string): Promise<OfferSummary> {
    return httpClient.post<OfferSummary>(`/offers/${offerId}/reject`);
  },

  /**
   * `POST /shipments/:id/offers` (MOVO-143 / MOVO-149)
   * El transportista oferta sobre un envío publicado indicando el neto que quiere cobrar.
   * El servidor calcula la comisión y el bruto.
   */
  createOffer(shipmentId: string, data: CreateOfferRequest): Promise<CreateOfferResponse> {
    return httpClient.post<CreateOfferResponse>(`/shipments/${shipmentId}/offers`, data);
  },

  /**
   * `POST /offers/:id/withdraw` (MOVO-143 / MOVO-149)
   * El transportista retira su oferta activa en pending -> withdrawn.
   */
  withdrawOffer(offerId: string): Promise<OfferSummary> {
    return httpClient.post<OfferSummary>(`/offers/${offerId}/withdraw`);
  },

  /**
   * `GET /offers/mine` (MOVO-145 / MOVO-149)
   * Lista paginada de las ofertas del transportista autenticado.
   */
  listMyOffers(params?: ListMyOffersParams): Promise<ListMyOffersResponse> {
    return httpClient.get<ListMyOffersResponse>("/offers/mine", params);
  },
};
