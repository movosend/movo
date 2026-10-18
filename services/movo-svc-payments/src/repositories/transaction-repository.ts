import { Prisma, PrismaClient } from "../generated/prisma/client";
import type { HoldStatus, SettlementStatus, TransactionKind, TransactionRole, TransactionStatus } from "@movo/shared";

/** Un hold visible en el historial, con lo necesario para derivar su estado. */
export interface TransactionRow {
  id: string;
  kind: TransactionKind;
  /** `null` en un pago de saldo (`balance_payment`). */
  shipmentId: string | null;
  /** Pago de MP del hold; los movimientos se filtran por él, igual que el estado. */
  mpPaymentId: string | null;
  createdAt: Date;
  /** `created_at` con precisión de µs, para el cursor (el `Date` de JS solo llega a ms). */
  createdAtCursor: string;
  amountArs: number;
  holdStatus: HoldStatus;
  cardBrand: string | null;
  cardLast4: string | null;
  settlementStatus: SettlementStatus | null;
  capturedAt: Date | null;
  grossAmountArs: number | null;
  mpFeeArs: number | null;
  commissionArs: number | null;
  debtOffsetArs: number | null;
  /** MOVO-311: precio acordado y recargo del emisor, para mostrarle al transportista su cobro sin el recargo. */
  baseAmountArs: number;
  debtSurchargeArs: number | null;
  /** MOVO-311: bruto y fee de MP tal como los ve el transportista (fijados al acreditar). */
  carrierGrossAmountArs: number | null;
  carrierMpFeeArs: number | null;
  netAmountArs: number | null;
  hasDispute: boolean;
  hasRefund: boolean;
  /** Monto del último reembolso informado (no la suma). */
  refundedAmountArs: number | null;
}

export interface TransactionMovementRow {
  kind: "refund" | "chargeback" | "mediation";
  amountArs: number | null;
  date: Date;
}

export interface ListTransactionsQuery {
  role: TransactionRole;
  userId: string;
  /** Vacío = sin filtro por estado. */
  statuses: TransactionStatus[];
  /** Inicio (inclusivo) y fin (exclusivo) ya resueltos como instantes de la hora argentina. */
  from?: Date;
  toExclusive?: Date;
  /** `createdAt` en ISO con µs, tal cual lo devolvió `createdAtCursor`. */
  cursor?: { createdAt: string; id: string };
  limit: number;
}

export interface TransactionRepository {
  /** Hasta `limit + 1` filas: la de sobra marca que hay otra página. */
  list(query: ListTransactionsQuery): Promise<TransactionRow[]>;
  findOne(role: TransactionRole, userId: string, id: string): Promise<TransactionRow | null>;
  listMovements(holdId: string, mpPaymentId: string | null): Promise<TransactionMovementRow[]>;
}

interface RawRow {
  id: string;
  kind: TransactionKind;
  shipment_id: string | null;
  mp_payment_id: string | null;
  created_at: Date;
  created_at_cursor: string;
  amount_ars: number;
  hold_status: HoldStatus;
  card_brand: string | null;
  card_last4: string | null;
  settlement_status: SettlementStatus | null;
  captured_at: Date | null;
  gross_amount_ars: number | null;
  mp_fee_ars: number | null;
  commission_ars: number | null;
  debt_offset_ars: number | null;
  base_amount_ars: number;
  debt_surcharge_ars: number | null;
  carrier_gross_amount_ars: number | null;
  carrier_mp_fee_ars: number | null;
  net_amount_ars: number | null;
  has_dispute: boolean;
  has_refund: boolean;
  refunded_amount_ars: number | null;
}

