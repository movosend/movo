import {
  CARRIER_ON_ROUTE_METERS,
  carrierRouteLine,
  routeUntilStop,
  splitRoute,
  type RoutePoint,
} from "../src/lib/route-geometry";

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

describe("carrierRouteLine (MOVO-357)", () => {
  // Sobre el ecuador, 0.001° ≈ 111 m. La ruta va al este, da la vuelta en U y vuelve por la misma
  // calle hasta x=0.001, y de ahí sigue al norte: el "va, vuelve y gira" de la captura.
  const uTurn = [p(0, 0), p(0, 0.003), p(0.00005, 0.003), p(0.00005, 0.001), p(0.003, 0.001)];

  it("cerca de la línea arranca en la proyección, sin recta desde el auto", () => {
    const carrier = p(0.0002, 0.0015); // ~22 m al norte de la calle
    const line = carrierRouteLine([p(0, 0), p(0, 0.003)], carrier);

    expect(line.points[0]).toEqual(p(0, 0.0015));
    expect(line.points).not.toContainEqual(carrier);
    expect(line.segment).toBe(0);
  });

  it("lejos de la línea deja la recta y no avanza el tramo", () => {
    const carrier = p(0.0015, 0.0015); // ~166 m: otra calle
    const line = carrierRouteLine([p(0, 0), p(0, 0.003)], carrier, 0);

    expect(line.points[0]).toEqual(carrier);
    expect(line.points[1]).toEqual(p(0, 0.0015));
    expect(line.segment).toBe(0);
    expect(CARRIER_ON_ROUTE_METERS).toBeLessThan(166);
  });

  it("con el tramo guardado, el auto en la vuelta no salta a la ida y no conserva el giro", () => {
    // Primera posición: ya pasó el giro y va por la vuelta hacia el oeste (tramo 2: la ida es el 0 y el
    // giro el 1). La ida y la vuelta están igual de cerca: el rumbo decide.
    const first = carrierRouteLine(uTurn, p(0.00005, 0.002), 0, 270);
    expect(first.segment).toBe(2);

    // Siguiente posición, sobre la calle compartida: la ida (tramo 0) queda más cerca, pero no se vuelve.
    const second = carrierRouteLine(uTurn, p(0.00002, 0.0015), first.segment);
    expect(second.segment).toBe(2);
    expect(second.points).not.toContainEqual(p(0, 0.003));
    expect(second.points.at(-1)).toEqual(p(0.003, 0.001));
  });

  it("en la ida y cerca de la vuelta no salta para adelante, con rumbo o sin él (review de la #336)", () => {
    // ~4 m al norte de la ida y ~1 m de la vuelta: ruido normal del GPS antes de hacer el giro.
    const carrier = p(0.00004, 0.0015);
    expect(splitRoute(uTurn, carrier).segment).toBe(2);

    const withoutHeading = carrierRouteLine(uTurn, carrier);
    expect(withoutHeading.segment).toBe(0);
    expect(withoutHeading.points).toContainEqual(p(0, 0.003));

    const headingEast = carrierRouteLine(uTurn, carrier, 0, 90);
    expect(headingEast.segment).toBe(0);
    expect(headingEast.points).toContainEqual(p(0.00005, 0.003));
  });

  it("después de la vuelta en U, el rumbo lo pasa a la vuelta aunque la ida esté igual de cerca", () => {
    const carrier = p(0.00003, 0.0015);
    expect(carrierRouteLine(uTurn, carrier, 0).segment).toBe(0);
    expect(carrierRouteLine(uTurn, carrier, 0, 265).segment).toBe(2);
  });

  it("sin tramo guardado, el mismo punto cae en la ida y arrastra el giro entero (el bug)", () => {
    const line = splitRoute(uTurn, p(0.00002, 0.0015));
    expect(line.segment).toBe(0);
    expect(line.todo).toContainEqual(p(0, 0.003));
  });

  it("sin posición o sin ruta devuelve la ruta tal cual", () => {
    expect(carrierRouteLine(uTurn, null, 2)).toEqual({ points: uTurn, segment: 2 });
    expect(carrierRouteLine([], p(0, 0))).toEqual({ points: [], segment: 0 });
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
