import { Offer } from "../../models/offer";

export function toOfferDto(offer: Offer) {
  return {
    ...offer,
    offeredDate: offer.offeredDate.toISOString(),
    expiresAt: offer.expiresAt ? offer.expiresAt.toISOString() : null,
    createdAt: offer.createdAt.toISOString(),
    respondedAt: offer.respondedAt ? offer.respondedAt.toISOString() : null,
    // MOVO-180: mismo criterio que offeredDate -- expuesto como "date-time" (no
    // "date"), así que un toISOString() completo alcanza sin el slice que sí
    // necesita toShipmentDto/toMyOfferDto contra el gotcha de asDate.
    estimatedDeliveryDate: offer.estimatedDeliveryDate ? offer.estimatedDeliveryDate.toISOString() : null,
  };
}
