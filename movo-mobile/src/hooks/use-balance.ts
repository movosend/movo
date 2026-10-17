import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { paymentsClient } from "../api/payments-client";

export const BALANCE_QUERY_KEY = ["payments", "balance"] as const;

export function useBalance() {
  return useInfiniteQuery({
    queryKey: BALANCE_QUERY_KEY,
    queryFn: ({ pageParam }) => paymentsClient.getBalance(pageParam || undefined),
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 0,
  });
}

export function useBalancePayData(enabled: boolean) {
  return useQuery({
    queryKey: ["payments", "balance", "pay-data"],
    queryFn: paymentsClient.getBalancePayData,
    enabled,
    staleTime: 0,
    // Un solo reintento: con los tres de default el error recién aparecía ~7 s después de abrir el sheet,
    // en medio de la carga del CVV.
    retry: 1,
  });
}

export function useRefreshBalance() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: BALANCE_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ["shipments", "available"] });
    void queryClient.invalidateQueries({ queryKey: ["offers", "mine"] });
    void queryClient.invalidateQueries({ queryKey: ["shipments", "funding"] });
    void queryClient.invalidateQueries({ queryKey: ["carrier", "eligibility"] });
  }, [queryClient]);
}
