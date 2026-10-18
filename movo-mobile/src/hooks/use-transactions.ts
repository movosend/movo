import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import type { TransactionRole, TransactionStatus } from "@movo/shared/dist/types/transaction";
import { transactionsClient } from "../api/transactions-client";

export interface TransactionFilters {
  statuses: TransactionStatus[];
  /** `YYYY-MM-DD` o `null`. */
  from: string | null;
  to: string | null;
}

export const EMPTY_TRANSACTION_FILTERS: TransactionFilters = { statuses: [], from: null, to: null };

export function transactionFilterCount(filters: TransactionFilters): number {
  return (filters.statuses.length > 0 ? 1 : 0) + (filters.from || filters.to ? 1 : 0);
}

/**
 * Listado paginado por cursor del historial de un rol (MOVO-304). La query key lleva el rol y
 * los filtros: cada tab tiene su propia paginación y cambiar un filtro arranca de la primera
 * página. Mismo patrón que `useMyShipments`.
 */
export function useTransactions(role: TransactionRole, filters: TransactionFilters, limit = 20) {
  return useInfiniteQuery({
    queryKey: ["payments", "transactions", "list", role, filters],
    queryFn: ({ pageParam }) =>
      transactionsClient.list({
        role,
        status: filters.statuses,
        from: filters.from ?? undefined,
        to: filters.to ?? undefined,
        cursor: pageParam,
        limit,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** Detalle de una transacción vista desde un rol. `enabled` solo con un id real. */
export function useTransaction(id: string | undefined, role: TransactionRole) {
  return useQuery({
    queryKey: ["payments", "transactions", "detail", role, id],
    queryFn: () => transactionsClient.getById(id!, role),
    enabled: !!id,
    // Un 404 (ajena o inexistente) no mejora reintentando.
    retry: (failureCount, error) => !(error instanceof ApiError && error.statusCode === 404) && failureCount < 2,
  });
}
