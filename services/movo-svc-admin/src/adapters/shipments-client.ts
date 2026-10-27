import {
  AdminDisputeDetail,
  AdminDisputeHandshakeEvent,
  AdminDisputePage,
  AdminDisputeResolutionPreview,
  AdminDisputeTrace,
  InternalResolveDisputeRequest,
  ResolveDisputeResponse,
  AdminShipmentRole,
  AdminUserRatingRowPage,
  AdminUserShipmentRow,
  AdminUserShipmentRowPage,
  AdminUserTripPage,
  AdminChatPage,
  AdminShipmentDetail,
  AdminShipmentEvent,
  AdminShipmentOffer,
  AdminShipmentPage,
  AdminShipmentPhoto,
  AdminShipmentTracking,
  ApiError,
  ChatReportParties,
  InProgressShipment,
  OpenActivitySummary,
  ForceShipmentStatusRequest,
  ForceShipmentStatusResponse,
  ShipmentParties,
  WithdrawOpenActivityResult,
} from "@movo/shared";
import {
  createInternalClient,
  InternalClient,
  isNullableString,
  isRecord,
  isString,
  isStringArray,
  RequestContext,
} from "./internal-client";

export interface ShipmentsClient extends InternalClient {
  /** `GET /internal/shipments/:id/parties`. `null` si el envío no existe. */
  getShipmentParties(shipmentId: string, ctx: RequestContext): Promise<ShipmentParties | null>;
  /** `GET /internal/chat-reports/:id/parties`. `null` si el reporte no existe. */
  getChatReportParties(reportId: string, ctx: RequestContext): Promise<ChatReportParties | null>;

  // MOVO-294: secciones de la ficha. Con ids de usuario: los nombres los resuelve `svc-admin`.
  listUserShipments(userId: string, query: AdminUserShipmentsQuery, ctx: RequestContext): Promise<AdminUserShipmentRowPage>;
  listUserTrips(userId: string, query: AdminUserTripsQuery, ctx: RequestContext): Promise<AdminUserTripPage>;
  listUserRatings(userId: string, query: PageParams, ctx: RequestContext): Promise<AdminUserRatingRowPage>;
  /** `GET /internal/admin/shipments` (MOVO-325): `query` ya viene validada y se reenvía tal cual. */
  listAdminShipments(query: URLSearchParams, ctx: RequestContext): Promise<AdminShipmentPage>;
  /** `GET /internal/admin/shipments/:id`. `null` si el envío no existe. */
  getAdminShipment(shipmentId: string, ctx: RequestContext): Promise<AdminShipmentDetail | null>;
  /** `GET /internal/admin/shipments/:id/events`. `null` si el envío no existe. */
  getAdminShipmentEvents(shipmentId: string, ctx: RequestContext): Promise<AdminShipmentEvent[] | null>;
  /** `GET /internal/admin/shipments/:id/offers`, todas (cerradas incluidas). `null` si el envío no existe. */
  getAdminShipmentOffers(shipmentId: string, ctx: RequestContext): Promise<AdminShipmentOffer[] | null>;
  /** `GET /internal/admin/shipments/:id/photos`, con URL firmada de vida corta. `null` si el envío no existe. */
  getAdminShipmentPhotos(shipmentId: string, ctx: RequestContext): Promise<AdminShipmentPhoto[] | null>;
  /** `GET /internal/admin/shipments/:id/chat/messages`. `null` si el envío no existe. */
  getAdminShipmentChat(shipmentId: string, query: URLSearchParams, ctx: RequestContext): Promise<AdminChatPage | null>;
  /** `GET /internal/admin/shipments/:id/tracking` (MOVO-327). `null` si el envío no existe. */
  getAdminShipmentTracking(shipmentId: string, ctx: RequestContext): Promise<AdminShipmentTracking | null>;

