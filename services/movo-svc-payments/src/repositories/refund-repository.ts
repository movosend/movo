import { Prisma, PrismaClient } from "../generated/prisma/client";
import type { Refund, RefundStatus } from "../generated/prisma/client";

export type { Refund };

/** Intentos que ya comprometen plata: `failed` no, MP no devolvió nada. El fallback sí: la deuda ya quedó asentada. */
export const COMMITTED_REFUND_STATUSES: RefundStatus[] = ["processing", "succeeded", "fallback_to_ledger"];

/** Lo que MP efectivamente tiene en curso o devuelto: el fallback nunca llegó a MP. */
const REFUNDED_IN_MP_STATUSES: RefundStatus[] = ["processing", "succeeded"];

export interface ReserveRefundInput {
  settlementId: string;
  shipmentId: string;
  holdId: string;
  carrierId: string;
  mpPaymentId: string;
  /** Lo capturado: el tope de todos los reembolsos juntos. */
  capturedAmountArs: Prisma.Decimal;
  /** `null` = todo lo que todavía se puede reembolsar. */
  amountArs: Prisma.Decimal | null;
  reason: string;
  requestKey: string;
  requestFingerprint: string;
  adminId: string;
}

export type ReserveRefundResult =
  | { kind: "created"; refund: Refund }
  /** Ya había un intento vivo (`processing`, `succeeded` o `fallback_to_ledger`) con esa key. */
  | { kind: "existing"; refund: Refund };

/** El monto pedido no entra en lo reembolsable (o no queda nada por reembolsar). */
export class RefundAmountExceedsError extends Error {
  constructor(public readonly refundableArs: Prisma.Decimal) {
    super(`El monto supera lo reembolsable (${refundableArs.toString()})`);
    this.name = "RefundAmountExceedsError";
  }
}

/** La `idempotencyKey` ya se usó con otro monto o motivo. */
export class RefundIdempotencyConflictError extends Error {
  constructor() {
    super("La idempotencyKey del reembolso ya se usó con otro monto o motivo");
    this.name = "RefundIdempotencyConflictError";
  }
}

export interface RefundUpdate {
  status?: RefundStatus;
  failureReason?: string | null;
  mpRefundId?: string | null;
  mpResponse?: Prisma.InputJsonValue;
  lastError?: string | null;
  ledgerEntryId?: string | null;
  completedAt?: Date | null;
}

export interface RefundRepository {
  /**
   * Reserva un intento en `processing` ANTES de hablar con MP. Atómico por liquidación: se toma un lock de fila sobre
   * ella, así dos pedidos a la vez no pueden reservar más de lo reembolsable ni crear dos filas vivas con la misma key.
   * Tira `RefundAmountExceedsError` o `RefundIdempotencyConflictError`.
   */
  reserve(input: ReserveRefundInput): Promise<ReserveRefundResult>;
  findById(id: string): Promise<Refund | null>;
  /** Los intentos de la liquidación, del más viejo al más nuevo. */
  listBySettlement(settlementId: string): Promise<Refund[]>;
  /** UPDATE condicional sobre el estado: `false` si otro llamador ya movió el intento (mismo patrón que las liquidaciones). */
  updateIfStatus(id: string, expected: RefundStatus, patch: RefundUpdate): Promise<boolean>;
  /** Suma de lo que MP tiene reembolsado o en curso para ese pago, para que el webhook reconozca lo propio (AC7). */
  sumRefundedInMp(mpPaymentId: string): Promise<Prisma.Decimal>;
  /**
   * Toma un intento `processing` para reintentarlo. Atómico: solo lo gana UN pedido, así dos reintentos a la vez no le
   * pegan los dos a MP. Se puede tomar si nadie lo está manejando (`last_error` cargado: el intento anterior terminó
   * sin confirmar) o si el que lo manejaba lleva demasiado (`updated_at` anterior a `staleBefore`: se cayó). Al
   * tomarlo vuelve a marcarse "en manos de alguien" (`last_error` en null y `updated_at` nuevo).
   */
  claim(id: string, staleBefore: Date): Promise<boolean>;
  /**
   * Pasa a `succeeded` los intentos `processing` que MP ya confirma como devueltos (webhook): `refundedInMpArs` es el
   * total que MP informa para el pago. Los más viejos primero, mientras entren en lo que MP informa más allá de lo que
   * ya figura `succeeded`. Devuelve cuántos promovió. Idempotente.
   */
  promoteConfirmed(mpPaymentId: string, refundedInMpArs: Prisma.Decimal, now: Date): Promise<number>;
}

