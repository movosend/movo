import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { createRatingsService } from "./ratings.service";
import { ratingsSchemas } from "./ratings.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { getUserRolesFromHeader } from "../../utils/get-user-roles";
import { createNotificationsClient, NotificationsClient } from "../../adapters/notifications-client";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { createRatingRepository } from "../../repositories/rating-repository";
import { Rating } from "../../models/rating";

export interface RatingsRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración -- evita depender de un `movo-svc-users`
   * real levantado, mismo criterio que `notificationsClient` en shipments.routes.ts. */
  notificationsClient?: NotificationsClient;
}

function toRatingDto(rating: Rating) {
  return rating;
}

/**
 * MOVO-146: alta/edición/lectura de calificaciones post-entrega, montado con prefix
 * "/shipments" (junto a `shipmentsRoutes`, mismo `app.db`). Módulo propio en vez de
 * sumarse a `shipments.routes.ts` -- dominio separado (persiste en su propia tabla,
 * sin tocar `status` de `Shipment`).
 */
export default async function ratingsRoutes(app: FastifyInstance, opts: RatingsRoutesOptions) {
  const notificationsClient = opts.notificationsClient ?? createNotificationsClient(app.config);
  const shipmentRepository = createShipmentRepository(app.db);
  const ratingRepository = createRatingRepository(app.db);
  const service = createRatingsService(shipmentRepository, ratingRepository, notificationsClient, app.log);

  app.post(
    "/:id/ratings",
    {
      schema: {
        summary: "Calificar a una contraparte del envío",
        description:
          "AC1-AC5/AC7-AC9 de MOVO-146: alta de una calificación post-entrega. Requiere que el " +
          "envío esté delivered (409 SHIPMENT_NOT_DELIVERED), sin disputa activa (409 " +
          "SHIPMENT_RATING_DISPUTE_ACTIVE) y dentro de la ventana de 72hs desde la entrega (409 " +
          "SHIPMENT_RATING_WINDOW_EXPIRED, congelada mientras el envío esté disputed). Tanto quien " +
          "califica como el calificado tienen que ser partes del envío y no pueden ser la misma " +
          "persona (403). Un segundo POST sobre el mismo par devuelve 409 " +
          "SHIPMENT_RATING_ALREADY_EXISTS -- usar PATCH para editar. Dispara una push best-effort " +
          "al calificado.",
        tags: ["ratings"],
        params: ratingsSchemas.shipmentIdParam,
        body: ratingsSchemas.createRatingBody,
        response: {
          201: ratingsSchemas.ratingResponse,
          400: ratingsSchemas.errorResponse,
          401: ratingsSchemas.errorResponse,
          403: ratingsSchemas.errorResponse,
          404: ratingsSchemas.errorResponse,
          409: ratingsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const raterId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const body = request.body as { rateeId: string; score: number; comment?: string };
      const rating = await service.createRating({ shipmentId: id, raterId, ...body });
      reply.code(201);
      return toRatingDto(rating);
    },
  );

  app.patch(
    "/:id/ratings/:rateeId",
    {
      schema: {
        summary: "Editar una calificación propia",
        description:
          "AC5 de MOVO-146: edita la calificación que el caller ya hizo a rateeId en este envío -- " +
          "nunca crea una segunda fila. Mismas precondiciones de ventana/disputa que el alta (409). " +
          "404 SHIPMENT_RATING_NOT_FOUND si el caller no calificó todavía a esa persona en este envío.",
        tags: ["ratings"],
        params: ratingsSchemas.shipmentRateeIdParam,
        body: ratingsSchemas.updateRatingBody,
        response: {
          200: ratingsSchemas.ratingResponse,
          400: ratingsSchemas.errorResponse,
          401: ratingsSchemas.errorResponse,
          404: ratingsSchemas.errorResponse,
          409: ratingsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const raterId = requireUserIdFromHeader(request);
      const { id, rateeId } = request.params as { id: string; rateeId: string };
      const body = request.body as { score: number; comment?: string };
      const rating = await service.updateRating({ shipmentId: id, raterId, rateeId, ...body });
      return toRatingDto(rating);
    },
  );

  app.get(
    "/:id/ratings",
    {
      schema: {
        summary: "Calificaciones de un envío",
        description:
          "AC6 de MOVO-146: calificaciones ya hechas sobre este envío -- el mobile lo usa para saber " +
          "a quién ya calificó y ocultar la acción. Accesible para las partes del envío (emisor, " +
          "receptor, transportista asignado) o un admin.",
        tags: ["ratings"],
        params: ratingsSchemas.shipmentIdParam,
        response: {
          200: ratingsSchemas.listRatingsResponse,
          401: ratingsSchemas.errorResponse,
          403: ratingsSchemas.errorResponse,
          404: ratingsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };
      const ratings = await service.listShipmentRatings(id, callerId, callerRoles);
      return ratings.map(toRatingDto);
    },
  );
}

/**
 * MOVO-146 AC10: consultado por `movo-svc-users` para el agregado/últimas
 * calificaciones del perfil (MOVO-25). Interno -- no pasa por el gateway, mismo
 * criterio que `/internal/account-deletion` (MOVO-134) y `/internal/notifications` de
 * `movo-svc-users` (MOVO-106).
 */
export async function internalRatingsRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const shipmentRepository = createShipmentRepository(app.db);
  const ratingRepository = createRatingRepository(app.db);
  const service = createRatingsService(shipmentRepository, ratingRepository);

  app.get(
    "/users/:userId/ratings/recent",
    {
      schema: {
        hide: true,
        params: ratingsSchemas.userIdParam,
        querystring: ratingsSchemas.recentRatingsQuery,
        response: { 200: ratingsSchemas.listRatingsResponse },
      },
    },
    async (request: FastifyRequest) => {
      const { userId } = request.params as { userId: string };
      const { limit } = request.query as { limit: number };
      const ratings = await service.listRecentRatingsForUser(userId, limit);
      return ratings.map(toRatingDto);
    },
  );
}
