import type { VehicleProfile } from "@movo/shared/dist/types/user-profile";
import { httpClient } from "./http-client";

export type UpsertVehicleInput = VehicleProfile;

/**
 * Ficha de vehículo del transportista (MOVO-172, `svc-users` todavía sin
 * implementar — pega contra un endpoint que hoy no existe, ver esa issue para el
 * contrato propuesto). Mismo patrón cliente que `ratings-client.ts`.
 */
export const vehicleClient = {
  /** `GET /users/me/vehicle` */
  getMyVehicle(): Promise<VehicleProfile | null> {
    return httpClient.get<VehicleProfile | null>("/users/me/vehicle");
  },
  /** `PUT /users/me/vehicle` — upsert, mismo criterio que `POST /users/me/device-key` (MOVO-157). */
  upsertMyVehicle(input: UpsertVehicleInput): Promise<VehicleProfile> {
    return httpClient.put<VehicleProfile>("/users/me/vehicle", input);
  },
};
