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

/** Hasta cuántos días dura cada granularidad (inclusive); más largo es mes. */
export const REPORT_GRANULARITY_LIMITS = { day: 31, week: 120 } as const;

/** La decide el backend: día hasta 31 días, semana hasta 120 y mes para el resto. */
export function reportGranularity(range: ReportRange): ReportGranularity {
  const days = reportRangeDays(range);
  if (days <= REPORT_GRANULARITY_LIMITS.day) return "day";
  return days <= REPORT_GRANULARITY_LIMITS.week ? "week" : "month";
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

/** Los datos de cada bandeja, sin el envoltorio de `AdminOverviewBlock`: lo que arma un fixture o un componente. */
export type AdminOverviewData = {
  [K in AdminOverviewBlockName]: NonNullable<AdminOverviewBlocks[K]["data"]>;
};

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

/** Headers de una exportación: cuántas filas trae y si el tope la cortó. */
export const EXPORT_ROWS_HEADER = "x-export-rows";
export const EXPORT_TRUNCATED_HEADER = "x-export-truncated";

// ---------------------------------------------------------------------------------------------------------------------
// Métricas: contratos de los reportes (MOVO-345, los implementa MOVO-344)
// ---------------------------------------------------------------------------------------------------------------------

/** Tramos de distancia entre retiro y entrega. Lo de menos de 200 km (también lo de menos de 50) cae en el primero. */
export type DistanceBand = "50_200" | "200_500" | "500_plus";
export const DISTANCE_BANDS: readonly DistanceBand[] = [
  "50_200",
  "200_500",
  "500_plus",
];

// ---------------------------------------------------------------------------------------------
// Forma común de un reporte (MOVO-344)
// ---------------------------------------------------------------------------------------------

/** `previous` es el mismo largo, inmediatamente antes. `null`: sin datos (no es cero). */
export interface ReportValue {
  value: number | null;
  previous: number | null;
}

/** Un bucket de la serie. El j de `previous` es el bucket j corrido un período completo hacia atrás. */
export interface ReportPoint extends ReportValue {
  /** Primer y último día del bucket (`YYYY-MM-DD`). */
  start: string;
  end: string;
}

export interface ReportBreakdownRow extends ReportValue {
  key: string;
  /** % del total (0-100), solo en métricas que suman. */
  share: number | null;
  /** Una métrica de apoyo por fila, p. ej. el ticket promedio del tramo. */
  extra?: Record<string, number | null>;
}

export interface ReportBreakdown<D extends string = string> {
  dimension: D;
  /** La métrica (clave de `kpis`, o una propia del desglose) que se desglosa. */
  metric: string;
  total: ReportValue;
  rows: ReportBreakdownRow[];
}

export interface ReportMeta {
  range: ReportRange;
  previous: ReportRange;
  granularity: ReportGranularity;
  band: DistanceBand | null;
  /** `false`: el reporte no se puede filtrar por distancia (Soporte) y el panel deshabilita el selector. */
  bandApplied: boolean;
  generatedAt: string;
}

export interface Report<K extends string> {
  meta: ReportMeta;
  kpis: Record<K, ReportValue>;
  /** Cada KPI se puede elegir como línea de tendencia. */
  series: Record<K, ReportPoint[]>;
  breakdowns: ReportBreakdown[];
}

/** `GET /admin/reports/:report`. */
export type AdminReportId =
  | "cashflow"
  | "pricing"
  | "deliveries"
  | "carriers"
  | "distances"
  | "support"
  | "disputes";
export const ADMIN_REPORT_IDS: readonly AdminReportId[] = [
  "cashflow",
  "pricing",
  "deliveries",
  "carriers",
  "distances",
  "support",
  "disputes",
];

/**
 * Montos en ARS, porcentajes 0-100, duraciones como mediana. `completed` es el volumen (envíos
 * completados): `gmv = completed × avgTicket`, así que `avgTicket` es `gmv / completed`, no un promedio aparte.
 */
export type CashflowKpi =
  "gmv" | "completed" | "avgTicket" | "commission" | "takeRate";
/**
 * Precio y volumen. `priceIndex`: precio a mix de distancias constante, base 100 = el período
 * anterior (un 104 es "los mismos envíos salen 4 % más caros"). `captureRate`: GMV capturado sobre el
 * cotizado de los envíos publicados en el período (la cascada de fugas, en %).
 */
export type PricingKpi = "completed" | "avgTicket" | "priceIndex" | "captureRate";
export type DeliveriesKpi =
  "onTimeRate" | "doorToDoorHours" | "incidentRate" | "lateCount";
export type CarriersKpi =
  "assignedWithin24hRate" | "timeToAssignHours" | "activeCarriers";
export type DistancesKpi = "published" | "completionRate" | "avgDistanceKm";
export type SupportKpi =
  "firstResponseMinutes" | "conversations" | "firstContactResolutionRate";
export type DisputesKpi =
  "opened" | "resolved" | "resolutionHours" | "disputeRate";

/** Por qué llegó tarde un envío (desglose de `lateCount`). La regla de clasificación la define MOVO-344. */
export type DeliveryDelayReason =
  "pickup_late" | "in_route" | "receiver_absent" | "gps_anomaly";

export interface CashflowReport extends Report<CashflowKpi> {
  /** Capturas que MP todavía no confirmó: no entran en `gmv` ni `commission` (B8 de MOVO-35). */
  pendingCapture: { count: number; amountArs: number };
}
export type DeliveriesReport = Report<DeliveriesKpi>;
/** Un bucket de oferta contra demanda: lo publicado y lo que consiguió transportista en 24 h. */
export interface CarrierSupplyPoint {
  start: string;
  end: string;
  published: number | null;
  assignedWithin24h: number | null;
}
export interface CarriersReport extends Report<CarriersKpi> {
  /** Misma granularidad que `series`. Envíos publicados en el bucket y cuántos se asignaron en 24 h. */
  supply: CarrierSupplyPoint[];
}
export type SupportReport = Report<SupportKpi>;
/**
 * Embudo de Disputas por cohorte: las abiertas en el período y hasta dónde llegaron. Sigue los estados
 * reales (`open → resolving → resolved`): `decided` es haber pasado a `resolving` (el admin resolvió,
 * falta mover la plata) o directo a `resolved`. Las etapas están anidadas (cada una ⊆ la anterior).
 */
export type DisputeFunnelStageKey = "opened" | "decided" | "resolved";
export interface DisputeFunnelStage {
  key: DisputeFunnelStageKey;
  count: number;
  /** La misma etapa para la cohorte del período anterior. */
  previous: number | null;
  /** Mediana desde la etapa anterior (`null` en `opened` o sin casos). */
  medianHoursFromPrevious: number | null;
}
export interface DisputesReport extends Report<DisputesKpi> {
  /** `null`: no se abrió ninguna disputa en el período. */
  funnel: DisputeFunnelStage[] | null;
}

export interface ReportCorridor {
  originCity: string;
  destinationCity: string;
  /** Centroides de los retiros/entregas del corredor, para dibujar el mapa. */
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

/**
 * Qué movió el precio, en el orden en que se atribuye (sustitución secuencial sobre cada envío del
 * período: se recotiza con el factor del período anterior y la diferencia es el efecto). Sale del
 * desglose de la cotización (`QuoteBreakdown`), que `svc-shipments` tiene que persistir por envío:
 * - `fuel`: precio del combustible (`fuelArsPerLiter`).
 * - `demand`: recargo por alta demanda (`demandMultiplier`, DD-053).
 * - `distance`: kilómetros dentro del mismo tramo (el cambio entre tramos es mix, no precio).
 * - `package`: peso facturable y recargo por frágil.
 * - `algorithm`: cambio de versión de `calculationMethod`.
 * - `negotiation`: precio acordado contra el sugerido (ofertas del transportista).
 * - `other`: lo que no se atribuye (redondeos, ajustes); cierra la cuenta.
 */
export type PriceComponent =
  | "fuel"
  | "demand"
  | "distance"
  | "package"
  | "algorithm"
  | "negotiation"
  | "other";
export const PRICE_COMPONENTS: readonly PriceComponent[] = [
  "fuel",
  "demand",
  "distance",
  "package",
  "algorithm",
  "negotiation",
  "other",
];

/**
 * Puente del GMV de envíos completados, del período anterior a este (ARS, con signo). Cierra exacto:
 * `previous + volume + mix + Σ price = current`.
 * - `volume = (Q₁ − Q₀) × ticket₀`: más o menos envíos, al ticket anterior.
 * - `mix = Q₁ × Σ (s₁ᵢ − s₀ᵢ) × ticket₀ᵢ`: cambió el reparto entre tramos de distancia.
 * - `price = Q₁ × Σ s₁ᵢ × (ticket₁ᵢ − ticket₀ᵢ)`: el ticket dentro de cada tramo, abierto por componente.
 */
export interface GmvBridge {
  previous: number;
  current: number;
  volume: number;
  mix: number;
  price: { key: PriceComponent; amount: number }[];
}

/**
 * Por qué lo cotizado no llega a capturarse. Cohorte: envíos publicados en el período, a su precio
 * cotizado. Los pasos con `timing: true` no son pérdida: todavía pueden capturarse.
 * - `unassigned`: venció sin transportista (DD-032).
 * - `cancelled`: cancelado por el emisor o el transportista antes del retiro.
 * - `payment_failed`: el pago no se autorizó o el envío venció sin fondearse.
 * - `hold_expired`: el hold de MP venció sin capturarse (DD-050).
 * - `capture_failed`: MP rechazó la captura o quedó escalada.
 * - `dispute_refund`: reembolsado total o parcialmente por una disputa (DD-056).
 * - `cash_commission_debt`: envíos en efectivo cuya comisión sigue como deuda (solo resta comisión).
 * - `pending_capture`: entregado, la captura espera confirmación de MP.
 * - `in_flight`: asignado o en viaje, todavía no entregado.
 */
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

/**
 * Cascada de fugas, en GMV y en comisión (montos positivos, se restan). Cierra exacto en las dos:
 * `quoted − Σ steps = captured`. No coincide con el GMV de Cashflow: aquella cuenta va por fecha de
 * completado y esta por fecha de publicación.
 */
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

/** `GET /admin/reports/:report?from=&to=&band=`. */
export interface AdminReportQuery extends ReportRange {
  band?: DistanceBand;
}

/**
 * `GET /admin/reports/:report/export?from=&to=&band=&section=`: CSV generado en el backend con los
 * mismos números que el JSON. `trend.<kpi>` → `period_start,period_end,value,previous,change` + fila
 * `Total`; `breakdown.<dimension>` → `key,value,share,previous,change` + `Total`; `scorecard` y
 * `corridors` solo en Distancias; `bridge` (`step,amount_ars,cumulative_ars`) y `leakage`
 * (`step,timing,shipments,gmv_ars,commission_ars,share_of_quoted`) solo en Precio y volumen. `change` va
 * en pp para porcentajes y en % para el resto.
 */
export type AdminReportExportSection =
  | `trend.${string}`
  | `breakdown.${string}`
  | "scorecard"
  | "corridors"
  | "bridge"
  | "leakage";

/** Alias del nombre que usa el panel. */
export type AdminOverviewBlockId = AdminOverviewBlockName;

/** `GET /admin/audit-log[/export]?adminId=&action=&targetType=&targetId=&from=&to=&cursor=&limit=`. */
export interface AdminAuditLogQuery {
  adminId?: string;
  action?: string;
  targetType?: AdminTargetType;
  /** Exacto, o prefijo desde `AUDIT_TARGET_PREFIX_MIN_LENGTH` caracteres. */
  targetId?: string;
  from?: string;
  to?: string;
}
