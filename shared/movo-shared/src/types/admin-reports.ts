import type { QuoteBreakdown } from "./pricing";
/**
 * MOVO-342 (ADR-025): base de los reportes del panel. Rango de fechas común (lo reusan la bitácora, el reporte de
 * disputas de MOVO-344 y las métricas de MOVO-35), las ocho bandejas de la home y la bitácora ampliada. Sin
 * dependencias de Node: se puede importar por subpath desde `movo-admin`.
 */
import { ARGENTINA_UTC_OFFSET_HOURS, toArgentinaCalendarDateString } from "../utils/argentina-date";
import type { AuditLogPage, AdminTargetType } from "./admin";

/** Largo máximo de un rango, contando los dos extremos. */
export const REPORT_RANGE_MAX_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Días `YYYY-MM-DD`, inclusivos los dos y en hora de Argentina. */
export interface ReportRange {
  from: string;
  to: string;
}

export type ReportRangeError = "invalid_date" | "inverted" | "future" | "too_long";

export type ReportRangeResult<T> = { ok: true; range: T } | { ok: false; reason: ReportRangeError };

/** Texto del `message` del 400 `REPORT_RANGE_INVALID`. */
export const REPORT_RANGE_ERROR_MESSAGES: Readonly<Record<ReportRangeError, string>> = {
  invalid_date: "Las fechas del rango no son válidas.",
  inverted: "La fecha de inicio no puede ser posterior a la de fin.",
  future: "El rango no puede terminar después de hoy.",
  too_long: `El rango no puede superar los ${REPORT_RANGE_MAX_DAYS} días.`,
};

/** Número de día (medianoche UTC): solo para contar días, sin que el huso cambie el resultado. `null` si no es un día real. */
function dayNumber(day: string): number | null {
  if (!DATE_PATTERN.test(day)) return null;
  const time = Date.parse(`${day}T00:00:00.000Z`);
  // Según el motor, un 31/02 se corre al mes siguiente en vez de fallar: se compara contra lo pedido.
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day) return null;
  return time / DAY_MS;
}

const dayOf = (number: number): string => new Date(number * DAY_MS).toISOString().slice(0, 10);

/** Valida un rango con extremos opcionales (los filtros de un listado), sin completarlos. El tope aplica si vienen los dos. */
export function validateReportRange(
  input: Partial<ReportRange>,
  now: Date = new Date(),
  maxDays: number = REPORT_RANGE_MAX_DAYS,
): ReportRangeResult<Partial<ReportRange>> {
  const from = input.from === undefined ? undefined : dayNumber(input.from);
  const to = input.to === undefined ? undefined : dayNumber(input.to);
  if (from === null || to === null) return { ok: false, reason: "invalid_date" };
  if (from !== undefined && to !== undefined) {
    if (from > to) return { ok: false, reason: "inverted" };
    if (to - from + 1 > maxDays) return { ok: false, reason: "too_long" };
  }
  const today = dayNumber(toArgentinaCalendarDateString(now)) as number;
  if ((to ?? from ?? today) > today) return { ok: false, reason: "future" };
  return { ok: true, range: { ...(input.from ? { from: input.from } : {}), ...(input.to ? { to: input.to } : {}) } };
}

/** Rango acotado de un reporte: sin `to` es hoy y sin `from` es el largo máximo hacia atrás, así el tope vale siempre. */
export function resolveReportRange(
  input: Partial<ReportRange>,
  now: Date = new Date(),
  maxDays: number = REPORT_RANGE_MAX_DAYS,
): ReportRangeResult<ReportRange> {
  const validated = validateReportRange(input, now, maxDays);
  if (!validated.ok) return validated;
  const to = validated.range.to ?? toArgentinaCalendarDateString(now);
  const from = validated.range.from ?? dayOf((dayNumber(to) as number) - maxDays + 1);
  return validateReportRange({ from, to }, now, maxDays) as ReportRangeResult<ReportRange>;
}

/** Cantidad de días del rango, contando los dos extremos. */
export function reportRangeDays(range: ReportRange): number {
  return (dayNumber(range.to) as number) - (dayNumber(range.from) as number) + 1;
}

