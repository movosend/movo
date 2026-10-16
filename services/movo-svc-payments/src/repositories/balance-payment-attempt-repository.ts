import type { Prisma, PrismaClient } from "../generated/prisma/client";
import type { BalancePaymentAttempt, BalanceAttemptStatus } from "../generated/prisma/client";

export type { BalancePaymentAttempt, BalanceAttemptStatus };

/** Estados en los que un intento todavía puede terminar en un pago. */
export const OPEN_ATTEMPT_STATUSES: readonly BalanceAttemptStatus[] = ["creating", "pending"];

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

export interface NewBalanceAttempt {
  userId: string;
  amountArs: Prisma.Decimal;
  expiresAt: Date;
}

/** MOVO-312: persistencia de los intentos de "Pagar mi saldo" con Checkout Pro. */
export interface BalancePaymentAttemptRepository {
  /**
   * Abre un intento `creating`. El índice único parcial (usuario + monto mientras `creating`/`pending`) es el que
   * decide si dos pedidos iguales llegan a la vez: el que pierde recibe el intento abierto (`created: false`).
   */
  insertOpen(data: NewBalanceAttempt): Promise<{ attempt: BalancePaymentAttempt; created: boolean }>;
  findById(id: string): Promise<BalancePaymentAttempt | null>;
  /** Intentos abiertos del usuario, del más viejo al más nuevo. */
  listOpenByUser(userId: string): Promise<BalancePaymentAttempt[]>;
  /** `creating -> pending` con la preferencia armada. `false` si el intento ya no estaba `creating`. */
  markPending(id: string, data: { mpPreferenceId: string; checkoutUrl: string }): Promise<boolean>;
  /** Cierra un intento abierto (`creating`/`pending`). `false` si ya estaba cerrado. */
  closeOpen(id: string, status: Extract<BalanceAttemptStatus, "failed" | "rejected" | "abandoned">): Promise<boolean>;
  /**
   * Marca el intento `approved` con el pago que lo aprobó. Idempotente: si ya estaba `approved` con el MISMO pago
   * devuelve `true`; con otro pago (o si ese pago ya está en otro intento) devuelve `false`.
   */
  markApproved(id: string, mpPaymentId: string): Promise<boolean>;
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

    async markPending(id, data) {
      const { count } = await db.balancePaymentAttempt.updateMany({
        where: { id, status: "creating" },
        data: { status: "pending", mpPreferenceId: data.mpPreferenceId, checkoutUrl: data.checkoutUrl },
      });
      return count === 1;
    },

    async closeOpen(id, status) {
      const { count } = await db.balancePaymentAttempt.updateMany({
        where: { id, status: { in: open } },
        data: { status },
      });
      return count === 1;
    },

    async markApproved(id, mpPaymentId) {
      try {
        const { count } = await db.balancePaymentAttempt.updateMany({
          // Aprobar también un intento cerrado (rechazado/abandonado): un pago aprobado tardío es plata recibida.
          where: { id, OR: [{ status: { not: "approved" } }, { mpPaymentId }] },
          data: { status: "approved", mpPaymentId },
        });
        return count === 1;
      } catch (error) {
        // El mismo pago de MP ya figura en otro intento.
        if (isUniqueViolation(error)) return false;
        throw error;
      }
    },
  };
}
