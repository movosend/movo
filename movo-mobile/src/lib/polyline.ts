/** Decodificador del algoritmo estándar de polyline de Google (5 decimales de
 * precisión) — implementado a mano en vez de sumar una dependencia por ~25 líneas de
 * aritmética estándar. Usado por `RouteMapCard` para dibujar el polyline que devuelve
 * `GET /shipments/route` (MOVO-123). Referencia del algoritmo:
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): Array<{ latitude: number; longitude: number }> {
  const points: Array<{ latitude: number; longitude: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return points;
}

type LatLngPoint = { latitude: number; longitude: number };

/**
 * Simplificación Douglas-Peucker (iterativa, sin recursión) de un trazo. Se usa solo para el
 * barrido animado de `RouteMapCard`: la línea de base conserva todos los puntos, así que el
 * detalle visible no cambia, pero la animación deja de copiar y reenviar al mapa nativo
 * miles de puntos por frame. La distancia se mide en grados con la longitud corregida por
 * latitud, suficiente a escala de ruta.
 */
export function simplifyPolyline(points: LatLngPoint[], toleranceDeg: number): LatLngPoint[] {
  const n = points.length;
  if (n <= 2 || toleranceDeg <= 0) return points;

  const lngScale = Math.cos((points[0].latitude * Math.PI) / 180);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    const ax = points[start].longitude * lngScale;
    const ay = points[start].latitude;
    const dx = points[end].longitude * lngScale - ax;
    const dy = points[end].latitude - ay;
    const segLenSq = dx * dx + dy * dy;

    let maxDist = 0;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const px = points[i].longitude * lngScale - ax;
      const py = points[i].latitude - ay;
      let dist: number;
      if (segLenSq === 0) {
        dist = Math.hypot(px, py);
      } else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / segLenSq));
        dist = Math.hypot(px - t * dx, py - t * dy);
      }
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxIdx !== -1 && maxDist > toleranceDeg) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const result: LatLngPoint[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) result.push(points[i]);
  return result;
}

/**
 * Largo acumulado normalizado (0 en el primer punto, 1 en el último) de cada punto del trazo.
 * Permite que el barrido avance a velocidad constante por distancia y no por cantidad de
 * puntos (un trazo tiene muchos puntos en las curvas y pocos en las rectas).
 */
export function cumulativeFractions(points: LatLngPoint[]): number[] {
  const n = points.length;
  if (n === 0) return [];
  const lngScale = Math.cos((points[0].latitude * Math.PI) / 180);
  const cumulative = new Array<number>(n);
  cumulative[0] = 0;
  for (let i = 1; i < n; i++) {
    cumulative[i] =
      cumulative[i - 1] +
      Math.hypot(
        (points[i].longitude - points[i - 1].longitude) * lngScale,
        points[i].latitude - points[i - 1].latitude,
      );
  }
  const total = cumulative[n - 1];
  if (total === 0) return cumulative.map((_, i) => i / Math.max(1, n - 1));
  return cumulative.map((value) => value / total);
}