/** Período anterior: el mismo largo, inmediatamente antes. */
export function previousReportRange(range: ReportRange): ReportRange {
  const days = reportRangeDays(range);
  const from = dayNumber(range.from) as number;
  return { from: dayOf(from - days), to: dayOf(from - 1) };
}

export type ReportGranularity = "day" | "week" | "month";

/** La decide el backend: día hasta 31 días, semana hasta 120 y mes para el resto. */
export function reportGranularity(range: ReportRange): ReportGranularity {
  const days = reportRangeDays(range);
  if (days <= 31) return "day";
  return days <= 120 ? "week" : "month";
}

/** Instantes de un día de Argentina: para comparar contra un `timestamptz` con `>= start` y `< end`. */
export function argentinaDayBounds(day: string): { start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00.000Z`).getTime() + ARGENTINA_UTC_OFFSET_HOURS * 60 * 60 * 1000;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Home: `GET /admin/overview`
// ---------------------------------------------------------------------------------------------------------------------

export const ADMIN_OVERVIEW_BLOCKS = [
  "disputes",
  "support",
  "kyc",
  "userReports",
  "shipmentAlerts",
  "payments",
  "flaggedMessages",
  "sanctionsEndingToday",
] as const;
export type AdminOverviewBlockName = (typeof ADMIN_OVERVIEW_BLOCKS)[number];

/** DD-058: plazo de cada bandeja, en horas. `null`: sin plazo (las sanciones que vencen hoy son informativas). */
export const OVERVIEW_SLA_HOURS: Readonly<Record<AdminOverviewBlockName, number | null>> = {
  disputes: 72,
  support: 0.5,
  kyc: 24,
  userReports: 24,
  shipmentAlerts: 1,
  payments: 6,
  flaggedMessages: 12,
  sanctionsEndingToday: null,
};

/** Días hacia atrás de la bandeja de mensajes señalados: no tienen estado de revisión que los saque (DD-058). */
export const OVERVIEW_FLAGGED_MESSAGES_WINDOW_DAYS = 7;

export interface OverviewBreakdownRow {
  key: string;
  count: number;
}

export interface OverviewInbox {
  count: number;
  /** Lo pendiente más viejo de la bandeja. */
  oldestAt: string | null;
  /** `null`: bandeja sin plazo. */
  slaHours: number | null;
  /** Lo más viejo pasó el plazo: la tarjeta va al grupo "Fuera de plazo". */
  overSla: boolean;
  /** Pendientes a esta misma hora de ayer, reconstruido con fechas. `null` si no se puede reconstruir. */
  yesterdayCount: number | null;
  /** Ordenado de mayor a menor; puede venir vacío. */
  breakdown: OverviewBreakdownRow[];
}

/** Lo que manda el servicio dueño (`.../overview/*`): el plazo y si se pasó los agrega `svc-admin`. */
export type OverviewInboxSource<E = unknown> = Omit<OverviewInbox, "slaHours" | "overSla"> & E;

/** Una bandeja con la cuenta del servicio dueño más su plazo. Sin plazo nunca está fuera de plazo. */
export function toOverviewInbox<S extends OverviewInboxSource>(block: AdminOverviewBlockName, source: S, now: Date = new Date()): OverviewInbox & S {
  const slaHours = OVERVIEW_SLA_HOURS[block];
  const overSla =
    slaHours !== null && source.oldestAt !== null && now.getTime() - new Date(source.oldestAt).getTime() > slaHours * 60 * 60 * 1000;
  return { overSla, ...source, slaHours };
}

export type OverviewDisputesExtra = { awaitingPayment: number };
export type OverviewSupportExtra = { urgent: number };
export type OverviewKycExtra = { carriers: number; senders: number };
export type OverviewUserReportsExtra = { blockRequested: number };
export type OverviewShipmentAlertsExtra = { inTransit: number };
/** `overSla` lo decide `svc-payments` y pisa la cuenta por antigüedad: un hold se pasa de plazo antes de vencer (DD-058). */
export type OverviewPaymentsExtra = { holdsExpiringToday: number; overSla: boolean };

/** Un bloque de la home. `requestId` en el error: la tarjeta lo muestra para poder buscarlo en los logs. */
export type AdminOverviewBlock<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string; requestId?: string } };

