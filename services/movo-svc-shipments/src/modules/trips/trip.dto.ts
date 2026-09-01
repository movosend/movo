import { Trip, TripWithAcceptedPackages } from "../../models/trip";

export function toTripDto(trip: Trip | TripWithAcceptedPackages) {
  return {
    ...trip,
    departureAt: trip.departureAt.toISOString(),
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString(),
  };
}
