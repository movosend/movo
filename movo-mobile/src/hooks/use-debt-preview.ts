import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { paymentsClient } from "../api/payments-client";

export function useDebtPreview(priceArs: number | null | undefined) {
  const [settledPrice, setSettledPrice] = useState<number | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettledPrice(priceArs && priceArs > 0 ? priceArs : null), 300);
    return () => clearTimeout(timer);
  }, [priceArs]);
  const query = useQuery({
    queryKey: ["payments", "debt-preview", settledPrice],
    queryFn: () => paymentsClient.previewCarrierDebt([settledPrice!]),
    enabled: settledPrice !== null,
    staleTime: 5000,
  });
  return settledPrice === priceArs && query.data ? query.data.debtOffsetsArs[0] ?? 0 : null;
}