  // MOVO-299 sobre los internos de MOVO-297/299. Un usuario sin actividad es una lista vacía, nunca un 404.
  /** `GET /internal/users/:id/in-progress-shipments`: lo que impide inhabilitar. */
  listInProgressShipments(userId: string, ctx: RequestContext): Promise<InProgressShipment[]>;
  /** `GET /internal/users/:id/open-activity`: vista previa del retiro, sin tocar nada. */
  getOpenActivity(userId: string, ctx: RequestContext): Promise<OpenActivitySummary>;
  /**
   * `POST /internal/users/:id/withdraw-open-activity`. Idempotente. Responde 200 aunque haya
   * `failures`: el retiro parcial lo decide quien llama.
   */
  withdrawOpenActivity(userId: string, sanctionId: string, ctx: RequestContext): Promise<WithdrawOpenActivityResult>;
  /**
   * `POST /internal/admin/shipments/:id/force-status` (MOVO-331, DD-055). Los rechazos de negocio
   * (`STATUS_CHANGED`, `TRANSITION_NOT_ALLOWED`, `HOLD_NOT_AUTHORIZED`, `FORCE_STATUS_EFFECT_FAILED`...)
   * se relanzan con su código y `details`; una caída es 502 `SHIPMENTS_SERVICE_UNAVAILABLE` (la bitácora
   * la toma por "pudo haberse aplicado"). 404 `NOT_FOUND` si el envío no existe.
   */
  forceShipmentStatus(shipmentId: string, body: ForceShipmentStatusRequest, ctx: RequestContext): Promise<ForceShipmentStatusResponse>;

  // MOVO-337: disputas para el panel (`/internal/admin/disputes*` de `svc-shipments`).
  /** `GET /internal/admin/disputes`: `query` ya viene validada y se reenvía tal cual. */
  listAdminDisputes(query: URLSearchParams, ctx: RequestContext): Promise<AdminDisputePage>;
  /** `GET /internal/admin/disputes/:id`. `null` si la disputa no existe. */
  getAdminDispute(disputeId: string, ctx: RequestContext): Promise<AdminDisputeDetail | null>;
  /** `GET /internal/admin/disputes/:id/parties` (regla de conflicto de interés). `null` si la disputa no existe. */
  getDisputeParties(disputeId: string, ctx: RequestContext): Promise<(ShipmentParties & { shipmentId: string }) | null>;
  /** `GET /internal/admin/disputes/:id/handshake`. `null` si la disputa no existe. */
  getDisputeHandshake(disputeId: string, ctx: RequestContext): Promise<AdminDisputeHandshakeEvent[] | null>;
  /** `GET /internal/admin/disputes/:id/trace`. `null` si la disputa no existe. */
  getDisputeTrace(disputeId: string, ctx: RequestContext): Promise<AdminDisputeTrace | null>;
  /** `GET /internal/admin/disputes/:id/resolution-preview`. `null` si la disputa no existe. */
  getDisputeResolutionPreview(disputeId: string, ctx: RequestContext): Promise<AdminDisputeResolutionPreview | null>;
  /**
   * `POST /internal/admin/disputes/:id/resolve` (MOVO-337, DD-056). Los rechazos de negocio (`DISPUTE_*`,
   * `HOLD_NOT_AUTHORIZED`, `SETTLEMENT_NOT_REFUNDABLE`...) se relanzan con su código y `details`.
   * `DISPUTE_PAYMENT_FAILED` es un 502 de negocio: la disputa quedó `resolving`, pero la plata pudo haberse movido
   * (corte tras capturar, timeout de payments), así que la bitácora lo registra como `unknown`, no como `failed`.
   */
  resolveDispute(disputeId: string, body: InternalResolveDisputeRequest, ctx: RequestContext): Promise<ResolveDisputeResponse>;
}

/** Resolver mueve plata en `svc-payments` (una captura puede tardar ~50 s): más holgado que el cambio de estado. */
const RESOLVE_DISPUTE_TIMEOUT_MS = 90_000;

const isDisputeRow = (value: unknown): boolean =>
  isRecord(value) && isString(value.id) && isString(value.shipmentId) && isString(value.status) && isString(value.reason);

