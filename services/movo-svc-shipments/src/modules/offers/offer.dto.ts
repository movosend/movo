import { decomposeOfferGrossPrice } from "@movo/shared";
import { Offer } from "../../models/offer";

export function toOfferDto(offer: Offer) {
  // MOVO-186: desglose neto/comisión a partir del bruto persistido
  // (`priceOffered`), con la tasa de comisión VIGENTE al momento de la lectura --
  // no la que regía cuando se creó la oferta (mismo criterio ya usado por
  // `computeOffersSummaryForCarrier` en shipments.service.ts, AC1 de MOVO-186).
  const { netArs, commissionAmountArs } = decomposeOfferGrossPrice(offer.priceOffered);
  return {
    ...offer,
    priceNetArs: netArs,
    commissionAmountArs,
    // Bug reportado por el usuario (pantalla de detalle de oferta, MOVO-190): esto
    // salía "2026-08-21T00:00:00.000Z" (ISO crudo) en vez de una fecha legible --
    // `offeredDate` es `@db.Date` (mismo gotcha de timezone de MOVO-80/180), igual
    // que `estimatedDeliveryDate` un poco más abajo, y tiene que formatearse
    // date-only con el mismo criterio, no como "date-time".
    offeredDate: offer.offeredDate.toISOString().slice(0, 10),
    expiresAt: offer.expiresAt ? offer.expiresAt.toISOString() : null,
    createdAt: offer.createdAt.toISOString(),
    respondedAt: offer.respondedAt ? offer.respondedAt.toISOString() : null,
    // MOVO-189: instante crudo, sin traducir a copy ("Vista hace 40 min") -- eso es de UI.
    viewedAtBySender: offer.viewedAtBySender ? offer.viewedAtBySender.toISOString() : null,
    // MOVO-180: estimatedDeliveryDate se formatea date-only en TODOS los endpoints
    // que lo exponen (toMyOfferDto/toShipmentDto incluidos) -- es un valor de
    // calendario (@db.Date), mismo criterio que offeredDate de arriba.
    estimatedDeliveryDate: offer.estimatedDeliveryDate
      ? offer.estimatedDeliveryDate.toISOString().slice(0, 10)
      : null,
  };
}
