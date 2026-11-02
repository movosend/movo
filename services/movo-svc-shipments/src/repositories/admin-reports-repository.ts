import {
  argentinaDayBounds,
  DISPUTES_REPORT_KPIS,
  DisputeOutcome,
  DISPUTE_OUTCOMES,
  DisputeReason,
  DisputeFunnelStage,
  DisputesReportBacklogRow,
  DisputesKpi,
  DisputesReportRow,
  DisputesReportRowsResponse,
  DisputesReportSource,
  previousReportRange,
  ReportBreakdown,
  reportBuckets,
  reportGranularity,
  ReportPoint,
  ReportRange,
  ReportValue,
} from "@movo/shared";
import { PrismaClient } from "../generated/prisma/client";

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round2OrNull = (value: number | null): number | null => (value === null ? null : round2(value));

/** Instantes de un rango de días de Argentina: `>= start` y `< end`. */
function boundsOf(range: ReportRange): { start: Date; end: Date } {
  return { start: argentinaDayBounds(range.from).start, end: argentinaDayBounds(range.to).end };
}

interface FunnelCohortRow {
  is_current: boolean;
  opened: number;
  decided: number;
  resolved: number;
  to_decided_hours: number | null;
  to_resolved_hours: number | null;
}

interface IntervalMetricsRow {
  opened: number;
  resolved: number;
  resolution_hours: number | null;
  sender_amount: number;
  carrier_amount: number;
  completed: number;
}

function kpisOf(row: IntervalMetricsRow): Record<DisputesKpi, number | null> {
  return {
    opened: row.opened,
    resolved: row.resolved,
    resolutionHours: round2OrNull(row.resolution_hours),
    disputeRate: row.completed === 0 ? null : round2((row.opened / row.completed) * 100),
    senderAmountArs: round2(row.sender_amount),
    carrierAmountArs: round2(row.carrier_amount),
  };
}

function breakdownOf<D extends string>(
  dimension: D,
  metric: DisputesKpi,
  keys: readonly string[],
  counts: Array<{ key: string; current: number; previous: number }>,
  total: ReportValue,
): ReportBreakdown<D> {
  const byKey = new Map(counts.map((row) => [row.key, row]));
  const rows = keys.map((key) => {
    const value = byKey.get(key)?.current ?? 0;
    return { key, value, previous: byKey.get(key)?.previous ?? 0, share: total.value ? round2((value / total.value) * 100) : null };
  });
  // De mayor a menor; los que no tuvieron casos también van, así el desglose siempre tiene las mismas filas.
  rows.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  return { dimension, metric, total, rows };
}

/**
 * MOVO-344 (ADR-025): agregados del reporte de disputas, en vivo y sin tablas precalculadas. `opened_at` y `resolved_at`
 * no tienen índice a propósito: el ticket los pide solo si el volumen los necesita, y las disputas son pocas.
 */
export interface AdminReportsRepository {
  disputes(range: ReportRange, now: Date): Promise<DisputesReportSource>;
  /** De la más nueva a la más vieja: las abiertas o resueltas en el rango. Corta en `limit`, con aviso. */
  disputeRows(range: ReportRange, limit: number): Promise<DisputesReportRowsResponse>;
}

