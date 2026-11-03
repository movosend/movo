import {
  AdminReportById,
  AdminReportExportSection,
  AdminReportId,
  CaptureAmounts,
  DisputesReport,
  DisputesReportBacklogRow,
  DisputesReportRow,
  DistancesReport,
  isReportPercentageMetric,
  PricingReport,
  Report,
  ReportBreakdownRow,
  reportChange,
  ReportCorridor,
  ReportPoint,
  reportRate,
  ReportScorecardMetric,
  ReportScorecardRow,
} from "@movo/shared";
import { CsvColumn, toCsv } from "../../utils/csv";

const TOTAL_LABEL = "Total";

export interface CsvSection {
  body: string;
  /** Sin contar la fila `Total`. */
  rows: number;
}

function trendCsv(report: Report<string>, kpi: string): CsvSection {
  const isPercentage = isReportPercentageMetric(kpi);
  const columns: readonly CsvColumn<ReportPoint>[] = [
    { header: "period_start", value: (row) => row.start },
    { header: "period_end", value: (row) => row.end },
    { header: "value", value: (row) => row.value },
    { header: "previous", value: (row) => row.previous },
    { header: "change", value: (row) => reportChange(row, isPercentage) },
  ];
  const points = report.series[kpi] ?? [];
  const total = report.kpis[kpi] ?? { value: null, previous: null };
  return { body: toCsv(columns, [...points, { start: TOTAL_LABEL, end: "", ...total }]), rows: points.length };
}

function breakdownCsv(report: Report<string>, dimension: string): CsvSection {
  const breakdown = report.breakdowns.find((candidate) => candidate.dimension === dimension);
  if (!breakdown) throw new Error(`Falta el desglose ${dimension}`);
  const isPercentage = isReportPercentageMetric(breakdown.metric);
  const columns: readonly CsvColumn<ReportBreakdownRow>[] = [
    { header: "key", value: (row) => row.key },
    { header: "value", value: (row) => row.value },
    { header: "share", value: (row) => row.share },
    { header: "previous", value: (row) => row.previous },
    { header: "change", value: (row) => reportChange(row, isPercentage) },
  ];
  const total: ReportBreakdownRow = { key: TOTAL_LABEL, share: null, ...breakdown.total };
  return { body: toCsv(columns, [...breakdown.rows, total]), rows: breakdown.rows.length };
}

const BACKLOG_COLUMNS: readonly CsvColumn<DisputesReportBacklogRow>[] = [
  { header: "status", value: (row) => row.status },
  { header: "count", value: (row) => row.count },
  { header: "median_age_hours", value: (row) => row.medianAgeHours },
  { header: "oldest_opened_at", value: (row) => row.oldestOpenedAt },
];

/** Una fila por disputa: ids, fechas y montos. Sin partes, descripción ni razonamiento (MOVO-344). */
const ROW_COLUMNS: readonly CsvColumn<DisputesReportRow>[] = [
  { header: "dispute_id", value: (row) => row.disputeId },
  { header: "shipment_id", value: (row) => row.shipmentId },
  { header: "reason", value: (row) => row.reason },
  { header: "status", value: (row) => row.status },
  { header: "outcome", value: (row) => row.outcome },
  { header: "sender_amount_ars", value: (row) => row.senderAmountArs },
  { header: "carrier_amount_ars", value: (row) => row.carrierAmountArs },
  { header: "opened_at", value: (row) => row.openedAt },
  { header: "resolved_at", value: (row) => row.resolvedAt },
  { header: "resolution_hours", value: (row) => row.resolutionHours },
];

export const disputeRowsCsv = (rows: readonly DisputesReportRow[]): CsvSection => ({ body: toCsv(ROW_COLUMNS, rows), rows: rows.length });

const SCORECARD_METRICS: readonly ReportScorecardMetric[] = ["published", "completionRate", "onTimeRate", "assignedWithin24hRate", "doorToDoorHours", "avgTicket"];

const SCORECARD_COLUMNS: readonly CsvColumn<ReportScorecardRow>[] = [
  { header: "band", value: (row) => row.band },
  ...SCORECARD_METRICS.flatMap((metric): CsvColumn<ReportScorecardRow>[] => [
    { header: metric, value: (row) => row[metric].value },
    { header: `${metric}_change`, value: (row) => reportChange(row[metric], isReportPercentageMetric(metric)) },
  ]),
];

