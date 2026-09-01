import { ApiError, UserRole } from "@movo/shared";
import { TripRepository, TripNotFoundError, TripHasAcceptedPackagesError } from "../../repositories/trip-repository";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { OfferRepository } from "../../repositories/offer-repository";
import { UsersClient } from "../../adapters/users-client";
import { Trip, TripStatus, CreateTripInput, UpdateTripInput, TripWithAcceptedPackages } from "../../models/trip";
import { AvailableShipment } from "../../models/shipment";

export interface TripsService {
  createTrip(params: {
    callerId: string;
    callerRoles: UserRole[];
    input: Omit<CreateTripInput, "carrierId">;
  }): Promise<Trip>;

  getTrip(params: {
    tripId: string;
    callerId: string;
    callerRoles: UserRole[];
  }): Promise<TripWithAcceptedPackages>;

  listCarrierTrips(params: {
    callerId: string;
    callerRoles: UserRole[];
    page: number;
    limit: number;
    status?: TripStatus;
  }): Promise<{ items: TripWithAcceptedPackages[]; total: number; page: number; limit: number }>;

  updateTrip(params: {
    tripId: string;
    callerId: string;
    callerRoles: UserRole[];
    input: UpdateTripInput;
  }): Promise<Trip>;

  deleteTrip(params: {
    tripId: string;
    callerId: string;
    callerRoles: UserRole[];
  }): Promise<void>;

  getTripMatches(params: {
    tripId: string;
    callerId: string;
    callerRoles: UserRole[];
    radiusKm?: number;
    page: number;
    limit: number;
  }): Promise<{
    items: Array<AvailableShipment & { hasMyOffer: boolean }>;
    total: number;
    page: number;
    limit: number;
    tripId: string;
    radiusKm: number;
  }>;
}

