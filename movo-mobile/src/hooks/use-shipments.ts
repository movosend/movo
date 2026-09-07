import { useInfiniteQuery, useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { shipmentsClient, type CreateShipmentInput, type ShipmentSummary } from "../api/shipments-client";

interface LatLng {
  lat: number;
  lng: number;
}

/** Radio por defecto del tab "Transportar" (MOVO-148, AC3) — coincide con el default
 * del propio backend (`radiusKm`, `shipments.schema.ts`), pero se declara acá también
 * porque el mobile lo necesita antes de la primera llamada (para pre-poblar el
 * selector de pills sin esperar a la respuesta del servidor). */
export const DEFAULT_TRANSPORT_RADIUS_KM = 50;
export const TRANSPORT_RADIUS_OPTIONS_KM = [10, 25, 50, 100] as const;

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

/**
 * Listado paginado de envíos disponibles cerca del transportista (`GET
 * /shipments/available`, MOVO-142) para el tab "Transportar" (MOVO-148) —
 * `useInfiniteQuery`, mismo criterio que `useMyShipments`. `enabled` solo con un
 * origen ya resuelto (GPS/dirección default/manual, ver `use-transport-origin.ts`):
 * sin `originLat`/`originLng` el backend responde 400.
 *
 * Se devuelve `error` (no solo `isError`) para que la pantalla distinga
 * `403 CARRIER_NOT_VERIFIED` (estado de gating con CTA a KYC) de cualquier otro
 * fallo (red/500, banner genérico con reintentar) — mismo criterio que la
 * distinción 403/404 que ya usa `useShipment` en el detalle (MOVO-127).
 */
export function useAvailableShipments(
  origin: LatLng | null,
  radiusKm: number,
  destination?: LatLng | null,
  limit = 20,
) {
  return useInfiniteQuery({
    queryKey: ["shipments", "available", origin, destination ?? null, radiusKm],
    queryFn: ({ pageParam }) =>
      shipmentsClient.listAvailable({
        originLat: origin!.lat,
        originLng: origin!.lng,
        ...(destination ? { destinationLat: destination.lat, destinationLng: destination.lng } : {}),
        radiusKm,
        page: pageParam,
        limit,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.limit < lastPage.total ? lastPage.page + 1 : undefined,
    enabled: origin !== null,
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

/** Historial compartido con otro usuario (MOVO-170, todavía sin backend en
 * `svc-shipments`) para el rediseño de perfil — falla independiente del resto de
 * la pantalla, mismo criterio que `useShipmentPhotos`/`useShipmentEvents`. */
export function useSharedHistory(userId: string | undefined) {
  return useQuery({
    queryKey: ["shipments", "history-with", userId],
    queryFn: () => shipmentsClient.getHistoryWith(userId!),
    enabled: !!userId,
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

/**
 * Acepta un envío como receptor (MOVO-131). En éxito invalida las listas de envíos y el
 * detalle del envío para reflejar el estado `published`.
 */
export function useAcceptShipment() {
  const queryClient = useQueryClient();
  return useMutation<ShipmentSummary, unknown, { id: string }>({
    mutationFn: ({ id }) => shipmentsClient.accept(id),
    onSuccess: (data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["shipments", "mine"] });
      queryClient.invalidateQueries({ queryKey: ["shipments", "mine", "recent"] });
      queryClient.invalidateQueries({ queryKey: ["shipments", "mine", "list"] });
      queryClient.invalidateQueries({ queryKey: ["shipments", "detail", id] });
      queryClient.setQueryData(["shipments", "detail", id], data);
    },
  });
}

/**
 * Rechaza un envío como receptor (MOVO-131). En éxito invalida las listas de envíos y el
 * detalle del envío para reflejar el estado terminal `rejected_by_receiver`.
 */
export function useRejectShipment() {
  const queryClient = useQueryClient();
  return useMutation<ShipmentSummary, unknown, { id: string; reason?: string }>({
    mutationFn: ({ id, reason }) => shipmentsClient.reject(id, reason ? { reason } : undefined),
    onSuccess: (data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["shipments", "mine"] });
      queryClient.invalidateQueries({ queryKey: ["shipments", "mine", "recent"] });
      queryClient.invalidateQueries({ queryKey: ["shipments", "mine", "list"] });
      queryClient.invalidateQueries({ queryKey: ["shipments", "detail", id] });
      queryClient.setQueryData(["shipments", "detail", id], data);
    },
  });
}

/**
 * Cancela un envío como emisor (MOVO-29). En éxito invalida las listas de envíos y el
 * detalle del envío para reflejar el estado terminal `cancelled`.
 */
export function useCancelShipment() {
  const queryClient = useQueryClient();
  return useMutation<ShipmentSummary, unknown, { id: string; reason?: string }>({
    mutationFn: ({ id, reason }) => shipmentsClient.cancel(id, reason ? { reason } : undefined),
    onSuccess: (data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["shipments", "mine"] });
      queryClient.invalidateQueries({ queryKey: ["shipments", "mine", "recent"] });
      queryClient.invalidateQueries({ queryKey: ["shipments", "mine", "list"] });
      queryClient.invalidateQueries({ queryKey: ["shipments", "detail", id] });
      queryClient.setQueryData(["shipments", "detail", id], data);
    },
  });
}

