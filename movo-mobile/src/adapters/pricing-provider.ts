import { mockPricingProvider } from "./mock-pricing-provider";

/**
 * Preview de precio sugerido para el paso de resumen del wizard de envíos (MOVO-83,
 * AC7/AC8) — MOVO-82 (motor real de `svc-pricing-logistics`) todavía no existe. Este
 * provider es una PREVIEW client-side, nunca el valor autoritativo: una vez que
 * `POST /shipments` crea el envío de verdad, el `suggestedPriceArs` que devuelve el
 * servidor (calculado en `shipments.service.ts`, `movo-svc-shipments`, MOVO-80) es el
 * único número real — este solo existe para no dejar el resumen vacío antes de
 * confirmar.
 */
export interface PricingQuoteInput {
  pickup: { lat: number; lng: number } | null;
  delivery: { lat: number; lng: number } | null;
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
}

export interface PricingQuoteResult {
  suggestedPriceArs: number;
}

export interface PricingProvider {
  getQuote(input: PricingQuoteInput): Promise<PricingQuoteResult | null>;
}

/** true mientras MOVO-82 (svc-pricing-logistics, `POST /quote`) no exista — cambiar a
 * `false` cuando ese ticket cierre y haya un `RealPricingProvider` que lo consuma. */
const USE_MOCK_PRICING = true;

export function createPricingProvider(): PricingProvider {
  if (USE_MOCK_PRICING) return mockPricingProvider;
  throw new Error("RealPricingProvider no implementado todavía — ver MOVO-82.");
}