export interface AdminOverviewBlocks {
  disputes: AdminOverviewBlock<OverviewInbox & OverviewDisputesExtra>;
  support: AdminOverviewBlock<OverviewInbox & OverviewSupportExtra>;
  kyc: AdminOverviewBlock<OverviewInbox & OverviewKycExtra>;
  userReports: AdminOverviewBlock<OverviewInbox & OverviewUserReportsExtra>;
  shipmentAlerts: AdminOverviewBlock<OverviewInbox & OverviewShipmentAlertsExtra>;
  payments: AdminOverviewBlock<OverviewInbox & OverviewPaymentsExtra>;
  flaggedMessages: AdminOverviewBlock<OverviewInbox>;
  sanctionsEndingToday: AdminOverviewBlock<OverviewInbox>;
}

/** `GET /admin/overview[?blocks=kyc,support]`: con `blocks` vienen solo esos, para reintentar una tarjeta. */
export interface AdminOverview {
  generatedAt: string;
  blocks: Partial<AdminOverviewBlocks>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Bitácora: `GET /admin/audit-log` y su export
// ---------------------------------------------------------------------------------------------------------------------

/** Las acciones que escribe `svc-admin`. Una acción nueva se suma acá, así el panel le pone etiqueta. */
export const ADMIN_AUDIT_ACTIONS = [
  "admin_role.grant",
  "admin_role.revoke",
  "dispute.note_add",
  "dispute.resolve",
  "report.export",
  "shipment.status_change",
  "support.assign",
  "support.attachment_request",
  "support.link_shipment",
  "support.note",
  "support.priority",
  "support.reopen",
  "support.reply",
  "support.resolve",
  "support.tags",
  "support.topic",
  "support.unlink_shipment",
  "support.update",
  "user.contact_update",
  "user.disable",
  "user.ledger_adjust",
  "user.note_add",
  "user.sanction_lift",
  "user.sanction_withdraw",
  "user.sessions_revoke",
  "user.suspend",
] as const;
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

/** Desde cuántos caracteres `targetId` también matchea por prefijo (el panel muestra ids cortos). */
export const AUDIT_TARGET_PREFIX_MIN_LENGTH = 8;

export interface AuditTargetRef {
  /** user: nombre; shipment: código corto; support_conversation: `SOP-NNNN`; admin_role: email. */
  label: string | null;
  /** dispute, chat_report. */
  shipmentId?: string;
  /** user_report: la persona reportada. */
  userId?: string;
}

/** Clave de `AdminAuditLogPage.targets`. */
export const auditTargetKey = (type: AdminTargetType, id: string): string => `${type}:${id}`;

/** `GET /admin/audit-log`. Los dos mapas son best-effort: si falta una clave, el panel muestra el id corto. */
export interface AdminAuditLogPage extends AuditLogPage {
  admins: Record<string, { fullName: string }>;
  targets: Record<string, AuditTargetRef>;
}

/** `POST /internal/admin/audit-targets` de `svc-shipments`: lo que `svc-admin` no puede armar solo con el id. */
export interface AuditTargetsRequest {
  disputes: string[];
  chatReports: string[];
  supportConversations: string[];
}
export interface AuditTargetsResponse {
  disputes: Record<string, { shipmentId: string }>;
  chatReports: Record<string, { shipmentId: string }>;
  supportConversations: Record<string, { code: string }>;
}

/** Tope de filas de un CSV del panel. Quien exporta corta ahí y lo avisa con `EXPORT_TRUNCATED_HEADER`. */
export const CSV_MAX_ROWS = 10_000;

/** Headers de una exportación: cuántas filas trae y si el tope la cortó. */
export const EXPORT_ROWS_HEADER = "x-export-rows";
export const EXPORT_TRUNCATED_HEADER = "x-export-truncated";

// ---------------------------------------------------------------------------------------------------------------------
// Forma común de un reporte con tendencia y desgloses (contrato de MOVO-345, comentario en MOVO-344)
// ---------------------------------------------------------------------------------------------------------------------

export type DistanceBand = "50_200" | "200_500" | "500_plus";
export const DISTANCE_BANDS: readonly DistanceBand[] = ["50_200", "200_500", "500_plus"];

/** `null`: la métrica no está definida (una mediana sin muestras, una tasa sin denominador). Una cuenta sin casos es `0`. */
export interface ReportValue {
  value: number | null;
  previous: number | null;
}

/** Días inclusivos. El bucket j de `previous` es el bucket j corrido un período completo hacia atrás. */
export interface ReportPoint extends ReportValue {
  start: string;
  end: string;
}

export interface ReportBreakdownRow extends ReportValue {
  key: string;
  /** Porcentaje del total, de 0 a 100. `null` si el total es 0. */
  share: number | null;
  /** Una métrica de apoyo por fila, p. ej. el ticket promedio del tramo. */
  extra?: Record<string, number | null>;
}

export interface ReportBreakdown<D extends string = string> {
  dimension: D;
  /** El KPI que se desglosa. */
  metric: string;
  total: ReportValue;
  rows: ReportBreakdownRow[];
}

export interface ReportMeta {
  range: ReportRange;
  previous: ReportRange;
  granularity: ReportGranularity;
  band: DistanceBand | null;
  /** `false`: este reporte ignora el filtro de distancia y el panel lo muestra deshabilitado. */
  bandApplied: boolean;
  generatedAt: string;
}

export interface Report<K extends string> {
  meta: ReportMeta;
  kpis: Record<K, ReportValue>;
  series: Record<K, ReportPoint[]>;
  breakdowns: ReportBreakdown[];
}

export interface ReportBucket extends ReportRange {
  previous: ReportRange;
}

/**
 * Buckets del rango según `reportGranularity`: días, semanas contadas desde `from` o meses de calendario. Los extremos
 * se recortan al rango, así que el primero y el último pueden ser más cortos.
 */
export function reportBuckets(range: ReportRange): ReportBucket[] {
  const granularity = reportGranularity(range);
  const shift = reportRangeDays(range);
  const last = dayNumber(range.to) as number;
  const buckets: ReportBucket[] = [];
  let start = dayNumber(range.from) as number;
  while (start <= last) {
    let end = start;
    if (granularity === "week") end = start + 6;
    if (granularity === "month") {
      const date = new Date(start * DAY_MS);
      end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0) / DAY_MS;
    }
    end = Math.min(end, last);
    buckets.push({ from: dayOf(start), to: dayOf(end), previous: { from: dayOf(start - shift), to: dayOf(end - shift) } });
    start = end + 1;
  }
  return buckets;
}

