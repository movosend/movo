import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  offersClient,
  type CreateOfferRequest,
  type CreateOfferResponse,
  type ListMyOffersParams,
  type ListShipmentOffersParams,
  type MyOfferSummary,
  type OfferSummary,
  type UpdateOfferRequest,
} from "../api/offers-client";
import type { ListAvailableResponse } from "../api/shipments-client";

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
      void queryClient.invalidateQueries({
        queryKey: ["shipments", "active"],
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

export function offerDetailQueryKey(offerId: string | undefined) {
  return ["offers", "detail", offerId] as const;
}

/**
 * `GET /offers/:id` (MOVO-190)
 * Detalle completo de una oferta propia, para la pantalla de detalle (MOVO-182).
 */
export function useOfferDetail(offerId: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: offerDetailQueryKey(offerId),
    queryFn: () => offersClient.getOffer(offerId!),
    enabled: (options?.enabled ?? true) && !!offerId,
  });
}

/**
 * `PATCH /offers/:id` (MOVO-181)
 * Modifica una oferta propia en `pending` (precio y/o fecha/franja de retiro).
 * El backend devuelve el `OfferSummary` plano (sin `shipment`/`competitiveRank`,
 * ver el comentario de `offersClient.updateOffer`) -- mergeado a mano sobre el
 * `MyOfferSummary` ya cacheado en vez de un `setQueryData` directo, que pisaría esos
 * dos campos con `undefined` y rompería el render de la pantalla de detalle.
 * Ese merge dejaba `competitiveRank` con el valor viejo (calculado contra el precio
 * anterior) hasta que la pantalla se desmontaba y volvía a montar -- bug reportado
 * por el usuario ("Cómo venís" no se actualizaba tras cambiar el precio sin salir y
 * volver a entrar). Se invalida también `offerDetailQueryKey` para que, con la
 * pantalla todavía montada, React Query dispare un refetch real de
 * `GET /offers/:id` y reemplace ese merge stale por el ranking recalculado.
 * Además invalida `["offers", "mine"]` y el detalle del envío asociado.
 */
export function useUpdateOffer(
  offerId: string,
  options?: {
    onSuccess?: (data: OfferSummary) => void;
    onError?: (error: unknown) => void;
  }
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateOfferRequest) => offersClient.updateOffer(offerId, data),
    onSuccess: (data) => {
      queryClient.setQueryData<MyOfferSummary | undefined>(
        offerDetailQueryKey(offerId),
        (previous) => (previous ? { ...previous, ...data } : previous),
      );
      void queryClient.invalidateQueries({ queryKey: offerDetailQueryKey(offerId) });
      void queryClient.invalidateQueries({ queryKey: ["offers", "mine"] });
      void queryClient.invalidateQueries({ queryKey: ["shipments", "detail", data.shipmentId] });
      options?.onSuccess?.(data);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });
}

/**
 * Parchea `hasMyOffer` en las páginas ya cacheadas de `["shipments", "available"]`,
 * compartido por `useCreateOffer`/`useWithdrawOffer` (antes duplicado con solo el
 * booleano distinto). No dispara ningún request — la invalidación de la query queda
 * a cargo del caller.
 */
function patchAvailableShipmentOffer(
  queryClient: QueryClient,
  shipmentId: string,
  hasMyOffer: boolean
) {
  queryClient.setQueriesData<InfiniteData<ListAvailableResponse>>(
    { queryKey: ["shipments", "available"] },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items.map((item) => (item.id === shipmentId ? { ...item, hasMyOffer } : item)),
        })),
      };
    }
  );
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
      // Marcamos inmediatamente hasMyOffer en las listas cacheadas de disponibles —
      // sin invalidar esa misma query después: el parche ya deja la card correcta,
      // invalidarla forzaría un refetch de red de todas las páginas ya cargadas para
      // un estado que ya estaba bien.
      patchAvailableShipmentOffer(queryClient, shipmentId, true);

      void queryClient.invalidateQueries({ queryKey: ["offers", "mine"] });
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
        // Mismo criterio que `useCreateOffer`: el parche optimista ya deja la card
        // correcta, sin necesidad de invalidar `["shipments", "available"]` después.
        patchAvailableShipmentOffer(queryClient, targetShipmentId, false);
        void queryClient.invalidateQueries({ queryKey: ["shipments", "detail", targetShipmentId] });
      }

      void queryClient.invalidateQueries({ queryKey: ["offers", "mine"] });

      options?.onSuccess?.(data);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });
}
