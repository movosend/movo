import { PriceCalculationMethod } from "@movo/shared";
import { vi } from "vitest";
import { PricingClient, QuoteInput, QuoteResult } from "../src/adapters/pricing-client";

/**
 * Fake de `PricingClient` para tests — evita depender de un
 * `movo-svc-pricing-logistics` real levantado (mismo criterio que
 * `fake-users-client.ts`). Por default resuelve un precio fijo determinístico; pasar
 * `getQuote` en `overrides` para simular el fallback de MOVO-82 (AC6/AC7, `{
 * suggestedPriceArs: null, calculationMethod: null }`).
 */
export function createFakePricingClient(overrides: Partial<PricingClient> = {}): PricingClient {
  return {
    getQuote: vi.fn(
      async (_input: QuoteInput): Promise<QuoteResult> => ({
        suggestedPriceArs: 2256,
        calculationMethod: PriceCalculationMethod.EUCLIDEAN_LINEAR_V1,
      })
    ),
    ...overrides,
  };
}
