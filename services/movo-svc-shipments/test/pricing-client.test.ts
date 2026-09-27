import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PriceCalculationMethod } from "@movo/shared";
import { createPricingClient, QuoteInput } from "../src/adapters/pricing-client";

describe("PricingClient", () => {
  const originalFetch = globalThis.fetch;

  const completeInput: QuoteInput = {
    weightKg: 2,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    packageType: "standard_package",
    originLat: -31.4201,
    originLng: -64.1888,
    destinationLat: -31.4135,
    destinationLng: -64.181,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("pide el precio a POST /quote y devuelve el resultado (happy path)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          suggestedPriceArs: 2256,
          highDemand: false,
          calculationMethod: "demand_fuel_routes_v1",
        }),
    });
    globalThis.fetch = fetchMock;

    const client = createPricingClient({ PRICING_SERVICE_URL: "http://movo-svc-pricing-logistics:8000" });
    const result = await client.getQuote(completeInput);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://movo-svc-pricing-logistics:8000/quote");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      weightKg: 2,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      packageType: "standard_package",
      originLat: -31.4201,
      originLng: -64.1888,
      destinationLat: -31.4135,
      destinationLng: -64.181,
      urgent: false,
    });
    expect(result).toEqual({
      suggestedPriceArs: 2256,
      calculationMethod: PriceCalculationMethod.DEMAND_FUEL_ROUTES_V1,
      highDemand: false,
    });
  });

  it("MOVO-138: manda demandContext cuando viene y devuelve highDemand", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ suggestedPriceArs: 36220, highDemand: true, calculationMethod: "demand_fuel_routes_v1" }),
    });
    globalThis.fetch = fetchMock;

    const client = createPricingClient({ PRICING_SERVICE_URL: "http://movo-svc-pricing-logistics:8000" });
    const result = await client.getQuote({
      ...completeInput,
      demandContext: { publishedShipments: 9, availableCarriers: 2 },
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).demandContext).toEqual({
      publishedShipments: 9,
      availableCarriers: 2,
    });
    expect(result.highDemand).toBe(true);
  });

  it("MOVO-138: highDemand es null si pricing no lo informa (versión anterior desplegada)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestedPriceArs: 2256, calculationMethod: "euclidean_linear_v1" }),
    });

    const client = createPricingClient({ PRICING_SERVICE_URL: "http://movo-svc-pricing-logistics:8000" });
    const result = await client.getQuote(completeInput);

    expect(result).toEqual({
      suggestedPriceArs: 2256,
      calculationMethod: PriceCalculationMethod.EUCLIDEAN_LINEAR_V1,
      highDemand: null,
    });
  });

  it("AC7: no llama al servicio si faltan datos necesarios (peso/dimensiones/coordenadas/packageType)", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const client = createPricingClient({ PRICING_SERVICE_URL: "http://movo-svc-pricing-logistics:8000" });
    const result = await client.getQuote({ ...completeInput, weightKg: undefined });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ suggestedPriceArs: null, calculationMethod: null, highDemand: null });
  });

  it("AC6: devuelve el fallback (no lanza) si la respuesta no es ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    globalThis.fetch = fetchMock;

    const client = createPricingClient({ PRICING_SERVICE_URL: "http://movo-svc-pricing-logistics:8000" });
    const result = await client.getQuote(completeInput);

    expect(result).toEqual({ suggestedPriceArs: null, calculationMethod: null, highDemand: null });
  });

  it("AC6: devuelve el fallback (no lanza) ante un error de red/timeout", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    globalThis.fetch = fetchMock;

    const client = createPricingClient({ PRICING_SERVICE_URL: "http://movo-svc-pricing-logistics:8000" });
    const result = await client.getQuote(completeInput);

    expect(result).toEqual({ suggestedPriceArs: null, calculationMethod: null, highDemand: null });
  });

  it("AC6: devuelve el fallback (no lanza) si la respuesta es 200 pero el body no parsea como JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError("Unexpected token in JSON")),
    });
    globalThis.fetch = fetchMock;

    const client = createPricingClient({ PRICING_SERVICE_URL: "http://movo-svc-pricing-logistics:8000" });
    const result = await client.getQuote(completeInput);

    expect(result).toEqual({ suggestedPriceArs: null, calculationMethod: null, highDemand: null });
  });
});
