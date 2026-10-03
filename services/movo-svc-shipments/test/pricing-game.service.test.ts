import { describe, it, expect, vi, beforeEach } from "vitest";
import { __resetCommissionConfigForTests, ApiError, PriceCalculationMethod, QuoteBreakdown } from "@movo/shared";
import {
  createPricingGameService,
  PricingGameSessionInput,
} from "../src/modules/demo/pricing-game.service";
import { PricingGameQuote, PricingGameQuoteStore } from "../src/modules/demo/pricing-game-quote-store";
import { PricingGameRepository } from "../src/repositories/pricing-game-repository";
import { PricingGameSessionRecord } from "../src/models/pricing-game";
import { createFakePricingClient } from "./fake-pricing-client";

const BREAKDOWN: QuoteBreakdown = {
  distanceKm: 401.2,
  distanceSource: "routes_api",
  fuelArsPerLiter: 2222.5,
  fuelSource: "api",
  perKmArs: 151.13,
  base: 1500.19,
  distance: 60633.36,
  weight: 600.08,
  packageFactor: 1,
  demandRatio: 0.5,
  demandMultiplier: 1,
};

const SESSION_ID = "6f1c2a7e-0b55-4d3a-9b1e-2f7d8c9a0b11";
const QUOTE_ID = "1b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d";

function memoryQuoteStore(): PricingGameQuoteStore & { items: Map<string, PricingGameQuote> } {
  const items = new Map<string, PricingGameQuote>();
  return {
    items,
    save: vi.fn(async (quote: PricingGameQuote) => {
      items.set(QUOTE_ID, quote);
      return QUOTE_ID;
    }),
    get: vi.fn(async (id: string) => items.get(id) ?? null),
  };
}

function fakeRepository(): PricingGameRepository & { saved: PricingGameSessionRecord[] } {
  const saved: PricingGameSessionRecord[] = [];
  return {
    saved,
    upsertSession: vi.fn(async (record: PricingGameSessionRecord) => {
      const created = !saved.some((r) => r.id === record.id);
      saved.push(record);
      return { created };
    }),
    listForStats: vi.fn(async () => []),
  };
}

function setup(pricing = createFakePricingClient({
  getQuote: vi.fn(async () => ({
    suggestedPriceArs: 62730,
    calculationMethod: PriceCalculationMethod.DEMAND_FUEL_ROUTES_V1,
    highDemand: false,
    breakdown: BREAKDOWN,
  })),
})) {
  const quoteStore = memoryQuoteStore();
  const repository = fakeRepository();
  const service = createPricingGameService({
    quoteDeps: {
      pricingClient: pricing,
      shipmentRepository: { countPublishedNearPickup: vi.fn().mockResolvedValue(0) },
    },
    quoteStore,
    repository,
  });
  return { service, pricing, quoteStore, repository };
}

const session = (overrides: Partial<PricingGameSessionInput> = {}): PricingGameSessionInput => ({
  eventTag: "feria-utn-2026",
  startedAt: "2026-10-10T15:00:00.000Z",
  endedAt: "2026-10-10T15:01:10.000Z",
  durationSec: 70,
  completed: true,
  lastScreen: "thanks",
  origin: { name: "Córdoba", province: "Córdoba", lat: -31.4201, lng: -64.1888 },
  destination: { name: "Rosario", province: "Santa Fe", lat: -32.9442, lng: -60.6505 },
  packagePreset: "small",
  quoteId: QUOTE_ID,
  senderAnswer: "no",
  senderAltChoice: "-20",
  senderWtpArs: 50184,
  courierAnswer: "yes",
  courierWtaArs: 54547.83,
  uberEstimateArs: 445000,
  email: "Visitante@Mail.com ",
  emailConsent: true,
  ...overrides,
});

