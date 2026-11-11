import { FastifyInstance, FastifyRequest } from "fastify";
import {
  ApiError,
  argentinaDayBounds,
  CSV_MAX_ROWS,
  FINANCE_KPIS,
  FinanceKpi,
  FinanceReport,
  FinanceReportRow,
  FinanceReportRowsResponse,
  previousReportRange,
  REPORT_RANGE_ERROR_MESSAGES,
  ReportBreakdown,
  reportBuckets,
  reportGranularity,
  ReportPoint,
  ReportRange,
  reportRate,
  ReportSource,
  ReportValue,
  validateReportRange,
} from "@movo/shared";
import { Prisma, PrismaClient } from "../../generated/prisma/client";

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Instantes de un rango de días de Argentina: `>= start` y `< end`. */
function boundsOf(range: ReportRange): { start: Date; end: Date } {
  return { start: argentinaDayBounds(range.from).start, end: argentinaDayBounds(range.to).end };
}

/** `svc-admin` ya completó y validó el rango; se revalida porque de acá sale el SQL. */
function rangeOf({ from, to }: ReportRange): ReportRange {
  const validated = validateReportRange({ from, to });
  if (!validated.ok) {
    throw new ApiError(400, "REPORT_RANGE_INVALID", REPORT_RANGE_ERROR_MESSAGES[validated.reason], { reason: validated.reason });
  }
  return { from, to };
}

/**
 * Saldo de cada usuario como lo lee `readLedgerBalance`: sin lo anulado y sin las reservas negativas de un hold en
 * curso, que todavía no cobraron nada. Alias `l`.
 */
const LEDGER_COUNTS = Prisma.sql`l.status::text <> 'voided' AND NOT (l.status::text = 'reserved' AND l.amount_ars < 0)`;

interface IntervalRow {
  collected: number;
  shipment_price: number;
  commission: number;
  mp_fee: number;
  carrier_net: number;
  refunded: number;
  debt_generated: number;
  debt_collected: number;
  open_debt: number;
}

function kpisOf(row: IntervalRow): Record<FinanceKpi, number> {
  return {
    collected: round2(row.collected),
    shipmentPrice: round2(row.shipment_price),
    commission: round2(row.commission),
    mpFee: round2(row.mp_fee),
    carrierNet: round2(row.carrier_net),
    refunded: round2(row.refunded),
    debtGenerated: round2(row.debt_generated),
    debtCollected: round2(row.debt_collected),
    openDebt: round2(row.open_debt),
  };
}

/**
 * Métricas de varios intervalos en una sola consulta, así un total y sus buckets no pueden medir distinto. Lo cobrado
 * va por `captured_at` y solo con la liquidación acreditada: `capturedAt`, `mpFeeArs` y `netAmountArs` se escriben
 * juntos cuando MP confirma (`capture.service`). La deuda abierta se lee al cierre de cada intervalo.
 */
function intervalMetrics(db: PrismaClient, ranges: ReportRange[]): Promise<IntervalRow[]> {
  const bounds = ranges.map(boundsOf);
  const starts = bounds.map(({ start }) => start.toISOString());
  const ends = bounds.map(({ end }) => end.toISOString());
  return db.$queryRaw<IntervalRow[]>`
    WITH intervals AS MATERIALIZED (
      SELECT * FROM unnest(${starts}::timestamptz[], ${ends}::timestamptz[]) WITH ORDINALITY AS t(start_at, end_at, position)
    )
    SELECT s.collected, s.shipment_price, s.commission, s.mp_fee, s.carrier_net, r.refunded, g.debt_generated, g.debt_collected, d.open_debt
    FROM intervals i
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(x.gross_amount_ars), 0)::float8 AS collected,
             COALESCE(SUM(x.gross_amount_ars - x.debt_surcharge_ars), 0)::float8 AS shipment_price,
             COALESCE(SUM(x.commission_ars), 0)::float8 AS commission,
             COALESCE(SUM(x.mp_fee_ars), 0)::float8 AS mp_fee,
             COALESCE(SUM(x.net_amount_ars), 0)::float8 AS carrier_net
      FROM payments.settlements x
      WHERE x.status::text = 'credited' AND x.captured_at >= i.start_at AND x.captured_at < i.end_at
    ) s
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(f.amount_ars), 0)::float8 AS refunded
      FROM payments.refunds f
      WHERE f.status::text IN ('succeeded', 'fallback_to_ledger') AND f.completed_at >= i.start_at AND f.completed_at < i.end_at
    ) r
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(l.amount_ars) FILTER (WHERE l.amount_ars > 0), 0)::float8 AS debt_generated,
             COALESCE(-SUM(l.amount_ars) FILTER (WHERE l.amount_ars < 0), 0)::float8 AS debt_collected
      FROM payments.user_ledger_entries l
      WHERE ${LEDGER_COUNTS} AND l.created_at >= i.start_at AND l.created_at < i.end_at
    ) g
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(GREATEST(b.balance, 0)), 0)::float8 AS open_debt
      FROM (
        SELECT SUM(l.amount_ars) AS balance
        FROM payments.user_ledger_entries l
        WHERE ${LEDGER_COUNTS} AND l.created_at < i.end_at
        GROUP BY l.user_id
      ) b
    ) d
    ORDER BY i.position`;
}

