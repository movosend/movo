import { useInvalidateOnPushOrForeground } from "./use-invalidate-on-push-or-foreground";
import { TRIPS_LIST_QUERY_KEY } from "./use-trips";

/** Pushes que pueden dejar a un viaje del transportista sin paquetes (el backend ya lo
 * expira en la misma transacción): el emisor canceló el envío. */
const TRIP_CHANGING_PUSH_TYPES: readonly string[] = ["shipment_cancelled"];

/**
 * Mantiene al día los viajes de Inicio cuando el cambio lo hace otra persona. Sin esto,
 * cuando el emisor cancelaba el único envío de un viaje en curso, la card "Estoy
 * transportando" seguía mostrando el viaje con 0 paquetes hasta que algo refrescara la
 * query (feedback de TestFlight, build 17).
 */
export function useTripsSync(): void {
  useInvalidateOnPushOrForeground(TRIPS_LIST_QUERY_KEY, TRIP_CHANGING_PUSH_TYPES);
}
