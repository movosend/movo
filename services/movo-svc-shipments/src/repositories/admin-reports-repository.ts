import {
  argentinaDayBounds,
  DISPUTES_REPORT_KPIS,
  DisputeOutcome,
  DISPUTE_OUTCOMES,
  DistanceBand,
  distanceBandOf,
  QuoteBreakdown,
  ShipmentReportFact,
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
import { CarrierActivityDay, ShipmentMetricFact, SupportMetricFact } from "../domain/admin-report-metrics";
import { Prisma, PrismaClient } from "../generated/prisma/client";

const AR_TIME_ZONE = "America/Argentina/Buenos_Aires";

const SHIPMENT_DISTANCE_KM = Prisma.sql`s.distance_km`;
/** La ruta de un viaje de alias `t`, con la misma estimación que `roadDistanceEstimateKm`: el viaje no guarda distancia. */
const TRIP_DISTANCE_KM = Prisma.sql`(
  2 * 6371 * ASIN(LEAST(1, SQRT(
    POWER(SIN(RADIANS((t.destination_lat - t.origin_lat)::float8) / 2), 2) +
    COS(RADIANS(t.origin_lat::float8)) * COS(RADIANS(t.destination_lat::float8)) *
    POWER(SIN(RADIANS((t.destination_lng - t.origin_lng)::float8) / 2), 2)
  ))) * 1.3
)`;

/** Condición del tramo sobre una distancia, por defecto la de un envío de alias `s`. Sin distancia, no cae en ningún tramo. */
function bandCondition(band: DistanceBand, distanceKm: Prisma.Sql = SHIPMENT_DISTANCE_KM): Prisma.Sql {
  if (band === "50_200") return Prisma.sql`${distanceKm} < 200`;
  if (band === "200_500") return Prisma.sql`${distanceKm} >= 200 AND ${distanceKm} < 500`;
  return Prisma.sql`${distanceKm} >= 500`;
}

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
  disputes(range: ReportRange, now: Date, band?: DistanceBand): Promise<DisputesReportSource>;
  /** De la más nueva a la más vieja: las abiertas o resueltas en el rango. Corta en `limit`, con aviso. */
  disputeRows(range: ReportRange, limit: number, band?: DistanceBand): Promise<DisputesReportRowsResponse>;
  /** MOVO-35: los envíos con alguna fecha del reporte en el rango o en el período anterior. */
  shipmentMetricFacts(range: ReportRange): Promise<ShipmentMetricFact[]>;
  /** MOVO-35: los mismos envíos, con lo que necesitan Cashflow y Precio, que se terminan de armar en `svc-admin`. */
  shipmentReportFacts(range: ReportRange): Promise<ShipmentReportFact[]>;
  /** MOVO-35: transportistas activos por día. Con `band`, las ofertas a envíos de ese tramo y los viajes cuya ruta cae en él. */
  carrierActivity(range: ReportRange, band?: DistanceBand): Promise<CarrierActivityDay[]>;
  supportMetricFacts(range: ReportRange): Promise<SupportMetricFact[]>;
}

interface FactRow {
  id: string;
  status: string;
  payment_method: string;
  distance_km: number | null;
  suggested_price: number | null;
  agreed_price: number | null;
  calculation_method: string | null;
  quote_breakdown: QuoteBreakdown | null;
  published_at: Date | null;
  first_assigned_at: Date | null;
  picked_up_at: Date | null;
  first_completed_at: Date | null;
  delivered_at: Date | null;
  delivery_deadline: Date | null;
  pickup_deadline: Date | null;
  anomaly_flagged: boolean;
  has_dispute: boolean;
  cancelled_by_system: boolean;
  pickup_city: string | null;
  delivery_city: string | null;
  pickup_lat: number;
  pickup_lng: number;
  delivery_lat: number;
  delivery_lng: number;
}

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

