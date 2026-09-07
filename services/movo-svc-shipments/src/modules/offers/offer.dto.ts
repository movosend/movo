import { Offer } from "../../models/offer";

export function toOfferDto(offer: Offer) {
  return {
    ...offer,
    offeredDate: offer.offeredDate.toISOString(),
    expiresAt: offer.expiresAt ? offer.expiresAt.toISOString() : null,
    createdAt: offer.createdAt.toISOString(),
    respondedAt: offer.respondedAt ? offer.respondedAt.toISOString() : null,
    // MOVO-180: a diferencia de offeredDate (acá expuesto como "date-time"),
    // estimatedDeliveryDate se formatea date-only en TODOS los endpoints que lo
    // exponen (toMyOfferDto/toShipmentDto incluidos) -- es un valor de calendario
    // (@db.Date), y un mismo campo no puede salir "2026-08-21T00:00:00.000Z" acá y
    // "2026-08-21" en el resto (feedback de review, ver offers.schema.ts).
    estimatedDeliveryDate: offer.estimatedDeliveryDate
      ? offer.estimatedDeliveryDate.toISOString().slice(0, 10)
      : null,
  };
}
