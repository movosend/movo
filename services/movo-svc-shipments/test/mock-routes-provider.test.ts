import { describe, it, expect } from "vitest";
import { createMockRoutesProvider } from "../src/adapters/mock-routes-provider";
import { decodePolyline } from "./polyline-decode";

describe("createMockRoutesProvider", () => {
  const provider = createMockRoutesProvider();
  const origin = { lat: -31.4201, lng: -64.1888 };
  const destination = { lat: -31.4135, lng: -64.1811 };

  it("devuelve un polyline decodificable cuyo primer y último punto son origen y destino", async () => {
    const result = await provider.getRoute({ origin, destination });
    const points = decodePolyline(result.polyline);

    expect(points[0].lat).toBeCloseTo(origin.lat, 4);
    expect(points[0].lng).toBeCloseTo(origin.lng, 4);
    expect(points[points.length - 1].lat).toBeCloseTo(destination.lat, 4);
    expect(points[points.length - 1].lng).toBeCloseTo(destination.lng, 4);
  });

  it("es determinístico: el mismo origen/destino da siempre el mismo resultado", async () => {
    const first = await provider.getRoute({ origin, destination });
    const second = await provider.getRoute({ origin, destination });
    expect(first).toEqual(second);
  });

  it("devuelve distancia y duración positivas", async () => {
    const result = await provider.getRoute({ origin, destination });
    expect(result.distanceMeters).toBeGreaterThan(0);
    expect(result.durationSeconds).toBeGreaterThan(0);
  });
});
