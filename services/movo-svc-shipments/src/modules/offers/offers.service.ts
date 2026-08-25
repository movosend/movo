import { OfferStatus } from "@movo/shared";
import { OfferRepository } from "../../repositories/offer-repository";
import { OfferWithShipmentContext } from "../../models/offer";

export interface ListMyOffersResult {
  items: OfferWithShipmentContext[];
  page: number;
  limit: number;
  total: number;
}

export function createOffersService(offerRepository: OfferRepository) {
  return {
    /** MOVO-145 (AC1-AC5): ofertas propias del transportista autenticado. */
    async listMyOffers(
      carrierId: string,
      page: number,
      limit: number,
      status?: OfferStatus
    ): Promise<ListMyOffersResult> {
      const { items, total } = await offerRepository.listByCarrier(carrierId, page, limit, status);
      return { items, page, limit, total };
    },
  };
}
