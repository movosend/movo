import { PAYMENT_REPORT_FACTS_MAX_IDS, PaymentReportFactsResponse, AdminUserLedgerRow, AdminUserLedgerRowPage, AdminUserMercadoPago, HoldDetailResponse, OverviewInboxSource, OverviewPaymentsExtra } from "@movo/shared";
import { createInternalClient, InternalClient, isNullableString, isOverviewInboxSource, isRecord, isString, RequestContext } from "./internal-client";

/** Lo que manda `svc-admin` al alta de un ajuste manual (DD-044). */
export interface LedgerAdjustmentRequest {
  idempotencyKey: string;
  amountArs: number;
  reason: string;
  adminId: string;
}

export interface LedgerAdjustmentResponse {
  entry: Omit<AdminUserLedgerRow, "adminId">;
  /** `false` si la `idempotencyKey` ya existía: es el mismo movimiento de antes. */
  created: boolean;
  balanceArs: number;
}

export interface PaymentsClient extends InternalClient {
  /** MOVO-35: el cobro de cada envío, para Cashflow y Precio y volumen. */
  getReportFacts(shipmentIds: string[], ctx: RequestContext): Promise<PaymentReportFactsResponse>;
  /** MOVO-294: `GET /internal/payments/mp-connect/:userId/admin-summary`. */
  getUserMercadoPago(userId: string, ctx: RequestContext): Promise<AdminUserMercadoPago>;
  /** MOVO-294: `GET /internal/payments/users/:userId/admin-ledger`. */
  getUserLedger(userId: string, query: { limit?: number; cursor?: string }, ctx: RequestContext): Promise<AdminUserLedgerRowPage>;
  /** MOVO-294: `POST /internal/payments/users/:userId/manual-adjustments` (DD-044, idempotente). */
  createLedgerAdjustment(userId: string, body: LedgerAdjustmentRequest, ctx: RequestContext): Promise<LedgerAdjustmentResponse>;
  /** `GET /internal/payments/holds/by-shipment/:id` (MOVO-325). `null` si nunca se intentó el pago. */
  findHoldByShipment(shipmentId: string, ctx: RequestContext): Promise<HoldDetailResponse | null>;
  /** MOVO-342: `GET /internal/payments/admin/overview`, la bandeja de pagos de la home. */
  getOverview(ctx: RequestContext): Promise<OverviewInboxSource<OverviewPaymentsExtra>>;
}

const isNumber = (value: unknown): value is number => typeof value === "number";

const isMercadoPago = (body: unknown): body is AdminUserMercadoPago =>
  isRecord(body) &&
  (body.status === "linked" || body.status === "not_linked" || body.status === "revoked" || body.status === "expired") &&
  isNullableString(body.nickname) &&
  isNullableString(body.connectedAt) &&
  isNullableString(body.unlinkedAt);

const isLedgerRow = (value: unknown): value is AdminUserLedgerRow =>
  isRecord(value) && isString(value.id) && isString(value.type) && isNumber(value.amountArs) && isString(value.status) && isNullableString(value.adminId);

const isLedgerPage = (body: unknown): body is AdminUserLedgerRowPage =>
  isRecord(body) && isNumber(body.balanceArs) && Array.isArray(body.items) && body.items.every(isLedgerRow) && isNullableString(body.nextCursor);

const isAdjustment = (body: unknown): body is LedgerAdjustmentResponse =>
  isRecord(body) && isRecord(body.entry) && isString(body.entry.id) && typeof body.created === "boolean" && isNumber(body.balanceArs);

const userPath = (userId: string) => `/internal/payments/users/${encodeURIComponent(userId)}`;
const isHoldDetail = (body: unknown): body is HoldDetailResponse => isRecord(body) && isString(body.status);

export function createPaymentsClient(config: { PAYMENTS_SERVICE_URL: string }): PaymentsClient {
  const client = createInternalClient({
    baseUrl: config.PAYMENTS_SERVICE_URL,
    serviceLabel: "pagos",
    unavailableCode: "PAYMENTS_SERVICE_UNAVAILABLE",
  });

  // `svc-payments` no sabe qué usuarios existen: ningún endpoint de estos responde 404 de negocio
  // (una cuenta sin movimientos ni MP es vacía), así que un 404 es una ruta que falta → 502.
  return {
    ...client,
    async getReportFacts(shipmentIds, ctx) {
      const items: PaymentReportFactsResponse["items"] = [];
      // En serie: cada lote son cuatro consultas en `svc-payments`, y un rango largo no le tiene que agotar el pool.
      for (let start = 0; start < shipmentIds.length; start += PAYMENT_REPORT_FACTS_MAX_IDS) {
        const facts = await client.request("/internal/payments/admin/report-facts", ctx, {
          method: "POST",
          body: { shipmentIds: shipmentIds.slice(start, start + PAYMENT_REPORT_FACTS_MAX_IDS) },
          isValid: (body: unknown): body is PaymentReportFactsResponse => isRecord(body) && Array.isArray(body.items),
          notFoundCodes: [],
        });
        if (!facts) throw new Error("getReportFacts: respuesta vacía");
        items.push(...facts.items);
      }
      return { items };
    },
    async getOverview(ctx) {
      const inbox = await client.request("/internal/payments/admin/overview", ctx, { isValid: isOverviewInboxSource<OverviewPaymentsExtra>, notFoundCodes: [] });
      if (!inbox) throw new Error("getOverview: respuesta vacía");
      return inbox;
    },
    async getUserMercadoPago(userId, ctx) {
      const result = await client.request(`/internal/payments/mp-connect/${encodeURIComponent(userId)}/admin-summary`, ctx, {
        isValid: isMercadoPago,
        notFoundCodes: [],
      });
      return result ?? { status: "not_linked", nickname: null, connectedAt: null, unlinkedAt: null };
    },
    async getUserLedger(userId, { limit, cursor }, ctx) {
      const query = new URLSearchParams();
      if (limit !== undefined) query.set("limit", String(limit));
      if (cursor) query.set("cursor", cursor);
      const result = await client.request(`${userPath(userId)}/admin-ledger?${query}`, ctx, { isValid: isLedgerPage, notFoundCodes: [] });
      return result ?? { balanceArs: 0, items: [], nextCursor: null };
    },
    async createLedgerAdjustment(userId, body, ctx) {
      const result = await client.request(`${userPath(userId)}/manual-adjustments`, ctx, {
        method: "POST",
        body,
        actorId: body.adminId,
        isValid: isAdjustment,
        notFoundCodes: [],
      });
      // Sin `notFoundCodes`, `request` nunca devuelve `null` (un 404 es 502).
      if (!result) throw new Error("respuesta vacía de svc-payments");
      return result;
    },
    findHoldByShipment(shipmentId, ctx) {
      return client.request(`/internal/payments/holds/by-shipment/${encodeURIComponent(shipmentId)}`, ctx, {
        isValid: isHoldDetail,
        notFoundCodes: ["HOLD_NOT_FOUND"],
      });
    },
  };
}
