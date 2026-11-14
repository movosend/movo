import { useEffect, useRef } from "react";
import type { RoutePoint } from "../lib/route-geometry";
import { splitRoute } from "../lib/route-geometry";

/** Distancia a la línea del tramo al retiro a partir de la cual se pide una ruta nueva. */
export const APPROACH_REFRESH_OFF_ROUTE_M = 150;
/** Entre un pedido y el siguiente, como mínimo: el backend factura cada ruta nueva (ADR-015). */
export const APPROACH_REFRESH_MIN_INTERVAL_MS = 60_000;

/**
 * MOVO-359: la ruta del transportista al retiro se pide una vez y el mapa la va recortando mientras el
 * auto avanza (`liveRouteLines`), sin pedir una por ping. Solo se vuelve a pedir si el auto se alejó de esa
 * línea (tomó otra calle, se desvió) o si todavía no hay ruta (el proveedor falló o la primera respuesta llegó sin posición reciente), y no más de una vez por minuto.
 */
export function useApproachRefresh(params: {
  /** Antes del retiro y con la posición del transportista a la vista. */
  active: boolean;
  /** El seguimiento ya respondió y no hay un pedido en curso: antes, un arreglo vacío no significa "sin ruta". */
  settled: boolean;
  approach: RoutePoint[];
  position: { lat: number; lng: number } | null;
  refetch: () => unknown;
}) {
  const { active, settled, approach, position, refetch } = params;
  const lastRequestedAt = useRef(0);
  const lat = position?.lat;
  const lng = position?.lng;

  useEffect(() => {
    if (!active || !settled || lat === undefined || lng === undefined) return;
    const offRoute =
      approach.length > 1 ? splitRoute(approach, { latitude: lat, longitude: lng }).offRouteMeters : Infinity;
    if (offRoute <= APPROACH_REFRESH_OFF_ROUTE_M) return;
    const now = Date.now();
    if (now - lastRequestedAt.current < APPROACH_REFRESH_MIN_INTERVAL_MS) return;
    lastRequestedAt.current = now;
    void refetch();
  }, [active, settled, approach, lat, lng, refetch]);
}
