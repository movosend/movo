import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
 */
export function useMyTrips() {
  return useQuery({
    queryKey: TRIPS_LIST_QUERY_KEY,
    queryFn: () => tripsClient.list({ page: 1, limit: 50 }),
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