const CORRIDOR_COLUMNS: readonly CsvColumn<ReportCorridor>[] = [
  { header: "origin_city", value: (row) => row.originCity },
  { header: "destination_city", value: (row) => row.destinationCity },
  { header: "distance_km", value: (row) => row.distanceKm },
  { header: "band", value: (row) => row.band },
  { header: "published", value: (row) => row.published },
  { header: "published_previous", value: (row) => row.publishedPrevious },
  { header: "change", value: (row) => reportChange({ value: row.published, previous: row.publishedPrevious }, false) },
  { header: "completion_rate", value: (row) => row.completionRate },
];

interface BridgeRow {
  step: string;
  amount: number;
  cumulative: number;
}

const BRIDGE_COLUMNS: readonly CsvColumn<BridgeRow>[] = [
  { header: "step", value: (row) => row.step },
  { header: "amount_ars", value: (row) => row.amount },
  { header: "cumulative_ars", value: (row) => row.cumulative },
];

function bridgeCsv({ bridge }: PricingReport): CsvSection {
  if (!bridge) return { body: toCsv(BRIDGE_COLUMNS, []), rows: 0 };
  let cumulativeCents = Math.round(bridge.previous * 100);
  const step = (name: string, amount: number): BridgeRow => {
    cumulativeCents += Math.round(amount * 100);
    return { step: name, amount, cumulative: cumulativeCents / 100 };
  };
  const rows: BridgeRow[] = [
    { step: "previous", amount: bridge.previous, cumulative: bridge.previous },
    step("volume", bridge.volume),
    step("mix", bridge.mix),
    ...bridge.price.map((row) => step(row.key, row.amount)),
    { step: "current", amount: bridge.current, cumulative: bridge.current },
  ];
  return { body: toCsv(BRIDGE_COLUMNS, rows), rows: rows.length };
}

interface LeakageRow extends CaptureAmounts {
  step: string;
  timing: boolean | null;
}

function leakageCsv({ leakage }: PricingReport): CsvSection {
  const share = (row: LeakageRow) => (leakage ? reportRate(row.gmvArs, leakage.quoted.gmvArs) : null);
  const columns: readonly CsvColumn<LeakageRow>[] = [
    { header: "step", value: (row) => row.step },
    { header: "timing", value: (row) => (row.timing === null ? null : row.timing ? "yes" : "no") },
    { header: "shipments", value: (row) => row.shipments },
    { header: "gmv_ars", value: (row) => row.gmvArs },
    { header: "commission_ars", value: (row) => row.commissionArs },
    { header: "share_of_quoted", value: share },
  ];
  if (!leakage) return { body: toCsv(columns, []), rows: 0 };
  const rows: LeakageRow[] = [
    { step: "quoted", timing: null, ...leakage.quoted },
    ...leakage.steps.map(({ key, timing, shipments, gmvArs, commissionArs }) => ({ step: key, timing, shipments, gmvArs, commissionArs })),
    { step: "captured", timing: null, ...leakage.captured },
  ];
  return { body: toCsv(columns, rows), rows: rows.length };
}

/** Salen del mismo objeto que devuelve el JSON: así el CSV no puede diferir de la pantalla. `disputes` se pide aparte. */
export function reportSectionCsv<R extends AdminReportId>(id: R, report: AdminReportById[R], section: Exclude<AdminReportExportSection, "disputes">): CsvSection {
  const generic = report as unknown as Report<string>;
  if (section.startsWith("trend.")) return trendCsv(generic, section.slice("trend.".length));
  if (section.startsWith("breakdown.")) return breakdownCsv(generic, section.slice("breakdown.".length));
  if (section === "backlog") return { body: toCsv(BACKLOG_COLUMNS, (report as unknown as DisputesReport).backlog), rows: (report as unknown as DisputesReport).backlog.length };
  if (section === "scorecard") {
    const { scorecard } = report as unknown as DistancesReport;
    return { body: toCsv(SCORECARD_COLUMNS, scorecard), rows: scorecard.length };
  }
  if (section === "corridors") {
    const { corridors } = report as unknown as DistancesReport;
    return { body: toCsv(CORRIDOR_COLUMNS, corridors), rows: corridors.length };
  }
  if (section === "bridge") return bridgeCsv(report as unknown as PricingReport);
  if (section === "leakage") return leakageCsv(report as unknown as PricingReport);
  throw new Error(`Sección desconocida de ${id}: ${section}`);
}