async function assertVerifiedCarrier(usersClient: UsersClient, callerId: string, callerRoles: UserRole[]): Promise<void> {
  if (!callerRoles.includes(UserRole.CARRIER)) {
    throw new ApiError(403, "CARRIER_NOT_VERIFIED", "Necesitás ser transportista para realizar esta acción.");
  }
  const profile = await usersClient.findPublicProfile(callerId, callerId);
  if (!profile || !profile.isVerified) {
    throw new ApiError(403, "CARRIER_NOT_VERIFIED", "Necesitás tener tu identidad verificada para transportar.");
  }
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function createTripsService(deps: {
  tripRepository: TripRepository;
  shipmentRepository: ShipmentRepository;
  offerRepository: OfferRepository;
  usersClient: UsersClient;
  defaultMaxDetourKm: number;
}): TripsService {
  const { tripRepository, shipmentRepository, offerRepository, usersClient, defaultMaxDetourKm } = deps;

  return {
    async createTrip({ callerId, callerRoles, input }) {
      await assertVerifiedCarrier(usersClient, callerId, callerRoles);

      if (input.departureAt.getTime() <= Date.now()) {
        throw new ApiError(400, "TRIP_DEPARTURE_IN_PAST", "La fecha y hora de salida debe ser futura.");
      }

      if (distanceMeters(input.originLat, input.originLng, input.destinationLat, input.destinationLng) < 100) {
        throw new ApiError(
          400,
          "TRIP_ORIGIN_DESTINATION_TOO_CLOSE",
          "El origen y el destino deben estar separados por al menos 100 metros.",
        );
      }

      return tripRepository.create({
        ...input,
        carrierId: callerId,
      });
    },

    async getTrip({ tripId, callerId, callerRoles }) {
      const trip = await tripRepository.findById(tripId);
      if (!trip) {
        throw new ApiError(404, "TRIP_NOT_FOUND", `El viaje '${tripId}' no existe.`);
      }

      const isAdmin = callerRoles.includes(UserRole.ADMIN);
      if (trip.carrierId !== callerId && !isAdmin) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "No tenés permiso para ver este viaje.");
      }

      const acceptedCount = await tripRepository.countAcceptedOffers(tripId);
      return {
        ...trip,
        hasAcceptedPackages: acceptedCount > 0,
      };
    },

    async listCarrierTrips({ callerId, callerRoles, page, limit, status }) {
      await assertVerifiedCarrier(usersClient, callerId, callerRoles);

      const { items, total } = await tripRepository.listByCarrier(callerId, page, limit, status);
      return { items, total, page, limit };
    },

    async updateTrip({ tripId, callerId, callerRoles, input }) {
      const trip = await tripRepository.findById(tripId);
      if (!trip) {
        throw new ApiError(404, "TRIP_NOT_FOUND", `El viaje '${tripId}' no existe.`);
      }

      const isAdmin = callerRoles.includes(UserRole.ADMIN);
      if (trip.carrierId !== callerId && !isAdmin) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "No tenés permiso para modificar este viaje.");
      }

      const acceptedCount = await tripRepository.countAcceptedOffers(tripId);
      if (acceptedCount > 0) {
        throw new ApiError(
          409,
          "TRIP_HAS_ACCEPTED_PACKAGES",
          "No podés modificar un viaje que ya tiene paquetes aceptados.",
        );
      }

      if (input.departureAt && input.departureAt.getTime() <= Date.now()) {
        throw new ApiError(400, "TRIP_DEPARTURE_IN_PAST", "La fecha y hora de salida debe ser futura.");
      }

      const effectiveOriginLat = input.originLat ?? trip.originLat;
      const effectiveOriginLng = input.originLng ?? trip.originLng;
      const effectiveDestLat = input.destinationLat ?? trip.destinationLat;
      const effectiveDestLng = input.destinationLng ?? trip.destinationLng;

      if (distanceMeters(effectiveOriginLat, effectiveOriginLng, effectiveDestLat, effectiveDestLng) < 100) {
        throw new ApiError(
          400,
          "TRIP_ORIGIN_DESTINATION_TOO_CLOSE",
          "El origen y el destino deben estar separados por al menos 100 metros.",
        );
      }

      try {
        return await tripRepository.update(tripId, input);
      } catch (err) {
        if (err instanceof TripNotFoundError) {
          throw new ApiError(404, "TRIP_NOT_FOUND", `El viaje '${tripId}' no existe.`);
        }
        if (err instanceof TripHasAcceptedPackagesError) {
          throw new ApiError(
            409,
            "TRIP_HAS_ACCEPTED_PACKAGES",
            "No podés modificar un viaje que ya tiene paquetes aceptados.",
          );
        }
        throw err;
      }
    },

    async deleteTrip({ tripId, callerId, callerRoles }) {
      const trip = await tripRepository.findById(tripId);
      if (!trip) {
        throw new ApiError(404, "TRIP_NOT_FOUND", `El viaje '${tripId}' no existe.`);
      }

      const isAdmin = callerRoles.includes(UserRole.ADMIN);
      if (trip.carrierId !== callerId && !isAdmin) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "No tenés permiso para eliminar este viaje.");
      }

      const acceptedCount = await tripRepository.countAcceptedOffers(tripId);
      if (acceptedCount > 0) {
        throw new ApiError(
          409,
          "TRIP_HAS_ACCEPTED_PACKAGES",
          "No podés cancelar ni eliminar un viaje con paquetes ya aceptados. Seguí el flujo de cancelación correspondiente.",
        );
      }

      try {
        await tripRepository.delete(tripId);
      } catch (err) {
        if (err instanceof TripNotFoundError) {
          throw new ApiError(404, "TRIP_NOT_FOUND", `El viaje '${tripId}' no existe.`);
        }
        if (err instanceof TripHasAcceptedPackagesError) {
          throw new ApiError(
            409,
            "TRIP_HAS_ACCEPTED_PACKAGES",
            "No podés cancelar ni eliminar un viaje con paquetes ya aceptados.",
          );
        }
        throw err;
      }
    },

    async getTripMatches({ tripId, callerId, callerRoles, radiusKm, page, limit }) {
      const trip = await tripRepository.findById(tripId);
      if (!trip) {
        throw new ApiError(404, "TRIP_NOT_FOUND", `El viaje '${tripId}' no existe.`);
      }

      const isAdmin = callerRoles.includes(UserRole.ADMIN);
      if (trip.carrierId !== callerId && !isAdmin) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "No tenés permiso para ver los matches de este viaje.");
      }

      if (!isAdmin) {
        await assertVerifiedCarrier(usersClient, callerId, callerRoles);
      }

      const effectiveRadiusKm = radiusKm ?? defaultMaxDetourKm;

      const { items, total } = await shipmentRepository.listAvailable({
        originLat: trip.originLat,
        originLng: trip.originLng,
        destinationLat: trip.destinationLat,
        destinationLng: trip.destinationLng,
        radiusKm: effectiveRadiusKm,
        excludeUserId: trip.carrierId,
        page,
        limit,
      });

      const offeredIds = await offerRepository.listPendingOfferedShipmentIds(
        trip.carrierId,
        items.map((item) => item.id),
      );

      return {
        items: items.map((item) => ({ ...item, hasMyOffer: offeredIds.has(item.id) })),
        total,
        page,
        limit,
        tripId: trip.id,
        radiusKm: effectiveRadiusKm,
      };
    },
  };
}
