import { FastifyInstance, FastifyRequest } from "fastify";
import {
  ApiError,
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
  reportRangeBounds,
  reportRound,
  reportRate,
  ReportSource,
  ReportValue,
  validateReportRange,
} from "@movo/shared";
import { Prisma, PrismaClient } from "../../generated/prisma/client";



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

/**
 * Los movimientos negativos que cancelan deuda: pagos del usuario y descuentos sobre sus cobros. Afuera quedan los
 * créditos que da Movo (`cancellation_compensation`, un `manual_adjustment` a favor), que bajan el saldo sin que nadie
 * haya pagado nada.
 */
const DEBT_PAYMENT_TYPES = Prisma.sql`('penalty_capture', 'fee_offset', 'payment_surcharge', 'voluntary_payment')`;

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
  debtor_users: number;
  credit_users: number;
  credit: number;
}

function kpisOf(row: IntervalRow): Record<FinanceKpi, number> {
  return {
    collected: reportRound(row.collected),
    shipmentPrice: reportRound(row.shipment_price),
    commission: reportRound(row.commission),
    mpFee: reportRound(row.mp_fee),
    carrierNet: reportRound(row.carrier_net),
    refunded: reportRound(row.refunded),
    debtGenerated: reportRound(row.debt_generated),
    debtCollected: reportRound(row.debt_collected),
    openDebt: reportRound(row.open_debt),
  };
}

/**
 * Métricas de varios intervalos en una sola consulta, así un total y sus buckets no pueden medir distinto. Lo cobrado
 * va por `captured_at` y solo con la liquidación acreditada: `capturedAt`, `mpFeeArs` y `netAmountArs` se escriben
 * juntos cuando MP confirma (`capture.service`).
 *
 * La foto de la cuenta corriente (deuda abierta, deudores y saldo a favor) al cierre de cada intervalo sale de una sola
 * pasada por el ledger: el saldo acumulado de cada usuario tras cada movimiento (window function) da cuánto movió ese
 * movimiento cada agregado, y la foto a un instante es la suma de los aportes anteriores. Lo anterior al primer cierre
 * se suma una vez (`base`); por intervalo solo se recorre lo que cae entre el primer cierre y el último.
 */
function intervalMetrics(db: PrismaClient, ranges: ReportRange[]): Promise<IntervalRow[]> {
  const bounds = ranges.map(reportRangeBounds);
  const starts = bounds.map(({ start }) => start.toISOString());
  const ends = bounds.map(({ end }) => end.toISOString());
  return db.$queryRaw<IntervalRow[]>`
    WITH intervals AS MATERIALIZED (
      SELECT * FROM unnest(${starts}::timestamptz[], ${ends}::timestamptz[]) WITH ORDINALITY AS t(start_at, end_at, position)
    ),
    running AS MATERIALIZED (
      SELECT l.created_at, l.amount_ars AS amount,
             SUM(l.amount_ars) OVER (PARTITION BY l.user_id ORDER BY l.created_at, l.id ROWS UNBOUNDED PRECEDING) AS after
      FROM payments.user_ledger_entries l
      WHERE ${LEDGER_COUNTS} AND l.created_at < (SELECT MAX(end_at) FROM intervals)
    ),
    deltas AS MATERIALIZED (
      SELECT r.created_at,
             GREATEST(r.after, 0) - GREATEST(r.after - r.amount, 0) AS debt,
             GREATEST(-r.after, 0) - GREATEST(r.amount - r.after, 0) AS credit,
             (r.after > 0)::int - (r.after - r.amount > 0)::int AS debtors,
             (r.after < 0)::int - (r.after - r.amount < 0)::int AS creditors
      FROM running r
    ),
    base AS MATERIALIZED (
      SELECT COALESCE(SUM(x.debt), 0) AS debt, COALESCE(SUM(x.credit), 0) AS credit,
             COALESCE(SUM(x.debtors), 0) AS debtors, COALESCE(SUM(x.creditors), 0) AS creditors
      FROM deltas x
      WHERE x.created_at < (SELECT MIN(end_at) FROM intervals)
    ),
    recent AS MATERIALIZED (
      SELECT x.* FROM deltas x WHERE x.created_at >= (SELECT MIN(end_at) FROM intervals)
    )
    SELECT s.collected, s.shipment_price, s.commission, s.mp_fee, s.carrier_net, r.refunded, g.debt_generated, g.debt_collected,
           (b.debt + d.debt)::float8 AS open_debt, (b.debtors + d.debtors)::int AS debtor_users,
           (b.creditors + d.creditors)::int AS credit_users, (b.credit + d.credit)::float8 AS credit
    FROM intervals i
    CROSS JOIN base b
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
      WHERE f.status::text = 'succeeded' AND f.completed_at >= i.start_at AND f.completed_at < i.end_at
    ) r
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(l.amount_ars) FILTER (WHERE l.amount_ars > 0), 0)::float8 AS debt_generated,
             COALESCE(-SUM(l.amount_ars) FILTER (WHERE l.amount_ars < 0 AND l.type::text IN ${DEBT_PAYMENT_TYPES}), 0)::float8 AS debt_collected
      FROM payments.user_ledger_entries l
      WHERE ${LEDGER_COUNTS} AND l.created_at >= i.start_at AND l.created_at < i.end_at
    ) g
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(x.debt), 0) AS debt, COALESCE(SUM(x.credit), 0) AS credit,
             COALESCE(SUM(x.debtors), 0) AS debtors, COALESCE(SUM(x.creditors), 0) AS creditors
      FROM recent x
      WHERE x.created_at < i.end_at
    ) d
    ORDER BY i.position`;
}

