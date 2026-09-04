import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  offersClient,
  type CreateOfferRequest,
  type CreateOfferResponse,
  type ListMyOffersParams,
  type ListShipmentOffersParams,
  type OfferSummary,
} from "../api/offers-client";

export function shipmentOffersQueryKey(shipmentId: string | undefined, params?: ListShipmentOffersParams) {
  const normalizedParams: ListShipmentOffersParams = { sort: "price", ...params };
  return ["shipments", shipmentId, "offers", normalizedParams] as const;
}

export function useShipmentOffers(
  shipmentId: string | undefined,
  params?: ListShipmentOffersParams,
  options?: { enabled?: boolean }
) {
  const effectiveParams: ListShipmentOffersParams = { sort: "price", ...params };
  return useQuery({
    queryKey: shipmentOffersQueryKey(shipmentId, effectiveParams),
    queryFn: () => offersClient.listShipmentOffers(shipmentId!, effectiveParams),
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

export function myOffersQueryKey(params?: ListMyOffersParams) {
  return ["offers", "mine", params ?? {}] as const;
}

/**
 * `GET /offers/mine` (MOVO-145 / MOVO-149)
 * Lista las ofertas realizadas por el transportista autenticado.
 */
export function useMyOffers(
  params?: ListMyOffersParams,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: myOffersQueryKey(params),
    queryFn: () => offersClient.listMyOffers(params),
    enabled: options?.enabled ?? true,
  });
}

/**
 * `POST /shipments/:id/offers` (MOVO-143 / MOVO-149)
 * Crea una oferta sobre un envío publicado.
 * En éxito:
 * - Actualiza de inmediato la query `["shipments", "available"]` marcando `hasMyOffer: true` en la card correspondiente.
 * - Invalida `["offers", "mine"]` para refrescar las ofertas activas.
 */
export function useCreateOffer(
  shipmentId: string,
  options?: {
    onSuccess?: (data: CreateOfferResponse) => void;
    onError?: (error: unknown) => void;
  }
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateOfferRequest) => offersClient.createOffer(shipmentId, data),
    onSuccess: (data) => {
      // Marcamos inmediatamente hasMyOffer en las listas cacheadas de disponibles
      queryClient.setQueriesData(
        { queryKey: ["shipments", "available"] },
        (old: any) => {
          if (!old || !old.pages) return old;
          return {
            ...old,
            pages: old.pages.map((page: any) => ({
              ...page,
              items: page.items.map((item: any) =>
                item.id === shipmentId ? { ...item, hasMyOffer: true } : item
              ),
            })),
          };
        }
      );

      void queryClient.invalidateQueries({ queryKey: ["offers", "mine"] });
      void queryClient.invalidateQueries({ queryKey: ["shipments", "available"] });
      void queryClient.invalidateQueries({ queryKey: ["shipments", "detail", shipmentId] });

      options?.onSuccess?.(data);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });
}

/**
 * `POST /offers/:id/withdraw` (MOVO-143 / MOVO-149)
 * Retira una oferta propia en pending -> withdrawn.
 * En éxito:
 * - Actualiza la query `["shipments", "available"]` marcando `hasMyOffer: false`.
 * - Invalida `["offers", "mine"]`.
 */
export function useWithdrawOffer(
  shipmentId?: string,
  options?: {
    onSuccess?: (data: OfferSummary) => void;
    onError?: (error: unknown) => void;
  }
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (offerId: string) => offersClient.withdrawOffer(offerId),
    onSuccess: (data) => {
      const targetShipmentId = shipmentId ?? data.shipmentId;
      if (targetShipmentId) {
        queryClient.setQueriesData(
          { queryKey: ["shipments", "available"] },
          (old: any) => {
            if (!old || !old.pages) return old;
            return {
              ...old,
              pages: old.pages.map((page: any) => ({
                ...page,
                items: page.items.map((item: any) =>
                  item.id === targetShipmentId ? { ...item, hasMyOffer: false } : item
                ),
              })),
            };
          }
        );
        void queryClient.invalidateQueries({ queryKey: ["shipments", "detail", targetShipmentId] });
      }

      void queryClient.invalidateQueries({ queryKey: ["offers", "mine"] });
      void queryClient.invalidateQueries({ queryKey: ["shipments", "available"] });

      options?.onSuccess?.(data);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });
}
