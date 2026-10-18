import { Prisma } from "../../generated/prisma/client";
import type { LedgerEntryStatus } from "../../generated/prisma/client";
import { ApiError } from "@movo/shared";
import type {
  CreateManualAdjustmentRequest,
  CreateUserLedgerEntryRequest,
  CreateUserLedgerEntryResponse,
  UserLedgerBalanceResponse,
  UserLedgerEntry as UserLedgerEntryDto,
  UserLedgerPageResponse,
} from "@movo/shared";
import { fingerprintOf as fingerprint } from "../../repositories/user-ledger-repository";
import type { UserLedgerEntry, UserLedgerRepository } from "../../repositories/user-ledger-repository";
import type { PrismaClient } from "../../generated/prisma/client";
import type { ShipmentsClient } from "../../adapters/shipments-client";
import { resolveShipmentOrigins } from "../../adapters/shipments-client";

export const LEDGER_DEFAULT_LIMIT = 20;
export const LEDGER_MAX_LIMIT = 50;
/** Tope de un movimiento: evita un typo (un cero de más) que deje a alguien debiendo millones. */
export const LEDGER_MAX_ABS_AMOUNT_ARS = 10_000_000;

export interface UserLedgerService {
  balance(userId: string): Promise<UserLedgerBalanceResponse>;
  createEntry(userId: string, input: CreateUserLedgerEntryRequest): Promise<CreateUserLedgerEntryResponse>;
  createManualAdjustment(userId: string, input: CreateManualAdjustmentRequest): Promise<CreateUserLedgerEntryResponse>;
  /** Movimientos del usuario con su saldo, más nuevos primero. */
  page(userId: string, opts: { cursor?: string; limit?: number }): Promise<UserLedgerPageResponse>;
  pageWithOrigins(userId: string, opts: { cursor?: string; limit?: number }): Promise<UserLedgerPageResponse>;
  /** Transición de estado de un movimiento (p. ej. `pending` -> `settled`, o anularlo). */
  transition(userId: string, entryId: string, from: LedgerEntryStatus, to: LedgerEntryStatus): Promise<UserLedgerEntryDto>;
}

