import { routeUntilStop, splitRoute, type RoutePoint } from "../src/lib/route-geometry";

// MOVO-346: mismos casos que `geometry.test.ts` del panel (MOVO-328), sobre puntos de react-native-maps.
const p = (latitude: number, longitude: number): RoutePoint => ({ latitude, longitude });

describe("splitRoute", () => {
  const route = [p(0, 0), p(0, 1), p(0, 2), p(0, 3)];

  it("arranca lo que falta en el vehículo y conserva la esquina pendiente", () => {
    const split = splitRoute(route, p(0.01, 1.1));

    expect(split.todo).toEqual([p(0.01, 1.1), p(0, 1.1), p(0, 2), p(0, 3)]);
    expect(split.done).toEqual([p(0, 0), p(0, 1), p(0, 1.1)]);
    expect(split.segment).toBe(1);
    expect(Math.round(split.offRouteMeters / 100)).toBe(11);
  });

  it("no retrocede cuando la ruta vuelve a pasar cerca de un tramo anterior", () => {
    const loop = [p(0, 0), p(0, 1), p(1, 1), p(1, 0), p(0.01, 0)];

    const split = splitRoute(loop, p(0.01, 0.02), 2);

    expect(split.segment).toBe(3);
    expect(split.todo.at(-1)).toEqual(p(0.01, 0));
  });

  it("sin posición devuelve la ruta entera como pendiente", () => {
    expect(splitRoute(route, null).todo).toEqual(route);
  });

  it("sin ruta devuelve vacío", () => {
    expect(splitRoute([], p(0, 0))).toEqual({ done: [], todo: [], segment: 0, offRouteMeters: 0 });
  });
});

describe("routeUntilStop", () => {
  // Ruta de oeste a este sobre el ecuador (~111 m por 0.001°) que vuelve en lazo a pasar por x=0.002.
  const route = [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 0.001 },
    { latitude: 0, longitude: 0.002 },
    { latitude: 0, longitude: 0.003 },
    { latitude: 0.001, longitude: 0.003 },
    { latitude: 0.001, longitude: 0.002 },
    { latitude: 0.00006, longitude: 0.002 },
  ];

  it("corta en el primer paso por la parada aunque más adelante pase más cerca", () => {
    const stop = { latitude: 0.00005, longitude: 0.002 };
    expect(routeUntilStop(route, stop)).toEqual(route.slice(0, 3));
  });

  it("queda vacío con el vehículo ya en la parada", () => {
    expect(routeUntilStop(route, { latitude: 0, longitude: 0.0001 })).toEqual([]);
  });

  it("no corta en el vértice 0 cuando la parada está adelante", () => {
    const stop = { latitude: 0, longitude: 0.001 };
    expect(routeUntilStop(route, stop)).toEqual(route.slice(0, 2));
  });
});
