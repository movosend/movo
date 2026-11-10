import { estimateArrivalMinutes, liveArrivalEstimate, liveRouteLines } from "../src/lib/live-route-lines";
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

// MOVO-359: antes del retiro, la ruta del vehículo al retiro al frente de la planificada.
describe("liveRouteLines antes del retiro con ruta al retiro", () => {
  // Del vehículo (-31.45) al retiro (-31.40), y de ahí a la entrega (-31.30), sobre el mismo meridiano.
  const APPROACH = [P(-31.45, -64.2), P(-31.43, -64.2), P(-31.4, -64.2)];
  const PLANNED = [P(-31.4, -64.2), P(-31.35, -64.2), P(-31.3, -64.2)];

  it("dibuja una sola línea: lo que falta del tramo al retiro y después la planificada", () => {
    const lines = liveRouteLines({ phase: "pickup", planned: PLANNED, trace: [], carrier: P(-31.45, -64.2), approach: APPROACH });

    expect(lines.trace).toEqual([]);
    expect(lines.toPickup[0]).toEqual(P(-31.45, -64.2));
    expect(lines.remaining.slice(-PLANNED.length)).toEqual(PLANNED);
    expect(lines.remaining).toHaveLength(lines.toPickup.length + PLANNED.length);
  });

  it("al avanzar el auto recorta el tramo al retiro, sin tocar la planificada", () => {
    const start = liveRouteLines({ phase: "pickup", planned: PLANNED, trace: [], carrier: P(-31.45, -64.2), approach: APPROACH });
    const moved = liveRouteLines({
      phase: "pickup",
      planned: PLANNED,
      trace: [],
      carrier: P(-31.425, -64.2),
      approach: APPROACH,
      startSegment: start.segment,
    });

    expect(polylineLengthKm(moved.toPickup)).toBeLessThan(polylineLengthKm(start.toPickup));
    expect(moved.remaining.slice(-PLANNED.length)).toEqual(PLANNED);
    expect(moved.segment).toBe(1);
  });

  it("lejos de la línea no los une con una recta: arranca en la proyección", () => {
    const lines = liveRouteLines({ phase: "pickup", planned: PLANNED, trace: [], carrier: P(-31.43, -64.19), approach: APPROACH });

    expect(lines.toPickup[0]).not.toEqual(P(-31.43, -64.19));
  });

  it("sin ruta al retiro (falló el proveedor) o sin posición, la planificada entera como antes", () => {
    expect(liveRouteLines({ phase: "pickup", planned: PLANNED, trace: [], carrier: P(-31.45, -64.2) })).toEqual({
      remaining: PLANNED,
      trace: [],
      segment: 0,
      toPickup: [],
    });
    expect(liveRouteLines({ phase: "pickup", planned: PLANNED, trace: [], carrier: null, approach: APPROACH }).remaining).toEqual(
      PLANNED,
    );
  });

  it("en camino a la entrega ignora el tramo al retiro", () => {
    const lines = liveRouteLines({ phase: "delivery", planned: PLANNED, trace: [], carrier: P(-31.38, -64.2), approach: APPROACH });

    expect(lines.toPickup).toEqual([]);
    expect(lines.remaining.slice(-1)).toEqual([P(-31.3, -64.2)]);
  });
});

describe("liveArrivalEstimate al retiro con ruta por calle", () => {
  const carrier = P(-31.45, -64.2);
  const pickup = P(-31.4, -64.2);
  // Un rodeo: 3 km por calle para ~5,6 km... al revés, más corta que la recta es imposible; esta es más larga.
  const toPickup = [P(-31.45, -64.2), P(-31.45, -64.15), P(-31.4, -64.15), P(-31.4, -64.2)];

  it("el emisor ve los km de la ruta por calle, no la recta", () => {
    const estimate = liveArrivalEstimate({ phase: "pickup", viewer: "sender", remaining: [], toPickup, carrier, pickup, delivery: null });

    expect(estimate).toEqual(expect.objectContaining({ kind: "eta", target: "pickup" }));
    expect((estimate as { km: number }).km).toBeCloseTo(polylineLengthKm(toPickup), 1);
    expect((estimate as { km: number }).km).toBeGreaterThan(polylineLengthKm([carrier, pickup]));
  });

  it("sin ruta por calle cae a la recta, y el receptor sigue sin ver la llegada al retiro", () => {
    expect(liveArrivalEstimate({ phase: "pickup", viewer: "sender", remaining: [], carrier, pickup, delivery: null })).toEqual(
      expect.objectContaining({ kind: "eta", km: 5.6 }),
    );
    expect(liveArrivalEstimate({ phase: "pickup", viewer: "receiver", remaining: [], toPickup, carrier, pickup, delivery: null })).toEqual(
      expect.objectContaining({ kind: "stage" }),
    );
  });
});
