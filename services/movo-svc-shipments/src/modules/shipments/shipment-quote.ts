import { DemandContext } from "@movo/shared";
import { PricingClient, QuoteInput, QuoteResult } from "../../adapters/pricing-client";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { TripRepository } from "../../repositories/trip-repository";
import {
  DEMAND_TRIP_WINDOW_FUTURE_HOURS,
  DEMAND_TRIP_WINDOW_PAST_HOURS,
  DEMAND_ZONE_RADIUS_KM,
} from "../../domain/demand";

const HOUR_MS = 60 * 60 * 1000;

const NO_QUOTE: QuoteResult = { suggestedPriceArs: null, calculationMethod: null, highDemand: null };

export interface ShipmentQuoteDeps {
  pricingClient?: PricingClient;
  shipmentRepository: Pick<ShipmentRepository, "countPublishedNearPickup">;
  tripRepository?: Pick<TripRepository, "countAvailableCarriersNear">;
  logger?: { warn: (obj: unknown, msg?: string) => void };
  now?: () => Date;
}

export type ShipmentQuoteInput = Omit<QuoteInput, "demandContext">;

/**
 * Cotización de un envío (MOVO-138, ADR-025): cuenta la demanda de la zona de retiro y
 * llama a `POST /quote`. Separada de `createShipment` para que la cotización previa del
 * wizard (MOVO-255) use exactamente la misma lógica y dé el mismo número.
 *
 * Nunca lanza, igual que `pricingClient.getQuote`: sin cliente devuelve "precio a
 * estimar", y si el conteo de demanda falla cotiza igual sin `demandContext` (sin
 * recargo) en vez de dejar el envío sin precio.
 */
export async function quoteShipment(deps: ShipmentQuoteDeps, input: ShipmentQuoteInput): Promise<QuoteResult> {
  if (!deps.pricingClient) {
    return NO_QUOTE;
  }
  const demandContext = await countDemand(deps, input);
  return deps.pricingClient.getQuote({ ...input, ...(demandContext ? { demandContext } : {}) });
}

async function countDemand(deps: ShipmentQuoteDeps, input: ShipmentQuoteInput): Promise<DemandContext | undefined> {
  if (!deps.tripRepository || input.originLat === undefined || input.originLng === undefined) {
    return undefined;
  }

  const now = (deps.now ?? (() => new Date()))();
  const lat = input.originLat;
  const lng = input.originLng;
  try {
    const [publishedShipments, availableCarriers] = await Promise.all([
      deps.shipmentRepository.countPublishedNearPickup({ lat, lng, radiusKm: DEMAND_ZONE_RADIUS_KM }),
      deps.tripRepository.countAvailableCarriersNear({
        lat,
        lng,
        radiusKm: DEMAND_ZONE_RADIUS_KM,
        departureFrom: new Date(now.getTime() - DEMAND_TRIP_WINDOW_PAST_HOURS * HOUR_MS),
        departureTo: new Date(now.getTime() + DEMAND_TRIP_WINDOW_FUTURE_HOURS * HOUR_MS),
      }),
    ]);
    return { publishedShipments, availableCarriers };
  } catch (err) {
    deps.logger?.warn(
      { err, event: "pricing_demand_count_failed" },
      "No se pudo contar la demanda de la zona -- se cotiza sin recargo por alta demanda"
    );
    return undefined;
  }
}