const isAdminDisputePage = (body: unknown): body is AdminDisputePage =>
  isRecord(body) && Array.isArray(body.items) && body.items.every(isDisputeRow) && isNullableString(body.nextCursor) && isRecord(body.statusCounts);

const isAdminDisputeDetail = (body: unknown): body is AdminDisputeDetail =>
  isDisputeRow(body) && isRecord(body) && isString(body.description) && Array.isArray(body.statements);

const isDisputeParties = (body: unknown): body is ShipmentParties & { shipmentId: string } =>
  isRecord(body) && isString(body.shipmentId) && isString(body.senderId) && isNullableString(body.carrierId) && isNullableString(body.receiverId);

const isHandshakeList = (body: unknown): body is AdminDisputeHandshakeEvent[] =>
  Array.isArray(body) && body.every((event) => isRecord(event) && isString(event.id) && isString(event.stage));

const isDisputeTrace = (body: unknown): body is AdminDisputeTrace =>
  isRecord(body) && typeof body.available === "boolean" && Array.isArray(body.points);

const isResolutionPreview = (body: unknown): body is AdminDisputeResolutionPreview =>
  isRecord(body) && isString(body.statusAtOpen) && typeof body.stakeArs === "number" && Array.isArray(body.outcomes) && Array.isArray(body.presets);

const isResolveDisputeResponse = (body: unknown): body is ResolveDisputeResponse =>
  isRecord(body) && isString(body.disputeId) && isString(body.outcome) && body.status === "resolved" && typeof body.replayed === "boolean";

/** El servicio llama a payments (liberar o capturar el hold) antes de responder: más holgado que los 5 s base. */
const FORCE_STATUS_TIMEOUT_MS = 30_000;

const isForceStatusResponse = (body: unknown): body is ForceShipmentStatusResponse =>
  isRecord(body) &&
  isString(body.shipmentId) &&
  isString(body.fromStatus) &&
  isString(body.toStatus) &&
  (body.kind === "manual" || body.kind === "forced") &&
  typeof body.replayed === "boolean";

export interface PageParams {
  page: number;
  pageSize: number;
}

export interface AdminUserShipmentsQuery extends PageParams {
  role?: AdminShipmentRole;
  status?: string;
}

export interface AdminUserTripsQuery extends PageParams {
  status?: string;
}

const isNumber = (value: unknown): value is number => typeof value === "number";

const isShipmentRow = (value: unknown): value is AdminUserShipmentRow =>
  isRecord(value) && isString(value.id) && isString(value.status) && isString(value.senderId) && isNullableString(value.carrierId) && isString(value.receiverId);

const isShipmentPage = (body: unknown): body is AdminUserShipmentRowPage =>
  isRecord(body) &&
  Array.isArray(body.items) &&
  body.items.every(isShipmentRow) &&
  isNumber(body.total) &&
  isRecord(body.counts) &&
  isNumber(body.counts.sender) &&
  isNumber(body.counts.carrier) &&
  isNumber(body.counts.receiver);

const isTripPage = (body: unknown): body is AdminUserTripPage =>
  isRecord(body) && Array.isArray(body.items) && body.items.every((item) => isRecord(item) && isString(item.id) && isString(item.status)) && isNumber(body.total);

const isRatingPage = (body: unknown): body is AdminUserRatingRowPage =>
  isRecord(body) &&
  (body.average === null || isNumber(body.average)) &&
  isNumber(body.count) &&
  Array.isArray(body.items) &&
  body.items.every((item) => isRecord(item) && isNumber(item.score) && isString(item.raterId));

/** Arma el querystring sin los filtros vacíos. */
function queryOf(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  return query.toString();
}

const isAdminShipmentRow = (item: unknown): boolean =>
  isRecord(item) && isString(item.id) && isString(item.status) && isRecord(item.sender) && isRecord(item.receiver);

const isEvent = (item: unknown): item is AdminShipmentEvent =>
  isRecord(item) && isString(item.id) && isString(item.toStatus);
