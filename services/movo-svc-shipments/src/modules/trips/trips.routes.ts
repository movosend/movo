import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { TripStatus } from "@movo/shared";
import { createTripsService, TripsService } from "./trips.service";
import { tripsSchemas } from "./trips.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { getUserRolesFromHeader } from "../../utils/get-user-roles";
import { createUsersClient, UsersClient } from "../../adapters/users-client";
import { createTripRepository, TripRepository } from "../../repositories/trip-repository";
import { createShipmentRepository, ShipmentRepository } from "../../repositories/shipment-repository";
import { createOfferRepository, OfferRepository } from "../../repositories/offer-repository";
import { AvailableShipment } from "../../models/shipment";
import { toTripDto } from "./trip.dto";

export interface TripsRoutesOptions extends FastifyPluginOptions {
  usersClient?: UsersClient;
  tripRepository?: TripRepository;
  shipmentRepository?: ShipmentRepository;
  offerRepository?: OfferRepository;
  service?: TripsService;
}

interface CreateTripBody {
  originAddress: string;
  originLat: number;
  originLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  departureAt: string;
  vehicleType: string;
}

interface UpdateTripBody {
  originAddress?: string;
  originLat?: number;
  originLng?: number;
  destinationAddress?: string;
  destinationLat?: number;
  destinationLng?: number;
  departureAt?: string;
  vehicleType?: string;
  status?: TripStatus;
}

function toAvailableShipmentDto(item: AvailableShipment & { hasMyOffer: boolean }) {
  return {
    ...item,
    pickupDate: item.pickupDate instanceof Date ? item.pickupDate.toISOString().slice(0, 10) : item.pickupDate,
    pickupTimeWindowStart:
      item.pickupTimeWindowStart instanceof Date
        ? item.pickupTimeWindowStart.toISOString().slice(11, 19)
        : item.pickupTimeWindowStart,
    pickupTimeWindowEnd:
      item.pickupTimeWindowEnd instanceof Date
        ? item.pickupTimeWindowEnd.toISOString().slice(11, 19)
        : item.pickupTimeWindowEnd,
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
  };
}

export default async function tripsRoutes(app: FastifyInstance, opts: TripsRoutesOptions) {
  const usersClient = opts.usersClient ?? createUsersClient(app.config);
  const tripRepository = opts.tripRepository ?? createTripRepository(app.db);
  const shipmentRepository = opts.shipmentRepository ?? createShipmentRepository(app.db);
  const offerRepository = opts.offerRepository ?? createOfferRepository(app.db);
  const defaultMaxDetourKm = app.config.TRIP_DEFAULT_MAX_DETOUR_KM ?? 15;

  const service =
    opts.service ??
    createTripsService({
      tripRepository,
      shipmentRepository,
      offerRepository,
      usersClient,
      defaultMaxDetourKm,
    });

  // POST /trips: declara un nuevo viaje
  app.post(
    "/",
    {
      schema: {
        summary: "Declarar viaje (transportista)",
        body: tripsSchemas.createTripBody,
        response: {
          201: tripsSchemas.tripResponse,
          400: tripsSchemas.errorResponse,
          403: tripsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const body = request.body as CreateTripBody;

      const trip = await service.createTrip({
        callerId,
        callerRoles,
        input: {
          ...body,
          departureAt: new Date(body.departureAt),
        },
      });

      return reply.code(201).send(toTripDto(trip));
    },
  );

  // GET /trips: listar viajes del transportista
  app.get(
    "/",
    {
      schema: {
        summary: "Listar mis viajes declarados (transportista)",
        querystring: tripsSchemas.listTripsQuery,
        response: {
          200: tripsSchemas.listTripsResponse,
          403: tripsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const query = request.query as { page?: number; limit?: number; status?: TripStatus };

      const result = await service.listCarrierTrips({
        callerId,
        callerRoles,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
        status: query.status,
      });

      return reply.send({
        items: result.items.map(toTripDto),
        total: result.total,
        page: result.page,
        limit: result.limit,
      });
    },
  );

  // GET /trips/:id: detalle del viaje
  app.get(
    "/:id",
    {
      schema: {
        summary: "Detalle de viaje declarado",
        params: tripsSchemas.tripIdParam,
        response: {
          200: tripsSchemas.tripWithAcceptedPackagesResponse,
          403: tripsSchemas.errorResponse,
          404: tripsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };

      const trip = await service.getTrip({
        tripId: id,
        callerId,
        callerRoles,
      });

      return reply.send(toTripDto(trip));
    },
  );

  // PATCH /trips/:id: editar viaje (solo si no tiene paquetes aceptados)
  app.patch(
    "/:id",
    {
      schema: {
        summary: "Editar viaje declarado",
        params: tripsSchemas.tripIdParam,
        body: tripsSchemas.updateTripBody,
        response: {
          200: tripsSchemas.tripResponse,
          400: tripsSchemas.errorResponse,
          403: tripsSchemas.errorResponse,
          404: tripsSchemas.errorResponse,
          409: tripsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };
      const body = request.body as UpdateTripBody;

      const trip = await service.updateTrip({
        tripId: id,
        callerId,
        callerRoles,
        input: {
          ...body,
          departureAt: body.departureAt ? new Date(body.departureAt) : undefined,
        },
      });

      return reply.send(toTripDto(trip));
    },
  );

  // DELETE /trips/:id: cancelar o eliminar viaje (409 si tiene paquetes aceptados)
  app.delete(
    "/:id",
    {
      schema: {
        summary: "Eliminar o cancelar viaje declarado",
        params: tripsSchemas.tripIdParam,
        response: {
          204: { type: "null", description: "Viaje eliminado exitosamente" },
          403: tripsSchemas.errorResponse,
          404: tripsSchemas.errorResponse,
          409: tripsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };

      await service.deleteTrip({
        tripId: id,
        callerId,
        callerRoles,
      });

      return reply.code(204).send();
    },
  );

  // GET /trips/:id/matches: paquetes compatibles con el corredor del viaje
  app.get(
    "/:id/matches",
    {
      schema: {
        summary: "Paquetes compatibles con el viaje declarado (radio de desvío)",
        params: tripsSchemas.tripIdParam,
        querystring: tripsSchemas.matchesQuery,
        response: {
          200: tripsSchemas.matchesResponse,
          403: tripsSchemas.errorResponse,
          404: tripsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };
      const query = request.query as { radiusKm?: number; page?: number; limit?: number };

      const result = await service.getTripMatches({
        tripId: id,
        callerId,
        callerRoles,
        radiusKm: query.radiusKm,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      });

      return reply.send({
        items: result.items.map(toAvailableShipmentDto),
        total: result.total,
        page: result.page,
        limit: result.limit,
        tripId: result.tripId,
        radiusKm: result.radiusKm,
      });
    },
  );
}