/**
 * Variación contra el período anterior, como la muestra el panel: en un porcentaje, la diferencia en puntos; en el resto,
 * la variación en %. `null` si falta un dato o si no hay base contra la que comparar.
 */
export function reportChange({ value, previous }: ReportValue, isPercentage: boolean): number | null {
  if (value === null || previous === null) return null;
  if (isPercentage) return Math.round((value - previous) * 100) / 100;
  if (previous === 0) return null;
  return Math.round(((value - previous) / previous) * 10_000) / 100;
}

// ---------------------------------------------------------------------------------------------------------------------
// Disputas: `GET /admin/reports/disputes` (MOVO-344)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `opened` y `disputeRate` van por `openedAt`; el resto, por `resolvedAt` y solo con la disputa `resolved`: una
 * `resolving` tiene la plata sin mover y no cuenta. Los montos son lo que la resolución le dejó a cada parte.
 * `disputeRate` es disputas abiertas cada 100 envíos completados en el mismo período (MOVO-344): no es una cohorte y
 * puede pasar de 100.
 */
export const DISPUTES_REPORT_KPIS = [
  "opened",
  "resolved",
  "resolutionHours",
  "disputeRate",
  "senderAmountArs",
  "carrierAmountArs",
] as const;
export type DisputesKpi = (typeof DISPUTES_REPORT_KPIS)[number];

