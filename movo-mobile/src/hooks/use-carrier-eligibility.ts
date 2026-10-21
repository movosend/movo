import type { CarrierRequirement } from "@movo/shared/dist/types/carrier-eligibility";
import { useQuery } from "@tanstack/react-query";
import { httpClient } from "../api/http-client";

export const CARRIER_ELIGIBILITY_QUERY_KEY = ["carrier", "eligibility"] as const;

export function useCarrierEligibility() {
  return useQuery({
    queryKey: CARRIER_ELIGIBILITY_QUERY_KEY,
    queryFn: () => httpClient.get<{ identityApproved: boolean; missingRequirements: CarrierRequirement[] }>("/shipments/carrier-eligibility"),
    staleTime: 0,
  });
}
