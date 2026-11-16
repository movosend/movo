import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ratingsClient,
  type CreateRatingInput,
  type Rating,
  type ShipmentRatingEligibility,
  type UpdateRatingInput,
} from "../api/ratings-client";

export function shipmentRatingsQueryKey(shipmentId: string | undefined) {
  return ["shipments", shipmentId, "ratings"] as const;
}

export function useShipmentRatings(
  shipmentId: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: shipmentRatingsQueryKey(shipmentId),
    queryFn: () => ratingsClient.listShipmentRatings(shipmentId!),
    enabled: (options?.enabled ?? true) && !!shipmentId,
  });
}

/**
 * Próximo cierre de una ventana abierta, en ms desde ahora (mínimo 1 s), o `false` si no hay ninguna: la consulta se
 * repite ahí para no dejar el botón de calificar después de que el backend ya lo rechaza (409).
 */
export function msUntilNextWindowClose(
  eligibility: ShipmentRatingEligibility | undefined,
  now: number = Date.now()
): number | false {
  const closes = (eligibility?.counterparties ?? [])
    .map((c) => (c.canRate && c.windowEndsAt ? new Date(c.windowEndsAt).getTime() : NaN))
    .filter((t) => !isNaN(t));
  if (closes.length === 0) return false;
  return Math.max(Math.min(...closes) - now + 1000, 1000);
}

/** Bajo la clave de las calificaciones: calificar o editar invalida las dos juntas. */
export function useRatingEligibility(
  shipmentId: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: [...shipmentRatingsQueryKey(shipmentId), "eligibility"] as const,
    queryFn: () => ratingsClient.getRatingEligibility(shipmentId!),
    enabled: (options?.enabled ?? true) && !!shipmentId,
    refetchInterval: (query) => msUntilNextWindowClose(query.state.data),
  });
}

export function useCreateRating(
  shipmentId: string,
  options?: {
    onSuccess?: (data: Rating) => void;
    onError?: (error: unknown) => void;
  }
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateRatingInput) => ratingsClient.createRating(shipmentId, input),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: shipmentRatingsQueryKey(data.shipmentId),
      });
      void queryClient.invalidateQueries({
        queryKey: ["profile"],
      });
      options?.onSuccess?.(data);
    },
    onError: options?.onError,
  });
}

export function useUpdateRating(
  shipmentId: string,
  options?: {
    onSuccess?: (data: Rating) => void;
    onError?: (error: unknown) => void;
  }
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ rateeId, input }: { rateeId: string; input: UpdateRatingInput }) =>
      ratingsClient.updateRating(shipmentId, rateeId, input),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: shipmentRatingsQueryKey(data.shipmentId),
      });
      void queryClient.invalidateQueries({
        queryKey: ["profile"],
      });
      options?.onSuccess?.(data);
    },
    onError: options?.onError,
  });
}
