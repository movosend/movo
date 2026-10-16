import type { Prisma, PrismaClient } from "../generated/prisma/client";
import type { BalancePaymentAttempt, BalanceAttemptStatus, HoldFailureReason } from "../generated/prisma/client";

export type { BalancePaymentAttempt, BalanceAttemptStatus };

/** Estados en los que un intento todavía puede terminar en un cobro. */
export const OPEN_ATTEMPT_STATUSES: readonly BalanceAttemptStatus[] = ["creating", "pending"];

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

export interface NewBalanceAttempt {
  userId: string;
  amountArs: Prisma.Decimal;
  savedCardId: string;
  requestFingerprint: string;
}

/** Lo que se aprende del pago de MP y se anota en el intento. */
export interface BalanceAttemptUpdate {
  status: BalanceAttemptStatus;
  mpPaymentId?: string | null;
  statusDetail?: string | null;
  failureReason?: HoldFailureReason | null;
}

/** MOVO-312: persistencia de los intentos de "Pagar mi saldo". */
export interface BalancePaymentAttemptRepository {
  /**
   * Abre un intento `creating`. El índice único parcial (usuario + monto mientras `creating`/`pending`) decide si dos
   * pedidos iguales llegan a la vez: el que pierde recibe el intento abierto (`created: false`).
   */
  insertOpen(data: NewBalanceAttempt): Promise<{ attempt: BalancePaymentAttempt; created: boolean }>;
  findById(id: string): Promise<BalancePaymentAttempt | null>;
  /** Intentos abiertos del usuario, del más viejo al más nuevo. */
  listOpenByUser(userId: string): Promise<BalancePaymentAttempt[]>;
  /**
   * Actualiza un intento abierto (`creating`/`pending`). `false` si ya estaba cerrado: otro llamador (el webhook o una
   * respuesta que llegó antes) ya lo resolvió.
   */
  updateOpen(id: string, update: BalanceAttemptUpdate): Promise<boolean>;
  /**
   * Marca el intento `approved` con el pago que lo aprobó, aunque estuviera cerrado (un aprobado tardío es plata
   * recibida). Idempotente: con el MISMO pago devuelve `true`; si ese pago ya figura en otro intento, `false`.
   */
  markApproved(id: string, mpPaymentId: string, statusDetail: string | null): Promise<boolean>;
}

export function createBalancePaymentAttemptRepository(db: PrismaClient): BalancePaymentAttemptRepository {
  const open = [...OPEN_ATTEMPT_STATUSES];

  return {
    async insertOpen(data) {
      try {
        const attempt = await db.balancePaymentAttempt.create({ data: { ...data, status: "creating" } });
        return { attempt, created: true };
      } catch (error) {
        if (isUniqueViolation(error)) {
          const existing = await db.balancePaymentAttempt.findFirst({
            where: { userId: data.userId, amountArs: data.amountArs, status: { in: open } },
            orderBy: { createdAt: "desc" },
          });
          if (existing) return { attempt: existing, created: false };
        }
        throw error;
      }
    },

    findById(id) {
      return db.balancePaymentAttempt.findUnique({ where: { id } });
    },

    listOpenByUser(userId) {
      return db.balancePaymentAttempt.findMany({
        where: { userId, status: { in: open } },
        orderBy: { createdAt: "asc" },
      });
    },

    async updateOpen(id, update) {
      try {
        const { count } = await db.balancePaymentAttempt.updateMany({
          where: { id, status: { in: open } },
          data: {
            status: update.status,
            ...(update.mpPaymentId !== undefined ? { mpPaymentId: update.mpPaymentId } : {}),
            ...(update.statusDetail !== undefined ? { statusDetail: update.statusDetail } : {}),
            ...(update.failureReason !== undefined ? { failureReason: update.failureReason } : {}),
          },
        });
        return count === 1;
      } catch (error) {
        // El mismo pago de MP ya figura en otro intento.
        if (isUniqueViolation(error)) return false;
        throw error;
      }
    },

    async markApproved(id, mpPaymentId, statusDetail) {
      try {
        const { count } = await db.balancePaymentAttempt.updateMany({
          where: { id, OR: [{ status: { not: "approved" } }, { mpPaymentId }] },
          data: { status: "approved", mpPaymentId, statusDetail, failureReason: null },
        });
        return count === 1;
      } catch (error) {
        if (isUniqueViolation(error)) return false;
        throw error;
      }
    },
  };
}
