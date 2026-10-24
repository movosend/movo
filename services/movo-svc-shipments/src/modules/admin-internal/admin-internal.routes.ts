import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import {
  ACTIVE_SHIPMENT_STATUSES,
  AdminShipmentRole,
  AdminUserRatingRowPage,
  AdminUserShipmentRowPage,
  AdminUserTripPage,
  ADMIN_SHIPMENT_GROUP_STATUSES,
  ADMIN_SHIPMENTS_DEFAULT_LIMIT,
  AdminChatMessage,
  AdminChatPage,
  AdminShipmentDetail,
  AdminShipmentEvent,
  AdminShipmentGroup,
  AdminShipmentOffer,
  AdminShipmentPage,
  AdminShipmentPhoto,
  AdminShipmentRow,
  ApiError,
  ChatParticipantRole,
  ChatReportParties,
  decomposeOfferGrossPrice,
  estimateMpFeeArs,
  estimateReceivedArs,
  getCommissionConfig,
  InProgressShipment,
  ShipmentParties,
  ShipmentStatus,
  WithdrawOpenActivityResult,
} from "@movo/shared";
import { TripStatus } from "../../generated/prisma/client";
import { createUsersClient, UsersClient } from "../../adapters/users-client";
import { createStorageProvider, StorageProvider } from "../../adapters/storage-provider";
import { isChatArchived, resolveChatAccess } from "../../domain/chat-window";
import { fundingPayUntil } from "../funding/funding.service";
import {
  AdminShipmentRecord,
  createAdminShipmentRepository,
  InvalidAdminCursorError,
} from "../../repositories/admin-shipment-repository";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { createChatRepository, InvalidChatCursorError } from "../../repositories/chat-repository";
import { adminInternalSchemas } from "./admin-internal.schema";
import { createAdminUsersService } from "./admin-users.service";
import { createSanctionEffectsService } from "./sanction-effects.service";
import { createOfferRepository } from "../../repositories/offer-repository";
import type { Offer } from "../../models/offer";
import { createTripRepository } from "../../repositories/trip-repository";
import { createShipmentsService } from "../shipments/shipments.service";
import { createNotificationsClient, NotificationsClient } from "../../adapters/notifications-client";

export interface AdminInternalRoutesOptions extends FastifyPluginOptions {
  /** Overrides solo para tests, mismo criterio que en `shipmentsRoutes`. */
  usersClient?: UsersClient;
  storageProvider?: StorageProvider;
  notificationsClient?: NotificationsClient;
}

/** Cuánto se espera a svc-users para completar nombres faltantes: es un dato accesorio del listado. */
const NAME_HEAL_BUDGET_MS = 2000;
const NAME_HEAL_MAX_USERS = 30;
// Cuentas que svc-users no encontró (eliminadas): su nombre nunca se completa, así que no se vuelven a
// consultar en cada listado. En memoria y con vencimiento; si se reinicia el servicio, se reintenta una vez.
const NAME_HEAL_NOT_FOUND_TTL_MS = 60 * 60 * 1000;

const isoOrNull = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null);
/** Las columnas `@db.Date` / `@db.Time` guardan reloj de pared anclado en UTC (gotcha de MOVO-80). */
const dateOnly = (date: Date): string => date.toISOString().slice(0, 10);
const timeOnly = (date: Date): string => date.toISOString().slice(11, 16);

/**
 * Módulo interno de `svc-admin` (no pasa por el gateway, solo es alcanzable dentro de la red Docker
 * interna, ADR-010; mismo patrón que `mutual-connections`). Sin `x-user-id`: quien decide el acceso es
 * `svc-admin`. Casi todo es de solo lectura; la excepción es `POST /users/:id/withdraw-open-activity`
 * (MOVO-297), que cancela envíos, retira ofertas, cancela viajes y manda push: no se reintenta a ciegas
 * más allá de su idempotencia ni se trata como inocuo.
 *
 * - MOVO-288: las partes de un envío o de un reporte de chat, para la regla de conflicto de interés
 *   (un admin no puede actuar sobre algo en lo que es parte).
 * - MOVO-294: las secciones de la ficha de un usuario del panel.
 * - MOVO-325: listado, detalle, eventos, fotos y chat de los envíos para el panel.
 * - MOVO-297: los efectos de una sanción sobre un usuario (envíos en curso y retiro de actividad abierta).
 */
