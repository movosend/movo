import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@movo/shared/dist/errors/api-error";
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

export function pendingReportQueryKey(userId: string) {
  return ["moderation", "report", userId] as const;
}

/** Corto a propósito: alcanza para que el menú lea del caché la consulta que la
 * pantalla de perfil ya lanzó, sin mostrar un estado viejo si se vuelve más tarde. Las
 * mutaciones de reporte escriben el caché directo, así que no dependen de esto. */
const PENDING_REPORT_STALE_TIME_MS = 30_000;

/** MOVO-175: el reporte propio en revisión sobre `userId` (o `null`). Decide si el
 * menú del perfil ofrece reportar o ver el reporte existente. La pantalla de perfil
 * la lanza en paralelo con el perfil; el menú la vuelve a leer del caché. */
export function usePendingReport(userId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: pendingReportQueryKey(userId),
    queryFn: () => moderationClient.getPendingReport(userId),
    enabled: options?.enabled ?? true,
    staleTime: PENDING_REPORT_STALE_TIME_MS,
  });
}

export function useReportUser(
  userId: string,
  options?: { onSuccess?: () => void; onError?: (error: unknown) => void }
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ReportUserInput) => moderationClient.reportUser(userId, input),
    onSuccess: (report) => {
      queryClient.setQueryData(pendingReportQueryKey(userId), report);
      options?.onSuccess?.();
    },
    onError: (error) => {
      // 409 REPORT_ALREADY_PENDING: el reporte existe (otro dispositivo, o un reintento
      // cuyo primer intento sí llegó). Se trae para mostrarlo en vez del formulario.
      if (error instanceof ApiError && error.code === "REPORT_ALREADY_PENDING") {
        void queryClient.invalidateQueries({ queryKey: pendingReportQueryKey(userId) });
      }
      options?.onError?.(error);
    },
  });
}

/** MOVO-175: suma información al reporte en revisión, sin editar lo ya enviado. */
export function useAddReportEntry(userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (details: string) => moderationClient.addReportEntry(userId, details),
    onSuccess: (report) => {
      queryClient.setQueryData(pendingReportQueryKey(userId), report);
    },
    onError: (error) => {
      // El reporte dejó de estar en revisión: se refresca para que el sheet lo refleje.
      if (error instanceof ApiError && error.code === "REPORT_NOT_FOUND") {
        void queryClient.invalidateQueries({ queryKey: pendingReportQueryKey(userId) });
      }
    },
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
