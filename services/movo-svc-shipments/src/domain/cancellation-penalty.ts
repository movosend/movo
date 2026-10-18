import { CancellationPenaltyQuote, computeCancellationPenalty } from "@movo/shared";
import { Shipment } from "../models/shipment";
import { pickupWindowEndInstant, pickupWindowInstant } from "./pickup-window";

/**
 * MOVO-307 (ADR-047): penalidad que correspondería si el emisor cancela el envío en `now`.
 * La ventana del envío ya es la ACORDADA desde que se aceptó la oferta (MOVO-258 D3), así
 * que se mide contra `pickupDate`/`pickupTimeWindow*` tal cual están persistidos. La regla
 * vive en `@movo/shared` para que el mobile muestre el mismo monto.
 */
export function quoteShipmentCancellation(
  shipment: Pick<Shipment, "status" | "agreedPriceArs" | "pickupDate" | "pickupTimeWindowStart" | "pickupTimeWindowEnd">,
  now: Date = new Date()
): CancellationPenaltyQuote {
  return computeCancellationPenalty({
    status: shipment.status,
    agreedPriceArs: shipment.agreedPriceArs,
    pickupWindowStart: pickupWindowInstant(shipment.pickupDate, shipment.pickupTimeWindowStart),
    pickupWindowEnd: pickupWindowEndInstant(shipment.pickupDate, shipment.pickupTimeWindowEnd),
    now,
  });
}
