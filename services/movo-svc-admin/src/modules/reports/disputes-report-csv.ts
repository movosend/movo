import {
  DISPUTES_REPORT_PERCENTAGE_KPIS,
  DisputesReport,
  DisputesReportBacklogRow,
  DisputesReportBreakdownDimension,
  DisputesReportExportSection,
  DisputesKpi,
  DisputesReportRow,
  reportChange,
  ReportBreakdownRow,
  ReportPoint,
} from "@movo/shared";
import { CsvColumn, toCsv } from "../../utils/csv";

const TOTAL_LABEL = "Total";

export interface CsvSection {
  body: string;
  /** Sin contar la fila `Total`. */
  rows: number;
}

function trendCsv(report: DisputesReport, kpi: DisputesKpi): CsvSection {
  const isPercentage = DISPUTES_REPORT_PERCENTAGE_KPIS.includes(kpi);
  const columns: readonly CsvColumn<ReportPoint>[] = [
    { header: "period_start", value: (row) => row.start },
    { header: "period_end", value: (row) => row.end },
    { header: "value", value: (row) => row.value },
    { header: "previous", value: (row) => row.previous },
    { header: "change", value: (row) => reportChange(row, isPercentage) },
  ];
  const points = report.series[kpi];
  return { body: toCsv(columns, [...points, { start: TOTAL_LABEL, end: "", ...report.kpis[kpi] }]), rows: points.length };
}

function breakdownCsv(report: DisputesReport, dimension: DisputesReportBreakdownDimension): CsvSection {
  const breakdown = report.breakdowns.find((candidate) => candidate.dimension === dimension);
  if (!breakdown) throw new Error(`Falta el desglose ${dimension}`);
  const isPercentage = DISPUTES_REPORT_PERCENTAGE_KPIS.includes(breakdown.metric as DisputesKpi);
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

/** Las secciones agregadas salen del mismo objeto que devuelve el JSON: así el CSV no puede diferir de la pantalla. */
export function disputesReportSectionCsv(report: DisputesReport, section: Exclude<DisputesReportExportSection, "disputes">): CsvSection {
  if (section === "backlog") return { body: toCsv(BACKLOG_COLUMNS, report.backlog), rows: report.backlog.length };
  const [kind, name] = section.split(".");
  return kind === "trend" ? trendCsv(report, name as DisputesKpi) : breakdownCsv(report, name as DisputesReportBreakdownDimension);
}
