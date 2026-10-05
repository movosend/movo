import { QuoteBreakdown, QuoteRequest } from "@movo/shared";
import { PricingGamePreset } from "../modules/demo/pricing-game.presets";

export type PricingGameAnswer = "yes" | "maybe" | "no";

/** Pantallas del juego (`movo-institucional`), para saber dónde se abandonó la partida. */
export const PRICING_GAME_SCREENS = [
  "attract",
  "origin",
  "dest",
  "package",
  "quote",
  "senderAlt",
  "courier",
  "courierAlt",
  "uber",
  "email",
  "thanks",
] as const;

export type PricingGameScreen = (typeof PRICING_GAME_SCREENS)[number];

/** Fila completa de `pricing_game_sessions`, ya resuelta por el servicio. */
export interface PricingGameSessionRecord {
  id: string;
  eventTag: string;
  deviceId: string | null;
  startedAt: Date;
  endedAt: Date;
  durationSec: number;
  completed: boolean;
  lastScreen: PricingGameScreen;
  originName: string | null;
  originProvince: string | null;
  originLat: number | null;
  originLng: number | null;
  destinationName: string | null;
  destinationProvince: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  packagePreset: PricingGamePreset | null;
  packageType: QuoteRequest["packageType"] | null;
  weightKg: number | null;
  quoteId: string | null;
  quoteVerified: boolean;
  calculationMethod: string | null;
  suggestedPriceArs: number | null;
  highDemand: boolean | null;
  distanceKm: number | null;
  distanceSource: string | null;
  fuelArsPerLiter: number | null;
  breakdown: QuoteBreakdown | null;
  senderAnswer: PricingGameAnswer | null;
  senderAltChoice: string | null;
  senderWtpArs: number | null;
  commissionRate: number | null;
  courierEarnArs: number | null;
  courierAnswer: PricingGameAnswer | null;
  courierAltChoice: string | null;
  courierWtaArs: number | null;
  uberEstimateArs: number | null;
  email: string | null;
  userAgent: string | null;
}

/** Proyección mínima para `GET /demo/pricing-game/stats` (sin datos personales). */
export interface PricingGameSessionForStats {
  completed: boolean;
  packagePreset: string | null;
  distanceKm: number | null;
  suggestedPriceArs: number | null;
  senderAnswer: string | null;
  senderWtpArs: number | null;
  courierEarnArs: number | null;
  courierAnswer: string | null;
  courierWtaArs: number | null;
}
