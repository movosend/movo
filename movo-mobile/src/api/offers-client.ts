import type { OfferStatus } from "@movo/shared/dist/types/offer";
import type { PackageType } from "../store/shipment-wizard-store";
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
  /** MOVO-186: desglose derivado de `priceOffered` (bruto), calculado con la tasa
   * de comisión vigente al momento de la lectura (no necesariamente la que regía
   * al ofertar). */
  priceNetArs: number;
  commissionAmountArs: number;
  /** MOVO-187: snapshot del emisor al momento de ofertar, simétrico al del
   * transportista de arriba. */
  senderNameAtOffer: string | null;
  senderVerifiedAtOffer: boolean | null;
  senderRatingAtOffer: number | null;
  /** MOVO-180: entrega estimada opcional propuesta por el transportista. */
  estimatedDeliveryDate: string | null;
  estimatedDeliveryTimeWindowStart: string | null;
  estimatedDeliveryTimeWindowEnd: string | null;
  /** MOVO-189: instante crudo en que el emisor vio esta oferta por primera vez —
   * la traducción a copy ("Vista hace 40 min") es responsabilidad de la UI. */
  viewedAtBySender: string | null;
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
 * `priceNetArs`/`commissionAmountArs` ya viven en `OfferSummary` (MOVO-186).
 */
export type CreateOfferResponse = OfferSummary;

export interface MyOfferShipmentContext {
  id: string;
  status: string;
  pickupAddress: string;
  pickupDate: string;
  /** Ventana horaria de retiro PEDIDA POR EL EMISOR al crear el envío -- distinta de
   * `offeredPickupTimeWindowStart/End` de la oferta (lo que el transportista
   * propuso). Se usa para mostrar si la oferta coincide o difiere de lo pedido. */
  pickupTimeWindowStart: string;
  pickupTimeWindowEnd: string;
  deliveryAddress: string;
  /** MOVO-185: distancia Haversine pickup->delivery, redondeada a 1 decimal. */
  distanceKm: number;
  packageType: PackageType;
  weightKg: number;
  description: string | null;
}

/**
 * MOVO-188: posición de la oferta propia entre las `pending` del mismo envío —
 * `null` si la oferta no está `pending` o el envío ya no acepta ofertas.
 */
export interface OfferCompetitiveRank {
  rank: number;
  total: number;
  lowestPriceNetArs: number;
  highestPriceNetArs: number;
}

export interface MyOfferSummary extends OfferSummary {
  shipment: MyOfferShipmentContext;
  competitiveRank: OfferCompetitiveRank | null;
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

/**
 * Body de `PATCH /offers/:id` (MOVO-181). Parcial — cualquier subconjunto de estos
 * 4 campos editables. `offeredPickupTimeWindowStart/End: null` explícito resetea la
 * franja alternativa (vuelve a "usa la ventana del envío tal cual"); omitir el campo
 * no la toca.
 */
export interface UpdateOfferRequest {
  priceOfferedArs?: number;
  offeredDate?: string;
  offeredPickupTimeWindowStart?: string | null;
  offeredPickupTimeWindowEnd?: string | null;
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

  /**
   * `GET /offers/:id` (MOVO-190)
   * Detalle completo de una oferta propia — mismo shape que un ítem de `listMyOffers`.
   */
  getOffer(offerId: string): Promise<MyOfferSummary> {
    return httpClient.get<MyOfferSummary>(`/offers/${offerId}`);
  },

  /**
   * `PATCH /offers/:id` (MOVO-181)
   * Modifica una oferta propia en `pending` — precio y/o fecha/franja de retiro
   * propuesta, parcial. A diferencia de `getOffer`/`listMyOffers`, el backend
   * (`offers.routes.ts#updateOffer` -> `toOfferDto`) devuelve el `OfferSummary`
   * plano, SIN `shipment`/`competitiveRank` -- mismo shape que accept/reject/withdraw.
   */
  updateOffer(offerId: string, data: UpdateOfferRequest): Promise<OfferSummary> {
    return httpClient.patch<OfferSummary>(`/offers/${offerId}`, data);
  },
};
