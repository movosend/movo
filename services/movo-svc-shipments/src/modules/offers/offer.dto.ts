import { Offer } from "../../models/offer";

export function toOfferDto(offer: Offer) {
  return {
    ...offer,
    offeredDate: offer.offeredDate.toISOString(),
    expiresAt: offer.expiresAt ? offer.expiresAt.toISOString() : null,
    createdAt: offer.createdAt.toISOString(),
    respondedAt: offer.respondedAt ? offer.respondedAt.toISOString() : null,
  };
}
