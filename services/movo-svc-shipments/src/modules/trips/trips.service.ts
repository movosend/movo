import { ApiError, UserRole } from "@movo/shared";
import { TripRepository, TripNotFoundError, TripHasAcceptedPackagesError } from "../../repositories/trip-repository";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { OfferRepository } from "../../repositories/offer-repository";
import { UsersClient } from "../../adapters/users-client";
import { Trip, TripStatus, CreateTripInput, UpdateTripInput, TripWithAcceptedPackages } from "../../models/trip";
import { MatchedShipment } from "../../models/shipment";
import { toArgentinaCalendarDate } from "../../domain/pickup-window";
import { PricingLogisticsClient } from "../../adapters/pricing-logistics-client";

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
    items: MatchedShipment[];
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
  pricingLogisticsClient: PricingLogisticsClient;
}): TripsService {
  const { tripRepository, shipmentRepository, offerRepository, usersClient, defaultMaxDetourKm, pricingLogisticsClient } = deps;

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

      // 1. Prefiltro geométrico (corredor <= 15 km y fecha calendario argentina)
      const { items, total } = await shipmentRepository.listAvailable({
        originLat: trip.originLat,
        originLng: trip.originLng,
        destinationLat: trip.destinationLat,
        destinationLng: trip.destinationLng,
        radiusKm: effectiveRadiusKm,
        pickupDate: toArgentinaCalendarDate(trip.departureAt),
        excludeUserId: trip.carrierId,
        page,
        limit,
      });

      const offeredIds = await offerRepository.listPendingOfferedShipmentIds(
        trip.carrierId,
        items.map((item) => item.id),
      );

      // 2. Si no hay candidatos tras el prefiltro, retorna lista vacía inmediatamente sin llamar al servicio externo
      if (items.length === 0) {
        return {
          items: [],
          total: 0,
          page,
          limit,
          tripId: trip.id,
          radiusKm: effectiveRadiusKm,
        };
      }

      // 3. Evaluar candidatos con svc-pricing-logistics (MOVO-219)
      const evalResult = await pricingLogisticsClient.evaluateCandidates({
        trip: {
          id: trip.id,
          originLat: trip.originLat,
          originLng: trip.originLng,
          destinationLat: trip.destinationLat,
          destinationLng: trip.destinationLng,
          departureAt: trip.departureAt.toISOString(),
        },
        candidates: items.map((item) => ({
          id: item.id,
          pickupLat: item.pickupLat,
          pickupLng: item.pickupLng,
          dropoffLat: item.deliveryLat,
          dropoffLng: item.deliveryLng,
          pickupWindowStart:
            item.pickupTimeWindowStart instanceof Date
              ? item.pickupTimeWindowStart.toISOString()
              : typeof item.pickupTimeWindowStart === "string"
                ? item.pickupTimeWindowStart
                : undefined,
          pickupWindowEnd:
            item.pickupTimeWindowEnd instanceof Date
              ? item.pickupTimeWindowEnd.toISOString()
              : typeof item.pickupTimeWindowEnd === "string"
                ? item.pickupTimeWindowEnd
                : undefined,
        })),
      });

      const evaluationsMap = new Map<
        string,
        { detourDistanceKm: number; detourDurationMinutes: number; feasible: boolean }
      >();

      for (const ev of evalResult.evaluations) {
        if (
          ev.feasible &&
          typeof ev.detourDistanceKm === "number" &&
          typeof ev.detourDurationMinutes === "number"
        ) {
          evaluationsMap.set(ev.candidateId, {
            detourDistanceKm: ev.detourDistanceKm,
            detourDurationMinutes: ev.detourDurationMinutes,
            feasible: true,
          });
        }
      }

      // 4. Filtrar candidatos factibles y enriquecer con métricas de desvío
      // Fail-safe (No-Fallback ADR-021): solo se incluyen candidatos con evaluación factible explícita
      const matchedItems: MatchedShipment[] = [];
      for (const item of items) {
        const ev = evaluationsMap.get(item.id);
        if (ev && ev.feasible) {
          matchedItems.push({
            ...item,
            hasMyOffer: offeredIds.has(item.id),
            detourDistanceKm: ev.detourDistanceKm,
            detourDurationMinutes: ev.detourDurationMinutes,
          });
        }
      }

      // 5. Ordenar de forma ascendente por menor desvío (detourDistanceKm)
      matchedItems.sort((a, b) => a.detourDistanceKm - b.detourDistanceKm);

      return {
        items: matchedItems,
        total,
        page,
        limit,
        tripId: trip.id,
        radiusKm: effectiveRadiusKm,
      };
    },
  };
}
