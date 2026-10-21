import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import {
  AdminShipmentRole,
  AdminUserRatingRowPage,
  AdminUserShipmentRowPage,
  AdminUserTripPage,
  ApiError,
  ChatReportParties,
  InProgressShipment,
  ShipmentParties,
  WithdrawOpenActivityResult,
} from "@movo/shared";
import { ShipmentStatus, TripStatus } from "../../generated/prisma/client";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { createChatRepository } from "../../repositories/chat-repository";
import { adminInternalSchemas } from "./admin-internal.schema";
import { createAdminUsersService } from "./admin-users.service";
import { createSanctionEffectsService } from "./sanction-effects.service";
import { createOfferRepository } from "../../repositories/offer-repository";
import { createTripRepository } from "../../repositories/trip-repository";
import { createShipmentsService } from "../shipments/shipments.service";
import { createUsersClient, UsersClient } from "../../adapters/users-client";
import { createNotificationsClient, NotificationsClient } from "../../adapters/notifications-client";

/**
 * Módulo interno (MOVO-288): las partes de un envío o de un reporte de chat, para la regla de
 * conflicto de interés de `svc-admin` (un admin no puede actuar sobre algo en lo que es parte).
 * MOVO-294 suma las secciones de la ficha de un usuario del panel.
 * No pasa por el gateway, solo es alcanzable dentro de la red Docker interna (ADR-010), mismo
 * patrón que `mutual-connections`. De solo lectura y sin `x-user-id`: quien decide es `svc-admin`.
 */
export interface AdminInternalRoutesOptions extends FastifyPluginOptions {
  usersClient?: UsersClient;
  notificationsClient?: NotificationsClient;
}

export default async function adminInternalRoutes(app: FastifyInstance, opts: AdminInternalRoutesOptions) {
  const shipmentRepository = createShipmentRepository(app.db);
  const chatRepository = createChatRepository(app.db);

  app.get(
    "/shipments/:id/parties",
    {
      schema: {
        hide: true,
        params: adminInternalSchemas.idParam,
        response: { 200: adminInternalSchemas.shipmentPartiesResponse },
      },
    },
    async (request: FastifyRequest): Promise<ShipmentParties> => {
      const { id } = request.params as { id: string };
      const parties = await shipmentRepository.findParties(id);
      if (!parties) throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      return parties;
    },
  );

  // Quien reportó y todas las partes del envío: moderar un reporte de chat toca a todos ellos.
  app.get(
    "/chat-reports/:id/parties",
    {
      schema: {
        hide: true,
        params: adminInternalSchemas.idParam,
        response: { 200: adminInternalSchemas.chatReportPartiesResponse },
      },
    },
    async (request: FastifyRequest): Promise<ChatReportParties> => {
      const { id } = request.params as { id: string };
      const report = await chatRepository.findReportById(id);
      const parties = report ? await shipmentRepository.findParties(report.shipmentId) : null;
      if (!report || !parties) throw new ApiError(404, "NOT_FOUND", "Reporte no encontrado.");

      const partyIds = new Set<string>([report.reporterId, parties.senderId, ...parties.formerReceiverIds]);
      if (parties.carrierId) partyIds.add(parties.carrierId);
      if (parties.receiverId) partyIds.add(parties.receiverId);

      return { reportId: report.id, shipmentId: report.shipmentId, reporterId: report.reporterId, partyIds: [...partyIds] };
    },
  );

  // MOVO-294: secciones de la ficha de un usuario en el panel (envíos, viajes, calificaciones).
  const adminUsers = createAdminUsersService(app.db);

  app.get(
    "/admin/users/:id/shipments",
    {
      schema: {
        hide: true,
        params: adminInternalSchemas.idParam,
        querystring: adminInternalSchemas.userShipmentsQuery,
        response: { 200: adminInternalSchemas.userShipmentsResponse },
      },
    },
    async (request: FastifyRequest): Promise<AdminUserShipmentRowPage> => {
      const { id } = request.params as { id: string };
      const { role, status, page, pageSize } = request.query as {
        role?: AdminShipmentRole;
        status?: ShipmentStatus;
        page: number;
        pageSize: number;
      };
      return adminUsers.listShipments(id, { ...(role ? { role } : {}), ...(status ? { status } : {}) }, { page, pageSize });
    },
  );

  app.get(
    "/admin/users/:id/trips",
    {
      schema: {
        hide: true,
        params: adminInternalSchemas.idParam,
        querystring: adminInternalSchemas.userTripsQuery,
        response: { 200: adminInternalSchemas.userTripsResponse },
      },
    },
    async (request: FastifyRequest): Promise<AdminUserTripPage> => {
      const { id } = request.params as { id: string };
      const { status, page, pageSize } = request.query as { status?: TripStatus; page: number; pageSize: number };
      return adminUsers.listTrips(id, status ? { status } : {}, { page, pageSize });
    },
  );

  app.get(
    "/admin/users/:id/ratings",
    {
      schema: {
        hide: true,
        params: adminInternalSchemas.idParam,
        querystring: adminInternalSchemas.userRatingsQuery,
        response: { 200: adminInternalSchemas.userRatingsResponse },
      },
    },
    async (request: FastifyRequest): Promise<AdminUserRatingRowPage> => {
      const { id } = request.params as { id: string };
      const { page, pageSize } = request.query as { page: number; pageSize: number };
      return adminUsers.listRatings(id, { page, pageSize });
    },
  );

  // MOVO-297: efectos de una sanción, los llama `svc-admin` al sancionar (MOVO-36).
  const offerRepository = createOfferRepository(app.db);
  const notificationsClient = opts.notificationsClient ?? createNotificationsClient(app.config);
  // Cancelar un `published` no cobra penalidad ni toca un hold: alcanza con el repositorio de ofertas.
  const shipmentsService = createShipmentsService(
    shipmentRepository,
    opts.usersClient ?? createUsersClient(app.config),
    notificationsClient,
    app.log,
    { offerRepository }
  );
  const sanctionEffects = createSanctionEffectsService({
    db: app.db,
    redis: app.redis,
    offerRepository,
    tripRepository: createTripRepository(app.db),
    cancelShipment: (shipmentId, senderId, reason) => shipmentsService.cancelShipment(shipmentId, senderId, reason),
    notificationsClient,
    logger: app.log,
  });

  app.get(
    "/users/:id/in-progress-shipments",
    {
      schema: {
        hide: true,
        params: adminInternalSchemas.idParam,
        response: { 200: adminInternalSchemas.inProgressShipmentsResponse },
      },
    },
    async (request: FastifyRequest): Promise<InProgressShipment[]> => {
      const { id } = request.params as { id: string };
      return sanctionEffects.listInProgressShipments(id);
    },
  );

  app.post(
    "/users/:id/withdraw-open-activity",
    {
      schema: {
        hide: true,
        params: adminInternalSchemas.idParam,
        response: { 200: adminInternalSchemas.withdrawOpenActivityResponse },
      },
    },
    async (request: FastifyRequest): Promise<WithdrawOpenActivityResult> => {
      const { id } = request.params as { id: string };
      return sanctionEffects.withdrawOpenActivity(id);
    },
  );
}
