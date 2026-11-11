import { estimateArrivalMinutes, liveArrivalEstimate } from "../src/lib/live-route-lines";
import { polylineLengthKm } from "../src/lib/polyline";

const P = (latitude: number, longitude: number) => ({ latitude, longitude });
// ~1,11 km por cada 0,01° de latitud.
const ROUTE = [P(-31.4, -64.2), P(-31.41, -64.2), P(-31.42, -64.2)];

describe("polylineLengthKm", () => {
  it("suma los tramos", () => {
    expect(polylineLengthKm(ROUTE)).toBeCloseTo(2.22, 1);
    expect(polylineLengthKm([])).toBe(0);
  });
});

describe("liveArrivalEstimate (MOVO-361)", () => {
  const base = { remaining: ROUTE, carrier: P(-31.4, -64.2), pickup: P(-31.3, -64.2), delivery: P(-31.42, -64.2) };

  it("en tránsito mide lo que falta sobre la ruta", () => {
    expect(liveArrivalEstimate({ ...base, phase: "delivery", viewer: "sender" })).toEqual({
      kind: "eta",
      target: "delivery",
      km: 2.2,
      minutes: estimateArrivalMinutes(2.2),
    });
  });

  it("sin ruta cae a la línea recta al destino", () => {
    const estimate = liveArrivalEstimate({ ...base, remaining: [], phase: "delivery", viewer: "receiver" });
    expect(estimate).toEqual(expect.objectContaining({ kind: "eta", target: "delivery", km: 2.2 }));
  });

  it("antes del retiro, el emisor ve la distancia al retiro y el receptor la etapa", () => {
    expect(liveArrivalEstimate({ ...base, phase: "pickup", viewer: "sender" })).toEqual(
      expect.objectContaining({ kind: "eta", target: "pickup", km: 11.1 }),
    );
    expect(liveArrivalEstimate({ ...base, phase: "pickup", viewer: "receiver" })).toEqual(
      expect.objectContaining({ kind: "stage" }),
    );
  });

  it("sin posición no inventa una llegada", () => {
    expect(liveArrivalEstimate({ ...base, carrier: null, phase: "delivery", viewer: "sender" })).toEqual({ kind: "unknown" });
  });
});

describe("estimateArrivalMinutes", () => {
  it("~2 min por km, con piso", () => {
    expect(estimateArrivalMinutes(0.1)).toBe(2);
    expect(estimateArrivalMinutes(1)).toBe(3);
    expect(estimateArrivalMinutes(10)).toBe(20);
  });
});
