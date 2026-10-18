import { createHash } from "node:crypto";
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
  /**
   * MOVO-311: al capturar, asienta la deuda que cobró el hold. Lo `reserved` del tipo pasa a `settled`
   * si MP retuvo lo reservado; si retuvo otra cosa (los montos no se pueden editar), o si la reserva ya estaba
   * anulada (el hold pasó por `cancelled` y MP igual capturó), se inserta un `settled` por lo real
   * (`<tipo>:settle:<holdId>`). Idempotente y seguro ante llamadas concurrentes.
   */
  settleHoldDebt(holdId: string, settled: HoldDebtSettlement[]): Promise<void>;
}

/** Lo que efectivamente cobró un hold de la deuda de un usuario (MOVO-311). */
export interface HoldDebtSettlement {
  type: Extract<LedgerEntryType, "fee_offset" | "payment_surcharge">;
  /** Monto cobrado, positivo (el movimiento lo registra con signo negativo). */
  amountArs: Prisma.Decimal;
}

/**
 * Huella (sha256 del JSON) con la que se compara un reintento idempotente: la usan el service y este repositorio,
 * así que tiene que ser una sola (si cambiaran por separado, los reintentos dejarían de coincidir).
 */
export const fingerprintOf = (parts: Record<string, unknown>): string =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");

type HoldDebtEntryData = Pick<NewLedgerEntry, "userId" | "type" | "amountArs" | "status" | "shipmentId" | "holdId"> & {
  type: HoldDebtSettlement["type"];
  roleAtOrigin: LedgerRole;
  idempotencyKey: string;
};

/**
 * MOVO-311: arma un movimiento de deuda cobrada en un hold (la reserva y su asiento definitivo). Un solo lugar
 * para los dos, así comparten campos y huella y solo cambian el `status` y la clave.
 */
const roleOf = (type: HoldDebtSettlement["type"]): LedgerRole => (type === "fee_offset" ? "carrier" : "sender");

function holdDebtEntry(data: HoldDebtEntryData): NewLedgerEntry & { createdAt: Date } {
  return {
    ...data,
    paymentId: null,
    reason: null,
    adminId: null,
    requestFingerprint: fingerprintOf({
      userId: data.userId,
      type: data.type,
      roleAtOrigin: data.roleAtOrigin,
      amount: data.amountArs.toFixed(2),
      status: data.status,
      shipmentId: data.shipmentId,
      holdId: data.holdId,
      paymentId: null,
    }),
    createdAt: new Date(),
  };
}

/**
 * MOVO-311: serializa, dentro de la transacción, a quienes leen el saldo de un usuario para reservar
 * parte de su deuda: dos holds en paralelo del mismo usuario no pueden descontar la misma deuda.
 */
export async function lockLedgerUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  // $executeRaw y no $queryRaw: la función devuelve `void`, un tipo que Prisma no deserializa.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`user_ledger:${userId}`}))`;
}

/** Pagos de saldo (MOVO-312) que todavía pueden terminar en un cobro. Los mismos estados que `OPEN_ATTEMPT_STATUSES`. */
const OPEN_BALANCE_ATTEMPT_STATUSES: Array<"creating" | "pending"> = ["creating", "pending"];

/**
 * Saldo con signo de lo que el usuario debe de verdad: suma de lo no anulado SIN las reservas negativas de un hold
 * (MOVO-311). Una reserva todavía no es un cobro: si el hold se cae vuelve la deuda. Es el saldo que se muestra y el
 * que mide el bloqueo por deuda vencida (MOVO-313): un hold en curso no destraba a nadie.
 */
export async function readLedgerBalance(db: Db, userId: string): Promise<Prisma.Decimal> {
  const { _sum } = await db.userLedgerEntry.aggregate({
    where: { userId, status: { not: "voided" }, NOT: { status: "reserved", amountArs: { lt: 0 } } },
    _sum: { amountArs: true },
  });
  return _sum.amountArs ?? new Prisma.Decimal(0);
}

/**
 * MOVO-311: `readLedgerBalance` menos lo que ya reservaron los holds en curso, o sea la deuda que todavía no tomó
 * ningún hold. Es el máximo que puede pagar "Pagar mi saldo" (MOVO-312): pagar de más una deuda que un hold ya va a
 * cobrar dejaría un saldo a favor. Hay que leerlo con `lockLedgerUser` tomado si se va a actuar sobre él.
 */