describe("PricingGameService.quote", () => {
  beforeEach(() => {
    delete process.env.MOVO_COMMISSION_RATE;
    __resetCommissionConfigForTests();
  });

  it("cotiza con los datos del preset, pide el desglose y calcula la ganancia neta (15%)", async () => {
    const { service, pricing, quoteStore } = setup();

    const result = await service.quote({
      origin: { lat: -31.4201, lng: -64.1888 },
      destination: { lat: -32.9442, lng: -60.6505 },
      packagePreset: "small",
    });

    expect(pricing.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        packageType: "standard_package",
        weightKg: 2,
        lengthCm: 30,
        widthCm: 20,
        heightCm: 15,
        originLat: -31.4201,
        destinationLng: -60.6505,
        includeBreakdown: true,
      })
    );
    expect(result).toEqual({
      quoteId: QUOTE_ID,
      packagePreset: "small",
      suggestedPriceArs: 62730,
      highDemand: false,
      calculationMethod: "demand_fuel_routes_v1",
      breakdown: BREAKDOWN,
      commissionRate: 0.15,
      courierEarnArs: 54547.83, // 62.730 / 1,15
    });
    expect(quoteStore.items.get(QUOTE_ID)?.courierEarnArs).toBe(54547.83);
  });

  it("503 PRICING_UNAVAILABLE si pricing no devuelve precio (no inventa uno)", async () => {
    const { service, quoteStore } = setup(createFakePricingClient({
      getQuote: vi.fn(async () => ({ suggestedPriceArs: null, calculationMethod: null, highDemand: null })),
    }));

    const error = await service
      .quote({ origin: { lat: -31, lng: -64 }, destination: { lat: -32, lng: -60 }, packagePreset: "letter" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ statusCode: 503, code: "PRICING_UNAVAILABLE" });
    expect(quoteStore.save).not.toHaveBeenCalled();
  });
});

describe("PricingGameService.saveSession", () => {
  it("toma precio, desglose y ganancia de la cotización guardada (quoteVerified)", async () => {
    const { service, repository } = setup();
    await service.quote({
      origin: { lat: -31.4201, lng: -64.1888 },
      destination: { lat: -32.9442, lng: -60.6505 },
      packagePreset: "small",
    });

    const result = await service.saveSession(
      SESSION_ID,
      session({ suggestedPriceArs: 1, courierEarnArs: 1, packagePreset: "medium" })
    );

    expect(result).toEqual({ id: SESSION_ID, created: true, quoteVerified: true });
    const [record] = repository.saved;
    expect(record).toMatchObject({
      id: SESSION_ID,
      eventTag: "feria-utn-2026",
      quoteVerified: true,
      // Lo del body no pisa lo cotizado por el servidor.
      suggestedPriceArs: 62730,
      courierEarnArs: 54547.83,
      packagePreset: "small",
      packageType: "standard_package",
      weightKg: 2,
      distanceKm: 401.2,
      distanceSource: "routes_api",
      fuelArsPerLiter: 2222.5,
      commissionRate: 0.15,
      originName: "Córdoba",
      destinationLat: -32.9442,
      senderAltChoice: "-20",
      email: "visitante@mail.com",
    });
    expect(record.startedAt).toEqual(new Date("2026-10-10T15:00:00.000Z"));
  });

  it("con quoteId vencido guarda lo del body y marca quoteVerified false", async () => {
    const { service, repository } = setup();

    const result = await service.saveSession(SESSION_ID, session({ suggestedPriceArs: 60000, courierEarnArs: 52173.91 }));

    expect(result.quoteVerified).toBe(false);
    expect(repository.saved[0]).toMatchObject({
      suggestedPriceArs: 60000,
      courierEarnArs: 52173.91,
      breakdown: null,
      distanceKm: null,
      packageType: "standard_package",
    });
  });

  it("no guarda el email sin consentimiento", async () => {
    const { service, repository } = setup();

    await service.saveSession(SESSION_ID, session({ emailConsent: false }));

    expect(repository.saved[0].email).toBeNull();
  });

  it("partida abandonada antes de cotizar: sin precio ni paquete, tag por defecto", async () => {
    const { service, repository } = setup();

    await service.saveSession(
      SESSION_ID,
      session({ eventTag: undefined, completed: false, lastScreen: "dest", packagePreset: null, quoteId: null, destination: null })
    );

    expect(repository.saved[0]).toMatchObject({
      eventTag: "web",
      completed: false,
      lastScreen: "dest",
      packagePreset: null,
      packageType: null,
      suggestedPriceArs: null,
      destinationName: null,
      quoteVerified: false,
    });
  });

  it("el reenvío de la misma partida es un update (created false)", async () => {
    const { service } = setup();

    await service.saveSession(SESSION_ID, session());
    const second = await service.saveSession(SESSION_ID, session());

    expect(second.created).toBe(false);
  });
});
