import type { PricingProvider, PricingQuoteInput, PricingQuoteResult } from "./pricing-provider";

/**
 * Mismo espíritu que `computePlaceholderPrice` en `shipments.service.ts`
 * (`movo-svc-shipments`, MOVO-80) — tarifa base + $/kg + $/km (Haversine), pero
 * client-side y explícitamente provisional, a reemplazar cuando MOVO-82 exista.
 * Devuelve `null` si falta cualquier dato requerido (AC8: "precio a estimar").
 */
const BASE_FARE_ARS = 1500;
const PRICE_PER_KG_ARS = 300;
const PRICE_PER_KM_ARS = 150;
const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getQuote(input: PricingQuoteInput): Promise<PricingQuoteResult | null> {
  const { pickup, delivery, weightKg, lengthCm, widthCm, heightCm } = input;
  if (!pickup || !delivery || weightKg === null || lengthCm === null || widthCm === null || heightCm === null) {
    return null;
  }

  const distanceKm = haversineKm(pickup.lat, pickup.lng, delivery.lat, delivery.lng);
  const suggestedPriceArs = Math.round(BASE_FARE_ARS + weightKg * PRICE_PER_KG_ARS + distanceKm * PRICE_PER_KM_ARS);
  return { suggestedPriceArs };
}

export const mockPricingProvider: PricingProvider = { getQuote };