function toRow(r: RawRow): TransactionRow {
  return {
    id: r.id,
    kind: r.kind,
    shipmentId: r.shipment_id,
    mpPaymentId: r.mp_payment_id,
    createdAt: r.created_at,
    createdAtCursor: r.created_at_cursor,
    amountArs: r.amount_ars,
    holdStatus: r.hold_status,
    cardBrand: r.card_brand,
    cardLast4: r.card_last4,
    settlementStatus: r.settlement_status,
    capturedAt: r.captured_at,
    grossAmountArs: r.gross_amount_ars,
    mpFeeArs: r.mp_fee_ars,
    commissionArs: r.commission_ars,
    debtOffsetArs: r.debt_offset_ars,
    baseAmountArs: r.base_amount_ars,
    debtSurchargeArs: r.debt_surcharge_ars,
    carrierGrossAmountArs: r.carrier_gross_amount_ars,
    carrierMpFeeArs: r.carrier_mp_fee_ars,
    netAmountArs: r.net_amount_ars,
    hasDispute: r.has_dispute,
    hasRefund: r.has_refund,
    refundedAmountArs: r.refunded_amount_ars,
  };
}

/**
 * Espejo SQL de `deriveTransactionStatus` (`modules/transactions/transaction-status.ts`):
 * necesario para filtrar por estado ANTES de paginar (AC9). Un cambio en la regla se replica
 * en las dos, y la integración verifica que coincidan. Literales fijos, nunca input.
 */
const STATUS_CASE = Prisma.raw(`CASE
  WHEN t.kind = 'balance_payment' THEN 'completed'
  WHEN t.has_dispute THEN 'disputed'
  WHEN t.has_refund THEN 'refunded'
  WHEN t.settlement_status = 'credited' THEN 'completed'
  WHEN t.hold_status = 'cancelled' THEN 'released'
  ELSE 'reserved'
END`);

/**
 * Los holds que llegaron a MP (AC8): quedan afuera `creating`, `rejected` y los cancelados
 * sin pago. Estado, liquidación y movimientos salen de la misma consulta (AC14): sin N+1.
 * `column` es siempre uno de dos literales, nunca input del usuario.
 */
