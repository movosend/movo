import { describe, it, expect } from "vitest";
import { computePricingGameStats } from "../src/domain/pricing-game-stats";
import { PricingGameSessionForStats } from "../src/models/pricing-game";

function row(overrides: Partial<PricingGameSessionForStats> = {}): PricingGameSessionForStats {
  return {
    completed: true,
    packagePreset: "small",
    distanceKm: 50,
    suggestedPriceArs: 10000,
    senderAnswer: "yes",
    senderWtpArs: 10000,
    courierEarnArs: 8000,
    courierAnswer: "yes",
    courierWtaArs: 8000,
    ...overrides,
  };
}

describe("computePricingGameStats (juego de precios)", () => {
  it("sin partidas devuelve ceros y ratios nulos", () => {
    const stats = computePricingGameStats([]);

    expect(stats.sessions).toBe(0);
    expect(stats.completionRate).toBeNull();
    expect(stats.sender.ratio).toEqual({ n: 0, median: null, p25: null, p75: null });
    expect(stats.byDistance.lt100.sessions).toBe(0);
  });

  it("cuenta respuestas y calcula la mediana de wtp/precio y wta/ganancia", () => {
    const stats = computePricingGameStats([
      row(),
      row({ senderAnswer: "maybe", senderWtpArs: 9000, courierAnswer: "no", courierWtaArs: 10400 }),
      row({ senderAnswer: "no", senderWtpArs: 7000, courierAnswer: "no", courierWtaArs: null }),
      row({ senderAnswer: "no", senderWtpArs: null, courierAnswer: null, courierWtaArs: null, completed: false }),
    ]);

    expect(stats.sessions).toBe(4);
    expect(stats.completed).toBe(3);
    expect(stats.completionRate).toBe(0.75);
    expect(stats.sender.answers).toEqual({ yes: 1, maybe: 1, no: 2 });
    expect(stats.sender.rejectedAll).toBe(1);
    expect(stats.sender.ratio).toEqual({ n: 3, median: 0.9, p25: 0.8, p75: 0.95 });
    expect(stats.courier.answers).toEqual({ yes: 1, maybe: 0, no: 2 });
    expect(stats.courier.rejectedAll).toBe(1);
    expect(stats.courier.ratio.median).toBe(1.15);
  });

  it("agrupa por paquete y por tramo de distancia", () => {
    const stats = computePricingGameStats([
      row({ packagePreset: "letter", distanceKm: 20 }),
      row({ packagePreset: "fragile", distanceKm: 100 }),
      row({ packagePreset: "fragile", distanceKm: 800 }),
      row({ packagePreset: null, distanceKm: null }),
    ]);

    expect(Object.keys(stats.byPackage).sort()).toEqual(["fragile", "letter"]);
    expect(stats.byPackage.fragile.sessions).toBe(2);
    expect(stats.byDistance.lt100.sessions).toBe(1);
    expect(stats.byDistance["100to500"].sessions).toBe(1);
    expect(stats.byDistance.gte500).toMatchObject({ label: "≥ 500 km", sessions: 1 });
  });
});