/** KPIs en porcentaje: su `change` va en puntos (`reportChange`). */
export const DISPUTES_REPORT_PERCENTAGE_KPIS: readonly DisputesKpi[] = ["disputeRate"];

export const DISPUTES_REPORT_BREAKDOWNS = ["reason", "outcome"] as const;
export type DisputesReportBreakdownDimension = (typeof DISPUTES_REPORT_BREAKDOWNS)[number];

/** Lo que sigue sin resolverse ahora: una foto, no depende del rango. */
export interface DisputesReportBacklogRow {
  status: "open" | "resolving";
  count: number;
  medianAgeHours: number | null;
  oldestOpenedAt: string | null;
}

/**
 * Embudo por cohorte: las disputas abiertas en el período y hasta dónde llegaron hoy. `decided` es haber pasado a
 * `resolving` (el admin resolvió, falta mover la plata). Las etapas están anidadas: cada una es parte de la anterior.
 */
export type DisputeFunnelStageKey = "opened" | "decided" | "resolved";
export interface DisputeFunnelStage {
  key: DisputeFunnelStageKey;
  count: number;
  /** La misma etapa, para la cohorte del período anterior. */
  previous: number | null;
  /** Mediana desde la etapa anterior. `null` en `opened` o sin muestras; las decididas antes de MOVO-344 no tienen fecha y no entran. */
  medianHoursFromPrevious: number | null;
}

export interface DisputesReport extends Report<DisputesKpi> {
  backlog: DisputesReportBacklogRow[];
  /** `null`: no se abrió ninguna disputa en el período. */
  funnel: DisputeFunnelStage[] | null;
}

/** Lo que manda `svc-shipments`: el filtro de distancia lo agrega `svc-admin`. */
export type DisputesReportSource = Omit<DisputesReport, "meta"> & { meta: Omit<ReportMeta, "band" | "bandApplied"> };

/** Una disputa del CSV de detalle: solo ids, fechas y montos, sin partes ni textos libres. */
export interface DisputesReportRow {
  disputeId: string;
  shipmentId: string;
  reason: string;
  status: string;
  /** Estos tres quedan en `null` hasta que la disputa llega a `resolved`. */
  outcome: string | null;
  senderAmountArs: number | null;
  carrierAmountArs: number | null;
  openedAt: string;
  resolvedAt: string | null;
  /** Abierta o en `resolving`: `null`. */
  resolutionHours: number | null;
}

export interface DisputesReportRowsResponse {
  items: DisputesReportRow[];
  truncated: boolean;
}

/** `?section=` de `GET /admin/reports/disputes/export`. */
export const DISPUTES_REPORT_EXPORT_SECTIONS = [
  ...DISPUTES_REPORT_KPIS.map((kpi) => `trend.${kpi}` as const),
  ...DISPUTES_REPORT_BREAKDOWNS.map((dimension) => `breakdown.${dimension}` as const),
  "backlog",
  "disputes",
] as const;
export type DisputesReportExportSection = (typeof DISPUTES_REPORT_EXPORT_SECTIONS)[number];

// ---------------------------------------------------------------------------------------------------------------------
// Métricas del panel: contratos de las otras pestañas (MOVO-345) y su backend (MOVO-35)
// ---------------------------------------------------------------------------------------------------------------------

/** Lo de menos de 200 km, también lo de menos de 50, cae en el primer tramo. */
export function distanceBandOf(distanceKm: number): DistanceBand {
  if (distanceKm < 200) return "50_200";
  return distanceKm < 500 ? "200_500" : "500_plus";
}

export type AdminReportId = "cashflow" | "pricing" | "deliveries" | "carriers" | "distances" | "support" | "disputes";
export const ADMIN_REPORT_IDS: readonly AdminReportId[] = ["cashflow", "pricing", "deliveries", "carriers", "distances", "support", "disputes"];