export async function readBalanceNetOfReservations(db: Db, userId: string): Promise<Prisma.Decimal> {
  const { _sum } = await db.userLedgerEntry.aggregate({
    where: { userId, status: { not: "voided" } },
    _sum: { amountArs: true },
  });
  return _sum.amountArs ?? new Prisma.Decimal(0);
}

/**
 * MOVO-311/312: saldo que todavía se puede cobrar en un hold. A `readBalanceNetOfReservations` le descuenta los pagos
 * de saldo abiertos (`creating`/`pending`, todavía sin asiento): si no, un hold y un pago de saldo en vuelo cobrarían
 * la misma deuda. Hay que leerlo con `lockLedgerUser` tomado si se va a actuar sobre él.
 */
export async function readCollectableBalance(db: Db, userId: string): Promise<Prisma.Decimal> {
  const [net, { _sum: open }] = await Promise.all([
    readBalanceNetOfReservations(db, userId),
    db.balancePaymentAttempt.aggregate({
      where: { userId, status: { in: OPEN_BALANCE_ATTEMPT_STATUSES } },
      _sum: { amountArs: true },
    }),
  ]);
  return net.minus(open.amountArs ?? new Prisma.Decimal(0));
}

/**
 * MOVO-311: reserva (`reserved`, monto negativo) la deuda que va a cobrar un hold recién creado. La key es
 * `<tipo>:<holdId>`: un intento de hold reserva una sola vez por tipo.
 */
export async function insertHoldDebtReservation(
  tx: Prisma.TransactionClient,
  data: {
    userId: string;
    type: HoldDebtSettlement["type"];
    amountArs: Prisma.Decimal;
    shipmentId: string;
    holdId: string;
  }
): Promise<void> {
  await tx.userLedgerEntry.create({
    data: holdDebtEntry({
      userId: data.userId,
      roleAtOrigin: roleOf(data.type),
      type: data.type,
      amountArs: data.amountArs.negated(),
      status: "reserved",
      shipmentId: data.shipmentId,
      holdId: data.holdId,
      idempotencyKey: `${data.type}:${data.holdId}`,
    }),
  });
}

/**
 * La deuda actual se explica con los cargos más nuevos: se recorren los cargos sin saldar
 * (`pending`/`reserved`, monto positivo) del más nuevo al más viejo hasta cubrir el saldo, y el último
 * que hizo falta es el más viejo. Así una penalidad ya compensada por un movimiento negativo, pero que
 * quedó `pending`, no figura como la deuda vieja cuando después entra una deuda nueva.
 */
async function readSummary(db: Db, userId: string): Promise<LedgerSummary> {
  const balance = await readLedgerBalance(db, userId);
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

    async settleHoldDebt(holdId, settled) {
      await db.$transaction(async (tx) => {
        for (const { type, amountArs } of settled) {
          let reservation = await tx.userLedgerEntry.findUnique({ where: { idempotencyKey: `${type}:${holdId}` } });
          if (!reservation) continue;
          if (reservation.status === "reserved" && reservation.amountArs.negated().equals(amountArs)) {
            const { count } = await tx.userLedgerEntry.updateMany({
              where: { id: reservation.id, status: "reserved" },
              data: { status: "settled" },
            });
            if (count === 1) continue;
            // Otro llamador (o el trigger del hold) la movió en el medio: se decide con lo que dejó.
            reservation = await tx.userLedgerEntry.findUniqueOrThrow({ where: { id: reservation.id } });
          }
          if (reservation.status === "settled") continue;
          // MP retuvo otra cosa: la reserva se anula y se asienta lo real.
          if (reservation.status === "reserved") {
            await tx.userLedgerEntry.updateMany({ where: { id: reservation.id, status: "reserved" }, data: { status: "voided" } });
          }
          // Anulada por nosotros, o por el trigger si el hold pasó por `cancelled`/`rejected` mientras MP igual
          // capturaba: la plata se cobró, así que la deuda saldada se asienta aparte. `skipDuplicates` (ON CONFLICT
          // DO NOTHING) lo hace idempotente sin abortar la transacción, que un P2002 sí abortaría.
          if (amountArs.lessThanOrEqualTo(0)) continue;
          await tx.userLedgerEntry.createMany({
            data: [
              holdDebtEntry({
                userId: reservation.userId,
                roleAtOrigin: roleOf(type),
                type,
                amountArs: amountArs.negated(),
                status: "settled",
                shipmentId: reservation.shipmentId,
                holdId,
                idempotencyKey: `${type}:settle:${holdId}`,
              }),
            ],
            skipDuplicates: true,
          });
        }
      });
    },
  };
}
