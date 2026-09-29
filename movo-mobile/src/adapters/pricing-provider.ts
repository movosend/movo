import type { ShipmentQuoteResponse } from "@movo/shared/dist/types/pricing";
import { shipmentsClient } from "../api/shipments-client";
import type { PackageType } from "../store/shipment-wizard-store";

/**
 * Precio del paso de resumen del wizard de envíos (MOVO-83). Desde MOVO-255 es el
 * precio real del backend (`POST /shipments/quote`, misma lógica que la creación) y
 * viene congelado con un `quoteId`: el envío se crea exactamente a este precio. Antes
 * era una preview calculada en el celular con la fórmula provisoria, que dejó de
 * coincidir con el backend al entrar `demand_fuel_routes_v1` (MOVO-138).
 */
export interface PricingQuoteInput {
  packageType: PackageType;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  pickup: { lat: number; lng: number };
  delivery: { lat: number; lng: number };
}

export interface PricingProvider {
  getQuote(input: PricingQuoteInput): Promise<ShipmentQuoteResponse>;
}

const realPricingProvider: PricingProvider = {
  getQuote: (input) =>
    shipmentsClient.quote({
      packageType: input.packageType,
      weightKg: input.weightKg,
      lengthCm: input.lengthCm,
      widthCm: input.widthCm,
      heightCm: input.heightCm,
      pickupLat: input.pickup.lat,
      pickupLng: input.pickup.lng,
      deliveryLat: input.delivery.lat,
      deliveryLng: input.delivery.lng,
    }),
};

export function createPricingProvider(): PricingProvider {
  return realPricingProvider;
}
