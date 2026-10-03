import { ApiError, computeNetFromGross, getCommissionConfig, PriceCalculationMethod, QuoteBreakdown } from "@movo/shared";
import { quoteShipment, ShipmentQuoteDeps } from "../shipments/shipment-quote";
import { PricingGameRepository } from "../../repositories/pricing-game-repository";
import { PricingGameAnswer, PricingGameScreen, PricingGameSessionRecord } from "../../models/pricing-game";
import { computePricingGameStats, PricingGameStats } from "../../domain/pricing-game-stats";
import { PRICING_GAME_PRESETS, PricingGamePreset } from "./pricing-game.presets";
import { PricingGameQuoteStore } from "./pricing-game-quote-store";

/** Tag por defecto si el kiosco no manda `?stand=` (partidas desde la web pública). */
export const DEFAULT_EVENT_TAG = "web";

/** Tope de partidas que entran en `stats`: una feria son cientos, sobra margen. */
export const STATS_MAX_SESSIONS = 20_000;

interface Point {
  lat: number;
  lng: number;
}

export interface PricingGameQuoteInput {
  origin: Point;
  destination: Point;
  packagePreset: PricingGamePreset;
}

export interface PricingGameQuoteResult {
  quoteId: string;
  suggestedPriceArs: number;
  highDemand: boolean | null;
  calculationMethod: PriceCalculationMethod;
  breakdown: QuoteBreakdown | null;
  commissionRate: number;
  courierEarnArs: number;
}

interface PlaceInput extends Point {
  name: string;
  province: string;
}

/** Body de `PUT /demo/pricing-game/sessions/:id`: el `record()` del prototipo. */
export interface PricingGameSessionInput {
  eventTag?: string;
  deviceId?: string;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  completed: boolean;
  lastScreen: PricingGameScreen;
  origin?: PlaceInput | null;
  destination?: PlaceInput | null;
  packagePreset?: PricingGamePreset | null;
  quoteId?: string | null;
  /** Solo se usan si el `quoteId` no se encuentra (venció): quedan `quoteVerified: false`. */
  suggestedPriceArs?: number | null;
  courierEarnArs?: number | null;
  senderAnswer?: PricingGameAnswer | null;
  senderAltChoice?: string | null;
  senderWtpArs?: number | null;
  courierAnswer?: PricingGameAnswer | null;
  courierAltChoice?: string | null;
  courierWtaArs?: number | null;
  uberEstimateArs?: number | null;
  email?: string | null;
  emailConsent?: boolean;
  userAgent?: string | null;
}

export interface PricingGameService {
  quote(input: PricingGameQuoteInput): Promise<PricingGameQuoteResult>;
  saveSession(id: string, input: PricingGameSessionInput): Promise<{ id: string; created: boolean; quoteVerified: boolean }>;
  stats(eventTag?: string): Promise<PricingGameStats>;
}

export interface PricingGameServiceDeps {
  quoteDeps: ShipmentQuoteDeps;
  quoteStore: PricingGameQuoteStore;
  repository: PricingGameRepository;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function createPricingGameService(deps: PricingGameServiceDeps): PricingGameService {
  return {
    async quote({ origin, destination, packagePreset }) {
      const preset = PRICING_GAME_PRESETS[packagePreset];
      // Misma cotización que el wizard del emisor (incluye la demanda real de la zona de
      // retiro), más el desglose que solo pide este módulo.
      const result = await quoteShipment(deps.quoteDeps, {
        ...preset,
        originLat: origin.lat,
        originLng: origin.lng,
        destinationLat: destination.lat,
        destinationLng: destination.lng,
        includeBreakdown: true,
      });
      if (result.suggestedPriceArs == null || result.calculationMethod == null) {
        throw new ApiError(503, "PRICING_UNAVAILABLE", "El motor de precios no respondió. Probá de nuevo.");
      }

      const commissionRate = getCommissionConfig().movoCommissionRate;
      const quote = {
        packagePreset,
        suggestedPriceArs: result.suggestedPriceArs,
        highDemand: result.highDemand,
        calculationMethod: result.calculationMethod,
        breakdown: result.breakdown ?? null,
        commissionRate,
        // El precio sugerido es el bruto que paga el emisor; el transportista cobra el
        // neto (misma fórmula que las ofertas, MOVO-186).
        courierEarnArs: computeNetFromGross(result.suggestedPriceArs, commissionRate),
      };
      const quoteId = await deps.quoteStore.save(quote);
      return { quoteId, ...quote };
    },

    async saveSession(id, input) {
      const stored = input.quoteId ? await deps.quoteStore.get(input.quoteId) : null;
      const presetId = stored?.packagePreset ?? input.packagePreset ?? null;
      const preset = presetId ? PRICING_GAME_PRESETS[presetId] : null;
      const breakdown = stored?.breakdown ?? null;

      const record: PricingGameSessionRecord = {
        id,
        eventTag: input.eventTag || DEFAULT_EVENT_TAG,
        deviceId: input.deviceId ?? null,
        startedAt: new Date(input.startedAt),
        endedAt: new Date(input.endedAt),
        durationSec: input.durationSec,
        completed: input.completed,
        lastScreen: input.lastScreen,
        originName: input.origin?.name ?? null,
        originProvince: input.origin?.province ?? null,
        originLat: input.origin?.lat ?? null,
        originLng: input.origin?.lng ?? null,
        destinationName: input.destination?.name ?? null,
        destinationProvince: input.destination?.province ?? null,
        destinationLat: input.destination?.lat ?? null,
        destinationLng: input.destination?.lng ?? null,
        packagePreset: presetId,
        packageType: preset?.packageType ?? null,
        weightKg: preset?.weightKg ?? null,
        quoteId: input.quoteId ?? null,
        quoteVerified: stored != null,
        calculationMethod: stored?.calculationMethod ?? null,
        suggestedPriceArs: stored?.suggestedPriceArs ?? input.suggestedPriceArs ?? null,
        highDemand: stored?.highDemand ?? null,
        distanceKm: breakdown?.distanceKm ?? null,
        distanceSource: breakdown?.distanceSource ?? null,
        fuelArsPerLiter: breakdown?.fuelArsPerLiter ?? null,
        breakdown,
        senderAnswer: input.senderAnswer ?? null,
        senderAltChoice: input.senderAltChoice ?? null,
        senderWtpArs: input.senderWtpArs == null ? null : round2(input.senderWtpArs),
        commissionRate: stored?.commissionRate ?? null,
        courierEarnArs: stored?.courierEarnArs ?? input.courierEarnArs ?? null,
        courierAnswer: input.courierAnswer ?? null,
        courierAltChoice: input.courierAltChoice ?? null,
        courierWtaArs: input.courierWtaArs == null ? null : round2(input.courierWtaArs),
        uberEstimateArs: input.uberEstimateArs == null ? null : round2(input.uberEstimateArs),
        // Solo con consentimiento explícito (sorteo): sin el tilde no se guarda.
        email: input.emailConsent && input.email ? input.email.trim().toLowerCase() : null,
        userAgent: input.userAgent ?? null,
      };

      const { created } = await deps.repository.upsertSession(record);
      return { id, created, quoteVerified: record.quoteVerified };
    },

    async stats(eventTag) {
      const rows = await deps.repository.listForStats(eventTag, STATS_MAX_SESSIONS);
      return computePricingGameStats(rows);
    },
  };
}