export function createAdminReportsRepository(db: PrismaClient): AdminReportsRepository {
  /**
   * Métricas de varios intervalos con una sola consulta, así un total y sus buckets no pueden contar distinto. El
   * denominador de la tasa es la primera vez que el envío llegó a `completed`: uno que vuelve a cerrarse después de una
   * disputa (`completed -> disputed -> completed`) cuenta una sola vez, y sigue contando si la disputa lo termina cancelando.
   */
  async function intervalMetrics(ranges: ReportRange[]): Promise<IntervalMetricsRow[]> {
    const bounds = ranges.map(boundsOf);
    const starts = bounds.map(({ start }) => start.toISOString());
    const ends = bounds.map(({ end }) => end.toISOString());
    return db.$queryRaw<IntervalMetricsRow[]>`
      WITH intervals AS MATERIALIZED (
        SELECT * FROM unnest(${starts}::timestamptz[], ${ends}::timestamptz[]) WITH ORDINALITY AS t(start_at, end_at, position)
      ),
      first_completed AS MATERIALIZED (
        SELECT e.shipment_id, MIN(e.created_at) AS at
        FROM shipments.shipment_events e
        WHERE e.to_status::text = 'completed'
        GROUP BY e.shipment_id
      )
      SELECT o.opened, r.resolved, r.resolution_hours, r.sender_amount, r.carrier_amount, c.completed
      FROM intervals i
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::int AS opened
        FROM shipments.disputes d
        WHERE d.opened_at >= i.start_at AND d.opened_at < i.end_at
      ) o
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::int AS resolved,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM d.resolved_at - d.opened_at) / 3600))::float8 AS resolution_hours,
               COALESCE(SUM(d.sender_amount_ars), 0)::float8 AS sender_amount,
               COALESCE(SUM(d.carrier_amount_ars), 0)::float8 AS carrier_amount
        FROM shipments.disputes d
        WHERE d.status::text = 'resolved' AND d.resolved_at >= i.start_at AND d.resolved_at < i.end_at
      ) r
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::int AS completed
        FROM first_completed f
        WHERE f.at >= i.start_at AND f.at < i.end_at
      ) c
      ORDER BY i.position`;
  }

  return {
    async disputes(range, now) {
      const previous = previousReportRange(range);
      const buckets = reportBuckets(range);
      const current = boundsOf(range);
      const before = boundsOf(previous);

      const [metrics, reasons, outcomes, backlog, cohorts] = await Promise.all([
        intervalMetrics([range, previous, ...buckets, ...buckets.map((bucket) => bucket.previous)]),
        db.$queryRaw<Array<{ key: string; current: number; previous: number }>>`
          SELECT d.reason::text AS key,
                 (COUNT(*) FILTER (WHERE d.opened_at >= ${current.start}))::int AS current,
                 (COUNT(*) FILTER (WHERE d.opened_at < ${before.end}))::int AS previous
          FROM shipments.disputes d
          WHERE d.opened_at >= ${before.start} AND d.opened_at < ${current.end}
          GROUP BY d.reason`,
        db.$queryRaw<Array<{ key: string; current: number; previous: number }>>`
          SELECT d.outcome::text AS key,
                 (COUNT(*) FILTER (WHERE d.resolved_at >= ${current.start}))::int AS current,
                 (COUNT(*) FILTER (WHERE d.resolved_at < ${before.end}))::int AS previous
          FROM shipments.disputes d
          WHERE d.status::text = 'resolved' AND d.resolved_at >= ${before.start} AND d.resolved_at < ${current.end}
          GROUP BY d.outcome`,
        db.$queryRaw<Array<{ status: DisputesReportBacklogRow["status"]; count: number; median_age_hours: number | null; oldest: Date | null }>>`
          SELECT d.status::text AS status, COUNT(*)::int AS count,
                 (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ${now}::timestamptz - d.opened_at) / 3600))::float8 AS median_age_hours,
                 MIN(d.opened_at) AS oldest
          FROM shipments.disputes d
          WHERE d.status::text IN ('open', 'resolving')
          GROUP BY d.status`,
        // Una `resolving` que vuelve a `open` (abortResolution) deja de estar decidida, y borra `decided_at`.
        db.$queryRaw<FunnelCohortRow[]>`
          SELECT d.opened_at >= ${current.start} AS is_current,
                 COUNT(*)::int AS opened,
                 (COUNT(*) FILTER (WHERE d.status::text IN ('resolving', 'resolved')))::int AS decided,
                 (COUNT(*) FILTER (WHERE d.status::text = 'resolved'))::int AS resolved,
                 (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM d.decided_at - d.opened_at) / 3600))::float8 AS to_decided_hours,
                 (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM d.resolved_at - d.decided_at) / 3600))::float8 AS to_resolved_hours
          FROM shipments.disputes d
          WHERE d.opened_at >= ${before.start} AND d.opened_at < ${current.end}
          GROUP BY 1`,
      ]);

      const [totalRow, previousRow] = metrics as [IntervalMetricsRow, IntervalMetricsRow];
      const totals = kpisOf(totalRow);
      const previousTotals = kpisOf(previousRow);
      const currentPoints = metrics.slice(2, 2 + buckets.length).map(kpisOf);
      const previousPoints = metrics.slice(2 + buckets.length).map(kpisOf);

      const kpis = {} as Record<DisputesKpi, ReportValue>;
      const series = {} as Record<DisputesKpi, ReportPoint[]>;
      for (const kpi of DISPUTES_REPORT_KPIS) {
        kpis[kpi] = { value: totals[kpi], previous: previousTotals[kpi] };
        series[kpi] = buckets.map((bucket, index) => ({
          start: bucket.from,
          end: bucket.to,
          value: currentPoints[index]?.[kpi] ?? null,
          previous: previousPoints[index]?.[kpi] ?? null,
        }));
      }

      const backlogOf = (status: DisputesReportBacklogRow["status"]): DisputesReportBacklogRow => {
        const row = backlog.find((candidate) => candidate.status === status);
        return {
          status,
          count: row?.count ?? 0,
          medianAgeHours: round2OrNull(row?.median_age_hours ?? null),
          oldestOpenedAt: row?.oldest?.toISOString() ?? null,
        };
      };

      const cohort = cohorts.find((row) => row.is_current);
      const previousCohort = cohorts.find((row) => !row.is_current);
      const funnel: DisputeFunnelStage[] | null = cohort
        ? [
            { key: "opened", count: cohort.opened, previous: previousCohort?.opened ?? 0, medianHoursFromPrevious: null },
            { key: "decided", count: cohort.decided, previous: previousCohort?.decided ?? 0, medianHoursFromPrevious: round2OrNull(cohort.to_decided_hours) },
            { key: "resolved", count: cohort.resolved, previous: previousCohort?.resolved ?? 0, medianHoursFromPrevious: round2OrNull(cohort.to_resolved_hours) },
          ]
        : null;

      return {
        meta: { range, previous, granularity: reportGranularity(range), generatedAt: now.toISOString() },
        kpis,
        series,
        breakdowns: [
          breakdownOf("reason", "opened", Object.values(DisputeReason), reasons, kpis.opened),
          breakdownOf("outcome", "resolved", DISPUTE_OUTCOMES as readonly DisputeOutcome[], outcomes, kpis.resolved),
        ],
        backlog: [backlogOf("open"), backlogOf("resolving")],
        funnel,
      };
    },

    async disputeRows(range, limit) {
      const { start, end } = boundsOf(range);
      const rows = await db.$queryRaw<
        Array<{
          id: string;
          shipment_id: string;
          reason: string;
          status: string;
          outcome: string | null;
          sender_amount: number | null;
          carrier_amount: number | null;
          opened_at: Date;
          resolved_at: Date | null;
          resolution_hours: number | null;
        }>
      >`
        SELECT d.id, d.shipment_id, d.reason::text AS reason, d.status::text AS status,
               CASE WHEN d.status::text = 'resolved' THEN d.outcome::text END AS outcome,
               CASE WHEN d.status::text = 'resolved' THEN d.sender_amount_ars::float8 END AS sender_amount,
               CASE WHEN d.status::text = 'resolved' THEN d.carrier_amount_ars::float8 END AS carrier_amount,
               d.opened_at,
               CASE WHEN d.status::text = 'resolved' THEN d.resolved_at END AS resolved_at,
               CASE WHEN d.status::text = 'resolved' THEN (EXTRACT(EPOCH FROM d.resolved_at - d.opened_at) / 3600)::float8 END AS resolution_hours
        FROM shipments.disputes d
        WHERE (d.opened_at >= ${start} AND d.opened_at < ${end})
           OR (d.status::text = 'resolved' AND d.resolved_at >= ${start} AND d.resolved_at < ${end})
        ORDER BY d.opened_at DESC, d.id DESC
        LIMIT ${limit + 1}`;
      const items = rows.slice(0, limit).map(
        (row): DisputesReportRow => ({
          disputeId: row.id,
          shipmentId: row.shipment_id,
          reason: row.reason,
          status: row.status,
          outcome: row.outcome,
          senderAmountArs: round2OrNull(row.sender_amount),
          carrierAmountArs: round2OrNull(row.carrier_amount),
          openedAt: row.opened_at.toISOString(),
          resolvedAt: row.resolved_at?.toISOString() ?? null,
          resolutionHours: round2OrNull(row.resolution_hours),
        }),
      );
      return { items, truncated: rows.length > limit };
    },
  };
}
