import { liveRouteLines } from "../src/lib/live-route-lines";

const p = (latitude: number, longitude: number) => ({ latitude, longitude });
// Ruta recta hacia el este, sobre el mismo paralelo.
const PLANNED = [p(-31.4, -64.2), p(-31.4, -64.19), p(-31.4, -64.18), p(-31.4, -64.17)];

describe("liveRouteLines (feedback de TestFlight build 18)", () => {
  it("antes del retiro devuelve la ruta entera y ningún recorrido, aunque el vehículo esté lejos", () => {
    const lines = liveRouteLines({ phase: "pickup", planned: PLANNED, trace: [p(-31.3, -64.3)], carrier: p(-31.3, -64.3) });
    expect(lines.remaining).toEqual(PLANNED);
    expect(lines.trace).toEqual([]);
  });

  it("en camino, sobre la ruta, lo que falta arranca en el vehículo y el recorrido termina en él", () => {
    const carrier = p(-31.4, -64.185);
    const lines = liveRouteLines({ phase: "delivery", planned: PLANNED, trace: [p(-31.4, -64.2)], carrier });
    expect(lines.remaining[0]).toEqual(carrier);
    expect(lines.remaining.at(-1)).toEqual(PLANNED.at(-1));
    expect(lines.trace).toEqual([p(-31.4, -64.2), carrier]);
    expect(lines.segment).toBe(1);
  });

  it("en camino, lejos de la ruta, lo que falta arranca en la proyección: sin recta desde el vehículo", () => {
    const carrier = p(-31.39, -64.185); // ~1,1 km al norte
    const lines = liveRouteLines({ phase: "delivery", planned: PLANNED, trace: [], carrier });
    expect(lines.remaining[0]).not.toEqual(carrier);
    expect(lines.remaining[0].latitude).toBeCloseTo(-31.4, 6);
  });

  it("respeta startSegment: no vuelve a un tramo anterior", () => {
    const loop = [p(-31.4, -64.2), p(-31.4, -64.19), p(-31.41, -64.19), p(-31.41, -64.2), p(-31.4001, -64.2)];
    const lines = liveRouteLines({ phase: "delivery", planned: loop, trace: [], carrier: p(-31.4001, -64.1999), startSegment: 3 });
    expect(lines.segment).toBe(3);
  });
});
