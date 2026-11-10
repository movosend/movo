import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { getCurrentLocation, watchForegroundLocation } from "../lib/location";
import { shipmentsClient, type CarrierRoute } from "../api/shipments-client";
import { friendlyErrorMessage } from "../lib/error-messages";
import { useAuthStore } from "../store/auth-store";

export interface UseOptimizedRouteResult {
  route: CarrierRoute | null;
  carrierLocation: { lat: number; lng: number } | null;
  isLoading: boolean;
  isRefreshing: boolean;
  gpsPermissionDenied: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook para la gestión de la ruta optimizada multi-parada del transportista (MOVO-207).
 *
 * AC8: Obtiene la ubicación actual del dispositivo vía GPS en foreground. Si el permiso
 * fue denegado o el GPS está inactivo, marca `gpsPermissionDenied: true` sin mandar
 * coordenadas ficticias.
 *
 * AC7: Se recálcula automáticamente cuando la pantalla gana foco (`useFocusEffect`),
 * garantizando que si el transportista completó o canceló una parada en un wizard,
 * al regresar a la vista de ruta las paradas restantes se actualicen de inmediato.
 *
 * Feedback de TestFlight build 18 ("cada vez que entro dice calculando la mejor ruta" y "no se
 * actualiza mi posición"): la última ruta de cada viaje queda en memoria y se muestra al volver a
 * entrar mientras se refresca en silencio (la pantalla de carga queda para la primera vez), y con la
 * pantalla enfocada la posición del transportista sigue al GPS (`watchForegroundLocation`), no solo
 * a cada pedido de la ruta.
 */
type LatLng = { lat: number; lng: number };

/** Última ruta por usuario y viaje (viaje `""` = la ruta del día), para no volver a la pantalla de carga.
 * Va con el usuario en la clave: otra cuenta en el mismo teléfono no ve las paradas de la anterior. */
const lastRouteByTrip = new Map<string, { route: CarrierRoute; location: LatLng }>();

/** Solo para tests: el cache es del módulo y sobrevive entre casos. */
export function clearOptimizedRouteCache(): void {
  lastRouteByTrip.clear();
}

export function useOptimizedRoute(tripId?: string): UseOptimizedRouteResult {
  const userId = useAuthStore((s) => s.user?.userId ?? "");
  const cacheKey = `${userId}:${tripId ?? ""}`;
  const cached = lastRouteByTrip.get(cacheKey);
  const [route, setRoute] = useState<CarrierRoute | null>(cached?.route ?? null);
  const [carrierLocation, setCarrierLocation] = useState<LatLng | null>(cached?.location ?? null);
  const [isLoading, setIsLoading] = useState<boolean>(!cached);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [gpsPermissionDenied, setGpsPermissionDenied] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef<number>(0);
  // Si la ruta en pantalla salió de este montaje o solo del cache: un error sobre una del cache no la
  // sostiene (el viaje pudo terminar o cancelarse desde la última visita).
  const fetchedRef = useRef<boolean>(false);
  // Último rumbo del seguimiento en primer plano (MOVO-357). Se borra al perder foco: uno de una visita
  // anterior puede no ser el de ahora.
  const headingRef = useRef<number | undefined>(undefined);

  const fetchRoute = useCallback(async (isRefresh = false) => {
    const requestId = ++requestSeqRef.current;
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const locResult = await getCurrentLocation();
      if (requestId !== requestSeqRef.current) return;
      if (!locResult.granted) {
        setGpsPermissionDenied(true);
        setRoute(null);
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      setGpsPermissionDenied(false);
      const coords = { lat: locResult.lat, lng: locResult.lng };
      setCarrierLocation(coords);

      // MOVO-357: el rumbo va a Google para que la ruta no arranque con una vuelta en U. El del fix
      // recién pedido, o si no lo trae (quieto o sin rumbo), el último del seguimiento de esta visita.
      const heading = locResult.heading ?? headingRef.current;
      const query = heading === undefined ? coords : { ...coords, heading };
      const result = tripId
        ? await shipmentsClient.getMyRoute(query, tripId)
        : await shipmentsClient.getMyRoute(query);
      if (requestId !== requestSeqRef.current) return;
      setRoute(result);
      fetchedRef.current = true;
      lastRouteByTrip.set(cacheKey, { route: result, location: coords });
    } catch (err: unknown) {
      if (requestId !== requestSeqRef.current) return;
      lastRouteByTrip.delete(cacheKey);
      // En un refresh en background, preservar la ruta ya confirmada en esta visita para no dejar la
      // pantalla vacía; la que vino solo del cache se descarta.
      if (!isRefresh || !fetchedRef.current) setRoute(null);
      setError(friendlyErrorMessage(err, "No pudimos calcular tu ruta optimizada. Intentá de nuevo."));
    } finally {
      if (requestId === requestSeqRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [tripId, cacheKey]);

  // AC7: Refrescar la ruta automáticamente al ganar foco (ej: al volver de completar una parada).
  // isRefresh=true: el primer render ya inicia con isLoading=true; los refrescos por foco son silenciosos.
  useFocusEffect(
    useCallback(() => {
      void fetchRoute(true);
      let stopWatching: (() => void) | null = null;
      let cancelled = false;
      void watchForegroundLocation(({ lat, lng, heading }) => {
        if (heading !== undefined) headingRef.current = heading;
        setCarrierLocation({ lat, lng });
      }).then((stop) => {
        if (cancelled) stop();
        else stopWatching = stop;
      });
      return () => {
        // Invalidar petición en vuelo si la pantalla pierde foco
        requestSeqRef.current++;
        cancelled = true;
        headingRef.current = undefined;
        stopWatching?.();
      };
    }, [fetchRoute])
  );

  const refetch = useCallback(async () => {
    await fetchRoute(true);
  }, [fetchRoute]);

  return {
    route,
    carrierLocation,
    isLoading,
    isRefreshing,
    gpsPermissionDenied,
    error,
    refetch,
  };
}
