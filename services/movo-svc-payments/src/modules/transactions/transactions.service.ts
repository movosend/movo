import {
  ApiError,
  ARGENTINA_UTC_OFFSET_HOURS,
  TRANSACTION_STATUSES,
  TRANSACTIONS_DEFAULT_LIMIT,
  TRANSACTIONS_MAX_LIMIT,
  TransactionBreakdown,
  TransactionDetail,
  TransactionListItem,
  TransactionListResponse,
  TransactionRole,
  TransactionStatus,
} from "@movo/shared";
import type { TransactionRepository, TransactionRow } from "../../repositories/transaction-repository";
import { deriveTransactionStatus } from "./transaction-status";

export interface ListTransactionsInput {
  role: TransactionRole;
  /** Crudo del query: uno o varios valores, cada uno puede venir separado por comas. */
  status?: string[];
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface TransactionsService {
  list(userId: string, input: ListTransactionsInput): Promise<TransactionListResponse>;
  get(userId: string, role: TransactionRole, id: string): Promise<TransactionDetail>;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// El `created_at` con µs que arma el repositorio (`to_char ... US`): estricto a propósito, porque
// `Date.parse` acepta cosas como "1" y el cast `::timestamptz` de Postgres no.
const CURSOR_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const MAX_STATUS_VALUES = 20;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message: string): ApiError {
  return new ApiError(400, "VALIDATION_FAILED", message);
}

/** `true` si es una fecha real del calendario (no `2026-02-30`). */
function isRealCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/** Primer instante del día argentino `date`: 00:00 de Argentina = 00:00 UTC + el offset de `@movo/shared`. */
function argentinaDayStart(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + ARGENTINA_UTC_OFFSET_HOURS * HOUR_MS);
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + DAY_MS).toISOString().slice(0, 10);
}

function parseStatuses(raw: string[] | undefined): TransactionStatus[] {
  const values = (raw ?? []).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  if (values.length > MAX_STATUS_VALUES) throw invalid("status trae demasiados valores");
  const unknown = values.find((v) => !(TRANSACTION_STATUSES as readonly string[]).includes(v));
  if (unknown) throw invalid(`status inválido: ${unknown}`);
  return [...new Set(values)] as TransactionStatus[];
}

