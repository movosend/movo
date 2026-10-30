import { splitRoute, type RoutePoint } from "../src/lib/route-geometry";

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