const isPhoto = (item: unknown): item is AdminShipmentPhoto =>
  isRecord(item) && isString(item.id) && isString(item.url);
const isOffer = (item: unknown): item is AdminShipmentOffer =>
  isRecord(item) && isString(item.id) && isString(item.status) && isNumber(item.priceArs) && isNumber(item.receivedEstimateArs);

const isAdminShipmentPage = (body: unknown): body is AdminShipmentPage =>
  isRecord(body) &&
  Array.isArray(body.items) &&
  body.items.every(isAdminShipmentRow) &&
  isNullableString(body.nextCursor) &&
  isRecord(body.counts);

const isAdminShipmentDetail = (body: unknown): body is AdminShipmentDetail =>
  isAdminShipmentRow(body) && isRecord(body) && isString(body.packageType) && typeof body.weightKg === "number";
const isEventList = (body: unknown): body is AdminShipmentEvent[] => Array.isArray(body) && body.every(isEvent);
const isPhotoList = (body: unknown): body is AdminShipmentPhoto[] => Array.isArray(body) && body.every(isPhoto);
const isOfferList = (body: unknown): body is AdminShipmentOffer[] => Array.isArray(body) && body.every(isOffer);

const isAdminChatPage = (body: unknown): body is AdminChatPage =>
  isRecord(body) &&
  Array.isArray(body.items) &&
  isNullableString(body.nextCursor) &&
  isString(body.partiesAccess) &&
  Array.isArray(body.reports) &&
  isEventList(body.events);

const isAdminShipmentTracking = (body: unknown): body is AdminShipmentTracking =>
  isRecord(body) &&
  isString(body.shipmentId) &&
  isString(body.state) &&
  isRecord(body.origin) &&
  isRecord(body.destination) &&
  Array.isArray(body.trace) &&
  typeof body.signalLost === "boolean" &&
  isString(body.serverTime);

const isShipmentParties = (body: unknown): body is ShipmentParties =>
  isRecord(body) &&
  isString(body.shipmentId) &&
  isString(body.senderId) &&
  isNullableString(body.carrierId) &&
  isNullableString(body.receiverId) &&
  isStringArray(body.formerReceiverIds);

const isChatReportParties = (body: unknown): body is ChatReportParties =>
  isRecord(body) &&
  isString(body.reportId) &&
  isString(body.shipmentId) &&
  isString(body.reporterId) &&
  isStringArray(body.partyIds);

const isInProgress = (item: unknown): item is InProgressShipment =>
  isRecord(item) && isString(item.id) && isString(item.shortId) && isString(item.status) && isString(item.userRole);
const isInProgressList = (body: unknown): body is InProgressShipment[] => Array.isArray(body) && body.every(isInProgress);

const isOpenActivity = (body: unknown): body is OpenActivitySummary =>
  isRecord(body) &&
  isNumber(body.shipments) &&
  isNumber(body.offers) &&
  isNumber(body.trips) &&
  isNumber(body.recurringSeries) &&
  isInProgressList(body.inProgressShipments);

const isWithdrawResult = (body: unknown): body is WithdrawOpenActivityResult =>
  isRecord(body) &&
  isStringArray(body.cancelledShipmentIds) &&
  isStringArray(body.withdrawnOfferIds) &&
  isStringArray(body.cancelledTripIds) &&
  isStringArray(body.stoppedRecurrenceTripIds) &&
  isNumber(body.notifiedCounterpartyCount) &&
  Array.isArray(body.failures) &&
  body.failures.every((failure) => isRecord(failure) && isString(failure.kind) && isString(failure.id));

