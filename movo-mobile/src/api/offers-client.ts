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
  message: string | null;
  carrierRatingAtOffer: number | null;
  carrierNameAtOffer: string | null;
  status: OfferStatus;
  expiresAt: string | null;
  createdAt: string;
  respondedAt: string | null;
}

export interface ListShipmentOffersParams {
  [key: string]: string | number | boolean | undefined;
  sort?: OfferSortOption;
  includeResolved?: boolean;
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
};
