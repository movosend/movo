import { httpClient } from "./http-client";
import { TripStatus } from "@movo/shared/dist/types/trip";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { AvailableShipment } from "./shipments-client";

export { TripStatus };

/**
 * DTO tal cual lo devuelve el backend (`tripResponse`/`tripWithAcceptedPackagesResponse`
 * en `trips.schema.ts`, `movo-svc-shipments`, MOVO-161). `departureAt`/`createdAt`/
 * `updatedAt` viajan como ISO datetime completo (a diferencia de `pickupDate` de
 * `shipments-client.ts`, acá no hay gotcha de timezone — son instantes reales de punta a
 * punta, ver CLAUDE.md de MOVO-162).
 */
export interface Trip {
  id: string;
  carrierId: string;
  originAddress: string;
  originLat: number;
  originLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  departureAt: string;
  vehicleType: string;
  status: TripStatus;
  /** Seteado al cancelar (`POST /trips/:id/cancel`, MOVO-260); `null` en cualquier otro estado. */
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TripAcceptedPackage {
  shipmentId: string;
  status: ShipmentStatus;
  packageType: string;
  weightKg: number;
  pickupAddress: string;
  deliveryAddress: string;
  pickupDate: string;
  pickupTimeWindowStart: string;
  pickupTimeWindowEnd: string;
  agreedPriceArs: number;
  senderName: string;
}

/** `GET /trips`/`GET /trips/:id` suman este flag (`hasAcceptedPackages`) — un viaje con
 * al menos un paquete aceptado no se puede editar ni cancelar directo (AC3/AC4). */
export interface TripWithAcceptedPackages extends Trip {
  hasAcceptedPackages: boolean;
  acceptedPackagesCount: number;
  /** MOVO-277: cuántos de los paquetes aceptados ya se pueden retirar o entregar
   * (envío `assigned`/`in_transit`). `POST /trips/:id/start` exige al menos uno; los que
   * esperan el hold de fondos (`assignment_pending`/`assigned_unfunded`) no cuentan. */
  executablePackagesCount: number;
  packages?: TripAcceptedPackage[];
}

/** Body de `POST /trips` (`createTripBody`, `additionalProperties: false` en el
 * backend) — `carrierId` nunca viaja acá, sale del header `x-user-id` inyectado por el
 * gateway. */
export interface CreateTripInput {
  originAddress: string;
  originLat: number;
  originLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  departureAt: string;
  vehicleType: string;
}

/** Body de `PATCH /trips/:id` — todos los campos opcionales, se manda solo lo que
 * cambió. */
export type UpdateTripInput = Partial<CreateTripInput>;

export interface ListTripsResponse {
  items: TripWithAcceptedPackages[];
  page: number;
  limit: number;
  total: number;
}

/** Query de `GET /trips/:id/matches` (MOVO-161/163) — `radiusKm` opcional
 * sobreescribe el radio de desvío default del servidor (`TRIP_DEFAULT_MAX_DETOUR_KM`,
 * 15km); sin selector en la UI todavía (MOVO-163), se omite del request. */
export type TripMatchesParams = {
  radiusKm?: number;
  page?: number;
  limit?: number;
};

/** Respuesta de `GET /trips/:id/matches` — `items` es el mismo DTO que
 * `ListAvailableResponse` (`shipments-client.ts`, MOVO-142), salvo que la copia del
 * schema del módulo `trips` no incluye `calculationMethod` (drift menor entre las dos
 * copias del schema en el backend, sin uso en ninguna UI mobile hoy). */
export interface TripMatchesResponse {
  items: AvailableShipment[];
  page: number;
  limit: number;
  total: number;
  tripId: string;
  radiusKm: number;
}

export type TripListScope = "upcoming" | "history";

export interface ListTripsParams extends Record<string, string | number | boolean | undefined> {
  page?: number;
  limit?: number;
  status?: TripStatus | string;
  /** MOVO-260: `upcoming` (declared/active) o `history` (completed/cancelled/expired). No combinable con `status`. */
  scope?: TripListScope;
}

export const tripsClient = {
  /** Protegida — `httpClient` adjunta `Authorization` automáticamente (MOVO-76). */
  list(params?: ListTripsParams): Promise<ListTripsResponse> {
    return httpClient.get<ListTripsResponse>("/trips", params);
  },

  create(body: CreateTripInput): Promise<Trip> {
    return httpClient.post<Trip>("/trips", body);
  },

  /** `GET /trips/:id` — 403 si el viaje es de otro transportista (nunca 404 filtrado,
   * mismo criterio que `shipmentsClient.getById`). */
  getById(id: string): Promise<TripWithAcceptedPackages> {
    return httpClient.get<TripWithAcceptedPackages>(`/trips/${id}`);
  },

  /** `PATCH /trips/:id` — 409 `TRIP_HAS_ACCEPTED_PACKAGES` si el viaje ya tiene
   * paquetes aceptados. */
  update(id: string, body: UpdateTripInput): Promise<Trip> {
    return httpClient.patch<Trip>(`/trips/${id}`, body);
  },

  /** `DELETE /trips/:id` — 204 sin body; 409 `TRIP_HAS_ACCEPTED_PACKAGES` si el viaje
   * ya tiene paquetes aceptados. */
  remove(id: string): Promise<void> {
    return httpClient.delete<void>(`/trips/${id}`);
  },

  /** `GET /trips/:id/matches` (MOVO-161) — envíos `published` compatibles con el
   * corredor de este viaje, para el feed filtrado de MOVO-163. Mismo criterio de
   * acceso que `getById` (403 si el viaje es de otro transportista). */
  getMatches(id: string, params?: TripMatchesParams): Promise<TripMatchesResponse> {
    return httpClient.get<TripMatchesResponse>(`/trips/${id}/matches`, params);
  },

  /** `POST /trips/:id/start` (MOVO-221 / MOVO-252) — transiciona el viaje de declared a active.
   * 409 `TRIP_NOT_DECLARED` si no está en declared.
   * 409 `TRIP_ALREADY_HAS_ACTIVE_TRIP` si ya tiene otro viaje active. */
  start(id: string): Promise<Trip> {
    return httpClient.post<Trip>(`/trips/${id}/start`);
  },
};
