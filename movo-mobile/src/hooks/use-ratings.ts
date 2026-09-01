import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ratingsClient,
  type CreateRatingInput,
  type Rating,
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
