import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  offersClient,
  type ListShipmentOffersParams,
  type OfferSummary,
} from "../api/offers-client";

export function shipmentOffersQueryKey(shipmentId: string | undefined, params?: ListShipmentOffersParams) {
  return ["shipments", shipmentId, "offers", params] as const;
}

export function useShipmentOffers(
  shipmentId: string | undefined,
  params?: ListShipmentOffersParams,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: shipmentOffersQueryKey(shipmentId, params),
    queryFn: () => offersClient.listShipmentOffers(shipmentId!, params),
    enabled: (options?.enabled ?? true) && !!shipmentId,
  });
}

export function useAcceptOffer(options?: {
  onSuccess?: (data: OfferSummary) => void;
  onError?: (error: unknown) => void;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (offerId: string) => offersClient.acceptOffer(offerId),
    onSuccess: (data) => {
      // Invalida las ofertas del envío
      void queryClient.invalidateQueries({
        queryKey: ["shipments", data.shipmentId, "offers"],
      });
      // Invalida el detalle del envío (pasa a assignment_pending con carrierId seteado)
      void queryClient.invalidateQueries({
        queryKey: ["shipments", "detail", data.shipmentId],
      });
      // Invalida los listados de envíos
      void queryClient.invalidateQueries({
        queryKey: ["shipments", "mine"],
      });
      options?.onSuccess?.(data);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });
}

export function useRejectOffer(options?: {
  onSuccess?: (data: OfferSummary) => void;
  onError?: (error: unknown) => void;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (offerId: string) => offersClient.rejectOffer(offerId),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: ["shipments", data.shipmentId, "offers"],
      });
      options?.onSuccess?.(data);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });
}