function visibleTransactions(column: "payer_id" | "carrier_id", userId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT
      h.id,
      'shipment'::text AS kind,
      h.shipment_id,
      h.mp_payment_id,
      h.created_at,
      to_char(h.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor,
      h.amount_ars::float8 AS amount_ars,
      h.base_amount_ars::float8 AS base_amount_ars,
      h.status::text AS hold_status,
      h.card_brand,
      h.card_last4,
      s.status::text AS settlement_status,
      s.captured_at,
      s.gross_amount_ars::float8 AS gross_amount_ars,
      s.mp_fee_ars::float8 AS mp_fee_ars,
      s.commission_ars::float8 AS commission_ars,
      s.debt_offset_ars::float8 AS debt_offset_ars,
      s.debt_surcharge_ars::float8 AS debt_surcharge_ars,
      s.carrier_gross_amount_ars::float8 AS carrier_gross_amount_ars,
      s.carrier_mp_fee_ars::float8 AS carrier_mp_fee_ars,
      s.net_amount_ars::float8 AS net_amount_ars,
      EXISTS (
        SELECT 1 FROM payments.payment_provider_events e
        WHERE e.hold_id = h.id AND e.mp_payment_id = h.mp_payment_id AND e.kind IN ('chargeback', 'mediation')
      ) AS has_dispute,
      EXISTS (
        SELECT 1 FROM payments.payment_provider_events e
        WHERE e.hold_id = h.id AND e.mp_payment_id = h.mp_payment_id AND e.kind = 'refund'
      ) AS has_refund,
      (
        SELECT e.amount_ars::float8 FROM payments.payment_provider_events e
        WHERE e.hold_id = h.id AND e.mp_payment_id = h.mp_payment_id AND e.kind = 'refund'
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 1
      ) AS refunded_amount_ars
    FROM payments.holds h
    LEFT JOIN payments.settlements s ON s.hold_id = h.id
    WHERE h.${Prisma.raw(column)} = ${userId}::uuid
      AND (h.status IN ('in_process', 'authorized', 'captured')
           OR (h.status = 'cancelled' AND h.mp_payment_id IS NOT NULL))`;
}

/**
 * MOVO-312: los pagos de saldo aprobados del usuario, con las mismas columnas que `visibleTransactions`
 * para poder unirlos al historial del emisor. Un intento `creating`/`pending`/`rejected`/`failed` no es una
 * transacción: no movió plata (si después MP lo aprueba, aparece). No tienen liquidación, ni reembolsos ni
 * disputas (los eventos de MP se registran por hold). La tarjeta sale de la guardada, que el borrado
 * suave no pierde.
 */
function approvedBalancePayments(userId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT
      a.id,
      'balance_payment'::text AS kind,
      NULL::uuid AS shipment_id,
      a.mp_payment_id,
      a.created_at,
      to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor,
      a.amount_ars::float8 AS amount_ars,
      a.amount_ars::float8 AS base_amount_ars,
      'captured'::text AS hold_status,
      c.brand::varchar(32) AS card_brand,
      c.last4::varchar(4) AS card_last4,
      NULL::text AS settlement_status,
      NULL::timestamptz AS captured_at,
      NULL::float8 AS gross_amount_ars,
      NULL::float8 AS mp_fee_ars,
      NULL::float8 AS commission_ars,
      NULL::float8 AS debt_offset_ars,
      NULL::float8 AS debt_surcharge_ars,
      NULL::float8 AS carrier_gross_amount_ars,
      NULL::float8 AS carrier_mp_fee_ars,
      NULL::float8 AS net_amount_ars,
      false AS has_dispute,
      false AS has_refund,
      NULL::float8 AS refunded_amount_ars
    FROM payments.balance_payment_attempts a
    LEFT JOIN payments.saved_cards c ON c.id = a.saved_card_id
    WHERE a.user_id = ${userId}::uuid AND a.status = 'approved'`;
}

/** El historial de un rol: el emisor suma sus pagos de saldo; el transportista no (no cobra nada de ahí). */
function historyOf(role: TransactionRole, userId: string): Prisma.Sql {
  const holds = visibleTransactions(columnFor(role), userId);
  return role === "sender" ? Prisma.sql`${holds} UNION ALL ${approvedBalancePayments(userId)}` : holds;
}

function columnFor(role: TransactionRole): "payer_id" | "carrier_id" {
  return role === "sender" ? "payer_id" : "carrier_id";
}

export function createTransactionRepository(db: PrismaClient): TransactionRepository {
  return {
    async list(query) {
      const conditions: Prisma.Sql[] = [];
      if (query.statuses.length > 0) {
        conditions.push(Prisma.sql`(${STATUS_CASE}) IN (${Prisma.join(query.statuses)})`);
      }
      if (query.from) conditions.push(Prisma.sql`t.created_at >= ${query.from}`);
      if (query.toExclusive) conditions.push(Prisma.sql`t.created_at < ${query.toExclusive}`);
      if (query.cursor) {
        conditions.push(
          Prisma.sql`(t.created_at, t.id) < (${query.cursor.createdAt}::timestamptz, ${query.cursor.id}::uuid)`
        );
      }
      const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

      const rows = await db.$queryRaw<RawRow[]>`
        SELECT t.* FROM (${historyOf(query.role, query.userId)}) t
        ${where}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ${query.limit + 1}`;
      return rows.map(toRow);
    },

    async findOne(role, userId, id) {
      const rows = await db.$queryRaw<RawRow[]>`
        SELECT t.* FROM (${historyOf(role, userId)}) t
        WHERE t.id = ${id}::uuid`;
      return rows[0] ? toRow(rows[0]) : null;
    },

    async listMovements(holdId, mpPaymentId) {
      // Sin pago no hay eventos: el estado (`has_dispute`/`has_refund`) exige el mismo `mp_payment_id`.
      if (mpPaymentId === null) return [];
      const events = await db.paymentProviderEvent.findMany({
        where: { holdId, mpPaymentId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return events.map((e) => ({
        kind: e.kind,
        amountArs: e.amountArs === null ? null : Number(e.amountArs),
        date: e.createdAt,
      }));
    },
  };
}
