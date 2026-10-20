import {
  AdminShipmentRole,
  AdminUserRatingRowPage,
  AdminUserShipmentRow,
  AdminUserShipmentRowPage,
  AdminUserTripPage,
  ChatReportParties,
  ShipmentParties,
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
}

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
  };
}

const userPath = (userId: string) => `/internal/admin/users/${encodeURIComponent(userId)}`;
