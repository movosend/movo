import { useInvalidateOnPushOrForeground } from "./use-invalidate-on-push-or-foreground";
import { TRIPS_LIST_QUERY_KEY } from "./use-trips";

/** Pushes que pueden cerrar un viaje del transportista (el backend lo hace en la misma
 * transacción): el emisor canceló el envío, o se abrió una disputa sobre su último paquete. La resolución también:
 * saca al envío de los paquetes del viaje que todavía cuentan. */
const TRIP_CHANGING_PUSH_TYPES: readonly string[] = ["shipment_cancelled", "dispute_opened", "dispute_resolved"];

const TRIPS_SYNC_QUERY_KEYS = [TRIPS_LIST_QUERY_KEY] as const;

/**
 * Mantiene al día los viajes de Inicio cuando el cambio lo hace otra persona. Sin esto,
 * cuando el emisor cancelaba el único envío de un viaje en curso, la card "Estoy
 * transportando" seguía mostrando el viaje con 0 paquetes hasta que algo refrescara la
 * query (feedback de TestFlight, build 17).
 */
export function useTripsSync(): void {
  useInvalidateOnPushOrForeground(TRIPS_SYNC_QUERY_KEYS, TRIP_CHANGING_PUSH_TYPES);
}
