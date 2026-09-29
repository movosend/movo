import { describe, it, expect } from "vitest";
import { ShipmentQuoteRequest } from "@movo/shared";
import { quoteFingerprint } from "../src/modules/shipments/quote-store";

const input: ShipmentQuoteRequest = {
  packageType: "standard_package",
  weightKg: 3,
  lengthCm: 30,
  widthCm: 20,
  heightCm: 15,
  pickupLat: -31.4201,
  pickupLng: -64.1888,
  deliveryLat: -32.4104,
  deliveryLng: -63.2404,
};

describe("quoteFingerprint (MOVO-255)", () => {
  it("es estable para los mismos datos", () => {
    expect(quoteFingerprint({ ...input })).toBe(quoteFingerprint(input));
  });

  it("tolera ruido de float por debajo de 6 decimales en las coordenadas", () => {
    expect(quoteFingerprint({ ...input, pickupLat: -31.42010000000001 })).toBe(quoteFingerprint(input));
  });

  it.each([
    ["packageType", { packageType: "fragile_item" as const }],
    ["weightKg", { weightKg: 3.5 }],
    ["lengthCm", { lengthCm: 31 }],
    ["widthCm", { widthCm: 21 }],
    ["heightCm", { heightCm: 16 }],
    ["pickupLat", { pickupLat: -31.4202 }],
    ["pickupLng", { pickupLng: -64.1889 }],
    ["deliveryLat", { deliveryLat: -32.4105 }],
    ["deliveryLng", { deliveryLng: -63.2405 }],
  ])("cambia si cambia %s", (_field, patch) => {
    expect(quoteFingerprint({ ...input, ...patch })).not.toBe(quoteFingerprint(input));
  });
});