/** Montos en ARS, porcentajes 0-100, duraciones como mediana. `avgTicket` es `gmv / completed`. */
export const CASHFLOW_KPIS = ["gmv", "completed", "avgTicket", "commission", "takeRate"] as const;
export type CashflowKpi = (typeof CASHFLOW_KPIS)[number];
/**
 * `priceIndex`: precio a mix de distancias constante, base 100 = el período anterior. `captureRate`: GMV capturado sobre
 * el cotizado de los envíos publicados en el período.
 */
export const PRICING_KPIS = ["completed", "avgTicket", "priceIndex", "captureRate"] as const;
export type PricingKpi = (typeof PRICING_KPIS)[number];
export const DELIVERIES_KPIS = ["onTimeRate", "doorToDoorHours", "incidentRate", "lateCount"] as const;
export type DeliveriesKpi = (typeof DELIVERIES_KPIS)[number];
export const CARRIERS_KPIS = ["assignedWithin24hRate", "timeToAssignHours", "activeCarriers"] as const;
export type CarriersKpi = (typeof CARRIERS_KPIS)[number];
export const DISTANCES_KPIS = ["published", "completionRate", "avgDistanceKm"] as const;
export type DistancesKpi = (typeof DISTANCES_KPIS)[number];
export const SUPPORT_KPIS = ["firstResponseMinutes", "conversations", "firstContactResolutionRate"] as const;
export type SupportKpi = (typeof SUPPORT_KPIS)[number];

/**
 * Por qué llegó tarde un envío (DD-059). Un solo motivo por envío, en este orden: anomalía marcada, retiro fuera de su
 * ventana y, si no, en ruta. `receiver_absent` no tiene dato que lo respalde y queda en 0.
 */
export type DeliveryDelayReason = "pickup_late" | "in_route" | "receiver_absent" | "gps_anomaly";
export const DELIVERY_DELAY_REASONS: readonly DeliveryDelayReason[] = ["pickup_late", "in_route", "receiver_absent", "gps_anomaly"];

export interface CashflowReport extends Report<CashflowKpi> {
  /** Capturas que MP todavía no confirmó: no entran en `gmv` ni `commission` (B8 de MOVO-35). */
  pendingCapture: { count: number; amountArs: number };
}
export type DeliveriesReport = Report<DeliveriesKpi>;
export interface CarrierSupplyPoint {
  start: string;
  end: string;
  published: number | null;
  assignedWithin24h: number | null;
}
export interface CarriersReport extends Report<CarriersKpi> {
  /** Misma granularidad que `series`. */
  supply: CarrierSupplyPoint[];
}
export type SupportReport = Report<SupportKpi>;

export interface ReportCorridor {
  originCity: string;
  destinationCity: string;
  /** Centroides de los retiros y las entregas del corredor. */
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  distanceKm: number;
  band: DistanceBand;
  published: number;
  publishedPrevious: number;
  completionRate: number | null;
}

/** Siempre los tres tramos, ignora el filtro `band`. */
export interface ReportScorecardRow {
  band: DistanceBand;
  published: ReportValue;
  completionRate: ReportValue;
  onTimeRate: ReportValue;
  assignedWithin24hRate: ReportValue;
  doorToDoorHours: ReportValue;
  avgTicket: ReportValue;
}
export type ReportScorecardMetric = Exclude<keyof ReportScorecardRow, "band">;

export interface DistancesReport extends Report<DistancesKpi> {
  /** Top 20 por envíos publicados. */
  corridors: ReportCorridor[];
  scorecard: ReportScorecardRow[];
}

/** Qué movió el precio (DD-059), en el orden en que se atribuye. `other` cierra la cuenta. */
export type PriceComponent = "fuel" | "demand" | "distance" | "package" | "algorithm" | "negotiation" | "other";
export const PRICE_COMPONENTS: readonly PriceComponent[] = ["fuel", "demand", "distance", "package", "algorithm", "negotiation", "other"];

/** Puente del GMV de completados, con signo. Cierra exacto: `previous + volume + mix + Σ price = current`. */
export interface GmvBridge {
  previous: number;
  current: number;
  volume: number;
  mix: number;
  price: { key: PriceComponent; amount: number }[];
}

