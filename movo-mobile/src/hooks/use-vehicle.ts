import type { VehicleProfile } from "@movo/shared/dist/types/user-profile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { vehicleClient, type UpsertVehicleInput } from "../api/vehicle-client";

export const MY_VEHICLE_QUERY_KEY = ["profile", "me", "vehicle"] as const;

/** MOVO-172, `svc-users` todavía sin implementar — ver `vehicle-client.ts`. */
export function useMyVehicle(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: MY_VEHICLE_QUERY_KEY,
    queryFn: vehicleClient.getMyVehicle,
    enabled: options?.enabled ?? true,
  });
}

export function useUpsertVehicle(options?: {
  onSuccess?: (data: VehicleProfile) => void;
  onError?: (error: unknown) => void;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpsertVehicleInput) => vehicleClient.upsertMyVehicle(input),
    onSuccess: (data) => {
      queryClient.setQueryData(MY_VEHICLE_QUERY_KEY, data);
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      options?.onSuccess?.(data);
    },
    onError: options?.onError,
  });
}