type KeyedAmounts = Array<{ key: string; current: number; previous: number }>;

function breakdownOf(dimension: string, metric: FinanceKpi, keys: readonly string[], amounts: KeyedAmounts, total: ReportValue): ReportBreakdown {
  const byKey = new Map(amounts.map((row) => [row.key, row]));
  const rows = keys
    .map((key) => {
      const value = reportRound(byKey.get(key)?.current ?? 0);
      return { key, value, previous: reportRound(byKey.get(key)?.previous ?? 0), share: reportRate(value, total.value ?? 0) };
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
    const current = reportRangeBounds(range);
    const before = reportRangeBounds(previous);

    const [metrics, kinds, refundsToLedger, ledgerTypes, openSettlements] = await Promise.all([
      intervalMetrics(app.db, [range, previous, ...buckets, ...buckets.map((bucket) => bucket.previous)]),
      app.db.$queryRaw<KeyedAmounts>`
        SELECT x.kind::text AS key,
               COALESCE(SUM(x.gross_amount_ars) FILTER (WHERE x.captured_at >= ${current.start}), 0)::float8 AS current,
               COALESCE(SUM(x.gross_amount_ars) FILTER (WHERE x.captured_at < ${before.end}), 0)::float8 AS previous
        FROM payments.settlements x
        WHERE x.status::text = 'credited' AND x.captured_at >= ${before.start} AND x.captured_at < ${current.end}
        GROUP BY x.kind`,
      // Al emisor no le llegó nada: solo se anotó como deuda del transportista (DD-056). Va aparte, no como reembolsado.
      app.db.$queryRaw<Array<{ count: number; amount: number }>>`
        SELECT COUNT(*)::int AS count, COALESCE(SUM(f.amount_ars), 0)::float8 AS amount
        FROM payments.refunds f
        WHERE f.status::text = 'fallback_to_ledger' AND f.completed_at >= ${current.start} AND f.completed_at < ${current.end}`,
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
        WHERE x.status::text IN ('processing', 'escalated')
        GROUP BY x.status`,
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
      return { count: row?.count ?? 0, amountArs: reportRound(row?.amount ?? 0) };
    };
    const ledgerRefunds = refundsToLedger[0];

    return {
      meta: { range, previous, granularity: reportGranularity(range), generatedAt: now.toISOString() },
      kpis,
      series,
      breakdowns: [
        breakdownOf("kind", "collected", ["delivery", "cancellation_penalty", "dispute_partial"], kinds, kpis.collected),
        breakdownOf("ledgerType", "debtGenerated", [...new Set(ledgerTypes.map((row) => row.key))], ledgerTypes, kpis.debtGenerated),
      ],
      pendingConfirmation: amountOf("processing"),
      escalated: amountOf("escalated"),
      refundsToLedger: { count: ledgerRefunds?.count ?? 0, amountArs: reportRound(ledgerRefunds?.amount ?? 0) },
      // El primer intervalo es el rango entero: su foto es la del cierre del rango.
      debt: {
        debtorUsers: totalRow.debtor_users,
        creditUsers: totalRow.credit_users,
        creditArs: reportRound(totalRow.credit),
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
      const { start, end } = reportRangeBounds(rangeOf(query));
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
          refunded_to_ledger: number;
        }>
      >`
        SELECT x.id, x.shipment_id, x.kind::text AS kind, x.status::text AS status, x.created_at, x.captured_at,
               x.gross_amount_ars::float8 AS gross, x.debt_surcharge_ars::float8 AS debt_surcharge, x.commission_ars::float8 AS commission,
               x.mp_fee_ars::float8 AS mp_fee, x.net_amount_ars::float8 AS net,
               COALESCE((
                 SELECT SUM(f.amount_ars) FROM payments.refunds f
                 WHERE f.settlement_id = x.id AND f.status::text = 'succeeded'
               ), 0)::float8 AS refunded,
               COALESCE((
                 SELECT SUM(f.amount_ars) FROM payments.refunds f
                 WHERE f.settlement_id = x.id AND f.status::text = 'fallback_to_ledger'
               ), 0)::float8 AS refunded_to_ledger
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
          grossArs: reportRound(row.gross),
          debtSurchargeArs: reportRound(row.debt_surcharge),
          commissionArs: reportRound(row.commission),
          mpFeeArs: row.mp_fee === null ? null : reportRound(row.mp_fee),
          netArs: row.net === null ? null : reportRound(row.net),
          refundedArs: reportRound(row.refunded),
          refundedToLedgerArs: reportRound(row.refunded_to_ledger),
        }),
      );
      return { items, truncated: rows.length > query.limit };
    },
  );
}