export function createAdminReportsRepository(db: PrismaClient): AdminReportsRepository {
  /** Las franjas se guardan como reloj de pared de Argentina. La entrega sin franja vence al terminar el día estimado. */
  function factRows(range: ReportRange): Promise<FactRow[]> {
    const { start, end } = boundsOf({ from: previousReportRange(range).from, to: range.to });
    return db.$queryRaw<FactRow[]>`
      WITH candidates AS MATERIALIZED (
        SELECT e.shipment_id
        FROM shipments.shipment_events e
        WHERE e.to_status::text IN ('published', 'completed') AND e.created_at >= ${start} AND e.created_at < ${end}
        UNION
        SELECT d.id FROM shipments.shipments d WHERE d.delivered_at >= ${start} AND d.delivered_at < ${end}
      ),
      -- Toda la historia de cada candidato, no solo la de la ventana: "la primera vez" puede ser anterior al rango.
      events AS MATERIALIZED (
        SELECT e.shipment_id,
               MIN(e.created_at) FILTER (WHERE e.to_status::text = 'published') AS published_at,
               MIN(e.created_at) FILTER (WHERE e.to_status::text IN ('assignment_pending', 'assigned_unfunded', 'assigned')) AS first_assigned_at,
               MIN(e.created_at) FILTER (WHERE e.to_status::text = 'in_transit') AS picked_up_at,
               MIN(e.created_at) FILTER (WHERE e.to_status::text = 'completed') AS first_completed_at,
               COALESCE(bool_or(e.to_status::text = 'cancelled' AND e.actor_id IS NULL), FALSE) AS cancelled_by_system
        FROM shipments.shipment_events e
        JOIN candidates c ON c.shipment_id = e.shipment_id
        GROUP BY e.shipment_id
      )
      SELECT s.id, s.status::text AS status, s.payment_method::text AS payment_method,
             s.distance_km::float8 AS distance_km, s.suggested_price_ars::float8 AS suggested_price,
             s.agreed_price_ars::float8 AS agreed_price, s.calculation_method, s.quote_breakdown,
             e.published_at, e.first_assigned_at, e.picked_up_at, e.first_completed_at, s.delivered_at,
             CASE WHEN s.estimated_delivery_date IS NOT NULL THEN
               (s.estimated_delivery_date + COALESCE(s.estimated_delivery_time_window_end::time, TIME '23:59:59')) AT TIME ZONE ${AR_TIME_ZONE}
             END AS delivery_deadline,
             (s.pickup_date + s.pickup_time_window_end) AT TIME ZONE ${AR_TIME_ZONE} AS pickup_deadline,
             s.transit_anomaly_flagged_at IS NOT NULL AS anomaly_flagged,
             EXISTS (SELECT 1 FROM shipments.disputes d WHERE d.shipment_id = s.id) AS has_dispute,
             COALESCE(e.cancelled_by_system, FALSE) AS cancelled_by_system,
             s.pickup_city, s.delivery_city, s.pickup_lat::float8 AS pickup_lat, s.pickup_lng::float8 AS pickup_lng,
             s.delivery_lat::float8 AS delivery_lat, s.delivery_lng::float8 AS delivery_lng
      FROM shipments.shipments s
      JOIN events e ON e.shipment_id = s.id
      WHERE (e.published_at >= ${start} AND e.published_at < ${end})
         OR (e.first_completed_at >= ${start} AND e.first_completed_at < ${end})
         OR (s.delivered_at >= ${start} AND s.delivered_at < ${end})`;
  }

  /**
   * Métricas de varios intervalos con una sola consulta, así un total y sus buckets no pueden contar distinto. El
   * denominador de la tasa es la primera vez que el envío llegó a `completed`: uno que vuelve a cerrarse después de una
   * disputa (`completed -> disputed -> completed`) cuenta una sola vez, y sigue contando si la disputa lo termina cancelando.
   */
  async function intervalMetrics(ranges: ReportRange[], band?: DistanceBand): Promise<IntervalMetricsRow[]> {
    const disputeInBand = band
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM shipments.shipments s WHERE s.id = d.shipment_id AND ${bandCondition(band)})`
      : Prisma.empty;
    const completedInBand = band
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM shipments.shipments s WHERE s.id = f.shipment_id AND ${bandCondition(band)})`
      : Prisma.empty;
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
          AND e.shipment_id IN (
            SELECT w.shipment_id
            FROM shipments.shipment_events w
            WHERE w.to_status::text = 'completed'
              AND w.created_at >= (SELECT MIN(start_at) FROM intervals)
              AND w.created_at < (SELECT MAX(end_at) FROM intervals)
          )
        GROUP BY e.shipment_id
      )
      SELECT o.opened, r.resolved, r.resolution_hours, r.sender_amount, r.carrier_amount, c.completed
      FROM intervals i
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::int AS opened
        FROM shipments.disputes d
        WHERE d.opened_at >= i.start_at AND d.opened_at < i.end_at ${disputeInBand}
      ) o
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::int AS resolved,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM d.resolved_at - d.opened_at) / 3600))::float8 AS resolution_hours,
               COALESCE(SUM(d.sender_amount_ars), 0)::float8 AS sender_amount,
               COALESCE(SUM(d.carrier_amount_ars), 0)::float8 AS carrier_amount
        FROM shipments.disputes d
        WHERE d.status::text = 'resolved' AND d.resolved_at >= i.start_at AND d.resolved_at < i.end_at ${disputeInBand}
      ) r
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::int AS completed
        FROM first_completed f
        WHERE f.at >= i.start_at AND f.at < i.end_at ${completedInBand}
      ) c
      ORDER BY i.position`;
  }

  return {
    async disputes(range, now, band) {
      const inBand = band
        ? Prisma.sql`AND EXISTS (SELECT 1 FROM shipments.shipments s WHERE s.id = d.shipment_id AND ${bandCondition(band)})`
        : Prisma.empty;
      const previous = previousReportRange(range);
      const buckets = reportBuckets(range);
      const current = boundsOf(range);
      const before = boundsOf(previous);

      const [metrics, reasons, outcomes, backlog, cohorts] = await Promise.all([
        intervalMetrics([range, previous, ...buckets, ...buckets.map((bucket) => bucket.previous)], band),
        db.$queryRaw<Array<{ key: string; current: number; previous: number }>>`
          SELECT d.reason::text AS key,
                 (COUNT(*) FILTER (WHERE d.opened_at >= ${current.start}))::int AS current,
                 (COUNT(*) FILTER (WHERE d.opened_at < ${before.end}))::int AS previous
          FROM shipments.disputes d
          WHERE d.opened_at >= ${before.start} AND d.opened_at < ${current.end} ${inBand}
          GROUP BY d.reason`,
        db.$queryRaw<Array<{ key: string; current: number; previous: number }>>`
          SELECT d.outcome::text AS key,
                 (COUNT(*) FILTER (WHERE d.resolved_at >= ${current.start}))::int AS current,
                 (COUNT(*) FILTER (WHERE d.resolved_at < ${before.end}))::int AS previous
          FROM shipments.disputes d
          WHERE d.status::text = 'resolved' AND d.resolved_at >= ${before.start} AND d.resolved_at < ${current.end} ${inBand}
          GROUP BY d.outcome`,
        db.$queryRaw<Array<{ status: DisputesReportBacklogRow["status"]; count: number; median_age_hours: number | null; oldest: Date | null }>>`
          SELECT d.status::text AS status, COUNT(*)::int AS count,
                 (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ${now}::timestamptz - d.opened_at) / 3600))::float8 AS median_age_hours,
                 MIN(d.opened_at) AS oldest
          FROM shipments.disputes d
          WHERE d.status::text IN ('open', 'resolving') ${inBand}
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
          WHERE d.opened_at >= ${before.start} AND d.opened_at < ${current.end} ${inBand}
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

    async disputeRows(range, limit, band) {
      const inBand = band
        ? Prisma.sql`AND EXISTS (SELECT 1 FROM shipments.shipments s WHERE s.id = d.shipment_id AND ${bandCondition(band)})`
        : Prisma.empty;
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
        WHERE ((d.opened_at >= ${start} AND d.opened_at < ${end})
           OR (d.status::text = 'resolved' AND d.resolved_at >= ${start} AND d.resolved_at < ${end})) ${inBand}
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

    async shipmentMetricFacts(range) {
      const rows = await factRows(range);
      return rows.map(
        (row): ShipmentMetricFact => ({
          band: row.distance_km === null ? null : distanceBandOf(row.distance_km),
          distanceKm: row.distance_km,
          agreedPriceArs: row.agreed_price,
          publishedAt: iso(row.published_at),
          firstAssignedAt: iso(row.first_assigned_at),
          pickedUpAt: iso(row.picked_up_at),
          firstCompletedAt: iso(row.first_completed_at),
          deliveredAt: iso(row.delivered_at),
          deliveryDeadline: iso(row.delivery_deadline),
          pickupDeadline: iso(row.pickup_deadline),
          anomalyFlagged: row.anomaly_flagged,
          hasDispute: row.has_dispute,
          pickupCity: row.pickup_city,
          deliveryCity: row.delivery_city,
          pickupLat: row.pickup_lat,
          pickupLng: row.pickup_lng,
          deliveryLat: row.delivery_lat,
          deliveryLng: row.delivery_lng,
        }),
      );
    },

    async shipmentReportFacts(range) {
      const rows = await factRows(range);
      return rows.map(
        (row): ShipmentReportFact => ({
          shipmentId: row.id,
          status: row.status,
          paymentMethod: row.payment_method,
          band: row.distance_km === null ? null : distanceBandOf(row.distance_km),
          suggestedPriceArs: row.suggested_price,
          agreedPriceArs: row.agreed_price,
          calculationMethod: row.calculation_method,
          breakdown: row.quote_breakdown,
          publishedAt: iso(row.published_at),
          firstAssignedAt: iso(row.first_assigned_at),
          firstCompletedAt: iso(row.first_completed_at),
          deliveredAt: iso(row.delivered_at),
          cancelledBySystem: row.cancelled_by_system,
        }),
      );
    },

    async carrierActivity(range, band) {
      const { start, end } = boundsOf({ from: previousReportRange(range).from, to: range.to });
      const offers = Prisma.sql`
        SELECT o.carrier_id, (o.created_at AT TIME ZONE ${AR_TIME_ZONE})::date AS day
        FROM shipments.offers o
        ${band ? Prisma.sql`JOIN shipments.shipments s ON s.id = o.shipment_id AND ${bandCondition(band)}` : Prisma.empty}
        WHERE o.created_at >= ${start} AND o.created_at < ${end}`;
      const trips = Prisma.sql`
        UNION
        SELECT t.carrier_id, (t.departure_at AT TIME ZONE ${AR_TIME_ZONE})::date AS day
        FROM shipments.trips t
        WHERE t.status::text <> 'cancelled' AND t.departure_at >= ${start} AND t.departure_at < ${end}
        ${band ? Prisma.sql`AND ${bandCondition(band, TRIP_DISTANCE_KM)}` : Prisma.empty}`;
      const rows = await db.$queryRaw<Array<{ day: string; carriers: number }>>`
        SELECT to_char(a.day, 'YYYY-MM-DD') AS day, COUNT(DISTINCT a.carrier_id)::int AS carriers
        FROM (${offers} ${trips}) a
        GROUP BY a.day`;
      return rows;
    },

    async supportMetricFacts(range) {
      const { start, end } = boundsOf({ from: previousReportRange(range).from, to: range.to });
      const rows = await db.$queryRaw<
        Array<{ topic: string; created_at: Date; first_agent_at: Date | null; resolved_at: Date | null; user_wrote_after_agent: boolean }>
      >`
        SELECT c.topic::text AS topic, c.created_at, c.resolved_at, a.first_agent_at,
               EXISTS (
                 SELECT 1 FROM shipments.support_messages m
                 WHERE m.conversation_id = c.id AND m.kind::text = 'user' AND m.created_at > a.first_agent_at
               ) AS user_wrote_after_agent
        FROM shipments.support_conversations c
        LEFT JOIN LATERAL (
          SELECT MIN(m.created_at) AS first_agent_at
          FROM shipments.support_messages m
          WHERE m.conversation_id = c.id AND m.kind::text = 'agent'
        ) a ON TRUE
        WHERE c.created_at >= ${start} AND c.created_at < ${end}`;
      return rows.map((row) => ({
        topic: row.topic,
        createdAt: row.created_at.toISOString(),
        firstAgentAt: iso(row.first_agent_at),
        resolvedAt: iso(row.resolved_at),
        userWroteAfterAgent: row.user_wrote_after_agent,
      }));
    },
  };
}
