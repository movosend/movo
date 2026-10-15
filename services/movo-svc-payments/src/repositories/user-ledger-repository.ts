import { Prisma, PrismaClient } from "../generated/prisma/client";
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

export interface UserLedgerRepository {
  /**
   * Inserta el movimiento. Si la `idempotencyKey` ya existe devuelve la fila original con
   * `created: false` (la base es la que decide, así dos requests a la vez terminan con UNA fila).
   */
  insert(data: NewLedgerEntry): Promise<{ entry: UserLedgerEntry; created: boolean }>;
  /** Suma con signo de los movimientos no anulados. */
  balance(userId: string): Promise<Prisma.Decimal>;
  /** Movimiento de deuda sin saldar más viejo (`pending`/`reserved`, monto positivo). */
  oldestUnpaidAt(userId: string): Promise<Date | null>;
  /** Más nuevos primero. Pide `limit` filas: el service pide una de más para saber si hay otra página. */
  listPage(userId: string, limit: number, after?: LedgerCursor): Promise<UserLedgerEntry[]>;
  /** Cambia el `status` solo si sigue en `expected`. `false` si otro llamador ya lo movió. */
  updateStatusIfCurrent(
    userId: string,
    entryId: string,
    expected: LedgerEntryStatus,
    next: LedgerEntryStatus
  ): Promise<boolean>;
  findById(userId: string, entryId: string): Promise<UserLedgerEntry | null>;
}

export function createUserLedgerRepository(db: PrismaClient): UserLedgerRepository {
  return {
    async insert(data) {
      try {
        const entry = await db.userLedgerEntry.create({ data: { ...data, createdAt: new Date() } });
        return { entry, created: true };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const existing = await db.userLedgerEntry.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
          if (existing) return { entry: existing, created: false };
        }
        throw err;
      }
    },

    async balance(userId) {
      const { _sum } = await db.userLedgerEntry.aggregate({
        where: { userId, status: { not: "voided" } },
        _sum: { amountArs: true },
      });
      return _sum.amountArs ?? new Prisma.Decimal(0);
    },

    async oldestUnpaidAt(userId) {
      const { _min } = await db.userLedgerEntry.aggregate({
        where: { userId, status: { in: ["pending", "reserved"] }, amountArs: { gt: 0 } },
        _min: { createdAt: true },
      });
      return _min.createdAt ?? null;
    },

    listPage(userId, limit, after) {
      return db.userLedgerEntry.findMany({
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