export function createShipmentsClient(config: { SHIPMENTS_SERVICE_URL: string }): ShipmentsClient {
  const client = createInternalClient({
    baseUrl: config.SHIPMENTS_SERVICE_URL,
    serviceLabel: "envíos",
    unavailableCode: "SHIPMENTS_SERVICE_UNAVAILABLE",
  });

  return {
    ...client,
    getShipmentParties(shipmentId, ctx) {
      return client.request(`/internal/shipments/${encodeURIComponent(shipmentId)}/parties`, ctx, {
        isValid: isShipmentParties,
        notFoundCodes: ["NOT_FOUND"],
      });
    },
    getChatReportParties(reportId, ctx) {
      return client.request(`/internal/chat-reports/${encodeURIComponent(reportId)}/parties`, ctx, {
        isValid: isChatReportParties,
        notFoundCodes: ["NOT_FOUND"],
      });
    },

    // Sin `notFoundCodes`: un usuario sin envíos es una lista vacía, nunca un 404. Un 404 acá es
    // una ruta que el servicio no tiene todavía, y el cliente base lo trata como caída (502).
    async listUserShipments(userId, query, ctx) {
      const page = await client.request(`${userPath(userId)}/shipments?${queryOf({ ...query })}`, ctx, {
        isValid: isShipmentPage,
        notFoundCodes: [],
      });
      return page ?? { items: [], page: query.page, pageSize: query.pageSize, total: 0, counts: { sender: 0, carrier: 0, receiver: 0 } };
    },
    async listUserTrips(userId, query, ctx) {
      const page = await client.request(`${userPath(userId)}/trips?${queryOf({ ...query })}`, ctx, { isValid: isTripPage, notFoundCodes: [] });
      return page ?? { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
    },
    async listUserRatings(userId, query, ctx) {
      const page = await client.request(`${userPath(userId)}/ratings?${queryOf({ ...query })}`, ctx, { isValid: isRatingPage, notFoundCodes: [] });
      return page ?? { average: null, count: 0, items: [], page: query.page, pageSize: query.pageSize };
    },
    async listAdminShipments(query, ctx) {
      const page = await client.request(`/internal/admin/shipments?${query.toString()}`, ctx, {
        isValid: isAdminShipmentPage,
        notFoundCodes: [],
      });
      // Sin `notFoundCodes` el cliente base nunca devuelve null (un 404 es una ruta que falta: 502).
      if (!page) throw new Error("listAdminShipments: respuesta vacía");
      return page;
    },
    getAdminShipment(shipmentId, ctx) {
      return client.request(`/internal/admin/shipments/${encodeURIComponent(shipmentId)}`, ctx, {
        isValid: isAdminShipmentDetail,
        notFoundCodes: ["NOT_FOUND"],
      });
    },
    getAdminShipmentEvents(shipmentId, ctx) {
      return client.request(`/internal/admin/shipments/${encodeURIComponent(shipmentId)}/events`, ctx, {
        isValid: isEventList,
        notFoundCodes: ["NOT_FOUND"],
      });
    },
    getAdminShipmentOffers(shipmentId, ctx) {
      return client.request(`/internal/admin/shipments/${encodeURIComponent(shipmentId)}/offers`, ctx, {
        isValid: isOfferList,
        notFoundCodes: ["NOT_FOUND"],
      });
    },
    getAdminShipmentPhotos(shipmentId, ctx) {
      return client.request(`/internal/admin/shipments/${encodeURIComponent(shipmentId)}/photos`, ctx, {
        isValid: isPhotoList,
        notFoundCodes: ["NOT_FOUND"],
      });
    },
    getAdminShipmentChat(shipmentId, query, ctx) {
      const suffix = query.toString() ? `?${query.toString()}` : "";
      return client.request(`/internal/admin/shipments/${encodeURIComponent(shipmentId)}/chat/messages${suffix}`, ctx, {
        isValid: isAdminChatPage,
        notFoundCodes: ["NOT_FOUND"],
      });
    },
    async forceShipmentStatus(shipmentId, body, ctx) {
      const result = await client.request(`/internal/admin/shipments/${encodeURIComponent(shipmentId)}/force-status`, ctx, {
        method: "POST",
        body,
        timeoutMs: FORCE_STATUS_TIMEOUT_MS,
        relayServerErrorCodes: ["FORCE_STATUS_EFFECT_FAILED"],
        isValid: isForceStatusResponse,
        notFoundCodes: ["NOT_FOUND"],
      });
      if (!result) throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      return result;
    },
    async listAdminDisputes(query, ctx) {
      const page = await client.request(`/internal/admin/disputes?${query.toString()}`, ctx, {
        isValid: isAdminDisputePage,
        notFoundCodes: [],
      });
      if (!page) throw new Error("listAdminDisputes: respuesta vacía");
      return page;
    },
    getAdminDispute(disputeId, ctx) {
      return client.request(`${disputePath(disputeId)}`, ctx, { isValid: isAdminDisputeDetail, notFoundCodes: ["DISPUTE_NOT_FOUND"] });
    },
    getDisputeParties(disputeId, ctx) {
      return client.request(`${disputePath(disputeId)}/parties`, ctx, { isValid: isDisputeParties, notFoundCodes: ["DISPUTE_NOT_FOUND", "NOT_FOUND"] });
    },
    getDisputeHandshake(disputeId, ctx) {
      return client.request(`${disputePath(disputeId)}/handshake`, ctx, { isValid: isHandshakeList, notFoundCodes: ["DISPUTE_NOT_FOUND"] });
    },
    getDisputeTrace(disputeId, ctx) {
      return client.request(`${disputePath(disputeId)}/trace`, ctx, { isValid: isDisputeTrace, notFoundCodes: ["DISPUTE_NOT_FOUND"] });
    },
    getDisputeResolutionPreview(disputeId, ctx) {
      return client.request(`${disputePath(disputeId)}/resolution-preview`, ctx, {
        isValid: isResolutionPreview,
        notFoundCodes: ["DISPUTE_NOT_FOUND"],
      });
    },
    async resolveDispute(disputeId, body, ctx) {
      const result = await client.request(`${disputePath(disputeId)}/resolve`, ctx, {
        method: "POST",
        body,
        actorId: body.adminId,
        timeoutMs: RESOLVE_DISPUTE_TIMEOUT_MS,
        relayServerErrorCodes: ["DISPUTE_PAYMENT_FAILED"],
        isValid: isResolveDisputeResponse,
        notFoundCodes: ["DISPUTE_NOT_FOUND"],
      });
      if (!result) throw new ApiError(404, "DISPUTE_NOT_FOUND", "Disputa no encontrada.");
      return result;
    },
    getAdminShipmentTracking(shipmentId, ctx) {
      return client.request(`/internal/admin/shipments/${encodeURIComponent(shipmentId)}/tracking`, ctx, {
        isValid: isAdminShipmentTracking,
        notFoundCodes: ["NOT_FOUND"],
      });
    },

    async listInProgressShipments(userId, ctx) {
      const list = await client.request(`${internalUserPath(userId)}/in-progress-shipments`, ctx, { isValid: isInProgressList, notFoundCodes: [] });
      return list ?? [];
    },
    async getOpenActivity(userId, ctx) {
      const summary = await client.request(`${internalUserPath(userId)}/open-activity`, ctx, { isValid: isOpenActivity, notFoundCodes: [] });
      // Sin `notFoundCodes` el cliente base nunca devuelve null (un 404 es una ruta que falta: 502).
      if (!summary) throw new Error("getOpenActivity: respuesta vacía");
      return summary;
    },
    async withdrawOpenActivity(userId, sanctionId, ctx) {
      const result = await client.request(`${internalUserPath(userId)}/withdraw-open-activity`, ctx, {
        method: "POST",
        body: { sanctionId },
        isValid: isWithdrawResult,
        notFoundCodes: [],
        // Retira uno por uno y avisa a contrapartes: con mucha actividad abierta tarda más que una lectura.
        timeoutMs: 20_000,
      });
      if (!result) throw new Error("withdrawOpenActivity: respuesta vacía");
      return result;
    },
  };
}

const disputePath = (disputeId: string) => `/internal/admin/disputes/${encodeURIComponent(disputeId)}`;
const userPath = (userId: string) => `/internal/admin/users/${encodeURIComponent(userId)}`;
const internalUserPath = (userId: string) => `/internal/users/${encodeURIComponent(userId)}`;
