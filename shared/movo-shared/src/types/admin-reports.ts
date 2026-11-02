/**
 * Contratos de los reportes del panel (MOVO-345). Los define el frontend, como `admin-users.ts`
 * (MOVO-295), y los implementan MOVO-342 (bitácora, home, rango y CSV) y MOVO-344 (métricas).
 * Están propuestos en los comentarios de esas dos issues; si el backend los ajusta, se cambian acá
 * y el panel sigue a este archivo.
 */
import type { AdminBlock } from "./admin-shipments";
import type { AdminTargetType, AuditLogEntry } from "./admin";

// ---------------------------------------------------------------------------------------------
// Rango de fechas (B1 de MOVO-342)
// ---------------------------------------------------------------------------------------------

/** Días argentinos `YYYY-MM-DD`, los dos inclusivos. */
export interface ReportRange {
  from: string;
  to: string;
}

/** Tope del largo de un rango: `from` no puede quedar más de un año antes de `to`. */
export const REPORT_RANGE_MAX_DAYS = 366;

/** La decide el backend según el largo: día hasta 31 días, semana hasta 120, mes el resto. */
export type ReportGranularity = "day" | "week" | "month";

export const REPORT_GRANULARITY_LIMITS = { day: 31, week: 120 } as const;

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

/** Headers de cualquier export CSV (bitácora y reportes). */
export const EXPORT_ROWS_HEADER = "x-export-rows";
export const EXPORT_TRUNCATED_HEADER = "x-export-truncated";

// ---------------------------------------------------------------------------------------------
// Home: `GET /admin/overview` (MOVO-342)
// ---------------------------------------------------------------------------------------------

export interface OverviewInbox {
  count: number;
  /** Lo pendiente más viejo de la bandeja; `null` si está vacía. */
  oldestAt: string | null;
  /** `null`: la bandeja no tiene plazo (es informativa). */
  slaHours: number | null;
  /** Lo más viejo pasó el plazo: la tarjeta va al grupo "Fuera de plazo". */
  overSla: boolean;
  /** Pendientes a esta misma hora de ayer, reconstruido con fechas. `null`: no se puede, no se muestra el delta. */
  yesterdayCount: number | null;
  /** Desglose, ordenado de mayor a menor. Puede venir vacío. */
  breakdown: { key: string; count: number }[];
}

export interface AdminOverviewBlocks {
  /** `breakdown` por `DisputeReason`; `awaitingPayment` = en `resolving`. */
  disputes: OverviewInbox & { awaitingPayment: number };
  /** Sin respuesta de un admin; `breakdown` por `SupportTopic`. */
  support: OverviewInbox & { urgent: number };
  /** Verificaciones en revisión manual. */
  kyc: OverviewInbox & { carriers: number; senders: number };
  /** `breakdown` por motivo del reporte. */
  userReports: OverviewInbox & { blockRequested: number };
  /** `alertCounts` de MOVO-326; `breakdown` por tipo de alerta. */
  shipmentAlerts: OverviewInbox & { inTransit: number };
  /** Holds por vencer, capturas fallidas/escaladas y disputas cobrando. */
  payments: OverviewInbox & { holdsExpiringToday: number };
  /** Mensajes moderados por el filtro del chat y reportes de chat. */
  flaggedMessages: OverviewInbox;
  /** Suspensiones que terminan hoy (`endsAt` hoy, sin levantar). */
  sanctionsEndingToday: OverviewInbox;
}
export type AdminOverviewBlockId = keyof AdminOverviewBlocks;
export const ADMIN_OVERVIEW_BLOCKS: readonly AdminOverviewBlockId[] = [
  "disputes",
  "support",
  "kyc",
  "userReports",
  "shipmentAlerts",
  "payments",
  "flaggedMessages",
  "sanctionsEndingToday",
];

/** Error de un bloque con el `requestId` del servicio caído, para que la tarjeta lo muestre. */
export type AdminOverviewBlock<T> =
  | Extract<AdminBlock<T>, { error: null }>
  | {
      data: null;
      error: { code: string; message: string; requestId?: string };
    };

/** `GET /admin/overview[?blocks=kyc,support]`. Sin `blocks` vienen todos; con `blocks`, solo esos. */
export interface AdminOverview {
  generatedAt: string;
  blocks: Partial<{
    [K in AdminOverviewBlockId]: AdminOverviewBlock<AdminOverviewBlocks[K]>;
  }>;
}

// ---------------------------------------------------------------------------------------------
// Bitácora: `GET /admin/audit-log` ampliado y su export (MOVO-342)
// ---------------------------------------------------------------------------------------------

/** Cómo se muestra y adónde lleva el objetivo de una fila. */
export interface AuditTargetRef {
  /** user → nombre; shipment → id corto; support_conversation → código; admin_role → email. */
  label: string | null;
  /** dispute y chat_report: el envío; para linkear. */
  shipmentId?: string;
  /** user_report: el usuario reportado. */
  userId?: string;
}

/** Clave de `AdminAuditLogPage.targets`. */
export const auditTargetKey = (targetType: AdminTargetType, targetId: string) =>
  `${targetType}:${targetId}`;

/**
 * `GET /admin/audit-log` con los nombres y objetivos resueltos. Si `svc-users` u otro servicio no
 * responde, el mapa viene sin esa clave y el panel cae al id: el listado nunca se cae por esto.
 */
export interface AdminAuditLogPage {
  items: AuditLogEntry[];
  nextCursor: string | null;
  admins: Record<string, { fullName: string }>;
  targets: Record<string, AuditTargetRef>;
}

/** Acciones que escribe `svc-admin` en la bitácora. Una nueva se suma acá (el panel la etiqueta). */
export const ADMIN_AUDIT_ACTIONS = [
  "user.suspend",
  "user.disable",
  "user.sanction_lift",
  "user.sanction_withdraw",
  "user.ledger_adjust",
  "user.contact_update",
  "user.sessions_revoke",
  "user.note_add",
  "admin_role.grant",
  "admin_role.revoke",
  "shipment.status_change",
  "support.attachment_request",
  "dispute.note_add",
  "dispute.resolve",
  "report.export",
] as const;
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

/** `GET /admin/audit-log[/export]?adminId=&action=&targetType=&targetId=&cursor=&limit=`. */
export interface AdminAuditLogQuery {
  adminId?: string;
  action?: string;
  targetType?: AdminTargetType;
  /** Exacto, o prefijo desde 8 caracteres (el panel muestra ids cortos). */
  targetId?: string;
}
