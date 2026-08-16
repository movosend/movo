import type { RouteLatLng } from "../adapters/routes-provider";

/**
 * Codificador del algoritmo de polyline de Google (5 decimales de precisión) —
 * implementado a mano en vez de sumar una dependencia nueva por ~20 líneas de
 * aritmética estándar y sin mantenimiento. Usado únicamente por `mock-routes-provider`
 * para devolver un polyline con el mismo formato que la Google Routes API real, así el
 * cliente decodifica igual sin importar el provider activo. Referencia del algoritmo:
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function encodePolyline(points: RouteLatLng[]): string {
  let output = "";
  let prevLat = 0;
  let prevLng = 0;

  for (const point of points) {
    const lat = Math.round(point.lat * 1e5);
    const lng = Math.round(point.lng * 1e5);
    output += encodeSignedNumber(lat - prevLat);
    output += encodeSignedNumber(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }

  return output;
}

function encodeSignedNumber(num: number): string {
  let sgnNum = num << 1;
  if (num < 0) sgnNum = ~sgnNum;
  return encodeNumber(sgnNum);
}

function encodeNumber(num: number): string {
  let output = "";
  while (num >= 0x20) {
    output += String.fromCharCode((0x20 | (num & 0x1f)) + 63);
    num >>= 5;
  }
  output += String.fromCharCode(num + 63);
  return output;
}