export type CaptureLeakageStep =
  | "unassigned"
  | "cancelled"
  | "payment_failed"
  | "hold_expired"
  | "capture_failed"
  | "dispute_refund"
  | "cash_commission_debt"
  | "pending_capture"
  | "in_flight";
export const CAPTURE_LEAKAGE_STEPS: readonly CaptureLeakageStep[] = [
  "unassigned",
  "cancelled",
  "payment_failed",
  "hold_expired",
  "capture_failed",
  "dispute_refund",
  "cash_commission_debt",
  "pending_capture",
  "in_flight",
];

export interface CaptureAmounts {
  shipments: number;
  gmvArs: number;
  commissionArs: number;
}

/** Cascada de lo cotizado a lo capturado, por fecha de publicación. Cierra exacto: `quoted − Σ steps = captured`. */
export interface CaptureLeakage {
  quoted: CaptureAmounts;
  steps: (CaptureAmounts & { key: CaptureLeakageStep; timing: boolean })[];
  captured: CaptureAmounts;
}

export interface PricingReport extends Report<PricingKpi> {
  /** `null`: no hubo envíos completados en alguno de los dos períodos. */
  bridge: GmvBridge | null;
  /** `null`: no hubo envíos publicados en el período. */
  leakage: CaptureLeakage | null;
}

export interface AdminReportById {
  cashflow: CashflowReport;
  pricing: PricingReport;
  deliveries: DeliveriesReport;
  carriers: CarriersReport;
  distances: DistancesReport;
  support: SupportReport;
  disputes: DisputesReport;
}

export interface AdminReportQuery extends ReportRange {
  band?: DistanceBand;
}

/** Lo que manda el servicio dueño: el filtro de distancia en `meta` lo agrega `svc-admin`. */
export type ReportSource<R extends { meta: ReportMeta }> = Omit<R, "meta"> & { meta: Omit<ReportMeta, "band" | "bandApplied"> };

/** `?section=` de `GET /admin/reports/:report/export`. */
export type AdminReportExportSection = `trend.${string}` | `breakdown.${string}` | "scorecard" | "corridors" | "bridge" | "leakage" | "backlog" | "disputes";

const REPORT_KPIS: Readonly<Record<AdminReportId, readonly string[]>> = {
  cashflow: CASHFLOW_KPIS,
  pricing: PRICING_KPIS,
  deliveries: DELIVERIES_KPIS,
  carriers: CARRIERS_KPIS,
  distances: DISTANCES_KPIS,
  support: SUPPORT_KPIS,
  disputes: DISPUTES_REPORT_KPIS,
};
export const reportKpis = (id: AdminReportId): readonly string[] => REPORT_KPIS[id];

/** KPIs en porcentaje: su `change` va en puntos (`reportChange`). */
const REPORT_PERCENTAGE_KPIS: ReadonlySet<string> = new Set(["takeRate", "captureRate", "onTimeRate", "incidentRate", "assignedWithin24hRate", "completionRate", "firstContactResolutionRate", "disputeRate"]);
export const isReportPercentageMetric = (metric: string): boolean => REPORT_PERCENTAGE_KPIS.has(metric);

const REPORT_BREAKDOWNS: Readonly<Record<AdminReportId, readonly string[]>> = {
  cashflow: ["band"],
  pricing: ["band"],
  deliveries: ["delayReason"],
  carriers: ["band"],
  distances: [],
  support: ["topic"],
  disputes: DISPUTES_REPORT_BREAKDOWNS,
};
const REPORT_EXTRA_SECTIONS: Readonly<Record<AdminReportId, readonly AdminReportExportSection[]>> = {
  cashflow: [],
  pricing: ["bridge", "leakage"],
  deliveries: [],
  carriers: [],
  distances: ["scorecard", "corridors"],
  support: [],
  disputes: ["backlog", "disputes"],
};

