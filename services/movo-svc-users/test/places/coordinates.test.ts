import { describe, expect, it } from "vitest";
import { formatCoordinates, parseCoordinates } from "../../src/modules/places/coordinates";

describe("parseCoordinates (MOVO-340)", () => {
  it.each([
    ["-31.4201, -64.1888"],
    ["-31.4201,-64.1888"],
    ["-31.4201 -64.1888"],
    ["  -31.4201 ,  -64.1888  "],
  ])("acepta el formato decimal %j", (input) => {
    expect(parseCoordinates(input)).toEqual({ lat: -31.4201, long: -64.1888 });
  });

  it("acepta grados, minutos y segundos como los copia Google Maps", () => {
    expect(parseCoordinates(`31°25'12.4"S 64°11'19.7"W`)).toEqual({ lat: -31.420111, long: -64.188806 });
  });

  it.each([
    [`31°25'12.4"S, 64°11'19.7"W`],
    [`31° 25' 12.4" S 64° 11' 19.7" W`],
    [`31°25′12.4″S 64°11′19.7″W`],
    [`31°25'12.4''S 64°11'19.7''W`],
    [`31°25'12.4"s 64°11'19.7"o`],
    [`64°11'19.7"W 31°25'12.4"S`],
  ])("acepta la variante en grados %j", (input) => {
    expect(parseCoordinates(input)).toEqual({ lat: -31.420111, long: -64.188806 });
  });

  it("acepta grados y minutos sin segundos", () => {
    expect(parseCoordinates(`31°30'S 64°15'W`)).toEqual({ lat: -31.5, long: -64.25 });
  });

  it("acepta los bordes del rango", () => {
    expect(parseCoordinates("90, 180")).toEqual({ lat: 90, long: 180 });
    expect(parseCoordinates("-90 -180")).toEqual({ lat: -90, long: -180 });
  });

  it.each([["90.0001, 0"], ["0, 180.5"], ["-91 10"], [`91°0'0"N 10°0'0"E`], [`31°60'0"S 64°0'0"W`]])(
    "devuelve null fuera de rango (%j)",
    (input) => {
      expect(parseCoordinates(input)).toBeNull();
    }
  );

  it.each([
    ["Av. Colón 1234"],
    ["Colón 1234, Córdoba"],
    ["1234 5678"],
    ["-31.4201"],
    ["-31.4201, -64.1888, 10"],
    [`31°25'12.4"S 64°11'19.7"N`],
    ["Ruta 9 km 5"],
  ])("devuelve null para %j, que no es una coordenada", (input) => {
    expect(parseCoordinates(input)).toBeNull();
  });

  it("formatCoordinates arma la etiqueta de un punto sin dirección", () => {
    expect(formatCoordinates({ lat: -31.4201, long: -64.1888 })).toBe("-31.4201, -64.1888");
  });
});