export default async function adminInternalRoutes(app: FastifyInstance, opts: AdminInternalRoutesOptions) {
  const shipmentRepository = createShipmentRepository(app.db);
  const chatRepository = createChatRepository(app.db);
  const adminShipmentRepository = createAdminShipmentRepository(app.db);
  const offerRepository = createOfferRepository(app.db);
  const usersClient = opts.usersClient ?? createUsersClient(app.config);
  const storageProvider = opts.storageProvider ?? createStorageProvider(app.config);
  const fundingConfig = {
    paymentTimeoutMinutes: app.config.FUNDING_PAYMENT_TIMEOUT_MINUTES,
    releaseHoursBeforePickup: app.config.FUNDING_RELEASE_HOURS_BEFORE_PICKUP,
  };

  function toRow({ row, names }: AdminShipmentRecord): AdminShipmentRow {
    const status = row.status as ShipmentStatus;
    const agreed = row.agreedPriceArs ? row.agreedPriceArs.toNumber() : null;
    const suggested = row.suggestedPriceArs ? row.suggestedPriceArs.toNumber() : null;
    const hasCarrierPrice = row.carrierId !== null && agreed !== null;
    const isFunding = status === ShipmentStatus.ASSIGNMENT_PENDING || status === ShipmentStatus.ASSIGNED_UNFUNDED;

    return {
      id: row.id,
      code: row.id.slice(0, 8),
      status,
      sender: { id: row.senderId, name: names.sender },
      carrier: row.carrierId ? { id: row.carrierId, name: names.carrier } : null,
      receiver: { id: row.receiverId, name: names.receiver },
      pickupCity: row.pickupCity,
      pickupAddress: row.pickupAddress,
      deliveryCity: row.deliveryCity,
      deliveryAddress: row.deliveryAddress,
      pickupDate: dateOnly(row.pickupDate),
      pickupTimeWindowStart: timeOnly(row.pickupTimeWindowStart),
      pickupTimeWindowEnd: timeOnly(row.pickupTimeWindowEnd),
      priceArs: hasCarrierPrice ? agreed : suggested,
      priceKind: hasCarrierPrice ? "agreed" : suggested !== null ? "suggested" : null,
      lastStatusChangeAt: (row.lastStatusChangedAt ?? row.createdAt).toISOString(),
      delayed: status === ShipmentStatus.IN_TRANSIT && row.transitAnomalyFlaggedAt !== null,
      disputeId: null,
      fundingDeadline: isFunding ? fundingPayUntil({ ...row, status }, fundingConfig).toISOString() : null,
      redesignationDeadline:
        status === ShipmentStatus.REJECTED_BY_RECEIVER ? isoOrNull(row.receiverRedesignationDeadline) : null,
    };
  }

  /**
   * Completa los nombres que todavía no conocemos (envíos anteriores a MOVO-325 sin oferta) con lo que
   * diga svc-users. Best-effort y con tope de tiempo: si svc-users no contesta, el listado sale igual
   * con el nombre en `null` y lo reintenta la próxima vez.
   */
  const notFoundUntil = new Map<string, number>();

  async function healMissingNames(records: AdminShipmentRecord[]): Promise<void> {
    const now = Date.now();
    const missing = (await adminShipmentRepository.findMissingNames(records))
      .filter((userId) => (notFoundUntil.get(userId) ?? 0) <= now)
      .slice(0, NAME_HEAL_MAX_USERS);
    if (missing.length === 0) return;

    const found = new Map<string, string>();
    const lookups = Promise.all(
      missing.map(async (userId) => {
        try {
          const profile = await usersClient.findPublicProfile(userId, userId);
          if (profile?.fullName) found.set(userId, profile.fullName);
          else if (profile === null) notFoundUntil.set(userId, Date.now() + NAME_HEAL_NOT_FOUND_TTL_MS);
        } catch {
          // svc-users caído: el nombre queda en null y se reintenta en el próximo listado.
        }
      }),
    );
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      lookups,
      new Promise((resolve) => {
        timer = setTimeout(resolve, NAME_HEAL_BUDGET_MS);
      }),
    ]);
    clearTimeout(timer);
    if (found.size === 0) return;

    try {
      await shipmentRepository.recordDisplayNames([...found].map(([userId, name]) => ({ userId, name })));
    } catch (err) {
      app.log.warn({ err, event: "display_names_record_failed" }, "No se pudieron guardar los nombres completados");
    }
    for (const record of records) {
      record.names.sender ??= found.get(record.row.senderId) ?? null;
      record.names.receiver ??= found.get(record.row.receiverId) ?? null;
      if (record.row.carrierId) record.names.carrier ??= found.get(record.row.carrierId) ?? null;
    }
  }

  const toEvent = (event: Awaited<ReturnType<typeof shipmentRepository.listEvents>>[number]): AdminShipmentEvent => ({
    id: event.id,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    actorId: event.actorId,
    reason: event.reason,
    createdAt: event.createdAt.toISOString(),
  });

  function toAdminOffer(offer: Offer): AdminShipmentOffer {
    const commissionRate = getCommissionConfig().movoCommissionRate;
    const { netArs, commissionAmountArs } = decomposeOfferGrossPrice(offer.priceOffered, commissionRate);
    // Las franjas de la oferta se guardan como "HH:MM:SS" de pared, sin anclaje (no son `@db.Time`).
    const hhmm = (value: string | null): string | null => (value ? value.slice(0, 5) : null);
    return {
      id: offer.id,
      carrierId: offer.carrierId,
      carrierName: offer.carrierNameAtOffer,
      carrierRatingAtOffer: offer.carrierRatingAtOffer,
      status: offer.status,
      priceArs: offer.priceOffered,
      netArs,
      commissionArs: commissionAmountArs,
      commissionRate,
      mpFeeEstimateArs: estimateMpFeeArs(offer.priceOffered),
      receivedEstimateArs: estimateReceivedArs(netArs, offer.priceOffered),
      offeredDate: dateOnly(offer.offeredDate),
      pickupTimeWindowStart: hhmm(offer.offeredPickupTimeWindowStart),
      pickupTimeWindowEnd: hhmm(offer.offeredPickupTimeWindowEnd),
      estimatedDeliveryDate: offer.estimatedDeliveryDate ? dateOnly(offer.estimatedDeliveryDate) : null,
      estimatedDeliveryTimeWindowStart: hhmm(offer.estimatedDeliveryTimeWindowStart),
      estimatedDeliveryTimeWindowEnd: hhmm(offer.estimatedDeliveryTimeWindowEnd),
      message: offer.message,
      tripId: offer.tripId,
      createdAt: offer.createdAt.toISOString(),
      viewedAtBySender: isoOrNull(offer.viewedAtBySender),
      respondedAt: isoOrNull(offer.respondedAt),
      expiresAt: isoOrNull(offer.expiresAt),
    };
  }

  async function requireRecord(id: string): Promise<AdminShipmentRecord> {
    const record = await adminShipmentRepository.findRecord(id);
    if (!record) throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
    return record;
  }

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

  // Por defecto los activos; `status` o `group` piden otros (los cerrados incluidos). Orden: último cambio de estado.
  app.get(
    "/admin/shipments",
    { schema: { hide: true, querystring: adminInternalSchemas.listQuery } },
    async (request: FastifyRequest): Promise<AdminShipmentPage> => {
      const query = request.query as {
        group?: AdminShipmentGroup;
        status?: ShipmentStatus;
        city?: string;
        from?: string;
        to?: string;
        q?: string;
        cursor?: string;
        limit?: number;
        alert?: boolean;
      };
      const search = {
        ...(query.city ? { city: query.city } : {}),
        ...(query.from ? { from: new Date(query.from) } : {}),
        ...(query.to ? { to: new Date(query.to) } : {}),
        ...(query.q ? { q: query.q } : {}),
        ...(query.alert ? { alert: true } : {}),
      };
      // `status` es lo más específico; después la pestaña; sin ninguno, los activos.
      const statuses: readonly ShipmentStatus[] = query.status
        ? [query.status]
        : query.group
          ? ADMIN_SHIPMENT_GROUP_STATUSES[query.group]
          : ACTIVE_SHIPMENT_STATUSES;

      let page;
      try {
        page = await adminShipmentRepository.list({
          ...search,
          statuses,
          limit: query.limit ?? ADMIN_SHIPMENTS_DEFAULT_LIMIT,
          ...(query.cursor ? { cursor: query.cursor } : {}),
        });
      } catch (err) {
        if (err instanceof InvalidAdminCursorError) {
          throw new ApiError(400, "VALIDATION_FAILED", "El cursor de paginación es inválido.");
        }
        throw err;
      }

      const [counts] = await Promise.all([adminShipmentRepository.counts(search), healMissingNames(page.items)]);
      return { items: page.items.map(toRow), nextCursor: page.nextCursor, ...counts };
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
    "/admin/shipments/:id",
    { schema: { hide: true, params: adminInternalSchemas.idParam } },
    async (request: FastifyRequest): Promise<AdminShipmentDetail> => {
      const { id } = request.params as { id: string };
      const record = await requireRecord(id);
      await healMissingNames([record]);
      const { row } = record;
      return {
        ...toRow(record),
        packageType: row.packageType,
        weightKg: row.weightKg.toNumber(),
        lengthCm: row.lengthCm.toNumber(),
        widthCm: row.widthCm.toNumber(),
        heightCm: row.heightCm.toNumber(),
        description: row.description,
        urgent: row.urgent,
        // `acceptOffer` guarda en `original*` lo pedido antes de pisarlo con lo acordado (MOVO-258 D3).
        requestedPickupDate: dateOnly(row.originalPickupDate ?? row.pickupDate),
        requestedPickupTimeWindowStart: timeOnly(row.originalPickupTimeWindowStart ?? row.pickupTimeWindowStart),
        requestedPickupTimeWindowEnd: timeOnly(row.originalPickupTimeWindowEnd ?? row.pickupTimeWindowEnd),
        pickupLat: row.pickupLat.toNumber(),
        pickupLng: row.pickupLng.toNumber(),
        deliveryLat: row.deliveryLat.toNumber(),
        deliveryLng: row.deliveryLng.toNumber(),
        suggestedPriceArs: row.suggestedPriceArs ? row.suggestedPriceArs.toNumber() : null,
        agreedPriceArs: row.agreedPriceArs ? row.agreedPriceArs.toNumber() : null,
        paymentMethod: row.paymentMethod,
        highDemand: row.highDemand,
        estimatedDeliveryDate: row.estimatedDeliveryDate ? dateOnly(row.estimatedDeliveryDate) : null,
        deliveredAt: isoOrNull(row.deliveredAt),
        receiverConfirmationDeadline: isoOrNull(row.receiverConfirmationDeadline),
        transitAnomalyFlaggedAt: isoOrNull(row.transitAnomalyFlaggedAt),
        chatStartedAt: isoOrNull(row.chatStartedAt),
        cancellationPenaltyArs: row.cancellationPenaltyArs ? row.cancellationPenaltyArs.toNumber() : null,
        createdAt: row.createdAt.toISOString(),
      };
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

  app.get(
    "/admin/shipments/:id/events",
    { schema: { hide: true, params: adminInternalSchemas.idParam } },
    async (request: FastifyRequest): Promise<AdminShipmentEvent[]> => {
      const { id } = request.params as { id: string };
      await requireRecord(id);
      return (await shipmentRepository.listEvents(id)).map(toEvent);
    },
  );

  // Todas las ofertas del envío, cerradas incluidas, con el desglose de "Cómo se reparte" de mobile.
  app.get(
    "/admin/shipments/:id/offers",
    { schema: { hide: true, params: adminInternalSchemas.idParam } },
    async (request: FastifyRequest): Promise<AdminShipmentOffer[]> => {
      const { id } = request.params as { id: string };
      await requireRecord(id);
      return (await offerRepository.listByShipment(id)).map(toAdminOffer);
    },
  );

  // Fotos de la evidencia con URL firmada de vida corta (la que fije el StorageProvider).
  app.get(
    "/admin/shipments/:id/photos",
    { schema: { hide: true, params: adminInternalSchemas.idParam } },
    async (request: FastifyRequest): Promise<AdminShipmentPhoto[]> => {
      const { id } = request.params as { id: string };
      await requireRecord(id);
      const photos = await shipmentRepository.listPhotos(id);
      return Promise.all(
        photos.map(async (photo) => ({
          id: photo.id,
          stage: photo.stage,
          url: (await storageProvider.createDownloadUrl(photo.s3Key)).url,
          createdAt: photo.createdAt.toISOString(),
        })),
      );
    },
  );

  // Todo el hilo, sin ocultar nada por bloqueos ni por `chat_started_at` (ADR-040: el historial es
  // evidencia). `partiesAccess` dice qué pueden hacer hoy el emisor, el transportista y el receptor con las
  // reglas de docs/chat/README.md; el receptor anterior (ADR-038) nunca pasa de `read_only`, así que no
  // cambia ese valor y no se modela aparte.
  app.get(
    "/admin/shipments/:id/chat/messages",
    { schema: { hide: true, params: adminInternalSchemas.idParam, querystring: adminInternalSchemas.chatQuery } },
    async (request: FastifyRequest): Promise<AdminChatPage> => {
      const { id } = request.params as { id: string };
      const { cursor, limit } = request.query as { cursor?: string; limit?: number };
      const { row } = await requireRecord(id);

      const roleOf = (userId: string): ChatParticipantRole | null =>
        userId === row.senderId
          ? "sender"
          : userId === row.carrierId
            ? "carrier"
            : userId === row.receiverId
              ? "receiver"
              : null;

      let page;
      try {
        page = await chatRepository.listPage(id, limit ?? ADMIN_SHIPMENTS_DEFAULT_LIMIT, cursor, null);
      } catch (err) {
        if (err instanceof InvalidChatCursorError) {
          throw new ApiError(400, "VALIDATION_FAILED", "El cursor de paginación es inválido.");
        }
        throw err;
      }

      const facts = {
        status: row.status as ShipmentStatus,
        senderId: row.senderId,
        receiverId: row.receiverId,
        carrierId: row.carrierId,
        deliveredAt: row.deliveredAt,
      };
      const [reports, events] = await Promise.all([
        adminShipmentRepository.listChatReports(id),
        shipmentRepository.listEvents(id),
      ]);

      const items: AdminChatMessage[] = page.items.map((message) => ({
        id: message.id,
        authorId: message.authorId,
        authorName: message.authorName,
        authorRole: roleOf(message.authorId),
        body: message.body,
        moderated: message.moderated,
        createdAt: message.createdAt.toISOString(),
      }));

      return {
        items,
        nextCursor: page.nextCursor,
        partiesAccess: resolveChatAccess({ shipment: facts, viewerId: row.senderId, viewerRoles: [] }),
        archived: isChatArchived(facts, new Date()),
        reports: reports.map((report) => ({
          reporterId: report.reporterId,
          reporterRole: roleOf(report.reporterId),
          createdAt: report.createdAt.toISOString(),
        })),
        events: events.map(toEvent),
      };
    },
  );

  // MOVO-297: efectos de una sanción, los llama `svc-admin` al sancionar (MOVO-36).
  const notificationsClient = opts.notificationsClient ?? createNotificationsClient(app.config);
  // Grafo mínimo y deliberadamente distinto del de `shipmentsRoutes` (sin `paymentsClient`, `pricingClient`,
  // `quoteStore` ni `settleCancellationPenalty`): solo se cancelan envíos sin transportista ni hold
  // (`awaiting_receiver_confirmation`, `rejected_by_receiver`, `published`). Esa premisa no se asume: el
  // servicio de efectos pasa `onlyFrom` y `cancelShipment` aborta si el envío se comprometió entremedio.
  const shipmentsService = createShipmentsService(
    shipmentRepository,
    usersClient,
    notificationsClient,
    app.log,
    { offerRepository }
  );
  const sanctionEffects = createSanctionEffectsService({
    db: app.db,
    redis: app.redis,
    offerRepository,
    tripRepository: createTripRepository(app.db),
    cancelShipment: (shipmentId, senderId, reason, onlyFrom) =>
      shipmentsService.cancelShipment(shipmentId, senderId, reason, undefined, { onlyFrom }),
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
        body: adminInternalSchemas.withdrawOpenActivityBody,
        response: { 200: adminInternalSchemas.withdrawOpenActivityResponse },
      },
    },
    async (request: FastifyRequest): Promise<WithdrawOpenActivityResult> => {
      const { id } = request.params as { id: string };
      const body = request.body as { sanctionId?: string } | null | undefined;
      return sanctionEffects.withdrawOpenActivity(id, body?.sanctionId);
    },
  );
}