export interface UserLedgerServiceDeps {
  ledger: UserLedgerRepository;
  db?: PrismaClient;
  shipmentsClient?: ShipmentsClient;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function invalid(message: string): ApiError {
  return new ApiError(400, "VALIDATION_FAILED", message);
}

/** `voided` es terminal y de `settled` solo se sale anulando; `reserved` puede volver a `pending`. */
const ALLOWED_TRANSITIONS: Record<LedgerEntryStatus, readonly LedgerEntryStatus[]> = {
  pending: ["reserved", "settled", "voided"],
  reserved: ["pending", "settled", "voided"],
  settled: ["voided"],
  voided: [],
};

/** Con signo, distinto de cero, hasta 2 decimales. Los decimales se miran acá: Ajv compara en float. */
function assertValidAmount(amountArs: number): void {
  // Un número con a lo sumo 2 decimales vuelve igual tras redondear a centavos; sin tolerancias.
  if (
    !Number.isFinite(amountArs) ||
    amountArs === 0 ||
    Math.abs(amountArs) > LEDGER_MAX_ABS_AMOUNT_ARS ||
    Math.round(amountArs * 100) / 100 !== amountArs
  ) {
    throw invalid("amountArs tiene que ser un monto distinto de cero, con hasta 2 decimales");
  }
}

function toDto(row: UserLedgerEntry, opts?: { maskReason?: boolean }): UserLedgerEntryDto & { originLabel: null; destination: null } {
  return {
    id: row.id,
    userId: row.userId,
    roleAtOrigin: row.roleAtOrigin,
    type: row.type,
    amountArs: row.amountArs.toNumber(),
    status: row.status,
    shipmentId: row.shipmentId,
    holdId: row.holdId,
    paymentId: row.paymentId,
    reason: opts?.maskReason ? null : row.reason,
    createdAt: row.createdAt.toISOString(),
    originLabel: null,
    destination: null,
  };
}

function encodeCursor(row: UserLedgerEntry): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [createdAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  // Ida y vuelta: V8 corre `2026-02-30` al 2 de marzo y Postgres lo rechazaría (500 en vez de 400).
  const wellFormed =
    !!createdAt && CURSOR_TIMESTAMP_RE.test(createdAt) && new Date(createdAt).toISOString() === createdAt;
  if (!wellFormed || !id || !UUID_RE.test(id)) throw invalid("Cursor de paginación inválido");
  return { createdAt: new Date(createdAt as string), id };
}

export function createUserLedgerService(deps: UserLedgerServiceDeps): UserLedgerService {
  const { ledger } = deps;

  function toSummary(s: { balance: Prisma.Decimal; oldestUnpaidAt: Date | null }): UserLedgerBalanceResponse {
    return { balanceArs: s.balance.toNumber(), oldestUnpaidAt: s.oldestUnpaidAt?.toISOString() ?? null };
  }

  async function balance(userId: string): Promise<UserLedgerBalanceResponse> {
    return toSummary(await ledger.summary(userId));
  }

  /**
   * Reintento con la misma key: mismo cuerpo -> el movimiento original; otro cuerpo -> 409.
   * Ojo: el original se devuelve tal como está hoy, así que `status` puede haber cambiado desde el
   * alta (`settled`, `voided`). Con `created: false` el llamador tiene que mirar `entry.status`.
   */
  async function insertIdempotent(data: Parameters<UserLedgerRepository["insert"]>[0]) {
    const { entry, created } = await ledger.insert(data);
    if (!created && entry.requestFingerprint !== data.requestFingerprint) {
      throw new ApiError(
        409,
        "LEDGER_IDEMPOTENCY_CONFLICT",
        "La idempotencyKey ya se usó con otro movimiento."
      );
    }
    return { entry: toDto(entry), created };
  }

  return {
    balance,

    async pageWithOrigins(userId, opts) {
      const page = await this.page(userId, opts);
      const shipmentIds = [...new Set(page.items.map((item) => item.shipmentId).filter((id): id is string => !!id))];
      const paymentIds = [...new Set(page.items.filter((item) => item.type === "voluntary_payment")
        .map((item) => item.paymentId).filter((id): id is string => !!id))];
      const cardLabels = async () => {
        if (!deps.db || paymentIds.length === 0) return new Map<string, string>();
        const attempts = await deps.db.balancePaymentAttempt.findMany({
          where: { userId, mpPaymentId: { in: paymentIds } },
          select: { mpPaymentId: true, savedCardId: true },
        });
        const cardIds = attempts.map((attempt) => attempt.savedCardId).filter((id): id is string => !!id);
        const cards = cardIds.length ? await deps.db.savedCard.findMany({
          where: { userId, id: { in: cardIds } }, select: { id: true, brand: true, last4: true },
        }) : [];
        const cardsById = new Map(cards.map((card) => [card.id, card]));
        return new Map(attempts.map((attempt) => {
          const card = attempt.savedCardId ? cardsById.get(attempt.savedCardId) : null;
          const brand = card ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : null;
          return [attempt.mpPaymentId, card ? `${brand} •••• ${card.last4}` : "Pago de saldo"];
        }));
      };
      const [payments, shipments] = await Promise.all([
        cardLabels(), resolveShipmentOrigins(deps.shipmentsClient, userId, shipmentIds),
      ]);
      return { ...page, items: page.items.map((item) => ({ ...item,
        originLabel: item.shipmentId ? shipments.get(item.shipmentId)?.label ?? null
          : item.paymentId ? payments.get(item.paymentId) ?? null : null,
        destination: item.shipmentId ? shipments.get(item.shipmentId)?.destination ?? null : null,
      })) };
    },

    async createEntry(userId, input) {
      assertValidAmount(input.amountArs);
      const amountArs = new Prisma.Decimal(input.amountArs.toFixed(2));
      const status = input.status ?? "pending";
      return insertIdempotent({
        userId,
        roleAtOrigin: input.roleAtOrigin ?? null,
        type: input.type,
        amountArs,
        status,
        shipmentId: input.shipmentId ?? null,
        holdId: input.holdId ?? null,
        paymentId: input.paymentId ?? null,
        reason: null,
        adminId: null,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint({
          userId,
          type: input.type,
          roleAtOrigin: input.roleAtOrigin ?? null,
          amount: amountArs.toFixed(2),
          status,
          shipmentId: input.shipmentId ?? null,
          holdId: input.holdId ?? null,
          paymentId: input.paymentId ?? null,
        }),
      });
    },

    async createManualAdjustment(userId, input) {
      assertValidAmount(input.amountArs);
      const reason = input.reason.trim();
      if (!reason) throw invalid("reason es obligatorio en un ajuste manual");
      const amountArs = new Prisma.Decimal(input.amountArs.toFixed(2));
      return insertIdempotent({
        userId,
        roleAtOrigin: null,
        type: "manual_adjustment",
        amountArs,
        status: "pending",
        shipmentId: input.shipmentId ?? null,
        holdId: null,
        paymentId: null,
        reason,
        adminId: input.adminId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint({
          userId,
          type: "manual_adjustment",
          amount: amountArs.toFixed(2),
          reason,
          adminId: input.adminId,
          shipmentId: input.shipmentId ?? null,
        }),
      });
    },

    async page(userId, opts) {
      const limit = Math.min(Math.max(opts.limit ?? LEDGER_DEFAULT_LIMIT, 1), LEDGER_MAX_LIMIT);
      const after = opts.cursor ? decodeCursor(opts.cursor) : undefined;
      const { rows, ...summary } = await ledger.summaryWithPage(userId, limit + 1, after);
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const last = pageRows[pageRows.length - 1];
      return {
        ...toSummary(summary),
        items: pageRows.map((r) => toDto(r, { maskReason: true })),
        nextCursor: hasMore && last ? encodeCursor(last) : null,
      };
    },

    async transition(userId, entryId, from, to) {
      if (!ALLOWED_TRANSITIONS[from].includes(to)) {
        throw new ApiError(409, "LEDGER_INVALID_TRANSITION", `Transición no permitida: ${from} -> ${to}.`);
      }
      const moved = await ledger.updateStatusIfCurrent(userId, entryId, from, to);
      const row = await ledger.findById(userId, entryId);
      if (!row) throw new ApiError(404, "LEDGER_ENTRY_NOT_FOUND", "Movimiento no encontrado.");
      if (!moved) {
        throw new ApiError(409, "LEDGER_ENTRY_STATE_CONFLICT", "El movimiento ya no está en el estado esperado.");
      }
      return toDto(row);
    },
  };
}