type KeyedAmounts = Array<{ key: string; current: number; previous: number }>;

function breakdownOf(dimension: string, metric: FinanceKpi, keys: readonly string[], amounts: KeyedAmounts, total: ReportValue): ReportBreakdown {
  const byKey = new Map(amounts.map((row) => [row.key, row]));
  const rows = keys
    .map((key) => {
      const value = round2(byKey.get(key)?.current ?? 0);
      return { key, value, previous: round2(byKey.get(key)?.previous ?? 0), share: reportRate(value, total.value ?? 0) };
    })
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  return { dimension, metric, total, rows };
}

/**
 * MOVO-35 B7-B9 (ADR-025): reporte financiero desde lo que este servicio persiste, sin cruzar con envíos. Interno, lo
 * expone `svc-admin`. Sin datos personales: las filas del CSV son ids y montos.
 */
export default async function paymentsAdminFinanceReportRoutes(app: FastifyInstance) {
  const rangeQuery = {
    type: "object",
    additionalProperties: false,
    required: ["from", "to"],
    properties: { from: { type: "string" }, to: { type: "string" } },
  } as const;

  app.get("/reports/finance", { schema: { hide: true, querystring: rangeQuery } }, async (request: FastifyRequest): Promise<ReportSource<FinanceReport>> => {
    const range = rangeOf(request.query as ReportRange);
    const now = new Date();
    const previous = previousReportRange(range);
    const buckets = reportBuckets(range);
    const current = boundsOf(range);
    const before = boundsOf(previous);

    const [metrics, kinds, refundStatuses, ledgerTypes, openSettlements, balances] = await Promise.all([
      intervalMetrics(app.db, [range, previous, ...buckets, ...buckets.map((bucket) => bucket.previous)]),
      app.db.$queryRaw<KeyedAmounts>`
        SELECT x.kind::text AS key,
               COALESCE(SUM(x.gross_amount_ars) FILTER (WHERE x.captured_at >= ${current.start}), 0)::float8 AS current,
               COALESCE(SUM(x.gross_amount_ars) FILTER (WHERE x.captured_at < ${before.end}), 0)::float8 AS previous
        FROM payments.settlements x
        WHERE x.status::text = 'credited' AND x.captured_at >= ${before.start} AND x.captured_at < ${current.end}
        GROUP BY x.kind`,
      app.db.$queryRaw<KeyedAmounts>`
        SELECT f.status::text AS key,
               COALESCE(SUM(f.amount_ars) FILTER (WHERE f.completed_at >= ${current.start}), 0)::float8 AS current,
               COALESCE(SUM(f.amount_ars) FILTER (WHERE f.completed_at < ${before.end}), 0)::float8 AS previous
        FROM payments.refunds f
        WHERE f.status::text IN ('succeeded', 'fallback_to_ledger') AND f.completed_at >= ${before.start} AND f.completed_at < ${current.end}
        GROUP BY f.status`,
      app.db.$queryRaw<KeyedAmounts>`
        SELECT l.type::text AS key,
               COALESCE(SUM(l.amount_ars) FILTER (WHERE l.created_at >= ${current.start}), 0)::float8 AS current,
               COALESCE(SUM(l.amount_ars) FILTER (WHERE l.created_at < ${before.end}), 0)::float8 AS previous
        FROM payments.user_ledger_entries l
        WHERE ${LEDGER_COUNTS} AND l.amount_ars > 0 AND l.created_at >= ${before.start} AND l.created_at < ${current.end}
        GROUP BY l.type`,
      app.db.$queryRaw<Array<{ status: string; count: number; amount: number }>>`
        SELECT x.status::text AS status, COUNT(*)::int AS count, COALESCE(SUM(x.gross_amount_ars), 0)::float8 AS amount
        FROM payments.settlements x
        WHERE x.status::text IN ('processing', 'escalated') AND x.created_at >= ${current.start} AND x.created_at < ${current.end}
        GROUP BY x.status`,
      app.db.$queryRaw<Array<{ debtor_users: number; credit_users: number; credit: number }>>`
        SELECT (COUNT(*) FILTER (WHERE b.balance > 0))::int AS debtor_users,
               (COUNT(*) FILTER (WHERE b.balance < 0))::int AS credit_users,
               COALESCE(-SUM(b.balance) FILTER (WHERE b.balance < 0), 0)::float8 AS credit
        FROM (
          SELECT SUM(l.amount_ars) AS balance
          FROM payments.user_ledger_entries l
          WHERE ${LEDGER_COUNTS} AND l.created_at < ${current.end}
          GROUP BY l.user_id
        ) b`,
    ]);

    const [totalRow, previousRow] = metrics as [IntervalRow, IntervalRow];
    const totals = kpisOf(totalRow);
    const previousTotals = kpisOf(previousRow);
    const currentPoints = metrics.slice(2, 2 + buckets.length).map(kpisOf);
    const previousPoints = metrics.slice(2 + buckets.length).map(kpisOf);
    const kpis = {} as Record<FinanceKpi, ReportValue>;
    const series = {} as Record<FinanceKpi, ReportPoint[]>;
    for (const kpi of FINANCE_KPIS) {
      kpis[kpi] = { value: totals[kpi], previous: previousTotals[kpi] };
      series[kpi] = buckets.map((bucket, index) => ({
        start: bucket.from,
        end: bucket.to,
        value: currentPoints[index]?.[kpi] ?? null,
        previous: previousPoints[index]?.[kpi] ?? null,
      }));
    }

    const amountOf = (status: string) => {
      const row = openSettlements.find((candidate) => candidate.status === status);
      return { count: row?.count ?? 0, amountArs: round2(row?.amount ?? 0) };
    };
    const snapshot = balances[0];

    return {
      meta: { range, previous, granularity: reportGranularity(range), generatedAt: now.toISOString() },
      kpis,
      series,
      breakdowns: [
        breakdownOf("kind", "collected", ["delivery", "cancellation_penalty", "dispute_partial"], kinds, kpis.collected),
        breakdownOf("refundStatus", "refunded", ["succeeded", "fallback_to_ledger"], refundStatuses, kpis.refunded),
        breakdownOf("ledgerType", "debtGenerated", [...new Set(ledgerTypes.map((row) => row.key))], ledgerTypes, kpis.debtGenerated),
      ],
      pendingConfirmation: amountOf("processing"),
      escalated: amountOf("escalated"),
      debt: {
        debtorUsers: snapshot?.debtor_users ?? 0,
        creditUsers: snapshot?.credit_users ?? 0,
        creditArs: round2(snapshot?.credit ?? 0),
      },
    };
  });

  app.get(
    "/reports/finance/rows",
    {
      schema: {
        hide: true,
        querystring: {
          ...rangeQuery,
          required: ["from", "to", "limit"],
          properties: { ...rangeQuery.properties, limit: { type: "integer", minimum: 1, maximum: CSV_MAX_ROWS } },
        },
      },
    },
    async (request: FastifyRequest): Promise<FinanceReportRowsResponse> => {
      const query = request.query as ReportRange & { limit: number };
      const { start, end } = boundsOf(rangeOf(query));
      const rows = await app.db.$queryRaw<
        Array<{
          id: string;
          shipment_id: string;
          kind: string;
          status: string;
          created_at: Date;
          captured_at: Date | null;
          gross: number;
          debt_surcharge: number;
          commission: number;
          mp_fee: number | null;
          net: number | null;
          refunded: number;
        }>
      >`
        SELECT x.id, x.shipment_id, x.kind::text AS kind, x.status::text AS status, x.created_at, x.captured_at,
               x.gross_amount_ars::float8 AS gross, x.debt_surcharge_ars::float8 AS debt_surcharge, x.commission_ars::float8 AS commission,
               x.mp_fee_ars::float8 AS mp_fee, x.net_amount_ars::float8 AS net,
               COALESCE((
                 SELECT SUM(f.amount_ars) FROM payments.refunds f
                 WHERE f.settlement_id = x.id AND f.status::text IN ('succeeded', 'fallback_to_ledger')
               ), 0)::float8 AS refunded
        FROM payments.settlements x
        WHERE (x.captured_at >= ${start} AND x.captured_at < ${end}) OR (x.created_at >= ${start} AND x.created_at < ${end})
        ORDER BY x.created_at DESC, x.id DESC
        LIMIT ${query.limit + 1}`;
      const items = rows.slice(0, query.limit).map(
        (row): FinanceReportRow => ({
          settlementId: row.id,
          shipmentId: row.shipment_id,
          kind: row.kind,
          status: row.status,
          createdAt: row.created_at.toISOString(),
          capturedAt: row.captured_at?.toISOString() ?? null,
          grossArs: round2(row.gross),
          debtSurchargeArs: round2(row.debt_surcharge),
          commissionArs: round2(row.commission),
          mpFeeArs: row.mp_fee === null ? null : round2(row.mp_fee),
          netArs: row.net === null ? null : round2(row.net),
          refundedArs: round2(row.refunded),
        }),
      );
      return { items, truncated: rows.length > query.limit };
    },
  );
}
