import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { PriceCalculationMethod, QuoteBreakdown } from "@movo/shared";
import { PricingGamePreset } from "./pricing-game.presets";

/**
 * Cotizaciones del juego de precios. Se guardan para que, al registrar la partida, el
 * precio salga de lo que cotizó el servidor y no del body (`quoteVerified`). Una hora
 * alcanza de sobra para una partida (~1 min) más la cola offline de un iPad sin red un
 * rato; si vence, la partida se guarda igual con `quoteVerified: false`. No se consume
 * al leer: el reenvío de la misma partida tiene que dar el mismo resultado.
 */
export const PRICING_GAME_QUOTE_TTL_SECONDS = 60 * 60;

const quoteKey = (quoteId: string) => `pricing_game_quote:${quoteId}`;

export interface PricingGameQuote {
  /** Lo que se cotizó: la partida solo queda verificada si manda los mismos puntos. */
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  packagePreset: PricingGamePreset;
  suggestedPriceArs: number;
  highDemand: boolean | null;
  calculationMethod: PriceCalculationMethod;
  breakdown: QuoteBreakdown | null;
  commissionRate: number;
  courierEarnArs: number;
}

export interface PricingGameQuoteStore {
  save(quote: PricingGameQuote): Promise<string>;
  get(quoteId: string): Promise<PricingGameQuote | null>;
}

export function createPricingGameQuoteStore(redis: Pick<Redis, "set" | "get">): PricingGameQuoteStore {
  return {
    async save(quote) {
      const quoteId = randomUUID();
      await redis.set(quoteKey(quoteId), JSON.stringify(quote), "EX", PRICING_GAME_QUOTE_TTL_SECONDS);
      return quoteId;
    },

    async get(quoteId) {
      const raw = await redis.get(quoteKey(quoteId));
      return raw ? (JSON.parse(raw) as PricingGameQuote) : null;
    },
  };
}