const zero = () => new Prisma.Decimal(0);

/** Lo que todavía se puede reembolsar de lo capturado, dados los intentos de la liquidación. */
export function refundableAmount(captured: Prisma.Decimal, refunds: Pick<Refund, "status" | "amountArs">[]): Prisma.Decimal {
  const committed = refunds
    .filter((r) => COMMITTED_REFUND_STATUSES.includes(r.status))
    .reduce((sum, r) => sum.plus(r.amountArs), zero());
  const left = captured.minus(committed);
  return left.isNegative() ? zero() : left;
}

export function createRefundRepository(db: PrismaClient): RefundRepository {
  return {
    async reserve(input) {
      return db.$transaction(async (tx) => {
        // Serializa los reembolsos de una misma liquidación hasta el commit.
        await tx.$queryRaw`SELECT "id" FROM "payments"."settlements" WHERE "id" = ${input.settlementId}::uuid FOR UPDATE`;

        const rows = await tx.refund.findMany({
          where: { settlementId: input.settlementId },
          orderBy: { attempt: "asc" },
        });

        const sameKey = rows.filter((r) => r.requestKey === input.requestKey);
        if (sameKey.some((r) => r.requestFingerprint !== input.requestFingerprint)) {
          throw new RefundIdempotencyConflictError();
        }
        const live = sameKey.filter((r) => r.status !== "failed");
        if (live.length > 0) return { kind: "existing" as const, refund: live[live.length - 1] };

        const refundable = refundableAmount(input.capturedAmountArs, rows);
        const amount = input.amountArs ?? refundable;
        if (amount.lte(0) || amount.gt(refundable)) throw new RefundAmountExceedsError(refundable);

        const attempt = (rows[rows.length - 1]?.attempt ?? 0) + 1;
        const refund = await tx.refund.create({
          data: {
            settlementId: input.settlementId,
            shipmentId: input.shipmentId,
            holdId: input.holdId,
            carrierId: input.carrierId,
            mpPaymentId: input.mpPaymentId,
            attempt,
            amountArs: amount,
            reason: input.reason,
            requestKey: input.requestKey,
            requestFingerprint: input.requestFingerprint,
            adminId: input.adminId,
            mpIdempotencyKey: `movo-refund-${input.settlementId}-${attempt}`,
            status: "processing",
          },
        });
        return { kind: "created" as const, refund };
      });
    },

    findById(id) {
      return db.refund.findUnique({ where: { id } });
    },

    listBySettlement(settlementId) {
      return db.refund.findMany({ where: { settlementId }, orderBy: { attempt: "asc" } });
    },

    async updateIfStatus(id, expected, patch) {
      const { count } = await db.refund.updateMany({ where: { id, status: expected }, data: patch });
      return count === 1;
    },

    async claim(id, staleBefore) {
      const { count } = await db.refund.updateMany({
        where: {
          id,
          status: "processing",
          OR: [{ lastError: { not: null } }, { updatedAt: { lt: staleBefore } }],
        },
        data: { lastError: null },
      });
      return count === 1;
    },

    async promoteConfirmed(mpPaymentId, refundedInMpArs, now) {
      const rows = await db.refund.findMany({
        where: { mpPaymentId, status: { in: ["processing", "succeeded"] } },
        orderBy: { attempt: "asc" },
      });
      let budget = refundedInMpArs.minus(
        rows.filter((r) => r.status === "succeeded").reduce((sum, r) => sum.plus(r.amountArs), zero())
      );
      let promoted = 0;
      for (const row of rows.filter((r) => r.status === "processing")) {
        if (row.amountArs.gt(budget)) break;
        const applied = await db.refund.updateMany({
          where: { id: row.id, status: "processing" },
          data: { status: "succeeded", failureReason: null, lastError: null, completedAt: now },
        });
        budget = budget.minus(row.amountArs);
        promoted += applied.count;
      }
      return promoted;
    },

    async sumRefundedInMp(mpPaymentId) {
      const { _sum } = await db.refund.aggregate({
        where: { mpPaymentId, status: { in: REFUNDED_IN_MP_STATUSES } },
        _sum: { amountArs: true },
      });
      return _sum.amountArs ?? zero();
    },
  };
}
