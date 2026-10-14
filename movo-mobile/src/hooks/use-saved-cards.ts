import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { paymentsClient } from "../api/payments-client";
import { type SaveCardInput, saveNewCard } from "../lib/save-card-flow";

/**
 * Tarjetas guardadas (MOVO-101, backend MOVO-100). Mismo molde que `use-mp-connect.ts`:
 * después de cada mutación se escribe la cache con lo que devuelve el backend en vez de
 * refetchear, salvo al borrar (el backend puede reasignar la predeterminada).
 *
 * Nunca pasa por acá ni por la cache el número, el CVV o el token de la tarjeta.
 */
export const SAVED_CARDS_QUERY_KEY = ["payments", "cards"] as const;
export const CARDS_CHECKOUT_DATA_QUERY_KEY = ["payments", "cards", "checkout-data"] as const;

export function useSavedCards() {
  return useQuery({
    queryKey: SAVED_CARDS_QUERY_KEY,
    queryFn: paymentsClient.listSavedCards,
    staleTime: 30_000,
  });
}

/** La `public_key` no cambia en la vida de la app: se pide una vez. */
export function useCardsCheckoutData() {
  return useQuery({
    queryKey: CARDS_CHECKOUT_DATA_QUERY_KEY,
    queryFn: paymentsClient.getCardsCheckoutData,
    staleTime: Infinity,
  });
}

/** Reemplaza una tarjeta en la lista; si quedó predeterminada, desmarca a las demás. */
export function upsertCard(cards: SavedCard[] | undefined, card: SavedCard): SavedCard[] {
  const rest = (cards ?? [])
    .filter((c) => c.id !== card.id)
    .map((c) => (card.isDefault ? { ...c, isDefault: false } : c));
  const index = (cards ?? []).findIndex((c) => c.id === card.id);
  if (index === -1) return [...rest, card];
  return [...rest.slice(0, index), card, ...rest.slice(index)];
}

export function useAddSavedCard(options?: { onSuccess?: (card: SavedCard) => void; onError?: (error: unknown) => void }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveCardInput) => saveNewCard(input),
    onSuccess: (card) => {
      queryClient.setQueryData<SavedCard[]>(SAVED_CARDS_QUERY_KEY, (cards) => upsertCard(cards, card));
      options?.onSuccess?.(card);
    },
    onError: options?.onError,
  });
}

export function useSetDefaultCard(options?: { onSuccess?: (card: SavedCard) => void; onError?: (error: unknown) => void }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => paymentsClient.setDefaultCard(id),
    onSuccess: (card) => {
      queryClient.setQueryData<SavedCard[]>(SAVED_CARDS_QUERY_KEY, (cards) => upsertCard(cards, card));
      options?.onSuccess?.(card);
    },
    onError: options?.onError,
  });
}

export function useRenameCard(options?: { onSuccess?: (card: SavedCard) => void; onError?: (error: unknown) => void }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, alias }: { id: string; alias: string | null }) => paymentsClient.updateCardAlias(id, alias),
    onSuccess: (card) => {
      queryClient.setQueryData<SavedCard[]>(SAVED_CARDS_QUERY_KEY, (cards) => upsertCard(cards, card));
      options?.onSuccess?.(card);
    },
    onError: options?.onError,
  });
}

export function useDeleteCard(options?: { onSuccess?: (card: SavedCard) => void; onError?: (error: unknown) => void }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (card: SavedCard) => {
      await paymentsClient.deleteSavedCard(card.id);
      return card;
    },
    onSuccess: (card) => {
      queryClient.setQueryData<SavedCard[]>(SAVED_CARDS_QUERY_KEY, (cards) => (cards ?? []).filter((c) => c.id !== card.id));
      void queryClient.invalidateQueries({ queryKey: SAVED_CARDS_QUERY_KEY, exact: true });
      options?.onSuccess?.(card);
    },
    onError: options?.onError,
  });
}
