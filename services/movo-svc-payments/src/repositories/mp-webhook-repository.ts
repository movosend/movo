import { Prisma, PrismaClient } from "../generated/prisma/client";
import type {
  HoldProviderEventKind,
  HoldStatus,
  MpWebhookNotification,
  PaymentProviderEvent,
  PaymentProviderEventKind,
} from "../generated/prisma/client";
import type { HoldUpdate } from "./hold-repository";

export type { MpWebhookNotification, PaymentProviderEvent };

export interface NewMpWebhookNotification {
  mpNotificationId: string;
  topic: string;
  action: string | null;
  mpPaymentId: string;
  mpUserId: string | null;
  liveMode: boolean | null;
}

export interface NewPaymentProviderEvent {
  holdId: string;
  shipmentId: string;
  mpPaymentId: string;
  kind: PaymentProviderEventKind;
  mpStatus: string;
  mpStatusDetail: string | null;
  amountArs: number | null;
  holdStatus: HoldStatus;
}

/** Cómo termina un intento de procesar una notificación. */
export type NotificationResolution =
  | { status: "processed" | "ignored" | "unverifiable" | "failed"; outcome: string; lastError?: string | null }
  | { status: "pending"; outcome: string; lastError: string; nextAttemptAt: Date };

/**
 * MOVO-268: persistencia del inbox del webhook y del registro de eventos del proveedor.
 * El reclamo de una notificación es un UPDATE condicional (`pending` + vencida), así el
 * procesamiento inmediato tras recibirla y el barrido nunca la procesan a la vez.
 */
export interface MpWebhookRepository {
  /** Inserta la notificación; `null` si ya existía (reenvío de MP, AC6). */
  insertIfNew(data: NewMpWebhookNotification): Promise<MpWebhookNotification | null>;
  findById(id: string): Promise<MpWebhookNotification | null>;
  /** Ids `pending` cuyo próximo intento ya venció, los más viejos primero. */
  findDue(now: Date, limit: number): Promise<string[]>;
  /**
   * Toma la notificación para procesarla: suma un intento y corre `next_attempt_at` a
   * `leaseUntil`, así si el proceso muere a mitad de camino el barrido la retoma después
   * del lease. `null` si otro ya la tomó o no está `pending`.
   */
  claim(id: string, now: Date, leaseUntil: Date): Promise<MpWebhookNotification | null>;
  resolve(id: string, resolution: NotificationResolution, now: Date): Promise<void>;
  /**
   * Cambia el estado del hold SOLO si sigue en `expectedStatus`, y en la misma
   * transacción deja anotado en la notificación el aviso pendiente a svc-shipments.
   * `false` si el hold ya había cambiado (otra notificación, la liberación de Movo o
   * `?sync=true` llegaron antes): en ese caso no hay transición ni aviso.
   */
  transitionHold(params: {
    notificationId: string;
    holdId: string;
    expectedStatus: HoldStatus;
    patch: HoldUpdate;
    pendingEvent: HoldProviderEventKind | null;
    pendingEventDetail: string | null;
  }): Promise<boolean>;
  /** El aviso a svc-shipments ya se entregó. */
  clearPendingHoldEvent(id: string): Promise<void>;
  /** Inserta el evento; `null` si ese (pago, estado de MP) ya estaba registrado (AC6). */
  recordProviderEvent(data: NewPaymentProviderEvent): Promise<PaymentProviderEvent | null>;
  markProviderEventAlerted(id: string, now: Date): Promise<void>;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export function createMpWebhookRepository(db: PrismaClient): MpWebhookRepository {
  return {
    async insertIfNew(data) {
      try {
        return await db.mpWebhookNotification.create({ data });
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },

    findById(id) {
      return db.mpWebhookNotification.findUnique({ where: { id } });
    },

    async findDue(now, limit) {
      const rows = await db.mpWebhookNotification.findMany({
        where: { status: "pending", nextAttemptAt: { lte: now } },
        orderBy: { nextAttemptAt: "asc" },
        take: limit,
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },

    async claim(id, now, leaseUntil) {
      const { count } = await db.mpWebhookNotification.updateMany({
        where: { id, status: "pending", nextAttemptAt: { lte: now } },
        data: { attempts: { increment: 1 }, nextAttemptAt: leaseUntil },
      });
      if (count === 0) return null;
      return db.mpWebhookNotification.findUnique({ where: { id } });
    },

    async resolve(id, resolution, now) {
      await db.mpWebhookNotification.update({
        where: { id },
        data:
          resolution.status === "pending"
            ? { outcome: resolution.outcome, lastError: resolution.lastError, nextAttemptAt: resolution.nextAttemptAt }
            : {
                status: resolution.status,
                outcome: resolution.outcome,
                lastError: resolution.lastError ?? null,
                processedAt: now,
              },
      });
    },

    async transitionHold({ notificationId, holdId, expectedStatus, patch, pendingEvent, pendingEventDetail }) {
      return db.$transaction(async (tx) => {
        const { count } = await tx.hold.updateMany({ where: { id: holdId, status: expectedStatus }, data: patch });
        if (count === 0) return false;
        await tx.mpWebhookNotification.update({
          where: { id: notificationId },
          data: { holdId, pendingHoldEvent: pendingEvent, pendingHoldEventDetail: pendingEventDetail },
        });
        return true;
      });
    },

    async clearPendingHoldEvent(id) {
      await db.mpWebhookNotification.update({
        where: { id },
        data: { pendingHoldEvent: null, pendingHoldEventDetail: null },
      });
    },

    async recordProviderEvent(data) {
      try {
        return await db.paymentProviderEvent.create({
          data: { ...data, amountArs: data.amountArs === null ? null : new Prisma.Decimal(data.amountArs) },
        });
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },

    async markProviderEventAlerted(id, now) {
      await db.paymentProviderEvent.update({ where: { id }, data: { alertedAt: now } });
    },
  };
}
