import { describe, it, expect, vi } from "vitest";
import { quoteShipment, ShipmentQuoteInput } from "../src/modules/shipments/shipment-quote";
import { createFakePricingClient } from "./fake-pricing-client";
import { createFakeTripRepository } from "./fake-trip-repository";

const input: ShipmentQuoteInput = {
  weightKg: 3,
  lengthCm: 30,
  widthCm: 20,
  heightCm: 15,
  packageType: "standard_package",
  originLat: -31.4167,
  originLng: -64.1833,
  destinationLat: -32.4075,
  destinationLng: -63.2403,
};

const NOW = new Date("2026-09-26T12:00:00.000Z");

function deps(overrides: Partial<Parameters<typeof quoteShipment>[0]> = {}) {
  return {
    pricingClient: createFakePricingClient(),
    shipmentRepository: { countPublishedNearPickup: vi.fn().mockResolvedValue(9) },
    tripRepository: createFakeTripRepository({ countAvailableCarriersNear: vi.fn().mockResolvedValue(2) }),
    logger: { warn: vi.fn() },
    now: () => NOW,
    ...overrides,
  };
}

describe("quoteShipment (MOVO-138)", () => {
  it("cuenta la demanda en la zona de retiro y la manda como demandContext", async () => {
    const d = deps();

    const result = await quoteShipment(d, input);

    expect(d.shipmentRepository.countPublishedNearPickup).toHaveBeenCalledWith({
      lat: -31.4167,
      lng: -64.1833,
      radiusKm: 15,
    });
    expect(d.tripRepository.countAvailableCarriersNear).toHaveBeenCalledWith({
      lat: -31.4167,
      lng: -64.1833,
      radiusKm: 15,
      departureFrom: new Date("2026-09-26T06:00:00.000Z"), // -6 h
      departureTo: new Date("2026-09-29T12:00:00.000Z"), // +72 h
    });
    expect(d.pricingClient.getQuote).toHaveBeenCalledWith({
      ...input,
      demandContext: { publishedShipments: 9, availableCarriers: 2 },
    });
    expect(result.suggestedPriceArs).toBe(2256);
  });

  it("si el conteo falla, cotiza igual sin demandContext (sin recargo) y lo loguea", async () => {
    const d = deps({ shipmentRepository: { countPublishedNearPickup: vi.fn().mockRejectedValue(new Error("db down")) } });

    const result = await quoteShipment(d, input);

    expect(d.pricingClient.getQuote).toHaveBeenCalledWith(input);
    expect(d.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "pricing_demand_count_failed" }),
      expect.any(String)
    );
    expect(result.suggestedPriceArs).toBe(2256);
  });

  it("sin tripRepository no puede contar oferta: cotiza sin demandContext", async () => {
    const d = deps({ tripRepository: undefined });

    await quoteShipment(d, input);

    expect(d.shipmentRepository.countPublishedNearPickup).not.toHaveBeenCalled();
    expect(d.pricingClient.getQuote).toHaveBeenCalledWith(input);
  });

  it("sin coordenadas de retiro no cuenta demanda", async () => {
    const d = deps();
    const partial = { ...input, originLat: undefined };

    await quoteShipment(d, partial);

    expect(d.shipmentRepository.countPublishedNearPickup).not.toHaveBeenCalled();
    expect(d.pricingClient.getQuote).toHaveBeenCalledWith(partial);
  });

  it("sin pricingClient devuelve 'precio a estimar' sin contar nada", async () => {
    const d = deps({ pricingClient: undefined });

    const result = await quoteShipment(d, input);

    expect(result).toEqual({ suggestedPriceArs: null, calculationMethod: null, highDemand: null });
    expect(d.shipmentRepository.countPublishedNearPickup).not.toHaveBeenCalled();
  });
});
