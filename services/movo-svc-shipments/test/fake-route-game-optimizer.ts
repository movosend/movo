import { OptimizationStatus, OptimizeRouteRequest, OptimizeRouteResponse } from "@movo/shared";
import { routeCost } from "../src/domain/route-game";

const permutations = (items: number[]): number[][] =>
  items.length <= 1
    ? [items]
    : items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));

/**
 * Simula `POST /optimize/route` con `objective: distance` y `matrix`: fuerza bruta sobre
 * la matriz inyectada (con ≤ 7 paradas OR-Tools llega al mismo óptimo).
 */
export function bruteForceOptimize(input: OptimizeRouteRequest): OptimizeRouteResponse {
  if (!input.matrix) throw new Error("bruteForceOptimize: el juego siempre manda la matriz");
  const { matrix } = input;
  const n = input.stops.length;
  let best = { order: [] as number[], km: Infinity, min: 0 };
  for (const order of permutations(Array.from({ length: n }, (_, i) => i))) {
    const c = routeCost(matrix, order);
    if (c.km < best.km) best = { order, ...c };
  }
  return {
    stops: best.order.map((i, k) => ({
      stopOrder: k,
      shipmentId: input.stops[i].shipmentId,
      type: "delivery",
      lat: input.stops[i].lat,
      lng: input.stops[i].lng,
      estimatedArrivalMinutes: 0,
      outsideTimeWindow: false,
    })),
    totalDistanceKm: best.km,
    totalDurationMinutes: best.min,
    status: OptimizationStatus.OPTIMAL,
    calculationMethod: "precomputed_matrix_vrptw_v1",
    disclaimer: "",
  };
}

/** Matriz de un pool con distancias en línea recta (km) y 2 min por km. */
export function straightLineMatrix(pool: readonly (readonly [string, string, number, number])[]) {
  const km = (a: readonly number[], b: readonly number[]) =>
    Math.hypot((a[0] - b[0]) * 111, (a[1] - b[1]) * 111 * Math.cos((a[0] * Math.PI) / 180));
  const pts = pool.map(([, , lat, lng]) => [lat, lng]);
  const distKm = pts.map((a) => pts.map((b) => Math.round(km(a, b) * 1000) / 1000));
  return { distKm, timeMin: distKm.map((r) => r.map((v) => Math.ceil(v * 2))) };
}
