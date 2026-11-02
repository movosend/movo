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

/** Headers de una exportación: cuántas filas trae y si el tope la cortó. */
export const EXPORT_ROWS_HEADER = "x-export-rows";
export const EXPORT_TRUNCATED_HEADER = "x-export-truncated";
