import { cumulativeFractions, simplifyPolyline } from "../src/lib/polyline";

const p = (latitude: number, longitude: number) => ({ latitude, longitude });

describe("simplifyPolyline", () => {
  it("saca los puntos colineales y conserva los extremos", () => {
    const line = [p(0, 0), p(0, 1), p(0, 2), p(0, 3), p(0, 4)];
    expect(simplifyPolyline(line, 0.01)).toEqual([p(0, 0), p(0, 4)]);
  });

  it("conserva los puntos que se desvían más que la tolerancia", () => {
    const corner = [p(0, 0), p(0, 5), p(5, 5)];
    expect(simplifyPolyline(corner, 0.01)).toEqual(corner);
  });

  it("descarta un desvío menor que la tolerancia", () => {
    const wobble = [p(0, 0), p(0.001, 5), p(0, 10)];
    expect(simplifyPolyline(wobble, 0.01)).toEqual([p(0, 0), p(0, 10)]);
  });

  it("no toca un trazo de dos puntos ni con tolerancia 0", () => {
    const two = [p(0, 0), p(1, 1)];
    expect(simplifyPolyline(two, 0.5)).toBe(two);
    const three = [p(0, 0), p(0, 1), p(0, 2)];
    expect(simplifyPolyline(three, 0)).toBe(three);
  });
});

describe("cumulativeFractions", () => {
  it("va de 0 a 1 proporcional a la distancia recorrida", () => {
    const fractions = cumulativeFractions([p(0, 0), p(0, 1), p(0, 4)]);
    expect(fractions[0]).toBe(0);
    expect(fractions[1]).toBeCloseTo(0.25, 5);
    expect(fractions[2]).toBe(1);
  });

  it("con puntos repetidos reparte parejo en vez de dividir por cero", () => {
    expect(cumulativeFractions([p(1, 1), p(1, 1), p(1, 1)])).toEqual([0, 0.5, 1]);
  });

  it("trazo vacío", () => {
    expect(cumulativeFractions([])).toEqual([]);
  });
});
