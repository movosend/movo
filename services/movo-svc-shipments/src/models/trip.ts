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
