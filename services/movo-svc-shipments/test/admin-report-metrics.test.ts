import { describe, expect, it } from "vitest";
import { distancesReport, ShipmentMetricFact } from "../src/domain/admin-report-metrics";

const RANGE = { from: "2026-10-01", to: "2026-10-02" };
const NOW = new Date("2026-10-03T12:00:00.000Z");

const fact = (overrides: Partial<ShipmentMetricFact>): ShipmentMetricFact => ({
  band: null,
  distanceKm: null,
  agreedPriceArs: null,
  publishedAt: "2026-10-01T15:00:00.000Z",
  firstAssignedAt: null,
  pickedUpAt: null,
  firstCompletedAt: null,
  deliveredAt: null,
  deliveryDeadline: null,
  pickupDeadline: null,
  anomalyFlagged: false,
  hasDispute: false,
  pickupCity: "Córdoba",
  deliveryCity: "Rosario",
  pickupLat: -31.42,
  pickupLng: -64.18,
  deliveryLat: -32.95,
  deliveryLng: -60.64,
  ...overrides,
});

describe("corredores de Distancias", () => {
  it("sin ninguna distancia guardada, estima la ruta en vez de mostrar 0 km en el tramo más corto", () => {
    const facts = [fact({})];
    const [corridor] = distancesReport(facts, facts, RANGE, NOW).corridors;

    expect(corridor?.distanceKm).toBeGreaterThan(400);
    expect(corridor?.band).toBe("200_500");
  });

  it("con distancias guardadas usa su promedio y no la estimación", () => {
    const facts = [fact({ distanceKm: 380, band: "200_500" }), fact({ distanceKm: null })];
    const [corridor] = distancesReport(facts, facts, RANGE, NOW).corridors;

    expect(corridor?.distanceKm).toBe(380);
  });
});
