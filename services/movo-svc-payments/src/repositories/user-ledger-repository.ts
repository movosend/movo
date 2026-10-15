import { Prisma, PrismaClient } from "../generated/prisma/client";
import { ApiError } from "@movo/shared";
import type {
  LedgerEntryStatus,
  LedgerEntryType,
  LedgerRole,
  UserLedgerEntry,
} from "../generated/prisma/client";

export type { UserLedgerEntry };

export interface NewLedgerEntry {
  userId: string;
  roleAtOrigin: LedgerRole | null;
  type: LedgerEntryType;
  amountArs: Prisma.Decimal;
  status: LedgerEntryStatus;
  shipmentId: string | null;
  holdId: string | null;
  paymentId: string | null;
  reason: string | null;
  adminId: string | null;
  idempotencyKey: string;
  requestFingerprint: string;
}

export interface LedgerCursor {
  /** ISO con milisegundos: `created_at` lo pone la app, no Postgres. */
  createdAt: Date;
  id: string;
}

export interface LedgerSummary {
  balance: Prisma.Decimal;
  /** Fecha del cargo más viejo que compone la deuda actual; `null` si el saldo no es positivo. */
  oldestUnpaidAt: Date | null;
}

type Db = PrismaClient | Prisma.TransactionClient;

export interface UserLedgerRepository {
  /**
   * Inserta el movimiento. Si la `idempotencyKey` ya existe devuelve la fila original con
   * `created: false` (la base es la que decide, así dos requests a la vez terminan con UNA fila).
   */
  insert(data: NewLedgerEntry): Promise<{ entry: UserLedgerEntry; created: boolean }>;
  /** Saldo (suma con signo de lo no anulado) y deuda más vieja, leídos con la misma foto de la base. */
  summary(userId: string): Promise<LedgerSummary>;
  /**
   * Resumen + una página de movimientos (más nuevos primero) en una sola transacción, así el saldo
   * siempre coincide con la lista. Pide `limit` filas: el service pide una de más para saber si hay otra.
   */
  summaryWithPage(userId: string, limit: number, after?: LedgerCursor): Promise<LedgerSummary & { rows: UserLedgerEntry[] }>;
  /** Cambia el `status` solo si sigue en `expected`. `false` si otro llamador ya lo movió. */
  updateStatusIfCurrent(
    userId: string,
    entryId: string,
    expected: LedgerEntryStatus,
    next: LedgerEntryStatus
  ): Promise<boolean>;
  findById(userId: string, entryId: string): Promise<UserLedgerEntry | null>;
}

/**
 * La deuda actual se explica con los cargos más nuevos: se recorren los cargos sin saldar
 * (`pending`/`reserved`, monto positivo) del más nuevo al más viejo hasta cubrir el saldo, y el último
 * que hizo falta es el más viejo. Así una penalidad ya compensada por un movimiento negativo, pero que
 * quedó `pending`, no figura como la deuda vieja cuando después entra una deuda nueva.
 */
async function readSummary(db: Db, userId: string): Promise<LedgerSummary> {
  const { _sum } = await db.userLedgerEntry.aggregate({
    where: { userId, status: { not: "voided" } },
    _sum: { amountArs: true },
  });
  const balance = _sum.amountArs ?? new Prisma.Decimal(0);
  if (!balance.greaterThan(0)) return { balance, oldestUnpaidAt: null };

  const charges = await db.userLedgerEntry.findMany({
    where: { userId, status: { in: ["pending", "reserved"] }, amountArs: { gt: 0 } },
    select: { createdAt: true, amountArs: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  let covered = new Prisma.Decimal(0);
  let oldest: Date | null = null;
  for (const charge of charges) {
    oldest = charge.createdAt;
    covered = covered.plus(charge.amountArs);
    if (covered.greaterThanOrEqualTo(balance)) break;
  }
  return { balance, oldestUnpaidAt: oldest };
}

export function createUserLedgerRepository(db: PrismaClient): UserLedgerRepository {
  return {
    async insert(data) {
      try {
        const entry = await db.userLedgerEntry.create({ data: { ...data, createdAt: new Date() } });
        return { entry, created: true };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === "P2002") {
            const existing = await db.userLedgerEntry.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
            if (existing) return { entry: existing, created: false };
          }
          if (err.code === "P2003") {
            throw new ApiError(404, "HOLD_NOT_FOUND", "El hold no existe.");
          }
        }
        throw err;
      }
    },

    summary(userId) {
      return db.$transaction((tx) => readSummary(tx, userId), { isolationLevel: "RepeatableRead" });
    },

    summaryWithPage(userId, limit, after) {
      return db.$transaction(
        async (tx) => {
          const summary = await readSummary(tx, userId);
          const rows = await tx.userLedgerEntry.findMany({
            where: {
              userId,
              ...(after
                ? {
                    OR: [
                      { createdAt: { lt: after.createdAt } },
                      { createdAt: after.createdAt, id: { lt: after.id } },
                    ],
                  }
                : {}),
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: limit,
          });
          return { ...summary, rows };
        },
        { isolationLevel: "RepeatableRead" }
      );
    },

    async updateStatusIfCurrent(userId, entryId, expected, next) {
      const { count } = await db.userLedgerEntry.updateMany({
        where: { id: entryId, userId, status: expected },
        data: { status: next },
      });
      return count === 1;
    },

    findById(userId, entryId) {
      return db.userLedgerEntry.findFirst({ where: { id: entryId, userId } });
    },
  };
}