function encodeCursor(row: TransactionRow): string {
  return Buffer.from(`${row.createdAtCursor}|${row.id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  // Va contra columnas `timestamptz`/`uuid`: un valor mal formado sería un 500 en vez de un 400.
  // Ida y vuelta: V8 corre `2026-02-30` al 2 de marzo y Postgres lo rechaza (500 en vez de 400).
  const wellFormed =
    !!createdAt &&
    CURSOR_TIMESTAMP_RE.test(createdAt) &&
    new Date(createdAt.slice(0, 23) + "Z").toISOString() === createdAt.slice(0, 23) + "Z";
  if (!wellFormed || !id || !UUID_RE.test(id)) throw invalid("Cursor de paginación inválido");
  return { createdAt: createdAt as string, id };
}

function notFound(): ApiError {
  // El mismo 404 para ajena e inexistente: no se revela que la transacción existe (AC12).
  return new ApiError(404, "NOT_FOUND", "Transacción no encontrada.");
}

/**
 * MOVO-311: un monto de MP (reintegro, contracargo) es sobre el total pagado, que con deuda del emisor lleva el
 * recargo. El transportista no lo ve (revelaría esa deuda y `reintegro > monto` no cerraría): se topa en el precio.
 */
function visibleAmount(amountArs: number | null, row: TransactionRow, role: TransactionRole): number | null {
  return role === "carrier" && amountArs !== null ? Math.min(amountArs, row.baseAmountArs) : amountArs;
}

/**
 * Qué parte es deuda de la cuenta corriente (MOVO-311), para que el historial cierre con el Saldo:
 * - emisor: el recargo que viajó dentro de lo que pagó (`amount - base`); si el hold se liberó sin cobrar,
 *   el trigger anuló esa deuda y no se muestra;
 * - transportista: lo descontado de su cobro, solo con la liquidación acreditada (igual que el `breakdown`).
 * Un pago de saldo es la deuda entera: no lleva un monto aparte.
 */
function debtAmount(row: TransactionRow, role: TransactionRole, status: TransactionStatus): number | null {
  if (row.kind === "balance_payment") return null;
  const amount =
    role === "carrier"
      ? row.settlementStatus === "credited"
        ? row.debtOffsetArs ?? 0
        : 0
      : status === "released"
        ? 0
        : Math.round((row.amountArs - row.baseAmountArs) * 100) / 100;
  return amount > 0 ? amount : null;
}

function toListItem(row: TransactionRow, role: TransactionRole): TransactionListItem {
  const status = deriveTransactionStatus({
    kind: row.kind,
    holdStatus: row.holdStatus,
    settlementStatus: row.settlementStatus,
    hasDispute: row.hasDispute,
    hasRefund: row.hasRefund,
  });
  const item: TransactionListItem = {
    id: row.id,
    kind: row.kind,
    shipmentId: row.shipmentId,
    date: row.createdAt.toISOString(),
    // MOVO-311: el transportista ve el precio acordado, sin el recargo por la deuda del emisor.
    amountArs: role === "carrier" ? row.baseAmountArs : row.amountArs,
    status,
    refundedAmountArs: row.hasRefund ? visibleAmount(row.refundedAmountArs, row, role) : null,
    debtAmountArs: debtAmount(row, role, status),
  };
  // La tarjeta es del emisor: con `role=carrier` la clave ni viaja.
  if (role === "sender") {
    item.card = row.cardBrand ? { brand: row.cardBrand, last4: row.cardLast4 } : null;
  }
  return item;
}

/** Solo con la liquidación acreditada y el desglose completo; si no, `null`. */
function toBreakdown(row: TransactionRow): TransactionBreakdown | null {
  if (row.settlementStatus !== "credited") return null;
  if (
    row.carrierGrossAmountArs === null ||
    row.carrierMpFeeArs === null ||
    row.commissionArs === null ||
    row.netAmountArs === null
  ) {
    return null;
  }
  // MOVO-311: bruto y fee de MP sin el recargo del emisor, fijados al acreditar (así cierra contra el neto).
  return {
    grossArs: row.carrierGrossAmountArs,
    mpFeeArs: row.carrierMpFeeArs,
    commissionArs: row.commissionArs,
    debtOffsetArs: row.debtOffsetArs ?? 0,
    netArs: row.netAmountArs,
  };
}

export function createTransactionsService(deps: { transactions: TransactionRepository }): TransactionsService {
  const { transactions } = deps;

  return {
    async list(userId, input) {
      const statuses = parseStatuses(input.status);
      if (input.from !== undefined && !isRealCalendarDate(input.from)) throw invalid("from tiene que ser una fecha YYYY-MM-DD");
      if (input.to !== undefined && !isRealCalendarDate(input.to)) throw invalid("to tiene que ser una fecha YYYY-MM-DD");
      if (input.from !== undefined && input.to !== undefined && input.from > input.to) {
        throw invalid("from no puede ser posterior a to");
      }
      const limit = Math.min(input.limit ?? TRANSACTIONS_DEFAULT_LIMIT, TRANSACTIONS_MAX_LIMIT);

      const rows = await transactions.list({
        role: input.role,
        userId,
        statuses,
        from: input.from ? argentinaDayStart(input.from) : undefined,
        // `to` es inclusivo: el tope es el comienzo del día siguiente.
        toExclusive: input.to ? argentinaDayStart(nextDay(input.to)) : undefined,
        cursor: input.cursor ? decodeCursor(input.cursor) : undefined,
        limit,
      });

      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => toListItem(row, input.role)),
        nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
      };
    },

    async get(userId, role, id) {
      const row = await transactions.findOne(role, userId, id);
      if (!row) throw notFound();
      // Un pago de saldo no tiene reembolsos ni disputas registrados: los eventos de MP son por hold.
      const movements = row.kind === "shipment" ? await transactions.listMovements(row.id, row.mpPaymentId) : [];
      const detail: TransactionDetail = {
        ...toListItem(row, role),
        capturedAt: row.capturedAt ? row.capturedAt.toISOString() : null,
        movements: movements.map((m) => ({ kind: m.kind, amountArs: visibleAmount(m.amountArs, row, role), date: m.date.toISOString() })),
      };
      // Con `role=sender` el desglose nunca viaja (AC11, mismo criterio que AC10 de MOVO-212).
      if (role === "carrier") detail.breakdown = toBreakdown(row);
      return detail;
    },
  };
}
