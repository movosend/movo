import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { moderationClient, type ReportUserInput } from "../api/moderation-client";

export const BLOCKED_USERS_QUERY_KEY = ["moderation", "blocked"] as const;

/** MOVO-175 (ADR-026) — el bloqueo es simétrico y afecta listados de otras
 * pantallas: el feed "Transportar" (`["shipments","available",...]`), los matches de
 * un viaje (`["trips","matches",...]`) y las ofertas recibidas
 * (`["shipments", id, "offers", ...]`, invalidadas por predicado porque el id va en
 * el medio de la key). */
function invalidateBlockDependentQueries(queryClient: QueryClient, userId: string) {
  void queryClient.invalidateQueries({ queryKey: ["profile", "public", userId] });
  void queryClient.invalidateQueries({ queryKey: BLOCKED_USERS_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: ["shipments", "available"] });
  void queryClient.invalidateQueries({ queryKey: ["trips", "matches"] });
  void queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === "shipments" && query.queryKey[2] === "offers",
  });
}

export function useReportUser(
  userId: string,
  options?: { onSuccess?: () => void; onError?: (error: unknown) => void }
) {
  return useMutation({
    mutationFn: (input: ReportUserInput) => moderationClient.reportUser(userId, input),
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  });
}

export function useBlockUser(
  userId: string,
  options?: { onSuccess?: () => void; onError?: (error: unknown) => void }
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => moderationClient.blockUser(userId),
    onSuccess: () => {
      invalidateBlockDependentQueries(queryClient, userId);
      options?.onSuccess?.();
    },
    onError: options?.onError,
  });
}

/** El `userId` va en la variable de la mutación (no en el hook) para que la lista de
 * bloqueados pueda usar un solo hook para todas sus filas. */
export function useUnblockUser(options?: { onSuccess?: () => void; onError?: (error: unknown) => void }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => moderationClient.unblockUser(userId),
    onSuccess: (_data, userId) => {
      invalidateBlockDependentQueries(queryClient, userId);
      options?.onSuccess?.();
    },
    onError: options?.onError,
  });
}

export function useBlockedUsers() {
  return useQuery({
    queryKey: BLOCKED_USERS_QUERY_KEY,
    queryFn: () => moderationClient.listBlocked(),
  });
}
