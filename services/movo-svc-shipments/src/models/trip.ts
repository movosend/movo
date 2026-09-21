import { TripStatus } from "@movo/shared";
import { Trip as TripRow } from "../generated/prisma/client";
import { InvalidEnumValueError } from "./shipment";

export { TripStatus };

/**
 * Modelo de dominio de un viaje declarado por un transportista.
 * MOVO-161: usado para matching geométrico de paquetes en corredor (MOVO-50).
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
  departureAt: Date;
  vehicleType: string;
  status: TripStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTripInput {
  carrierId: string;
  originAddress: string;
  originLat: number;
  originLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  departureAt: Date;
  vehicleType: string;
}

export interface UpdateTripInput {
  originAddress?: string;
  originLat?: number;
  originLng?: number;
  destinationAddress?: string;
  destinationLat?: number;
  destinationLng?: number;
  departureAt?: Date;
  vehicleType?: string;
  status?: TripStatus;
}

export interface TripWithAcceptedPackages extends Trip {
  hasAcceptedPackages: boolean;
}

const TRIP_STATUS_VALUES: ReadonlySet<string> = new Set(Object.values(TripStatus));

export function parseTripStatus(value: string, column = "status"): TripStatus {
  if (!TRIP_STATUS_VALUES.has(value)) {
    throw new InvalidEnumValueError(column, value);
  }
  return value as TripStatus;
}

/**
 * MOVO-234 (fix de review, PR #176): única fuente de verdad de cómo un
 * `CreateTripInput` se traduce al `data` de `trip.create()` (siempre `declared`,
 * MOVO-221). Antes `offer-repository.ts#acceptOffer` reimplementaba este mapeo
 * inline para el `Trip` auto-creado al aceptar una oferta sin viaje asociado, en vez
 * de reusar el mismo camino que `trip-repository.ts#create()` -- riesgo de que un
 * campo nuevo se agregara a un lado y no al otro sin que nada lo detectara. Ambos
 * ahora arman el `data:` de Prisma a partir de esta única función; lo que NO se
 * comparte es el `db.trip.create()`/`tx.trip.create()` en sí, porque `acceptOffer`
 * necesita ejecutarlo dentro de su propia transacción (`tx`), no anidable con el
 * `TripRepository` que solo opera sobre el `PrismaClient` de nivel superior.
 */
export function buildTripCreateData(input: CreateTripInput): {
  carrierId: string;
  originAddress: string;
  originLat: number;
  originLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  departureAt: Date;
  vehicleType: string;
  status: TripStatus;
} {
  return {
    carrierId: input.carrierId,
    originAddress: input.originAddress,
    originLat: input.originLat,
    originLng: input.originLng,
    destinationAddress: input.destinationAddress,
    destinationLat: input.destinationLat,
    destinationLng: input.destinationLng,
    departureAt: input.departureAt,
    vehicleType: input.vehicleType,
    status: TripStatus.DECLARED,
  };
}

export function mapTrip(row: TripRow): Trip {
  return {
    id: row.id,
    carrierId: row.carrierId,
    originAddress: row.originAddress,
    originLat: row.originLat.toNumber(),
    originLng: row.originLng.toNumber(),
    destinationAddress: row.destinationAddress,
    destinationLat: row.destinationLat.toNumber(),
    destinationLng: row.destinationLng.toNumber(),
    departureAt: row.departureAt,
    vehicleType: row.vehicleType,
    status: parseTripStatus(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
