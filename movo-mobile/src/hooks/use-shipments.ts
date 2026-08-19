import { useInfiniteQuery, useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { shipmentsClient, type CreateShipmentInput, type ShipmentSummary } from "../api/shipments-client";

interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Últimos envíos propios para la sección "Actividad reciente" de Inicio (MOVO-83).
 * `limit: 3` — la home solo necesita una vista previa, no el listado completo (ese
 * queda para una pantalla de listado futura, fuera de este ticket).
 */
export function useRecentShipments() {
  return useQuery({
    queryKey: ["shipments", "mine", "recent"],
    queryFn: () => shipmentsClient.listMine({ page: 1, limit: 3 }),
  });
}

/** Crea un envío (wizard de MOVO-83). Invalida el preview de "Envíos recientes" de
 * Inicio y el listado completo de "Mis Envíos" (MOVO-127) para que el envío nuevo
 * aparezca en ambos sin esperar un refetch manual. */
export function useCreateShipment() {
  const queryClient = useQueryClient();
  return useMutation<ShipmentSummary, unknown, CreateShipmentInput>({
    mutationFn: (body) => shipmentsClient.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shipments", "mine", "recent"] });
      queryClient.invalidateQueries({ queryKey: ["shipments", "mine", "list"] });
    },
  });
}

/** Listado completo y paginado de "Mis Envíos" (MOVO-127) — a diferencia de
 * `useRecentShipments` (preview fijo de 3), acá se pagina de a `limit` con scroll
 * infinito. Query key propia, sin compartir cache con el preview de Home. */
export function useMyShipments(limit = 20) {
  return useInfiniteQuery({
    queryKey: ["shipments", "mine", "list"],
    queryFn: ({ pageParam }) => shipmentsClient.listMine({ page: pageParam, limit }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.limit < lastPage.total ? lastPage.page + 1 : undefined,
  });
}

/** Ruta real por calle entre origen y destino (MOVO-123) para el mapa del paso de
 * resumen del wizard — `enabled` solo cuando ambos puntos ya están definidos. */
export function useShipmentRoute(origin: LatLng | null, destination: LatLng | null) {
  return useQuery({
    queryKey: ["shipments", "route", origin, destination],
    queryFn: () => shipmentsClient.getRoute(origin!, destination!),
    enabled: origin !== null && destination !== null,
    staleTime: 5 * 60 * 1000,
  });
}

/** Detalle de un envío propio — pantalla a la que lleva "Ver envío" al terminar el
 * wizard de creación (MOVO-83). `enabled` solo con un id real (nunca `undefined`). */
export function useShipment(id: string | undefined) {
  return useQuery({
    queryKey: ["shipments", "detail", id],
    queryFn: () => shipmentsClient.getById(id!),
    enabled: !!id,
  });
}

/** Fotos de evidencia del paquete (`GET /shipments/:id/photos`, MOVO-81) para la card
 * de paquete del detalle de envío (MOVO-127) — falla independiente del resto de la
 * pantalla, nunca bloquea el detalle principal. */
export function useShipmentPhotos(id: string | undefined) {
  return useQuery({
    queryKey: ["shipments", "photos", id],
    queryFn: () => shipmentsClient.listPhotos(id!),
    enabled: !!id,
  });
}

/** Historial de cambios de estado (`GET /shipments/:id/events`, MOVO-128) para la
 * línea de tiempo del detalle de envío (MOVO-127) — falla y carga independientes del
 * detalle principal, igual que `useShipmentPhotos`. */
export function useShipmentEvents(id: string | undefined) {
  return useQuery({
    queryKey: ["shipments", "events", id],
    queryFn: () => shipmentsClient.listEvents(id!),
    enabled: !!id,
  });
}