export function reportExportSections(id: AdminReportId): AdminReportExportSection[] {
  return [
    ...REPORT_KPIS[id].map((kpi) => `trend.${kpi}` as const),
    ...REPORT_BREAKDOWNS[id].map((dimension) => `breakdown.${dimension}` as const),
    ...REPORT_EXTRA_SECTIONS[id],
  ];
}

/** Soporte no tiene envío del cual sacar una distancia. */
export const reportAppliesBand = (id: AdminReportId): boolean => id !== "support";

export const reportRound = (value: number): number => Math.round(value * 100) / 100;

export function reportMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return reportRound(median);
}

/** Porcentaje de 0 a 100; `null` si no hay denominador. */
export const reportRate = (part: number, total: number): number | null => (total === 0 ? null : reportRound((part / total) * 100));

/** Si un instante cae dentro de un rango de días de Argentina. */
export function isInReportRange(instant: string | null, range: ReportRange): boolean {
  if (!instant) return false;
  const at = Date.parse(instant);
  return at >= argentinaDayBounds(range.from).start.getTime() && at < argentinaDayBounds(range.to).end.getTime();
}

/** KPIs y series de un reporte a partir de una sola función: un total y sus buckets no pueden medir distinto. */
export function buildReportBody<K extends string>(
  range: ReportRange,
  kpiNames: readonly K[],
  metricsFor: (range: ReportRange) => Record<K, number | null>,
  now: Date,
): Pick<Report<K>, "kpis" | "series"> & { meta: Omit<ReportMeta, "band" | "bandApplied"> } {
  const previous = previousReportRange(range);
  const current = metricsFor(range);
  const before = metricsFor(previous);
  const buckets = reportBuckets(range).map((bucket) => ({ bucket, value: metricsFor(bucket), previous: metricsFor(bucket.previous) }));
  const kpis = {} as Record<K, ReportValue>;
  const series = {} as Record<K, ReportPoint[]>;
  for (const kpi of kpiNames) {
    kpis[kpi] = { value: current[kpi], previous: before[kpi] };
    series[kpi] = buckets.map((point) => ({ start: point.bucket.from, end: point.bucket.to, value: point.value[kpi], previous: point.previous[kpi] }));
  }
  return { meta: { range, previous, granularity: reportGranularity(range), generatedAt: now.toISOString() }, kpis, series };
}

/** Un envío, para los reportes que se arman con datos de `svc-shipments` y `svc-payments` (Cashflow y Precio). */
export interface ShipmentReportFact {
  shipmentId: string;
  status: string;
  paymentMethod: string;
  band: DistanceBand | null;
  suggestedPriceArs: number | null;
  agreedPriceArs: number | null;
  calculationMethod: string | null;
  breakdown: QuoteBreakdown | null;
  publishedAt: string | null;
  firstAssignedAt: string | null;
  firstCompletedAt: string | null;
  deliveredAt: string | null;
  /** Cancelado por un barrido del sistema y no por una persona. */
  cancelledBySystem: boolean;
}

export interface ShipmentReportFactsResponse {
  items: ShipmentReportFact[];
}

/** Lo que `svc-payments` sabe del cobro de un envío. Sin fila: el envío no llegó a tener ningún movimiento. */
export interface PaymentReportFact {
  shipmentId: string;
  settlementStatus: "processing" | "credited" | "failed" | "escalated" | null;
  /** Capturado sin el recargo por deuda del emisor (MOVO-311). */
  capturedArs: number | null;
  commissionArs: number | null;
  /** Comisión del hold más reciente. */
  holdCommissionArs: number | null;
  refundedArs: number;
  holdRejected: boolean;
  holdExpired: boolean;
  cashCommissionArs: number | null;
  /** La comisión del pago en efectivo sigue como deuda en la cuenta corriente. */
  cashCommissionDebtOpen: boolean;
}

/** Ids por pedido a `POST /internal/payments/admin/report-facts`. `svc-admin` parte en lotes los rangos largos. */
export const PAYMENT_REPORT_FACTS_MAX_IDS = 1000;

export interface PaymentReportFactsRequest {
  shipmentIds: string[];
}

export interface PaymentReportFactsResponse {
  items: PaymentReportFact[];
}
