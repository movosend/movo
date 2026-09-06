import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  tripsClient,
  type Trip,
  type TripWithAcceptedPackages,
  type CreateTripInput,
  type UpdateTripInput,
} from "../api/trips-client";

const TRIPS_LIST_QUERY_KEY = ["trips", "mine", "list"];

/**
 * "Mis viajes" (MOVO-162): una sola página con `limit` generoso en vez de scroll
 * infinito (mismo criterio de simplicidad que `useAddresses` — el AC no pide
 * paginación y el volumen esperado de viajes de un transportista no la justifica).
 *
 * `enabled` (MOVO-163): `useActiveTripMatchAlert` monta este hook globalmente para
 * cualquier usuario autenticado, no solo transportistas — sin gate, un emisor o un
 * transportista sin KYC dispara igual `GET /trips`, condenado a un 403
 * `CARRIER_NOT_VERIFIED` (`assertVerifiedCarrier`). `retry: false` porque ese 403 es
 * un estado esperado, no una falla transitoria — sin esto, el default de 3 reintentos
 * de TanStack Query dispara la misma request 3 veces por sesión para la mayoría de
 * los usuarios, para una feature que nunca les aplica.
 */
export function useMyTrips(enabled = true) {
  return useQuery({
    queryKey: TRIPS_LIST_QUERY_KEY,
    queryFn: () => tripsClient.list({ page: 1, limit: 50 }),
    enabled,
    retry: false,
  });
}

/** Detalle de un viaje propio — usado por la pantalla de editar para precargar el
 * formulario y reconfirmar `hasAcceptedPackages` justo antes de mostrarlo (defensa
 * contra un listado desactualizado por una carrera real). */
export function useTrip(id: string | undefined) {
  return useQuery({
    queryKey: ["trips", "detail", id],
    queryFn: () => tripsClient.getById(id!),
    enabled: !!id,
  });
}

export function useCreateTrip() {
  const queryClient = useQueryClient();
  return useMutation<Trip, unknown, CreateTripInput>({
    mutationFn: (body) => tripsClient.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TRIPS_LIST_QUERY_KEY });
    },
  });
}

export function useUpdateTrip() {
  const queryClient = useQueryClient();
  return useMutation<Trip, unknown, { id: string; body: UpdateTripInput }>({
    mutationFn: ({ id, body }) => tripsClient.update(id, body),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: TRIPS_LIST_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["trips", "detail", id] });
    },
  });
}

/**
 * Envíos compatibles con un viaje declarado (`GET /trips/:id/matches`, MOVO-161) para
 * el feed filtrado del tab Transportar (MOVO-163) — `useInfiniteQuery`, calcado de
 * `useAvailableShipments` (`use-shipments.ts`). Sin selector de radio en la UI todavía
 * (MOVO-163, decisión de alcance): `radiusKm` se omite y el servidor aplica su
 * default (`TRIP_DEFAULT_MAX_DETOUR_KM`).
 */
export function useTripMatches(tripId: string | undefined, radiusKm?: number, limit = 20) {
  return useInfiniteQuery({
    queryKey: ["trips", "matches", tripId, radiusKm ?? null],
    queryFn: ({ pageParam }) =>
      tripsClient.getMatches(tripId!, { radiusKm, page: pageParam, limit }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.limit < lastPage.total ? lastPage.page + 1 : undefined,
    enabled: !!tripId,
  });
}

export function useDeleteTrip() {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: (id) => tripsClient.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TRIPS_LIST_QUERY_KEY });
    },
  });
}

export type { Trip, TripWithAcceptedPackages };
